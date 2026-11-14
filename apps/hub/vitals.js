// Heart rate and wristband battery for the astronaut on the walk.
// Real values come from the relay state (read in route.js). Until the relay carries them, and when
// CONFIG.VITALS.simulate is on, the hub makes plausible values itself and labels them as simulated.
export function createVitals(cfg) {
  const hist = [], t0 = Date.now();
  let bpm = 74;
  return {
    hist,
    // Call once a second. `real` is { heartRate, battery } from the state, either may be missing.
    step(real, { walking, effort, emergency }) {
      let hr = real.heartRate, battery = real.battery, hrSim = false, batterySim = false;
      if (hr == null && cfg.simulate) {
        const target = 72 + (walking ? 24 : 0) + effort * 22 + (emergency ? 46 : 0);
        bpm += (target - bpm) * 0.16 + (Math.random() - 0.5) * 3; hr = Math.round(bpm); hrSim = true;
      }
      if (battery == null && cfg.simulate) { battery = Math.max(0.05, 0.86 - (Date.now() - t0) / 60000 * 0.004); batterySim = true; }
      if (hr != null) { hist.push(hr); if (hist.length > cfg.historySeconds) hist.shift(); }
      return { hr: hr ?? null, battery: battery ?? null, hrSim, batterySim };
    },
  };
}
