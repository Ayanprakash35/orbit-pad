// Your imported audio, kept in the browser's IndexedDB so it survives reloads.
const DB = 'orbitpad', STORE = 'sounds';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}

export const db = {
  put: (rec) => tx('readwrite', (s) => s.put(rec)).catch((e) => console.warn('save failed', e)),
  del: (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {}),
  all: () => tx('readonly', (s) => s.getAll()).catch(() => []),
};

export const newId = () => Math.random().toString(36).slice(2, 10);

export function cleanName(file) {
  return file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Untitled';
}

// Finds hits (onsets) in a stretch of audio: rises in short-term energy that stand out
// from their surroundings. Returns times in seconds, relative to the buffer start.
export function findOnsets(buf, start, end, maxCount) {
  const sr = buf.sampleRate, hop = 256, win = 1024;
  const a = Math.floor(start * sr), b = Math.min(buf.length, Math.floor(end * sr));
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  const env = [];
  for (let i = a; i + win < b; i += hop) {
    let e = 0;
    for (let k = 0; k < win; k += 2) for (const ch of chans) e += ch[i + k] * ch[i + k];
    env.push(Math.log10(1e-9 + e));
  }
  const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  const W = 12, minGap = Math.round(0.09 * sr / hop);
  const peaks = [];
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    let sum = 0, n = 0;
    for (let k = Math.max(0, i - W); k < Math.min(flux.length, i + W); k++) { sum += flux[k]; n++; }
    if (flux[i] > 0.12 && flux[i] > (sum / n) * 1.6) peaks.push({ i, v: flux[i] });
  }
  // strongest first, keeping a minimum gap
  peaks.sort((x, y) => y.v - x.v);
  const kept = [];
  for (const p of peaks) {
    if (kept.every((q) => Math.abs(q.i - p.i) >= minGap)) kept.push(p);
    if (kept.length >= maxCount) break;
  }
  return kept.map((p) => start + (p.i * hop) / sr).sort((x, y) => x - y);
}

// Splits [start, end] into `count` slices, on the hits if it can find enough, else evenly.
export function chop(buf, start, end, count) {
  const onsets = findOnsets(buf, start, end, count);
  let cuts;
  if (onsets.length >= Math.ceil(count * 0.6)) {
    cuts = onsets.slice();
    if (cuts[0] - start > 0.05) { cuts.unshift(start); cuts = cuts.slice(0, count); } else cuts[0] = start;
  } else {
    cuts = [...Array(count)].map((_, k) => start + ((end - start) * k) / count);
  }
  return cuts.map((t, k) => ({ start: Math.max(0, t - 0.004), end: k + 1 < cuts.length ? cuts[k + 1] : end }));
}
