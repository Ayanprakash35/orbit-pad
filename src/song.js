import { HEAD, RADIUS } from './pads.js';
import { distanceMix } from './audio.js';

// How a full track is spread around the listener.
export const SONG_MODES = {
  pad:    { label: 'One spot',        parts: [['single', 'Whole track']] },
  stereo: { label: 'Left / Right',    parts: [['left', 'Left channel'], ['right', 'Right channel']] },
  bands:  { label: 'Frequency bands', parts: [['low', 'Bass (under 250 Hz)'], ['lowmid', 'Low mids (250 Hz–1.5 kHz)'], ['highmid', 'High mids (1.5–6 kHz)'], ['high', 'Highs (over 6 kHz)']] },
  orbit:  { label: 'Orbit (8D)',      parts: [] },
};

export const defaultSong = () => ({
  id: null, mode: 'bands', vol: 0.9, loop: false, sync: true, orbitSecs: 8, orbitEl: 0,
  pads: { single: 5, left: 11, right: 7, low: 9, lowmid: 11, highmid: 7, high: 0 },
});

export function orbitPos(t, secs, elDeg = 0) {
  const a = (t / secs) * Math.PI * 2;            // clockwise from the front
  const e = (elDeg * Math.PI) / 180;
  return { x: HEAD.x + RADIUS * Math.cos(e) * Math.sin(a), y: HEAD.y + RADIUS * Math.sin(e), z: HEAD.z - RADIUS * Math.cos(e) * Math.cos(a) };
}

function filt(ctx, type, f) {
  const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = 0.707; return n;
}
// two filters in series = steeper edges, so the bands separate cleanly
function chain2(ctx, type, f, input) {
  const a = filt(ctx, type, f), b = filt(ctx, type, f);
  input.connect(a); a.connect(b); return b;
}

// Wires a buffer source into graph g according to cfg. Works for live and offline contexts.
// Returns the source, the per-pad outputs (for meters) and the orbit panner if any.
export function routeSong(ctx, g, buffer, cfg) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const vol = ctx.createGain();
  vol.gain.value = cfg.vol;
  src.connect(vol);
  const outs = [];
  const toPad = (node, pad) => { node.connect(g.chains[pad].input); outs.push({ node, pad }); };
  let orbit = null;
  if (cfg.mode === 'pad') {
    toPad(vol, cfg.pads.single);
  } else if (cfg.mode === 'stereo') {
    const split = ctx.createChannelSplitter(2);
    vol.connect(split);
    const l = ctx.createGain(), r = ctx.createGain();
    split.connect(l, 0);
    split.connect(r, buffer.numberOfChannels > 1 ? 1 : 0);
    toPad(l, cfg.pads.left); toPad(r, cfg.pads.right);
  } else if (cfg.mode === 'bands') {
    toPad(chain2(ctx, 'lowpass', 250, vol), cfg.pads.low);
    toPad(chain2(ctx, 'lowpass', 1500, chain2(ctx, 'highpass', 250, vol)), cfg.pads.lowmid);
    toPad(chain2(ctx, 'lowpass', 6000, chain2(ctx, 'highpass', 1500, vol)), cfg.pads.highmid);
    toPad(chain2(ctx, 'highpass', 6000, vol), cfg.pads.high);
  } else {
    orbit = ctx.createPanner();
    orbit.panningModel = 'HRTF'; orbit.distanceModel = 'linear'; orbit.rolloffFactor = 0;
    const m = distanceMix(RADIUS);
    const d = ctx.createGain(), w = ctx.createGain();
    d.gain.value = m.gain; w.gain.value = m.gain * m.wet;
    vol.connect(orbit); orbit.connect(d); orbit.connect(w); d.connect(g.dry); w.connect(g.wet);
    outs.push({ node: vol, pad: -1 });
  }
  return { src, outs, orbit, vol };
}

