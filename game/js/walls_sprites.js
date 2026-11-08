// Swarm Town — walls_sprites.js : procedural pixel-art for the "three_walls" map theme
// (a dark-fantasy walled city besieged by the stone-and-moss Colossi). Original designs only.
import { TILE, T, OUTLINE, hashStr, hash2, mulberry32, makeCanvas, outlined, shade, mix } from './sprites.js';

const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const ell = (g, cx, cy, rx, ry, col) => {
  for (let yy = -ry; yy <= ry; yy++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry)))); if (w > 0) R(g, cx - w, cy + yy, w * 2, 1, col); }
};

// ---------------------------------------------------------------- palette (overcast, moody)
export const WP = {
  grass: '#55683f', grassD: '#4a5c37', grassL: '#62774a', blade: '#3d4f2e',
  plain: '#5f6a42', plainD: '#535d3a', plainL: '#6c774b',
  mud: '#6a5843', mudD: '#5b4b39', mudL: '#7a6750',
  road: '#6f6b64', roadD: '#5c5953', roadL: '#807b73', roadE: '#4c4945',
  plaza: '#67635c', plazaL: '#77736b', plazaD: '#56534d',
  water: '#3a5565', waterD: '#2d4452', waterL: '#4f6d7e', foam: '#7f9aa6',
  wheat: '#a8873f', wheatL: '#c9a656', wheatD: '#86692f', soil: '#5e4a35',
  stone: '#7d786f', stoneL: '#928c82', stoneD: '#5d5952', stoneDD: '#46433e', mortar: '#3c3a36',
  moss: '#4f6838', mossL: '#66844a', slate: '#3e4652', slateL: '#535d6b', slateD: '#2c323b',
  wood: '#6b5038', woodL: '#86684a', woodD: '#4e3a28', thatch: '#9a7f45', thatchD: '#7a6334',
  plaster: '#b9b09c', plasterD: '#9a917e', cloth: '#a89878', clothD: '#857659',
  fire: '#ff9a3a', fireL: '#ffd27a', fireD: '#d0502a', glass: '#4a5866', glassL: '#6e8090',
  banner: '#2f5d5a', bannerL: '#3f7a74', bone: '#d9cfb8', rust: '#8a4a2e',
};

// ---------------------------------------------------------------- ground tiles
export function paintTileWalls(g, tiles, W, H, x, y, deco) {
  const t = tiles[y * W + x];
  const px = x * TILE, py = y * TILE;
  const rnd = mulberry32(hashStr('w' + x + ',' + y));
  const at = (dx, dy) => { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) return T.GRASS; return tiles[yy * W + xx]; };
  const dots = (n, c, s = 1) => { for (let i = 0; i < n; i++) R(g, px + Math.floor(rnd() * (TILE - s + 1)), py + Math.floor(rnd() * (TILE - s + 1)), s, s, c); };
  const isPaved = v => v === T.ROAD || v === T.PLAZA || v === T.PATH || v === T.DOCK || v === T.MUD;
  switch (t) {
    case T.GRASS: case T.PARK: case T.SAND: {
      const plain = t === T.SAND; // SAND = open plains beyond the walls
      const park = t === T.PARK;
      R(g, px, py, TILE, TILE, plain ? WP.plain : park ? '#5a7342' : WP.grass);
      if (park && ((x + y) & 1)) R(g, px, py, TILE, TILE, '#5e7845');
      dots(7, plain ? WP.plainD : WP.grassD); dots(4, plain ? WP.plainL : WP.grassL);
      for (let i = 0; i < 3; i++) { const bx = px + Math.floor(rnd() * 14) + 1, by = py + Math.floor(rnd() * 13) + 2; R(g, bx, by, 1, 2, WP.blade); R(g, bx + 1, by + 1, 1, 1, WP.blade); }
      if (deco === 1) { // dull wildflowers
        const cols = ['#c9c2a8', '#b9a24a', '#9a7aa0', '#b46a5a'];
        const c = cols[Math.floor(rnd() * cols.length)];
        for (let i = 0; i < 3; i++) { const fx = px + 2 + Math.floor(rnd() * 11), fy = py + 2 + Math.floor(rnd() * 11); R(g, fx, fy + 1, 1, 2, '#3f5530'); R(g, fx - 1, fy, 3, 1, c); R(g, fx, fy - 1, 1, 3, c); }
      } else if (deco === 2) {
        for (let i = 0; i < 4; i++) R(g, px + 4 + i * 2, py + 7 - (i & 1) * 2, 1, 5 + (i & 1) * 2, WP.blade);
      } else if (deco === 3) { // pebbles
        for (let i = 0; i < 4; i++) { const sx = px + 2 + Math.floor(rnd() * 11), sy = py + 3 + Math.floor(rnd() * 10); R(g, sx, sy, 2, 2, '#77736b'); R(g, sx, sy, 1, 1, '#8f8a80'); }
      } else if (deco === 4) { // dry brush
        for (let i = 0; i < 5; i++) R(g, px + 3 + i * 2, py + 6 + (i & 1), 1, 6 - (i & 1) * 2, '#7a6a48');
        R(g, px + 3, py + 11, 10, 1, '#6a5a3c');
      }
      if (at(0, -1) === T.WALL) { R(g, px, py, TILE, 5, 'rgba(10,12,16,0.35)'); R(g, px, py, TILE, 2, 'rgba(10,12,16,0.25)'); }
      break;
    }
    case T.MUD: {
      R(g, px, py, TILE, TILE, WP.mud);
      dots(6, WP.mudD); dots(4, WP.mudL); dots(2, '#4d3f30', 2);
      if (rnd() < 0.25) { R(g, px + 3, py + 9, 5, 2, '#4a5560'); R(g, px + 4, py + 9, 3, 1, '#5d6a75'); } // puddle
      if (!isPaved(at(0, -1)) && at(0, -1) !== T.WALL) for (let i = 0; i < 4; i++) R(g, px + Math.floor(rnd() * 15), py, 1, 2, WP.grassD);
      if (at(0, -1) === T.WALL) R(g, px, py, TILE, 4, 'rgba(10,12,16,0.35)');
      break;
    }
    case T.PATH: {
      R(g, px, py, TILE, TILE, '#7a6a52');
      dots(5, '#6a5b45'); dots(4, '#8a7a60'); dots(2, '#5c4e3b', 2);
      const edge = v => !isPaved(v) && v !== T.WALL;
      if (edge(at(0, -1))) R(g, px, py, TILE, 1, '#5f5140');
      if (edge(at(0, 1))) R(g, px, py + TILE - 1, TILE, 1, '#6a5b48');
      if (edge(at(-1, 0))) R(g, px, py, 1, TILE, '#6a5b48');
      if (edge(at(1, 0))) R(g, px + TILE - 1, py, 1, TILE, '#6a5b48');
      if (at(0, -1) === T.WALL) R(g, px, py, TILE, 4, 'rgba(10,12,16,0.35)');
      break;
    }
    case T.ROAD: {
      R(g, px, py, TILE, TILE, WP.roadE);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const sx = px + c * 4 + ((r & 1) ? 2 : 0), sy = py + r * 4, v = rnd();
        R(g, sx, sy, 3, 3, v < 0.33 ? WP.roadL : v < 0.66 ? WP.road : WP.roadD);
        R(g, sx, sy, 1, 1, '#8c877e');
      }
      if (rnd() < 0.2) R(g, px + Math.floor(rnd() * 12), py + Math.floor(rnd() * 12), 3, 2, WP.moss);
      const edge = v => !isPaved(v) && v !== T.WALL;
      if (edge(at(0, -1))) R(g, px, py, TILE, 1, '#3f3c38');
      if (edge(at(0, 1))) R(g, px, py + TILE - 1, TILE, 1, '#3f3c38');
      if (edge(at(-1, 0))) R(g, px, py, 1, TILE, '#3f3c38');
      if (edge(at(1, 0))) R(g, px + TILE - 1, py, 1, TILE, '#3f3c38');
      if (at(0, -1) === T.WALL) R(g, px, py, TILE, 4, 'rgba(10,12,16,0.3)');
      break;
    }
    case T.PLAZA: {
      R(g, px, py, TILE, TILE, WP.plazaD);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
        const sx = px + c * 8 - ((r + y) & 1 ? 4 : 0), sy = py + r * 8, v = rnd();
        const col = v < 0.4 ? WP.plaza : v < 0.8 ? WP.plazaL : '#6e6658';
        const x0 = Math.max(px, sx + 1), x1 = Math.min(px + TILE, sx + 8);
        if (x1 > x0) { R(g, x0, sy + 1, x1 - x0, 7, col); R(g, x0, sy + 1, Math.min(2, x1 - x0), 1, '#85807a'); }
      }
      if (rnd() < 0.15) R(g, px + Math.floor(rnd() * 13), py + Math.floor(rnd() * 13), 2, 1, WP.moss);
      if (at(0, -1) === T.WALL) R(g, px, py, TILE, 4, 'rgba(10,12,16,0.3)');
      break;
    }
    case T.WATER: case T.DEEP: {
      R(g, px, py, TILE, TILE, t === T.DEEP ? WP.waterD : WP.water);
      for (let i = 0; i < 2; i++) { const wx = px + Math.floor(rnd() * 11), wy = py + Math.floor(rnd() * 15); R(g, wx, wy, 4, 1, WP.waterL); }
      const shore = v => !(v === T.WATER || v === T.DEEP || v === T.DOCK);
      if (shore(at(0, -1))) { R(g, px, py, TILE, 2, '#4a4436'); R(g, px, py + 2, TILE, 1, WP.foam); }
      if (shore(at(0, 1))) R(g, px, py + TILE - 2, TILE, 2, '#33505e');
      if (shore(at(-1, 0))) R(g, px, py, 2, TILE, '#4a6676');
      if (shore(at(1, 0))) R(g, px + TILE - 2, py, 2, TILE, '#4a6676');
      break;
    }
    case T.WHEAT: case T.FIELD: {
      const fallow = hash2(Math.floor(x / 5), Math.floor(y / 4), 19) < 0.22;
      R(g, px, py, TILE, TILE, WP.soil);
      for (let r = 0; r < 4; r++) {
        R(g, px, py + r * 4 + 3, TILE, 1, '#4c3b2a');
        for (let c = 0; c < 4; c++) {
          const cx = px + c * 4 + 1, cy = py + r * 4;
          if (fallow) { if (rnd() < 0.5) R(g, cx, cy + 2, 2, 1, '#5d6b3c'); }
          else { R(g, cx, cy, 2, 3, WP.wheat); R(g, cx, cy, 1, 1, WP.wheatL); R(g, cx + 1, cy + 2, 1, 1, WP.wheatD); }
        }
      }
      break;
    }
    case T.DOCK: { // wooden bridge planks
      R(g, px, py, TILE, TILE, '#6b5038');
      for (let i = 0; i < 4; i++) { R(g, px, py + i * 4 + 3, TILE, 1, '#4a3626'); R(g, px + ((i * 5) % 12) + 2, py + i * 4 + 1, 1, 1, '#3a2a1e'); }
      R(g, px, py, 1, TILE, '#3a2a1e'); R(g, px + TILE - 1, py, 1, TILE, '#3a2a1e');
      break;
    }
    case T.WALL: paintWallTile(g, px, py, at, rnd, x, y); break;
    default: R(g, px, py, TILE, TILE, WP.grass);
  }
}

