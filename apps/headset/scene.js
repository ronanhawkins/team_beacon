import * as THREE from 'three';
import { blendWaypoints, direction, openSkyPct, radians, sampleSkyline } from '../../shared/model.js';

const COLORS = { sun: '#ffce7a', earth: '#8bd7ff', base: '#d6dce8', shelter: '#c5f28d' };
const VERTICES = 360;
const RADIUS = 16;

function textSprite(text, color, width = 512, height = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = color; context.font = '500 40px Segoe UI, sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.shadowColor = '#061011'; context.shadowBlur = 10;
  context.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(3.6, .9, 1); sprite.renderOrder = 5;
  return sprite;
}

function bandGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((VERTICES + 1) * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const indices = [];
  for (let i = 0; i < VERTICES; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(indices);
  return geometry;
}

export function createScene(host, initialPoint) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  renderer.setClearColor(0x000000, 0);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(76, 1, .05, 150);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const world = new THREE.Group(); scene.add(world);
  let xrMode = null, needsAlignment = false, northYaw = 0;
  let yaw = -radians(55), pitch = radians(8);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vPosition; void main(){float h=normalize(vPosition).y;vec3 low=vec3(0.30,0.25,0.23);vec3 high=vec3(0.045,0.10,0.14);gl_FragColor=vec4(mix(low,high,smoothstep(-0.15,0.8,h)),1.0);}',
  })); world.add(sky);
  const blocked = new THREE.Mesh(bandGeometry(), new THREE.MeshBasicMaterial({ color: 0xa1b7a0, side: THREE.DoubleSide, transparent: true, opacity: .20, depthWrite: false }));
  blocked.frustumCulled = false; world.add(blocked);
  const land = new THREE.Mesh(bandGeometry(), new THREE.MeshBasicMaterial({ color: 0x252c2a, side: THREE.DoubleSide }));
  land.frustumCulled = false; world.add(land);
  const ringGeometry = new THREE.BufferGeometry();
  ringGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((VERTICES + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const ring = new THREE.Line(ringGeometry, new THREE.LineBasicMaterial({ color: 0xd0efad }));
  ring.frustumCulled = false; ring.renderOrder = 3; world.add(ring);

  // A fixed compass stays in site coordinates when the wearer turns their head.
  const gridPoints = [];
  for (const elevation of [0, 15, 30, 45, 60]) {
    for (let az = 0; az < 360; az += 2) gridPoints.push(new THREE.Vector3(...direction(az, elevation, 17)), new THREE.Vector3(...direction(az + 2, elevation, 17)));
  }
  for (let az = 0; az < 360; az += 30) {
    for (let e = 0; e < 75; e += 3) gridPoints.push(new THREE.Vector3(...direction(az, e, 17)), new THREE.Vector3(...direction(az, e + 3, 17)));
    const label = textSprite(({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' })[az] || `${az}°`, '#b0c5bb');
    label.position.set(...direction(az, -3, 15.5)); label.scale.set(2, .5, 1); world.add(label);
  }
  const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), new THREE.LineBasicMaterial({ color: 0xa3c2b1, transparent: true, opacity: .10 }));
  world.add(grid);
  const markers = {};
  for (const [key, color] of Object.entries(COLORS)) {
    const group = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(key === 'sun' ? .18 : .12, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    dot.renderOrder = 5;
    const halo = new THREE.Mesh(new THREE.RingGeometry(.23, .255, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: .8 }));
    halo.renderOrder = 5;
    const label = textSprite(key.toUpperCase(), color); label.position.y = .65;
    group.add(dot, halo, label); world.add(group); markers[key] = { group, halo, label, dot };
  }

  // HUD is rendered in the 3D scene; it does not depend on DOM-overlay support.
  const hudCanvas = document.createElement('canvas'); hudCanvas.width = 1536; hudCanvas.height = 384;
  const hudTexture = new THREE.CanvasTexture(hudCanvas); hudTexture.colorSpace = THREE.SRGBColorSpace;
  const hud = new THREE.Mesh(new THREE.PlaneGeometry(1.25, .3125), new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthTest: false, depthWrite: false }));
  hud.position.set(0, -.42, -1.45); hud.renderOrder = 100; hud.visible = false; camera.add(hud);
  const borderPoints = [new THREE.Vector3(-.9,-.62,-1.1), new THREE.Vector3(.9,-.62,-1.1), new THREE.Vector3(.9,.62,-1.1), new THREE.Vector3(-.9,.62,-1.1)];
  const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(borderPoints), new THREE.LineBasicMaterial({ color: 0xff685e, depthTest: false, transparent: true }));
  border.visible = false; border.renderOrder = 101; camera.add(border);
  let state, connection = 'connecting', demo = true, hudKey = '', storm = false;
  function drawHud(point) {
    if (!state) return;
    const key = JSON.stringify([state, connection, demo, Math.round(openSkyPct(point.skylineDeg))]);
    if (key === hudKey) return; hudKey = key;
    const ctx = hudCanvas.getContext('2d'); ctx.clearRect(0,0,1536,384);
    ctx.fillStyle = storm ? '#341713ee' : '#0a1517e8'; ctx.fillRect(0,0,1536,384);
    ctx.fillStyle = storm ? '#ff8c79' : '#c5f28d'; ctx.fillRect(0,0,1536,5);
    ctx.font = '500 36px Segoe UI';
    ctx.fillText(storm ? 'STORM · FOLLOW SHELTER MARKER' : `${point.name.toUpperCase()} · ${openSkyPct(point.skylineDeg).toFixed(0)}% OPEN SKY`, 40, 65);
    const values = [[`${state.minutesToShelter.toFixed(1)} min`, 'TO SHELTER'],[state.contact.toUpperCase(), 'EARTH CONTACT'],[`${state.oxygenPct.toFixed(0)}%`, 'OXYGEN'],[`${state.doseMicroSv.toFixed(0)} µSv`, 'DOSE']];
    values.forEach(([value,label], i) => { const x=40+i*375;ctx.fillStyle='#eff7ee';ctx.font='500 54px Segoe UI';ctx.fillText(value,x,166);ctx.fillStyle='#a6bdb5';ctx.font='24px Segoe UI';ctx.fillText(label,x,212); });
    ctx.fillStyle = ['connected','local'].includes(connection) ? '#9bbaa6' : '#ffbc82'; ctx.font='26px Segoe UI';
    ctx.fillText(`${demo ? 'DEMO DATA' : 'TERRAIN DATA'} · ${connection === 'local' ? 'STANDALONE / THIS BROWSER ONLY' : connection === 'connected' ? 'RELAY CONNECTED' : 'RELAY OFFLINE / VALUES MAY BE STALE'}`,40,290);
    ctx.fillStyle='#91a99e';ctx.font='23px Segoe UI';ctx.fillText('Controller trigger: align this direction to site north',40,343);
    hudTexture.needsUpdate = true;
  }

  let from = initialPoint, to = initialPoint, current = initialPoint, transitionStart = -1000;
  function updateGeometry(point) {
    const top = ringGeometry.attributes.position, band = blocked.geometry.attributes.position, ground = land.geometry.attributes.position;
    for (let i = 0; i <= VERTICES; i++) {
      const az = i * 360 / VERTICES, height = sampleSkyline(point.skylineDeg, az);
      top.setXYZ(i, ...direction(az, height, RADIUS));
      band.setXYZ(i*2, ...direction(az, 0, RADIUS));
      band.setXYZ(i*2+1, ...direction(az, Math.max(height, 0), RADIUS));
      ground.setXYZ(i*2, ...direction(az, -89.9, RADIUS+.1));
      ground.setXYZ(i*2+1, ...direction(az, height, RADIUS+.1));
    }
    for (const attribute of [top,band,ground]) attribute.needsUpdate = true;
    for (const [key, marker] of Object.entries(markers)) {
      const { azimuthDeg, elevationDeg } = point.markers[key];
      marker.group.position.set(...direction(azimuthDeg, elevationDeg, RADIUS-.5));
      marker.halo.lookAt(0,0,0);
      const obscured = elevationDeg < sampleSkyline(point.skylineDeg, azimuthDeg);
      marker.dot.material.transparent = true; marker.dot.material.opacity = obscured ? .45 : 1;
      marker.halo.material.opacity = obscured ? .4 : .85;
    }
  }
  updateGeometry(initialPoint);
  function alignNorth() {
    const active = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    const forward = new THREE.Vector3(0,0,-1).applyQuaternion(active.quaternion);
    northYaw = Math.atan2(-forward.x, -forward.z);
    world.rotation.y = northYaw;
  }
  for (let i=0; i<2; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('select', alignNorth); scene.add(controller);
  }
  const resize = new ResizeObserver(() => {
    if (renderer.xr.isPresenting) return;
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width,height);
  }); resize.observe(host);
  let dragging = false, lastX=0, lastY=0;
  host.addEventListener('pointerdown', event => { dragging=true;lastX=event.clientX;lastY=event.clientY;host.setPointerCapture(event.pointerId); });
  host.addEventListener('pointermove', event => { if(!dragging || renderer.xr.isPresenting)return; yaw -= (event.clientX-lastX)*.004;pitch = THREE.MathUtils.clamp(pitch+(event.clientY-lastY)*.004,-.65,1.2);lastX=event.clientX;lastY=event.clientY; });
  host.addEventListener('pointerup',()=>{dragging=false;}); host.addEventListener('pointercancel',()=>{dragging=false;});
  host.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();yaw+=(event.key==='ArrowLeft'?.12:event.key==='ArrowRight'?-.12:0);pitch=THREE.MathUtils.clamp(pitch+(event.key==='ArrowUp'?.08:event.key==='ArrowDown'?-.08:0),-.65,1.2);}});
  renderer.xr.addEventListener('sessionend',()=>{
    xrMode=null; hud.visible=false;sky.visible=true;land.visible=true;blocked.material.opacity=.20;world.position.set(0,0,0);camera.position.set(0,0,0);
    host.dispatchEvent(new CustomEvent('xr-ended'));
    const width=host.clientWidth,height=host.clientHeight;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);
  });
  const headPosition = new THREE.Vector3();
  renderer.setAnimationLoop((time, frame) => {
    if (!renderer.xr.isPresenting) camera.rotation.set(pitch,yaw,0);
    else {
      const active = renderer.xr.getCamera(); active.getWorldPosition(headPosition);world.position.copy(headPosition);
      if(needsAlignment && frame?.getViewerPose(renderer.xr.getReferenceSpace())) { alignNorth();needsAlignment=false; }
    }
    const raw = Math.min(1,Math.max(0,(performance.now()-transitionStart)/900));
    if (raw<1 || current!==to) { current=raw===1?to:blendWaypoints(from,to,raw*raw*(3-2*raw)); updateGeometry(current); }
    const pulse = storm ? 1 + .22 * (1 + Math.sin(time * .006)) : 1;
    markers.shelter.group.scale.setScalar(pulse);
    markers.shelter.dot.material.color.set(storm ? '#ff8873' : COLORS.shelter);
    border.visible = storm && renderer.xr.isPresenting; border.material.opacity=.65 + .3*Math.sin(time*.004);
    drawHud(current); renderer.render(scene,camera);
  });
  return {
    setWaypoint(point) { from=current;to=point;transitionStart=performance.now(); },
    setState(next, status, isDemo) { state=next;storm=state.storm;connection=status;demo=isDemo; },
    alignNorth,
    async enter(mode) {
      if (renderer.xr.isPresenting) return;
      let session;
      try {
        session=await navigator.xr.requestSession(mode, { requiredFeatures: ['local'] });
        xrMode=mode;sky.visible=mode!=='immersive-ar';land.visible=mode!=='immersive-ar';blocked.material.opacity=mode==='immersive-ar'?.28:.20;
        camera.position.set(0,0,0);camera.rotation.set(0,0,0);needsAlignment=true;
        await renderer.xr.setSession(session);hud.visible=true;
      } catch(error) {
        if(session) await session.end().catch(()=>{});
        xrMode=null;sky.visible=true;land.visible=true;hud.visible=false;
        throw error;
      }
    },
  };
}
