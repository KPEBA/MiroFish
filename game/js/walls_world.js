// Swarm Town — walls_world.js : "three_walls" map theme. Generates a walled city with three concentric
// rounded-square stone walls (gates on the four main roads), ring districts, plains/forest/river beyond.
import { TILE, T, hashStr, hash2, mulberry32, makeCanvas } from './sprites.js';
import * as WS from './walls_sprites.js';

export const RINGS = ['outer', 'middle', 'inner'];
const KW = {
  beyond: /(scout|expedition|ranger|explorer|pathfinder|розвід|слідопит|експедиц|мандрів|дозорц)/i,
  inner: /(noble|council|lord|lady|king|queen|prince|palace|chancel|priest|temple|chronic|aristocr|знат|радн|рада|князь|княгин|канцлер|жрец|жриц|храм|літопис|вельмож|шляхт)/i,
  middle: /(smith|forge|craft|merchant|trader|healer|doctor|guard|soldier|watch|herald|press|mason|artisan|baker|engineer|коваль|ремісн|торгов|купець|купц|лікар|цілит|травни|варт|гвард|сотни|вісник|глашат|друкар|майстер|мурар|пекар|інженер)/i,
};
const REFUGEE = /(refugee|homeless|exile|біжен|переселен|вигнан|безхат)/i;
const FARM = /(farm|shepherd|miller|peasant|herd|селян|фермер|хлібороб|пастух|мельни|орач|землероб)/i;

export function ringOfAgent(a) {
  if (a && (a.ring === 'outer' || a.ring === 'middle' || a.ring === 'inner' || a.ring === 'beyond')) return a.ring;
  const s = `${(a && a.type) || ''} ${(a && a.profession) || ''}`;
  if (KW.beyond.test(s)) return 'beyond';
  if (KW.inner.test(s)) return 'inner';
  if (KW.middle.test(s)) return 'middle';
  return 'outer';
}

const COST = new Float32Array(16);
COST[T.ROAD] = 1; COST[T.PATH] = 1; COST[T.PLAZA] = 1; COST[T.DOCK] = 1.1; COST[T.MUD] = 1.2;
COST[T.GRASS] = 1.9; COST[T.PARK] = 1.6; COST[T.SAND] = 2.2; COST[T.WHEAT] = 3.2; COST[T.FIELD] = 3.2;