/** Thick stone wall in 3/4 view: the 2 bottom-most rows of each column are the vertical face, the rest is the walkway. */
function paintWallTile(g, px, py, at, rnd, x, y) {
  const isW = v => v === T.WALL;
  const d1 = isW(at(0, 1)), d2 = isW(at(0, 2));
  const depth = !d1 ? 0 : !d2 ? 1 : 2;
  if (depth >= 2) {
    // walkway flagstones
    R(g, px, py, TILE, TILE, WP.stoneD);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const v = rnd(); const ox = (r + y) & 1 ? 4 : 0;
      R(g, px + c * 8 + 1 - ox, py + r * 8 + 1, 7, 7, v < 0.4 ? WP.stone : v < 0.75 ? '#857f75' : '#77726a');
      R(g, px + c * 8 + 1 - ox, py + r * 8 + 1, 7, 1, WP.stoneL);
    }
    R(g, px - 0, py, 1, TILE, WP.stoneD);
    if (rnd() < 0.18) R(g, px + 2 + Math.floor(rnd() * 10), py + 2 + Math.floor(rnd() * 10), 3, 2, WP.moss);
    // parapet merlons where the walkway meets open ground (top / left / right) or the face below (outer lip)
    const merlonsH = (yy, up) => {
      R(g, px, yy + 2, TILE, 2, WP.stoneDD);
      for (let i = 0; i < TILE; i += 6) { R(g, px + i, yy - (up ? 1 : 0), 4, 4, WP.stoneL); R(g, px + i, yy + 3 - (up ? 1 : 0), 4, 1, WP.stoneDD); R(g, px + i, yy - (up ? 1 : 0), 4, 1, '#a8a296'); }
    };
    if (!isW(at(0, -1))) merlonsH(py, true);
    if (!isW(at(0, 3)) && isW(at(0, 1)) && isW(at(0, 2))) merlonsH(py + TILE - 4, false);
    if (!isW(at(-1, 0))) { R(g, px, py, 3, TILE, WP.stoneDD); for (let i = 0; i < TILE; i += 6) { R(g, px, py + i, 3, 4, WP.stoneL); R(g, px, py + i, 1, 4, '#a8a296'); } }
    if (!isW(at(1, 0))) { R(g, px + TILE - 3, py, 3, TILE, WP.stoneDD); for (let i = 0; i < TILE; i += 6) { R(g, px + TILE - 3, py + i, 3, 4, WP.stoneL); R(g, px + TILE - 1, py + i, 1, 4, WP.stoneD); } }
    return;
  }
  // vertical face: big ashlar blocks, mortar, moss & damp streaks
  R(g, px, py, TILE, TILE, WP.mortar);
  const rows = 3;
  for (let r = 0; r < rows; r++) {
    const ry = py + r * 5 + (depth === 1 ? 1 : 0);
    const off = ((r + (depth === 1 ? 0 : 1) + x) & 1) ? 4 : 0;
    for (let c = -1; c < 2; c++) {
      const v = rnd();
      const bx = px + c * 8 + off + 1;
      const x0 = Math.max(px, bx), x1 = Math.min(px + TILE, bx + 7);
      if (x1 <= x0) continue;
      R(g, x0, ry, x1 - x0, 4, v < 0.35 ? '#635e56' : v < 0.7 ? '#5a554e' : '#6b665d');
      R(g, x0, ry, x1 - x0, 1, '#736e64');
    }
  }
  if (depth === 1) { R(g, px, py, TILE, 2, WP.stoneL); R(g, px, py + 2, TILE, 1, WP.stoneDD); }
  if (depth === 0) {
    for (let i = 0; i < 4; i++) { const mx = px + Math.floor(rnd() * 13); R(g, mx, py + 10 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 3), 6, rnd() < 0.5 ? WP.moss : WP.mossL); }
    R(g, px, py + TILE - 2, TILE, 2, '#2c2a27');
  }
  if (rnd() < 0.35) { const sx = px + Math.floor(rnd() * 14); R(g, sx, py, 1, TILE, 'rgba(25,28,24,0.35)'); }
  if (!isW(at(-1, 0))) R(g, px, py, 2, TILE, '#4a4741');
  if (!isW(at(1, 0))) R(g, px + TILE - 2, py, 2, TILE, '#3a3834');
}

// ---------------------------------------------------------------- trees & nature
export function makeDarkTree(kind, seed) {
  const rnd = mulberry32(seed);
  const [c, g] = makeCanvas(22, 30);
  if (kind === 'dead') {
    const bark = '#4a3e33', barkL = '#5e5042';
    R(g, 10, 12, 3, 17, bark); R(g, 10, 12, 1, 17, barkL); R(g, 8, 28, 7, 1, '#3a3028');
    const br = (x, y, dx, dy, n) => { for (let i = 0; i < n; i++) { R(g, x + dx * i, y + dy * i, 1, 1, bark); if (i % 3 === 2) R(g, x + dx * i, y + dy * i - 1, 1, 1, bark); } };
    br(10, 14, -1, -1, 7); br(12, 13, 1, -1, 8); br(11, 12, 0, -1, 9); br(10, 18, -1, -1, 5); br(12, 19, 1, -1, 5); br(5, 9, -1, 0, 3); br(17, 7, 1, -1, 3);
    return { img: outlined(c, '#1e1c1a'), ox: -4, oy: -15 };
  }
  R(g, 9, 20, 4, 9, '#4f3b2a'); R(g, 9, 20, 1, 9, '#3a2b1f'); R(g, 8, 28, 6, 1, '#3a2b1f');
  if (kind === 'pine') {
    const cols = ['#24392f', '#2f4a3a', '#3d5c47'];
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
    const pal = kind === 'rust' ? ['#5e3f25', '#7a5530', '#977045'] : ['#2f4528', '#3f5a33', '#557545'];
    const blob = (cx, cy, r, col) => { for (let yy = -r; yy <= r; yy++) { const w = Math.round(Math.sqrt(r * r - yy * yy)); R(g, cx - w, cy + yy, w * 2, 1, col); } };
    blob(11, 12, 10, pal[0]); blob(6, 14, 6, pal[0]); blob(16, 13, 6, pal[0]);
    blob(10, 10, 7, pal[1]); blob(15, 11, 4, pal[1]); blob(8, 7, 3, pal[2]);
    for (let i = 0; i < 14; i++) { const xx = 3 + Math.floor(rnd() * 16), yy = 4 + Math.floor(rnd() * 14); R(g, xx, yy, 1, 1, rnd() < 0.5 ? pal[2] : pal[0]); }
    R(g, 3, 18, 16, 2, pal[0]);
  }
  return { img: outlined(c, '#161c16'), ox: -4, oy: -15 };
}
export function makeStoneRock(seed) {
  const rnd = mulberry32(seed);
  const [c, g] = makeCanvas(14, 10);
  R(g, 2, 2, 9, 7, '#66625b'); R(g, 1, 4, 12, 5, '#66625b'); R(g, 3, 2, 5, 2, '#7f7a71'); R(g, 2, 8, 10, 1, '#4a4741');
  if (rnd() < 0.6) R(g, 6, 2, 4, 2, WP.moss);
  return { img: outlined(c, '#1f1d1b'), ox: 0, oy: 5 };
}

// ---------------------------------------------------------------- wall props
export function makeTorch() {
  const [c, g] = makeCanvas(8, 14);
  R(g, 3, 6, 2, 7, '#3a2a1e'); R(g, 2, 12, 4, 1, '#2a2622'); R(g, 1, 5, 6, 2, '#2f2b27');
  R(g, 2, 1, 4, 4, WP.fire); R(g, 3, 0, 2, 2, WP.fireL); R(g, 3, 3, 2, 2, '#fff1b8');
  return { img: outlined(c, '#1c1916'), ox: 4, oy: -6, light: { dx: 4 + 1, dy: 2 + 1 }, flame: { dx: 5, dy: 2 } };
}
export function makeBrazier() {
  const [c, g] = makeCanvas(12, 14);
  R(g, 2, 6, 8, 4, '#3a3632'); R(g, 1, 5, 10, 2, '#4d4843'); R(g, 3, 10, 1, 4, '#2c2926'); R(g, 8, 10, 1, 4, '#2c2926');
  R(g, 3, 1, 6, 5, WP.fire); R(g, 4, 0, 4, 3, WP.fireL); R(g, 5, 2, 2, 3, '#fff1b8');
  return { img: outlined(c, '#1c1916'), ox: 2, oy: -2, light: { dx: 6 + 1, dy: 3 + 1 }, flame: { dx: 7, dy: 2 } };
}

