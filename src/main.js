import { PAD_LAYOUT, padDirection, RING_LABEL, RADIUS } from './pads.js';
import { KITS, ROLES } from './kits.js';
import { Engine } from './audio.js';
import { createScene, GROUP_COLOR } from './scene.js';
import { db, newId, cleanName, chop } from './library.js';
import { SongPlayer, SONG_MODES, defaultSong, orbitPos } from './song.js';

const $ = (s) => document.querySelector(s);
const STEPS = 16;
const N = PAD_LAYOUT.length;
const STORE = 'orbitpad.v1';
const roleIndex = (role) => PAD_LAYOUT.findIndex((p) => p.role === role);

// ---------- patterns ----------
// '.' = off, 'x' = hit, 'X' = accent. Keys are the pad's default role.
const PRESETS = {
  'Orbit groove': {
    bpm: 100, swing: 0.14,
    rows: {
      kick:    'X......xX.......',
      kick2:   '..........x.....',
      snare:   '....X.......X...',
      clap:    '............x...',
      rim:     '.......x......x.',
      chh:     'x.xxx.x.x.xxx.x.',
      ohh:     '......x.......x.',
      shaker:  '.x.x.x.x.x.x.x.x',
      crash:   'x...............',
      congaH:  '.x.......x......',
      congaL:  '...x.......x....',
      cowbell: '.....x.......x..',
      clave:   '.......x.......x',
      tomH:    '.............x..',
      tomM:    '..............x.',
      tomL:    '...............x',
    },
  },
  'Spiral tour': {
    bpm: 112, swing: 0,
    // walks the sphere: lower ring → ear level → upper ring → overhead
    spiral: ['congaH', 'congaL', 'cowbell', 'clave', 'kick', 'snare', 'clap', 'tomL', 'kick2', 'tomM', 'rim', 'tomH', 'chh', 'ohh', 'ride', 'crash'],
  },
  'Head spin': {
    bpm: 96, swing: 0.1,
    rows: {
      kick:  'X.......X.......',
      kick2: '....x.......x...',
      // the ear-level ring hit clockwise, one per 16th: a full circle every half bar
      snare: '.x.......x......', clap: '..x.......x.....', tomL: '...x.......x....',
      tomM:  '.....x.......x..', rim:  '......x.......x.', tomH: '.......x.......x',
      chh:   'x...x...x...x...', ohh:  '..x...x...x...x.',
    },
  },
  'Empty': { bpm: 100, swing: 0, rows: {} },
};

function emptyPattern() { return PAD_LAYOUT.map(() => Array(STEPS).fill(0)); }
function defaultPads(kit) { return PAD_LAYOUT.map((p) => ({ role: p.role, kit, vol: p.role === 'crash' ? 0.7 : 1, pitch: 0, dist: RADIUS, mute: false, solo: false })); }

function patternFrom(name) {
  const pr = PRESETS[name];
  const pat = emptyPattern();
  if (pr.spiral) pr.spiral.forEach((role, s) => { const i = roleIndex(role); if (i >= 0) pat[i][s] = s % 4 === 0 ? 2 : 1; });
  for (const [role, str] of Object.entries(pr.rows || {})) {
    const i = roleIndex(role);
    for (let s = 0; s < STEPS; s++) pat[i][s] = str[s] === 'X' ? 2 : str[s] === 'x' ? 1 : 0;
  }
  return pat;
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.pads && s.pads.length === N && s.pattern && s.pattern.length === N && KITS[s.kit]) return s;
  } catch (e) { /* storage unavailable */ }
  const p = PRESETS['Orbit groove'];
  return { kit: 'TR-808', bpm: p.bpm, swing: p.swing, master: 0.9, room: 0.3, steps: STEPS,
    preset: 'Orbit groove', pads: defaultPads('TR-808'), pattern: patternFrom('Orbit groove'), selected: 5 };
}

const state = loadState();
state.steps = STEPS;
state.pads.forEach((p) => { if (typeof p.dist !== 'number') p.dist = RADIUS; });
state.song = Object.assign(defaultSong(), state.song || {});
state.song.pads = Object.assign(defaultSong().pads, state.song.pads);
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ } }, 250);
}

// ---------- engine + scene ----------
const engine = new Engine(state);
const view = createScene($('#view'), {
  onPadDown: (i) => { hit(i, 1); selectPad(i); },
  onHover: showTip,
});

const colorOf = (i) => (state.pads[i].custom ? GROUP_COLOR.user : GROUP_COLOR[ROLES[state.pads[i].role].group]);
const padName = (i) => (state.pads[i].custom ? state.pads[i].custom.name : ROLES[state.pads[i].role].name);
function refreshPadLook(i) {
  view.setPadLook(i, PAD_LAYOUT[i].key, padName(i), colorOf(i));
}
for (let i = 0; i < N; i++) { refreshPadLook(i); view.setPadDistance(i, state.pads[i].dist, true); }

