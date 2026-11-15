import './style.css';
import fakeRoute from '../../shared/fake/waypoints.json';
import fakeState from '../../shared/fake/state.json';
import { validateRoute, validateState, resolveSelection, scenePoint, reduceDemoState } from '../../shared/model.js';
import { connectRelay, relayUrl } from '../../shared/socket.js';
import { createScene } from './scene.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let timer;
function message(text) {
  $('message').textContent = text; $('message').hidden = false; clearTimeout(timer);
  timer = setTimeout(() => { $('message').hidden = true; }, 7000);
}
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  return response.json();
}

async function start() {
  const hosted = location.pathname.startsWith('/headset/') && !params.has('waypoints') && !params.has('relay') && params.get('standalone') !== '1';
  const session = hosted ? await fetchJson('/session.json') : null;
  const external = params.has('waypoints') || Boolean(session);
  const live = external || params.has('relay');
  const standalone = !live && (params.get('standalone') === '1' || import.meta.env.MODE === 'standalone');
  if (external && !session && !params.has('relay')) throw new Error('An external waypoint file needs its matching relay. Add ?waypoints=/data/out/waypoints.json&relay=ws://localhost:PORT/PATH');
  let route = validateRoute(external ? await fetchJson(session?.waypoints || params.get('waypoints')) : fakeRoute);
  // A new plan from the hub replaces the route (state.plan.routeId, shared/state.md): fetch it again and carry on.
  let routeId = session?.planId ?? null, pendingState = null;
  const dataLabel = !external || session?.synthetic || route.source?.kind === 'synthetic' ? 'SYNTHETIC DATA' : route.source?.kind === 'terrain-derived' ? 'TERRAIN DATA' : 'EXTERNAL DATA';
  let state = standalone ? validateState(fakeState, route) : null;
  let status = standalone ? 'local' : 'connecting';
  let selection = state ? resolveSelection(state, route) : null;
  let history = selection, routeError = '', routeKey = '';
  const view = createScene($('scene'), scenePoint(route.main[0]));
  document.querySelector('.brand').href = hosted ? '/hub/' : '/apps/headset/';
  let helmetPreview = false;
  function setHelmetPreview(enabled) {
    helmetPreview = enabled;
    document.body.classList.toggle('helmet-preview', enabled);
    $('helmet-preview').textContent = enabled ? 'Exit helmet preview' : 'Preview helmet on laptop';
    $('helmet-preview').setAttribute('aria-pressed', String(enabled));
    $('view-mode').textContent = enabled ? 'LAPTOP HELMET SIMULATION' : 'DESKTOP PREVIEW';
    view.setDesktopHud(enabled);
  }
  $('helmet-preview').addEventListener('click', () => setHelmetPreview(!helmetPreview));
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && helmetPreview) setHelmetPreview(false); });
  setHelmetPreview(params.get('helmet') === '1');
  view.setSpatialValid(Boolean(selection));
  $('data-badge').textContent = dataLabel;
  $('data-note').textContent = external
    ? `${dataLabel} · Shared v1 waypoint file. Mission values come from the selected relay. Align site north manually.`
    : 'SYNTHETIC MISSION · Ronan’s shared demo route and skylines. NASA terrain is not used to calculate these values.';
  if (standalone) {
    $('control-help').textContent = 'This browser only · no connection to other screens';
    $('play-tour').hidden = false;
  }
  if (live) {
    $('control-help').textContent = 'Route changes are controlled by the hub';
    document.querySelector('.control-label .eyebrow').textContent = 'ASTRONAUT CONTROL';
    document.querySelectorAll('[data-action]').forEach(button => { button.hidden = button.dataset.action !== 'requestReroute'; });
    document.querySelector('.divider').hidden = true;
  }

  function draw() {
    const online = status === 'connected' || status === 'local';
    const ready = online && Boolean(state);
    view.setState(state, status, dataLabel, routeError);
    view.setSpatialValid(Boolean(selection));
    $('connection').textContent = status === 'local' ? 'BROWSER DEMO' : status === 'connected' ? (state ? 'RELAY CONNECTED' : 'WAITING FOR STATE') : status === 'connecting' ? 'CONNECTING' : 'RELAY OFFLINE';
    $('connection').className = `chip ${ready ? 'connected' : status}`;
    document.querySelectorAll('[data-action]').forEach(button => { button.disabled = !ready; });
    $('route-kind').textContent = state?.route === 'reroute' ? 'SHELTER REROUTE' : 'PLANNED WALK';
    $('waypoint-name').textContent = selection ? scenePoint(selection.point).name : routeError ? 'Route needs identification' : 'Waiting for route…';
    $('waypoint-number').textContent = selection ? `${String(selection.index + 1).padStart(2, '0')} / ${String(selection.points.length).padStart(2, '0')}` : '—';
    const key = selection ? `${selection.route}:${selection.origin}:${selection.points.length}` : '';
    if (key !== routeKey) {
      routeKey = key;
      $('route-stops').replaceChildren(...(selection?.points || []).map(point => {
        const el = document.createElement('span'); el.className = 'route-stop'; el.title = point.label || point.id; return el;
      }));
    }
    document.querySelectorAll('.route-stop').forEach((el, i) => el.classList.toggle('active', Boolean(selection) && i <= selection.index));
    document.body.classList.toggle('storm', state?.mode === 'storm' || Boolean(state?.storm || state?.panic));
    document.body.classList.toggle('warning', state?.mode === 'warning');
    if (!state) {
      $('alert-title').textContent = 'Waiting for telemetry';
      $('alert-copy').textContent = 'No mission values have been received.';
      return;
    }
    $('open-sky').textContent = (state.openSky * 100).toFixed(0);
    $('blocked-sky').textContent = `${((1 - state.openSky) * 100).toFixed(1)}% terrain-blocked sky`;
    $('shelter-time').textContent = state.minutesToShelter.toFixed(1);
    $('oxygen').textContent = (state.oxygenFraction * 100).toFixed(0);
    $('dose').textContent = (state.doseFraction * 100).toFixed(1);
    $('contact').textContent = state.baseLink ? 'Clear' : 'Blocked';
    $('contact-dot').style.background = state.baseLink ? '#c5f28d' : '#ff9f7a';
    $('earth-contact').textContent = `Earth ${state.earthLink ? 'clear' : 'blocked'} · ${state.earthDelayMinutes} min one-way`;
    $('oxygen-bar').style.width = `${state.oxygenFraction * 100}%`;
    $('sunlight').textContent = state.sunlit ? 'SUNLIT' : 'IN SHADOW';
    $('alert-title').textContent = !online ? 'Relay disconnected' : routeError ? 'Skyline unavailable' : state.mode === 'storm' ? (state.panic ? 'Panic alert · shelter route' : 'Storm alert · shelter route') : state.mode === 'warning' ? 'Route warning' : selection?.point.isShelter ? 'Shelter reached' : 'Nominal conditions';
    $('alert-copy').textContent = !online ? 'Values may be stale. Reconnecting…' : routeError ? 'Waiting for the relay to identify this reroute.' : selection?.point.isShelter ? 'Shelter reached. Wait here while the alert is active.' : state.mode === 'warning' ? (!state.baseLink ? 'Base contact blocked. Check the shelter bearing.' : 'Shelter time exceeds the relay’s warning limit.') : state.route === 'reroute' ? 'Follow the shelter bearing. The hub advances the route.' : 'Keep the shelter bearing in view.';
    $('storm-button').textContent = state.storm ? '◉ Clear storm' : '◉ Trigger storm';
    $('storm-button').setAttribute('aria-pressed', String(state.storm));
    document.querySelector('[data-action="back"]').disabled = !ready || !selection || selection.index === 0;
    document.querySelector('[data-action="next"]').disabled = !ready || !selection || selection.index === selection.points.length - 1;
  }

  let siteId = null;
  function applyState(next) {
    // The hub's planet view switched the relay to another site: reload so terrain, route and layers all change.
    if (next.site && siteId && next.site !== siteId) { location.reload(); return; }
    if (next.site) siteId = next.site;
    const nextRouteId = next.plan?.routeId ?? null;
    if (session && nextRouteId !== routeId) {
      routeId = nextRouteId; pendingState = next;
      fetchJson(session.waypoints).then(doc => {
        route = validateRoute(doc); history = selection = null; routeKey = ''; message('New route from the hub planner.');
        const latest = pendingState; pendingState = null; if (latest) applyState(latest);
      }).catch(error => { pendingState = null; message(`Could not load the new route: ${error.message}`); });
      return;
    }
    if (pendingState) { pendingState = next; return; }
    validateState(next, route);
    state = next;
    try {
      const resolved = resolveSelection(next, route, history);
      if (resolved.point.id !== selection?.point.id) view.setWaypoint(scenePoint(resolved.point));
      history = selection = resolved; routeError = '';
    } catch (error) {
      selection = null; routeError = error.message; message(routeError);
    }
    draw();
  }
  draw();
  const endpoint = new URL(params.get('relay') || relayUrl());
  if (!['ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('Relay address must use ws:// or wss://');
  if (location.protocol === 'https:' && endpoint.protocol !== 'wss:') throw new Error('An HTTPS headset page needs a secure wss:// relay.');
  const relay = standalone ? {
    send(event) { applyState(reduceDemoState(state, event, route, fakeState)); return true; }, close() {},
  } : connectRelay({ url: endpoint.href, role: 'headset', onState: applyState, onError: message,
    onStatus(next) { status = next; if (next === 'connected') history = null; draw(); },
  });

  let tour, tourIndex = 0;
  $('play-tour').addEventListener('click', () => {
    if (tour) { clearInterval(tour); tour = null; $('play-tour').textContent = 'Play headset tour'; return; }
    relay.send({ type: 'reset' }); tourIndex = 0; $('play-tour').textContent = 'Stop headset tour';
    const sequence = [{ type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'storm', on: true }, { type: 'next' }, { type: 'next' }, { type: 'reset' }];
    tour = setInterval(() => relay.send(sequence[tourIndex++ % sequence.length]), 8000);
    message('Tour started. Enter AR or VR; the demo changes every 8 seconds.');
  });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    const event = { type: button.dataset.action };
    if (event.type === 'storm') event.on = !state.storm;
    if (!relay.send(event)) message('Relay disconnected. Wait for it to reconnect.');
  }));
  $('align-north').addEventListener('click', () => { view.alignNorth(); message('Your viewing direction is now site north. This is manual alignment, not a compass reading.'); });
  async function checkXR() {
    const secure = window.isSecureContext;
    if (!secure || !navigator.xr) { $('xr-help').textContent = secure ? 'Open this page in the Quest browser to enter AR or VR.' : 'Headset mode needs localhost via USB or HTTPS. A plain laptop IP will not work.'; return; }
    const support = await Promise.allSettled(['immersive-ar', 'immersive-vr'].map(mode => navigator.xr.isSessionSupported(mode)));
    ['enter-ar', 'enter-vr'].forEach((id, i) => { $(id).disabled = !(support[i].status === 'fulfilled' && support[i].value); });
    $('xr-help').textContent = support.some(r => r.status === 'fulfilled' && r.value) ? 'Face site north before entering. Controller trigger realigns north.' : 'Desktop preview ready. Open this page in the Quest browser for AR or VR.';
  }
  for (const [id, mode] of [['enter-ar', 'immersive-ar'], ['enter-vr', 'immersive-vr']]) {
    $(id).addEventListener('click', async () => {
      $('enter-ar').disabled = true; $('enter-vr').disabled = true;
      try { await view.enter(mode); $('view-mode').textContent = mode === 'immersive-ar' ? 'AR PASSTHROUGH' : 'IMMERSIVE VR'; }
      catch (error) { message(`Headset session could not start: ${error.message}`); await checkXR(); }
    });
  }
  $('scene').addEventListener('xr-ended', () => { setHelmetPreview(helmetPreview); checkXR(); });
  window.addEventListener('pagehide', () => { relay.close(); clearInterval(tour); }, { once: true });
  await checkXR();
}
start().catch(error => {
  $('fatal-error').hidden = false;
  $('fatal-error').textContent = `Beacon could not start\n\n${error.message}\n\nCheck the waypoint file and relay address, then reload.`;
  console.error(error);
});
