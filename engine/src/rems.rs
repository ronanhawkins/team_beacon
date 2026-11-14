//! Conditions at Gale for the briefing, from Curiosity's REMS weather feed
//! (data/cache/rems.json, written by tools/fetch_rems.py), and the local Mars
//! time of the sky time, to compare with the feed's sunrise and sunset.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::space;

#[derive(Deserialize)]
pub struct Cache {
    pub source: String,
    pub disclaimer: String,
    /// Newest first, as the feed's strings.
    pub soles: Vec<serde_json::Map<String, Value>>,
}

/// Local Mars time at a site: areocentric solar longitude, and mean and true solar time in hours.
pub struct MarsTime {
    pub ls: f64,
    pub lmst: f64,
    pub ltst: f64,
}

/// Mars24 algorithm (Allison and McEwen 2000; NASA GISS Mars24). `unix_hours` is UTC hours since 1970;
/// `lon_east` is the site's east longitude in degrees.
pub fn mars_time(unix_hours: f64, lon_east: f64) -> MarsTime {
    const TT_MINUS_UTC_S: f64 = 69.184; // 37 leap seconds + 32.184
    let jd_tt = unix_hours / 24.0 + 2_440_587.5 + TT_MINUS_UTC_S / 86_400.0;
    let dt = jd_tt - 2_451_545.0;
    let m = (19.3871 + 0.524_020_73 * dt).to_radians();
    let alpha_fms = 270.3871 + 0.524_038_496 * dt;
    let pbs: f64 = [
        (0.0071, 2.2353, 49.409),
        (0.0057, 2.7543, 168.173),
        (0.0039, 1.1177, 191.837),
        (0.0037, 15.7866, 21.736),
        (0.0021, 2.1354, 15.704),
        (0.0020, 2.4694, 95.528),
        (0.0018, 32.8493, 49.095),
    ]
    .iter()
    .map(|&(a, tau, phi): &(f64, f64, f64)| a * (0.985_626 * dt / tau + phi).to_radians().cos())
    .sum();
    let v_minus_m = (10.691 + 3.0e-7 * dt) * m.sin() + 0.623 * (2.0 * m).sin() + 0.050 * (3.0 * m).sin()
        + 0.005 * (4.0 * m).sin() + 0.0005 * (5.0 * m).sin() + pbs;
    let ls = (alpha_fms + v_minus_m).rem_euclid(360.0);
    let l = ls.to_radians();
    let eot_deg = 2.861 * (2.0 * l).sin() - 0.071 * (4.0 * l).sin() + 0.002 * (6.0 * l).sin() - v_minus_m;
    let msd = (jd_tt - 2_451_549.5) / 1.027_491_251_7 + 44_796.0 - 0.000_962_6;
    let mtc = (24.0 * msd).rem_euclid(24.0);
    let lmst = (mtc + lon_east / 15.0).rem_euclid(24.0);
    MarsTime { ls, lmst, ltst: (lmst + eot_deg / 15.0).rem_euclid(24.0) }
}

/// "17:08" from hours.
pub fn clock(h: f64) -> String {
    let minutes = (h * 60.0).round() as i64;
    format!("{:02}:{:02}", minutes.div_euclid(60).rem_euclid(24), minutes.rem_euclid(60))
}

/// Hours from "18:51".
fn hours_of(text: &str) -> Option<f64> {
    let (h, m) = text.split_once(':')?;
    Some(h.trim().parse::<f64>().ok()? + m.trim().parse::<f64>().ok()? / 60.0)
}

/// The briefing's "conditions", and a one-line sanity check of the feed's sunset against the sky time.
/// `cache_path` is how the cache file is named in the source line (data/cache/rems.json at Gale).
pub fn briefing(cache: &Cache, sky_time: &str, lon_east: f64, cache_path: &str) -> Result<(Value, String), String> {
    let latest = cache.soles.first().ok_or("rems.json has no sols")?;
    let text = |k: &str| latest.get(k).and_then(|v| v.as_str()).filter(|s| !s.is_empty() && *s != "--").map(str::to_string);
    let num = |k: &str| text(k).and_then(|s| s.parse::<f64>().ok());
    let sky = space::hours(sky_time).ok_or_else(|| format!("cannot read sky time {sky_time:?}"))?;
    let local = mars_time(sky, lon_east);
    let earth_date = text("terrestrial_date");
    let days_before = earth_date.as_deref().and_then(|d| space::hours(&format!("{d} 12:00"))).map(|h| ((sky - h) / 24.0).round());
    let sunset = text("sunset");
    let conditions = json!({
        "source": format!("Curiosity REMS weather feed, {} ({cache_path})", cache.source),
        "disclaimer": cache.disclaimer,
        "sol": num("sol").map(|v| v as i64),
        "earthDate": earth_date,
        "daysBeforeSkyTime": days_before,
        "minAirTempC": num("min_temp"),
        "maxAirTempC": num("max_temp"),
        "minGroundTempC": num("min_gts_temp"),
        "maxGroundTempC": num("max_gts_temp"),
        "pressurePa": num("pressure"),
        "uvIndex": text("local_uv_irradiance_index"),
        "opacity": text("atmo_opacity"),
        "sunrise": text("sunrise"),
        "sunset": sunset,
        "season": text("season"),
        "ls": num("ls"),
        "skyTimeLocal": { "lmst": clock(local.lmst), "ltst": clock(local.ltst), "ls": (local.ls * 10.0).round() / 10.0 },
    });
    let gap = sunset.as_deref().and_then(hours_of).map(|s| format!(", {:.0} min before the feed's sunset in mean solar time", (s - local.lmst) * 60.0)).unwrap_or_default();
    let line = format!(
        "REMS sol {} ({}, {} days before the sky time): sunrise {}, sunset {} local. Sky time {} UT is {} LMST / {} LTST at the site (Ls {:.1}){}",
        text("sol").unwrap_or_else(|| "?".into()),
        conditions["earthDate"].as_str().unwrap_or("?"),
        days_before.map_or("?".into(), |d| format!("{d:.0}")),
        text("sunrise").unwrap_or_else(|| "?".into()),
        sunset.as_deref().unwrap_or("?"),
        sky_time,
        clock(local.lmst),
        clock(local.ltst),
        local.ls,
        gap
    );
    Ok((conditions, line))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mars24_reference_values() {
        // Mars24's epoch: MSD 44796.0 at 2000-01-06 00:00 TT (Allison and McEwen 2000).
        let at = |t: &str| space::hours(t).unwrap();
        // mars_time adds TT - UTC itself, so pass the UTC that gives that TT.
        let mt = mars_time(at("2000-01-06T00:00Z") - 69.184 / 3600.0, 0.0);
        // At lon 0 the mean solar time is the MTC: 24 * frac(44796.0 - 0.0009626) hours.
        assert!((mt.lmst - (24.0 - 0.000_962_6 * 24.0)).abs() < 0.01, "{}", mt.lmst);
        // The REMS feed gives Ls 341 for 2026-08-25 at Gale.
        let aug = mars_time(at("2026-08-25T12:00Z"), 137.353);
        assert!((aug.ls - 341.0).abs() < 1.0, "Ls {}", aug.ls);
    }

    #[test]
    fn clock_wraps() {
        assert_eq!(clock(17.1333), "17:08");
        assert_eq!(clock(23.999), "00:00");
    }
}