// ---------- distance ----------
function distWord(d) {
  if (d < 1.2) return 'right by your ear';
  if (d < 1.9) return 'close';
  if (d < 2.8) return 'normal';
  if (d < 3.9) return 'far';
  return 'very far';
}
const fmtDist = (d) => d.toFixed(1) + ' m';
function setDistance(i, d) {
  d = Math.round(d * 20) / 20;
  engine.setDistance(i, d);
  view.setPadDistance(i, d);
  if (rowDist[i]) { rowDist[i].value = d; rowDist[i].title = `Distance: ${fmtDist(d)} (${distWord(d)})`; }
  if (state.selected === i) { ed.dist.value = d; ed.distV.textContent = `${fmtDist(d)} · ${distWord(d)}`; }
  save();
}

// visuals that must line up with audio scheduled slightly in the future
const visQueue = [];
engine.onHit = (i, t, vel) => visQueue.push({ t, fn: () => view.flash(i, vel) });
engine.onStep = (step, t) => {
  if (step < 0) { setNow(-1); return; }
  recentSteps.push({ step, t });
  if (recentSteps.length > 32) recentSteps.shift();
  visQueue.push({ t, fn: () => setNow(step) });
};
requestAnimationFrame(function pump() {
  const now = engine.ctx.currentTime;
  songFrame();
  for (let k = visQueue.length - 1; k >= 0; k--) {
    if (visQueue[k].t <= now) { visQueue[k].fn(); visQueue.splice(k, 1); }
  }
  if (!engine.playing) visQueue.length = 0;
  requestAnimationFrame(pump);
});

// ---------- live playing + recording ----------
const recentSteps = [];
let recording = false;
function hit(i, vel) {
  engine.resume();
  engine.trigger(i, 0, vel);
  view.flash(i, vel);
  if (recording && engine.playing) {
    // quantize to the nearest scheduled 16th
    const now = engine.ctx.currentTime + 0.01;
    let best = null;
    for (const s of recentSteps) if (!best || Math.abs(s.t - now) < Math.abs(best.t - now)) best = s;
    const nextT = engine.nextTime + engine.stepOffset(engine.step);
    if (!best || Math.abs(nextT - now) < Math.abs(best.t - now)) best = { step: engine.step, t: nextT };
    if (!state.pattern[i][best.step]) { state.pattern[i][best.step] = 1; paintCell(i, best.step); save(); }
  }
}

// ---------- tooltip ----------
const tip = $('#tip');
function showTip(i, e) {
  if (i < 0 || !e) { tip.hidden = true; return; }
  const r = $('.stage').getBoundingClientRect();
  const p = state.pads[i];
  tip.innerHTML = `<b style="color:${colorOf(i)}">${PAD_LAYOUT[i].key}</b> &nbsp;<b>${padName(i)}</b><small>${padDirection(PAD_LAYOUT[i])} · ${fmtDist(p.dist)} away (${distWord(p.dist)})</small><small>${p.custom ? 'Your sound' : KITS[p.kit].label}</small>`;
  tip.style.left = e.clientX - r.left + 'px';
  tip.style.top = e.clientY - r.top + 'px';
  tip.hidden = false;
}

let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}

// ---------- sequencer grid ----------
const grid = $('#grid');
const cells = [];   // [pad][step] -> element
const rowNames = [];
const rowDist = [];
function buildGrid() {
  grid.innerHTML = '';
  grid.appendChild(document.createElement('div'));
  const dh = document.createElement('div');
  dh.className = 'steps-head dist-head';
  dh.innerHTML = '<span>near</span><span>far</span>';
  grid.appendChild(dh);
  for (let s = 0; s < STEPS; s++) {
    const h = document.createElement('div');
    h.className = 'steps-head' + (s % 4 === 0 ? ' beat' : '');
    h.textContent = s % 4 === 0 ? s / 4 + 1 : '·';
    grid.appendChild(h);
  }
  let ring = null;
  // order: top → high → mid → low (matches the figure from above to below)
  for (let i = 0; i < N; i++) {
    const L = PAD_LAYOUT[i];
    if (L.ring !== ring) {
      ring = L.ring;
      const lab = document.createElement('div');
      lab.className = 'ring-label';
      lab.textContent = RING_LABEL[ring];
      grid.appendChild(lab);
    }
    const name = document.createElement('div');
    name.className = 'row-name';
    name.innerHTML = `<span class="k">${L.key}</span><span class="n"></span><span class="d">${padDirection(L)}</span><span class="s"></span>`;
    name.addEventListener('click', () => { selectPad(i); hit(i, 0.9); });
    grid.appendChild(name);
    rowNames[i] = name;
    const dist = document.createElement('input');
    dist.type = 'range'; dist.className = 'row-dist';
    dist.min = 0.6; dist.max = 5; dist.step = 0.05; dist.value = state.pads[i].dist;
    dist.setAttribute('aria-label', `${L.key} distance`);
    dist.title = `Distance: ${fmtDist(state.pads[i].dist)} (${distWord(state.pads[i].dist)})`;
    dist.addEventListener('input', () => { setDistance(i, +dist.value); if (state.selected !== i) selectPad(i); });
    dist.addEventListener('change', () => hit(i, 0.9));
    grid.appendChild(dist);
    rowDist[i] = dist;
    cells[i] = [];
    for (let s = 0; s < STEPS; s++) {
      const c = document.createElement('div');
      c.className = 'cell' + (Math.floor(s / 4) % 2 ? ' q' : '');
      c.dataset.i = i; c.dataset.s = s;
      grid.appendChild(c);
      cells[i][s] = c;
    }
  }
  for (let i = 0; i < N; i++) refreshRow(i);
}

