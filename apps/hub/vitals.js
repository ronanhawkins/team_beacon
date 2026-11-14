// Astronaut status: body, life support, exposure and the wristband.
//
// Wrist values (heart rate, SpO2, skin temperature, battery) come from the relay state when the wrist sends them;
// until then, with cfg.simulate on, the hub makes plausible ones and marks them simulated.
// Life support (CO2, water, cooling, suit temperature, suit battery) is modelled here, driven by the metabolic
// rate estimated from heart rate, so a hard climb uses supplies faster. Oxygen, dose and open sky come from the
// engine through the relay state. No drawing here; main.js draws ITEMS.
//
// Every limit is a demo assumption set in config.js (VITALS), not a medical or suit specification.

export const GROUPS = [
  { id: 'body', label: 'Body' },
  { id: 'life', label: 'Life support' },
  { id: 'exposure', label: 'Exposure' },
  { id: 'wrist', label: 'Wristband' },
];

// One row per tracked value. `level(v, c)` gives 'ok', 'caution' or 'alarm'; `limit(c)` describes the alert in words.
// `range` is the y range of the trend line.
export const ITEMS = [
  { key: 'hr', group: 'body', label: 'Heart rate', unit: 'bpm', d: 0, range: [50, 190],
    level: (v, c) => (v > c.hrAlarm ? 'alarm' : v > c.hrHigh ? 'caution' : 'ok'), limit: (c) => `Caution above ${c.hrHigh}, alarm above ${c.hrAlarm}`, line: (c) => c.hrHigh },
  { key: 'spo2', group: 'body', label: 'Blood oxygen (SpO2)', unit: '%', pct: true, d: 0, range: [0.85, 1],
    level: (v, c) => (v < c.spo2Alarm ? 'alarm' : v < c.spo2Low ? 'caution' : 'ok'), limit: (c) => `Caution below ${c.spo2Low * 100}%`, line: (c) => c.spo2Low },
  { key: 'skinTemp', group: 'body', label: 'Skin temperature', unit: '°C', d: 1, range: [30, 40],
    level: (v, c) => (v > c.skinTempHigh ? 'caution' : 'ok'), limit: (c) => `Caution above ${c.skinTempHigh} °C`, line: (c) => c.skinTempHigh },
  { key: 'metW', group: 'body', label: 'Metabolic rate', unit: 'W', d: 0, range: [80, 700], note: 'Estimated from heart rate',
    level: (v, c) => (v > c.metHighW ? 'caution' : 'ok'), limit: (c) => `Caution above ${c.metHighW} W`, line: (c) => c.metHighW },

  { key: 'oxygen', group: 'life', label: 'Oxygen', unit: '%', pct: true, d: 0, range: [0, 1], supply: true,
    level: (v, c) => (v < c.supplyAlarm ? 'alarm' : v < c.supplyLow ? 'caution' : 'ok'), limit: (c) => `Caution below ${c.supplyLow * 100}%` },
  { key: 'co2', group: 'life', label: 'CO2 in helmet', unit: 'mmHg', d: 1, range: [0, 12],
    level: (v, c) => (v > c.co2Alarm ? 'alarm' : v > c.co2High ? 'caution' : 'ok'), limit: (c) => `Caution above ${c.co2High} mmHg`, line: (c) => c.co2High },
  { key: 'cooling', group: 'life', label: 'Cooling water', unit: '%', pct: true, d: 0, range: [0, 1], supply: true,
    level: (v, c) => (v < c.supplyAlarm ? 'alarm' : v < c.supplyLow ? 'caution' : 'ok'), limit: (c) => `Caution below ${c.supplyLow * 100}%` },
  { key: 'drink', group: 'life', label: 'Drinking water', unit: '%', pct: true, d: 0, range: [0, 1], supply: true,
    level: (v, c) => (v < c.supplyAlarm ? 'alarm' : v < c.supplyLow ? 'caution' : 'ok'), limit: (c) => `Caution below ${c.supplyLow * 100}%` },
  { key: 'suitTemp', group: 'life', label: 'Suit temperature', unit: '°C', d: 1, range: [16, 36],
    level: (v, c) => (v > c.suitTempAlarm ? 'alarm' : v > c.suitTempHigh ? 'caution' : 'ok'), limit: (c) => `Caution above ${c.suitTempHigh} °C`, line: (c) => c.suitTempHigh },
  { key: 'suitBattery', group: 'life', label: 'Suit battery', unit: '%', pct: true, d: 0, range: [0, 1], supply: true,
    level: (v, c) => (v < c.supplyAlarm ? 'alarm' : v < c.supplyLow ? 'caution' : 'ok'), limit: (c) => `Caution below ${c.supplyLow * 100}%` },

  { key: 'dose', group: 'exposure', label: 'Dose so far', unit: '% of budget', pct: true, d: 0, range: [0, 1],
    level: (v) => (v > 1 ? 'alarm' : v > 0.8 ? 'caution' : 'ok'), limit: () => 'Caution above 80% of the walk budget' },
  { key: 'openSky', group: 'exposure', label: 'Open sky here', unit: '%', pct: true, d: 0, range: [0, 1], note: 'Lower is better shielded',
    level: () => 'ok', limit: () => 'Sets the dose rate' },
  { key: 'sunlit', group: 'exposure', label: 'Sunlight', unit: '', bool: ['In sunlight', 'In shadow'],
    level: () => 'ok', limit: () => 'Affects suit heating' },

  { key: 'battery', group: 'wrist', label: 'Wristband battery', unit: '%', pct: true, d: 0, range: [0, 1],
    level: (v, c) => (v < c.batteryLow ? 'caution' : 'ok'), limit: (c) => `Caution below ${c.batteryLow * 100}%`, line: (c) => c.batteryLow },
  { key: 'linkAge', group: 'wrist', label: 'Last wrist update', unit: 's ago', d: 0,
    level: (v, c) => (v > c.staleSeconds ? 'caution' : 'ok'), limit: (c) => `Caution after ${c.staleSeconds} s without data` },
];

