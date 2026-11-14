//! Storm decision: where to take cover when a storm is declared.
//!
//! Hard rule: the astronaut must be under cover within `maxMinutesToCover`
//! of the warning. Among the sites they can reach in time (the base and every
//! shelter), the lowest score wins. If none is reachable, the nearest is
//! chosen and marked late.
//!
//! Score, with walking time t, site dose factor f, lead time L, storm length
//! D and storm multiplier M:
//!
//!   walking = min(t, L) * 1 + max(0, t - L) * M
//!   waiting = max(0, L - t) * f
//!   storm   = max(0, D - max(0, t - L)) * M * f
//!   dose    = walking + waiting + storm
//!   score   = dose * (1 + noLinkPenalty if no base link)
//!
//! Units are "minutes at the open-ground dose rate". See docs/decision-model.md.

use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StormConfig {
    pub lead_minutes: f64,
    pub storm_minutes: f64,
    pub dose_multiplier: f64,
    pub no_link_penalty: f64,
    pub max_minutes_to_cover: f64,
    /// Longest storm the measured length is allowed to set (data/site.json storm.stormMinutesCap).
    #[serde(default)]
    pub storm_minutes_cap: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Shelter,
    Base,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Shelter => "shelter",
            Kind::Base => "base",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub id: String,
    pub kind: Kind,
    /// Walking minutes to the site.
    pub t: f64,
    /// Blocked-sky fraction at the site.
    pub blocked: f64,
    /// Relative dose rate while sheltering there.
    pub f: f64,
    pub base_link: bool,
}

#[derive(Clone, Debug)]
pub struct Scored {
    pub candidate: Candidate,
    pub walking: f64,
    pub waiting: f64,
    pub storm: f64,
    pub dose: f64,
    pub score: f64,
    /// Within the time limit.
    pub reachable: bool,
}

#[derive(Clone, Debug)]
pub struct Decision {
    pub chosen: Scored,
    /// Minutes past the limit when nothing was reachable; None when the choice is in time.
    pub minutes_late: Option<f64>,
    /// Every candidate, best first: reachable ones by score, then the rest by score.
    pub ranked: Vec<Scored>,
}

pub fn score(c: &Candidate, s: &StormConfig) -> Scored {
    let (walking, waiting, storm) = crate::dose::cover(c.t, c.f, s.lead_minutes, s.storm_minutes, s.dose_multiplier);
    let dose = walking + waiting + storm;
    let score = dose * if c.base_link { 1.0 } else { 1.0 + s.no_link_penalty };
    Scored { candidate: c.clone(), walking, waiting, storm, dose, score, reachable: c.t <= s.max_minutes_to_cover }
}

/// Applies the hard limit, then the score. Panics if there are no candidates.
pub fn decide(candidates: &[Candidate], s: &StormConfig) -> Decision {
    assert!(!candidates.is_empty(), "no candidates to decide between");
    let mut ranked: Vec<Scored> = candidates.iter().map(|c| score(c, s)).collect();
    ranked.sort_by(|a, b| {
        b.reachable
            .cmp(&a.reachable)
            .then(a.score.total_cmp(&b.score))
            .then(a.candidate.t.total_cmp(&b.candidate.t))
    });
    if ranked[0].reachable {
        return Decision { chosen: ranked[0].clone(), minutes_late: None, ranked };
    }
    let nearest = ranked.iter().min_by(|a, b| a.candidate.t.total_cmp(&b.candidate.t)).unwrap().clone();
    let late = nearest.candidate.t - s.max_minutes_to_cover;
    Decision { chosen: nearest, minutes_late: Some(late), ranked }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dose::site_factor;

    const SHIELD: f64 = 0.5;
    const OPEN: f64 = 0.06;
    const BASE_FACTOR: f64 = 0.5;

    fn storm(lead: f64, limit: f64) -> StormConfig {
        StormConfig { lead_minutes: lead, storm_minutes: 120.0, dose_multiplier: 2.0, no_link_penalty: 0.05, max_minutes_to_cover: limit, storm_minutes_cap: None }
    }

    fn shelter(id: &str, t: f64, blocked: f64, link: bool) -> Candidate {
        Candidate { id: id.into(), kind: Kind::Shelter, t, blocked, f: site_factor(blocked, SHIELD, OPEN), base_link: link }
    }

    fn base(t: f64) -> Candidate {
        Candidate { id: "base".into(), kind: Kind::Base, t, blocked: 0.05, f: BASE_FACTOR, base_link: true }
    }

    #[test]
    fn base_within_the_limit_wins() {
        let s = storm(5.0, 5.0);
        let d = decide(&[shelter("s1", 1.0, 0.25, true), shelter("s2", 2.0, 0.30, true), base(4.5)], &s);
        assert_eq!(d.chosen.candidate.id, "base");
        assert!(d.minutes_late.is_none());
    }

    #[test]
    fn base_outside_the_limit_loses_to_the_best_reachable_shelter() {
        let s = storm(5.0, 5.0);
        let c = [shelter("thin", 1.0, 0.15, true), shelter("deep", 4.0, 0.30, true), shelter("far", 9.0, 0.40, true), base(6.0)];
        let d = decide(&c, &s);
        assert_eq!(d.chosen.candidate.id, "deep", "{:?}", d.chosen);
        assert!(d.minutes_late.is_none());
        assert!(!d.ranked.iter().find(|x| x.candidate.id == "base").unwrap().reachable);
    }

    #[test]
    fn nothing_reachable_takes_the_nearest_and_marks_it_late() {
        let s = storm(5.0, 5.0);
        let d = decide(&[shelter("s1", 8.0, 0.40, true), shelter("s2", 6.5, 0.16, false), base(12.0)], &s);
        assert_eq!(d.chosen.candidate.id, "s2");
        assert!((d.minutes_late.unwrap() - 1.5).abs() < 1e-9);
    }

    #[test]
    fn raising_the_limit_past_the_base_flips_the_choice_to_the_base() {
        let c = [shelter("s1", 2.0, 0.25, true), base(7.0)];
        assert_eq!(decide(&c, &storm(5.0, 5.0)).chosen.candidate.id, "s1");
        assert_eq!(decide(&c, &storm(5.0, 7.5)).chosen.candidate.id, "base");
    }

    #[test]
    fn of_two_identical_shelters_the_linked_one_wins() {
        let s = storm(5.0, 5.0);
        let d = decide(&[shelter("dark", 2.0, 0.2, false), shelter("linked", 2.0, 0.2, true)], &s);
        assert_eq!(d.chosen.candidate.id, "linked");
    }

    #[test]
    fn score_never_decreases_with_walking_time() {
        // For sites at least as sheltered as open ground (f <= 1).
        for lead in [0.0, 5.0, 30.0] {
            let s = storm(lead, lead);
            for f in [0.5, 0.75, 0.9, 1.0] {
                let mut prev = f64::MIN;
                for k in 0..=600 {
                    let c = Candidate { id: "x".into(), kind: Kind::Shelter, t: k as f64 * 0.5, blocked: 0.1, f, base_link: true };
                    let sc = score(&c, &s).score;
                    assert!(sc >= prev - 1e-9, "lead {lead}, f {f}, t {}: {sc} < {prev}", c.t);
                    prev = sc;
                }
            }
        }
    }
}
