// Swarm Town — sprites.js : procedural pixel-art (characters, tiles, buildings, props, icons, bubbles).
// Everything is drawn with fillRect into small offscreen canvases; no external assets.

export const TILE = 16;
export const OUTLINE = '#2b2233';

// ---------------------------------------------------------------- utils
export function hashStr(s) {
  s = String(s);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function mulberry32(a) {
  a >>>= 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
/** amt in -1..1 : negative darkens, positive lightens */
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  if (amt < 0) return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

/** Adds a 1px outline around opaque pixels, returns new canvas (+1px pad each side). */
export function outlined(src, color = OUTLINE, pad = 1) {
  const w = src.width + pad * 2, h = src.height + pad * 2;
  const [c, g] = makeCanvas(w, h);
  g.drawImage(src, pad, pad);
  const id = g.getImageData(0, 0, w, h), d = id.data;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  const [or, og, ob] = hexToRgb(color);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (a[i]) continue;
    if ((x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w])) {
      d[i * 4] = or; d[i * 4 + 1] = og; d[i * 4 + 2] = ob; d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- palettes
export const STANCE_COLORS = { supportive: '#5fd16a', opposing: '#ef5350', neutral: '#4f9ef0', observer: '#a3a3ad' };
const SKINS = ['#ffdbb8', '#f4c39b', '#e5a678', '#c9875a', '#a0663f', '#7a4a2c', '#ffe3cc', '#d99d74'];
const HAIRS = ['#2d1f1a', '#4a2f22', '#6e4426', '#a8652f', '#d9a441', '#efd08a', '#8b8b93', '#c8463c', '#3a3550', '#e7e2da', '#5b3a6e', '#2f4f6e'];
const SHIRTS = ['#e86a5e', '#f2a65a', '#f5d06b', '#7cc47a', '#4fb3a9', '#5b9bd5', '#7a7fd6', '#b07ad6', '#e57fb2', '#f4f1e8', '#6c8a9e', '#c9a27a', '#3f6e5a', '#d45a7a'];
const PANTS = ['#3a4a6b', '#4a3a2e', '#2f2f38', '#6b5a48', '#45627e', '#5a4060', '#334d3d'];
export const ROOF_COLORS = ['#d9574a', '#4a7fc9', '#e0a03a', '#5aa35a', '#9a5ac9', '#3aa3a0', '#d46aa0', '#8a6a4a', '#c9c24a', '#5a5a8a', '#e07a3a', '#4aa3d9'];

// ---------------------------------------------------------------- characters
export const CHAR_W = 12, CHAR_H = 20; // frame size incl. outline padding
const DIRS = 4; // 0 down,1 left,2 right,3 up
const FRAMES = 3; // 0 stand, 1 stepA, 2 stepB

export function characterLook(id) {
  const rnd = mulberry32(hashStr('agent:' + id));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  return {
    skin: pick(SKINS), hair: pick(HAIRS), shirt: pick(SHIRTS), pants: pick(PANTS),
    shoes: rnd() < 0.5 ? '#3b2a24' : '#5a4038',
    style: ['short', 'long', 'bun', 'cap', 'spiky', 'short', 'long', 'bob'][Math.floor(rnd() * 8)],
    cap: pick(['#d9574a', '#4a7fc9', '#e0a03a', '#5aa35a', '#2f2f38', '#f4f1e8']),
    glasses: rnd() < 0.22, blush: rnd() < 0.5,
  };
}

/** paints one 10x16 body (offset ox,oy) for direction/frame */
function paintChar(g, ox, oy, L, dir, frame) {
  const P = (x, y, c, w = 1, h = 1) => R(g, ox + x, oy + y, w, h, c);
  const skin = L.skin, hair = L.hair, shirt = L.shirt, shirtD = shade(L.shirt, -0.22), pants = L.pants, shoe = L.shoes;
  const bob = frame === 0 ? 0 : 0; // legs animate; head stays
  const side = dir === 1 || dir === 2;
  // ---------- legs
  if (!side) {
    P(2, 12, pants, 6, 1);
    if (frame === 0) { P(2, 13, pants, 2, 2); P(6, 13, pants, 2, 2); P(2, 15, shoe, 2, 1); P(6, 15, shoe, 2, 1); }
    else if (frame === 1) { P(2, 13, pants, 2, 1); P(2, 14, shoe, 2, 1); P(6, 13, pants, 2, 2); P(6, 15, shoe, 2, 1); }
    else { P(2, 13, pants, 2, 2); P(2, 15, shoe, 2, 1); P(6, 13, pants, 2, 1); P(6, 14, shoe, 2, 1); }
  } else {
    P(3, 12, pants, 4, 1);
    if (frame === 0) { P(3, 13, pants, 4, 2); P(3, 15, shoe, 4, 1); }
    else if (frame === 1) { P(2, 13, pants, 2, 2); P(1, 15, shoe, 3, 1); P(6, 13, pants, 2, 1); P(6, 14, shoe, 2, 1); }
    else { P(3, 13, pants, 2, 1); P(3, 14, shoe, 2, 1); P(6, 13, pants, 2, 2); P(6, 15, shoe, 3, 1); }
  }
  // ---------- body
  const by = 7 + bob;
  if (!side) {
    P(2, by, shirt, 6, 5); P(1, by + 1, shirt, 8, 3);
    P(2, by + 4, shade(shirt, -0.12), 6, 1);
    // arms
    const swing = frame === 0 ? 0 : (frame === 1 ? 1 : -1);
    P(1, by + 1, shirtD, 1, 3); P(8, by + 1, shirtD, 1, 3);
    P(1, by + 4 + (swing > 0 ? -1 : 0), skin); P(8, by + 4 + (swing < 0 ? -1 : 0), skin);
    if (dir === 0) { P(4, by, shade(shirt, 0.25), 2, 1); }
  } else {
    P(2, by, shirt, 6, 5);
    P(2, by + 4, shade(shirt, -0.12), 6, 1);
    const ax = frame === 0 ? 4 : frame === 1 ? 3 : 5;
    P(ax, by + 1, shirtD, 2, 3); P(ax + (dir === 1 ? 0 : 1), by + 4, skin);
  }
  // ---------- head (rows 0..6)
  P(2, 0, skin, 6, 1); P(1, 1, skin, 8, 5); P(2, 6, skin, 6, 1);
  const H = (x, y, w = 1, h = 1) => P(x, y, hair, w, h);
  const st = L.style;
  if (dir === 3) {
    // back of head
    H(2, 0, 6); H(1, 1, 8, 5); H(2, 6, 6, 1);
    if (st === 'long' || st === 'bob') H(1, 6, 8, st === 'long' ? 3 : 1);
    if (st === 'bun') H(3, -2, 4, 2);
    if (st === 'spiky') { H(2, -1); H(5, -1); H(7, -1); }
    if (st === 'cap') { P(1, 0, L.cap, 8, 3); P(2, -1, L.cap, 6, 1); }
    P(4, 7, skin, 2, 1);
    return;
  }
  if (dir === 0) {
    H(2, 0, 6); H(1, 1, 8, 2); H(1, 3); H(8, 3);
    if (st === 'short' || st === 'spiky') { H(2, 3); }
    if (st === 'bob') { H(1, 4, 1, 3); H(8, 4, 1, 3); H(2, 3, 2, 1); }
    if (st === 'long') { H(1, 4, 1, 5); H(8, 4, 1, 5); H(0, 5, 1, 3); H(9, 5, 1, 3); }
    if (st === 'bun') H(3, -2, 4, 2);
    if (st === 'spiky') { H(2, -1); H(4, -1); H(6, -1); H(1, 0); H(8, 0); }
    if (st === 'cap') { P(1, 0, L.cap, 8, 2); P(2, -1, L.cap, 6, 1); P(0, 2, shade(L.cap, -0.2), 10, 1); }
    // eyes & face
    P(3, 4, '#2b2233'); P(6, 4, '#2b2233');
    if (L.blush) { P(2, 5, '#f29a9a'); P(7, 5, '#f29a9a'); }
    if (L.glasses) { P(2, 4, '#3a3a4a'); P(4, 4, '#3a3a4a'); P(5, 4, '#3a3a4a'); P(7, 4, '#3a3a4a'); P(3, 3, '#3a3a4a'); P(6, 3, '#3a3a4a'); }
    P(4, 6, shade(skin, -0.15), 2, 1);
  } else {
    // side view; draw facing left then mirror for right
    const m = dir === 2;
    const X = x => (m ? 9 - x : x);
    const HS = (x, y, w = 1, h = 1) => { for (let i = 0; i < w; i++) P(X(x + i), y, hair, 1, h); };
    HS(2, 0, 6); HS(1, 1, 8, 2); HS(5, 3, 4, 2); HS(6, 5, 3, 1);
    if (st === 'long') HS(5, 5, 4, 4);
    if (st === 'bob') HS(5, 5, 4, 2);
    if (st === 'bun') HS(5, -2, 3, 2);
    if (st === 'spiky') { HS(3, -1); HS(6, -1); }
    if (st === 'cap') { for (let i = 0; i < 9; i++) P(X(i), 1, L.cap); for (let i = 1; i < 9; i++) P(X(i), 0, L.cap); for (let i = 2; i < 8; i++) P(X(i), -1, L.cap); P(X(-0), 2, shade(L.cap, -0.2)); P(X(1), 2, shade(L.cap, -0.2)); }
    P(X(2), 4, '#2b2233');
    if (L.glasses) { P(X(1), 4, '#3a3a4a'); P(X(3), 4, '#3a3a4a'); P(X(2), 3, '#3a3a4a'); }
    if (L.blush) P(X(3), 5, '#f29a9a');
    P(X(0), 4, skin);
  }
}

/** Returns {sheet, fw, fh}: sheet laid out cols=frame, rows=dir. Cached by id. */
const charCache = new Map();
export function getCharacter(id) {
  const key = String(id);
  if (charCache.has(key)) return charCache.get(key);
  const L = characterLook(id);
  const fw = CHAR_W, fh = CHAR_H;
  const [sheet, sg] = makeCanvas(fw * FRAMES, fh * DIRS);
  for (let d = 0; d < DIRS; d++) for (let f = 0; f < FRAMES; f++) {
    const [tmp, tg] = makeCanvas(fw - 2, fh - 2);
    paintChar(tg, 0, 2, L, d, f);
    const o = outlined(tmp, OUTLINE, 1);
    sg.drawImage(o, f * fw, d * fh);
  }
  const res = { sheet, fw, fh, look: L };
  charCache.set(key, res);
  return res;
}
export function clearCharacterCache() { charCache.clear(); }

// ---------------------------------------------------------------- icons (pixel emoji)
const ICON_DEFS = {
  heart: { p: { R: '#ef4f6b', W: '#ffd0da' }, m: ['.RR...RR.', 'RWRR.RRRR', 'RRRRRRRRR', 'RRRRRRRRR', '.RRRRRRR.', '..RRRRR..', '...RRR...', '....R....'] },
  like: { p: { Y: '#ffcf4a', B: '#4a7fd8', D: '#e0a92f' }, m: ['....Y....', '...YY....', '...YY....', 'BB.YYYYY.', 'BBYYYYYYY', 'BBYYYYYD.', 'BBYYYYYYY', 'BB.YYYYY.'] },
  speech: { p: { W: '#ffffff', G: '#7a7f99' }, m: ['WWWWWWWWW', 'WWWWWWWWW', 'WGWWGWWGW', 'WWWWWWWWW', 'WWWWWWWWW', '.WW......', '.W.......'] },
  repost: { p: { G: '#42c070' }, m: ['.....G...', 'GGGGGGGG.', 'G....G...', 'G........', '........G', '...G....G', '.GGGGGGGG', '...G.....'] },
  mute: { p: { S: '#9aa0b8', R: '#ef4f6b' }, m: ['...S.....', '..SS.R..R', 'SSSS..RR.', 'SSSS..RR.', '..SS.R..R', '...S.....'] },
  search: { p: { M: '#8a8fa8', L: '#9fd6f5', W: '#ffffff' }, m: ['.MMM.....', 'MLWLM....', 'MLLLM....', 'MLLLM....', '.MMMM....', '....MM...', '.....MM..'] },
  fire: { p: { R: '#f0553a', Y: '#ffc23a', W: '#fff6c8' }, m: ['....R....', '...RR....', '..RRR.R..', '.RRYRRR..', '.RYYYRR..', '.RYWYYR..', '..RYYR...'] },
  star: { p: { Y: '#ffd23a', O: '#f0a020' }, m: ['....Y....', '...YYY...', 'YYYYYYYYY', '.YYYYYYY.', '..YYYYY..', '.YYYOYYY.', '.YO...OY.'] },
  note: { p: { W: '#fffdf2', G: '#8a8fa8' }, m: ['WWWWWW', 'WGGGGW', 'WWWWWW', 'WGGGWW', 'WWWWWW', 'WGGGGW', 'WWWWWW'] },
  exclaim: { p: { R: '#ff5a4a' }, m: ['RR', 'RR', 'RR', 'RR', '..', 'RR'] },
  question: { p: { Y: '#ffd23a' }, m: ['.YYY.', 'Y...Y', '...Y.', '..Y..', '.....', '..Y..'] },
  zzz: { p: { B: '#cfe0ff' }, m: ['BBBB', '..B.', '.B..', 'BBBB'] },
  coffee: { p: { W: '#ffffff', N: '#b07a4a', S: '#e8e8f0' }, m: ['.S.S..', '..S.S.', 'NNNNN.', 'NWWWNN', 'NWWWN.N', 'NWWWNN', '.NNN..'] },
  quote: { p: { W: '#ffffff', B: '#5b9bd5' }, m: ['BB.BB', 'BB.BB', '.B..B', 'B..B.'] },
  dots: { p: { W: '#ffffff' }, m: ['W.W.W'] },
  sad: { p: { B: '#6fa8ff', W: '#ffffff' }, m: ['..B..', '.BBB.', 'BBWBB', 'BBBBB', '.BBB.'] },
  music: { p: { P: '#ff7ab8' }, m: ['..PPP', '..P.P', '..P.P', 'PPP.P', 'PP.PP'] },
};
const iconCache = new Map();
export function getIcon(name, flipY = false) {
  const key = name + (flipY ? ':f' : '');
  if (iconCache.has(key)) return iconCache.get(key);
  const def = ICON_DEFS[name] || ICON_DEFS.dots;
  const h = def.m.length, w = Math.max(...def.m.map(r => r.length));
  const [c, g] = makeCanvas(w, h);
  def.m.forEach((row, y) => [...row].forEach((ch, x) => { if (def.p[ch]) R(g, x, flipY ? h - 1 - y : y, 1, 1, def.p[ch]); }));
  const o = outlined(c, OUTLINE, 1);
  iconCache.set(key, o);
  return o;
}
export const ACTION_ICON = {
  POST: ['note'], QUOTE: ['quote'], COMMENT: ['speech'], LIKE: ['like'], DISLIKE: ['like', true], REPOST: ['repost'],
  FOLLOW: ['heart'], MUTE: ['mute'], SEARCH: ['search'], TREND: ['star'], IDLE: ['coffee'],
};

// ---------------------------------------------------------------- ground tiles
export const T = { GRASS: 0, PATH: 1, PLAZA: 2, WATER: 3, SAND: 4, PARK: 5, FIELD: 6, DEEP: 7, DOCK: 8, ROAD: 9 };
const GRASS = { base: '#86c25e', dark: '#71ad4f', light: '#9cd473', blade: '#5f9a45' };

export function paintTile(g, tiles, W, H, x, y, deco) {
  const t = tiles[y * W + x];
  const px = x * TILE, py = y * TILE;
  const rnd = mulberry32(hashStr(x + ',' + y));
  const at = (dx, dy) => { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) return T.DEEP; return tiles[yy * W + xx]; };
  const isWater = v => v === T.WATER || v === T.DEEP;
  const dots = (n, c, s = 1) => { for (let i = 0; i < n; i++) R(g, px + Math.floor(rnd() * (TILE - s + 1)), py + Math.floor(rnd() * (TILE - s + 1)), s, s, c); };
  switch (t) {
    case T.GRASS: case T.PARK: {
      const park = t === T.PARK;
      R(g, px, py, TILE, TILE, park ? '#90cb64' : GRASS.base);
      if (park && ((x + y) & 1)) R(g, px, py, TILE, TILE, '#97d06b');
      dots(7, park ? '#7dba57' : GRASS.dark); dots(4, park ? '#a6dc7c' : GRASS.light);
      for (let i = 0; i < 3; i++) { const bx = px + Math.floor(rnd() * 14) + 1, byy = py + Math.floor(rnd() * 13) + 2; R(g, bx, byy, 1, 2, GRASS.blade); R(g, bx + 1, byy + 1, 1, 1, GRASS.blade); }
      if (deco === 1) { // flowers
        const cols = ['#ffffff', '#ffd23a', '#ff8fb0', '#b58cff', '#ff6a5a'];
        const c = cols[Math.floor(rnd() * cols.length)];
        for (let i = 0; i < 3; i++) { const fx = px + 2 + Math.floor(rnd() * 11), fy = py + 2 + Math.floor(rnd() * 11); R(g, fx, fy + 1, 1, 2, '#4f8a3a'); R(g, fx - 1, fy, 3, 1, c); R(g, fx, fy - 1, 1, 3, c); R(g, fx, fy, 1, 1, '#fff2a8'); }
      } else if (deco === 2) { // tall grass tuft
        for (let i = 0; i < 4; i++) R(g, px + 4 + i * 2, py + 7 - (i & 1) * 2, 1, 5 + (i & 1) * 2, '#5f9a45');
      }
      break;
    }
    case T.PATH: {
      R(g, px, py, TILE, TILE, '#dcc08c');
      dots(5, '#c9aa72'); dots(4, '#ead3a4'); dots(2, '#b89660', 2);
      const edge = (v) => !(v === T.PATH || v === T.ROAD || v === T.PLAZA || v === T.DOCK);
      if (edge(at(0, -1))) { R(g, px, py, TILE, 1, '#b89a64'); for (let i = 0; i < 4; i++) R(g, px + Math.floor(rnd() * 15), py, 1, 2, GRASS.dark); }
      if (edge(at(0, 1))) R(g, px, py + TILE - 1, TILE, 1, '#c4a46c');
      if (edge(at(-1, 0))) R(g, px, py, 1, TILE, '#c4a46c');
      if (edge(at(1, 0))) R(g, px + TILE - 1, py, 1, TILE, '#c4a46c');
      break;
    }
    case T.ROAD: {
      R(g, px, py, TILE, TILE, '#c9c0ad');
      // cobble pattern
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const sx = px + c * 4 + ((r & 1) ? 2 : 0), sy = py + r * 4;
        const v = rnd();
        R(g, sx, sy, 3, 3, v < 0.33 ? '#d6cdb9' : v < 0.66 ? '#cfc6b2' : '#bfb5a0');
        R(g, sx, sy, 1, 1, '#e3dccb');
      }
      const edge = v => !(v === T.PATH || v === T.ROAD || v === T.PLAZA || v === T.DOCK);
      if (edge(at(0, -1))) R(g, px, py, TILE, 1, '#a39a88');
      if (edge(at(0, 1))) R(g, px, py + TILE - 1, TILE, 1, '#a39a88');
      if (edge(at(-1, 0))) R(g, px, py, 1, TILE, '#a39a88');
      if (edge(at(1, 0))) R(g, px + TILE - 1, py, 1, TILE, '#a39a88');
      break;
    }
    case T.PLAZA: {
      R(g, px, py, TILE, TILE, '#bdb3a2');
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        const sx = px + c * 8 - ((r + y) & 1 ? 4 : 0), sy = py + r * 8;
        const v = rnd();
        const col = v < 0.4 ? '#ddd5c5' : v < 0.8 ? '#d5ccba' : '#e6c9a8';
        const x0 = Math.max(px, sx + 1), x1 = Math.min(px + TILE, sx + 8);
        if (x1 > x0) { R(g, x0, sy + 1, x1 - x0, 7, col); R(g, x0, sy + 1, Math.min(2, x1 - x0), 1, '#eee8dc'); }
      }
      break;
    }
    case T.SAND: {
      R(g, px, py, TILE, TILE, '#f0dba2');
      dots(6, '#e0c588'); dots(4, '#f8ebc4');
      if (rnd() < 0.06) { R(g, px + 6, py + 7, 3, 2, '#f7f2ea'); R(g, px + 7, py + 6, 1, 1, '#e8a0a0'); } // shell
      const land = v => v === T.GRASS || v === T.PARK;
      if (land(at(0, -1))) for (let i = 0; i < TILE; i += 2) R(g, px + i, py, 2, 1 + Math.floor(rnd() * 3), GRASS.base);
      if (land(at(-1, 0))) for (let i = 0; i < TILE; i += 2) R(g, px, py + i, 1 + Math.floor(rnd() * 3), 2, GRASS.base);
      if (land(at(1, 0))) for (let i = 0; i < TILE; i += 2) { const w = 1 + Math.floor(rnd() * 3); R(g, px + TILE - w, py + i, w, 2, GRASS.base); }
      if (land(at(0, 1))) for (let i = 0; i < TILE; i += 2) { const h = 1 + Math.floor(rnd() * 3); R(g, px + i, py + TILE - h, 2, h, GRASS.base); }
      break;
    }
    case T.WATER: case T.DEEP: {
      const deep = t === T.DEEP;
      R(g, px, py, TILE, TILE, deep ? '#3f86bf' : '#58a6d6');
      for (let i = 0; i < 2; i++) { const wx = px + Math.floor(rnd() * 11), wy = py + Math.floor(rnd() * 15); R(g, wx, wy, 4, 1, deep ? '#5296c9' : '#7cc0e6'); }
      const shore = v => !(v === T.WATER || v === T.DEEP || v === T.DOCK);
      if (!deep) {
        if (shore(at(0, -1))) { R(g, px, py, TILE, 2, '#d9f1fb'); R(g, px, py + 2, TILE, 1, '#9fd6f0'); }
        if (shore(at(0, 1))) R(g, px, py + TILE - 2, TILE, 2, '#9fd6f0');
        if (shore(at(-1, 0))) R(g, px, py, 2, TILE, '#c9ebf8');
        if (shore(at(1, 0))) R(g, px + TILE - 2, py, 2, TILE, '#c9ebf8');
      } else {
        if (at(0, -1) === T.WATER) R(g, px, py, TILE, 1, '#4c92c8');
      }
      break;
    }
    case T.FIELD: {
      const wheat = hash2(Math.floor(x / 6), Math.floor(y / 6), 9) < 0.5;
      R(g, px, py, TILE, TILE, '#a87a50');
      for (let r = 0; r < 4; r++) {
        R(g, px, py + r * 4 + 3, TILE, 1, '#8f6440');
        for (let c = 0; c < 4; c++) {
          const cx = px + c * 4 + 1, cy = py + r * 4;
          if (wheat) { R(g, cx, cy, 2, 3, '#e8c454'); R(g, cx, cy, 1, 1, '#f6dd84'); }
          else { R(g, cx, cy + 1, 2, 2, '#62ad4a'); R(g, cx + 1, cy, 1, 1, '#8fd16a'); }
        }
      }
      break;
    }
    case T.DOCK: {
      R(g, px, py, TILE, TILE, '#b98a5a');
      for (let i = 0; i < 4; i++) { R(g, px, py + i * 4 + 3, TILE, 1, '#8f6640'); R(g, px + ((i * 5) % 12) + 2, py + i * 4 + 1, 1, 1, '#6b4a2e'); }
      R(g, px, py, 1, TILE, '#7a5636'); R(g, px + TILE - 1, py, 1, TILE, '#7a5636');
      break;
    }
  }
}

