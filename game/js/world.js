// Swarm Town — world.js : town generation from data (island, roads, core buildings, districts), A* pathfinding.
import {
  TILE, T, hashStr, hash2, mulberry32, makeCanvas, paintTile, makeTree, makeBush, makeRock, makeLamp, makeBench,
  makeTable, makeSignpost, makeFlowerBed, makeHouse, makeForum, makeLibrary, makeCafe, makeNoticeboard, makeFountain,
  ROOF_COLORS,
} from './sprites.js';
import { buildWalledCity } from './walls_world.js';

const CW = 22, CH = 18;            // macro cell size (tiles) incl. 2-tile road on top/left
const HALF = 6;
const COST = new Float32Array(16);
COST[T.ROAD] = 1; COST[T.PATH] = 1; COST[T.PLAZA] = 1; COST[T.DOCK] = 1.1;
COST[T.GRASS] = 1.9; COST[T.PARK] = 1.6; COST[T.SAND] = 2.3; COST[T.FIELD] = 3.2;

function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
}

export function buildWorld(data) {
  if (data && data.meta && data.meta.map === 'three_walls') return buildWalledCity(data, { createPathfinder, valueNoise });
  const agents = data.agents || [];
  const seed = hashStr((data.meta && data.meta.simulation_id) || 'swarm-town');
  // ---------- districts from agent types
  const byType = new Map();
  for (const a of agents) { const t = a.type || 'Townsfolk'; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(a.id); }
  const types = [...byType.keys()].sort((a, b) => byType.get(b).length - byType.get(a).length || a.localeCompare(b));
  const typeColor = new Map(types.map((t, i) => [t, ROOF_COLORS[i % ROOF_COLORS.length]]));
  // half-blocks of 6 houses (2 cols x 3 rows); two halves share one macro cell
  const halves = [];
  for (const t of types) { const ids = byType.get(t); for (let i = 0; i < ids.length; i += HALF) halves.push({ type: t, ids: ids.slice(i, i + HALF) }); }
  const blocks = [];
  for (let i = 0; i < halves.length; i += 2) blocks.push([halves[i], halves[i + 1] || null]);
  let r = 1; while ((2 + 2 * r) ** 2 - 4 < blocks.length + 2) r++;
  const MG = 2 + 2 * r, margin = 14;
  const townW = MG * CW + 2, townH = MG * CH + 2;
  const W = townW + margin * 2, H = townH + margin * 2;
  const ox = margin, oy = margin;
  const N = W * H;
  const tiles = new Uint8Array(N), blocked = new Uint8Array(N), deco = new Uint8Array(N), wild = new Uint8Array(N), noTree = new Uint8Array(N);
  const I = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const setT = (x, y, t) => { if (inb(x, y)) tiles[I(x, y)] = t; };
  const getT = (x, y) => inb(x, y) ? tiles[I(x, y)] : T.DEEP;

  // ---------- island
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = Math.max(ox - x, 0, x - (ox + townW - 1)), dy = Math.max(oy - y, 0, y - (oy + townH - 1));
    const d = Math.hypot(dx, dy);
    if (d === 0) { tiles[I(x, y)] = T.GRASS; continue; }
    const n = valueNoise(x * 0.11, y * 0.11, seed) * 0.75 + valueNoise(x * 0.3, y * 0.3, seed + 7) * 0.25;
    const land = 1.5 + n * 7.5;
    let t;
    if (d <= land) { t = T.GRASS; wild[I(x, y)] = 1; }
    else if (d <= land + 2.2) t = T.SAND;
    else if (d <= land + 6) t = T.WATER;
    else t = T.DEEP;
    tiles[I(x, y)] = t;
  }

  // ---------- roads
  const coreX0 = ox + r * CW + 2, coreY0 = oy + r * CH + 2, coreX1 = ox + (r + 2) * CW - 1, coreY1 = oy + (r + 2) * CH - 1;
  for (let k = 0; k <= MG; k++) {
    for (let x = ox; x < ox + townW; x++) for (const yy of [oy + k * CH, oy + k * CH + 1]) {
      if (k === r + 1 && x >= coreX0 && x <= coreX1) continue;
      setT(x, yy, T.ROAD);
    }
    for (let y = oy; y < oy + townH; y++) for (const xx of [ox + k * CW, ox + k * CW + 1]) {
      if (k === r + 1 && y >= coreY0 && y <= coreY1) continue;
      setT(xx, y, T.ROAD);
    }
  }

  const objects = [];
  const lamps = [];
  const labels = [];
  const addObj = (spr, tx, ty, fw, fh, kind, extra = {}) => {
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) if (inb(x, y)) blocked[I(x, y)] = 1;
    const o = { img: spr.img, x: tx * TILE + spr.ox, y: ty * TILE + spr.oy, baseY: (ty + fh) * TILE, kind, tx, ty, fw, fh, ...extra };
    objects.push(o);
    if (spr.light) lamps.push({ x: o.x + spr.light.dx, y: o.y + spr.light.dy, r: 1 });
    return o;
  };
  const canTree = (x, y) => inb(x, y) && (getT(x, y) === T.GRASS || getT(x, y) === T.PARK) && !blocked[I(x, y)] && !noTree[I(x, y)];
  const rndW = mulberry32(seed ^ 0x9e3779b9);
  const treeKinds = ['oak', 'oak', 'round', 'pine', 'fruit', 'cherry', 'autumn', 'oak', 'round'];
  const placeTree = (x, y, kind) => {
    if (!canTree(x, y)) return false;
    kind = kind || treeKinds[Math.floor(hash2(x, y, seed + 3) * treeKinds.length)];
    addObj(makeTree(kind, hashStr('t' + x + ',' + y)), x, y, 1, 1, 'tree');
    return true;
  };
  const C = (x, y) => [coreX0 + x, coreY0 + y];
  const setC = (x, y, t) => setT(coreX0 + x, coreY0 + y, t);
  const fillC = (x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setC(x, y, t); };

  // ================= CORE (42 x 34)
  fillC(6, 24, 35, 33, T.PARK);
  fillC(12, 10, 29, 21, T.PLAZA);           // plaza
  fillC(14, 8, 27, 9, T.PLAZA);             // forum court
  fillC(2, 14, 9, 15, T.PLAZA);             // library front
  fillC(31, 14, 40, 15, T.PLAZA);           // cafe patio
  for (let y = 0; y <= 9; y++) { setC(13, y, T.PATH); setC(28, y, T.PATH); }
  for (let x = 0; x <= 11; x++) setC(x, 16, T.PATH);
  for (let x = 30; x <= 41; x++) setC(x, 16, T.PATH);
  for (let y = 22; y <= 25; y++) { setC(20, y, T.PATH); setC(21, y, T.PATH); }
  for (let y = 32; y <= 33; y++) { setC(20, y, T.PATH); setC(21, y, T.PATH); }
  for (let x = 12; x <= 29; x++) { setC(x, 25, T.PATH); setC(x, 32, T.PATH); }
  for (let y = 25; y <= 32; y++) { setC(12, y, T.PATH); setC(29, y, T.PATH); }
  for (let y = 26; y <= 31; y++) for (let x = 13; x <= 28; x++) {
    const ex = (x + 0.5 - 21) / 6.2, ey = (y + 0.5 - 28.8) / 2.7;
    if (ex * ex + ey * ey <= 1) setC(x, y, T.WATER);
  }
  // keep walkways clear of trees
  for (let y = 0; y < 34; y++) for (let x = 0; x < 42; x++) {
    const [ax, ay] = C(x, y); const t = getT(ax, ay);
    if (t !== T.GRASS && t !== T.PARK) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = getT(ax + dx, ay + dy); if (n === T.PATH || n === T.PLAZA || n === T.ROAD) noTree[I(ax, ay)] = 1; }
  }
  const forum = addObj(makeForum(), ...C(16, 3), 10, 5, 'building', { name: 'Forum Hall' });
  const board = addObj(makeNoticeboard(), ...C(20, 11), 2, 1, 'board');
  const fountain = addObj(makeFountain(), ...C(19, 15), 4, 3, 'fountain');
  const library = addObj(makeLibrary(), ...C(2, 9), 8, 5, 'building', { name: 'Library' });
  const cafe = addObj(makeCafe(), ...C(32, 10), 7, 4, 'building', { name: 'Cafe' });
  for (const s of [library, cafe, forum]) s.windows = (s.kind === 'building' ? ({ 'Forum Hall': makeForumWin, Library: makeLibWin, Cafe: makeCafeWin })[s.name](s) : []);
  addObj(makeTable(), ...C(32, 14), 1, 1, 'table');
  addObj(makeTable(), ...C(39, 14), 1, 1, 'table');
  for (const [x, y] of [[11, 10], [30, 10], [11, 21], [30, 21], [19, 24], [22, 24], [41, 15], [0, 15], [12, 7], [29, 7]]) addObj(makeLamp(), ...C(x, y), 1, 1, 'lamp');
  for (const [x, y] of [[14, 13], [26, 13], [14, 19], [26, 19], [15, 24], [25, 24], [16, 33], [24, 33]]) addObj(makeBench(), ...C(x, y), 2, 1, 'bench');
  for (const [x, y] of [[12, 10], [29, 10], [12, 21], [29, 21], [3, 14], [8, 14]]) addObj(makeFlowerBed(hashStr('fb' + x + y)), ...C(x, y), 1, 1, 'flowers');
  // park + core greenery
  for (let y = 0; y < 34; y++) for (let x = 0; x < 42; x++) {
    const [ax, ay] = C(x, y); const t = getT(ax, ay);
    if (t !== T.GRASS && t !== T.PARK) continue;
    const h = hash2(ax, ay, seed + 11);
    const inPark = t === T.PARK;
    const edgePark = inPark && (x <= 9 || x >= 32 || y >= 33 - 0);
    if (edgePark && h < 0.5) placeTree(ax, ay, h < 0.2 ? 'cherry' : h < 0.35 ? 'round' : 'oak');
    else if (inPark && h < 0.07) placeTree(ax, ay, 'cherry');
    else if (!inPark && h < 0.14) placeTree(ax, ay);
    else if (h < 0.24) deco[I(ax, ay)] = 1;
  }
  labels.push({ key: 'place.forum', text: 'Forum Hall', x: forum.x + forum.img.width / 2, y: forum.y + 2, kind: 'building' });
  labels.push({ key: 'place.library', text: 'Library', x: library.x + library.img.width / 2, y: library.y + 4, kind: 'building' });
  labels.push({ key: 'place.cafe', text: 'Cafe', x: cafe.x + cafe.img.width / 2, y: cafe.y + 2, kind: 'building' });
  labels.push({ key: 'place.plaza', text: 'Plaza', x: (coreX0 + 21) * TILE, y: (coreY0 + 21.6) * TILE, kind: 'place' });
  labels.push({ key: 'place.park', text: 'Park', x: (coreX0 + 21) * TILE, y: (coreY0 + 27.2) * TILE, kind: 'place' });

  // ================= DISTRICT BLOCKS & NATURE CELLS
  const cells = [];
  const cmid = MG / 2;
  for (let cy = 0; cy < MG; cy++) for (let cx = 0; cx < MG; cx++) {
    if ((cx === r || cx === r + 1) && (cy === r || cy === r + 1)) continue;
    const dx = cx + 0.5 - cmid, dy = cy + 0.5 - cmid;
    const ring = Math.max(Math.abs(dx), Math.abs(dy));
    let ang = Math.atan2(dx, -dy); if (ang < 0) ang += Math.PI * 2;
    cells.push({ cx, cy, ring, ang });
  }
  cells.sort((a, b) => a.ring - b.ring || a.ang - b.ang);
  const homes = new Map();
  const districts = new Map();
  cells.forEach((cell, ci) => {
    const x0 = ox + cell.cx * CW, y0 = oy + cell.cy * CH, ix = x0 + 2, iy = y0 + 2;
    const blk = blocks[ci];
    if (blk) {
      for (let x = ix; x <= ix + 19; x++) for (let rr = 0; rr < 3; rr++) setT(x, iy + 5 + rr * 5, T.PATH);
      addObj(makeLamp(), ix + 19, iy, 1, 1, 'lamp');
      blk.forEach((half, hi) => {
        const hx0 = ix + hi * 10;
        if (!half) {
          // spare half: small green with trees
          for (let y = iy + 1; y <= iy + 14; y++) for (let x = hx0; x <= hx0 + 9; x++) {
            if (getT(x, y) !== T.GRASS) continue;
            const h = hash2(x, y, seed + 17);
            if (h < 0.12) placeTree(x, y); else if (h < 0.3) deco[I(x, y)] = h < 0.22 ? 1 : 2;
          }
          return;
        }
        const color = typeColor.get(half.type);
        if (!districts.has(half.type)) districts.set(half.type, { type: half.type, color, count: 0, signs: [] });
        const dist = districts.get(half.type);
        dist.count += half.ids.length;
        const sign = addObj(makeSignpost(color), hx0, iy, 1, 1, 'sign');
        dist.signs.push({ x: sign.x + 9, y: sign.y });
        labels.push({ text: half.type, x: sign.x + 9, y: sign.y - 1, kind: 'district', color });
        for (let k = 0; k < HALF; k++) {
          const c = k % 2, rr = Math.floor(k / 2);
          const hx = hx0 + c * 5, hy = iy + 1 + rr * 5;
          const id = half.ids[k];
          noTree[I(hx + 2, hy + 3)] = 1; noTree[I(hx + 1, hy + 3)] = 1; noTree[I(hx + 3, hy + 3)] = 1;
          if (id !== undefined) {
            setT(hx + 2, hy + 3, T.PATH);
            const hs = makeHouse(color, hashStr('house' + id));
            const house = addObj(hs, hx + 1, hy + 1, 3, 2, 'house', { owner: id });
            house.windows = hs.windows.map(w => ({ x: house.x + w.x, y: house.y + w.y, w: w.w, h: w.h }));
            house.chimney = { x: house.x + hs.chimney.x + 1, y: house.y + hs.chimney.y + 1 };
            homes.set(id, { door: { x: hx + 2, y: hy + 3 }, house, type: half.type, color });
            const h = hash2(hx, hy, seed);
            if (h < 0.35) addObj(makeBush(hashStr('b' + hx + hy)), hx + 1, hy + 3, 1, 1, 'bush');
            else if (h < 0.6) deco[I(hx + 1, hy + 3)] = 1;
            if (hash2(hy, hx, seed) < 0.4) deco[I(hx + 3, hy + 3)] = 1;
          } else {
            const h = hash2(hx, hy, seed + 5);
            if (h < 0.45) { placeTree(hx + 2, hy + 1); placeTree(hx + 1, hy + 2, 'round'); deco[I(hx + 3, hy + 2)] = 1; }
            else if (h < 0.75) { addObj(makeFlowerBed(hashStr('g' + hx + hy)), hx + 1, hy + 2, 1, 1, 'flowers'); addObj(makeFlowerBed(hashStr('h' + hx + hy)), hx + 3, hy + 2, 1, 1, 'flowers'); deco[I(hx + 2, hy + 1)] = 1; }
            else { addObj(makeBench(), hx + 1, hy + 2, 2, 1, 'bench'); placeTree(hx + 3, hy + 1, 'fruit'); deco[I(hx + 1, hy + 1)] = 2; }
          }
          if (hash2(hx, hy, seed + 9) < 0.3) placeTree(hx + 4, hy + 1, 'round');
        }
      });
    } else {
      // nature cell
      const kinds = ['forest', 'meadow', 'farm', 'pond', 'orchard', 'forest'];
      const kind = kinds[Math.floor(hash2(cell.cx, cell.cy, seed + 21) * kinds.length)];
      const ix1 = x0 + CW - 1, iy1 = y0 + CH - 1;
      if (kind === 'farm') {
        for (let y = iy + 1; y <= iy1 - 1; y++) for (let x = ix + 1; x <= ix1 - 1; x++) setT(x, y, (y === iy + 8) ? T.PATH : T.FIELD);
        for (let x = ix; x <= ix1; x++) { placeTree(x, iy, hash2(x, iy, 1) < 0.5 ? 'fruit' : 'oak'); }
      } else if (kind === 'pond') {
        const cxp = (ix + ix1) / 2 + 0.5, cyp = (iy + iy1) / 2 + 0.5;
        for (let y = iy; y <= iy1; y++) for (let x = ix; x <= ix1; x++) {
          const e = ((x + 0.5 - cxp) / 7) ** 2 + ((y + 0.5 - cyp) / 5) ** 2;
          if (e <= 1) setT(x, y, T.WATER); else if (e <= 1.35) setT(x, y, T.SAND);
        }
        for (let y = iy; y <= iy1; y++) for (let x = ix; x <= ix1; x++) { const h = hash2(x, y, seed + 2); if (h < 0.18) placeTree(x, y); else if (h < 0.3) deco[I(x, y)] = 1; }
      } else if (kind === 'orchard') {
        for (let y = iy + 1; y <= iy1; y += 3) for (let x = ix + 1; x <= ix1; x += 3) placeTree(x, y, hash2(x, y, 4) < 0.6 ? 'fruit' : 'cherry');
        for (let y = iy; y <= iy1; y++) for (let x = ix; x <= ix1; x++) if (hash2(x, y, 6) < 0.1) deco[I(x, y)] = 1;
      } else if (kind === 'meadow') {
        for (let y = iy; y <= iy1; y++) for (let x = ix; x <= ix1; x++) {
          const h = hash2(x, y, seed + 8);
          if (h < 0.05) placeTree(x, y); else if (h < 0.07) { if (canTree(x, y)) addObj(makeRock(hashStr('r' + x + y)), x, y, 1, 1, 'rock'); }
          else if (h < 0.32) deco[I(x, y)] = 1; else if (h < 0.42) deco[I(x, y)] = 2;
        }
      } else { // forest
        for (let y = iy; y <= iy1; y++) for (let x = ix; x <= ix1; x++) {
          const h = hash2(x, y, seed + 13), n = valueNoise(x * 0.3, y * 0.3, seed + 1);
          if (h < 0.25 + n * 0.45) placeTree(x, y, n > 0.55 ? 'pine' : undefined);
          else if (h > 0.93) deco[I(x, y)] = 2;
        }
      }
    }
  });
  // road intersection lamps
  for (let ky = 0; ky <= MG; ky += 2) for (let kx = 0; kx <= MG; kx += 2) {
    const x = ox + kx * CW + 2, y = oy + ky * CH + 2;
    if (inb(x, y) && getT(x, y) === T.GRASS && !blocked[I(x, y)] && x < ox + townW && y < oy + townH) addObj(makeLamp(), x, y, 1, 1, 'lamp');
  }

  // ---------- dock on the south coast
  {
    const dx = ox + Math.floor(townW / 2) - 1;
    let y = oy + townH;
    while (y < H - 1 && getT(dx, y) !== T.WATER) y++;
    if (y < H - 6) {
      for (let k = -1; k < 6; k++) { setT(dx, y + k, T.DOCK); setT(dx + 1, y + k, T.DOCK); }
      for (let yy = oy + townH; yy < y; yy++) { if (getT(dx, yy) === T.GRASS || getT(dx, yy) === T.SAND) { setT(dx, yy, T.PATH); setT(dx + 1, yy, T.PATH); noTree[I(dx, yy)] = noTree[I(dx + 1, yy)] = 1; } }
      labels.push({ key: 'place.pier', text: 'Pier', x: (dx + 1) * TILE, y: (y + 6.5) * TILE, kind: 'place' });
    }
  }

  // ---------- wild band: trees, flowers, beach rocks
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y), t = tiles[i];
    if (t === T.GRASS && wild[i]) {
      const h = hash2(x, y, seed + 31), n = valueNoise(x * 0.25, y * 0.25, seed + 5);
      if (h < 0.18 + n * 0.5) placeTree(x, y, n > 0.6 ? 'pine' : undefined);
      else if (h > 0.9) deco[i] = 1; else if (h > 0.84) deco[i] = 2;
    } else if (t === T.SAND && hash2(x, y, seed + 41) < 0.015 && !blocked[i]) {
      addObj(makeRock(hashStr('sr' + x + y)), x, y, 1, 1, 'rock');
    } else if (t === T.GRASS && !wild[i] && !blocked[i] && !deco[i] && hash2(x, y, seed + 51) < 0.05) deco[i] = hash2(x, y, 3) < 0.6 ? 1 : 2;
  }

  // ---------- walkability & reachability
  const walk = new Uint8Array(N);
  const cost = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    walk[i] = (t !== T.WATER && t !== T.DEEP && !blocked[i]) ? 1 : 0;
    cost[i] = COST[t] || 2;
  }
  const plazaCenter = { x: coreX0 + 21, y: coreY0 + 13 };
  const reach = new Uint8Array(N);
  {
    const q = new Int32Array(N); let qh = 0, qt = 0;
    const s = I(plazaCenter.x, plazaCenter.y); reach[s] = 1; q[qt++] = s;
    while (qh < qt) {
      const c = q[qh++], cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy; if (!inb(nx, ny)) continue;
        const ni = I(nx, ny); if (!walk[ni] || reach[ni]) continue;
        reach[ni] = 1; q[qt++] = ni;
      }
    }
    for (let i = 0; i < N; i++) if (!reach[i]) walk[i] = 0; // islands of grass enclosed by trees become unwalkable
  }

  // ---------- places
  const collect = (x0, y0, x1, y1, pred) => {
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const [ax, ay] = C(x, y); if (inb(ax, ay) && walk[I(ax, ay)] && (!pred || pred(ax, ay))) out.push({ x: ax, y: ay }); }
    return out;
  };
  const places = {
    plaza: { name: 'Plaza', spots: collect(12, 10, 29, 21), boardSpots: collect(17, 12, 24, 14), center: { x: (coreX0 + 21) * TILE, y: (coreY0 + 16) * TILE } },
    forum: { name: 'Forum Hall', spots: collect(14, 8, 27, 9) },
    cafe: { name: 'Cafe', spots: collect(30, 14, 41, 17) },
    library: { name: 'Library', spots: collect(1, 14, 10, 17) },
    park: { name: 'Park', spots: collect(6, 24, 35, 33, (x, y) => getT(x, y) === T.PARK || getT(x, y) === T.PATH) },
  };
  for (const p of Object.values(places)) if (!p.spots.length) p.spots = [{ ...plazaCenter }];
  places.forum.board = { x: forum.x + forum.img.width / 2, y: forum.y + 60 };
  places.plaza.board = board;

  // ---------- ground canvas
  const [ground, gg] = makeCanvas(W * TILE, H * TILE);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintTile(gg, tiles, W, H, x, y, deco[I(x, y)]);
  // soft shadows under buildings
  gg.fillStyle = 'rgba(30,40,20,0.18)';
  for (const o of objects) if (o.kind === 'building' || o.kind === 'house') gg.fillRect(o.tx * TILE - 2, (o.ty + o.fh) * TILE - 3, o.fw * TILE + 6, 5);

  objects.sort((a, b) => a.baseY - b.baseY);
  const waterTiles = [];
  for (let i = 0; i < N; i++) if (tiles[i] === T.WATER && hash2(i % W, (i / W) | 0, 77) < 0.12) waterTiles.push(i);

  const find = createPathfinder(W, H, walk, cost);
  const world = {
    W, H, tiles, walk, cost, ground, objects, lamps, labels, places, homes, districts: [...districts.values()], types, typeColor,
    fountain, board, forum, library, cafe, waterTiles, core: { x0: coreX0, y0: coreY0, x1: coreX1, y1: coreY1 },
    pxW: W * TILE, pxH: H * TILE,
    isWalkable: (x, y) => inb(x, y) && walk[I(x, y)] === 1,
    findPath: (sx, sy, tx, ty, maxExpand) => find(sx, sy, tx, ty, maxExpand),
    nearestWalkable(x, y, maxR = 12) {
      x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y)));
      if (walk[I(x, y)]) return { x, y };
      for (let rr = 1; rr <= maxR; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
        const nx = x + dx, ny = y + dy; if (inb(nx, ny) && walk[I(nx, ny)]) return { x: nx, y: ny };
      }
      return { ...plazaCenter };
    },
    randomSpotNear(x, y, rad, rnd) {
      for (let k = 0; k < 16; k++) {
        const nx = Math.round(x + (rnd() * 2 - 1) * rad), ny = Math.round(y + (rnd() * 2 - 1) * rad);
        if (inb(nx, ny) && walk[I(nx, ny)]) return { x: nx, y: ny };
      }
      return this.nearestWalkable(x, y);
    },
    plazaCenter,
  };
  return world;
}