/** Watchtower with an open belfry and a bronze bell. Footprint 3x3 (48x48). */
export function makeWatchtower(seed) {
  const W = 50, H = 96;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(seed);
  // body
  R(g, 5, 40, 40, 54, '#5e5952');
  for (let yy = 42; yy < 92; yy += 6) { R(g, 5, yy, 40, 1, WP.mortar); for (let xx = 5 + ((yy / 6) & 1) * 5; xx < 45; xx += 10) R(g, xx, yy + 1, 1, 5, WP.mortar); }
  R(g, 5, 40, 3, 54, '#6e6960'); R(g, 42, 40, 3, 54, '#47443f');
  for (let i = 0; i < 6; i++) R(g, 7 + Math.floor(rnd() * 34), 80 + Math.floor(rnd() * 10), 4, 3, WP.moss);
  R(g, 22, 54, 6, 12, '#16161a'); R(g, 23, 55, 4, 10, '#2a2a30'); // slit
  R(g, 21, 52, 8, 2, WP.stoneL);
  R(g, 5, 92, 40, 2, '#2c2a27');
  // platform & merlons
  R(g, 1, 34, 48, 7, WP.stone); R(g, 1, 34, 48, 1, WP.stoneL); R(g, 1, 40, 48, 1, WP.stoneDD);
  for (let x = 1; x < 49; x += 8) { R(g, x, 28, 5, 6, WP.stone); R(g, x, 28, 5, 1, WP.stoneL); }
  // posts + belfry
  R(g, 6, 12, 3, 22, WP.woodD); R(g, 41, 12, 3, 22, WP.woodD);
  R(g, 9, 14, 32, 18, '#1e1d22');
  // bell
  const bx = 25, by = 17;
  R(g, bx - 1, 13, 2, 3, '#3a3026');
  ell(g, bx, by + 5, 6, 6, '#a6783a'); R(g, bx - 7, by + 9, 14, 3, '#b8873f'); R(g, bx - 3, by + 1, 2, 6, '#d6a85a');
  R(g, bx - 1, by + 12, 2, 2, '#5a4026');
  // roof
  for (let yy = 0; yy <= 13; yy++) { const w = Math.round(3 + yy * 1.85); R(g, 25 - w, yy, w * 2, 1, (yy % 3 === 2) ? WP.slateD : WP.slate); }
  R(g, 0, 13, 50, 2, WP.slateD); R(g, 24, 0, 2, 2, '#8a8f99');
  const img = outlined(c, '#18171a');
  return { img, ox: -1, oy: 48 - H - 1, bell: { x: bx + 1, y: by + 1 }, windows: [{ x: 23, y: 55, w: 4, h: 10 }] };
}

/** Gatehouse. horizontal=true for gates in the north/south wall (footprint 8 x T), false for east/west (T x 8). */
export function makeGatehouse(horizontal, T_, closed) {
  if (horizontal) {
    const W = 8 * TILE, Fh = T_ * TILE, H = Fh + 40;
    const [c, g] = makeCanvas(W + 2, H);
    const top = H - Fh; // footprint top in sprite
    // wall bridge over the passage (walkway)
    R(g, 32, top - 6, 64, Fh - 26, WP.stone);
    for (let x = 32; x < 96; x += 8) R(g, x + 1, top - 5 + ((x >> 3) & 1) * 4, 6, 1, WP.stoneD);
    for (let x = 32; x < 96; x += 6) { R(g, x, top - 11, 4, 5, WP.stoneL); }
    // face of the passage block
    const fy = top + Fh - 34;
    R(g, 32, fy, 64, 34, '#5a554e');
    for (let yy = fy + 2; yy < fy + 34; yy += 5) R(g, 32, yy, 64, 1, WP.mortar);
    // arch opening
    const ax = 44, aw = 40, ay = fy + 6;
    R(g, ax, ay + 6, aw, 28, '#121216'); R(g, ax + 4, ay + 2, aw - 8, 4, '#121216'); R(g, ax + 10, ay, aw - 20, 2, '#121216');
    R(g, ax - 2, ay + 4, 2, 30, WP.stoneL); R(g, ax + aw, ay + 4, 2, 30, WP.stoneD);
    R(g, ax + 2, ay - 2, aw - 4, 2, WP.stoneL); R(g, 62, ay - 4, 4, 4, '#a8a296'); // keystone
    if (closed) {
      R(g, ax, ay + 6, aw, 28, '#5a3e26'); R(g, ax + 4, ay + 2, aw - 8, 4, '#5a3e26');
      for (let x = ax + 3; x < ax + aw; x += 6) R(g, x, ay + 3, 1, 31, '#3e2a1a');
      R(g, ax, ay + 12, aw, 2, '#3a3a40'); R(g, ax, ay + 26, aw, 2, '#3a3a40');
      R(g, 63, ay + 4, 2, 30, '#2e2016');
      for (let x = ax + 2; x < ax + aw; x += 6) { R(g, x, ay + 12, 1, 1, '#8a8a90'); R(g, x, ay + 26, 1, 1, '#8a8a90'); }
    } else {
      // raised portcullis teeth + road glimpse
      R(g, ax, ay + 6, aw, 3, '#2e2e34'); for (let x = ax + 2; x < ax + aw; x += 5) R(g, x, ay + 9, 2, 3, '#3e3e46');
      R(g, ax + 8, ay + 24, aw - 16, 10, '#2a2826');
    }
    // two flanking towers
    for (const tx of [0, 96]) {
      R(g, tx, 10, 32, H - 10, '#615c55');
      for (let yy = 14; yy < H; yy += 6) { R(g, tx, yy, 32, 1, WP.mortar); for (let xx = tx + ((yy / 6) & 1) * 4; xx < tx + 32; xx += 8) R(g, xx, yy + 1, 1, 5, WP.mortar); }
      R(g, tx, 10, 3, H - 10, '#6e6960'); R(g, tx + 29, 10, 3, H - 10, '#46433e');
      R(g, tx - 1, 4, 34, 7, WP.stone); R(g, tx - 1, 4, 34, 1, WP.stoneL); R(g, tx - 1, 10, 34, 1, WP.stoneDD);
      for (let x = tx - 1; x < tx + 33; x += 8) { R(g, x, 0, 5, 5, WP.stone); R(g, x, 0, 5, 1, WP.stoneL); }
      R(g, tx + 13, 26, 6, 10, '#121216'); R(g, tx + 12, 24, 8, 2, WP.stoneL);
      for (let i = 0; i < 4; i++) R(g, tx + 3 + i * 7, H - 9 + (i & 1), 4, 5, WP.moss);
      R(g, tx, H - 2, 32, 2, '#2a2826');
    }
    // banner between towers (original sigil: three nested squares)
    R(g, 58, top - 30, 12, 20, WP.banner); R(g, 58, top - 30, 12, 2, WP.bannerL);
    R(g, 60, top - 26, 8, 8, WP.bone); R(g, 61, top - 25, 6, 6, WP.banner); R(g, 62, top - 24, 4, 4, WP.bone); R(g, 63, top - 23, 2, 2, WP.banner);
    R(g, 58, top - 10, 4, 3, WP.banner); R(g, 66, top - 10, 4, 3, WP.banner);
    const img = outlined(c, '#151416');
    return { img, ox: -1, oy: Fh - H - 1, torches: [{ x: 38, y: fy + 6 }, { x: 90, y: fy + 6 }] };
  }
  // vertical wall gate (passage runs east-west)
  const W = T_ * TILE, Fh = 8 * TILE, H = Fh + 30;
  const [c, g] = makeCanvas(W + 2, H);
  const off = 30;
  // passage roof (walkway bridging the gap)
  R(g, 0, off + 32, W, 64, WP.stone);
  for (let y = off + 34; y < off + 96; y += 8) { R(g, 2, y, W - 4, 1, WP.stoneD); }
  for (let y = off + 32; y < off + 96; y += 6) { R(g, 0, y, 3, 4, WP.stoneL); R(g, W - 3, y, 3, 4, WP.stoneL); }
  // gate leaves seen from above, at both ends of the passage
  const doorC = closed ? '#5a3e26' : '#121216';
  R(g, 0, off + 44, 4, 40, doorC); R(g, W - 4, off + 44, 4, 40, doorC);
  if (closed) for (let y = off + 46; y < off + 84; y += 6) { R(g, 0, y, 4, 1, '#3a3a40'); R(g, W - 4, y, 4, 1, '#3a3a40'); }
  // towers at both ends (top-down + south face)
  for (const ty of [off - 4, off + 92]) {
    R(g, -0, ty - 22, W, 26, WP.stone);
    for (let x = 0; x < W; x += 7) { R(g, x, ty - 28, 4, 6, WP.stone); R(g, x, ty - 28, 4, 1, WP.stoneL); }
    R(g, 0, ty - 22, W, 1, WP.stoneL);
    R(g, 0, ty + 4, W, 30, '#5f5a53');
    for (let yy = ty + 6; yy < ty + 34; yy += 6) R(g, 0, yy, W, 1, WP.mortar);
    R(g, Math.round(W / 2) - 3, ty + 12, 6, 9, '#121216');
    R(g, 0, ty + 32, W, 2, '#2a2826');
  }
  const img = outlined(c, '#151416');
  return { img, ox: -1, oy: Fh - H - 1, torches: [{ x: 2, y: off + 40 }, { x: W - 2, y: off + 40 }] };
}