// ---------------------------------------------------------------- props / objects
// every maker returns { img, ox, oy } where (ox,oy) is offset of sprite top-left relative to footprint top-left (px)

export function makeTree(kind, seed) {
  const rnd = mulberry32(seed);
  const [c, g] = makeCanvas(22, 30);
  // trunk
  R(g, 9, 20, 4, 9, '#7a5233'); R(g, 9, 20, 1, 9, '#5e3e26'); R(g, 12, 22, 1, 6, '#946a46');
  R(g, 8, 28, 6, 1, '#5e3e26');
  if (kind === 'pine') {
    const cols = ['#2f6f4f', '#3f8a5f', '#5aa872'];
    for (let tier = 0; tier < 3; tier++) {
      const top = 1 + tier * 6, h = 10;
      for (let yy = 0; yy < h; yy++) {
        const w = Math.round(2 + (yy / h) * (8 + tier * 2));
        R(g, 11 - w, top + yy, w * 2, 1, cols[0]);
        R(g, 11 - w + 1, top + yy, Math.max(1, w - 1), 1, cols[1]);
        if (yy % 3 === 0) R(g, 11 - w + 2, top + yy, 2, 1, cols[2]);
      }
    }
  } else {
    const pal = {
      oak: ['#3f7f3a', '#5fa64a', '#8fd16a'],
      cherry: ['#c86a94', '#f2a7c3', '#ffd6e6'],
      autumn: ['#b0582a', '#e0913a', '#ffc46a'],
      fruit: ['#3f7f3a', '#5fa64a', '#8fd16a'],
      round: ['#2f7a52', '#4aa070', '#7fd09a'],
    }[kind] || ['#3f7f3a', '#5fa64a', '#8fd16a'];
    const blob = (cx, cy, r, col) => {
      for (let yy = -r; yy <= r; yy++) { const w = Math.round(Math.sqrt(r * r - yy * yy)); R(g, cx - w, cy + yy, w * 2, 1, col); }
    };
    blob(11, 12, 10, pal[0]); blob(6, 13, 6, pal[0]); blob(16, 13, 6, pal[0]);
    blob(10, 10, 8, pal[1]); blob(6, 12, 4, pal[1]); blob(15, 11, 5, pal[1]);
    blob(8, 7, 3, pal[2]); blob(13, 6, 2, pal[2]);
    for (let i = 0; i < 14; i++) { const xx = 3 + Math.floor(rnd() * 16), yy = 4 + Math.floor(rnd() * 14); R(g, xx, yy, 1, 1, rnd() < 0.5 ? pal[2] : pal[0]); }
    R(g, 3, 18, 16, 2, pal[0]);
    if (kind === 'fruit') for (let i = 0; i < 6; i++) { const xx = 4 + Math.floor(rnd() * 14), yy = 5 + Math.floor(rnd() * 11); R(g, xx, yy, 2, 2, '#e8423a'); R(g, xx, yy, 1, 1, '#ff9a8a'); }
  }
  return { img: outlined(c, '#24301f'), ox: -3 - 1, oy: -14 - 1 };
}

