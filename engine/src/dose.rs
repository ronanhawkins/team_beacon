//! Radiation dose model (docs/dose-model.md). One place for every dose the engine computes:
//! waypoint doses on the planned route and on reroutes, and the storm decision's score.
//!
//! Doses are in "open-ground minutes": one minute on open ground on a quiet day is 1.
//! Microgray = open-ground minutes x the measured quiet rate (microgray per hour) / 60.
//!
//!   rate(point, time) = quiet rate x f(point) x m(time)
//!   f = 1 - shielding x (blocked sky - open-ground blocked sky), kept to 0.5..1.05,
//!       or the habitat's fixed factor inside the base
//!   m = the storm multiplier while the storm is on, else 1

/// Relative dose rate at a place with this blocked-sky fraction.
///
/// Calibrated to Curiosity at Murray Butte (Ehresmann et al. 2021): about 9 more points of
/// blocked sky cut the dose by about 5 percent, so `shielding` is 0.5.
pub fn site_factor(blocked: f64, shielding: f64, open_blocked: f64) -> f64 {
    (1.0 - shielding * (blocked - open_blocked)).clamp(0.5, 1.05)
}

/// A storm on the route's clock: it arrives at `arrival` minutes from the start of the walk,
/// lasts `length` minutes, and multiplies the dose rate by `multiplier` meanwhile.
#[derive(Clone, Copy, Debug)]
pub struct Storm {
    pub arrival: f64,
    pub length: f64,
    pub multiplier: f64,
}

impl Storm {
    /// The multiplier at time `t`.
    pub fn at(&self, t: f64) -> f64 {
        if t >= self.arrival && t < self.arrival + self.length { self.multiplier } else { 1.0 }
    }

    /// Minutes of [t0, t1] during the storm.
    fn overlap(&self, t0: f64, t1: f64) -> f64 {
        (t1.min(self.arrival + self.length) - t0.max(self.arrival)).max(0.0)
    }
}

/// Dose of spending t0..t1 at relative rate `f`.
pub fn interval(f: f64, t0: f64, t1: f64, storm: Option<&Storm>) -> f64 {
    let dt = (t1 - t0).max(0.0);
    let during = storm.map_or(0.0, |s| s.overlap(t0, t1));
    let m = storm.map_or(1.0, |s| s.multiplier);
    f * (dt - during + during * m)
}

/// Dose so far at each point along a route: starts at `start`; each leg adds its mean factor
/// over its minutes, at the storm multiplier for the part of the leg after the storm arrives.
pub fn accumulate(factors: &[f64], minutes: &[f64], start: f64, storm: Option<&Storm>) -> Vec<f64> {
    let mut out = Vec::with_capacity(factors.len());
    let mut dose = start;
    for i in 0..factors.len() {
        if i > 0 {
            dose += interval(0.5 * (factors[i] + factors[i - 1]), minutes[i - 1], minutes[i], storm);
        }
        out.push(dose);
    }
    out
}

/// Dose of taking cover at a site when a storm is declared: walk `t` minutes on open ground,
/// wait at the site (factor `f`) until the storm arrives `lead` minutes after the warning,
/// then sit out the rest of the storm there. Returns (walking, waiting, storm).
pub fn cover(t: f64, f: f64, lead: f64, length: f64, multiplier: f64) -> (f64, f64, f64) {
    let s = Storm { arrival: lead, length, multiplier };
    let at_site = t.max(lead);
    (interval(1.0, 0.0, t, Some(&s)), interval(f, t, at_site, Some(&s)), interval(f, at_site, lead + length, Some(&s)))
}

/// Microgray from open-ground minutes.
pub fn micro_gray(dose: f64, quiet_rate_ugy_h: f64) -> f64 {
    dose * quiet_rate_ugy_h / 60.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_ground_on_a_quiet_day_is_one_per_minute() {
        assert_eq!(interval(1.0, 2.0, 12.0, None), 10.0);
        assert!((micro_gray(60.0, 6.3) - 6.3).abs() < 1e-12);
    }

    #[test]
    fn shelter_factor_follows_the_calibration() {
        assert_eq!(site_factor(0.075, 0.5, 0.075), 1.0);
        assert!((site_factor(0.165, 0.5, 0.075) - 0.955).abs() < 1e-12); // 9 points more: about 5 percent less
        assert!((site_factor(0.9, 0.5, 0.075) - 0.5875).abs() < 1e-12); // the 0.5 floor never binds: blocked sky is at most 1
        assert_eq!(site_factor(0.0, 0.5, 0.075), 1.0375);
    }

    #[test]
    fn a_leg_is_split_where_the_storm_arrives() {
        let s = Storm { arrival: 5.0, length: 100.0, multiplier: 10.0 };
        // 3 minutes before, 2 after.
        assert_eq!(interval(1.0, 2.0, 7.0, Some(&s)), 3.0 + 20.0);
        // Entirely in the warning: no storm dose.
        assert_eq!(interval(0.8, 0.0, 4.0, Some(&s)), 3.2);
        // After the storm has passed: quiet again.
        assert_eq!(interval(1.0, 105.0, 106.0, Some(&s)), 1.0);
        assert_eq!(s.at(4.9), 1.0);
        assert_eq!(s.at(5.0), 10.0);
    }

    #[test]
    fn accumulate_never_decreases_and_starts_where_told() {
        let s = Storm { arrival: 3.0, length: 50.0, multiplier: 30.0 };
        let d = accumulate(&[1.0, 0.9, 0.6, 1.05], &[0.0, 1.0, 4.0, 9.0], 0.25, Some(&s));
        assert_eq!(d[0], 0.25);
        assert!(d.windows(2).all(|w| w[1] >= w[0]), "{d:?}");
    }

    #[test]
    fn cover_matches_the_decision_formula() {
        // walking = min(t, L) + max(0, t - L) M; waiting = max(0, L - t) f; storm = max(0, D - max(0, t - L)) M f
        for (t, f, l) in [(2.0f64, 0.9f64, 5.0f64), (7.5, 0.6, 5.0), (0.0, 0.5, 0.0), (4.0, 1.0, 4.0)] {
            let (d, m): (f64, f64) = (120.0, 33.0);
            let late = (t - l).max(0.0);
            let want = (t.min(l) + late * m, (l - t).max(0.0) * f, (d - late).max(0.0) * m * f);
            let got = cover(t, f, l, d, m);
            for (a, b) in [(got.0, want.0), (got.1, want.1), (got.2, want.2)] {
                assert!((a - b).abs() < 1e-9, "t {t} f {f} L {l}: {got:?} vs {want:?}");
            }
        }
    }
}
