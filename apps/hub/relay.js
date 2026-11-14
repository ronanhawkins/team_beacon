// Link to the relay through the team's shared client, plus the events the hub sends (shared/events.md).
import { connect } from '/shared/client.js';

// `plan` is NOT in shared/events.md yet: it is a proposal (see README). The relay ignores unknown events.
export const events = {
  next: () => ({ type: 'next' }),
  back: () => ({ type: 'back' }),
  goto: (index) => ({ type: 'goto', index }),
  storm: (on) => ({ type: 'storm', on }),
  panic: () => ({ type: 'panic' }),
  reset: () => ({ type: 'reset' }),
  plan: (points) => ({ type: 'plan', points }),
};

// shared/client.js sends hello, reconnects by itself and hands over every state.
export function connectRelay({ role, url, onState, onStatus }) {
  const c = connect({ role, onState, onStatus: (up) => onStatus(up ? 'open' : 'closed'), url: url || undefined });
  return { kind: 'relay', send: (ev) => c.send(ev), close: () => c.close() };
}