export function makeBush(seed) {
  const rnd = mulberry32(seed);
  const [c, g] = makeCanvas(16, 12);
  const col = ['#4f9a44', '#6fbc56', '#9ad978'];
  R(g, 2, 4, 12, 7, col[0]); R(g, 1, 6, 14, 4, col[0]); R(g, 4, 2, 8, 3, col[0]);
  R(g, 4, 3, 7, 5, col[1]); R(g, 2, 6, 5, 3, col[1]); R(g, 5, 3, 3, 2, col[2]);
  if (rnd() < 0.5) for (let i = 0; i < 4; i++) R(g, 3 + Math.floor(rnd() * 10), 3 + Math.floor(rnd() * 6), 1, 1, ['#ff8fb0', '#fff', '#ffd23a'][i % 3]);
  return { img: outlined(c, '#24301f'), ox: -1, oy: 3 };
}
export function makeRock(seed) {
  const [c, g] = makeCanvas(12, 9);
  R(g, 2, 2, 8, 6, '#9a9aa8'); R(g, 1, 4, 10, 4, '#9a9aa8'); R(g, 3, 2, 4, 2, '#c4c4d0'); R(g, 2, 7, 9, 1, '#787886');
  return { img: outlined(c), ox: 1, oy: 6 };
}
export function makeLamp() {
  const [c, g] = makeCanvas(10, 32);
  R(g, 4, 9, 2, 21, '#3b3b4a'); R(g, 5, 9, 1, 21, '#55556a'); R(g, 2, 29, 6, 3, '#3b3b4a');
  R(g, 1, 2, 8, 1, '#3b3b4a'); R(g, 2, 3, 6, 6, '#ffe8a0'); R(g, 2, 3, 2, 6, '#fff4cc'); R(g, 1, 9, 8, 1, '#3b3b4a'); R(g, 3, 0, 4, 2, '#3b3b4a');
  return { img: outlined(c), ox: 2, oy: -17, light: { dx: 5 + 1, dy: 5 + 1 } };
}
export function makeBench() {
  const [c, g] = makeCanvas(28, 12);
  R(g, 1, 0, 26, 3, '#a8703f'); R(g, 1, 0, 26, 1, '#c98f58');
  R(g, 0, 5, 28, 3, '#b97d48'); R(g, 0, 5, 28, 1, '#d69b62');
  R(g, 2, 8, 2, 4, '#3b3b4a'); R(g, 24, 8, 2, 4, '#3b3b4a'); R(g, 2, 3, 2, 2, '#3b3b4a'); R(g, 24, 3, 2, 2, '#3b3b4a');
  return { img: outlined(c), ox: 2, oy: 2 };
}
export function makeTable() {
  const [c, g] = makeCanvas(22, 28);
  // umbrella
  for (let yy = 0; yy < 7; yy++) { const w = 3 + yy * 1.4 | 0; for (let xx = -w; xx < w; xx++) R(g, 11 + xx, 1 + yy, 1, 1, ((xx + 30) >> 2) & 1 ? '#fff3e0' : '#e2574c'); }
  R(g, 1, 8, 20, 1, '#b8423a');
  R(g, 10, 8, 2, 12, '#6b5a48');
  // table
  R(g, 3, 18, 16, 3, '#c98f58'); R(g, 3, 18, 16, 1, '#e8b07a'); R(g, 5, 21, 2, 6, '#6b4a2e'); R(g, 15, 21, 2, 6, '#6b4a2e');
  R(g, 7, 16, 3, 2, '#ffffff'); R(g, 7, 15, 3, 1, '#b07a4a');
  return { img: outlined(c), ox: -3, oy: -12 };
}
export function makeSignpost(color) {
  const [c, g] = makeCanvas(16, 22);
  R(g, 7, 8, 2, 14, '#7a5233');
  R(g, 1, 1, 14, 9, color); R(g, 1, 1, 14, 2, shade(color, 0.3)); R(g, 1, 9, 14, 1, shade(color, -0.3));
  R(g, 3, 4, 10, 1, '#fff8e8'); R(g, 3, 6, 7, 1, '#fff8e8');
  return { img: outlined(c), ox: -1, oy: -7 };
}
export function makeFlowerBed(seed) {
  const rnd = mulberry32(seed);
  const [c, g] = makeCanvas(16, 10);
  R(g, 0, 3, 16, 7, '#7a5233'); R(g, 1, 4, 14, 5, '#5e3e26');
  const cols = ['#ff6a8a', '#ffd23a', '#ffffff', '#b58cff', '#ff8a3a'];
  for (let i = 0; i < 7; i++) { const fx = 1 + i * 2, col = cols[Math.floor(rnd() * cols.length)]; R(g, fx, 3, 1, 2, '#4f8a3a'); R(g, fx, 1 + (i & 1), 2, 2, col); }
  return { img: outlined(c), ox: -1, oy: 5 };
}

