// Terrain map and layer display. WebGL2 draws the terrain, draped image and up to seven layers;
// a 2D canvas on top carries routes and markers. No libraries.
// World space is the shared local frame: X east (m), Y north (m), Z up = (z - lowest z) * exaggeration.
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, center, up) {
  const z = V.norm(V.sub(eye, center)), x = V.norm(V.cross(up, z)), y = V.cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -V.dot(x, eye), -V.dot(y, eye), -V.dot(z, eye), 1];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null; const d = 1 / det;
  return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
}
const xform = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];

const VS = `#version 300 es
in vec3 aPos; in vec2 aSlope;
uniform mat4 uMVP; uniform float uExag; uniform vec2 uSize; uniform float uRelief;
out vec2 vUV; out vec2 vSlope; out float vH;
void main() {
  vUV = vec2(aPos.x / uSize.x, 1.0 - aPos.y / uSize.y);
  vSlope = aSlope; vH = aPos.z / max(uRelief, 0.001);
  gl_Position = uMVP * vec4(aPos.xy, aPos.z * uExag, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec2 vSlope; in float vH;
uniform sampler2D uOrtho, uL0, uL1, uL2, uL3, uL4, uL5, uL6;
// Per layer: scale.xy, offset.xy from crop coordinates to layer coordinates (layers may cover different extents),
// and the rectangle (u0, v0, u1, v1 in layer coordinates) where the layer has data; outside it the layer is not drawn.
uniform vec4 uUVl[7]; uniform vec4 uClip[7];
uniform float uHasOrtho, uExag, uGain; uniform vec3 uSun;
uniform float uOp[7]; uniform int uMode[7]; uniform vec2 uDom[7]; uniform vec4 uC0[7]; uniform vec4 uC1[7]; uniform vec4 uC2[7];
out vec4 o;
vec3 layer(vec3 base, vec4 t, int i) {
  if (uOp[i] <= 0.0) return base;
  vec4 c = t;
  if (uMode[i] == 1) {
    float v = clamp((t.r - uDom[i].x) / max(uDom[i].y - uDom[i].x, 0.0001), 0.0, 1.0);
    c = v < 0.5 ? mix(uC0[i], uC1[i], v * 2.0) : mix(uC1[i], uC2[i], v * 2.0 - 1.0);
  }
  return mix(base, c.rgb, c.a * uOp[i]);
}
vec3 lay(vec3 base, sampler2D s, int i) {
  if (uOp[i] <= 0.0) return base;
  vec2 u = vUV * uUVl[i].xy + uUVl[i].zw;
  if (u.x < uClip[i].x || u.y < uClip[i].y || u.x > uClip[i].z || u.y > uClip[i].w) return base;
  return layer(base, texture(s, u), i);
}
void main() {
  vec3 base = uHasOrtho > 0.5 ? texture(uOrtho, vUV).rgb * uGain : mix(vec3(0.60, 0.38, 0.25), vec3(0.74, 0.52, 0.38), vH);
  vec3 n = normalize(vec3(vSlope * uExag, 1.0));
  base *= 0.42 + 0.72 * max(dot(n, uSun), 0.0);
  base = lay(base, uL0, 0); base = lay(base, uL1, 1); base = lay(base, uL2, 2); base = lay(base, uL3, 3);
  base = lay(base, uL4, 4); base = lay(base, uL5, 5); base = lay(base, uL6, 6);
  o = vec4(base, 1.0);
}`;