function refreshRow(i) {
  const el = rowNames[i], p = state.pads[i];
  el.style.setProperty('--c', colorOf(i));
  el.querySelector('.n').textContent = padName(i);
  el.querySelector('.s').textContent = p.solo ? 'SOLO' : '';
  el.classList.toggle('muted', p.mute);
  el.classList.toggle('sel', state.selected === i);
  for (let s = 0; s < STEPS; s++) { cells[i][s].style.setProperty('--c', colorOf(i)); paintCell(i, s); }
}
function paintCell(i, s) {
  const v = state.pattern[i][s], c = cells[i][s];
  c.classList.toggle('on', v === 1);
  c.classList.toggle('acc', v === 2);
}
let nowStep = -1;
function setNow(step) {
  if (nowStep >= 0) for (let i = 0; i < N; i++) cells[i][nowStep].classList.remove('now');
  nowStep = step;
  if (step >= 0) for (let i = 0; i < N; i++) cells[i][step].classList.add('now');
}

// click cycles off → hit → accent → off; shift-click goes straight to accent; drag paints the same value
let paint = null;
grid.addEventListener('pointerdown', (e) => {
  const c = e.target.closest('.cell');
  if (!c) return;
  e.preventDefault();
  const i = +c.dataset.i, s = +c.dataset.s;
  const cur = state.pattern[i][s];
  const v = e.shiftKey ? (cur === 2 ? 0 : 2) : (cur + 1) % 3;
  paint = v;
  setCell(i, s, v);
  if (v && !engine.playing) { engine.resume(); engine.trigger(i, 0, v === 2 ? 1 : 0.62); view.flash(i, v === 2 ? 1 : 0.62); }
});
grid.addEventListener('pointerover', (e) => {
  if (paint === null || !(e.buttons & 1)) return;
  const c = e.target.closest('.cell');
  if (c) setCell(+c.dataset.i, +c.dataset.s, paint);
});
window.addEventListener('pointerup', () => (paint = null));
function setCell(i, s, v) { state.pattern[i][s] = v; paintCell(i, s); save(); }

// ---------- pad editor ----------
const ed = {
  key: $('#edKey'), name: $('#edName'), dir: $('#edDir'), role: $('#edRole'), kit: $('#edKit'),
  vol: $('#edVol'), volV: $('#edVolV'), pitch: $('#edPitch'), pitchV: $('#edPitchV'),
  dist: $('#edDist'), distV: $('#edDistV'),
  mute: $('#edMute'), solo: $('#edSolo'),
};
function refreshSoundOptions() {
  const p = state.pads[state.selected];
  ed.role.innerHTML = '';
  const kit = document.createElement('optgroup'); kit.label = 'Drum kit';
  for (const [id, r] of Object.entries(ROLES)) kit.appendChild(new Option(r.name, id));
  ed.role.appendChild(kit);
  const ready = lib.filter((x) => x.buffer);
  if (ready.length || (p && p.custom)) {
    const yours = document.createElement('optgroup'); yours.label = 'Your sounds';
    for (const it of ready) yours.appendChild(new Option(it.name, 'user:' + it.id));
    if (p && p.custom && !isWhole(p.custom)) yours.appendChild(new Option('✂ ' + p.custom.name, 'cur'));
    ed.role.appendChild(yours);
  }
}
function isWhole(c) { const it = libItem(c.id); return it && (c.start || 0) < 0.001 && (c.end ?? it.duration) >= it.duration - 0.001; }
for (const [id, k] of Object.entries(KITS)) { ed.kit.add(new Option(k.label, id)); $('#kit').add(new Option(k.label, id)); }