// ----- house: footprint 3x2 tiles (48x32)
export function makeHouse(roof, seed) {
  const rnd = mulberry32(seed);
  const W = 48, H = 60;
  const [c, g] = makeCanvas(W, H);
  const walls = ['#f6e7c8', '#e3eef2', '#f6dcd3', '#ddeed5', '#efe2f5', '#f8eeb8'];
  const wall = walls[Math.floor(rnd() * walls.length)];
  const wallD = shade(wall, -0.14);
  const roofD = shade(roof, -0.25), roofL = shade(roof, 0.25);
  const chimX = rnd() < 0.5 ? 9 : 31;
  // chimney
  R(g, chimX, 4, 7, 14, '#a8584a'); R(g, chimX, 4, 7, 2, '#7a3a30'); R(g, chimX + 1, 8, 2, 1, '#c97a6a'); R(g, chimX + 4, 12, 2, 1, '#c97a6a');
  // walls
  R(g, 4, 28, 40, 30, wall); R(g, 4, 28, 2, 30, wallD); R(g, 42, 28, 2, 30, wallD);
  R(g, 4, 55, 40, 3, '#9a948c'); R(g, 4, 55, 40, 1, '#b8b2a8');
  // timber beams variant
  if (rnd() < 0.5) { R(g, 6, 40, 36, 1, shade(wall, -0.3)); }
  // roof (hip/trapezoid)
  for (let yy = 8; yy <= 32; yy++) {
    const t = (yy - 8) / 24;
    const x0 = Math.round(12 - 12 * t), x1 = Math.round(36 + 12 * t);
    R(g, x0, yy, x1 - x0, 1, roof);
    if ((yy - 8) % 4 === 3) R(g, x0, yy, x1 - x0, 1, roofD);
    else { const off = ((yy - 8) >> 2) & 1 ? 3 : 0; for (let xx = x0 + off; xx < x1; xx += 6) R(g, xx, yy, 1, 1, roofD); }
    R(g, x0, yy, 1, 1, roofD); R(g, x1 - 1, yy, 1, 1, roofD);
  }
  R(g, 12, 8, 24, 2, roofL); R(g, 0, 32, 48, 2, roofD);
  // door
  R(g, 19, 42, 10, 13, '#7a4e2d'); R(g, 20, 43, 8, 12, '#94603a'); R(g, 20, 43, 8, 1, '#b07a4a'); R(g, 26, 49, 1, 1, '#ffd23a');
  R(g, 23, 44, 2, 3, '#c9e6f5');
  R(g, 18, 55, 12, 3, '#b8b2a8');
  // windows
  const win = [];
  for (const wx of [8, 33]) {
    R(g, wx - 1, 38, 9, 9, '#ffffff'); R(g, wx, 39, 7, 7, '#8fc8e8'); R(g, wx, 39, 3, 2, '#c9e8f8');
    R(g, wx + 3, 39, 1, 7, '#ffffff'); R(g, wx, 42, 7, 1, '#ffffff');
    R(g, wx - 1, 47, 9, 2, '#8a5a3a');
    for (let i = 0; i < 4; i++) R(g, wx + i * 2, 46, 1, 1, ['#ff6a8a', '#ffd23a', '#ff8fb0', '#ffffff'][(i + seed) & 3]);
    win.push({ x: wx + 1, y: 39 + 1, w: 7, h: 7 });
  }
  const img = outlined(c, '#3a2d34');
  return { img, ox: -1, oy: 32 - H - 1, windows: win, chimney: { x: chimX + 4, y: 4 } };
}