export function createMap(glCanvas, ovCanvas, { terrain: T, sun, exaggeration = 1.5, imageGain = 1 }) {
  const gl = glCanvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('This browser has no WebGL2, which the 3D map needs.');
  const ctx = ovCanvas.getContext('2d');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const U = (n) => gl.getUniformLocation(prog, n);

  // --- mesh over the whole crop, at most 768 vertices per side ---
  const nc = Math.min(Math.max(2, T.cols), 768), nr = Math.min(Math.max(2, T.rows), 768);
  const pos = new Float32Array(nc * nr * 5), dX = T.W / (nc - 1), dY = T.H / (nr - 1);
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
    const x = c * dX, y = T.H - r * dY, i = (r * nc + c) * 5;
    pos[i] = x; pos[i + 1] = y; pos[i + 2] = T.heightAt(x, y) - T.minZ;
    pos[i + 3] = -(T.heightAt(x + dX, y) - T.heightAt(x - dX, y)) / (2 * dX);
    pos[i + 4] = -(T.heightAt(x, y + dY) - T.heightAt(x, y - dY)) / (2 * dY);
  }
  const idx = new Uint32Array((nc - 1) * (nr - 1) * 6);
  for (let r = 0, k = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) { const a = r * nc + c, b = a + 1, d = a + nc, e = d + 1; idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e; }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos'), aSlope = gl.getAttribLocation(prog, 'aSlope');
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(aSlope); gl.vertexAttribPointer(aSlope, 2, gl.FLOAT, false, 20, 12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

  // --- textures: unit 0 = draped image, units 1..7 = layers ---
  const blank = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); return t; };
  const tex = [blank(), blank(), blank(), blank(), blank(), blank(), blank(), blank()];
  function upload(unit, image, mip) {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex[unit]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  ['uOrtho', 'uL0', 'uL1', 'uL2', 'uL3', 'uL4', 'uL5', 'uL6'].forEach((n, i) => gl.uniform1i(U(n), i));
  const layers = [0, 1, 2, 3, 4, 5, 6].map(() => ({ op: 0, target: 0, mode: 0, dom: [0, 1], c: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], uv: [1, 1, 0, 0], clip: [0, 0, 1, 1] }));
  let hasOrtho = 0;

  // --- camera ---
  const FOV = 38 * Math.PI / 180, ex = exaggeration;
  const cam = { x: T.W / 2, y: T.H / 2, dist: Math.max(T.W, T.H) * 1.25, az: 24, pitch: 50 };
  let tween = null, mvp = null, inv = null, cssW = 1, cssH = 1, dpr = 1;
  const wz = (x, y, lift = 0) => (T.heightAt(x, y) - T.minZ + lift) * ex;
  function matrices() {
    const a = cam.az * Math.PI / 180, p = cam.pitch * Math.PI / 180, tz = wz(cam.x, cam.y);
    const eye = [cam.x - Math.sin(a) * Math.cos(p) * cam.dist, cam.y - Math.cos(a) * Math.cos(p) * cam.dist, tz + Math.sin(p) * cam.dist];
    const up = cam.pitch > 88 ? [Math.sin(a), Math.cos(a), 0] : [0, 0, 1];
    mvp = mul(perspective(FOV, cssW / cssH, Math.max(2, cam.dist * 0.02), cam.dist * 6 + 4000), lookAt(eye, [cam.x, cam.y, tz], up));
    inv = invert(mvp);
  }
  function resize() {
    const r = glCanvas.parentElement.getBoundingClientRect();
    cssW = Math.max(50, r.width); cssH = Math.max(50, r.height); dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [glCanvas, ovCanvas]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); c.style.width = cssW + 'px'; c.style.height = cssH + 'px'; }
  }
  new ResizeObserver(resize).observe(glCanvas.parentElement); resize();

  const api = {
    cam, terrain: T, onDraw: null, onClick: null,
    // Images have row 0 at the north edge and cover the whole crop, with samples at pixel centres (shared/conventions.md).
    setOrtho(image) { upload(0, image, true); hasOrtho = 1; },
    // domain = [lo, hi] as fractions of the 0..255 pixel range that the colour ramp spans.
    // widthM, heightM = ground the layer images cover; originX, originY = local metres of their south-west
    // corner (meta.json, shared/layers.md; 0 when absent). vUV runs 0..1 east and 0..1 from the north edge.
    // bounds = { xMin, xMax, yMin, yMax } local metres where the layer holds real values (meta.json validBounds);
    // outside it the layer is left clear instead of drawing placeholder values. Default: the whole image.
    setLayer(i, image, { domain, stops, widthM = T.W, heightM = T.H, originX = 0, originY = 0, bounds = null }) {
      upload(i + 1, image, false);
      const uv = [T.W / widthM, T.H / heightM, -originX / widthM, 1 + (originY - T.H) / heightM];
      const clip = bounds ? [(bounds.xMin - originX) / widthM, 1 - (bounds.yMax - originY) / heightM, (bounds.xMax - originX) / widthM, 1 - (bounds.yMin - originY) / heightM] : [0, 0, 1, 1];
      Object.assign(layers[i], { mode: 1, dom: domain || [0, 1], c: stops || layers[i].c, uv, clip });
    },
    setLayerOn(i, on) { layers[i].target = on ? 1 : 0; },
    // world (x, y, metres above ground) -> CSS pixel position on the map
    project(x, y, lift = 1.5) {
      const p = xform(mvp, x, y, wz(x, y, lift));
      return { x: (p[0] / p[3] * 0.5 + 0.5) * cssW, y: (1 - (p[1] / p[3] * 0.5 + 0.5)) * cssH, ok: p[3] > 0 };
    },
    // CSS pixel -> point on the terrain, or null when the click misses it
    pick(sx, sy) {
      const nx = sx / cssW * 2 - 1, ny = 1 - sy / cssH * 2;
      const a = xform(inv, nx, ny, -1), b = xform(inv, nx, ny, 1);
      const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      const at = (t) => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
      const below = (p) => T.inside(p[0], p[1]) && p[2] <= wz(p[0], p[1]);
      const N = 1500; let lo = 0;
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        if (below(at(t))) { let hi = t; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (below(at(m))) hi = m; else lo = m; } const p = at(hi); return { x: p[0], y: p[1] }; }
        lo = t;
      }
      return null;
    },
    flyTo(to, ms = 900) {
      if (!ms) { Object.assign(cam, to); tween = null; return; }
      const from = { ...cam }, t = { ...cam, ...to };
      t.az = from.az + ((((t.az - from.az) % 360) + 540) % 360 - 180);
      tween = { from, to: t, t0: performance.now(), ms };
    },
    view(name) {
      const fit = Math.max(T.H, T.W / (cssW / cssH)) / 2 / Math.tan(FOV / 2);
      if (name === 'top') api.flyTo({ x: T.W / 2, y: T.H / 2, dist: fit * 1.08, az: 0, pitch: 89.9 });
      else api.flyTo({ x: T.W / 2, y: T.H / 2, dist: fit * 1.3, az: 24, pitch: 56 });
    },
    frame(points, pad = 1.9, minDist = 260) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      api.flyTo({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, dist: Math.max(minDist, Math.hypot(x1 - x0, y1 - y0) * pad) });
    },
    get size() { return { w: cssW, h: cssH }; },
  };

  // --- pointer controls: drag = rotate, shift/right drag = pan, wheel = zoom, click = onClick ---
  let drag = null;
  const local = (e) => { const r = ovCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  ovCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  ovCanvas.addEventListener('pointerdown', (e) => { ovCanvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey }; tween = null; });
  ovCanvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved < 5) return;
    if (drag.pan) {
      const a = cam.az * Math.PI / 180, k = cam.dist * 0.0017;
      cam.x = Math.max(0, Math.min(T.W, cam.x - (Math.cos(a) * dx - Math.sin(a) * dy) * k));
      cam.y = Math.max(0, Math.min(T.H, cam.y + (Math.sin(a) * dx + Math.cos(a) * dy) * k));
    } else { cam.az = (cam.az + dx * 0.3 + 360) % 360; cam.pitch = Math.max(14, Math.min(89.9, cam.pitch + dy * 0.3)); }
  });
  ovCanvas.addEventListener('pointerup', (e) => { const d = drag; drag = null; if (d && d.moved < 5 && e.button === 0 && api.onClick) { const p = local(e); api.onClick({ sx: p.x, sy: p.y, world: api.pick(p.x, p.y) }); } });
  ovCanvas.addEventListener('wheel', (e) => { e.preventDefault(); tween = null; cam.dist = Math.max(80, Math.min(Math.max(T.W, T.H) * 4, cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const s = sun || { az: 300, el: 40 }, el = Math.max(38, s.el) * Math.PI / 180, az = s.az * Math.PI / 180; // display light never lower than 38 degrees
  const sunVec = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  function render(now) {
    if (tween) {
      const k = Math.min(1, (now - tween.t0) / tween.ms), e = ease(k);
      for (const f of ['x', 'y', 'dist', 'az', 'pitch']) cam[f] = tween.from[f] + (tween.to[f] - tween.from[f]) * e;
      cam.az = (cam.az + 360) % 360; if (k >= 1) tween = null;
    }
    for (const l of layers) l.op += (l.target - l.op) * 0.2;
    matrices();
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(0.043, 0.055, 0.075, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(U('uMVP'), false, new Float32Array(mvp));
    gl.uniform1f(U('uExag'), ex); gl.uniform2f(U('uSize'), T.W, T.H); gl.uniform1f(U('uRelief'), T.maxZ - T.minZ);
    gl.uniform1f(U('uHasOrtho'), hasOrtho); gl.uniform1f(U('uGain'), imageGain); gl.uniform3fv(U('uSun'), sunVec);
    gl.uniform4fv(U('uUVl'), layers.flatMap((l) => l.uv)); gl.uniform4fv(U('uClip'), layers.flatMap((l) => l.clip));
    gl.uniform1fv(U('uOp'), layers.map((l) => (l.op < 0.01 ? 0 : l.op)));
    gl.uniform1iv(U('uMode'), layers.map((l) => l.mode));
    gl.uniform2fv(U('uDom'), layers.flatMap((l) => l.dom));
    [0, 1, 2].forEach((k) => gl.uniform4fv(U('uC' + k), layers.flatMap((l) => l.c[k])));
    gl.bindVertexArray(vao); gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
    if (api.onDraw) api.onDraw(ctx, now);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
  return api;
}