function selectPad(i) {
  const prev = state.selected;
  state.selected = i;
  view.select(i);
  if (rowNames[prev]) rowNames[prev].classList.remove('sel');
  rowNames[i].classList.add('sel');
  const p = state.pads[i], L = PAD_LAYOUT[i];
  ed.key.textContent = L.key;
  ed.key.style.color = colorOf(i);
  ed.name.textContent = padName(i);
  refreshSoundOptions();
  ed.dir.textContent = padDirection(L) + (L.ring === 'mid' ? ' · ear level' : '');
  ed.role.value = p.custom ? (isWhole(p.custom) ? 'user:' + p.custom.id : 'cur') : p.role;
  ed.kit.value = p.kit;
  ed.kit.disabled = !!p.custom;
  ed.vol.value = p.vol; ed.volV.textContent = Math.round(p.vol * 100) + '%';
  ed.dist.value = p.dist; ed.distV.textContent = `${fmtDist(p.dist)} · ${distWord(p.dist)}`;
  ed.pitch.value = p.pitch; ed.pitchV.textContent = (p.pitch > 0 ? '+' : '') + p.pitch + ' st';
  updateToPad();
  ed.mute.setAttribute('aria-pressed', p.mute);
  ed.solo.setAttribute('aria-pressed', p.solo);
  save();
}
const sel = () => state.pads[state.selected];
function padChanged(reload) {
  const i = state.selected;
  refreshPadLook(i); refreshRow(i); selectPad(i);
  if (reload && sel().custom) hit(i, 0.9);
  else if (reload) engine.load(engine.urlFor(i)).then(() => hit(i, 0.9));
}
ed.role.addEventListener('change', () => {
  const v = ed.role.value;
  if (v === 'cur') return;
  if (v.startsWith('user:')) {
    const it = libItem(v.slice(5));
    sel().custom = { id: it.id, name: it.name, start: 0, end: it.duration };
  } else { sel().role = v; sel().custom = null; }
  padChanged(true);
});
ed.kit.addEventListener('change', () => { sel().kit = ed.kit.value; padChanged(true); });
ed.vol.addEventListener('input', () => { sel().vol = +ed.vol.value; ed.volV.textContent = Math.round(sel().vol * 100) + '%'; save(); });
ed.pitch.addEventListener('input', () => { sel().pitch = +ed.pitch.value; ed.pitchV.textContent = (sel().pitch > 0 ? '+' : '') + sel().pitch + ' st'; save(); });
ed.pitch.addEventListener('change', () => hit(state.selected, 0.9));
ed.dist.addEventListener('input', () => setDistance(state.selected, +ed.dist.value));
ed.dist.addEventListener('change', () => hit(state.selected, 0.9));
$('#distReset').addEventListener('click', () => { for (let i = 0; i < N; i++) setDistance(i, RADIUS); });
ed.mute.addEventListener('click', () => { sel().mute = !sel().mute; padChanged(); });
ed.solo.addEventListener('click', () => { sel().solo = !sel().solo; padChanged(); });
$('#edPlay').addEventListener('click', () => hit(state.selected, 1));
$('#edClear').addEventListener('click', () => { state.pattern[state.selected].fill(0); refreshRow(state.selected); save(); });

// ---------- top bar ----------
const bpm = $('#bpm'), swing = $('#swing'), room = $('#room'), master = $('#master');
function syncBar() {
  bpm.value = state.bpm;
  swing.value = state.swing; $('#swingV').textContent = Math.round(state.swing * 100) + '%';
  room.value = state.room; $('#roomV').textContent = Math.round(state.room * 100) + '%';
  master.value = state.master; $('#masterV').textContent = Math.round(state.master * 100) + '%';
  $('#kit').value = state.pads.every((p) => p.kit === state.kit) ? state.kit : state.kit;
}
bpm.addEventListener('change', () => { state.bpm = Math.max(50, Math.min(220, +bpm.value || 100)); bpm.value = state.bpm; save(); });
swing.addEventListener('input', () => { state.swing = +swing.value; syncBar(); save(); });
room.addEventListener('input', () => { state.room = +room.value; engine.applyMix(); syncBar(); save(); });
master.addEventListener('input', () => { state.master = +master.value; engine.applyMix(); syncBar(); save(); });

$('#kit').addEventListener('change', async (e) => {
  state.kit = e.target.value;
  state.pads.forEach((p) => (p.kit = state.kit));
  for (let i = 0; i < N; i++) refreshPadLook(i), refreshRow(i);
  selectPad(state.selected);
  toast('Loading ' + KITS[state.kit].label + '…', 6000);
  await engine.loadAll();
  toast(KITS[state.kit].label + ' ready');
});

const preset = $('#preset');
for (const name of Object.keys(PRESETS)) preset.add(new Option(name, name));
preset.add(new Option('Custom', 'Custom'));
preset.value = state.preset && PRESETS[state.preset] ? state.preset : 'Custom';
preset.addEventListener('change', () => {
  const name = preset.value;
  if (!PRESETS[name]) return;
  state.preset = name;
  state.pattern = patternFrom(name);
  state.bpm = PRESETS[name].bpm; state.swing = PRESETS[name].swing;
  syncBar();
  for (let i = 0; i < N; i++) refreshRow(i);
  save();
});
grid.addEventListener('pointerdown', (e) => { if (e.target.closest('.cell') && state.preset !== 'Custom') { state.preset = 'Custom'; preset.value = 'Custom'; } });

$('#clearAll').addEventListener('click', () => {
  state.pattern = emptyPattern(); state.preset = 'Empty'; preset.value = 'Empty';
  for (let i = 0; i < N; i++) refreshRow(i);
  save();
});
$('#seqToggle').addEventListener('click', (e) => {
  const c = $('#seq').classList.toggle('collapsed');
  e.target.textContent = c ? 'Show' : 'Hide';
  e.target.setAttribute('aria-expanded', !c);
});

function togglePlay() {
  if (engine.playing) {
    engine.stop();
    if (state.song.sync && song.playing) { song.stop(); song.offset = 0; }
  } else {
    const t0 = engine.start();
    if (state.song.sync && song.buffer) song.play(t0, 0);
  }
  updateSongButtons();
  document.body.classList.toggle('playing', engine.playing);
  $('#play').setAttribute('aria-label', engine.playing ? 'Stop' : 'Play');
}
$('#play').addEventListener('click', togglePlay);
function toggleRec() {
  recording = !recording;
  $('#rec').setAttribute('aria-pressed', recording);
  if (recording && !engine.playing) togglePlay();
}
$('#rec').addEventListener('click', toggleRec);