// ----- Forum Hall: footprint 10x5 (160x80); sprite 160x122
export function makeForum() {
  const W = 160, H = 122;
  const [c, g] = makeCanvas(W, H);
  const stone = '#e8e2f2', stoneD = '#c9c0db', stoneDD = '#a89dbd', roof = '#3f8f8a';
  // steps
  for (let i = 0; i < 3; i++) { R(g, 6 + i * 4, 112 - i * 5, W - 12 - i * 8, 5, i & 1 ? '#d8d0e6' : '#e6dff0'); R(g, 6 + i * 4, 112 - i * 5, W - 12 - i * 8, 1, '#f6f2fb'); }
  // body
  R(g, 14, 50, W - 28, 52, '#6f6584'); // dark interior
  R(g, 14, 50, W - 28, 6, stoneD);
  // big door
  R(g, 68, 64, 24, 38, '#5a3a2a'); R(g, 70, 66, 20, 36, '#7a4e2d'); R(g, 79, 66, 2, 36, '#5a3a2a'); R(g, 74, 82, 2, 2, '#ffd23a'); R(g, 84, 82, 2, 2, '#ffd23a');
  // columns
  const colsX = [16, 38, 56, 96, 114, 136];
  for (const cx of colsX) {
    R(g, cx, 54, 10, 48, stone); R(g, cx, 54, 2, 48, '#ffffff'); R(g, cx + 8, 54, 2, 48, stoneD);
    for (let k = 3; k < 8; k += 2) R(g, cx + k, 58, 1, 40, stoneD);
    R(g, cx - 2, 50, 14, 4, stoneD); R(g, cx - 2, 100, 14, 3, stoneD);
  }
  // banners
  for (const bx of [28, 125]) { R(g, bx, 58, 7, 22, '#8a5ac9'); R(g, bx, 58, 7, 2, '#5a3a8a'); R(g, bx + 2, 64, 3, 3, '#ffd23a'); R(g, bx, 80, 3, 2, '#8a5ac9'); R(g, bx + 4, 80, 3, 2, '#8a5ac9'); }
  // entablature
  R(g, 6, 40, W - 12, 11, stone); R(g, 6, 40, W - 12, 2, '#ffffff'); R(g, 6, 49, W - 12, 2, stoneDD);
  for (let x = 10; x < W - 10; x += 8) R(g, x, 44, 4, 3, stoneD);
  // pediment
  for (let yy = 0; yy < 34; yy++) {
    const half = Math.round((yy / 33) * 78);
    R(g, 80 - half, 6 + yy, half * 2, 1, roof);
    if (yy > 6) { const ih = Math.round(((yy - 6) / 27) * 64); R(g, 80 - ih, 6 + yy, ih * 2, 1, yy < 32 ? stone : roof); }
  }
  R(g, 2, 38, W - 4, 3, shade(roof, -0.25));
  // emblem
  for (let yy = -6; yy <= 6; yy++) { const w = Math.round(Math.sqrt(36 - yy * yy)); R(g, 80 - w, 26 + yy, w * 2, 1, '#e0b03a'); }
  R(g, 77, 22, 6, 8, '#fff2b0'); R(g, 79, 20, 2, 12, '#fff2b0');
  const img = outlined(c, '#2f2a3d');
  return { img, ox: -1, oy: 80 - H - 1, windows: [{ x: 71, y: 67, w: 18, h: 34 }] };
}