// ---------------------------------------------------------------- dwellings (footprint 3x2 -> 48x32, door tile under centre)
export function makeTent(seed) {
  const rnd = mulberry32(seed);
  const W = 48, H = 34;
  const [c, g] = makeCanvas(W, H);
  const cl = ['#9a8b6e', '#8a7d64', '#a39276', '#7f735c'][Math.floor(rnd() * 4)];
  const cd = shade(cl, -0.25);
  for (let yy = 0; yy < 26; yy++) { const w = Math.round(4 + yy * 0.8); R(g, 24 - w, 4 + yy, w * 2, 1, (yy & 3) === 3 ? cd : cl); }
  for (let i = 0; i < 3; i++) R(g, 10 + Math.floor(rnd() * 26), 12 + Math.floor(rnd() * 12), 5, 4, ['#6e5a4a', '#5d6a6e', '#8a6a4a'][i]);
  R(g, 23, 2, 2, 28, '#3e2f22');
  for (let yy = 0; yy < 14; yy++) { const w = Math.round(1 + yy * 0.45); R(g, 24 - w, 16 + yy, w * 2, 1, '#1a1816'); }
  R(g, 2, 29, 4, 1, '#3e2f22'); R(g, 42, 29, 4, 1, '#3e2f22');
  R(g, 4, 20, 1, 9, '#5a4a3a'); R(g, 43, 20, 1, 9, '#5a4a3a');
  R(g, 6, 30, 36, 2, 'rgba(0,0,0,0.25)');
  const img = outlined(c, '#1d1a17');
  return { img, ox: -1, oy: 32 - H - 1, windows: [] };
}
export function makeShack(seed) {
  const rnd = mulberry32(seed);
  const W = 48, H = 52;
  const [c, g] = makeCanvas(W, H);
  const wood = ['#6b5038', '#5e4632', '#735a40'][Math.floor(rnd() * 3)];
  R(g, 5, 24, 38, 26, wood);
  for (let x = 5; x < 43; x += 4) { R(g, x, 24, 1, 26, shade(wood, -0.3)); if (rnd() < 0.3) R(g, x + 1, 24 + Math.floor(rnd() * 20), 3, 3, shade(wood, 0.15)); }
  R(g, 5, 48, 38, 2, '#2c241c');
  // crooked roof
  for (let yy = 8; yy <= 26; yy++) {
    const t = (yy - 8) / 18, x0 = Math.round(10 - 10 * t), x1 = Math.round(38 + 9 * t);
    R(g, x0, yy, x1 - x0, 1, (yy % 4 === 3) ? '#4a4038' : '#5a4e44');
  }
  for (let i = 0; i < 4; i++) R(g, 8 + Math.floor(rnd() * 30), 10 + Math.floor(rnd() * 14), 6, 4, i & 1 ? '#6a5a3a' : WP.moss);
  R(g, 2, 26, 44, 2, '#3a322b');
  R(g, 19, 34, 10, 16, '#2a1f17'); R(g, 20, 35, 8, 15, '#4a3626');
  R(g, 33, 32, 7, 6, '#1b1a1c'); R(g, 34, 33, 5, 4, '#3a4048');
  const img = outlined(c, '#1d1a17');
  return { img, ox: -1, oy: 32 - H - 1, windows: [{ x: 35, y: 34, w: 5, h: 4 }], chimney: { x: 14, y: 12 } };
}
export function makeFarmhouse(seed) {
  const rnd = mulberry32(seed);
  const W = 48, H = 56;
  const [c, g] = makeCanvas(W, H);
  R(g, 4, 28, 40, 26, WP.plaster);
  for (let i = 0; i < 6; i++) R(g, 6 + Math.floor(rnd() * 34), 30 + Math.floor(rnd() * 20), 3, 2, WP.plasterD);
  R(g, 4, 28, 2, 26, WP.woodD); R(g, 42, 28, 2, 26, WP.woodD); R(g, 4, 40, 40, 2, WP.woodD);
  R(g, 4, 52, 40, 2, '#3a3028');
  for (let yy = 4; yy <= 30; yy++) {
    const t = (yy - 4) / 26, x0 = Math.round(14 - 14 * t), x1 = Math.round(34 + 14 * t);
    R(g, x0, yy, x1 - x0, 1, WP.thatch);
    for (let xx = x0 + ((yy * 3) % 5); xx < x1; xx += 5) R(g, xx, yy, 1, 2, WP.thatchD);
  }
  R(g, 0, 30, 48, 2, WP.thatchD); R(g, 14, 4, 20, 2, '#b39858');
  R(g, 19, 40, 10, 14, '#3a2a1c'); R(g, 20, 41, 8, 13, '#5a4230');
  R(g, 8, 36, 7, 6, '#1b1a1c'); R(g, 9, 37, 5, 4, '#3a4048'); R(g, 34, 36, 7, 6, '#1b1a1c'); R(g, 35, 37, 5, 4, '#3a4048');
  const img = outlined(c, '#1d1a17');
  return { img, ox: -1, oy: 32 - H - 1, windows: [{ x: 10, y: 38, w: 5, h: 4 }, { x: 36, y: 38, w: 5, h: 4 }], chimney: { x: 30, y: 6 } };
}
export function makeWorkshopHouse(seed) {
  const rnd = mulberry32(seed);
  const W = 48, H = 60;
  const [c, g] = makeCanvas(W, H);
  const wall = ['#8a8273', '#7d776c', '#948a78'][Math.floor(rnd() * 3)];
  R(g, 4, 28, 40, 30, wall);
  for (let yy = 30; yy < 56; yy += 5) R(g, 4, yy, 40, 1, shade(wall, -0.2));
  R(g, 4, 28, 2, 30, shade(wall, -0.25)); R(g, 42, 28, 2, 30, shade(wall, -0.3));
  R(g, 4, 56, 40, 2, '#2c2a27');
  const roof = ['#4a3f3a', WP.slate, '#5a3a30'][Math.floor(rnd() * 3)];
  for (let yy = 6; yy <= 31; yy++) {
    const t = (yy - 6) / 25, x0 = Math.round(12 - 12 * t), x1 = Math.round(36 + 12 * t);
    R(g, x0, yy, x1 - x0, 1, (yy - 6) % 4 === 3 ? shade(roof, -0.3) : roof);
  }
  R(g, 0, 31, 48, 2, shade(roof, -0.35));
  const chimX = rnd() < 0.5 ? 9 : 31;
  R(g, chimX, 2, 7, 12, '#4f4842'); R(g, chimX, 2, 7, 2, '#2f2a26');
  R(g, 19, 42, 10, 14, '#2a1f17'); R(g, 20, 43, 8, 13, '#4e3a28'); R(g, 26, 49, 1, 1, '#b8a060');
  for (const wx of [8, 33]) { R(g, wx - 1, 37, 9, 9, '#3a3632'); R(g, wx, 38, 7, 7, WP.glass); R(g, wx + 3, 38, 1, 7, '#3a3632'); }
  // shop sign
  R(g, 12, 46, 1, 6, '#2a2622'); R(g, 6, 46, 7, 1, '#2a2622'); R(g, 6, 47, 6, 5, ['#8a6a3a', '#5a6a6e', '#7a4a3a'][Math.floor(rnd() * 3)]);
  const img = outlined(c, '#1d1a17');
  return { img, ox: -1, oy: 32 - H - 1, windows: [{ x: 9, y: 39, w: 7, h: 7 }, { x: 34, y: 39, w: 7, h: 7 }], chimney: { x: chimX + 4, y: 2 } };
}
export function makeNobleHouse(seed) {
  const rnd = mulberry32(seed);
  const W = 48, H = 76;
  const [c, g] = makeCanvas(W, H);
  const wall = ['#c2b9a6', '#b5ad9c', '#cbc2ae'][Math.floor(rnd() * 3)];
  R(g, 3, 26, 42, 48, wall);
  for (let yy = 28; yy < 72; yy += 6) R(g, 3, yy, 42, 1, shade(wall, -0.12));
  R(g, 3, 26, 2, 48, shade(wall, -0.2)); R(g, 43, 26, 2, 48, shade(wall, -0.28));
  R(g, 3, 48, 42, 3, shade(wall, -0.3));
  R(g, 3, 72, 42, 2, '#2c2a27');
  const roof = [WP.slate, '#3a4a4a', '#4a3a4a'][Math.floor(rnd() * 3)];
  for (let yy = 2; yy <= 28; yy++) {
    const t = (yy - 2) / 26, x0 = Math.round(14 - 14 * t), x1 = Math.round(34 + 14 * t);
    R(g, x0, yy, x1 - x0, 1, (yy - 2) % 3 === 2 ? shade(roof, -0.3) : roof);
  }
  R(g, 0, 27, 48, 2, shade(roof, -0.4)); R(g, 14, 2, 20, 1, shade(roof, 0.25));
  const win = [];
  for (const wx of [8, 21, 34]) {
    R(g, wx, 32, 6, 11, '#2a2a30'); R(g, wx + 1, 33, 4, 9, WP.glass); R(g, wx + 1, 33, 4, 2, WP.glassL); R(g, wx - 1, 43, 8, 2, shade(wall, -0.3));
    win.push({ x: wx + 2, y: 34, w: 4, h: 9 });
    if (wx !== 21) { R(g, wx, 54, 6, 10, '#2a2a30'); R(g, wx + 1, 55, 4, 8, WP.glass); win.push({ x: wx + 2, y: 56, w: 4, h: 8 }); }
  }
  R(g, 19, 56, 10, 16, '#2a1f17'); R(g, 20, 57, 8, 15, '#5a2e2a'); R(g, 19, 54, 10, 2, shade(wall, -0.3));
  // banner
  R(g, 40, 30, 6, 14, rnd() < 0.5 ? WP.banner : '#5e2a3a'); R(g, 42, 33, 2, 2, WP.bone);
  const img = outlined(c, '#1d1a17');
  return { img, ox: -1, oy: 32 - H - 1, windows: win, chimney: { x: 12, y: 4 } };
}

