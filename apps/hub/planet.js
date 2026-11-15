// Planet view: all of Mars as a globe, with a marker for each base the relay can serve (/sites.json). Shown when the
// hub opens; picking the base in use enters it, picking another asks the relay to switch site ({ type: "site" }),
// and every page reloads into the new site. Raw WebGL2 like map.js: one full-screen quad, the sphere is ray-cast in
// the fragment shader and samples an equirectangular texture (Viking MDIM 2.1 colour mosaic, longitude -180..180).
const VS = `#version 300 es
in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform vec2 uCentre; uniform float uRadius; uniform mat3 uRot; uniform sampler2D uTex; uniform float uHasTex; uniform vec3 uSun;
out vec4 o;
const float PI = 3.14159265;
void main() {
  vec2 p = (gl_FragCoord.xy - uCentre) / uRadius;
  float r2 = dot(p, p);
  vec3 bg = vec3(0.035, 0.043, 0.06);
  if (r2 > 1.0) { // thin dusty atmosphere around the limb
    float g = exp(-(sqrt(r2) - 1.0) * 28.0);
    o = vec4(bg + vec3(0.85, 0.42, 0.22) * g * 0.55, 1.0); return;
  }
  vec3 n = vec3(p, sqrt(1.0 - r2));             // view-space normal, z towards the viewer
  vec3 w = uRot * n;                             // planet frame: y north, z = lon 0 on the equator, x = lon 90 E
  float lat = asin(clamp(w.y, -1.0, 1.0)), lon = atan(w.x, w.z);
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec3 c = uHasTex > 0.5 ? texture(uTex, uv).rgb : vec3(0.62, 0.36, 0.22);
  float lit = 0.18 + 0.95 * max(dot(n, uSun), 0.0);
  float rim = pow(1.0 - n.z, 3.0);
  o = vec4(c * lit * 1.08 + vec3(0.9, 0.45, 0.25) * rim * 0.35, 1.0);
}`;

const D = Math.PI / 180;
// View rotation that puts (lat0, lon0) in the middle of the disc: world = Ry(lon0) * Rx(-lat0) * view. Row-major.
function rotation(lat0, lon0) {
  const ca = Math.cos(-lat0), sa = Math.sin(-lat0), cb = Math.cos(lon0), sb = Math.sin(lon0);
  const rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca], ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const m = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] = ry[r * 3] * rx[c] + ry[r * 3 + 1] * rx[3 + c] + ry[r * 3 + 2] * rx[6 + c];
  return m;
}
const unit = (lat, lon) => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
const fmtLat = (v) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'E' : 'W'}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// "Murray Buttes, Gale crater" -> { title: "Gale crater", sub: "Murray Buttes" }
function splitName(name) {
  const i = name.lastIndexOf(', ');
  return i > 0 ? { title: name.slice(i + 2).replace(/^./, (c) => c.toUpperCase()), sub: name.slice(0, i) } : { title: name, sub: '' };
}