// ----- Library: footprint 8x5 (128x80); sprite 128x118
export function makeLibrary() {
  const W = 128, H = 118;
  const [c, g] = makeCanvas(W, H);
  const brick = '#b85c4a', brickD = '#9c4a3b', brickL = '#c9705c', roof = '#4b6a9b';
  R(g, 4, 46, W - 8, 68, brick);
  for (let yy = 46; yy < 114; yy += 4) { R(g, 4, yy, W - 8, 1, brickD); for (let xx = 4 + ((yy >> 2) & 1) * 4; xx < W - 4; xx += 8) R(g, xx, yy + 1, 1, 3, brickD); }
  for (let i = 0; i < 20; i++) R(g, 8 + (i * 37) % 110, 48 + (i * 13) % 60, 5, 2, brickL);
  R(g, 4, 110, W - 8, 4, '#8a8478');
  // mansard roof
  for (let yy = 10; yy <= 48; yy++) {
    const t = (yy - 10) / 38;
    const x0 = Math.round(18 - 18 * t), x1 = Math.round(110 + 18 * t);
    R(g, x0, yy, x1 - x0, 1, (yy - 10) % 5 === 4 ? shade(roof, -0.25) : roof);
  }
  R(g, 18, 10, 92, 2, shade(roof, 0.3)); R(g, 0, 47, W, 3, shade(roof, -0.35));
  // dormers
  const win = [];
  for (const dx of [28, 88]) {
    R(g, dx - 2, 18, 16, 16, '#e8e2d2'); R(g, dx - 4, 14, 20, 4, shade(roof, -0.2));
    R(g, dx, 21, 12, 11, '#8fc8e8'); R(g, dx + 5, 21, 2, 11, '#e8e2d2'); R(g, dx, 21, 4, 3, '#c9e8f8');
    win.push({ x: dx + 1, y: 22, w: 12, h: 11 });
  }
  // arched windows
  for (const wx of [14, 94]) {
    R(g, wx - 2, 60, 24, 36, '#e8e2d2');
    R(g, wx, 66, 20, 28, '#7fb8dc'); R(g, wx + 2, 62, 16, 4, '#7fb8dc'); R(g, wx + 5, 60, 10, 2, '#7fb8dc');
    R(g, wx + 9, 62, 2, 32, '#e8e2d2'); R(g, wx, 78, 20, 2, '#e8e2d2'); R(g, wx + 1, 66, 5, 6, '#c9e8f8');
    R(g, wx - 3, 96, 26, 3, '#d8d0bc');
    win.push({ x: wx + 1, y: 63, w: 20, h: 31 });
  }
  // door
  R(g, 50, 72, 28, 38, '#e8e2d2'); R(g, 53, 76, 22, 34, '#5a3a2a'); R(g, 55, 74, 18, 2, '#5a3a2a');
  R(g, 55, 78, 8, 30, '#7a4e2d'); R(g, 65, 78, 8, 30, '#7a4e2d'); R(g, 61, 92, 2, 2, '#ffd23a'); R(g, 65, 92, 2, 2, '#ffd23a');
  // book sign
  R(g, 46, 52, 36, 14, '#f6f0e0'); R(g, 46, 52, 36, 2, '#ffffff'); R(g, 46, 64, 36, 2, '#c9bfa8');
  R(g, 52, 55, 11, 8, '#4a7fc9'); R(g, 64, 55, 11, 8, '#4a7fc9'); R(g, 63, 55, 1, 8, '#2f4f8a'); R(g, 54, 57, 7, 1, '#cfe0ff'); R(g, 66, 57, 7, 1, '#cfe0ff'); R(g, 54, 59, 6, 1, '#cfe0ff'); R(g, 66, 59, 6, 1, '#cfe0ff');
  R(g, 46, 110, 36, 4, '#cfc6b2');
  const img = outlined(c, '#3a2a2a');
  return { img, ox: -1, oy: 80 - H - 1, windows: win };
}