// ---------------------------------------------------------------- landmarks
function stoneBlockWall(g, x, y, w, h, base, seedRnd) {
  R(g, x, y, w, h, base);
  for (let yy = y + 1; yy < y + h; yy += 5) { R(g, x, yy, w, 1, shade(base, -0.28)); for (let xx = x + (((yy - y) / 5) & 1) * 4; xx < x + w; xx += 9) R(g, xx, yy + 1, 1, 4, shade(base, -0.28)); }
  if (seedRnd) for (let i = 0; i < w / 6; i++) R(g, x + Math.floor(seedRnd() * (w - 4)), y + h - 4 - Math.floor(seedRnd() * 4), 4, 3, WP.moss);
}
function gableRoof(g, x0, x1, y0, y1, inset, col, colD) {
  for (let yy = y0; yy <= y1; yy++) {
    const t = (yy - y0) / Math.max(1, y1 - y0), a = Math.round(x0 + inset - inset * t), b = Math.round(x1 - inset + inset * t);
    R(g, a, yy, b - a, 1, (yy - y0) % 4 === 3 ? colD : col);
  }
  R(g, x0, y1, x1 - x0, 2, colD);
}

/** Granary (comora): timber barn + round stone silo. Footprint 6x4. */
export function makeGranary() {
  const W = 96, H = 100;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(77);
  // silo
  R(g, 62, 30, 30, 68, '#706a5f');
  for (let yy = 32; yy < 96; yy += 5) R(g, 62, yy, 30, 1, WP.mortar);
  R(g, 62, 30, 4, 68, '#827b6f'); R(g, 88, 30, 4, 68, '#544f47');
  for (let yy = 4; yy <= 30; yy++) { const w = Math.round(2 + (yy - 4) * 0.62); R(g, 77 - w, yy, w * 2, 1, (yy % 3 === 2) ? WP.thatchD : WP.thatch); }
  R(g, 59, 30, 36, 3, WP.thatchD);
  R(g, 73, 50, 8, 10, '#1b1a1c');
  // barn
  R(g, 2, 46, 62, 52, WP.wood);
  for (let x = 2; x < 64; x += 5) R(g, x, 46, 1, 52, WP.woodD);
  gableRoof(g, 0, 66, 18, 46, 14, '#5a4a38', '#3e3226');
  R(g, 20, 64, 26, 34, '#2a1f17'); R(g, 22, 66, 22, 32, '#4e3a28'); R(g, 32, 66, 2, 32, '#2a1f17');
  for (let i = 0; i < 2; i++) { R(g, 22, 70 + i * 16, 22, 2, '#2a1f17'); }
  R(g, 26, 26, 14, 10, '#1b1a1c'); R(g, 27, 27, 12, 8, '#3a3026');
  // sacks
  for (let i = 0; i < 5; i++) { const sx = 4 + i * 7 + (i > 2 ? 40 : 0), sy = 88 - (i & 1) * 3; R(g, sx, sy, 7, 9, '#a8946a'); R(g, sx + 1, sy, 5, 2, '#c4ae80'); R(g, sx + 3, sy - 1, 1, 2, '#6a5a3a'); }
  for (let i = 0; i < 3; i++) R(g, 4 + Math.floor(rnd() * 50), 92 + Math.floor(rnd() * 3), 4, 2, WP.moss);
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 64 - H - 1, windows: [{ x: 28, y: 28, w: 12, h: 8 }], icon: { x: 48, y: 4 } };
}

/** Barracks: long stone hall with a pennant (original nested-squares sigil). Footprint 7x4. */
export function makeBarracks(seed) {
  const W = 112, H = 96;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(seed);
  stoneBlockWall(g, 3, 40, 106, 54, '#68635a', rnd);
  gableRoof(g, 0, 112, 14, 40, 14, WP.slate, WP.slateD);
  R(g, 0, 40, 112, 3, WP.slateD);
  const win = [];
  for (const wx of [12, 30, 74, 92]) { R(g, wx, 54, 8, 12, '#18181c'); R(g, wx + 1, 55, 6, 10, WP.glass); R(g, wx - 1, 66, 10, 2, WP.stoneL); win.push({ x: wx + 2, y: 56, w: 6, h: 10 }); }
  R(g, 48, 58, 16, 36, '#2a1f17'); R(g, 50, 60, 12, 34, '#4e3a28'); R(g, 47, 56, 18, 3, WP.stoneL);
  // pennant pole
  R(g, 55, 0, 2, 22, '#3a3026'); R(g, 57, 2, 16, 10, WP.banner); R(g, 57, 2, 16, 1, WP.bannerL);
  R(g, 61, 4, 7, 6, WP.bone); R(g, 62, 5, 5, 4, WP.banner); R(g, 63, 6, 3, 2, WP.bone);
  // spear rack
  for (let i = 0; i < 4; i++) { R(g, 96 + i * 3, 70, 1, 22, '#4e3a28'); R(g, 96 + i * 3, 68, 1, 3, '#a0a4aa'); }
  R(g, 94, 84, 14, 2, '#3a2a1e');
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 64 - H - 1, windows: win };
}

/** Forge / smithy with glowing furnace. Footprint 4x3. */
export function makeForge(seed) {
  const W = 64, H = 84;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(seed);
  stoneBlockWall(g, 3, 36, 58, 46, '#5f5a52', rnd);
  // chimney
  R(g, 44, 0, 12, 36, '#4f4842'); for (let y = 2; y < 36; y += 5) R(g, 44, y, 12, 1, '#36312c'); R(g, 43, 0, 14, 3, '#2c2724');
  gableRoof(g, 0, 64, 18, 38, 10, '#4a3f3a', '#2f2825');
  R(g, 0, 37, 64, 2, '#2f2825');
  // open front with furnace
  R(g, 8, 50, 30, 32, '#141316');
  R(g, 12, 62, 18, 14, '#3a2a22'); R(g, 15, 65, 12, 9, WP.fireD); R(g, 17, 66, 8, 6, WP.fire); R(g, 19, 67, 4, 3, WP.fireL);
  // anvil
  R(g, 42, 70, 14, 4, '#2c2c32'); R(g, 45, 74, 8, 6, '#232328'); R(g, 40, 70, 4, 2, '#2c2c32'); R(g, 43, 70, 10, 1, '#5a5a66');
  R(g, 44, 54, 12, 10, '#2a2622'); R(g, 45, 55, 10, 8, WP.rust); // hanging tools board
  for (let i = 0; i < 3; i++) R(g, 47 + i * 3, 56, 1, 6, '#9a9aa4');
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 48 - H - 1, windows: [{ x: 16, y: 66, w: 12, h: 9 }], fire: { x: 22, y: 69 } };
}

/** Market stall, footprint 2x2 (32x32). */
export function makeStall(seed) {
  const rnd = mulberry32(seed);
  const W = 34, H = 42;
  const [c, g] = makeCanvas(W, H);
  const cols = [['#7a3a32', '#b9ad92'], ['#2f5d5a', '#b9ad92'], ['#6a5a2a', '#c4b896'], ['#4a3a5a', '#b9ad92']][Math.floor(rnd() * 4)];
  R(g, 3, 14, 2, 26, '#3a2a1e'); R(g, 29, 14, 2, 26, '#3a2a1e');
  for (let x = 0; x < 34; x++) { const col = (x >> 2) & 1 ? cols[0] : cols[1]; R(g, x, 6, 1, 9, col); R(g, x, 15, 1, ((x & 3) < 2) ? 3 : 2, col); }
  R(g, 0, 5, 34, 1, '#2a2622');
  R(g, 2, 26, 30, 6, '#5e4632'); R(g, 2, 26, 30, 1, '#7a5e44');
  const goods = ['#a8946a', '#7a8a4a', '#9a5a3a', '#8a8f99', '#b8a060'];
  for (let i = 0; i < 6; i++) { const gx = 4 + i * 4 + Math.floor(rnd() * 2); R(g, gx, 22 + Math.floor(rnd() * 3), 3, 4, goods[Math.floor(rnd() * goods.length)]); }
  R(g, 4, 32, 26, 7, '#4e3a28');
  const img = outlined(c, '#1b1816');
  return { img, ox: -2, oy: 32 - H - 1 };
}

/** Healers' house with a leaf sign. Footprint 5x3. */
export function makeHealers() {
  const W = 80, H = 84;
  const [c, g] = makeCanvas(W, H);
  R(g, 4, 34, 72, 48, '#b3aa96');
  for (let i = 0; i < 12; i++) R(g, 6 + (i * 29) % 66, 38 + (i * 11) % 38, 4, 2, '#9c937f');
  R(g, 4, 34, 3, 48, '#8a826f'); R(g, 73, 34, 3, 48, '#7a725f');
  R(g, 4, 80, 72, 2, '#2c2a27');
  gableRoof(g, 0, 80, 6, 36, 16, '#4a5a48', '#33402f');
  R(g, 33, 54, 14, 26, '#2a1f17'); R(g, 34, 55, 12, 25, '#4e5a3a');
  const win = [];
  for (const wx of [12, 56]) { R(g, wx, 48, 12, 12, '#1b1a1c'); R(g, wx + 1, 49, 10, 10, WP.glass); R(g, wx + 6, 49, 1, 10, '#1b1a1c'); win.push({ x: wx + 2, y: 50, w: 10, h: 10 }); }
  // cloth sign with leaf
  R(g, 30, 38, 20, 14, '#d9d2c0'); R(g, 30, 38, 20, 1, '#f0ead8');
  R(g, 39, 41, 2, 9, '#4f7a3a'); R(g, 36, 43, 3, 3, '#5f8a45'); R(g, 41, 42, 3, 3, '#5f8a45'); R(g, 37, 46, 3, 2, '#5f8a45'); R(g, 41, 46, 3, 2, '#5f8a45');
  // herb pots
  for (const px of [6, 64]) { R(g, px, 72, 10, 8, '#7a4a32'); R(g, px + 1, 66, 8, 6, '#4f7a3a'); R(g, px + 3, 64, 4, 3, '#6a9a4a'); }
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 48 - H - 1, windows: win };
}