// The supplies that can run out, for the safety margin. `rate` is the fraction used per minute right now.
export const SUPPLIES = [
  { key: 'oxygen', label: 'Oxygen' }, { key: 'cooling', label: 'Cooling water' },
  { key: 'drink', label: 'Drinking water' }, { key: 'suitBattery', label: 'Suit battery' },
];

const RANK = { ok: 0, caution: 1, alarm: 2 };
export const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);

export function createVitals(c) {
  const hist = {}, t0 = Date.now();
  let bpm = 74, last = Date.now();
  const m = { cooling: 1, drink: 1, suitBattery: 1, co2: 2.0, suitTemp: 21.5, spo2: 0.98, skin: 33.2, leak: false, wristAt: null, wristKey: '' };
  const push = (k, v) => { if (v == null || typeof v !== 'number') return; const h = hist[k] || (hist[k] = []); h.push(v); if (h.length > c.historySeconds) h.shift(); };

  return {
    hist,
    get leak() { return m.leak; },
    setLeak(on) { m.leak = !!on; },
    reset() { Object.assign(m, { cooling: 1, drink: 1, suitBattery: 1, co2: 2.0, suitTemp: 21.5, leak: false }); for (const k of Object.keys(hist)) hist[k].length = 0; },

    // Call once a second. `real` holds what the relay state carries (any may be null);
    // `ctx` is { walking, effort 0..1, emergency, sunlit, shelterMin, oxygen, dose, openSky }.
    step(real, ctx) {
      const now = Date.now(), dtMin = Math.min(5, (now - last) / 60000); last = now;
      const sim = {};
      let hr = real.heartRate;
      if (hr == null && c.simulate) {
        const target = c.restHr + (ctx.walking ? 24 : 0) + ctx.effort * 22 + (ctx.emergency ? 46 : 0) + (m.suitTemp > c.suitTempHigh ? 18 : 0);
        bpm += (target - bpm) * 0.16 + (Math.random() - 0.5) * 3; hr = Math.round(bpm); sim.hr = true;
      }
      const metW = hr == null ? null : Math.max(c.restW, c.restW + (hr - c.restHr) * c.wPerBpm), load = (metW ?? c.nominalW) / c.nominalW;

      let spo2 = real.spo2;
      if (spo2 == null && c.simulate) { m.spo2 += (0.985 - Math.max(0, load - 1) * 0.012 - m.spo2) * 0.2 + (Math.random() - 0.5) * 0.003; spo2 = Math.min(1, m.spo2); sim.spo2 = true; }
      let skinTemp = real.skinTemp;
      if (skinTemp == null && c.simulate) { m.skin += (33.0 + Math.max(0, load - 1) * 0.9 + Math.max(0, m.suitTemp - 24) * 0.25 - m.skin) * 0.05; skinTemp = m.skin; sim.skinTemp = true; }
      let battery = real.battery;
      if (battery == null && c.simulate) { battery = Math.max(0.05, 0.86 - (now - t0) / 60000 * 0.004); sim.battery = true; }
      // seconds since the wrist values last changed; null while the wrist sends nothing
      const key = [real.heartRate, real.spo2, real.skinTemp, real.battery].join('|'), any = key !== '|||';
      if (any && key !== m.wristKey) { m.wristKey = key; m.wristAt = now; }
      const linkAge = any ? (now - m.wristAt) / 1000 : null;

      // life support model: use scales with metabolic load; a cooling leak drains the loop and the suit warms up
      const rates = {
        cooling: load / c.coolingMinutes + (m.leak ? c.leakPerMin : 0),
        drink: load / c.drinkMinutes,
        suitBattery: (0.6 + 0.4 * load) / c.suitBatteryMinutes,
      };
      m.cooling = Math.max(0, m.cooling - rates.cooling * dtMin);
      m.drink = Math.max(0, m.drink - rates.drink * dtMin);
      m.suitBattery = Math.max(0, m.suitBattery - rates.suitBattery * dtMin);
      m.co2 += (1.2 + 2.4 * load - m.co2) * 0.08 + (Math.random() - 0.5) * 0.08;
      const coolingWorks = m.cooling > 0.02 && m.suitBattery > 0.02;
      m.suitTemp += ((coolingWorks ? 21 + (load - 1) * 1.5 : 34) + (ctx.sunlit ? 0.6 : 0) - m.suitTemp) * (coolingWorks ? 0.06 : 0.02);

      // oxygen comes from the engine (fraction left on the walk); its rate scales with load from the full-tank time
      const oxygen = ctx.oxygen;
      rates.oxygen = load / c.oxygenMinutes;

      const v = { hr, spo2, skinTemp, metW, oxygen, co2: m.co2, cooling: m.cooling, drink: m.drink, suitTemp: m.suitTemp, suitBattery: m.suitBattery,
        dose: ctx.dose, openSky: ctx.openSky, sunlit: ctx.sunlit, battery, linkAge };
      for (const it of ITEMS) if (!it.bool) push(it.key, v[it.key]);

      // safety margin: the scarcest supply's minutes left at the current rate, less the minutes needed to reach shelter
      const left = SUPPLIES.map((s) => ({ ...s, frac: v[s.key], min: v[s.key] == null ? null : rates[s.key] > 0 ? v[s.key] / rates[s.key] : Infinity })).filter((s) => s.min != null);
      const scarce = left.reduce((a, b) => (b.min < a.min ? b : a), left[0] || null);
      const toSafety = ctx.shelterMin ?? 0, margin = scarce ? scarce.min - toSafety : null;

      const levels = {}; let overall = 'ok';
      for (const it of ITEMS) { const x = v[it.key]; levels[it.key] = x == null || it.bool ? 'ok' : it.level(x, c); overall = worse(overall, levels[it.key]); }
      const marginLevel = margin == null ? 'ok' : margin < 0 ? 'alarm' : margin < c.turnBackMin ? 'caution' : 'ok';
      overall = worse(overall, marginLevel);
      return { v, sim, levels, overall, left, scarce, toSafety, margin, marginLevel, rates, leak: m.leak };
    },
  };
}