// ----- Cafe: footprint 7x4 (112x64); sprite 112x100
export function makeCafe() {
  const W = 112, H = 100;
  const [c, g] = makeCanvas(W, H);
  const wood = '#e7c38f', woodD = '#c9a06a', roof = '#a5523f';
  R(g, 4, 40, W - 8, 58, wood);
  for (let yy = 42; yy < 98; yy += 5) R(g, 4, yy, W - 8, 1, woodD);
  R(g, 4, 40, 2, 58, woodD); R(g, W - 6, 40, 2, 58, woodD);
  // roof
  for (let yy = 6; yy <= 42; yy++) {
    const t = (yy - 6) / 36;
    const x0 = Math.round(20 - 20 * t), x1 = Math.round(92 + 20 * t);
    R(g, x0, yy, x1 - x0, 1, roof);
    if ((yy - 6) % 4 === 3) R(g, x0, yy, x1 - x0, 1, shade(roof, -0.22));
    else for (let xx = x0 + (((yy - 6) >> 2) & 1) * 3; xx < x1; xx += 6) R(g, xx, yy, 1, 1, shade(roof, -0.22));
  }
  R(g, 20, 6, 72, 2, shade(roof, 0.3)); R(g, 0, 41, W, 2, shade(roof, -0.35));
  // sign board on roof
  R(g, 34, 16, 44, 14, '#3a2d34'); R(g, 36, 18, 40, 10, '#f6f0e0');
  R(g, 40, 20, 6, 6, '#b07a4a'); R(g, 46, 21, 2, 3, '#b07a4a'); R(g, 41, 20, 4, 2, '#fff');
  for (let i = 0; i < 4; i++) R(g, 51 + i * 6, 22, 4, 2, '#a5523f');
  // big window
  R(g, 10, 64, 40, 28, '#ffffff'); R(g, 12, 66, 36, 24, '#8fc8e8'); R(g, 29, 66, 2, 24, '#ffffff'); R(g, 12, 66, 10, 4, '#c9e8f8');
  for (let i = 0; i < 4; i++) { R(g, 14 + i * 8, 84, 5, 4, ['#f2a65a', '#e86a5e', '#f5d06b', '#b07a4a'][i]); }
  R(g, 8, 92, 44, 3, '#8a5a3a');
  // door
  R(g, 60, 66, 18, 32, '#3a5a40'); R(g, 62, 68, 14, 30, '#4f8a5b'); R(g, 64, 70, 10, 10, '#a9d8f0'); R(g, 73, 84, 2, 2, '#ffd23a');
  // awning
  for (let x = 0; x < W; x++) {
    const col = (x >> 3) & 1 ? '#fff3e0' : '#e2574c';
    R(g, x, 52, 1, 10, col);
    const sc = (x & 7) < 4 ? 1 : 0; R(g, x, 62, 1, 2 + sc, col);
  }
  R(g, 0, 52, W, 1, '#b8423a');
  // plant pots
  for (const px of [86, 98]) { R(g, px, 88, 8, 8, '#c9704a'); R(g, px - 1, 86, 10, 2, '#a8584a'); R(g, px, 78, 8, 8, '#5fa64a'); R(g, px + 2, 76, 4, 3, '#8fd16a'); }
  const img = outlined(c, '#3a2a2a');
  return { img, ox: -1, oy: 64 - H - 1, windows: [{ x: 13, y: 67, w: 36, h: 24 }, { x: 65, y: 71, w: 10, h: 10 }] };
}

