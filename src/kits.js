// Real sampled drum machines, served from danigb's sample library on GitHub Pages
// (https://github.com/danigb/samples). CORS-open, AAC (.m4a) decodes in every browser.
const BASE = 'https://danigb.github.io/samples/drum-machines/';

// Every kit maps the same 17 "roles" to one of its samples.
export const ROLES = {
  kick:   { name: 'Kick',        group: 'kick' },
  kick2:  { name: 'Kick 2',      group: 'kick' },
  snare:  { name: 'Snare',       group: 'snare' },
  rim:    { name: 'Rimshot',     group: 'snare' },
  clap:   { name: 'Clap',        group: 'snare' },
  chh:    { name: 'Closed Hat',  group: 'metal' },
  ohh:    { name: 'Open Hat',    group: 'metal' },
  crash:  { name: 'Crash',       group: 'metal' },
  ride:   { name: 'Ride',        group: 'metal' },
  shaker: { name: 'Shaker',      group: 'metal' },
  tomH:   { name: 'High Tom',    group: 'tom' },
  tomM:   { name: 'Mid Tom',     group: 'tom' },
  tomL:   { name: 'Low Tom',     group: 'tom' },
  congaH: { name: 'High Conga',  group: 'perc' },
  congaL: { name: 'Low Conga',   group: 'perc' },
  cowbell:{ name: 'Cowbell',     group: 'perc' },
  clave:  { name: 'Clave',       group: 'perc' },
};

export const KITS = {
  'TR-808': {
    label: 'Roland TR-808',
    dir: 'TR-808/',
    map: {
      kick: 'kick/bd2550', kick2: 'kick/bd7575', snare: 'snare/sd2525', rim: 'rimshot/rs',
      clap: 'clap/cp', chh: 'hihat-close/ch', ohh: 'hihat-open/oh25', crash: 'cymbal/cy5050',
      ride: 'cymbal/cy2510', shaker: 'maraca/ma', tomH: 'tom-hi/ht25', tomM: 'mid-tom/mt25',
      tomL: 'tom-low/lt25', congaH: 'conga-hi/hc25', congaL: 'conga-low/lc25',
      cowbell: 'cowbell/cb', clave: 'clave/cl',
    },
  },
  'LM-2': {
    label: 'LinnDrum LM-2',
    dir: 'LM-2/',
    map: {
      kick: 'kick', kick2: 'kick-alt', snare: 'snare-m', rim: 'stick-m', clap: 'clap',
      chh: 'hhclosed', ohh: 'hhopen', crash: 'crash', ride: 'ride', shaker: 'tambourine',
      tomH: 'tom-h', tomM: 'tom-m', tomL: 'tom-l', congaH: 'conga-h', congaL: 'conga-l',
      cowbell: 'cowbell', clave: 'stick-h',
    },
  },
  'MFB-512': {
    label: 'MFB-512',
    dir: 'MFB-512/',
    map: {
      kick: '512bdrum', kick2: '512bdrum', snare: '512snare', rim: '512snare', clap: '512clap',
      chh: '512hhcl', ohh: '512hhop', crash: '512cymb', ride: '512cymb', shaker: '512hhcl',
      tomH: '512hitom', tomM: '512mdtom', tomL: '512lotom', congaH: '512hitom', congaL: '512lotom',
      cowbell: '512hitom', clave: '512hhcl',
    },
    // Where a kit reuses a sample, nudge the pitch so the two pads still differ.
    pitch: { kick2: -3, rim: 7, ride: 5, shaker: 5, congaH: 9, congaL: 7, cowbell: 14, clave: 12 },
  },
  'RZ-1': {
    label: 'Casio RZ-1',
    dir: 'Casio-RZ1/',
    map: {
      kick: 'kick', kick2: 'kick', snare: 'snare', rim: 'clave', clap: 'clap',
      chh: 'hihat-closed', ohh: 'hihat-open', crash: 'crash', ride: 'ride', shaker: 'hihat-closed',
      tomH: 'tom-1', tomM: 'tom-2', tomL: 'tom-3', congaH: 'tom-1', congaL: 'tom-3',
      cowbell: 'cowbell', clave: 'clave',
    },
    pitch: { kick2: -4, rim: -5, shaker: 6, congaH: 7, congaL: 5 },
  },
};

export const sampleUrl = (kitId, role) => BASE + KITS[kitId].dir + KITS[kitId].map[role] + '.m4a';
export const kitPitch = (kitId, role) => (KITS[kitId].pitch && KITS[kitId].pitch[role]) || 0;
