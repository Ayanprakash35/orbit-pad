import { PAD_LAYOUT, HEAD, RADIUS, padPosition } from './pads.js';
import { sampleUrl, kitPitch } from './kits.js';
import { routeSong, automateOrbit } from './song.js';

const AC = window.AudioContext || window.webkitAudioContext;

function placeListener(ctx) {
  const L = ctx.listener;
  if (L.positionX) {
    L.positionX.value = HEAD.x; L.positionY.value = HEAD.y; L.positionZ.value = HEAD.z;
    L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else {
    L.setPosition(HEAD.x, HEAD.y, HEAD.z);
    L.setOrientation(0, 0, -1, 0, 1, 0);
  }
}

export const DIST_MIN = 0.6, DIST_MAX = 5;

function makePanner(ctx) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  // Distance loudness is done by hand below (the built-in models can't get louder than
  // refDistance), so the panner only handles direction.
  p.distanceModel = 'linear';
  p.rolloffFactor = 0;
  return p;
}

// How a source at distance d (metres) should sound: louder and drier up close,
// quieter, duller and more reverberant far away.
export function distanceMix(d) {
  const gain = Math.min(2.2, Math.pow(RADIUS / d, 0.9));
  const wet = Math.min(1.6, Math.pow(d / RADIUS, 1.3));      // reverb send relative to the default
  const t = Math.max(0, (d - RADIUS) / (DIST_MAX - RADIUS));  // 0 at default, 1 at furthest
  const cutoff = 20000 * Math.pow(3800 / 20000, t);           // air absorption
  return { gain, wet, cutoff };
}

function setPos(p, pos) {
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
  else p.setPosition(pos.x, pos.y, pos.z);
}

// Applies pad i's distance to a graph (live or offline).
export function applyDistance(g, i, d, immediate = false) {
  const L = PAD_LAYOUT[i];
  const ch = g.chains[i];
  setPos(ch.panner, padPosition(L.az, L.el, d));
  const m = distanceMix(d);
  if (immediate) {
    ch.dry.gain.value = m.gain; ch.wet.gain.value = m.gain * m.wet; ch.filter.frequency.value = m.cutoff;
    return;
  }
  const now = ch.panner.context.currentTime;
  ch.dry.gain.setTargetAtTime(m.gain, now, 0.03);
  ch.wet.gain.setTargetAtTime(m.gain * m.wet, now, 0.03);
  ch.filter.frequency.setTargetAtTime(m.cutoff, now, 0.03);
}

// A short, soft room impulse: gives the HRTF cues something to sit in, so the
// sounds feel outside your head instead of inside it.
function makeImpulse(ctx, seconds = 1.4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = c ? 1337 : 4242;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      const n = seed / 1073741823.5 - 1;
      const t = i / len;
      d[i] = n * Math.pow(1 - t, 3.2) * (i < 90 ? i / 90 : 1);
    }
  }
  return buf;
}

// Builds the full mix graph in any context (live or offline).
function buildGraph(ctx, impulse) {
  placeListener(ctx);
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4;
  comp.attack.value = 0.003; comp.release.value = 0.15;
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const conv = ctx.createConvolver();
  conv.buffer = impulse || makeImpulse(ctx);
  dry.connect(master);
  wet.connect(conv); conv.connect(master);
  master.connect(comp); comp.connect(ctx.destination);
  // per pad: filter (air) → panner (direction) → dry/wet sends (distance)
  const chains = PAD_LAYOUT.map(() => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.Q.value = 0.5; filter.frequency.value = 20000;
    const panner = makePanner(ctx);
    const pd = ctx.createGain(), pw = ctx.createGain();
    filter.connect(panner); panner.connect(pd); panner.connect(pw);
    pd.connect(dry); pw.connect(wet);
    return { filter, panner, dry: pd, wet: pw, input: filter };
  });
  return { master, dry, wet, conv, chains };
}

export class Engine {
  constructor(state) {
    this.state = state;            // shared app state (pads, pattern, bpm...)
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.impulse = makeImpulse(this.ctx);
    this.g = buildGraph(this.ctx, this.impulse);
    this.buffers = new Map();      // url -> AudioBuffer
    this.userBuffers = new Map();  // imported sound id -> AudioBuffer
    this.active = [];              // pad -> last voice (imported sounds cut themselves off)
    this.song = null;              // SongPlayer, set by the app
    this.loading = new Map();      // url -> Promise
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.onHit = () => {};
    this.onStep = () => {};
    this.applyMix();
    this.state.pads.forEach((p, i) => applyDistance(this.g, i, p.dist, true));
  }

  setDistance(i, d) { this.state.pads[i].dist = d; applyDistance(this.g, i, d); }

  resume() { if (this.ctx.state !== 'running') return this.ctx.resume(); }

  applyMix() {
    const s = this.state;
    this.g.master.gain.value = s.master;
    this.g.dry.gain.value = 1;
    this.g.wet.gain.value = s.room * 0.55;
  }

  urlFor(i) { const p = this.state.pads[i]; return p.custom ? null : sampleUrl(p.kit, p.role); }

  padBuffer(i) {
    const p = this.state.pads[i];
    return p.custom ? this.userBuffers.get(p.custom.id) : this.buffers.get(this.urlFor(i));
  }

  padPitch(i) { const p = this.state.pads[i]; return p.custom ? 0 : kitPitch(p.kit, p.role); }