// ----- noticeboard: footprint 2x1 (32x16); sprite 34x40
export function makeNoticeboard() {
  const W = 34, H = 40;
  const [c, g] = makeCanvas(W, H);
  R(g, 4, 10, 3, 30, '#6b4a2e'); R(g, 27, 10, 3, 30, '#6b4a2e');
  R(g, 1, 8, 32, 22, '#7a4e2d'); R(g, 3, 10, 28, 18, '#c9925a');
  for (let i = 0; i < 12; i++) R(g, 4 + (i * 7) % 26, 11 + (i * 5) % 16, 1, 1, '#b07a44');
  R(g, 0, 2, 34, 6, '#5a7d4a'); R(g, 2, 0, 30, 3, '#6f9a5a'); R(g, 0, 7, 34, 1, '#3f5a35');
  const img = outlined(c, '#2b2233');
  return { img, ox: -1 - 1, oy: 16 - H - 1, board: { x: 3 + 1, y: 10 + 1, w: 28, h: 18 } };
}

// ----- fountain: footprint 4x3 (64x48); sprite 64x60
export function makeFountain() {
  const W = 64, H = 60;
  const [c, g] = makeCanvas(W, H);
  const ell = (cx, cy, rx, ry, col) => { for (let yy = -ry; yy <= ry; yy++) { const w = Math.round(rx * Math.sqrt(1 - (yy * yy) / (ry * ry))); R(g, cx - w, cy + yy, w * 2, 1, col); } };
  ell(32, 42, 31, 16, '#a59d90');
  ell(32, 40, 29, 14, '#d8d0c0');
  ell(32, 41, 25, 11, '#4f9ccc');
  ell(32, 40, 23, 9, '#69b4de');
  R(g, 14, 38, 6, 1, '#a9dcf5'); R(g, 40, 44, 8, 1, '#a9dcf5');
  // pillar
  R(g, 29, 18, 6, 22, '#c9c0b0'); R(g, 29, 18, 2, 22, '#e6dfd2');
  ell(32, 18, 11, 4, '#b8b0a2'); ell(32, 17, 9, 3, '#69b4de');
  R(g, 30, 6, 4, 11, '#9fd6f5'); R(g, 31, 4, 2, 3, '#d9f1fb');
  const img = outlined(c, '#3a3540');
  return { img, ox: -1, oy: 48 - H - 1 };
}

// ---------------------------------------------------------------- glow sprite
let glowCache = null;
export function getGlow() {
  if (glowCache) return glowCache;
  const [c, g] = makeCanvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,214,140,0.9)');
  gr.addColorStop(0.35, 'rgba(255,190,110,0.45)');
  gr.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowCache = c;
  return c;
}

// ---------------------------------------------------------------- screen-space UI helpers
export const UI_FONT = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const TAG_FONT = '700 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function wrapText(ctx, text, maxW, maxLines = 2) {
  ctx.font = UI_FONT;
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; if (lines.length >= maxLines) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  // ellipsize last line if text was cut
  const joined = lines.join(' ');
  if (joined.length < String(text).trim().length && lines.length) {
    let l = lines[lines.length - 1];
    while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1);
    lines[lines.length - 1] = l + '…';
  }
  let w = 0; for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  return { lines, w: Math.ceil(w) };
}

/** pixel-styled speech bubble anchored at (sx,sy) = tail tip, screen space */
export function drawBubble(ctx, sx, sy, layout, icon, opts = {}) {
  const pad = 5, lh = 13, s = 2;
  const iw = icon ? icon.width * s + 4 : 0;
  const hasText = layout && layout.lines.length;
  const w = Math.max(hasText ? layout.w + pad * 2 + iw : iw + 6, 16);
  const h = hasText ? layout.lines.length * lh + pad * 2 - 2 : (icon ? icon.height * s + 6 : 16);
  const x = Math.round(sx - w / 2), y = Math.round(sy - h - 6);
  const bg = opts.bg || '#fffdf6', bd = opts.border || OUTLINE;
  ctx.fillStyle = bd;
  ctx.fillRect(x + 2, y, w - 4, h); ctx.fillRect(x, y + 2, w, h - 4); ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = bg;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4); ctx.fillRect(x + 1, y + 3, w - 2, h - 6); ctx.fillRect(x + 3, y + 1, w - 6, h - 2);
  // tail
  ctx.fillStyle = bd; ctx.fillRect(sx - 4, y + h - 1, 8, 2); ctx.fillRect(sx - 3, y + h + 1, 6, 2); ctx.fillRect(sx - 2, y + h + 3, 4, 2); ctx.fillRect(sx - 1, y + h + 5, 2, 1);
  ctx.fillStyle = bg; ctx.fillRect(sx - 3, y + h - 2, 6, 2); ctx.fillRect(sx - 2, y + h, 4, 2); ctx.fillRect(sx - 1, y + h + 2, 2, 2);
  if (opts.accent) { ctx.fillStyle = opts.accent; ctx.fillRect(x + 3, y + 2, 3, h - 4); }
  if (icon) ctx.drawImage(icon, x + (hasText ? pad + (opts.accent ? 3 : 0) : Math.round((w - icon.width * s) / 2)), y + Math.round((h - icon.height * s) / 2), icon.width * s, icon.height * s);
  if (hasText) {
    ctx.font = UI_FONT; ctx.fillStyle = '#2b2233'; ctx.textBaseline = 'top';
    layout.lines.forEach((l, i) => ctx.fillText(l, x + pad + iw + (opts.accent ? 3 : 0), y + pad + i * lh - 1));
  }
  return { x, y, w, h };
}

export function drawTag(ctx, sx, sy, text, color, opts = {}) {
  ctx.font = TAG_FONT;
  const tw = Math.ceil(ctx.measureText(text).width);
  const w = tw + 18, h = 16;
  const x = Math.round(sx - w / 2), y = Math.round(sy - h);
  ctx.fillStyle = opts.bg || 'rgba(34,26,30,0.88)';
  ctx.fillRect(x + 1, y, w - 2, h); ctx.fillRect(x, y + 1, w, h - 2);
  if (opts.selected) { ctx.fillStyle = '#ffd166'; ctx.fillRect(x + 1, y + h - 2, w - 2, 2); }
  ctx.fillStyle = color; ctx.fillRect(x + 5, y + 5, 6, 6);
  ctx.fillStyle = '#fff8ec'; ctx.textBaseline = 'top';
  ctx.fillText(text, x + 14, y + 2);
  return { x, y, w, h };
}