export function buildWalledCity(data, { createPathfinder, valueNoise }) {
  const meta = data.meta || {};
  const agents = data.agents || [];
  const seed = hashStr(meta.simulation_id || 'three-walls');
  const agentRing = new Map(agents.map(a => [a.id, ringOfAgent(a)]));
  const cnt = { outer: 0, middle: 0, inner: 0, beyond: 0 };
  for (const r of agentRing.values()) cnt[r]++;

  // ---------- geometry (sizes grow with population)
  const TI = 4, TM = 4, TO = 5;
  const RI = Math.min(28, 18 + 2 * Math.max(0, Math.ceil((cnt.inner - 8) / 5)));
  const RM = RI + Math.min(32, 21 + 2 * Math.max(0, Math.ceil((cnt.middle - 40) / 14)));
  const RO = RM + Math.min(36, 24 + 2 * Math.max(0, Math.ceil((cnt.outer - 45) / 16)));
  const MARGIN = 26;
  const C = RO + MARGIN;
  const W = 2 * C + 1, H = W, N = W * H;
  const RW = { inner: [RI, TI], middle: [RM, TM], outer: [RO, TO] };
  const tiles = new Uint8Array(N), blocked = new Uint8Array(N), deco = new Uint8Array(N), reserved = new Uint8Array(N), noTree = new Uint8Array(N);
  const I = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const setT = (x, y, t) => { if (inb(x, y)) tiles[I(x, y)] = t; };
  const getT = (x, y) => inb(x, y) ? tiles[I(x, y)] : T.SAND;
  const norm = (x, y) => { const dx = x - C, dy = y - C; return Math.pow(dx * dx * dx * dx + dy * dy * dy * dy, 0.25); };
  // zone codes: 0 inner, 1 inner wall, 2 middle, 3 middle wall, 4 outer, 5 outer wall, 6 beyond
  const zoneOfN = n => n < RI - TI ? 0 : n < RI ? 1 : n < RM - TM ? 2 : n < RM ? 3 : n < RO - TO ? 4 : n < RO ? 5 : 6;
  const zone = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = zoneOfN(norm(x, y)); zone[I(x, y)] = z;
    tiles[I(x, y)] = (z & 1) && z < 6 ? T.WALL : z === 6 ? T.SAND : T.GRASS;
  }
  const ZONE = { inner: 0, middle: 2, outer: 4, beyond: 6 };
  const zoneName = z => (z === 0 ? 'inner' : z === 2 ? 'middle' : z === 4 ? 'outer' : z === 6 ? 'beyond' : 'wall');
  const ringWallZone = { inner: 1, middle: 3, outer: 5 };

  // ---------- main roads (N/S/E/W through every gate to the map edge)
  for (let k = 0; k < W; k++) for (const o of [-1, 0]) {
    if (tiles[I(C + o, k)] !== T.WALL) setT(C + o, k, T.ROAD);
    if (tiles[I(k, C + o)] !== T.WALL) setT(k, C + o, T.ROAD);
  }
  // ring streets
  const midM = (RI + RM - TM) / 2, midO = (RM + RO - TO) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y); if (tiles[i] !== T.GRASS) continue;
    const n = norm(x, y);
    if (zone[i] === 2 && Math.abs(n - midM) < 1.0) tiles[i] = T.ROAD;
    else if (zone[i] === 4 && Math.abs(n - midO) < 0.75) tiles[i] = T.MUD;
    else if (zone[i] === 0 && Math.abs(n - (RI - TI - 2.5)) < 0.55) tiles[i] = T.PATH;
  }

  // ---------- objects helper
  const objects = [], lamps = [], labels = [];
  const addObj = (spr, tx, ty, fw, fh, kind, extra = {}, block = true) => {
    if (block) for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) if (inb(x, y)) blocked[I(x, y)] = 1;
    const o = { img: spr.img, x: tx * TILE + spr.ox, y: ty * TILE + spr.oy, baseY: (ty + fh) * TILE, kind, tx, ty, fw, fh, ...extra };
    if (spr.windows) o.windows = spr.windows.map(w => ({ x: o.x + w.x, y: o.y + w.y, w: w.w, h: w.h }));
    if (spr.chimney) o.chimney = { x: o.x + spr.chimney.x + 1, y: o.y + spr.chimney.y + 1 };
    objects.push(o);
    if (spr.light) lamps.push({ x: o.x + spr.light.dx, y: o.y + spr.light.dy, r: 1, flicker: true });
    return o;
  };
  const reserve = (x0, y0, w, h, m = 1) => { for (let y = y0 - m; y < y0 + h + m; y++) for (let x = x0 - m; x < x0 + w + m; x++) if (inb(x, y)) reserved[I(x, y)] = 1; };
  const fits = (x0, y0, w, h, z, opt = {}) => {
    const m = opt.margin ?? 1;
    for (let y = y0 - m; y < y0 + h + m + 1; y++) for (let x = x0 - m; x < x0 + w + m; x++) {
      if (!inb(x, y)) return false;
      const i = I(x, y);
      if (zone[i] !== z || reserved[i]) return false;
      if (!opt.allowRoad && y >= y0 && y < y0 + h && x >= x0 && x < x0 + w && tiles[i] === T.ROAD) return false;
    }
    return true;
  };
  const place = (w, h, z, cx, cy, opt = {}) => {
    const bx = Math.round(cx - w / 2), by = Math.round(cy - h / 2);
    for (let r = 0; r <= (opt.radius ?? 14); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (fits(bx + dx, by + dy, w, h, z, opt)) return { x: bx + dx, y: by + dy, w, h };
    }
    return null;
  };
  const fillRect = (r, t) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) setT(x, y, t); };
  const frontOf = (r, d = 2) => ({ x0: r.x, y0: r.y + r.h, x1: r.x + r.w - 1, y1: r.y + r.h + d - 1 });

  // ---------- gates & gatehouses
  const gates = [];
  for (const ring of RINGS) {
    const [R, Tk] = RW[ring];
    for (const dir of ['N', 'S', 'E', 'W']) {
      const hor = dir === 'N' || dir === 'S';
      const a0 = dir === 'S' || dir === 'E' ? C + R - Tk : C - R + 1; // first wall row/col along the axis
      // force a clean rectangular block with a 4-wide passage
      for (let k = 0; k < Tk; k++) for (let s = -4; s <= 3; s++) {
        const x = hor ? C + s : a0 + k, y = hor ? a0 + k : C + s;
        setT(x, y, (s >= -2 && s <= 1) ? T.ROAD : T.WALL);
        zone[I(x, y)] = ringWallZone[ring];
      }
      const tx = hor ? C - 4 : a0, ty = hor ? a0 : C - 4;
      const open = WS.makeGatehouse(hor, Tk, false), shut = WS.makeGatehouse(hor, Tk, true);
      const o = addObj(open, tx, ty, hor ? 8 : Tk, hor ? Tk : 8, 'gate', { imgClosed: shut.img, ring, dir }, false);
      if (hor) { for (let k = 0; k < Tk; k++) for (const s of [-4, -3, 2, 3]) blocked[I(C + s, a0 + k)] = 1; }
      else { for (let k = 0; k < Tk; k++) for (const s of [-4, -3, 2, 3]) blocked[I(a0 + k, C + s)] = 1; }
      for (const t of open.torches) lamps.push({ x: o.x + t.x, y: o.y + t.y, r: 1, flicker: true });
      const outward = dir === 'S' || dir === 'E' ? 1 : -1;
      const outA = outward > 0 ? a0 + Tk : a0 - 1, inA = outward > 0 ? a0 - 1 : a0 + Tk;
      gates.push({ ring, dir, obj: o, outside: hor ? { x: C, y: outA + outward } : { x: outA + outward, y: C }, inside: hor ? { x: C, y: inA - outward } : { x: inA - outward, y: C } });
      reserve(tx, ty, hor ? 8 : Tk, hor ? Tk : 8, 2);
    }
  }

  // ---------- watchtowers, breach sites, torches & braziers
  const towers = [];
  const breachSites = { inner: [], middle: [], outer: [] };
  for (const ring of RINGS) {
    const [R, Tk] = RW[ring];
    const nc = R - Tk / 2, d = Math.round(nc / Math.pow(2, 0.25));
    const spots = [[C - d, C - d], [C + d, C - d], [C - d, C + d], [C + d, C + d]];
    if (ring === 'outer') { const e = Math.round(R - Tk / 2), q = Math.round(R * 0.42); spots.push([C - e, C - q], [C - e, C + q], [C + e, C - q], [C + e, C + q]); }
    for (const [x, y] of spots) {
      const spr = WS.makeWatchtower(hashStr('tw' + x + ',' + y));
      const o = addObj(spr, x - 1, y - 1, 3, 3, 'tower', { ring });
      o.bell = { x: o.x + spr.bell.x, y: o.y + spr.bell.y };
      towers.push(o); reserve(x - 1, y - 1, 3, 3, 2);
    }
    for (const side of [1, -1]) for (const sx of [-1, 1]) {
      const x = C + sx * Math.round(0.4 * R);
      let y0 = -1, y1 = -1;
      for (let y = side > 0 ? C : 0; side > 0 ? y < H : y < C; y++) if (zone[I(x, y)] === ringWallZone[ring]) { if (y0 < 0) y0 = y; y1 = y; }
      if (y0 >= 0) breachSites[ring].push({ ring, x, y0, y1, dir: side });
    }
    // torches on visible (south-facing) faces of the horizontal stretches
    for (const side of [1, -1]) for (let x = C - Math.round(R * 0.78); x <= C + Math.round(R * 0.78); x += 6) {
      if (Math.abs(x - C) < 7) continue;
      if (breachSites[ring].some(s => Math.abs(s.x - x) < 4)) continue;
      let yb = -1;
      for (let y = side > 0 ? C : 0; side > 0 ? y < H : y < C; y++) if (zone[I(x, y)] === ringWallZone[ring] && tiles[I(x, y)] === T.WALL) yb = y;
      if (yb < 0 || reserved[I(x, yb)]) continue;
      addObj(WS.makeTorch(), x, yb, 1, 1, 'torch');
    }
    for (const side of [1, -1]) for (let y = C - Math.round(R * 0.7); y <= C + Math.round(R * 0.7); y += 8) {
      if (Math.abs(y - C) < 7) continue;
      const x = C + side * Math.round(R - Tk / 2 - 0.5);
      if (tiles[I(x, y)] !== T.WALL || reserved[I(x, y)]) continue;
      addObj(WS.makeBrazier(), x, y, 1, 1, 'torch');
    }
  }

  // ---------- OUTER RING landmarks
  const ysO = C + RO - TO - 1;
  const square = { x: C - 9, y: ysO - 12, w: 18, h: 10 };
  fillRect(square, T.PLAZA); reserve(square.x, square.y, square.w, square.h, 1);
  const board = addObj(WS.makeHeraldStone(), C - 7, square.y + 3, 2, 1, 'board');
  addObj(WS.makeWell(), C + 4, square.y + 3, 2, 2, 'well');
  addObj(WS.makeCart(3), C + 6, square.y + 7, 2, 1, 'cart');
  const granR = place(6, 4, ZONE.outer, C - 18, square.y + 5, { margin: 1 });
  let granary = null, outerBarracks = null;
  if (granR) { granary = addObj(WS.makeGranary(), granR.x, granR.y, 6, 4, 'granary', { name: 'granary' }); reserve(granR.x, granR.y, 6, 4, 1); for (let x = granR.x - 2; x < granR.x + 8; x++) for (let y = granR.y + 4; y < granR.y + 6; y++) if (getT(x, y) === T.GRASS) setT(x, y, T.MUD); }
  const barR = place(7, 4, ZONE.outer, C + 17, square.y + 5, { margin: 1 });
  if (barR) { outerBarracks = addObj(WS.makeBarracks(31), barR.x, barR.y, 7, 4, 'building', { name: 'barracks' }); reserve(barR.x, barR.y, 7, 4, 1); for (let x = barR.x; x < barR.x + 7; x++) for (let y = barR.y + 4; y < barR.y + 6; y++) if (getT(x, y) === T.GRASS) setT(x, y, T.MUD); }

  // ---------- MIDDLE RING landmarks
  const ysM = C + RM - TM - 1;
  const market = { x: C - 8, y: ysM - 12, w: 16, h: 10 };
  fillRect(market, T.PLAZA); reserve(market.x, market.y, market.w, market.h, 1);
  for (const sx of [C - 7, C - 4, C + 2, C + 5]) for (const sy of [market.y + 1, market.y + 6]) addObj(WS.makeStall(hashStr('st' + sx + sy)), sx, sy, 2, 2, 'stall');
  const tavR = place(6, 4, ZONE.middle, C - 15, market.y + 4);
  const tavern = tavR && addObj(WS.makeTavern(), tavR.x, tavR.y, 6, 4, 'building', { name: 'tavern' });
  if (tavR) reserve(tavR.x, tavR.y, 6, 4, 1);
  const herR = place(6, 4, ZONE.middle, C + 15, market.y + 4);
  const herald = herR && addObj(WS.makeHeraldHall(), herR.x, herR.y, 6, 4, 'building', { name: 'herald' });
  if (herR) reserve(herR.x, herR.y, 6, 4, 1);
  const forges = [];
  for (const [fx, fy] of [[C - midM, C - 7], [C - midM, C + 6], [C - midM + 7, C - midM + 4]]) {
    const r = place(4, 3, ZONE.middle, fx, fy, { radius: 8 });
    if (!r) continue;
    const spr = WS.makeForge(hashStr('fg' + fx + fy));
    const o = addObj(spr, r.x, r.y, 4, 3, 'forge', { name: 'forge', fire: { x: 0, y: 0 } });
    o.fire = { x: o.x + spr.fire.x + 1, y: o.y + spr.fire.y + 1 };
    lamps.push({ x: o.fire.x, y: o.fire.y, r: 1, flicker: true, forge: true });
    forges.push(o); reserve(r.x, r.y, 4, 3, 1);
  }
  const healR = place(5, 3, ZONE.middle, C + midM, C - 6);
  const healers = healR && addObj(WS.makeHealers(), healR.x, healR.y, 5, 3, 'building', { name: 'healers' });
  if (healR) reserve(healR.x, healR.y, 5, 3, 1);
  const mbarR = place(7, 4, ZONE.middle, C + 9, C - midM);
  const midBarracks = mbarR && addObj(WS.makeBarracks(57), mbarR.x, mbarR.y, 7, 4, 'building', { name: 'barracksM' });
  if (mbarR) reserve(mbarR.x, mbarR.y, 7, 4, 1);

  // ---------- INNER RING landmarks
  const council = { x: C - 6, y: C - 1, w: 12, h: 7 };
  const palaceR = { x: C - 6, y: C - 8, w: 12, h: 6 };
  for (let y = C - RI; y < palaceR.y + palaceR.h; y++) for (const o of [-1, 0]) if (zone[I(C + o, y)] === 0) setT(C + o, y, T.PARK);
  fillRect(council, T.PLAZA); reserve(council.x, council.y, council.w, council.h, 1);
  const palace = addObj(WS.makePalace(), palaceR.x, palaceR.y, 12, 6, 'building', { name: 'palace' });
  reserve(palaceR.x, palaceR.y, 12, 6, 1);
  const templeR = place(7, 5, ZONE.inner, C + 7, C + 7, { radius: 8 }) || place(7, 5, ZONE.inner, C - 7, C + 7, { radius: 8 });
  const temple = templeR && addObj(WS.makeTemple(), templeR.x, templeR.y, 7, 5, 'building', { name: 'temple' });
  if (templeR) { reserve(templeR.x, templeR.y, 7, 5, 1); for (let x = templeR.x + 2; x < templeR.x + 5; x++) if (getT(x, templeR.y + 5) !== T.ROAD) setT(x, templeR.y + 5, T.PATH); }

  // ---------- lots & homes
  // greedy packing of 5x5 lots, nearest to `focus` first (or farthest first)
  const lotsFor = (z, focus, maxN, far = false, filter = null) => {
    const cand = [];
    for (let y0 = 0; y0 < H - 5; y0++) for (let x0 = 0; x0 < W - 5; x0++) {
      if (zone[I(x0, y0)] !== z || zone[I(x0 + 4, y0 + 4)] !== z) continue;
      let ok = true;
      for (let y = y0; y < y0 + 5 && ok; y++) for (let x = x0; x < x0 + 5; x++) { const i = I(x, y); if (zone[i] !== z || reserved[i] || tiles[i] === T.ROAD || tiles[i] === T.PLAZA) { ok = false; break; } }
      if (ok && (!filter || filter(x0, y0))) cand.push({ x: x0, y: y0, d: (x0 + 2 - focus.x) ** 2 + (y0 + 2 - focus.y) ** 2 + hash2(x0, y0, seed) * 6 });
    }
    cand.sort((a, b) => far ? b.d - a.d : a.d - b.d);
    const occ = new Uint8Array(N), out = [];
    for (const c of cand) {
      if (out.length >= maxN) break;
      let ok = true;
      for (let y = c.y; y < c.y + 5 && ok; y++) for (let x = c.x; x < c.x + 5; x++) if (occ[I(x, y)]) { ok = false; break; }
      if (!ok) continue;
      for (let y = c.y; y < c.y + 5; y++) for (let x = c.x; x < c.x + 5; x++) occ[I(x, y)] = 1;
      out.push(c);
    }
    return out;
  };
  const dist2 = (l, p) => (l.x + 2 - p.x) ** 2 + (l.y + 2 - p.y) ** 2;
  const sqC = { x: square.x + square.w / 2, y: square.y + square.h / 2 }, mkC = { x: market.x + market.w / 2, y: market.y + market.h / 2 }, coC = { x: council.x + council.w / 2, y: council.y + council.h / 2 };
  const homes = new Map();
  const fireTargets = { outer: [], middle: [...forges], inner: [] };
  const ringFallback = () => null;
  const buildHomes = (ring, ids, lots, makeSpr, kindOf) => {
    const built = [];
    ids.forEach((id, k) => {
      if (k < lots.length && !reservedLot(lots[k])) {
        const l = lots[k];
        const ag = agents.find(a => a.id === id);
        const spr = makeSpr(ag, hashStr('home' + id));
        const o = addObj(spr, l.x + 1, l.y + 1, 3, 2, 'house', { owner: id, ring, style: kindOf ? kindOf(ag) : ring });
        reserve(l.x, l.y, 5, 5, 0);
        const door = { x: l.x + 2, y: l.y + 3 };
        if (getT(door.x, door.y) === T.GRASS || getT(door.x, door.y) === T.PARK) setT(door.x, door.y, ring === 'outer' ? T.MUD : T.PATH);
        noTree[I(l.x + 1, l.y + 3)] = noTree[I(l.x + 3, l.y + 3)] = 1;
        built.push({ door, house: o });
        homes.set(id, { door, house: o, type: ag.type, ring });
        if (ring !== 'outer' || o.style !== 'tent') fireTargets[ring].push(o);
        const h = hash2(l.x, l.y, seed);
        if (ring === 'inner') { if (h < 0.5) addObj(WS.makeGardenBed(hashStr('gb' + id)), l.x + 1, l.y + 3, 1, 1, 'flowers'); }
        else if (ring === 'middle') { if (h < 0.3) addObj(WS.makeCart(id), l.x + 3, l.y + 4, 2, 1, 'cart'); }
        else if (o.style === 'farm' && h < 0.6) addObj(WS.makeHaystack(hashStr('hs' + id)), l.x + 4, l.y + 3, 1, 1, 'hay');
      } else if (built.length || allBuilt[ring].length) {
        const pool = built.length ? built : allBuilt[ring];
        const b = pool[k % pool.length];
        homes.set(id, { door: b.door, house: b.house, type: (agents.find(a => a.id === id) || {}).type, ring });
      } else {
        const o = ring === 'inner' ? palace : ring === 'middle' ? (midBarracks || tavern) : outerBarracks;
        if (o) homes.set(id, { door: { x: o.tx + Math.floor(o.fw / 2), y: o.ty + o.fh }, house: o, type: (agents.find(a => a.id === id) || {}).type, ring });
      }
    });
    allBuilt[ring].push(...built);
  };
  const allBuilt = { inner: [], middle: [], outer: [] };
  const reservedLot = l => { for (let y = l.y; y < l.y + 5; y++) for (let x = l.x; x < l.x + 5; x++) if (reserved[I(x, y)]) return true; return false; };
  // decorative, unowned houses so the districts feel lived-in
  const fillers = (ring, lots, makeSpr) => {
    for (const l of lots) {
      if (reservedLot(l)) continue;
      const o = addObj(makeSpr(hashStr('fill' + l.x + ',' + l.y), l), l.x + 1, l.y + 1, 3, 2, 'building', { filler: true, ring });
      reserve(l.x, l.y, 5, 5, 0);
      const door = { x: l.x + 2, y: l.y + 3 };
      if (getT(door.x, door.y) === T.GRASS || getT(door.x, door.y) === T.PARK) setT(door.x, door.y, ring === 'outer' ? T.MUD : T.PATH);
      if (o.img) fireTargets[ring].push(o);
    }
  };
  const idsOf = r => agents.filter(a => agentRing.get(a.id) === r).map(a => a.id);
  {
    const ids = idsOf('inner');
    const lots = lotsFor(ZONE.inner, coC, ids.length + 6);
    buildHomes('inner', ids, lots, (a, s) => WS.makeNobleHouse(s));
    fillers('inner', lots.slice(ids.length), s => WS.makeNobleHouse(s));
  }
  {
    const ids = idsOf('middle');
    const lots = lotsFor(ZONE.middle, mkC, ids.length + Math.max(14, 34 - ids.length));
    buildHomes('middle', ids, lots, (a, s) => WS.makeWorkshopHouse(s));
    fillers('middle', lots.slice(ids.length).filter((l, i) => hash2(l.x, l.y, seed + 1) < 0.75 || i < 8), s => WS.makeWorkshopHouse(s));
  }
  {
    const cat = a => { const s = `${a.type || ''} ${a.profession || ''}`; return REFUGEE.test(s) ? 'tent' : FARM.test(s) ? 'farm' : 'shack'; };
    const order = { tent: 0, shack: 1, farm: 2 };
    const ids = idsOf('outer').map(id => agents.find(a => a.id === id)).sort((a, b) => order[cat(a)] - order[cat(b)] || a.id - b.id).map(a => a.id);
    const notGate = (x0, y0) => !(y0 > square.y - 4 && Math.abs(x0 + 2 - C) < 12);
    // farmers take the far lots, everybody else crowds around the gate square
    const farmIds = ids.filter(id => cat(agents.find(a => a.id === id)) === 'farm');
    const nearIds = ids.filter(id => !farmIds.includes(id));
    const mk = (a, s) => { const c = cat(a); return c === 'tent' ? WS.makeTent(s) : c === 'farm' ? WS.makeFarmhouse(s) : WS.makeShack(s); };
    const nearLots = lotsFor(ZONE.outer, sqC, nearIds.length + 12, false, notGate);
    buildHomes('outer', nearIds, nearLots, mk, cat);
    fillers('outer', nearLots.slice(nearIds.length), (s, l) => hash2(l.x, l.y, 4) < 0.35 ? WS.makeTent(s) : WS.makeShack(s));
    const farLots = lotsFor(ZONE.outer, sqC, (farmIds.length + 10) * 3, true).filter((_, i) => i % 3 === 0);
    buildHomes('outer', farmIds, farLots, mk, cat);
    fillers('outer', farLots.slice(farmIds.length), s => WS.makeFarmhouse(s));
  }
  // beyond agents live in the outer barracks (or by the gate)
  const barDoor = barR ? { x: barR.x + 3, y: barR.y + 4 } : { x: C + 4, y: square.y + 2 };
  for (const id of idsOf('beyond')) homes.set(id, { door: barDoor, house: outerBarracks, type: (agents.find(a => a.id === id) || {}).type, ring: 'beyond' });
  // refugee tents scattered around the gate square for atmosphere
  for (const [dx, dy] of [[-14, -4], [-12, 1], [12, -4], [-16, -1]]) {
    const r = place(3, 2, ZONE.outer, sqC.x + dx, sqC.y + dy, { radius: 4 });
    if (r) { addObj(WS.makeTent(hashStr('dt' + dx + dy)), r.x, r.y, 3, 2, 'tent'); reserve(r.x, r.y, 3, 2, 0); }
  }

  // ---------- fields, gardens & greenery
  const rndW = mulberry32(seed ^ 0x51ed);
  const canTree = (x, y) => inb(x, y) && (getT(x, y) === T.GRASS || getT(x, y) === T.PARK || getT(x, y) === T.SAND) && !blocked[I(x, y)] && !noTree[I(x, y)] && !reserved[I(x, y)];
  const placeTree = (x, y, kind) => {
    if (!canTree(x, y)) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = getT(x + dx, y + dy); if (n === T.ROAD || n === T.PLAZA || n === T.PATH || n === T.MUD || n === T.DOCK) return false; }
    addObj(WS.makeDarkTree(kind, hashStr('t' + x + ',' + y)), x, y, 1, 1, 'tree');
    return true;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y); const z = zone[i];
    if (tiles[i] !== T.GRASS || reserved[i] || blocked[i]) continue;
    const n = norm(x, y);
    if (z === 4) {
      const px = Math.floor((x - C + 200) / 7), py = Math.floor((y - C + 200) / 5);
      const border = ((x - C + 200) % 7 === 0) || ((y - C + 200) % 5 === 0);
      if (n > RM + 1.5 && n < RO - TO - 1.5 && hash2(px, py, seed + 3) < 0.72) { tiles[i] = border ? (hash2(x, y, 5) < 0.5 ? T.MUD : T.GRASS) : T.WHEAT; continue; }
      const h = hash2(x, y, seed + 7);
      if (h < 0.04) placeTree(x, y, h < 0.015 ? 'dead' : 'oak'); else if (h < 0.2) deco[i] = h < 0.12 ? 2 : 4;
    } else if (z === 2) {
      const h = hash2(x, y, seed + 9);
      if (h < 0.035) placeTree(x, y, 'oak'); else if (h < 0.3) deco[i] = h < 0.2 ? 3 : 2;
    } else if (z === 0) {
      tiles[i] = T.PARK;
      const h = hash2(x, y, seed + 13);
      if (h < 0.06) placeTree(x, y, h < 0.03 ? 'pine' : 'oak');
      else if (h < 0.1 && !blocked[i]) { addObj(WS.makeHedge(hashStr('hg' + x + y)), x, y, 1, 1, 'hedge'); }
      else if (h < 0.13 && !blocked[i]) { addObj(WS.makeGardenBed(hashStr('gd' + x + y)), x, y, 1, 1, 'flowers'); }
      else if (h < 0.3) deco[i] = 1;
    }
  }
  // scarecrows & haystacks in fields
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    if (getT(x, y) !== T.WHEAT || blocked[I(x, y)]) continue;
    const h = hash2(x, y, seed + 17);
    if (h < 0.02) addObj(WS.makeScarecrow(), x, y, 1, 1, 'scarecrow');
    else if (h < 0.04) addObj(WS.makeHaystack(hashStr('h' + x + y)), x, y, 1, 1, 'hay');
  }

  // ---------- beyond: river, forests, plains
  const river = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const cx = C - RO - 13 + Math.round(Math.sin(y * 0.06 + 1.3) * 4 + Math.sin(y * 0.023) * 3);
    for (let x = cx - 1; x <= cx + 2; x++) if (inb(x, y) && zone[I(x, y)] === 6) { river[I(x, y)] = 1; tiles[I(x, y)] = getT(x, y) === T.ROAD ? T.DOCK : T.WATER; }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = I(x, y);
    if (zone[i] !== 6 || tiles[i] !== T.SAND) continue;
    const n = norm(x, y);
    if (n < RO + 7) { const h = hash2(x, y, seed + 21); if (h < 0.08) deco[i] = 3; else if (h < 0.16) deco[i] = 4; continue; } // killing field
    const f = valueNoise(x * 0.09, y * 0.09, seed + 5) * 0.7 + valueNoise(x * 0.27, y * 0.27, seed + 6) * 0.3;
    const h = hash2(x, y, seed + 23);
    const nearRiver = river[I(Math.max(0, x - 2), y)] || river[I(Math.min(W - 1, x + 2), y)];
    if (f > 0.58 && h < 0.55) placeTree(x, y, f > 0.66 ? 'pine' : (h < 0.08 ? 'dead' : 'oak'));
    else if (nearRiver && h < 0.12) placeTree(x, y, 'oak');
    else if (h < 0.012) placeTree(x, y, 'dead');
    else if (h < 0.02 && canTree(x, y)) addObj(WS.makeStoneRock(hashStr('r' + x + y)), x, y, 1, 1, 'rock');
    else if (h < 0.12) deco[i] = h < 0.06 ? 4 : 2;
  }

  // ---------- walkability & reachability
  const walk = new Uint8Array(N), cost = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    walk[i] = (t !== T.WATER && t !== T.DEEP && t !== T.WALL && !blocked[i]) ? 1 : 0;
    cost[i] = COST[t] || 2;
  }
  const plazaCenter = { x: C, y: square.y + 6 };
  {
    const reach = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
    const s = I(plazaCenter.x, plazaCenter.y); reach[s] = 1; q[qt++] = s;
    while (qh < qt) {
      const c = q[qh++], cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy; if (!inb(nx, ny)) continue;
        const ni = I(nx, ny); if (!walk[ni] || reach[ni]) continue;
        reach[ni] = 1; q[qt++] = ni;
      }
    }
    for (let i = 0; i < N; i++) if (!reach[i]) walk[i] = 0;
  }
  const nearestWalkable = (x, y, maxR = 14) => {
    x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y)));
    if (walk[I(x, y)]) return { x, y };
    for (let rr = 1; rr <= maxR; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
      const nx = x + dx, ny = y + dy; if (inb(nx, ny) && walk[I(nx, ny)]) return { x: nx, y: ny };
    }
    return { ...plazaCenter };
  };
  for (const h of homes.values()) if (!walk[I(h.door.x, h.door.y)]) h.door = nearestWalkable(h.door.x, h.door.y);

  // ---------- places
  const collectRect = (x0, y0, x1, y1, pred) => { const out = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y) && walk[I(x, y)] && (!pred || pred(x, y))) out.push({ x, y }); return out; };
  const collectRad = (cx, cy, r, pred) => collectRect(Math.round(cx - r), Math.round(cy - r), Math.round(cx + r), Math.round(cy + r), pred);
  const rectSpots = r => collectRect(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1);
  const frontSpots = (o, d = 2) => o ? collectRect(o.tx, o.ty + o.fh, o.tx + o.fw - 1, o.ty + o.fh + d - 1) : [];
  const pxCenter = r => ({ x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE });
  const places = {
    plaza: { name: 'Брама-майдан', spots: rectSpots(square), boardSpots: collectRect(board.tx - 2, board.ty + 1, board.tx + 4, board.ty + 3), center: pxCenter(square) },
    forum: { name: 'Ринкова площа', spots: rectSpots(market), center: pxCenter(market) },
    council: { name: 'Палац ради', spots: rectSpots(council), center: pxCenter(council) },
    cafe: { name: 'Корчма', spots: frontSpots(tavern, 3) },
    library: { name: 'Вісникова палата', spots: frontSpots(herald, 3) },
    park: { name: 'Сади', spots: collectRad(C, C, RI - TI - 1, (x, y) => getT(x, y) === T.PARK || getT(x, y) === T.PATH) },
    temple: { name: 'Храм', spots: frontSpots(temple, 2) },
    granary: { name: 'Комора', spots: frontSpots(granary, 2) },
    barracks: { name: 'Казарми', spots: frontSpots(outerBarracks, 2) },
    commons: { name: 'Вигін', spots: collectRad(C - midO, C + 8, 5, (x, y) => zone[I(x, y)] === 4) },
    forges: { name: 'Кузні', spots: forges.flatMap(f => frontSpots(f, 2)) },
    healers: { name: 'Цілительня', spots: frontSpots(healers, 2) },
  };
  for (const p of Object.values(places)) if (!p.spots.length) p.spots = [{ ...plazaCenter }];
  places.plaza.board = board;
  if (!places.plaza.boardSpots.length) places.plaza.boardSpots = places.plaza.spots;
  const ringPlaces = { outer: ['plaza', 'commons', 'granary', 'plaza'], middle: ['forum', 'cafe', 'forum', 'library'], inner: ['council', 'park', 'temple'], beyond: ['barracks', 'plaza'] };

  // evacuation camps: around the next ring's square
  const campAround = (r, ringZone) => {
    const spots = collectRect(r.x - 6, r.y - 4, r.x + r.w + 5, r.y + r.h + 2, (x, y) => zone[I(x, y)] === ringZone && getT(x, y) !== T.ROAD);
    const tents = [];
    const clear = (x0, y0) => { for (let y = y0 - 2; y <= y0 + 3; y++) for (let x = x0 - 2; x <= x0 + 3; x++) if (!inb(x, y) || blocked[I(x, y)] || tiles[I(x, y)] === T.WALL) return false; return true; };
    const cand = spots.filter(s => getT(s.x, s.y) !== T.PLAZA && clear(s.x, s.y)).sort((a, b) => hash2(a.x, a.y, 3) - hash2(b.x, b.y, 3));
    for (const c of cand) { if (tents.length >= 7) break; if (tents.every(t => Math.abs(t.x - c.x) > 3 || Math.abs(t.y - c.y) > 2)) tents.push(c); }
    return { spots: spots.length ? spots : rectSpots(r), tents };
  };
  const camps = { outer: campAround(market, ZONE.middle), middle: campAround(council, ZONE.inner), inner: campAround(council, ZONE.inner) };
  // queue in front of the granary
  const queue = [];
  if (granary) { const qy = granary.ty + granary.fh; for (let k = 0; k < 14; k++) { const s = nearestWalkable(granary.tx + 2 + k, qy + (k > 8 ? 1 : 0), 3); queue.push(s); } }
  // riot crowd: outside the inner south gate
  const innerS = gates.find(g => g.ring === 'inner' && g.dir === 'S');
  const middleS = gates.find(g => g.ring === 'middle' && g.dir === 'S');
  const riotSpots = innerS ? collectRad(innerS.outside.x, innerS.outside.y + 2, 4, (x, y) => zone[I(x, y)] === 2) : places.forum.spots;
  // horizon points (sighting) — in the fog beyond the outer wall
  const horizon = [];
  for (let k = 0; k < 16; k++) {
    const ang = k / 16 * Math.PI * 2, rr = RO + 15;
    const x = C + Math.round(Math.cos(ang) * rr * 1.05), y = C + Math.round(Math.sin(ang) * rr * 1.05);
    if (inb(x, y)) horizon.push({ x, y, ang });
  }

  // ---------- labels
  const ringNames = (meta.world && meta.world.rings) || {};
  const lbl = (key, x, y, kind, extra = {}) => labels.push({ key, text: '', x, y, kind, ...extra });
  lbl('wplace.plaza', (C) * TILE, (square.y + square.h - 0.6) * TILE, 'place');
  lbl('wplace.forum', (C) * TILE, (market.y + market.h - 0.7) * TILE, 'place');
  lbl('wplace.council', (C) * TILE, (council.y + 0.5) * TILE, 'place');
  const tagOn = (o, key, extra) => { if (o) labels.push({ key, text: '', x: o.x + o.img.width / 2, y: o.y + 4, kind: 'building', ...extra }); };
  tagOn(granary, 'wplace.granary'); tagOn(outerBarracks, 'wplace.barracks'); tagOn(tavern, 'wplace.cafe'); tagOn(herald, 'wplace.library');
  tagOn(healers, 'wplace.healers'); tagOn(temple, 'wplace.temple'); tagOn(midBarracks, 'wplace.barracks');
  if (forges[0]) tagOn(forges[0], 'wplace.forges');
  labels.push({ key: 'wplace.forumTag', text: '', x: (C) * TILE, y: (market.y - 0.2) * TILE, kind: 'building', counter: 'reddit', color: '#ff8a3a' });
  labels.push({ key: 'wring.outer', text: ringNames.outer || '', x: C * TILE, y: (C - midO - 0.5) * TILE, kind: 'ring' });
  labels.push({ key: 'wring.middle', text: ringNames.middle || '', x: C * TILE, y: (C - midM - 0.5) * TILE, kind: 'ring' });
  labels.push({ key: 'wring.inner', text: ringNames.inner || '', x: C * TILE, y: (council.y + council.h + 1.6) * TILE, kind: 'ring' });
  if (meta.world && meta.world.name) labels.push({ key: null, text: meta.world.name, x: C * TILE, y: (C - RO - 11) * TILE, kind: 'ring', big: true });

  // ---------- ground canvas
  const [ground, gg] = makeCanvas(W * TILE, H * TILE);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) WS.paintTileWalls(gg, tiles, W, H, x, y, deco[I(x, y)]);
  gg.fillStyle = 'rgba(12,14,18,0.28)';
  for (const o of objects) if (o.kind === 'building' || o.kind === 'house' || o.kind === 'forge' || o.kind === 'granary') gg.fillRect(o.tx * TILE - 2, (o.ty + o.fh) * TILE - 3, o.fw * TILE + 6, 5);
  // darkness toward the map edge
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = Math.min(x, y, W - 1 - x, H - 1 - y);
    const a = Math.max(0, (12 - e) / 12) * 0.55;
    if (a > 0.01) { gg.fillStyle = `rgba(10,11,15,${a.toFixed(3)})`; gg.fillRect(x * TILE, y * TILE, TILE, TILE); }
  }
  // fog mask (1px per tile; engine draws it smoothed)
  const [fog, fg] = makeCanvas(W, H);
  {
    const id = fg.createImageData(W, H), d = id.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n = norm(x, y), e = Math.min(x, y, W - 1 - x, H - 1 - y);
      const a = Math.min(1, Math.max(0, (n - (RO + 7)) / (MARGIN - 4)) ** 1.4 * 0.8 + Math.max(0, (8 - e) / 8) * 0.5);
      const k = (y * W + x) * 4; d[k] = 52; d[k + 1] = 56; d[k + 2] = 66; d[k + 3] = Math.round(a * 255);
    }
    fg.putImageData(id, 0, 0);
  }

  objects.sort((a, b) => a.baseY - b.baseY);
  const waterTiles = [];
  for (let i = 0; i < N; i++) if (tiles[i] === T.WATER && hash2(i % W, (i / W) | 0, 77) < 0.1) waterTiles.push(i);
  const find = createPathfinder(W, H, walk, cost);
  return {
    theme: 'three_walls',
    W, H, tiles, walk, cost, ground, objects, lamps, labels, places, homes, districts: [], types: [], typeColor: new Map(),
    board, waterTiles, pxW: W * TILE, pxH: H * TILE,
    core: { x0: square.x - 11, y0: square.y - 9, x1: square.x + square.w, y1: square.y + square.h },
    geo: { C, RI, RM, RO, TI, TM, TO, MARGIN }, gates, towers, breachSites, horizon, camps, queue, riotSpots, granary, forges, fireTargets,
    ringPlaces, agentRing, fog, palace, temple, market, square, council, innerS, middleS,
    zoneAt: (x, y) => inb(x, y) ? zoneName(zone[I(x, y)]) : 'beyond',
    isWalkable: (x, y) => inb(x, y) && walk[I(x, y)] === 1,
    findPath: (sx, sy, tx, ty, maxExpand) => find(sx, sy, tx, ty, maxExpand || 40000),
    nearestWalkable,
    randomSpotNear(x, y, rad, rnd) {
      const z0 = inb(Math.round(x), Math.round(y)) ? zone[I(Math.round(x), Math.round(y))] : -1;
      for (let k = 0; k < 16; k++) {
        const nx = Math.round(x + (rnd() * 2 - 1) * rad), ny = Math.round(y + (rnd() * 2 - 1) * rad);
        if (inb(nx, ny) && walk[I(nx, ny)] && (z0 < 0 || (z0 & 1) || zone[I(nx, ny)] === z0 || k > 11)) return { x: nx, y: ny };
      }
      return nearestWalkable(x, y);
    },
    plazaCenter,
  };
}