/** Herald's hall / press: posted proclamations and a horn sign. Footprint 6x4. */
export function makeHeraldHall() {
  const W = 96, H = 96;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(5);
  stoneBlockWall(g, 3, 38, 90, 56, '#6e685e', rnd);
  gableRoof(g, 0, 96, 6, 40, 16, '#5a3a30', '#3e2620');
  R(g, 0, 39, 96, 2, '#3e2620');
  R(g, 38, 60, 20, 34, '#2a1f17'); R(g, 40, 62, 16, 32, '#4e3a28'); R(g, 37, 57, 22, 3, WP.stoneL);
  // proclamation board on the facade
  R(g, 6, 48, 28, 30, '#3a2a1e'); R(g, 8, 50, 24, 26, '#5e4632');
  for (let i = 0; i < 6; i++) { const px = 9 + (i % 3) * 8, py = 52 + Math.floor(i / 3) * 12; R(g, px, py, 6, 9, '#cfc4a8'); R(g, px + 1, py + 2, 4, 1, '#7a7060'); R(g, px + 1, py + 4, 3, 1, '#7a7060'); R(g, px + 2, py, 2, 1, '#8a3a2a'); }
  const win = [];
  for (const wx of [66, 80]) { R(g, wx, 50, 9, 14, '#1b1a1c'); R(g, wx + 1, 51, 7, 12, WP.glass); win.push({ x: wx + 2, y: 52, w: 7, h: 12 }); }
  // horn sign
  R(g, 44, 16, 10, 1, '#2a2622'); R(g, 40, 18, 16, 12, '#d9cfb8'); R(g, 42, 21, 9, 3, '#9a6a2a'); R(g, 50, 19, 4, 7, '#9a6a2a');
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 64 - H - 1, windows: win };
}

/** Tavern with a mug sign. Footprint 6x4. */
export function makeTavern() {
  const W = 96, H = 92;
  const [c, g] = makeCanvas(W, H);
  R(g, 3, 38, 90, 52, WP.plaster);
  for (let x = 3; x < 93; x += 15) R(g, x, 38, 3, 52, WP.woodD);
  R(g, 3, 60, 90, 3, WP.woodD);
  R(g, 3, 88, 90, 2, '#2c2a27');
  gableRoof(g, 0, 96, 8, 40, 14, '#5e4a38', '#3e3024');
  const win = [];
  for (const wx of [10, 26, 64, 78]) { R(g, wx, 66, 10, 10, '#1b1a1c'); R(g, wx + 1, 67, 8, 8, '#5a5040'); win.push({ x: wx + 2, y: 68, w: 8, h: 8 }); }
  R(g, 42, 64, 14, 24, '#2a1f17'); R(g, 43, 65, 12, 23, '#5a4230');
  R(g, 58, 44, 1, 10, '#2a2622'); R(g, 58, 44, 14, 1, '#2a2622'); R(g, 60, 46, 12, 10, '#d9cfb8'); R(g, 63, 48, 5, 6, '#9a6a2a'); R(g, 68, 49, 2, 3, '#9a6a2a'); R(g, 63, 48, 5, 1, '#f0ead8');
  R(g, 10, 82, 12, 6, '#5e4632'); R(g, 74, 82, 12, 6, '#5e4632'); // barrels
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 64 - H - 1, windows: win };
}

/** Temple of the Walls: pointed arch, round window with three nested rings. Footprint 7x5. */
export function makeTemple() {
  const W = 112, H = 140;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(11);
  // steps
  for (let i = 0; i < 3; i++) R(g, 10 + i * 4, 132 - i * 4, 92 - i * 8, 4, i & 1 ? '#8a8476' : '#958f80');
  stoneBlockWall(g, 8, 64, 96, 60, '#8c8678', rnd);
  // spire
  R(g, 44, 18, 24, 50, '#857f72'); for (let y = 20; y < 68; y += 5) R(g, 44, y, 24, 1, '#5e594f');
  for (let yy = 0; yy <= 20; yy++) { const w = Math.round(1 + yy * 0.65); R(g, 56 - w, yy, w * 2, 1, (yy % 3 === 2) ? WP.slateD : WP.slate); }
  // roof
  gableRoof(g, 2, 110, 46, 66, 22, WP.slate, WP.slateD);
  // round window: three nested rings
  ell(g, 56, 38, 9, 9, '#2a2a30'); ell(g, 56, 38, 8, 8, '#8a6a3a'); ell(g, 56, 38, 6, 6, '#3a4a5a'); ell(g, 56, 38, 4, 4, '#8a6a3a'); ell(g, 56, 38, 2, 2, '#c9a656');
  // pointed door
  R(g, 44, 92, 24, 32, '#1b1a1c');
  for (let yy = 0; yy < 12; yy++) { const w = Math.round(12 * Math.sqrt(yy / 12)); R(g, 56 - w, 80 + yy, w * 2, 1, '#1b1a1c'); }
  R(g, 47, 94, 18, 30, '#4e3a28'); R(g, 55, 94, 2, 30, '#2a1f17');
  const win = [];
  for (const wx of [18, 84]) {
    for (let yy = 0; yy < 6; yy++) { const w = Math.round(4 * Math.sqrt(yy / 6)); R(g, wx + 5 - w, 76 + yy, w * 2, 1, '#1b1a1c'); }
    R(g, wx + 1, 82, 8, 22, '#1b1a1c'); R(g, wx + 2, 83, 6, 20, '#4a4060');
    win.push({ x: wx + 3, y: 84, w: 6, h: 20 });
  }
  win.push({ x: 52, y: 35, w: 9, h: 9 });
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 80 - H - 1, windows: win };
}

/** Palace of the Council: big hall, central keep and two side towers. Footprint 12x6. */
export function makePalace() {
  const W = 192, H = 170;
  const [c, g] = makeCanvas(W, H);
  const rnd = mulberry32(23);
  const stone = '#a39b8a';
  // stairs
  for (let i = 0; i < 4; i++) R(g, 60 + i * 4, 160 - i * 4, 72 - i * 8, 4, i & 1 ? '#8a8476' : '#958f80');
  // main hall
  stoneBlockWall(g, 20, 86, 152, 64, stone, rnd);
  gableRoof(g, 14, 178, 60, 88, 18, WP.slate, WP.slateD);
  // keep
  stoneBlockWall(g, 72, 30, 48, 70, '#aaa290', null);
  for (let x = 70; x < 122; x += 8) { R(g, x, 22, 5, 8, '#aaa290'); R(g, x, 22, 5, 1, '#c4bca8'); }
  R(g, 70, 28, 52, 3, '#7a7464');
  for (let yy = 0; yy <= 22; yy++) { const w = Math.round(2 + yy * 1.0); R(g, 96 - w, yy, w * 2, 1, (yy % 3 === 2) ? WP.slateD : WP.slate); }
  // side towers
  for (const tx of [0, 160]) {
    stoneBlockWall(g, tx + 2, 56, 30, 94, '#9a927f', rnd);
    for (let yy = 0; yy <= 34; yy++) { const w = Math.round(2 + yy * 0.5); R(g, tx + 17 - w, 22 + yy, w * 2, 1, (yy % 3 === 2) ? WP.slateD : WP.slate); }
    R(g, tx + 16, 14, 2, 10, '#3a3026'); R(g, tx + 18, 14, 10, 6, WP.banner); R(g, tx + 21, 15, 4, 4, WP.bone);
  }
  // banners on hall
  for (const bx of [40, 140]) { R(g, bx, 96, 12, 30, WP.banner); R(g, bx, 96, 12, 2, WP.bannerL); R(g, bx + 2, 102, 8, 8, WP.bone); R(g, bx + 3, 103, 6, 6, WP.banner); R(g, bx + 4, 104, 4, 4, WP.bone); R(g, bx, 126, 5, 3, WP.banner); R(g, bx + 7, 126, 5, 3, WP.banner); }
  // grand door
  R(g, 82, 112, 28, 38, '#1b1a1c');
  for (let yy = 0; yy < 10; yy++) { const w = Math.round(14 * Math.sqrt(yy / 10)); R(g, 96 - w, 102 + yy, w * 2, 1, '#1b1a1c'); }
  R(g, 85, 114, 22, 36, '#5a2e2a'); R(g, 95, 114, 2, 36, '#3a1e1a'); R(g, 90, 130, 2, 2, '#c9a656'); R(g, 100, 130, 2, 2, '#c9a656');
  const win = [];
  for (const wx of [26, 60, 124, 156]) { R(g, wx, 104, 10, 18, '#1b1a1c'); R(g, wx + 1, 105, 8, 16, WP.glass); R(g, wx + 1, 105, 8, 3, WP.glassL); win.push({ x: wx + 2, y: 106, w: 8, h: 16 }); }
  for (const wx of [84, 102]) { R(g, wx, 48, 8, 14, '#1b1a1c'); R(g, wx + 1, 49, 6, 12, WP.glass); win.push({ x: wx + 2, y: 50, w: 6, h: 12 }); }
  for (const tx of [10, 170]) { R(g, tx, 80, 8, 14, '#1b1a1c'); R(g, tx + 1, 81, 6, 12, WP.glass); win.push({ x: tx + 2, y: 82, w: 6, h: 12 }); }
  const img = outlined(c, '#1b1816');
  return { img, ox: -1, oy: 96 - H - 1, windows: win };
}

