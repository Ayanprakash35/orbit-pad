// The 17 fixed sound sources on a sphere around the listener's head.
// Azimuth: 0 = straight ahead, positive = clockwise (to the listener's right).
// Elevation: 0 = ear level, +90 = directly overhead.
export const HEAD = { x: 0, y: 1.62, z: 0 };
export const RADIUS = 2.3;

const DIRS = { 0: 'Front', 45: 'Front-Right', 90: 'Right', 135: 'Back-Right', 180: 'Back',
  225: 'Back-Left', 270: 'Left', 315: 'Front-Left' };

const P = (ring, az, el, role, key) => ({ ring, az, el, role, key });

export const PAD_LAYOUT = [
  // Top
  P('top', 0, 90, 'crash', 'T'),
  // Upper ring: diagonals above
  P('high', 315, 40, 'chh', 'Q'),
  P('high', 45, 40, 'ohh', 'W'),
  P('high', 135, 40, 'ride', 'E'),
  P('high', 225, 40, 'shaker', 'R'),
  // Ear-level ring: all 8 directions
  P('mid', 0, 0, 'kick', 'A'),
  P('mid', 45, 0, 'snare', 'S'),
  P('mid', 90, 0, 'clap', 'D'),
  P('mid', 135, 0, 'tomL', 'F'),
  P('mid', 180, 0, 'kick2', 'G'),
  P('mid', 225, 0, 'tomM', 'H'),
  P('mid', 270, 0, 'rim', 'J'),
  P('mid', 315, 0, 'tomH', 'K'),
  // Lower ring: diagonals below
  P('low', 315, -38, 'congaH', 'Z'),
  P('low', 45, -38, 'congaL', 'X'),
  P('low', 135, -38, 'cowbell', 'C'),
  P('low', 225, -38, 'clave', 'V'),
];

export function padPosition(az, el, r = RADIUS) {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  // Listener faces -Z; +X is their right.
  return {
    x: HEAD.x + r * Math.cos(e) * Math.sin(a),
    y: HEAD.y + r * Math.sin(e),
    z: HEAD.z - r * Math.cos(e) * Math.cos(a),
  };
}

export function padDirection(p) {
  if (p.ring === 'top') return 'Overhead';
  const d = DIRS[p.az] || `${p.az}°`;
  if (p.ring === 'high') return 'Above ' + d;
  if (p.ring === 'low') return 'Below ' + d;
  return d;
}

export const RING_LABEL = { top: 'Overhead', high: 'Upper ring', mid: 'Ear level', low: 'Lower ring' };
