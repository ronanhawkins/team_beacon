import './style.css';
import fakeRoute from '../../shared/fake-waypoints.json';
import fakeState from '../../shared/fake-state.json';
import { validateRoute, validateState, openSkyPct, reduceDemoState } from '../../shared/model.js';
import { connectRelay, relayUrl } from '../../shared/socket.js';
import { createScene } from './scene.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let timer;
function message(text) { $('message').textContent=text;$('message').hidden=false;clearTimeout(timer);timer=setTimeout(()=>{$('message').hidden=true;},7000); }
async function fetchJson(url) { const response=await fetch(url);if(!response.ok)throw new Error(`Cannot load ${url}: HTTP ${response.status}`);return response.json(); }

async function start() {
  const external = params.has('waypoints');
  const standalone = !external && !params.has('relay') && (params.get('standalone')==='1' || import.meta.env.MODE==='standalone');
  if(external && !params.has('relay')) throw new Error('A real waypoint file needs its matching relay. Add ?waypoints=/data/waypoints.json&relay=wss://your-relay/relay');
  const route=validateRoute(external?await fetchJson(params.get('waypoints')):fakeRoute);
  const demo=route.source.kind==='synthetic';
  let state=external?null:validateState(fakeState,route), status='connecting';
  let point=route.waypoints.find(p=>p.id===state?.waypointId)||route.waypoints[0];
  const view=createScene($('scene'),point);
  if(standalone){
    status='local';
    $('control-help').textContent='This browser only · no laptop connection needed';
    $('data-note').textContent='STANDALONE DEMO · Synthetic data. Controls affect this browser only. Start the headset tour before entering AR or VR.';
    $('play-tour').hidden=false;
  }
  $('data-badge').textContent=demo?'DEMO DATA':'TERRAIN DATA';
  if(external) {
    $('data-note').textContent=demo?'EXTERNAL SYNTHETIC ROUTE · Waiting for relay telemetry.':'TERRAIN-DERIVED SKYLINE · Awaiting live telemetry. Site north requires manual alignment.';
    $('control-help').textContent='Presenter controls use the selected relay';
    document.querySelector('.control-label .eyebrow').textContent='RELAY CONTROLS';
    document.querySelector('[data-action="panic"]').textContent='Request reroute';
  }
  $('route-stops').replaceChildren(...route.waypoints.map(p=>{const el=document.createElement('span');el.className='route-stop';el.title=p.name;return el;}));
  function draw() {
    const index=route.waypoints.findIndex(p=>p.id===point.id);
    $('waypoint-name').textContent=point.name;
    $('waypoint-number').textContent=`${String(index+1).padStart(2,'0')} / ${String(route.waypoints.length).padStart(2,'0')}`;
    document.querySelectorAll('.route-stop').forEach((el,i)=>el.classList.toggle('active',i<=index));
    const open=openSkyPct(point.skylineDeg);$('open-sky').textContent=open.toFixed(0);$('blocked-sky').textContent=`${(100-open).toFixed(1)}% terrain-blocked sky`;
    const ready=status==='connected'||status==='local';
    $('connection').textContent=status==='local'?'BROWSER DEMO':status==='connected'?'RELAY CONNECTED':status==='connecting'?'CONNECTING':'RELAY OFFLINE';$('connection').className=`chip ${ready?'connected':status}`;
    document.querySelectorAll('[data-action]').forEach(button=>{button.disabled=!ready;});
    if(!state){$('alert-title').textContent='Waiting for telemetry';$('alert-copy').textContent='No mission values have been received.';return;}
    view.setState(state,status,demo);
    document.body.classList.toggle('storm',state.storm);
    $('shelter-time').textContent=state.minutesToShelter.toFixed(1);$('oxygen').textContent=state.oxygenPct.toFixed(0);$('dose').textContent=state.doseMicroSv.toFixed(0);
    $('contact').textContent=state.contact==='clear'?'Clear':'Blocked';$('contact-dot').style.background=state.contact==='clear'?'#c5f28d':'#ff9f7a';$('oxygen-bar').style.width=`${state.oxygenPct}%`;
    $('alert-title').textContent=!ready?'Relay disconnected':state.storm?'Storm alert · seek shelter':'Nominal conditions';
    $('alert-copy').textContent=!ready?'Values may be stale. Reconnecting…':state.storm?'Follow the pulsing shelter marker.':'Keep the shelter marker in view.';
    $('storm-button').textContent=state.storm?'◉ Clear storm':'◉ Trigger storm';$('storm-button').setAttribute('aria-pressed',String(state.storm));
    document.querySelector('[data-action="back"]').disabled=!ready||index===0;
    document.querySelector('[data-action="next"]').disabled=!ready||index===route.waypoints.length-1;
  }
  draw();
  const endpoint=new URL(params.get('relay')||relayUrl());
  if(!['ws:','wss:'].includes(endpoint.protocol))throw new Error('Relay address must use ws:// or wss://');
  if(location.protocol==='https:' && endpoint.protocol!=='wss:')throw new Error('An HTTPS headset page needs a secure wss:// relay.');
  let lastSequence=-1;
  function applyState(next) {
      validateState(next,route);
      if(next.sequence<=lastSequence)return;
      lastSequence=next.sequence;state=next;
      const nextPoint=route.waypoints.find(p=>p.id===state.waypointId);
      if(nextPoint.id!==point.id){point=nextPoint;view.setWaypoint(point);}
      draw();
  }
  const relay=standalone?{
    send(action){applyState(reduceDemoState(state,{action},route,fakeState));return true;},close(){},
  }:connectRelay({url:endpoint.href,
    onState:applyState,
    onStatus(next){status=next;if(next==='connected')lastSequence=-1;draw();},
    onError:message,
  });
  let tour, tourIndex=0;
  $('play-tour').addEventListener('click',()=>{
    if(tour){clearInterval(tour);tour=null;$('play-tour').textContent='Play headset tour';return;}
    relay.send('reset');tourIndex=0;$('play-tour').textContent='Stop headset tour';
    const sequence=['next','next','storm','panic','reset'];
    tour=setInterval(()=>{relay.send(sequence[tourIndex++%sequence.length]);},8000);
    message('Tour started. Enter AR or VR; the demo changes every 8 seconds.');
  });
  document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{
    if(!relay.send(button.dataset.action))message('Relay disconnected. Wait for it to reconnect.');
  }));
  $('align-north').addEventListener('click',()=>{view.alignNorth();message('Your current viewing direction is now site north. This is manual alignment, not a compass reading.');});
  async function checkXR() {
    const secure=window.isSecureContext;
    if(!secure || !navigator.xr){$('xr-help').textContent=secure?'Open this page in the Quest browser to enter AR or VR.':'Headset mode needs HTTPS or localhost via the USB connection. A plain laptop IP will not work.';return;}
    const support=await Promise.allSettled(['immersive-ar','immersive-vr'].map(mode=>navigator.xr.isSessionSupported(mode)));
    ['enter-ar','enter-vr'].forEach((id,i)=>{$(id).disabled=!(support[i].status==='fulfilled'&&support[i].value);});
    $('xr-help').textContent=support.some(r=>r.status==='fulfilled'&&r.value)?'Face your chosen site north before entering. Controller trigger realigns north.':'Desktop preview ready. Open the page in the Quest browser for AR or VR.';
  }
  for(const [id,mode] of [['enter-ar','immersive-ar'],['enter-vr','immersive-vr']]) {
    $(id).addEventListener('click',async()=>{
      $('enter-ar').disabled=true;$('enter-vr').disabled=true;
      try {await view.enter(mode);$('view-mode').textContent=mode==='immersive-ar'?'AR PASSTHROUGH':'IMMERSIVE VR';}
      catch(error){message(`Headset session could not start: ${error.message}`);await checkXR();}
    });
  }
  $('scene').addEventListener('xr-ended',()=>{$('view-mode').textContent='DESKTOP PREVIEW';checkXR();});
  window.addEventListener('pagehide',()=>{relay.close();clearInterval(tour);},{once:true});
  await checkXR();
}
start().catch(error=>{$('fatal-error').hidden=false;$('fatal-error').textContent=`Beacon could not start\n\n${error.message}\n\nCheck the waypoint file and relay address, then reload.`;console.error(error);});