  load(url) {
    if (this.buffers.has(url)) return Promise.resolve(this.buffers.get(url));
    if (this.loading.has(url)) return this.loading.get(url);
    const pr = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
      .then((buf) => { this.buffers.set(url, buf); this.loading.delete(url); return buf; })
      .catch((e) => { this.loading.delete(url); console.warn('sample failed', e); return null; });
    this.loading.set(url, pr);
    return pr;
  }

  loadAll(onProgress) {
    const urls = [...new Set(this.state.pads.map((_, i) => this.urlFor(i)).filter(Boolean))];
    let done = 0;
    return Promise.all(urls.map((u) => this.load(u).then((b) => { done++; onProgress && onProgress(done, urls.length); return b; })));
  }

  // Schedules one hit of pad i in context ctx/graph g.
  static voice(ctx, g, buf, pad, i, time, vel, rolePitch, active) {
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (pad.pitch + rolePitch) / 12);
    const amp = ctx.createGain();
    amp.gain.value = vel * pad.vol;
    src.connect(amp); amp.connect(g.chains[i].input);
    const t = Math.max(time, ctx.currentTime);
    const c = pad.custom;
    if (c) {
      // imported sounds play their region, and a new hit on the same pad cuts the old one
      const len = Math.max(0.01, (c.end ?? buf.duration) - (c.start || 0));
      src.start(t, c.start || 0, len);
      if (active) {
        const prev = active[i];
        if (prev) { prev.amp.gain.setTargetAtTime(0, t, 0.006); try { prev.src.stop(t + 0.05); } catch (e) { /* done */ } }
        active[i] = { src, amp };
      }
    } else src.start(t);
  }

  stopVoices() {
    const now = this.ctx.currentTime;
    this.active.forEach((v) => { if (v) { v.amp.gain.setTargetAtTime(0, now, 0.01); try { v.src.stop(now + 0.06); } catch (e) { /* done */ } } });
    this.active = [];
  }

  audible(i) {
    const pads = this.state.pads;
    const anySolo = pads.some((p) => p.solo);
    return anySolo ? pads[i].solo : !pads[i].mute;
  }

  trigger(i, time = 0, vel = 1) {
    const pad = this.state.pads[i];
    const buf = this.padBuffer(i);
    if (!buf) { if (!pad.custom) this.load(this.urlFor(i)); return; }
    Engine.voice(this.ctx, this.g, buf, pad, i, time || this.ctx.currentTime, vel, this.padPitch(i), this.active);
  }

  stepDur() { return 60 / this.state.bpm / 4; }

  stepOffset(step) {
    // Swing delays every off-beat 16th.
    return step % 2 ? this.stepDur() * this.state.swing * 0.5 : 0;
  }

  start() {
    if (this.playing) return;
    this.resume();
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), 25);
    const t0 = this.nextTime;
    this.schedule();
    return t0;
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    this.onStep(-1, 0);
  }

  schedule() {
    const ahead = 0.12;
    const { pattern, steps } = this.state;
    while (this.nextTime < this.ctx.currentTime + ahead) {
      const t = this.nextTime + this.stepOffset(this.step);
      for (let i = 0; i < pattern.length; i++) {
        const v = pattern[i][this.step];
        if (v && this.audible(i)) {
          const vel = v === 2 ? 1 : 0.62;
          this.trigger(i, t, vel);
          this.onHit(i, t, vel);
        }
      }
      this.onStep(this.step, t);
      this.nextTime += this.stepDur();
      this.step = (this.step + 1) % steps;
    }
  }

  // Offline binaural bounce of the pattern → stereo WAV Blob.
  // If a song is set to start with the sequencer, the bounce runs the length of the song.
  async renderWav(loops = 4) {
    await this.loadAll();
    const s = this.state;
    const sr = this.ctx.sampleRate;
    const loopDur = s.steps * this.stepDur();
    const song = this.song && this.song.buffer && s.song.sync ? this.song : null;
    const hasPattern = s.pattern.some((r) => r.some(Boolean));
    if (song) loops = hasPattern ? Math.ceil(Math.min(song.duration, 600) / loopDur) : 0;
    const dur = Math.max(loops * loopDur, song ? Math.min(song.duration, 600) : 0) + 2.0;
    const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const g = buildGraph(off, this.impulse);
    g.master.gain.value = s.master;
    g.wet.gain.value = s.room * 0.55;
    s.pads.forEach((p, i) => applyDistance(g, i, p.dist, true));
    if (song) {
      const r = routeSong(off, g, song.buffer, { ...s.song, loop: false });
      r.src.start(0.02, 0, Math.min(song.duration, 600));
      if (r.orbit) automateOrbit(off, r.orbit, s.song, 0.02, 0, Math.min(song.duration, 600));
    }
    const active = [];
    for (let l = 0; l < loops; l++) {
      for (let st = 0; st < s.steps; st++) {
        const t = 0.02 + (l * s.steps + st) * this.stepDur() + this.stepOffset(st);
        for (let i = 0; i < s.pattern.length; i++) {
          const v = s.pattern[i][st];
          if (!v || !this.audible(i)) continue;
          const pad = s.pads[i];
          Engine.voice(off, g, this.padBuffer(i), pad, i, t, v === 2 ? 1 : 0.62, this.padPitch(i), active);
        }
      }
    }
    const out = await off.startRendering();
    return encodeWav(out);
  }
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true); w(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  let peak = 0;
  for (const c of chans) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(c[i]));
  const norm = peak > 0.98 ? 0.98 / peak : 1;
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i] * norm));
    data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([data], { type: 'audio/wav' });
}