/** Herald stone for the gate square — same posting geometry as the town noticeboard (papers drawn at x+5,y+12). */
export function makeHeraldStone() {
  const W = 34, H = 42;
  const [c, g] = makeCanvas(W, H);
  R(g, 3, 30, 28, 12, '#5d5952'); R(g, 3, 30, 28, 1, '#77726a'); R(g, 1, 38, 32, 4, '#4a4741');
  R(g, 1, 8, 32, 22, '#46433e'); R(g, 3, 10, 28, 18, '#6b5a44');
  for (let i = 0; i < 12; i++) R(g, 4 + (i * 7) % 26, 11 + (i * 5) % 16, 1, 1, '#5a4a36');
  R(g, 0, 2, 34, 6, WP.slate); R(g, 2, 0, 30, 3, WP.slateL); R(g, 0, 7, 34, 1, WP.slateD);
  const img = outlined(c, '#18171a');
  return { img, ox: -2, oy: 16 - H - 1 };
}
export function makeWell() {
  const W = 30, H = 34;
  const [c, g] = makeCanvas(W, H);
  ell(g, 15, 25, 13, 7, '#5d5952'); ell(g, 15, 24, 10, 5, '#1a2026'); R(g, 4, 24, 22, 6, '#5d5952');
  for (let x = 4; x < 26; x += 5) R(g, x, 25, 1, 5, WP.mortar);
  R(g, 3, 4, 2, 22, WP.woodD); R(g, 25, 4, 2, 22, WP.woodD); R(g, 1, 2, 28, 3, '#4a3f3a'); R(g, 14, 5, 1, 12, '#8a7a5a'); R(g, 12, 16, 5, 4, '#5e4632');
  const img = outlined(c, '#18171a');
  return { img, ox: 0, oy: 32 - H - 1 };
}
export function makeHaystack(seed) {
  const rnd = mulberry32(seed);
  const [c, g] = makeCanvas(20, 16);
  ell(g, 10, 10, 9, 6, WP.thatch); ell(g, 10, 8, 7, 5, '#a88b4a');
  for (let i = 0; i < 8; i++) R(g, 3 + Math.floor(rnd() * 14), 4 + Math.floor(rnd() * 10), 1, 2, WP.thatchD);
  return { img: outlined(c, '#1d1a17'), ox: -2, oy: 1 };
}
export function makeScarecrow() {
  const [c, g] = makeCanvas(16, 26);
  R(g, 7, 6, 2, 20, WP.woodD); R(g, 1, 10, 14, 2, WP.woodD); R(g, 4, 9, 8, 9, '#6a5a44'); R(g, 5, 2, 6, 6, '#a88b4a'); R(g, 3, 1, 10, 2, '#3a3026'); R(g, 6, 4, 1, 1, '#1a1816'); R(g, 9, 4, 1, 1, '#1a1816');
  return { img: outlined(c, '#1d1a17'), ox: 0, oy: -10 };
}
export function makeCart(seed) {
  const [c, g] = makeCanvas(28, 18);
  R(g, 2, 4, 22, 8, WP.wood); R(g, 2, 4, 22, 1, WP.woodL); R(g, 24, 8, 4, 2, WP.woodD);
  ell(g, 7, 13, 4, 4, '#3a2a1e'); ell(g, 7, 13, 2, 2, WP.woodL); ell(g, 19, 13, 4, 4, '#3a2a1e'); ell(g, 19, 13, 2, 2, WP.woodL);
  if (seed & 1) for (let i = 0; i < 4; i++) R(g, 4 + i * 5, 1, 4, 4, '#a8946a');
  return { img: outlined(c, '#1d1a17'), ox: 2, oy: 0 };
}
export function makeGardenBed(seed) {
  const rnd = mulberry32(seed);
  const [c, g] = makeCanvas(16, 12);
  R(g, 0, 4, 16, 8, '#5e5952'); R(g, 1, 5, 14, 6, '#3e3226');
  const cols = ['#8a5a7a', '#c9b06a', '#b9b2a0', '#7a4a6a'];
  for (let i = 0; i < 7; i++) { const fx = 1 + i * 2, col = cols[Math.floor(rnd() * cols.length)]; R(g, fx, 3, 1, 3, '#3f5530'); R(g, fx, 1 + (i & 1), 2, 2, col); }
  return { img: outlined(c, '#18171a'), ox: -1, oy: 3 };
}
export function makeHedge(seed) {
  const [c, g] = makeCanvas(16, 14);
  R(g, 0, 3, 16, 10, '#2f4528'); R(g, 1, 2, 14, 3, '#3f5a33'); R(g, 3, 4, 4, 2, '#557545'); R(g, 10, 5, 3, 2, '#557545');
  return { img: outlined(c, '#121812'), ox: -1, oy: 1 };
}

// ---------------------------------------------------------------- breach rubble decal (drawn over painted wall)
/** w tiles wide gap through a horizontal wall of thickness T_; dir = +1 when the outside is to the south. */
export function makeBreachDecal(wTiles, T_, dir, seed) {
  const rnd = mulberry32(seed);
  const W = (wTiles + 4) * TILE, H = (T_ + 5) * TILE;
  const [c, g] = makeCanvas(W, H);
  const gx0 = 2 * TILE, gy0 = 2 * TILE, gw = wTiles * TILE, gh = T_ * TILE;
  // ragged hole profile per row
  const prof = [];
  for (let y = gy0 - 6; y < gy0 + gh + 2; y++) {
    const k = (y - gy0) / gh;
    const narrow = Math.round(Math.abs(k - 0.45) * 10);
    prof.push([y, gx0 + 3 + narrow + Math.round(rnd() * 4), gx0 + gw - 3 - narrow - Math.round(rnd() * 4)]);
  }
  // exposed rubble core + broken-stone edge
  for (const [y, a, b] of prof) {
    R(g, a - 4, y, 4, 1, '#8f897e'); R(g, b, y, 4, 1, '#8f897e');
    R(g, a - 1, y, 1, 1, '#35322d'); R(g, b, y, 1, 1, '#35322d');
    R(g, a, y, b - a, 1, '#3e3a33');
  }
  // the gap floor: churned earth and stones
  for (let i = 0; i < 220; i++) {
    const [y, a, b] = prof[Math.floor(rnd() * prof.length)];
    if (b - a < 3) continue;
    const x = a + Math.floor(rnd() * (b - a - 2)), s = 1 + Math.floor(rnd() * 4);
    R(g, x, y, s, Math.max(1, s - 1), ['#5a4c3c', '#4c4034', '#6d665b', '#7d776c', '#585249'][Math.floor(rnd() * 5)]);
  }
  // big tumbled blocks spilling outward (a fan-shaped scree)
  for (let i = 0; i < 46; i++) {
    const sx = Math.round(gx0 + gw / 2 + (rnd() - 0.5) * (gw + 30) * (0.4 + rnd() * 0.6));
    const t = rnd();
    const sy = Math.round(dir > 0 ? gy0 + gh - 10 + t * (2.6 * TILE) : gy0 + 10 - t * (2.2 * TILE));
    const w = 3 + Math.floor(rnd() * 7), h = 2 + Math.floor(rnd() * 5);
    R(g, sx, sy + h, w, 1, 'rgba(0,0,0,0.35)');
    R(g, sx, sy, w, h, ['#77726a', '#68635b', '#857f75', '#5f5a52'][Math.floor(rnd() * 4)]);
    R(g, sx, sy, w, 1, '#a29c90'); R(g, sx + w - 1, sy + 1, 1, h - 1, '#4c4842');
    if (rnd() < 0.25) R(g, sx + 1, sy, Math.max(1, w - 2), 1, WP.moss);
  }
  // cracks running into the remaining wall
  g.fillStyle = '#211f1b';
  for (const side of [-1, 1]) for (let n = 0; n < 3; n++) {
    let x = side < 0 ? gx0 + 2 : gx0 + gw - 2, y = gy0 + 4 + Math.floor(rnd() * (gh - 8));
    for (let i = 0; i < 18 + Math.floor(rnd() * 12); i++) { x += side * (1 + Math.round(rnd())); y += Math.round(rnd() * 2 - 1); g.fillRect(x, y, 1, 1); }
  }
  return { img: c, ox: -2 * TILE, oy: -2 * TILE };
}

