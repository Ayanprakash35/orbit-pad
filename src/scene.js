import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PAD_LAYOUT, HEAD, RADIUS, padPosition } from './pads.js';

export const GROUP_COLOR = {
  kick: '#ff7a3d', snare: '#ff4f8b', metal: '#3ee0ff', tom: '#4d8dff', perc: '#5cf29a', user: '#ffd166',
};

const PAD_SIZE = 0.5;

function labelTexture(key, name, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#15161d'); grad.addColorStop(1, '#0b0c11');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = color; g.globalAlpha = 0.9; g.lineWidth = 10;
  g.strokeRect(12, 12, 232, 232);
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.font = '700 118px "Space Grotesk", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(key, 128, 112);
  g.fillStyle = '#e9ebf2';
  let fs = 30;
  const label = name.toUpperCase();
  do { g.font = `600 ${fs}px "Space Grotesk", system-ui, sans-serif`; } while (g.measureText(label).width > 214 && --fs > 16);
  g.fillText(label, 128, 200, 220);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function buildFigure() {
  const fig = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.5, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d25, roughness: 0.35, metalness: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x3ee0ff, emissive: 0x3ee0ff, emissiveIntensity: 1.6 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, s) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    if (s) m.scale.set(...s);
    fig.add(m); return m;
  };
  // head + face (facing -Z)
  add(new THREE.SphereGeometry(0.115, 40, 30), skin, 0, HEAD.y, 0, 0, 0, 0, [0.92, 1.08, 1]);
  add(new THREE.SphereGeometry(0.014, 12, 8), dark, -0.04, HEAD.y + 0.02, -0.105);
  add(new THREE.SphereGeometry(0.014, 12, 8), dark, 0.04, HEAD.y + 0.02, -0.105);
  add(new THREE.ConeGeometry(0.018, 0.04, 12), skin, 0, HEAD.y - 0.015, -0.118, -Math.PI / 2);
  // headphones
  add(new THREE.TorusGeometry(0.128, 0.013, 10, 40, Math.PI), dark, 0, HEAD.y + 0.01, 0);
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.045, 28), dark, sx * 0.123, HEAD.y - 0.005, 0, 0, 0, Math.PI / 2);
    add(new THREE.TorusGeometry(0.034, 0.006, 8, 28), glow, sx * 0.147, HEAD.y - 0.005, 0, 0, Math.PI / 2, 0);
  }
  // body
  add(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 16), skin, 0, HEAD.y - 0.16, 0);
  add(new THREE.CapsuleGeometry(0.165, 0.36, 8, 20), skin, 0, 1.2, 0, 0, 0, 0, [1, 1, 0.62]);
  for (const sx of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.045, 0.5, 6, 12), skin, sx * 0.235, 1.17, 0, 0, 0, sx * 0.1);
    add(new THREE.CapsuleGeometry(0.065, 0.72, 6, 14), skin, sx * 0.09, 0.47, 0, 0, 0, sx * 0.025);
  }
  fig.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  return fig;
}

function ringLine(radius, y, color, opacity, segs = 128) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