function setPos(p, pos, t, ctx) {
  if (p.positionX) {
    if (t === undefined) { p.positionX.setTargetAtTime(pos.x, ctx.currentTime, 0.015); p.positionY.setTargetAtTime(pos.y, ctx.currentTime, 0.015); p.positionZ.setTargetAtTime(pos.z, ctx.currentTime, 0.015); }
    else { p.positionX.linearRampToValueAtTime(pos.x, t); p.positionY.linearRampToValueAtTime(pos.y, t); p.positionZ.linearRampToValueAtTime(pos.z, t); }
  } else p.setPosition(pos.x, pos.y, pos.z);
}

// Schedules the whole orbit path ahead of time (used for the offline export).
export function automateOrbit(ctx, panner, cfg, start, offset, dur) {
  for (let t = 0; t <= dur; t += 0.02) setPos(panner, orbitPos(offset + t, cfg.orbitSecs, cfg.orbitEl), start + t, ctx);
}

// The live song player.
export class SongPlayer {
  constructor(engine, cfg) {
    this.engine = engine;
    this.cfg = cfg;            // shared with app state
    this.buffer = null;
    this.route = null;
    this.offset = 0;           // position when paused / where the current run began
    this.startedAt = 0;
    this.meters = [];
    this.onEnd = () => {};
  }
  get ctx() { return this.engine.ctx; }
  get playing() { return !!this.route; }
  get duration() { return this.buffer ? this.buffer.duration : 0; }

  setBuffer(buf) { this.stop(); this.buffer = buf; this.offset = 0; }

  position() {
    if (!this.buffer) return 0;
    if (!this.route) return this.offset;
    const p = this.offset + (this.ctx.currentTime - this.startedAt);
    return this.cfg.loop ? p % this.duration : Math.min(p, this.duration);
  }

  play(at = 0, from = null) {
    if (!this.buffer) return;
    this.engine.resume();
    if (this.route) this.stop();
    if (from !== null) this.offset = from;
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    const ctx = this.ctx;
    const r = routeSong(ctx, this.engine.g, this.buffer, this.cfg);
    r.src.loop = this.cfg.loop;
    const when = Math.max(at, ctx.currentTime);
    r.src.start(when, this.offset);
    this.startedAt = when;
    if (r.orbit) setPos(r.orbit, orbitPos(this.offset, this.cfg.orbitSecs, this.cfg.orbitEl), when, ctx);
    r.src.onended = () => { if (this.route === r) { this.route = null; this.offset = 0; this.meters = []; this.onEnd(); } };
    this.meters = r.outs.map(({ node, pad }) => {
      const an = ctx.createAnalyser(); an.fftSize = 512; node.connect(an);
      return { an, pad, data: new Float32Array(512) };
    });
    this.route = r;
  }

  stop() {
    if (!this.route) return;
    const r = this.route;
    const pos = this.position();
    this.route = null;
    this.meters = [];
    const now = this.ctx.currentTime;
    r.vol.gain.setTargetAtTime(0, now, 0.012);
    try { r.src.stop(now + 0.06); } catch (e) { /* already stopped */ }
    this.offset = pos;
  }

  seek(t) {
    const was = this.playing;
    this.stop();
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (was) this.play();
  }

  // Re-wires while playing (e.g. after the mode or a pad changes).
  rewire() { if (this.playing) { const p = this.position(); this.stop(); this.play(0, p); } }

  setVolume(v) { this.cfg.vol = v; if (this.route) this.route.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  // Called every animation frame: moves the orbit and returns levels per pad.
  tick() {
    if (!this.route) return null;
    if (this.route.orbit) setPos(this.route.orbit, orbitPos(this.position() + 0.03, this.cfg.orbitSecs, this.cfg.orbitEl), undefined, this.ctx);
    return this.meters.map((m) => {
      m.an.getFloatTimeDomainData(m.data);
      let s = 0; for (const v of m.data) s += v * v;
      return { pad: m.pad, level: Math.sqrt(s / m.data.length) };
    });
  }
}