// sites: [{ id, name, description, lat, lon }]; current: id in use. onPick(site) is called on a marker or card.
export function openPlanet({ sites, current, texture, credit, note, onPick }) {
  const root = document.createElement('div');
  root.className = 'planet'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Mars: choose a base');
  const placed = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  root.innerHTML = `<canvas class="pGlobe" aria-hidden="true"></canvas>
    <header class="pHead"><span class="pBrand">Beacon</span><h1>Mars</h1><p>Choose a base to plan and follow a walk. Drag to turn the planet.</p></header>
    <div class="pMarks">${placed.map((s) => `<button type="button" class="pMark${s.id === current ? ' current' : ''}" data-id="${esc(s.id)}"><i></i><span>${esc(splitName(s.name).title)}</span></button>`).join('')}</div>
    <aside class="pList"><h2>Bases</h2>${sites.map((s) => { const n = splitName(s.name); return `<button type="button" class="pCard${s.id === current ? ' current' : ''}" data-id="${esc(s.id)}">
      <span class="pTitle">${esc(n.title)}${s.id === current ? '<em>In use</em>' : ''}</span><span class="pSub">${esc(n.sub)}</span>
      ${Number.isFinite(s.lat) ? `<span class="pPos mono">${fmtLat(s.lat)} · ${fmtLon(s.lon)}</span>` : ''}
      <span class="pGo">${s.id === current ? 'Enter base' : 'Switch to this base'} →</span></button>`; }).join('')}
      <p class="pNote" ${note ? '' : 'hidden'}>${esc(note || '')}</p></aside>
    <p class="pCredit">${esc(credit)}</p>`;
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas'), gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  const status = (text) => { const p = root.querySelector('.pNote'); p.hidden = !text; p.textContent = text || ''; };

  // view: centred between the bases, slowly turning until touched
  const mean = (k) => (placed.length ? placed.reduce((a, s) => a + s[k], 0) / placed.length : 0);
  const view = { lat: mean('lat') * D, lon: mean('lon') * D, target: null, touched: false };
  let W = 0, H = 0, dpr = 1, raf = 0, prog = null, U = null, hasTex = 0;
  if (gl) {
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    U = (n) => gl.getUniformLocation(prog, n);
    const img = new Image();
    img.onload = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      hasTex = 1;
    };
    img.src = texture;
  }
  const geom = () => { // globe centre and radius in CSS pixels: left of the list on wide screens
    const list = root.querySelector('.pList').getBoundingClientRect(), wide = W > 900;
    const cx = wide ? (W - list.width - 24) / 2 : W / 2, cy = wide ? H / 2 + 20 : H * 0.36;
    return { cx, cy, r: Math.max(80, Math.min(wide ? (W - list.width) * 0.38 : W * 0.42, (wide ? H : H * 0.6) * 0.4)) };
  };
  const resize = () => { const r = root.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; };
  const ro = new ResizeObserver(resize); ro.observe(root); resize();
  const sun = (() => { const v = [-0.45, 0.35, 0.82], l = Math.hypot(...v); return v.map((x) => x / l); })();

  let last = performance.now();
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (view.target) { // ease towards a chosen base
      const dl = ((view.target.lon - view.lon + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      view.lon += dl * Math.min(1, dt * 4); view.lat += (view.target.lat - view.lat) * Math.min(1, dt * 4);
    } else if (!view.touched) view.lon += dt * 0.06;
    const { cx, cy, r } = geom(), M = rotation(view.lat, view.lon);
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U('uCentre'), cx * dpr, (H - cy) * dpr); gl.uniform1f(U('uRadius'), r * dpr);
      gl.uniformMatrix3fv(U('uRot'), true, M); gl.uniform1f(U('uHasTex'), hasTex); gl.uniform3fv(U('uSun'), sun); gl.uniform1i(U('uTex'), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // markers: view = M^T * world; hidden on the far side
    for (const el of root.querySelectorAll('.pMark')) {
      const s = placed.find((x) => x.id === el.dataset.id), w = unit(s.lat * D, s.lon * D);
      const vx = M[0] * w[0] + M[3] * w[1] + M[6] * w[2], vy = M[1] * w[0] + M[4] * w[1] + M[7] * w[2], vz = M[2] * w[0] + M[5] * w[1] + M[8] * w[2];
      el.style.transform = `translate(${cx + vx * r}px, ${cy - vy * r}px)`;
      el.classList.toggle('behind', vz < 0.08);
    }
  };
  raf = requestAnimationFrame(frame);

  // drag to turn the planet
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; view.touched = true; view.target = null; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return; const r = geom().r;
    view.lon -= (e.clientX - drag.x) / r; view.lat = Math.max(-1.3, Math.min(1.3, view.lat + (e.clientY - drag.y) / r)); drag = { x: e.clientX, y: e.clientY };
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { drag = null; });
  // hovering a card turns the planet to that base; clicking picks it
  root.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.pCard, .pMark'); const s = b && placed.find((x) => x.id === b.dataset.id);
    if (s) { view.target = { lat: s.lat * D, lon: s.lon * D }; view.touched = true; }
    for (const el of root.querySelectorAll('.pMark, .pCard')) el.classList.toggle('hot', !!b && el.dataset.id === b.dataset.id);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.pCard, .pMark'); if (!b) return;
    const s = sites.find((x) => x.id === b.dataset.id); if (s) onPick(s, { status });
  });
  const onKey = (e) => { if (e.key === 'Escape') { const s = sites.find((x) => x.id === current); if (s) onPick(s, { status }); } };
  window.addEventListener('keydown', onKey);
  root.querySelector(`.pCard.current`)?.focus();

  return {
    status,
    close() { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('keydown', onKey); root.classList.add('leaving'); setTimeout(() => root.remove(), 260); },
  };
}
