//! Space weather for the briefing, from DONKI's Mars-directed forecasts
//! (data/cache/donki_mars.json, written by tools/fetch_donki.py).
//!
//! These are WSA-Enlil forecasts of coronal mass ejection arrivals, made days
//! ahead. They decide whether to go out at all; the storm decision's short
//! warning covers the fast particles that arrive minutes after a flare.

use serde::Deserialize;
use serde_json::{Value, json};

/// Arrivals this many hours either side of the sky time count as near it.
pub const WINDOW_HOURS: f64 = 72.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    pub windows: Windows,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Windows {
    pub may2024: Window,
    pub before_sky_time: Window,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub start_date: String,
    pub end_date: String,
    pub simulations: usize,
    pub mars_impacts: Vec<Impact>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Impact {
    pub arrival_time: String,
    pub is_glancing_blow: Option<bool>,
    pub model_completion_time: String,
    pub link: Option<String>,
}

/// Hours since 1970-01-01 for "2024-05-13T17:42Z", "2024-05-13T17:42:00Z" or "2026-11-14 19:40" (UTC).
pub fn hours(text: &str) -> Option<f64> {
    let t = text.trim().trim_end_matches('Z');
    let (date, time) = t.split_once(['T', ' '])?;
    let mut d = date.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let mut c = time.split(':').map(|p| p.parse::<f64>().ok());
    let (hh, mm) = (c.next()??, c.next()??);
    let ss = c.next().flatten().unwrap_or(0.0);
    // Days from civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days as f64 * 24.0 + hh + mm / 60.0 + ss / 3600.0)
}

fn r1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

/// Lead time in hours: arrival minus model completion.
fn lead(i: &Impact) -> Option<f64> {
    Some(hours(&i.arrival_time)? - hours(&i.model_completion_time)?)
}

/// The briefing's "spaceWeather" object. `rad_onset` is the measured storm onset, for the May 2024 summary.
pub fn briefing(cache: &Cache, sky_time: &str, rad_onset: Option<&str>) -> Result<Value, String> {
    let sky = hours(sky_time).ok_or_else(|| format!("cannot read sky time {sky_time:?}"))?;
    let w = &cache.windows.before_sky_time;
    let mut near: Vec<(f64, &Impact)> = w
        .mars_impacts
        .iter()
        .filter_map(|i| Some((hours(&i.arrival_time)? - sky, i)))
        .filter(|(dh, _)| dh.abs() <= WINDOW_HOURS)
        .collect();
    // Nearest arrival first; for the same arrival, the earliest forecast (longest lead) first.
    near.sort_by(|a, b| a.0.abs().total_cmp(&b.0.abs()).then(lead(b.1).unwrap_or(0.0).total_cmp(&lead(a.1).unwrap_or(0.0))));
    let nearest = near.first().map(|&(dh, i)| {
        json!({
            "arrivalTime": i.arrival_time,
            "hoursFromSkyTime": r1(dh),
            "isGlancingBlow": i.is_glancing_blow,
            "modelCompletionTime": i.model_completion_time,
            "leadHours": lead(i).map(r1),
            "link": i.link,
        })
    });
    Ok(json!({
        "source": "NASA CCMC DONKI WSA-Enlil simulations, impacts at Mars (data/cache/donki_mars.json)",
        "windowHours": WINDOW_HOURS,
        "searched": format!("{} to {}", w.start_date, w.end_date),
        "marsArrivals": near.len(),
        "nearest": nearest,
        "may2024": may_summary(&cache.windows.may2024, rad_onset),
    }))
}

/// One line on the May 2024 forecasts, and how they compare with the measured onset.
fn may_summary(w: &Window, rad_onset: Option<&str>) -> String {
    let n = w.mars_impacts.len();
    if n == 0 {
        return format!("{} simulations from {} to {}: no Mars arrivals forecast", w.simulations, w.start_date, w.end_date);
    }
    let glancing = w.mars_impacts.iter().filter(|i| i.is_glancing_blow == Some(true)).count();
    let leads: Vec<f64> = w.mars_impacts.iter().filter_map(lead).collect();
    let (lo, hi) = leads.iter().fold((f64::MAX, f64::MIN), |(a, b), &v| (a.min(v), b.max(v)));
    let day = |t: &str| t.get(..10).unwrap_or(t).to_string();
    let first = &w.mars_impacts.first().unwrap().arrival_time;
    let last = &w.mars_impacts.last().unwrap().arrival_time;
    let mut line = format!(
        "{} simulations forecast {} Mars arrivals ({} glancing) between {} and {}, {:.0} to {:.0} hours ahead",
        w.simulations, n, glancing, day(first), day(last), lo, hi
    );
    if let Some(onset) = rad_onset.and_then(|o| Some((o, hours(o)?))) {
        let closest = w.mars_impacts.iter().filter_map(|i| Some((hours(&i.arrival_time)? - onset.1, i))).min_by(|a, b| a.0.abs().total_cmp(&b.0.abs()));
        if let Some((dh, i)) = closest {
            line += &format!(
                "; the closest to Curiosity's measured onset ({}) was {}, {:+.1} hours from it, forecast {:.0} hours ahead",
                onset.0,
                i.arrival_time,
                dh,
                lead(i).unwrap_or(f64::NAN)
            );
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hours_since_epoch() {
        assert_eq!(hours("1970-01-01T00:00Z"), Some(0.0));
        assert_eq!(hours("1970-01-02 06:30"), Some(30.5));
        // 2024 is a leap year: 29 February exists.
        assert_eq!(hours("2024-03-01T00:00Z").unwrap() - hours("2024-02-28T00:00Z").unwrap(), 48.0);
        let diff = hours("2026-11-14 19:40").unwrap() - hours("2026-11-13T12:00Z").unwrap();
        assert!((diff - (31.0 + 40.0 / 60.0)).abs() < 1e-9, "{diff}");
        assert!(hours("not a time").is_none());
    }

    fn impact(arrival: &str, done: &str) -> Impact {
        Impact { arrival_time: arrival.into(), is_glancing_blow: Some(false), model_completion_time: done.into(), link: None }
    }

    #[test]
    fn nearest_arrival_within_the_window() {
        let window = |impacts| Window { start_date: "a".into(), end_date: "b".into(), simulations: 3, mars_impacts: impacts };
        let cache = Cache {
            windows: Windows {
                may2024: window(vec![]),
                before_sky_time: window(vec![
                    impact("2026-11-10T00:00Z", "2026-11-08T00:00Z"), // 115.7 h before: outside
                    impact("2026-11-16T19:40Z", "2026-11-14T00:00Z"), // 48 h after
                    impact("2026-11-13T19:40Z", "2026-11-12T19:40Z"), // 24 h before, 24 h lead
                ]),
            },
        };
        let b = briefing(&cache, "2026-11-14 19:40", None).unwrap();
        assert_eq!(b["marsArrivals"], 2);
        assert_eq!(b["nearest"]["hoursFromSkyTime"], -24.0);
        assert_eq!(b["nearest"]["leadHours"], 24.0);
    }
}