document.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.views button').forEach((x) => x.classList.toggle('on', x === b));
  view.setView(b.dataset.view);
}));

$('#export').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const withSong = state.song.sync && song.buffer;
  if (!state.pattern.some((r) => r.some(Boolean)) && !withSong) { toast('The pattern is empty'); return; }
  btn.disabled = true; btn.textContent = 'Rendering…';
  try {
    const blob = await engine.renderWav(4);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orbit-pad-${state.bpm}bpm.wav`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(withSong ? 'Exported a binaural WAV, song length.' : 'Exported a binaural WAV (4 loops).');
  } catch (err) {
    console.error(err); toast('Export failed: ' + err.message, 4000);
  }
  btn.disabled = false; btn.textContent = 'Export WAV';
});

// ---------- keyboard ----------
const keyToPad = Object.fromEntries(PAD_LAYOUT.map((p, i) => ['Key' + p.key, i]));
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
  if (e.code === 'Escape') { engine.stopVoices(); song.stop(); stopPreview(); updateSongButtons(); return; }
  if (e.code === 'KeyR' && e.shiftKey) { toggleRec(); return; }
  if (e.repeat) return;
  const i = keyToPad[e.code];
  if (i !== undefined) { hit(i, e.shiftKey ? 1 : 0.85); selectPad(i); }
});

// ---------- your sounds ----------
const lib = [];            // { id, name, duration, buffer, loading }
let libSel = null;         // selected library item id
let selRegion = null;      // { start, end } in seconds, on the selected item
const song = new SongPlayer(engine, state.song);
engine.song = song;
const libItem = (id) => lib.find((x) => x.id === id);
const curItem = () => libItem(libSel);
const fmtTime = (t) => { t = Math.max(0, t || 0); return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); };
const decode = (ab) => new Promise((res, rej) => engine.ctx.decodeAudioData(ab.slice(0), res, rej));
// order chops land on the pads: the keyboard rows A–K, Q–R, Z–V, then T
const CHOP_ORDER = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'Q', 'W', 'E', 'R', 'Z', 'X', 'C', 'V', 'T'].map((k) => PAD_LAYOUT.findIndex((p) => p.key === k));
const padLabel = (i) => `${PAD_LAYOUT[i].key} · ${padDirection(PAD_LAYOUT[i])}`;

function showTab(id) {
  document.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.tab === id; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  $('#seqPanel').hidden = id !== 'seqPanel';
  $('#libPanel').hidden = id !== 'libPanel';
  $('#seq').classList.toggle('lib-mode', id === 'libPanel');
  $('#seq').classList.remove('collapsed'); $('#seqToggle').textContent = 'Hide';
  if (id === 'libPanel') requestAnimationFrame(drawWave);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

async function importFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|aiff?|webm|caf)$/i.test(f.name));
  if (!list.length) { toast("Those files aren't audio"); return; }
  showTab('libPanel');
  engine.resume();
  for (const f of list) {
    const item = { id: newId(), name: cleanName(f.name), duration: 0, buffer: null, loading: true };
    lib.push(item); renderLibList();
    try {
      const ab = await f.arrayBuffer();
      item.buffer = await decode(ab);
      item.duration = item.buffer.duration;
      engine.userBuffers.set(item.id, item.buffer);
      db.put({ id: item.id, name: item.name, data: ab, added: Date.now() });
      item.loading = false;
      selectLib(item.id);
    } catch (e) {
      console.warn(e);
      lib.splice(lib.indexOf(item), 1);
      toast(`Couldn't read ${f.name}. The format may not be supported by this browser.`, 4500);
    }
    renderLibList();
  }
  refreshSoundOptions(); selectPad(state.selected);
}
$('#file').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });

// drop files anywhere
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropCover').hidden = false; });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropCover').hidden = true; } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#dropCover').hidden = true;
  importFiles(e.dataTransfer.files);
});

function renderLibList() {
  const ul = $('#libList');
  ul.innerHTML = '';
  for (const it of lib) {
    const li = document.createElement('li');
    li.classList.toggle('sel', it.id === libSel);
    const uses = state.pads.filter((p) => p.custom && p.custom.id === it.id).length;
    li.innerHTML = `<span class="nm"></span>${it.loading ? '<span class="ld"></span>' : ''}${state.song.id === it.id ? '<span class="tag">SONG</span>' : ''}${uses ? `<span class="du">${uses} pad${uses > 1 ? 's' : ''}</span>` : ''}<span class="du">${it.loading ? '' : fmtTime(it.duration)}</span>`;
    li.querySelector('.nm').textContent = it.name;
    li.title = it.name;
    if (!it.loading) li.addEventListener('click', () => selectLib(it.id));
    ul.appendChild(li);
  }
  $('#libCount').textContent = lib.length ? lib.length : '';
  $('#libEmpty').hidden = !!libSel;
  $('#libDetail').hidden = !libSel;
}

