//! Storm decision model: where to go when a storm is declared.
//!
//! Each candidate site has a walking time t (minutes), a relative dose rate f
//! while sheltering there, and whether it has a base link. With lead time L,
//! storm length D and storm multiplier M:
//!
//!   walking = min(t, L) * 1 + max(0, t - L) * M
//!   waiting = max(0, L - t) * f
//!   storm   = max(0, D - max(0, t - L)) * M * f
//!   dose    = walking + waiting + storm
//!   score   = dose * (1 + noLinkPenalty if no base link)
//!
//! The lowest score wins; ties go to the shorter walk. Units are "minutes at
//! the open-ground dose rate". See docs/decision-model.md.

use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Habitat {
    pub return_minutes: f64,
    pub dose_factor: f64,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StormConfig {
    pub lead_minutes: f64,
    pub storm_minutes: f64,
    pub dose_multiplier: f64,
    pub no_link_penalty: f64,
    pub habitat: Habitat,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Shelter,
    Base,
    Habitat,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Shelter => "shelter",
            Kind::Base => "base",
            Kind::Habitat => "habitat",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub id: String,
    pub kind: Kind,
    /// Minutes until sheltered: walking time, plus the drive for the habitat.
    pub t: f64,
    /// Blocked-sky fraction at the site; None for the habitat.
    pub blocked: Option<f64>,
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
}

/// Relative dose rate at a site with this blocked fraction (the planner's formula).
pub fn site_factor(blocked: f64, dose_shielding_factor: f64, open_blocked: f64) -> f64 {
    (1.0 - dose_shielding_factor * (blocked - open_blocked)).clamp(0.5, 1.05)
}

pub fn score(c: &Candidate, s: &StormConfig) -> Scored {
    let (l, d, m) = (s.lead_minutes, s.storm_minutes, s.dose_multiplier);
    let late = (c.t - l).max(0.0); // minutes walked after the storm arrives
    let walking = c.t.min(l) + late * m;
    let waiting = (l - c.t).max(0.0) * c.f;
    let storm = (d - late).max(0.0) * m * c.f;
    let dose = walking + waiting + storm;
    let score = dose * if c.base_link { 1.0 } else { 1.0 + s.no_link_penalty };
    Scored { candidate: c.clone(), walking, waiting, storm, dose, score }
}

/// Every candidate scored, best first (lowest score, then shorter walk).
pub fn rank(candidates: &[Candidate], s: &StormConfig) -> Vec<Scored> {
    let mut out: Vec<Scored> = candidates.iter().map(|c| score(c, s)).collect();
    out.sort_by(|a, b| a.score.total_cmp(&b.score).then(a.candidate.t.total_cmp(&b.candidate.t)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHIELD: f64 = 0.5;
    const OPEN: f64 = 0.06;

    fn storm(lead: f64, habitat_minutes: f64) -> StormConfig {
        StormConfig {
            lead_minutes: lead,
            storm_minutes: 120.0,
            dose_multiplier: 2.0,
            no_link_penalty: 0.05,
            habitat: Habitat { return_minutes: habitat_minutes, dose_factor: 0.5 },
        }
    }

    fn shelter(id: &str, t: f64, blocked: f64, link: bool) -> Candidate {
        Candidate { id: id.into(), kind: Kind::Shelter, t, blocked: Some(blocked), f: site_factor(blocked, SHIELD, OPEN), base_link: link }
    }

    fn habitat(walk_to_base: f64, s: &StormConfig) -> Candidate {
        Candidate { id: "habitat".into(), kind: Kind::Habitat, t: walk_to_base + s.habitat.return_minutes, blocked: None, f: s.habitat.dose_factor, base_link: true }
    }

    #[test]
    fn habitat_20_minutes_away_wins() {
        let s = storm(5.0, 20.0);
        let c = [shelter("s1", 2.0, 0.25, true), shelter("s2", 1.0, 0.18, true), habitat(1.0, &s)];
        assert_eq!(rank(&c, &s)[0].candidate.kind, Kind::Habitat);
    }

    #[test]
    fn habitat_150_minutes_away_loses_to_the_best_linked_shelter() {
        let s = storm(5.0, 150.0);
        let c = [shelter("s1", 2.0, 0.20, true), shelter("s2", 3.0, 0.25, true), shelter("s3", 1.0, 0.10, true), habitat(1.0, &s)];
        let best = &rank(&c, &s)[0];
        assert_eq!(best.candidate.id, "s2", "{best:?}");
    }

    #[test]
    fn of_two_identical_shelters_the_linked_one_wins() {
        let s = storm(5.0, 150.0);
        let c = [shelter("dark", 2.0, 0.2, false), shelter("linked", 2.0, 0.2, true)];
        assert_eq!(rank(&c, &s)[0].candidate.id, "linked");
    }

    #[test]
    fn a_longer_lead_flips_the_choice_to_a_farther_better_site() {
        // A near, thin shelter against a farther, slightly better one. Walking to the far
        // site during the storm costs more than it saves; with enough warning it is worth it.
        let (near, far) = (shelter("near", 1.0, 0.14, true), shelter("far", 30.0, 0.16, true));
        let c = [near, far];
        assert_eq!(rank(&c, &storm(0.0, 150.0))[0].candidate.id, "near");
        assert_eq!(rank(&c, &storm(30.0, 150.0))[0].candidate.id, "far");
    }

    #[test]
    fn score_never_decreases_with_walking_time() {
        // For sites at least as sheltered as open ground (f <= 1), with or without a link.
        for lead in [0.0, 5.0, 30.0] {
            let s = storm(lead, 150.0);
            for f in [0.5, 0.75, 0.9, 1.0] {
                for link in [true, false] {
                    let mut prev = f64::MIN;
                    for k in 0..=600 {
                        let c = Candidate { id: "x".into(), kind: Kind::Shelter, t: k as f64 * 0.5, blocked: None, f, base_link: link };
                        let sc = score(&c, &s).score;
                        assert!(sc >= prev - 1e-9, "lead {lead}, f {f}, t {}: {sc} < {prev}", c.t);
                        prev = sc;
                    }
                }
            }
        }
    }
}