function makeForumWin(o) { return [{ x: o.x + 72, y: o.y + 68, w: 18, h: 34 }]; }
function makeLibWin(o) { return [{ x: o.x + 15, y: o.y + 63, w: 20, h: 31 }, { x: o.x + 95, y: o.y + 63, w: 20, h: 31 }, { x: o.x + 29, y: o.y + 22, w: 12, h: 11 }, { x: o.x + 89, y: o.y + 22, w: 12, h: 11 }]; }
function makeCafeWin(o) { return [{ x: o.x + 13, y: o.y + 67, w: 36, h: 24 }, { x: o.x + 65, y: o.y + 71, w: 10, h: 10 }]; }

// ---------------------------------------------------------------- A* (8-dir, no corner cutting)
function createPathfinder(W, H, walk, cost) {
  const N = W * H;
  const g = new Float32Array(N), f = new Float32Array(N), parent = new Int32Array(N);
  const seen = new Uint32Array(N), closed = new Uint32Array(N);
  const heap = new Int32Array(N * 8 + 16);
  let hn = 0, gen = 0;
  const push = (i) => {
    let k = hn++;
    while (k > 0) { const p = (k - 1) >> 1; if (f[heap[p]] <= f[i]) break; heap[k] = heap[p]; k = p; }
    heap[k] = i;
  };
  const pop = () => {
    const top = heap[0], last = heap[--hn];
    if (hn > 0) {
      let k = 0; const fl = f[last];
      for (;;) {
        const l = 2 * k + 1; if (l >= hn) break;
        const rr = l + 1; const m = (rr < hn && f[heap[rr]] < f[heap[l]]) ? rr : l;
        if (f[heap[m]] >= fl) break;
        heap[k] = heap[m]; k = m;
      }
      heap[k] = last;
    }
    return top;
  };
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  return function find(sx, sy, tx, ty, maxExpand = 30000) {
    if (sx < 0 || sy < 0 || tx < 0 || ty < 0 || sx >= W || tx >= W || sy >= H || ty >= H) return null;
    const s = sy * W + sx, t = ty * W + tx;
    if (!walk[t]) return null;
    if (s === t) return [];
    gen++;
    if (gen >= 0xfffffff0) { seen.fill(0); closed.fill(0); gen = 1; }
    hn = 0;
    const hfn = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return 1.15 * ((dx + dy) + (1.414 - 2) * Math.min(dx, dy)); };
    g[s] = 0; f[s] = hfn(sx, sy); seen[s] = gen; parent[s] = -1; push(s);
    let exp = 0;
    while (hn > 0) {
      const cur = pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === t) {
        const path = [];
        let c = t;
        while (c !== s && c !== -1) { path.push({ x: c % W, y: (c / W) | 0 }); c = parent[c]; }
        path.reverse();
        return path;
      }
      if (++exp > maxExpand) return null;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        if (!walk[ni] && !(ni === t)) continue;
        if (!walk[ni]) continue;
        let step = cost[ni];
        if (k >= 4) {
          if (!walk[cy * W + nx] || !walk[ny * W + cx]) continue;
          step *= 1.414;
        }
        const ng = g[cur] + step;
        if (seen[ni] !== gen || ng < g[ni]) {
          seen[ni] = gen; g[ni] = ng; f[ni] = ng + hfn(nx, ny); parent[ni] = cur; push(ni);
        }
      }
    }
    return null;
  };
}