function selectLib(id) {
  if (libSel !== id) { stopPreview(); selRegion = null; }
  libSel = id;
  const it = curItem();
  renderLibList();
  if (!it) return;
  $('#ldName').value = it.name;
  $('#ldDur').textContent = fmtTime(it.duration);
  updateSelInfo(); updateSongCard(); updateToPad();
  requestAnimationFrame(drawWave);
}

$('#ldName').addEventListener('change', (e) => {
  const it = curItem(); if (!it) return;
  it.name = e.target.value.trim().slice(0, 40) || it.name;
  e.target.value = it.name;
  db.all().then((recs) => { const r = recs.find((x) => x.id === it.id); if (r) db.put({ ...r, name: it.name }); });
  renderLibList(); refreshSoundOptions(); updateSongMini();
});

$('#ldDelete').addEventListener('click', () => {
  const it = curItem(); if (!it) return;
  if (!confirm(`Delete "${it.name}" from this browser? Pads using it go back to drum sounds.`)) return;
  stopPreview();
  if (state.song.id === it.id) removeSong();
  state.pads.forEach((p, i) => { if (p.custom && p.custom.id === it.id) { p.custom = null; refreshPadLook(i); refreshRow(i); } });
  engine.userBuffers.delete(it.id);
  db.del(it.id);
  lib.splice(lib.indexOf(it), 1);
  libSel = null;
  renderLibList(); refreshSoundOptions(); selectPad(state.selected); save();
});