// ---------------------------------------------------------------- the Colossus (original design)
// A hunched walking hillside: a mossy hump with saplings growing out of it, craggy stone plates, bark-ridged
// club-like forearms that nearly drag on the ground, stumpy pillar legs, and a small head sunk below the
// shoulder masses with two ember eyes under a bark brow. Rendered per pixel from shaded ellipse "masses".
const colossusCache = new Map();
export const COLOSSUS_W = 120, COLOSSUS_H = 168, COLOSSUS_FRAMES = 4;
export function getColossus(frame, variant = 0, silhouette = false) {
  const key = frame + ':' + variant + ':' + (silhouette ? 1 : 0);
  if (colossusCache.has(key)) return colossusCache.get(key);
  const W = COLOSSUS_W, H = COLOSSUS_H;
  const [c, g] = makeCanvas(W, H);
  const img = g.createImageData(W, H), px = img.data;
  const mask = new Uint8Array(W * H); // 1 body, 2 limb, 3 head
  const rnd = mulberry32(9001 + variant * 31);
  const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const PAL = variant === 1
    ? { lo: '#3e3a33', mid: '#5f5a4e', hi: '#7c7666', top: '#958e7c' }
    : { lo: '#3c3a34', mid: '#625d52', hi: '#827b6c', top: '#9a9382' };
  const DARK = { lo: '#2c2a26', mid: '#45423b', hi: '#5a564c', top: '#6a655a' };
  const set = (x, y, col, m) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = (y * W + x) * 4; const [r, gg, b] = typeof col === 'string' ? hexRgb(col) : col;
    px[k] = r; px[k + 1] = gg; px[k + 2] = b; px[k + 3] = 255; if (m) mask[y * W + x] = m;
  };
  const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : mask[y * W + x];
  // shaded rock mass
  const mass = (cx, cy, rx, ry, pal, m, rough = 0.18) => {
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      const edge = 1 + (hash2(x >> 2, y >> 2, 7 + variant) - 0.5) * rough * 2;
      const d = nx * nx + ny * ny;
      if (d > edge) continue;
      const l = -0.55 * nx - 0.75 * ny + (hash2(x >> 1, y >> 1, 3) - 0.5) * 0.5;
      const col = l > 0.62 ? pal.top : l > 0.12 ? pal.hi : l > -0.45 ? pal.mid : pal.lo;
      set(x, y, col, m);
    }
  };
  const ph = frame / COLOSSUS_FRAMES * Math.PI * 2;
  const bob = Math.round(Math.abs(Math.sin(ph)) * 3);
  const swing = Math.sin(ph);
  const G = H - 4; // ground line
  // ---- legs (stumpy stacked pillars)
  const leg = (x0, lift, fwd, pal) => {
    const top = 112 + bob, bot = G - Math.max(0, lift);
    for (let y = top; y <= bot; y += 5) mass(x0 + fwd, y, 11 - (y > bot - 6 ? -3 : 0), 5, pal, 2, 0.25);
    mass(x0 + fwd, bot - 1, 15, 4, pal, 2, 0.1);
  };
  leg(46, Math.round(Math.max(0, swing) * 6), Math.round(swing * 3), DARK);
  leg(76, Math.round(Math.max(0, -swing) * 6), Math.round(-swing * 3), PAL);
  // ---- back arm (left, darker)
  const arm = (sx, dir, sw, pal) => {
    const fistY = 144 + Math.round(sw * 4) + bob, fx = sx + dir * 8 + Math.round(sw * 3);
    for (let k = 0; k <= 10; k++) { const t = k / 10; mass(sx + (fx - sx) * t * 0.6, 66 + bob + (fistY - 70 - bob) * t * 0.55, 10 + t * 2, 8, pal, 2, 0.2); }
    for (let k = 0; k <= 8; k++) { const t = k / 8; mass(sx + (fx - sx) * (0.6 + 0.4 * t), 66 + bob + (fistY - 70 - bob) * (0.55 + 0.45 * t), 13 + t * 2, 9, pal, 2, 0.2); }
    mass(fx, fistY, 15, 11, pal, 2, 0.3);
    // bark ridges along the forearm
    for (let r = -2; r <= 2; r++) for (let y = 96 + bob; y < fistY - 8; y++) if (hash2(r, y >> 2, 5) < 0.8) { const x = Math.round(sx + (fx - sx) * ((y - 66) / (fistY - 66)) + r * 4); if (get(x, y) === 2) set(x, y, r & 1 ? '#5a4632' : '#47372a'); }
    // dangling roots/vines
    for (let v = 0; v < 4; v++) { const vx = fx - 10 + v * 6 + Math.round(rnd() * 3), vy = fistY + 6; for (let i = 0; i < 4 + Math.floor(rnd() * 7); i++) set(vx + (i % 3 === 2 ? 1 : 0), vy + i, i < 3 ? '#4a3a28' : '#3a5a2e', 2); }
  };
  arm(22, -1, -swing, DARK);
  // ---- body: hump + torso + shoulder masses
  mass(60, 52 + bob, 40, 30, PAL, 1, 0.22);    // hump
  mass(60, 88 + bob, 40, 30, PAL, 1, 0.2);     // torso
  mass(28, 64 + bob, 20, 18, PAL, 1, 0.25);    // left shoulder
  mass(92, 64 + bob, 20, 18, PAL, 1, 0.25);    // right shoulder
  // plate seams / cracks on the body
  for (let i = 0; i < 16; i++) {
    let x = 26 + Math.floor(rnd() * 68), y = 32 + bob + Math.floor(rnd() * 80);
    const dx = rnd() < 0.5 ? 1 : -1;
    for (let j = 0; j < 6 + Math.floor(rnd() * 10); j++) { if (get(x, y) === 1) set(x, y, '#2e2c27'); x += rnd() < 0.6 ? dx : 0; y += rnd() < 0.5 ? 1 : 0; }
  }
  // bark ridges down the belly
  for (let r = 0; r < 5; r++) for (let y = 96 + bob; y < 116 + bob; y++) { const x = 46 + r * 7 + (y % 6 < 3 ? 0 : 1); if (get(x, y) === 1) { set(x, y, '#54402e'); set(x + 1, y, '#6e5640'); } }
  // ---- front arm (right)
  arm(98, 1, swing, PAL);
  // ---- head sunk between the shoulders: dark socket, bark brow, ember eyes, slab jaw
  const hx = 60, hy = 70 + bob;
  mass(hx, hy, 13, 11, { lo: '#2a2824', mid: '#3c3933', hi: '#4e4a42', top: '#5e594f' }, 3, 0.15);
  for (let x = hx - 13; x <= hx + 13; x++) for (let y = hy - 9; y <= hy - 6; y++) set(x, y + (Math.abs(x - hx) > 9 ? 1 : 0), y === hy - 9 ? '#6e5640' : '#54402e', 3);
  for (let x = hx - 9; x <= hx + 9; x++) for (let y = hy - 5; y <= hy - 1; y++) set(x, y, '#141311', 3);
  for (let x = hx - 10; x <= hx + 10; x++) for (let y = hy + 4; y <= hy + 9; y++) if (Math.abs(x - hx) < 10 - (y - hy - 4)) set(x, y, y === hy + 4 ? '#6a655a' : '#4a463e', 3);
  for (let x = hx - 6; x <= hx + 6; x += 3) set(x, hy + 5, '#1c1a17', 3);
  const eyes = [[hx - 6, hy - 4], [hx + 3, hy - 4]];
  for (const [ex, ey] of eyes) { for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) set(ex + x, ey + y, '#ffb43a', 3); set(ex + 1, ey + 1, '#fff2b0', 3); set(ex + 2, ey + 1, '#ffe08a', 3); }
  // ---- moss mantle: on every column, the top few pixels of the body/shoulders
  for (let x = 0; x < W; x++) {
    let y0 = -1;
    for (let y = 0; y < H; y++) if (mask[y * W + x] === 1 || mask[y * W + x] === 2) { y0 = y; break; }
    if (y0 < 0 || y0 > 96 + bob) continue;
    const depth = 3 + Math.floor(hash2(x >> 1, 1, 77) * 7);
    for (let y = y0; y < y0 + depth; y++) { const m = mask[y * W + x]; if (m === 1 || m === 2) set(x, y, hash2(x, y, 9) < 0.35 ? '#6a8a48' : hash2(x, y, 11) < 0.5 ? '#4e6a36' : '#3e5530'); }
    if (hash2(x, 3, 13) < 0.22) { const L = 3 + Math.floor(hash2(x, 4, 13) * 8); for (let y = y0 + depth; y < y0 + depth + L; y++) if (mask[y * W + x] === 1) set(x, y, '#3e5530'); }
  }
  // ---- saplings & a dead branch growing out of the hump
  const pine = (bx, by, h) => {
    for (let i = 0; i < 3; i++) set(bx, by - i, '#3a2c20');
    for (let t = 0; t < h; t++) { const w = Math.round((h - t) * 0.45); for (let x = -w; x <= w; x++) set(bx + x, by - 2 - t, t % 3 === 0 ? '#2f4a3a' : (x < 0 ? '#24392f' : '#3d5c47')); }
  };
  const topAt = x => { for (let y = 0; y < H; y++) if (mask[y * W + x]) return y; return 60; };
  pine(46, topAt(46) + 2, 13); pine(64, topAt(64) + 2, 17); pine(78, topAt(78) + 3, 10);
  { let x = 34, y = topAt(34) + 3; for (let i = 0; i < 12; i++) { set(x, y, '#3a2c20'); x -= i % 2; y -= 1; } set(x - 1, y, '#3a2c20'); set(x - 2, y - 1, '#3a2c20'); }
  g.putImageData(img, 0, 0);
  let out = outlined(c, '#14120e');
  if (silhouette) {
    const [s2, sg] = makeCanvas(out.width, out.height);
    sg.drawImage(out, 0, 0);
    sg.globalCompositeOperation = 'source-atop'; sg.fillStyle = 'rgba(30,33,41,0.9)'; sg.fillRect(0, 0, s2.width, s2.height);
    sg.globalCompositeOperation = 'source-over';
    for (const [ex, ey] of eyes) { sg.fillStyle = '#ffb43a'; sg.fillRect(ex + 1, ey + 1, 4, 3); sg.fillStyle = '#fff2b0'; sg.fillRect(ex + 2, ey + 2, 2, 1); }
    out = s2;
  }
  const res = { img: out, eyes: eyes.map(([ex, ey]) => ({ x: ex + 3, y: ey + 2 })), footY: G + 1 };
  colossusCache.set(key, res);
  return res;
}

// ---------------------------------------------------------------- herald NPC (decree)
export function makeHerald() {
  const [c, g] = makeCanvas(14, 24);
  R(g, 4, 9, 6, 9, '#4a2e4a'); R(g, 3, 10, 8, 6, '#4a2e4a'); R(g, 4, 16, 6, 2, '#3a223a');
  R(g, 4, 18, 2, 4, '#2a2228'); R(g, 8, 18, 2, 4, '#2a2228');
  R(g, 4, 2, 6, 6, '#e0b890'); R(g, 3, 1, 8, 2, '#2f5d5a'); R(g, 6, 0, 2, 1, '#c9a656');
  R(g, 5, 4, 1, 1, '#1a1816'); R(g, 8, 4, 1, 1, '#1a1816');
  // raised scroll
  R(g, 10, 3, 2, 8, '#e0b890'); R(g, 9, 0, 5, 4, '#d9cfb8'); R(g, 9, 0, 5, 1, '#8a3a2a');
  return outlined(c, '#18171a');
}