export function createScene(canvas, { onPadDown, onHover }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06070b);
  scene.fog = new THREE.FogExp2(0x06070b, 0.055);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  camera.position.set(4.0, 2.9, 4.7);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.35, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.2;
  controls.maxDistance = 13;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // lights
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0b0b10, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 6, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  key.shadow.radius = 6;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4d8dff, 1.0);
  rim.position.set(-4, 2.5, 3);
  scene.add(rim);

  // floor
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 96),
    new THREE.MeshStandardMaterial({ color: 0x0c0d13, roughness: 0.9, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.PolarGridHelper(RADIUS + 0.6, 8, 6, 96, 0x2a2e3d, 0x1a1c26);
  grid.position.y = 0.002;
  scene.add(grid);
  // "front" marker on the floor
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, -0.16); arrowShape.lineTo(0.11, 0.04); arrowShape.lineTo(-0.11, 0.04); arrowShape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({ color: 0x3ee0ff, transparent: true, opacity: 0.75 }));
  arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 0.006, -0.75);
  scene.add(arrow);
  {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#3ee0ff';
    g.font = '600 34px "Space Grotesk", system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('FRONT', 128, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.7, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.006, -1.08);
    scene.add(m);
  }

  // the listening sphere (guide lines)
  const guides = new THREE.Group();
  for (const el of [-38, 0, 40]) {
    const r = RADIUS * Math.cos((el * Math.PI) / 180);
    guides.add(ringLine(r, HEAD.y + RADIUS * Math.sin((el * Math.PI) / 180), 0x5a6488, el === 0 ? 0.32 : 0.18));
  }
  for (let k = 0; k < 4; k++) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const e = -Math.PI / 2 + (i / 64) * Math.PI;
      pts.push(new THREE.Vector3(RADIUS * Math.cos(e), HEAD.y + RADIUS * Math.sin(e), 0));
    }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x5a6488, transparent: true, opacity: 0.08, depthWrite: false }));
    l.rotation.y = (k * Math.PI) / 4;
    const l2 = l.clone(); l2.rotation.y += Math.PI;
    guides.add(l, l2);
  }
  scene.add(guides);

  const figure = buildFigure();
  scene.add(figure);
  // soft glow around the head that lights up when a sound arrives
  const headGlow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  headGlow.position.set(HEAD.x, HEAD.y, HEAD.z);
  scene.add(headGlow);

  // pads
  const headV = new THREE.Vector3(HEAD.x, HEAD.y, HEAD.z);
  const box = new THREE.BoxGeometry(PAD_SIZE, PAD_SIZE, 0.07);
  const edgeGeo = new THREE.EdgesGeometry(box);
  const pads = PAD_LAYOUT.map((layout, i) => {
    const pos = padPosition(layout.az, layout.el);
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    if (layout.ring === 'top') group.up.set(0, 0, -1);
    group.lookAt(headV);
    const side = new THREE.MeshStandardMaterial({ color: 0x1a1c25, roughness: 0.4, metalness: 0.5, emissive: 0x000000 });
    const faceIn = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, emissiveIntensity: 0.35 });
    const faceOut = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, emissiveIntensity: 0.35 });
    const mesh = new THREE.Mesh(box, [side, side, side, side, faceIn, faceOut]);
    mesh.castShadow = true;
    mesh.userData.pad = i;
    const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    group.add(mesh, edges);
    // faint beam to the head
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, RADIUS - 0.2)]);
    const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending }));
    group.add(beam);
    scene.add(group);
    return { group, mesh, edges, beam, side, faceIn, faceOut, color: new THREE.Color(), hit: 0, hover: 0, selected: false,
      base: new THREE.Vector3(pos.x, pos.y, pos.z), dir: new THREE.Vector3(pos.x - HEAD.x, pos.y - HEAD.y, pos.z - HEAD.z).normalize(),
      dist: RADIUS, distTarget: RADIUS };
  });

  // Slides a pad along its line to the head (the direction never changes).
  let fitCamera = false;
  function setPadDistance(i, d, instant = false) {
    const p = pads[i];
    p.distTarget = d;
    if (instant) p.dist = d;
    fitCamera = true;
  }

  function setPadLook(i, key, name, hex) {
    const p = pads[i];
    p.color.set(hex);
    for (const m of [p.faceIn, p.faceOut]) {
      if (m.map) m.map.dispose();
      m.map = labelTexture(key, name, hex);
      m.emissiveMap = m.map;
      m.emissive.set(0xffffff);
      m.color.set(0xffffff);
      m.needsUpdate = true;
    }
    p.edges.material.color.set(hex);
    p.beam.material.color.set(hex);
  }

  // ripples that travel from a pad into the listener's head
  const ripplePool = [];
  const ringGeo = new THREE.RingGeometry(0.3, 0.34, 48);
  function ripple(i, vel) {
    let r = ripplePool.find((x) => !x.active);
    if (!r) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      scene.add(m);
      r = { mesh: m, active: false };
      ripplePool.push(r);
    }
    const p = pads[i];
    r.active = true; r.t = 0; r.i = i; r.vel = vel;
    r.mesh.material.color.copy(p.color);
    r.mesh.quaternion.copy(p.group.quaternion);
    r.mesh.visible = true;
  }

  let glowColor = new THREE.Color(), glowAmt = 0;
  function flash(i, vel = 1) {
    const p = pads[i];
    p.hit = Math.max(p.hit, 0.55 + vel * 0.45);
    ripple(i, vel);
    glowColor.copy(p.color); glowAmt = Math.max(glowAmt, 0.25 + vel * 0.2);
  }

  // continuous glow driven by a song's level (no ripple)
  function pulse(i, amt) { const p = pads[i]; p.hit = Math.max(p.hit, Math.min(1, amt)); }

  // the orbiting song, drawn as a glowing orb with a trail
  const orb = new THREE.Group();
  const orbCore = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  const orbHalo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  orb.add(orbCore, orbHalo);
  orb.visible = false;
  scene.add(orb);
  const trail = [];
  for (let k = 0; k < 14; k++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.3 * (1 - k / 14), blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = false; scene.add(m); trail.push(m);
  }
  const trailPts = [];
  function setOrb(pos, level = 0) {
    if (!pos) { orb.visible = false; trail.forEach((m) => (m.visible = false)); trailPts.length = 0; return; }
    orb.visible = true;
    orb.position.set(pos.x, pos.y, pos.z);
    orbHalo.scale.setScalar(1 + level * 4);
    trailPts.unshift(orb.position.clone());
    if (trailPts.length > trail.length * 2) trailPts.pop();
    trail.forEach((m, k) => { const q = trailPts[k * 2]; m.visible = !!q; if (q) m.position.copy(q); });
    glowColor.set(0xffd166); glowAmt = Math.max(glowAmt, level * 1.2);
  }

  function select(i) { pads.forEach((p, k) => (p.selected = k === i)); }

  // bloom
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.7);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // keep the figure centred in the space left of the pad editor on wide screens
    if (w > 900) camera.setViewOffset(w, h, 132, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = pads.map((p) => p.mesh);
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.pad : -1;
  }
  let hovered = -1;
  canvas.addEventListener('pointermove', (e) => {
    const i = pick(e);
    if (i !== hovered) {
      hovered = i;
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
      onHover(i, e);
    } else if (i >= 0) onHover(i, e);
  });
  canvas.addEventListener('pointerleave', () => { hovered = -1; onHover(-1); });
  // Pads fire on pointer-down (no click latency); a press on a pad doesn't rotate the view.
  canvas.addEventListener('pointerdown', (e) => {
    const i = pick(e);
    if (i >= 0) {
      controls.enabled = false;
      onPadDown(i, e);
      const up = () => { controls.enabled = true; window.removeEventListener('pointerup', up); };
      window.addEventListener('pointerup', up);
    }
  }, { capture: true });

  const views = {
    orbit: [new THREE.Vector3(4.0, 2.9, 4.7)],
    front: [new THREE.Vector3(0, 2.0, -6.0)],
    top: [new THREE.Vector3(0.001, 8.5, 0.6)],
    behind: [new THREE.Vector3(0, 2.3, 6.0)],
  };
  let flyTo = null;
  function setView(name) {
    controls.autoRotate = false;
    const a = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const b = new THREE.Spherical().setFromVector3(views[name][0].clone().sub(controls.target));
    // take the short way round
    let d = b.theta - a.theta;
    d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    b.theta = a.theta + d;
    flyTo = { from: a, to: b, t: 0 };
  }

  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (flyTo) {
      flyTo.t = Math.min(1, flyTo.t + dt * 1.6);
      const k = 1 - Math.pow(1 - flyTo.t, 3);
      const f = flyTo.from, g = flyTo.to;
      camera.position.setFromSphericalCoords(
        f.radius + (g.radius - f.radius) * k, f.phi + (g.phi - f.phi) * k, f.theta + (g.theta - f.theta) * k,
      ).add(controls.target);
      if (flyTo.t >= 1) flyTo = null;
    }
    controls.update();
    let far = 0;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      p.dist += (p.distTarget - p.dist) * Math.min(1, dt * 10);
      far = Math.max(far, p.distTarget);
      p.base.copy(headV).addScaledVector(p.dir, p.dist);
      p.beam.scale.z = Math.max(0.05, (p.dist - 0.2) / (RADIUS - 0.2));
      p.hit = Math.max(0, p.hit - dt * 4.2);
      const target = (i === hovered ? 1 : 0) + (p.selected ? 0.6 : 0);
      p.hover += (target - p.hover) * Math.min(1, dt * 12);
      const glow = 0.24 + p.hover * 0.3 + p.hit * 2.4;
      p.faceIn.emissiveIntensity = glow; p.faceOut.emissiveIntensity = glow;
      p.side.emissive.copy(p.color).multiplyScalar(p.hit * 0.8 + (p.selected ? 0.12 : 0));
      p.edges.material.opacity = 0.35 + p.hover * 0.45 + p.hit * 0.6;
      p.beam.material.opacity = 0.05 + p.hover * 0.12 + p.hit * 0.6;
      const s = 1 + p.hit * 0.16 + p.hover * 0.04;
      p.group.scale.setScalar(s);
      // pads recoil slightly away from the head when struck
      tmp.set(p.base.x - HEAD.x, p.base.y - HEAD.y, p.base.z - HEAD.z).normalize().multiplyScalar(p.hit * 0.06);
      p.group.position.set(p.base.x + tmp.x, p.base.y + tmp.y, p.base.z + tmp.z);
    }
    // keep the camera outside the furthest pad when sounds are pushed back
    if (fitCamera && !flyTo) {
      const need = far + 2.6;
      tmp.copy(camera.position).sub(controls.target);
      const len = tmp.length();
      if (len < need - 0.01) camera.position.copy(controls.target).addScaledVector(tmp.normalize(), len + (need - len) * Math.min(1, dt * 4));
      else fitCamera = false;
    }
    for (const r of ripplePool) {
      if (!r.active) continue;
      r.t += dt / (0.32 * Math.max(0.5, pads[r.i].dist / RADIUS));
      if (r.t >= 1) { r.active = false; r.mesh.visible = false; continue; }
      const p = pads[r.i];
      const k = r.t * r.t;
      r.mesh.position.lerpVectors(p.base, headV, k * 0.96);
      r.mesh.scale.setScalar(1 - k * 0.75);
      r.mesh.material.opacity = (1 - r.t) * (0.5 + r.vel * 0.5);
    }
    glowAmt = Math.max(0, glowAmt - dt * 2.2);
    headGlow.material.color.copy(glowColor);
    headGlow.material.opacity = glowAmt;
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { flash, pulse, setOrb, select, setPadLook, setPadDistance, setView, pads, camera, renderer };
}