// ----- waveform -----
const wave = $('#wave');
function wavePeaks(it, w) {
  if (it.peaks && it.peaks.w === w) return it.peaks;
  const chans = [...Array(it.buffer.numberOfChannels)].map((_, c) => it.buffer.getChannelData(c));
  const len = it.buffer.length, per = len / w, mins = new Float32Array(w), maxs = new Float32Array(w);
  const stride = Math.max(1, Math.floor(per / 200));
  for (let x = 0; x < w; x++) {
    let lo = 0, hi = 0;
    for (let k = Math.floor(x * per); k < Math.min(len, Math.floor((x + 1) * per)); k += stride) {
      for (const ch of chans) { const v = ch[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    mins[x] = lo; maxs[x] = hi;
  }
  return (it.peaks = { w, mins, maxs });
}
function drawWave() {
  const it = curItem();
  if (!it || !it.buffer || $('#libPanel').hidden) return;
  const dpr = Math.min(devicePixelRatio, 2);
  const W = wave.clientWidth, H = wave.clientHeight;
  if (!W) return;
  if (wave.width !== Math.round(W * dpr)) { wave.width = Math.round(W * dpr); wave.height = Math.round(H * dpr); }
  const g = wave.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const pk = wavePeaks(it, Math.round(W));
  const tx = (t) => (t / it.duration) * W;
  if (selRegion) {
    g.fillStyle = 'rgba(255, 209, 102, 0.14)';
    g.fillRect(tx(selRegion.start), 0, tx(selRegion.end) - tx(selRegion.start), H);
  }
  const mid = H / 2;
  for (let x = 0; x < pk.w; x++) {
    const t = (x / W) * it.duration;
    const inSel = selRegion && t >= selRegion.start && t <= selRegion.end;
    g.fillStyle = inSel ? '#ffd166' : '#5b6178';
    const y1 = mid - pk.maxs[x] * mid * 0.92, y2 = mid - pk.mins[x] * mid * 0.92;
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  // where pads are cut from this sound
  g.font = '600 10px "JetBrains Mono", monospace';
  state.pads.forEach((p, i) => {
    if (!p.custom || p.custom.id !== it.id || isWhole(p.custom)) return;
    const x = tx(p.custom.start);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x, 0, 1, H);
    g.fillStyle = '#fff'; g.fillText(PAD_LAYOUT[i].key, x + 3, 11);
  });
  if (state.song.id === it.id && song.buffer) {
    const x = tx(song.position());
    g.fillStyle = '#3ee0ff'; g.fillRect(x - 1, 0, 2, H);
  }
}
new ResizeObserver(() => drawWave()).observe(wave);
let waveDrag = null;
const waveT = (e) => { const r = wave.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * curItem().duration; };
wave.addEventListener('pointerdown', (e) => {
  const it = curItem(); if (!it || !it.buffer) return;
  wave.setPointerCapture(e.pointerId);
  waveDrag = { t0: waveT(e), x0: e.clientX, moved: false };
});
wave.addEventListener('pointermove', (e) => {
  if (!waveDrag) return;
  if (Math.abs(e.clientX - waveDrag.x0) > 4) waveDrag.moved = true;
  if (!waveDrag.moved) return;
  const t = waveT(e);
  selRegion = { start: Math.min(t, waveDrag.t0), end: Math.max(t, waveDrag.t0) };
  updateSelInfo(); drawWave();
});
wave.addEventListener('pointerup', (e) => {
  if (!waveDrag) return;
  const moved = waveDrag.moved; waveDrag = null;
  if (moved) return;
  const it = curItem();
  if (state.song.id === it.id && song.buffer) { song.seek(waveT(e)); updateSongButtons(); }
  else { selRegion = null; updateSelInfo(); }
  drawWave();
});
function updateSelInfo() {
  const it = curItem();
  if (selRegion && selRegion.end - selRegion.start < 0.02) selRegion = null;
  $('#selInfo').textContent = selRegion
    ? `Selected ${fmtTime(selRegion.start)}–${fmtTime(selRegion.end)} (${(selRegion.end - selRegion.start).toFixed(2)} s)`
    : (state.song.id === (it && it.id) ? 'Click the waveform to jump · drag to pick a part' : 'Drag across the waveform to pick a part. Without a selection the whole file is used.');
  $('#selClear').hidden = !selRegion;
}
$('#selClear').addEventListener('click', () => { selRegion = null; updateSelInfo(); drawWave(); });

// ----- preview (plain, not spatial) -----
let preview = null;
function stopPreview() {
  if (!preview) return;
  try { preview.stop(); } catch (e) { /* done */ }
  preview = null; $('#ldPreview').textContent = '▶ Preview';
}
$('#ldPreview').addEventListener('click', () => {
  if (preview) { stopPreview(); return; }
  const it = curItem(); if (!it || !it.buffer) return;
  engine.resume();
  const src = engine.ctx.createBufferSource();
  src.buffer = it.buffer;
  src.connect(engine.g.master);
  const r = selRegion || { start: 0, end: it.duration };
  src.start(0, r.start, r.end - r.start);
  src.onended = () => { if (preview === src) stopPreview(); };
  preview = src; $('#ldPreview').textContent = '■ Stop';
});

// ----- pads -----
function updateToPad() {
  $('#toPadKey').textContent = PAD_LAYOUT[state.selected].key;
  $('#toPadDir').textContent = padDirection(PAD_LAYOUT[state.selected]);
}
$('#toPad').addEventListener('click', () => {
  const it = curItem(); if (!it || !it.buffer) return;
  const r = selRegion || { start: 0, end: it.duration };
  const i = state.selected;
  state.pads[i].custom = { id: it.id, name: selRegion ? it.name + ' ✂' : it.name, start: r.start, end: r.end };
  refreshPadLook(i); refreshRow(i); selectPad(i); renderLibList(); drawWave();
  hit(i, 1);
  toast(`${it.name} is on pad ${PAD_LAYOUT[i].key} (${padDirection(PAD_LAYOUT[i])})`);
});
$('#chopGo').addEventListener('click', () => {
  const it = curItem(); if (!it || !it.buffer) return;
  const n = +$('#chopN').value;
  const r = selRegion || { start: 0, end: Math.min(8, it.duration) };
  const slices = chop(it.buffer, r.start, r.end, n);
  const pads = n === 4 ? [13, 14, 15, 16] : CHOP_ORDER.slice(0, n);
  slices.forEach((sl, k) => {
    const i = pads[k];
    state.pads[i].custom = { id: it.id, name: `${it.name} ${k + 1}`, start: sl.start, end: sl.end };
    refreshPadLook(i); refreshRow(i);
  });
  selectPad(state.selected); renderLibList(); drawWave(); save();
  const keys = pads.slice(0, slices.length).map((i) => PAD_LAYOUT[i].key).join(' ');
  toast(`Chopped into ${slices.length} slices on ${keys}`, 3500);
  slices.forEach((_, k) => setTimeout(() => hit(pads[k], 0.85), k * 140));
});

// ----- song -----
const modeBox = $('#songMode');
for (const [m, def] of Object.entries(SONG_MODES)) {
  const b = document.createElement('button');
  b.textContent = def.label; b.dataset.mode = m;
  b.addEventListener('click', () => { state.song.mode = m; song.rewire(); updateSongCard(); updateSongMini(); save(); });
  modeBox.appendChild(b);
}
function updateSongCard() {
  const it = curItem();
  const on = !!it && state.song.id === it.id;
  $('#songOff').hidden = on; $('#songOn').hidden = !on;
  if (!on) return;
  const c = state.song;
  modeBox.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === c.mode));
  const parts = $('#songParts');
  parts.innerHTML = '';
  for (const [key, label] of SONG_MODES[c.mode].parts) {
    const wrap = document.createElement('label');
    wrap.className = 'part';
    wrap.innerHTML = `<span>${label}</span>`;
    const s = document.createElement('select');
    s.className = 'mini-sel';
    PAD_LAYOUT.forEach((_, i) => s.add(new Option(padLabel(i), i)));
    s.value = c.pads[key];
    s.addEventListener('change', () => { c.pads[key] = +s.value; song.rewire(); save(); });
    wrap.appendChild(s); parts.appendChild(wrap);
  }
  parts.hidden = !SONG_MODES[c.mode].parts.length;
  $('#orbitCtl').hidden = c.mode !== 'orbit';
  $('#orbitSecs').value = c.orbitSecs; $('#orbitSecsV').textContent = c.orbitSecs + ' s';
  $('#orbitEl').value = c.orbitEl; $('#orbitElV').textContent = (c.orbitEl > 0 ? '+' : '') + c.orbitEl + '°';
  $('#songVol').value = c.vol; $('#songVolV').textContent = Math.round(c.vol * 100) + '%';
  $('#songSync').checked = c.sync; $('#songLoop').checked = c.loop;
  updateSongButtons(); updateSelInfo();
}
function updateSongButtons() {
  $('#songPlay').textContent = song.playing ? '❚❚ Pause' : '▶ Play';
}
function updateSongMini() {
  const it = state.song.id && libItem(state.song.id);
  $('#songMini').hidden = !it;
  if (it) $('#songMini').textContent = `♪ ${it.name} · ${SONG_MODES[state.song.mode].label}`;
}
function removeSong() {
  song.stop(); song.setBuffer(null); state.song.id = null;
  view.setOrb(null);
  updateSongCard(); renderLibList(); updateSongMini(); save();
}
$('#useSong').addEventListener('click', () => {
  const it = curItem(); if (!it || !it.buffer) return;
  song.stop();
  state.song.id = it.id;
  song.setBuffer(it.buffer);
  selRegion = null;
  updateSongCard(); renderLibList(); updateSongMini(); drawWave(); save();
  song.play(); updateSongButtons();
});
$('#songRemove').addEventListener('click', removeSong);
$('#songPlay').addEventListener('click', () => { if (song.playing) song.stop(); else song.play(); updateSongButtons(); });
song.onEnd = () => updateSongButtons();
$('#songVol').addEventListener('input', (e) => { song.setVolume(+e.target.value); $('#songVolV').textContent = Math.round(state.song.vol * 100) + '%'; save(); });
$('#songSync').addEventListener('change', (e) => { state.song.sync = e.target.checked; save(); });
$('#songLoop').addEventListener('change', (e) => { state.song.loop = e.target.checked; if (song.route) song.route.src.loop = state.song.loop; save(); });
$('#orbitSecs').addEventListener('input', (e) => { state.song.orbitSecs = +e.target.value; $('#orbitSecsV').textContent = state.song.orbitSecs + ' s'; save(); });
$('#orbitEl').addEventListener('input', (e) => { state.song.orbitEl = +e.target.value; $('#orbitElV').textContent = (state.song.orbitEl > 0 ? '+' : '') + state.song.orbitEl + '°'; save(); });
let lastTimeLabel = '';
function songFrame() {
  const lv = song.tick();
  if (lv) for (const { pad, level } of lv) if (pad >= 0) view.pulse(pad, level * 3.5);
  if (song.playing && state.song.mode === 'orbit') view.setOrb(orbitPos(song.position(), state.song.orbitSecs, state.song.orbitEl), lv && lv[0] ? lv[0].level * 3 : 0);
  else view.setOrb(null);
  if (song.buffer) {
    const label = `${fmtTime(song.position())} / ${fmtTime(song.duration)}`;
    if (label !== lastTimeLabel) { $('#songTime').textContent = label; lastTimeLabel = label; }
    if (song.playing && !$('#libPanel').hidden && state.song.id === libSel) drawWave();
  }
}

async function loadLibrary() {
  const recs = (await db.all()).sort((a, b) => (a.added || 0) - (b.added || 0));
  for (const r of recs) lib.push({ id: r.id, name: r.name, duration: 0, buffer: null, loading: true, rec: r });
  renderLibList();
  for (const it of lib) {
    try {
      it.buffer = await decode(it.rec.data);
      it.duration = it.buffer.duration;
      engine.userBuffers.set(it.id, it.buffer);
    } catch (e) { console.warn('could not decode', it.name, e); }
    it.loading = false; delete it.rec;
  }
  for (let k = lib.length - 1; k >= 0; k--) if (!lib[k].buffer) lib.splice(k, 1);
  // pads whose sound is gone fall back to their drum sound
  state.pads.forEach((p, i) => {
    if (p.custom && !engine.userBuffers.has(p.custom.id)) p.custom = null;
    refreshPadLook(i); refreshRow(i);
  });
  const s = state.song.id && libItem(state.song.id);
  if (s) song.setBuffer(s.buffer); else state.song.id = null;
  renderLibList(); refreshSoundOptions(); selectPad(state.selected); updateSongMini();
  if (lib.length) selectLib(s ? s.id : lib[lib.length - 1].id);
}

// ---------- boot ----------
buildGrid();
syncBar();
selectPad(state.selected ?? 5);
const enter = $('#enter');
engine.loadAll((d, t) => { enter.textContent = `Loading samples… ${d}/${t}`; }).then((bufs) => {
  const failed = bufs.filter((b) => !b).length;
  enter.disabled = false;
  enter.textContent = failed ? `Enter (${failed} samples failed to load)` : 'Enter';
});
enter.addEventListener('click', () => {
  engine.resume();
  $('#intro').classList.add('gone');
  setTimeout(() => $('#intro').remove(), 500);
  // a little "hello" around the head so you immediately hear the space
  [5, 7, 9, 11].forEach((i, k) => setTimeout(() => hit(i, 0.7), 250 + k * 170));
});

loadLibrary();
window.__orbit = { state, engine, view, song, lib };
