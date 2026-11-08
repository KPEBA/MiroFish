// Swarm Town — engine.js : playback clock, agents (A* walking, tasks, sleep/wander), rendering, camera, effects.
// API: createEngine(canvas) -> { load, play, pause, setSpeed, seek, select, getData, getAgentState, ...extras }
import { emit } from './bus.js';
import { buildWorld } from './world.js';
import {
  TILE, getCharacter, clearCharacterCache, getIcon, ACTION_ICON, STANCE_COLORS, drawBubble, drawTag, wrapText, getGlow,
  mulberry32, hashStr, makeCanvas, UI_FONT, TAG_FONT, OUTLINE,
} from './sprites.js';

export const ROUND_SECONDS = 6;         // game-seconds per round at speed 1
const WALK = 3.0;                        // tiles / game-second
const MAX_MUL = 6;                       // hurry multiplier cap
const SPEEDS = [0.5, 1, 2, 4, 8];
const PLATFORM_PLACE = { twitter: 'plaza', reddit: 'forum' };
const ACTIVITY = { POST: 'posting', QUOTE: 'quoting a post', COMMENT: 'commenting', LIKE: 'liking a post', DISLIKE: 'disliking a post', REPOST: 'reposting', FOLLOW: 'following someone', MUTE: 'muting someone', SEARCH: 'searching at the Library', TREND: 'checking trends', IDLE: 'taking a break' };
const PLACE_NAME = { plaza: 'Plaza', forum: 'Forum Hall', cafe: 'Cafe', library: 'Library', park: 'Park' };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function createEngine(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const container = canvas.parentElement || document.body;
  let dpr = Math.max(1, Math.round((window.devicePixelRatio || 1) * 4) / 4);
  let cw = 0, ch = 0;

  // ------------------------------------------------------------ state
  let data = null, world = null;
  let agents = [], agentById = new Map();
  let rounds = [], roundIdx = 0, roundT = 0, playing = false, speed = 1;
  let schedule = [], schedPtr = 0, atEnd = false;
  let realTime = 0, gameTime = 0;
  const board = { twitter: 0, reddit: 0 };
  let followEdges = [];
  let postLikes = new Map();
  let hotThreshold = 4, hype = null;
  let effects = [];
  let weather = null, festival = null, rumor = null, banner = null;
  let particles = [];
  let selected = null, hovered = null, followId = null;
  const cam = { x: 0, y: 0, z: 2, tx: null, ty: null };
  let pathBudget = 0;
  let minutesPerRound = 60;

  // ------------------------------------------------------------ helpers
  const tileOf = a => ({ x: Math.floor(a.x / TILE), y: Math.floor(a.y / TILE) });
  const pickSpot = (list, rnd) => list[Math.floor(rnd() * list.length)];
  const roundInfo = (idx) => {
    const r = rounds[idx]; if (!r) return { round: 0, day: 1, hour: 0, minute: 0 };
    const m = data.meta || {};
    let hour = r.hour, minute = r.minute ?? 0, day = r.day;
    if (hour == null) { const mins = Math.max(0, (r.round - 1)) * minutesPerRound; hour = ((m.start_hour || 0) + Math.floor(mins / 60)) % 24; minute = mins % 60; }
    if (day == null) day = 1 + Math.floor(((m.start_hour || 0) * 60 + Math.max(0, r.round - 1) * minutesPerRound) / 1440);
    return { round: r.round, day, hour, minute };
  };
  const clockHour = () => {
    const ri = roundInfo(roundIdx);
    return ((ri.hour + ri.minute / 60 + (Math.min(roundT, ROUND_SECONDS) / ROUND_SECONDS) * (minutesPerRound / 60)) % 24 + 24) % 24;
  };
  const totalRounds = () => (data && data.meta && data.meta.total_rounds != null) ? data.meta.total_rounds : (rounds.length ? rounds[rounds.length - 1].round : 0);
  const isAwake = (a, hour) => {
    const h = Math.floor(hour);
    if (a.hours) return a.hours.has(h);
    return h >= 7 && h <= 22;
  };
  const emitState = () => emit('state', { playing, speed, round: rounds[roundIdx] ? rounds[roundIdx].round : 0, totalRounds: totalRounds(), firstRound: rounds[0] ? rounds[0].round : 0 });

  function snippet(s, n = 60) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

  // ------------------------------------------------------------ agents
  function makeAgent(d, i) {
    const rnd = mulberry32(hashStr('a' + d.id));
    const home = world.homes.get(d.id);
    const door = home ? home.door : world.plazaCenter;
    const base = clamp((+d.sentiment_bias || 0) * 0.5, -1, 1);
    return {
      id: d.id, d, i, rnd, sprite: getCharacter(d.id), home: door, homeObj: home && home.house,
      x: door.x * TILE + 8, y: door.y * TILE + 12, path: null, pi: 0, dir: 0, walkPhase: 0, moving: false, mul: 1,
      queue: [], task: null, sleeping: false, bubble: null, mood: base, base,
      stats: freshStats(), lastAction: null, activity: 'idle', wanderT: rnd() * 3, offX: Math.round(rnd() * 6 - 3), offY: Math.round(rnd() * 4 - 2),
      hours: Array.isArray(d.active_hours) && d.active_hours.length ? new Set(d.active_hours.map(Number)) : null,
      alertT: 0, hop: rnd() * 6, moodFlash: 0, stance: STANCE_COLORS[d.stance] || STANCE_COLORS.observer, goingHome: false, place: null,
    };
  }
  function freshStats() { return { posts: 0, likes: 0, comments: 0, follows: 0, followers: 0, likesGiven: 0, dislikes: 0, dislikesGiven: 0, reposts: 0, reposted: 0, commentsReceived: 0, mutes: 0, muted: 0, quotes: 0, searches: 0 }; }

  function setPath(a, dest, mul = 1, budget = 0) {
    const s = tileOf(a);
    if (!world.isWalkable(s.x, s.y)) { const n = world.nearestWalkable(s.x, s.y); a.x = n.x * TILE + 8; a.y = n.y * TILE + 12; s.x = n.x; s.y = n.y; }
    const p = world.findPath(s.x, s.y, dest.x, dest.y);
    a.path = p; a.pi = 0;
    if (!p) { a.moving = false; return false; }
    a.moving = p.length > 0;
    if (budget > 0 && p.length) a.mul = clamp(p.length / (budget * WALK), 1, MAX_MUL);
    else a.mul = mul;
    return true;
  }
  function stepAgent(a, dt) {
    if (!a.path || a.pi >= a.path.length) { a.moving = false; return; }
    let dist = WALK * TILE * a.mul * dt;
    while (dist > 0 && a.pi < a.path.length) {
      const n = a.path[a.pi];
      const last = a.pi === a.path.length - 1;
      const tx = n.x * TILE + 8 + (last ? a.offX : 0), ty = n.y * TILE + 12 + (last ? a.offY : 0);
      const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0);
      if (d <= dist) { a.x = tx; a.y = ty; dist -= d; a.pi++; }
      else { a.x += dx / d * dist; a.y += dy / d * dist; dist = 0; }
    }
    a.walkPhase += dt * a.mul * 9;
    if (a.pi >= a.path.length) { a.moving = false; a.path = null; }
  }
  function nearAgentSpot(a, tg) {
    if (tg.sleeping) return world.nearestWalkable(tg.home.x, tg.home.y + 1);
    const t = tileOf(tg);
    const side = a.x < tg.x ? -1 : 1;
    const c = world.isWalkable(t.x + side, t.y) ? { x: t.x + side, y: t.y } : world.randomSpotNear(t.x, t.y, 1.5, a.rnd);
    return c;
  }
  function destinationFor(a, act, instant = false) {
    const tg = act.target_agent_id != null ? agentById.get(act.target_agent_id) : null;
    const plat = act.platform === 'reddit' ? 'reddit' : 'twitter';
    const P = world.places;
    const hot = hype && act.post_id && hype.postId === act.post_id;
    switch (act.type) {
      case 'POST': case 'QUOTE':
        a.place = PLATFORM_PLACE[plat];
        return plat === 'reddit' ? pickSpot(P.forum.spots, a.rnd) : pickSpot(P.plaza.boardSpots.length ? P.plaza.boardSpots : P.plaza.spots, a.rnd);
      case 'COMMENT': case 'LIKE': case 'DISLIKE': case 'REPOST': case 'FOLLOW':
        if (hot && plat === 'twitter') { a.place = 'plaza'; return pickSpot(P.plaza.boardSpots, a.rnd); }
        if (tg && tg !== a) {
          a.place = null;
          if (instant) return world.randomSpotNear(tg.home.x, tg.home.y + 1, 2, a.rnd);
          return nearAgentSpot(a, tg);
        }
        a.place = PLATFORM_PLACE[plat];
        return pickSpot(P[PLATFORM_PLACE[plat]].spots, a.rnd);
      case 'MUTE':
        a.place = null; return tileOf(a);
      case 'SEARCH': case 'TREND':
        a.place = 'library'; return pickSpot(P.library.spots, a.rnd);
      default:
        a.place = a.rnd() < 0.55 ? 'cafe' : 'park';
        return pickSpot(P[a.place].spots, a.rnd);
    }
  }

  // ------------------------------------------------------------ action effects (shared by play + seek)
  function applyAction(act, live) {
    const a = agentById.get(act.agent_id); if (!a) return;
    const tg = act.target_agent_id != null ? agentById.get(act.target_agent_id) : null;
    a.lastAction = act;
    const plat = act.platform === 'reddit' ? 'reddit' : 'twitter';
    const bump = (ag, v) => { if (!ag) return; ag.mood = clamp(ag.mood + v, -1, 1); if (live) ag.moodFlash = Math.sign(v) * 1.5; };
    switch (act.type) {
      case 'POST': a.stats.posts++; board[plat]++; break;
      case 'QUOTE': a.stats.posts++; a.stats.quotes++; board[plat]++; bump(tg, 0.03); break;
      case 'COMMENT': a.stats.comments++; if (tg) { tg.stats.commentsReceived++; bump(tg, 0.02); } break;
      case 'LIKE': a.stats.likesGiven++; a.mood = clamp(a.mood + 0.01, -1, 1); if (tg) { tg.stats.likes++; bump(tg, 0.05); }
        if (act.post_id) { const n = (postLikes.get(act.post_id) || 0) + 1; postLikes.set(act.post_id, n); if (live && n === hotThreshold && plat === 'twitter') startHype(act); }
        break;
      case 'DISLIKE': a.stats.dislikesGiven++; if (tg) { tg.stats.dislikes++; bump(tg, -0.07); } break;
      case 'REPOST': a.stats.reposts++; if (tg) { tg.stats.reposted++; bump(tg, 0.05); } break;
      case 'FOLLOW': a.stats.follows++; if (tg) { tg.stats.followers++; bump(tg, 0.06); followEdges.push({ from: a.id, to: tg.id }); } break;
      case 'MUTE': a.stats.mutes++; if (tg) { tg.stats.muted++; bump(tg, -0.05); } break;
      case 'SEARCH': case 'TREND': a.stats.searches++; break;
    }
  }
  function driftMoods() { for (const a of agents) a.mood += (a.base - a.mood) * 0.04; }
  function startHype(act) {
    const post = data.posts && data.posts[act.post_id];
    const author = post ? agentById.get(post.author_id) : (act.target_agent_id != null ? agentById.get(act.target_agent_id) : null);
    hype = { postId: act.post_id, until: gameTime + ROUND_SECONDS * 2.5, content: snippet((post && post.content) || act.target_content || '', 48), author };
    // pull nearby idle agents to the plaza
    const P = world.places.plaza;
    for (const a of agents) {
      if (a.task || a.queue.length || a.sleeping || a.rnd() > 0.5) continue;
      const d = Math.hypot(a.x - P.center.x, a.y - P.center.y) / TILE;
      if (d > 45) continue;
      a.goingHome = false; a.place = 'plaza'; a.activity = 'joining the crowd at the Plaza';
      setPath(a, pickSpot(P.boardSpots, a.rnd), 1.6); a.wanderT = ROUND_SECONDS * 1.5 + a.rnd() * 3;
    }
    if (author) popIcon(author.x, author.y - 26, 'star', 1.6);
  }

  // ------------------------------------------------------------ tasks
  function startTask(a, entry) {
    const act = entry.action;
    a.sleeping = false; a.goingHome = false;
    const dest = destinationFor(a, act);
    const remaining = Math.max(0.25, ROUND_SECONDS - roundT - 0.25);
    const budget = a.queue.length >= 2 ? 0.15 : Math.min(2.2, remaining * 0.8);
    a.task = { entry, phase: 'walk', el: 0, budget, linger: 0 };
    if (budget > 0.2 && dest) { setPath(a, dest, 1, budget); pathBudget--; }
    else { a.path = null; a.moving = false; }
    a.activity = (a.place ? `walking to the ${PLACE_NAME[a.place]}` : (act.target_agent_id != null && agentById.get(act.target_agent_id) ? `heading to ${agentById.get(act.target_agent_id).d.name}` : 'on the move'));
  }
  function perform(a, entry, quiet = false) {
    if (entry.done) return;
    entry.done = true;
    const act = entry.action;
    applyAction(act, true);
    const tg = act.target_agent_id != null ? agentById.get(act.target_agent_id) : null;
    a.activity = ACTIVITY[act.type] || 'idle';
    if (!quiet) {
      if (tg && tg !== a && !a.moving) { const dx = tg.x - a.x, dy = tg.y - a.y; a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 2) : (dy < 0 ? 3 : 0); }
      showBubble(a, act);
      if (act.type === 'FOLLOW' && tg) effects.push({ type: 'heart', from: a, to: tg, t: 0, dur: 1.6 });
      else if (act.type === 'LIKE' && tg) popIcon(tg.x, tg.y - 24, 'heart', 1.2);
      else if (act.type === 'DISLIKE' && tg) popIcon(tg.x, tg.y - 24, 'sad', 1.2);
      else if (act.type === 'REPOST' && tg) popIcon(tg.x, tg.y - 24, 'repost', 1.2);
    }
    emit('action', { action: act, agent: a.d });
  }
  function showBubble(a, act) {
    const ic = ACTION_ICON[act.type] || ['dots'];
    const icon = getIcon(ic[0], !!ic[1]);
    let text = null;
    if ((act.type === 'POST' || act.type === 'QUOTE' || act.type === 'COMMENT') && act.content) text = snippet(act.content, 60);
    const layout = text ? wrapText(ctx, text, 168, 2) : null;
    const accent = act.platform === 'reddit' ? '#ff8a3a' : '#4fb3e8';
    a.bubble = { icon, layout, t: 0, life: text ? 3.4 : 2.0, accent: text ? accent : null, type: act.type };
  }
  function popIcon(x, y, name, dur = 1.2) { effects.push({ type: 'pop', x, y, icon: getIcon(name), t: 0, dur }); }

  // ------------------------------------------------------------ rounds
  function startRound(idx) {
    roundIdx = idx; roundT = 0; atEnd = false;
    const acts = (rounds[idx] && rounds[idx].actions) || [];
    const n = acts.length;
    schedule = acts.map((action, j) => {
      const h = (hashStr(action.id || (idx + ':' + j)) % 1000) / 1000;
      return { action, t: ((j + 0.15 + 0.7 * h) / Math.max(1, n)) * ROUND_SECONDS * 0.82, done: false, queued: false };
    });
    schedPtr = 0;
    emit('round', roundInfo(idx));
    emitState();
  }
  function endRound() {
    // flush anything not performed yet so state is exact at round boundaries
    for (const e of schedule) if (!e.done) { const a = agentById.get(e.action.agent_id); if (a) perform(a, e, true); else e.done = true; }
    for (const a of agents) {
      a.queue.length = 0;
      if (a.task) { a.task = null; }
    }
    driftMoods();
    if (roundIdx < rounds.length - 1) startRound(roundIdx + 1);
    else { roundT = ROUND_SECONDS; atEnd = true; playing = false; emitState(); }
  }

  function resetSim() {
    board.twitter = 0; board.reddit = 0; followEdges = []; postLikes = new Map(); hype = null; effects = [];
    for (const a of agents) {
      a.stats = freshStats(); a.mood = a.base; a.lastAction = null; a.queue.length = 0; a.task = null; a.bubble = null;
      a.path = null; a.moving = false; a.activity = 'idle'; a.place = null; a.goingHome = false;
    }
  }
  function seek(round, opts = {}) {
    if (!data || !rounds.length) return;
    round = Number(round);
    let idx = rounds.findIndex(r => r.round >= round);
    if (idx < 0) idx = rounds.length - 1;
    const teleport = opts.teleport !== false;
    resetSim();
    for (let i = 0; i < idx; i++) { for (const act of rounds[i].actions || []) applyAction(act, false); driftMoods(); }
    if (teleport) {
      const ri = roundInfo(idx);
      const hour = ri.hour + ri.minute / 60;
      for (const a of agents) {
        a.wanderT = a.rnd() * 3;
        if (!isAwake(a, hour)) { placeAt(a, a.home); a.sleeping = true; a.activity = 'sleeping'; continue; }
        a.sleeping = false;
        let spot;
        if (a.lastAction) spot = destinationFor(a, a.lastAction, true);
        else spot = world.randomSpotNear(a.home.x, a.home.y + 1, 4, a.rnd);
        placeAt(a, spot || a.home);
        a.activity = a.lastAction ? 'hanging around' : 'idle';
      }
    }
    startRound(idx);
  }
  function placeAt(a, t) { a.x = t.x * TILE + 8 + a.offX; a.y = t.y * TILE + 12 + a.offY; a.path = null; a.moving = false; }

  // ------------------------------------------------------------ simulation tick
  function simTick(dt) {
    gameTime += dt;
    roundT += dt;
    while (schedPtr < schedule.length && schedule[schedPtr].t <= roundT) {
      const e = schedule[schedPtr++];
      const a = agentById.get(e.action.agent_id);
      if (!a) { e.done = true; continue; }
      e.queued = true; a.queue.push(e);
    }
    if (hype && gameTime > hype.until) hype = null;
    const hour = clockHour();
    for (const a of agents) updateAgent(a, dt, hour);
    if (roundT >= ROUND_SECONDS) endRound();
  }
  function updateAgent(a, dt, hour) {
    if (a.moodFlash) a.moodFlash = Math.abs(a.moodFlash) < dt ? 0 : a.moodFlash - Math.sign(a.moodFlash) * dt;
    if (a.task) {
      const tk = a.task; tk.el += dt;
      if (tk.phase === 'walk') {
        if (a.moving) stepAgent(a, dt);
        if (!a.moving || tk.el >= tk.budget) { perform(a, tk.entry); tk.phase = 'linger'; tk.linger = a.queue.length ? 0.15 : 0.9; }
      } else {
        if (a.moving) stepAgent(a, dt);
        tk.linger -= dt;
        if (tk.linger <= 0) a.task = null;
      }
    }
    if (!a.task && a.queue.length) { startTask(a, a.queue.shift()); return; }
    if (a.task) return;
    // idle life
    if (a.moving) { stepAgent(a, dt); if (!a.moving && a.goingHome) { a.sleeping = true; a.goingHome = false; a.activity = 'sleeping'; } return; }
    const awake = isAwake(a, hour);
    if (!awake) {
      if (a.sleeping) return;
      const t = tileOf(a);
      if (t.x === a.home.x && t.y === a.home.y) { a.sleeping = true; a.activity = 'sleeping'; return; }
      if (pathBudget <= 0) return;
      pathBudget--;
      a.goingHome = true; a.activity = 'heading home to sleep';
      if (!setPath(a, a.home, 1.3)) { placeAt(a, a.home); a.sleeping = true; a.goingHome = false; }
      return;
    }
    if (a.sleeping) { a.sleeping = false; placeAt(a, a.home); a.activity = 'just woke up'; a.wanderT = 0.5 + a.rnd() * 2; a.bubble = { icon: getIcon('coffee'), layout: null, t: 0, life: 1.5 }; }
    a.wanderT -= dt;
    if (a.wanderT > 0 || pathBudget <= 0) return;
    pathBudget--;
    a.wanderT = 2.5 + a.rnd() * 5;
    const P = world.places, r = a.rnd();
    let dest;
    if (hype && r < 0.35) { dest = pickSpot(P.plaza.boardSpots, a.rnd); a.place = 'plaza'; a.activity = 'joining the crowd at the Plaza'; }
    else if (r < 0.62) { const t = tileOf(a); dest = world.randomSpotNear(t.x, t.y, 5, a.rnd); a.activity = 'strolling'; }
    else if (r < 0.75) { dest = world.randomSpotNear(a.home.x, a.home.y + 1, 4, a.rnd); a.activity = 'pottering around home'; }
    else { const k = ['park', 'cafe', 'plaza', 'park'][Math.floor(a.rnd() * 4)]; dest = pickSpot(P[k].spots, a.rnd); a.place = k; a.activity = `wandering to the ${PLACE_NAME[k]}`; }
    if (dest) setPath(a, dest, 0.55 + a.rnd() * 0.25);
  }

  // ------------------------------------------------------------ camera & input
  const zMin = () => Math.max(1, Math.round(dpr));
  const zMax = () => Math.max(zMin() + 3, Math.round(6 * dpr));
  function clampCam() {
    if (!world) return;
    const vw = cw / cam.z, vh = ch / cam.z;
    cam.x = world.pxW <= vw ? world.pxW / 2 : clamp(cam.x, vw / 2, world.pxW - vw / 2);
    cam.y = world.pxH <= vh ? world.pxH / 2 : clamp(cam.y, vh / 2, world.pxH - vh / 2);
  }
  const offs = () => ({ ox: Math.round(cw / 2 - cam.x * cam.z), oy: Math.round(ch / 2 - cam.y * cam.z) });
  function screenToWorld(px, py) { const { ox, oy } = offs(); return { x: (px - ox) / cam.z, y: (py - oy) / cam.z }; }
  function zoomAt(newZ, px, py) {
    newZ = clamp(Math.round(newZ), zMin(), zMax());
    if (newZ === cam.z) return;
    const w = screenToWorld(px, py);
    cam.z = newZ;
    cam.x = w.x - (px - cw / 2) / cam.z; cam.y = w.y - (py - ch / 2) / cam.z;
    clampCam();
  }
  function pickAgent(wx, wy) {
    let best = null, by = -Infinity;
    for (const a of agents) {
      if (a.sleeping) continue;
      if (wx >= a.x - 7 && wx <= a.x + 7 && wy >= a.y - 20 && wy <= a.y + 3 && a.y > by) { best = a; by = a.y; }
    }
    return best;
  }
  const pointers = new Map();
  let drag = null, pinch = null;
  const evPos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / Math.max(1, r.width)), y: (e.clientY - r.top) * (canvas.height / Math.max(1, r.height)) }; };
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = evPos(e); pointers.set(e.pointerId, p);
    if (pointers.size === 1) drag = { sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved: false };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; }
  });
  canvas.addEventListener('pointermove', e => {
    const p = evPos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (d / pinch.d > 1.3) { zoomAt(cam.z + 1, mx, my); pinch.d = d; } else if (d / pinch.d < 0.77) { zoomAt(cam.z - 1, mx, my); pinch.d = d; }
      return;
    }
    if (drag) {
      const dx = p.x - drag.lx, dy = p.y - drag.ly;
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 5 * dpr) drag.moved = true;
      if (drag.moved) { cam.x -= dx / cam.z; cam.y -= dy / cam.z; cam.tx = null; followId = null; clampCam(); canvas.style.cursor = 'grabbing'; }
      drag.lx = p.x; drag.ly = p.y;
      return;
    }
    const w = screenToWorld(p.x, p.y);
    const h = pickAgent(w.x, w.y);
    hovered = h ? h.id : null;
    canvas.style.cursor = h ? 'pointer' : 'grab';
  });
  const endPointer = e => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && p && e.type === 'pointerup') {
      const w = screenToWorld(p.x, p.y);
      const h = pickAgent(w.x, w.y);
      select(h ? h.id : null, { fromCanvas: true });
    }
    if (pointers.size === 0) { drag = null; canvas.style.cursor = hovered != null ? 'pointer' : 'grab'; }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) hovered = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const p = evPos(e);
    zoomAt(cam.z + (e.deltaY < 0 ? 1 : -1), p.x, p.y);
  }, { passive: false });
  canvas.addEventListener('dblclick', e => {
    const p = evPos(e); const w = screenToWorld(p.x, p.y); const h = pickAgent(w.x, w.y);
    if (h) { followCamera(h.id); }
  });
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';

  function resize() {
    dpr = Math.max(1, Math.round((window.devicePixelRatio || 1) * 4) / 4);
    const r = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    cw = canvas.width; ch = canvas.height;
    cam.z = clamp(cam.z, zMin(), zMax());
    clampCam();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container); else window.addEventListener('resize', resize);

  // ------------------------------------------------------------ rendering
  const ringCache = new Map();
  function ring(color) {
    if (ringCache.has(color)) return ringCache.get(color);
    const [c, g] = makeCanvas(14, 6);
    const rows = [[3, 8], [1, 12], [0, 14], [1, 12], [3, 8]];
    g.fillStyle = 'rgba(20,30,20,0.28)'; rows.forEach(([x, w], y) => g.fillRect(x, y, w, 1));
    g.fillStyle = color;
    g.fillRect(3, 0, 8, 1); g.fillRect(3, 4, 8, 1);
    g.fillRect(1, 1, 2, 1); g.fillRect(11, 1, 2, 1); g.fillRect(1, 3, 2, 1); g.fillRect(11, 3, 2, 1); g.fillRect(0, 2, 1, 1); g.fillRect(13, 2, 1, 1);
    ringCache.set(color, c);
    return c;
  }
  const moodColor = m => m > 0.35 ? '#5fd16a' : m > 0.1 ? '#b5e05a' : m < -0.35 ? '#ef5350' : m < -0.1 ? '#f2a65a' : '#f5d06b';
  const PAPER = ['#fffdf2', '#ffe9a8', '#d6f0ff', '#ffd6e6', '#d9f5d0', '#efe0ff'];

  function drawBoardPapers(o) {
    const n = Math.min(board.twitter, 14);
    const bx = o.x + 5, by = o.y + 12;
    for (let i = 0; i < n; i++) {
      const col = i % 5, row = Math.floor(i / 5) % 3;
      const x = bx + col * 5 + (i >= 15 ? 2 : 0), y = by + row * 6 + ((i * 7) % 3) - 1;
      ctx.fillStyle = PAPER[i % PAPER.length]; ctx.fillRect(x, y, 5, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x, y + 4, 5, 1);
      ctx.fillStyle = '#e8423a'; ctx.fillRect(x + 2, y, 1, 1);
    }
  }
  function drawFountainFx(o) {
    const cx = o.x + 33, top = o.y + 6;
    for (let i = 0; i < 10; i++) {
      const ph = (realTime * 1.4 + i / 10) % 1;
      const side = i % 2 ? 1 : -1;
      const x = cx + side * (2 + ph * 9) * (0.6 + (i % 3) * 0.2), y = top + 12 + ph * 6 + ph * ph * 10 - Math.sin(ph * Math.PI) * 8;
      ctx.fillStyle = ph < 0.5 ? '#e6f7ff' : '#a9dcf5'; ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
    }
    const w = (Math.sin(realTime * 3) + 1) * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(o.x + 16 + Math.round(w * 6), o.y + 40, 4, 1); ctx.fillRect(o.x + 40 - Math.round(w * 5), o.y + 45, 3, 1);
  }

  function drawAgentSprite(a) {
    const sp = a.sprite;
    let frame = 0;
    if (a.moving) { const ph = Math.floor(a.walkPhase) % 4; frame = ph === 1 ? 1 : ph === 3 ? 2 : 0; }
    let hopY = 0;
    if (festival && !a.moving && inFestival(a)) hopY = -Math.round(Math.abs(Math.sin(realTime * 7 + a.hop)) * 3);
    const x = Math.round(a.x), y = Math.round(a.y);
    ctx.drawImage(ring(a.stance), x - 7, y - 3);
    if (selected === a.id) {
      const pulse = (Math.sin(realTime * 6) + 1) * 0.5;
      ctx.fillStyle = `rgba(255,209,102,${0.5 + pulse * 0.5})`;
      ctx.fillRect(x - 8, y - 1, 1, 2); ctx.fillRect(x + 7, y - 1, 1, 2); ctx.fillRect(x - 5, y + 3, 10, 1); ctx.fillRect(x - 5, y - 4, 10, 1);
    }
    ctx.drawImage(sp.sheet, frame * sp.fw, a.dir * sp.fh, sp.fw, sp.fh, x - 6, y - 19 + hopY + (a.moving && frame === 0 ? -1 : 0), sp.fw, sp.fh);
  }
  const inFestival = a => { const c = world.places.plaza.center; return Math.abs(a.x - c.x) < 14 * TILE && Math.abs(a.y - c.y) < 9 * TILE; };

  function render() {
    if (!cw || !ch) resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#3a7fb5'; ctx.fillRect(0, 0, cw, ch);
    if (!world) { drawLoading(); return; }
    // camera follow / glide
    if (followId != null && agentById.has(followId)) { const a = agentById.get(followId); cam.x = lerp(cam.x, a.x, 0.12); cam.y = lerp(cam.y, a.y - 8, 0.12); clampCam(); }
    else if (cam.tx != null) { cam.x = lerp(cam.x, cam.tx, 0.14); cam.y = lerp(cam.y, cam.ty, 0.14); if (Math.hypot(cam.x - cam.tx, cam.y - cam.ty) < 1) cam.tx = null; clampCam(); }
    const z = cam.z, { ox, oy } = offs();
    const vx0 = -ox / z, vy0 = -oy / z, vx1 = vx0 + cw / z, vy1 = vy0 + ch / z;
    ctx.setTransform(z, 0, 0, z, ox, oy);
    // ground
    const sx = Math.max(0, Math.floor(vx0)), sy = Math.max(0, Math.floor(vy0));
    const sw = Math.min(world.pxW, Math.ceil(vx1) + 1) - sx, sh = Math.min(world.pxH, Math.ceil(vy1) + 1) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(world.ground, sx, sy, sw, sh, sx, sy, sw, sh);
    // water sparkles
    ctx.fillStyle = 'rgba(235,250,255,0.85)';
    const W = world.W;
    for (const i of world.waterTiles) {
      const tx = (i % W) * TILE, ty = ((i / W) | 0) * TILE;
      if (tx < vx0 - 16 || tx > vx1 || ty < vy0 - 16 || ty > vy1) continue;
      const ph = (realTime * 0.6 + (i % 97) / 97) % 1;
      if (ph < 0.35) { const k = Math.round(ph * 8); ctx.fillRect(tx + 4 + (i % 7), ty + 6 + (i % 5), 1 + (k & 1) * 2, 1); }
    }
    // festival bunting under objects? drawn after for visibility
    // y-sorted objects + agents
    const vis = [];
    for (const a of agents) if (!a.sleeping && a.x > vx0 - 16 && a.x < vx1 + 16 && a.y > vy0 - 8 && a.y < vy1 + 30) vis.push(a);
    vis.sort((p, q) => p.y - q.y);
    const objs = world.objects;
    let ai = 0;
    for (let k = 0; k < objs.length; k++) {
      const o = objs[k];
      while (ai < vis.length && vis[ai].y + 2 < o.baseY) drawAgentSprite(vis[ai++]);
      if (o.x > vx1 || o.y > vy1 || o.x + o.img.width < vx0 || o.y + o.img.height < vy0) continue;
      ctx.drawImage(o.img, o.x, o.y);
      if (o.kind === 'board') drawBoardPapers(o);
      else if (o.kind === 'fountain') drawFountainFx(o);
    }
    while (ai < vis.length) drawAgentSprite(vis[ai++]);

    drawWorldEffects(z);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawLighting(z, ox, oy);
    drawWeather();
    drawScreenUI(z, ox, oy, vx0, vy0, vx1, vy1);
  }

  function drawLoading() {
    ctx.fillStyle = '#fff8ec'; ctx.font = `${Math.round(14 * dpr)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Building Swarm Town…', cw / 2, ch / 2); ctx.textAlign = 'left';
  }

  function drawWorldEffects(z) {
    // follow lines for selected agent
    if (selected != null && agentById.has(selected)) {
      const s = agentById.get(selected);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -realTime * 8;
      for (const e of followEdges) {
        let o = null, col = null;
        if (e.from === s.id) { o = agentById.get(e.to); col = 'rgba(95,209,106,0.75)'; }
        else if (e.to === s.id) { o = agentById.get(e.from); col = 'rgba(255,143,176,0.75)'; }
        if (!o) continue;
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(s.x, s.y - 8); ctx.lineTo(o.x, o.y - 8); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // festival bunting + confetti
    if (festival) {
      const P = world.core, k = festival.alpha;
      ctx.globalAlpha = k;
      const lines = [[[P.x0 + 11.5, P.y0 + 9.2], [P.x0 + 30.5, P.y0 + 9.2]], [[P.x0 + 11.5, P.y0 + 20.2], [P.x0 + 30.5, P.y0 + 20.2]], [[P.x0 + 11.5, P.y0 + 9.2], [P.x0 + 30.5, P.y0 + 20.2]], [[P.x0 + 30.5, P.y0 + 9.2], [P.x0 + 11.5, P.y0 + 20.2]], [[P.x0 + 12.5, P.y0 + 6.2], [P.x0 + 29.5, P.y0 + 6.2]]];
      const cols = ['#e2574c', '#f5d06b', '#5b9bd5', '#7cc47a', '#e57fb2', '#fff3e0'];
      for (const [[x0, y0], [x1, y1]] of lines) {
        const ax = x0 * TILE, ay = y0 * TILE, bx = x1 * TILE, by = y1 * TILE;
        const len = Math.hypot(bx - ax, by - ay), n = Math.floor(len / 9);
        ctx.fillStyle = '#5a4038';
        for (let i = 0; i <= n * 3; i++) { const t = i / (n * 3); const x = lerp(ax, bx, t), y = lerp(ay, by, t) + Math.sin(t * Math.PI) * 14; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); }
        for (let i = 1; i < n; i++) {
          const t = i / n, x = Math.round(lerp(ax, bx, t)), y = Math.round(lerp(ay, by, t) + Math.sin(t * Math.PI) * 14);
          const sway = Math.round(Math.sin(realTime * 3 + i) * 1);
          ctx.fillStyle = cols[i % cols.length];
          ctx.fillRect(x - 2, y + 1, 5, 2); ctx.fillRect(x - 1 + sway, y + 3, 3, 2); ctx.fillRect(x + sway, y + 5, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
      for (const p of particles) { ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.w, p.h); }
    }
    // rumor ripples
    if (rumor) {
      const c = world.places.plaza.center;
      for (let k = 0; k < 3; k++) {
        const t = rumor.t - k * 0.7; if (t <= 0) continue;
        const rad = t * TILE * 16; const al = clamp(1 - t / 5, 0, 1);
        if (al <= 0) continue;
        ctx.strokeStyle = `rgba(190,120,255,${al * 0.8})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, rad, rad * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${al * 0.5})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, rad - 3, (rad - 3) * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // heart/follow lines
    for (const e of effects) {
      if (e.type === 'heart') {
        const t = clamp(e.t / e.dur, 0, 1);
        const ax = e.from.x, ay = e.from.y - 10, bx = e.to.x, by = e.to.y - 10;
        const al = e.t > e.dur ? clamp(1 - (e.t - e.dur) / 1.5, 0, 1) : 1;
        ctx.strokeStyle = `rgba(255,120,160,${0.7 * al})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - 24, bx, by); ctx.stroke();
        if (e.t <= e.dur) {
          const u = 1 - t, mx = (ax + bx) / 2, my = Math.min(ay, by) - 24;
          const x = u * u * ax + 2 * u * t * mx + t * t * bx, y = u * u * ay + 2 * u * t * my + t * t * by;
          const ic = getIcon('heart'); ctx.drawImage(ic, Math.round(x - ic.width / 2), Math.round(y - ic.height / 2));
        }
      } else if (e.type === 'pop') {
        const t = e.t / e.dur, ic = e.icon;
        ctx.globalAlpha = clamp(1.6 - t * 1.6, 0, 1);
        ctx.drawImage(ic, Math.round(e.x - ic.width / 2), Math.round(e.y - t * 10 - ic.height));
        ctx.globalAlpha = 1;
      }
    }
  }

  function darknessAt(h) {
    if (h >= 7 && h < 17.5) return 0;
    if (h >= 17.5 && h < 20.5) return (h - 17.5) / 3;
    if (h >= 20.5 || h < 5) return 1;
    return 1 - (h - 5) / 2;
  }
  function drawLighting(z, ox, oy) {
    const h = clockHour();
    const dk = darknessAt(h);
    const warm = Math.max(0, 1 - Math.abs(h - 18.4) / 1.6) * 0.8 + Math.max(0, 1 - Math.abs(h - 6.3) / 1.0) * 0.5;
    let r = lerp(255, 78, dk), g = lerp(255, 88, dk), b = lerp(255, 158, dk);
    r *= lerp(1, 1, warm); g *= lerp(1, 0.82, warm); b *= lerp(1, 0.66, warm);
    if (weather) { const k = weather.alpha * (weather.kind === 'snow' ? 0.08 : 0.18); r *= 1 - k; g *= 1 - k; b *= 1 - k * 0.6; }
    if (dk > 0.001 || warm > 0.01 || weather) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (dk > 0.15) {
      const a = clamp((dk - 0.15) / 0.6, 0, 1);
      // lit windows
      ctx.fillStyle = `rgba(255,214,120,${0.85 * a})`;
      const lit = [];
      for (const o of world.objects) {
        if (!o.windows) continue;
        if (o.kind === 'house') { const ow = agentById.get(o.owner); if (!ow || !(ow.sleeping ? (hashStr(o.owner + ':' + Math.floor(h)) % 3 === 0) : true)) continue; }
        for (const w of o.windows) {
          const x = w.x * z + ox, y = w.y * z + oy;
          if (x > cw || y > ch || x + w.w * z < 0 || y + w.h * z < 0) continue;
          ctx.fillRect(x, y, w.w * z, w.h * z); lit.push([x + w.w * z / 2, y + w.h * z / 2, Math.max(w.w, w.h)]);
        }
      }
      const glow = getGlow();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * a;
      for (const [x, y, s] of lit) { const S = s * z * 2.2; ctx.drawImage(glow, x - S / 2, y - S / 2, S, S); }
      ctx.globalAlpha = 0.75 * a;
      for (const L of world.lamps) {
        const x = L.x * z + ox, y = L.y * z + oy, S = 70 * z;
        if (x < -S || y < -S || x > cw + S || y > ch + S) continue;
        ctx.drawImage(glow, x - S / 2, y - S / 2, S, S);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawWeather() {
    if (!weather) return;
    const al = weather.alpha;
    if (weather.kind === 'rain') {
      ctx.strokeStyle = `rgba(190,215,255,${0.55 * al})`; ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      for (const p of weather.drops) { const x = p.x * cw, y = p.y * ch; ctx.moveTo(x, y); ctx.lineTo(x - 3 * dpr, y + p.l * dpr); }
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(255,255,255,${0.12 * al})`; ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = `rgba(255,255,255,${0.9 * al})`;
      for (const p of weather.drops) { const s = Math.round(p.s * dpr); ctx.fillRect(Math.round(p.x * cw), Math.round(p.y * ch), s, s); }
    }
  }

  function drawScreenUI(z, ox, oy, vx0, vy0, vx1, vy1) {
    const S = (wx, wy) => [Math.round(wx * z + ox), Math.round(wy * z + oy)];
    const uiScale = dpr;
    ctx.save();
    ctx.scale(uiScale, uiScale);
    const k = 1 / uiScale;
    const zcss = z / dpr;
    // labels
    ctx.font = TAG_FONT; ctx.textBaseline = 'top';
    for (const L of world.labels) {
      if (L.x < vx0 - 100 || L.x > vx1 + 100 || L.y < vy0 - 20 || L.y > vy1 + 20) continue;
      if (L.kind === 'district' && zcss < 2) continue;
      const [x, y] = S(L.x, L.y);
      if (L.kind === 'place') {
        ctx.font = '800 12px system-ui, sans-serif';
        const tw = ctx.measureText(L.text).width;
        ctx.fillStyle = 'rgba(43,34,51,0.55)'; ctx.fillText(L.text, x * k - tw / 2 + 1, y * k + 1);
        ctx.fillStyle = 'rgba(255,248,236,0.92)'; ctx.fillText(L.text, x * k - tw / 2, y * k);
        ctx.font = TAG_FONT;
      } else {
        let text = L.text;
        if (L.text === 'Forum Hall') text += `  ·  ${board.reddit} threads`;
        drawTag(ctx, x * k, y * k - 2, text, L.kind === 'district' ? L.color : (L.text === 'Forum Hall' ? '#ff8a3a' : '#f2a65a'), { bg: 'rgba(43,34,51,0.78)' });
      }
    }
    // noticeboard count badge
    {
      const o = world.board; const [x, y] = S(o.x + o.img.width / 2, o.y);
      drawTag(ctx, x * k, y * k - 2, `Noticeboard · ${board.twitter} posts`, '#4fb3e8', { bg: 'rgba(43,34,51,0.85)' });
      if (hype) {
        const fi = getIcon('fire');
        const bob = Math.round(Math.sin(realTime * 5) * 2);
        ctx.drawImage(fi, x * k - fi.width, y * k - 40 + bob, fi.width * 2, fi.height * 2);
        if (hype.content) {
          const lay = hype.layout || (hype.layout = wrapText(ctx, hype.content, 180, 2));
          drawBubble(ctx, x * k, y * k - 44, lay, getIcon('fire'), { accent: '#f0553a', bg: '#fff4e6' });
        }
      }
    }
    // zzz over sleeping houses
    const zi = getIcon('zzz');
    for (const a of agents) {
      if (!a.sleeping || !a.homeObj) continue;
      const o = a.homeObj; if (o.x > vx1 || o.x + 50 < vx0 || o.y > vy1 || o.y + 60 < vy0) continue;
      const ph = (realTime * 0.5 + a.i * 0.37) % 1;
      const [x, y] = S(o.x + 30 + ph * 8, o.y + 10 - ph * 14);
      ctx.globalAlpha = Math.sin(ph * Math.PI);
      const s = zcss >= 2 ? 2 : 1;
      ctx.drawImage(zi, x * k, y * k, zi.width * s, zi.height * s);
      ctx.globalAlpha = 1;
      if (selected === a.id) { const [dx, dy] = S(a.home.x * TILE + 8, a.home.y * TILE + 4); drawTag(ctx, dx * k, dy * k - 4, a.d.name + ' (asleep)', a.stance, { selected: true }); }
    }
    // agents: mood pips, tags, bubbles
    const showAllTags = zcss >= 4;
    const list = agents.filter(a => !a.sleeping && a.x > vx0 - 40 && a.x < vx1 + 40 && a.y > vy0 - 20 && a.y < vy1 + 60).sort((p, q) => p.y - q.y);
    const sel = [];
    for (const a of list) {
      const [hx, hy] = S(a.x, a.y - 20);
      const X = hx * k, Y = hy * k;
      if (zcss >= 2) {
        const c = moodColor(a.mood);
        ctx.fillStyle = OUTLINE; ctx.fillRect(Math.round(X + 5 * zcss - 1), Math.round(Y + 1), 6, 6);
        ctx.fillStyle = c; ctx.fillRect(Math.round(X + 5 * zcss), Math.round(Y + 2), 4, 4);
        if (a.moodFlash) { ctx.fillStyle = a.moodFlash > 0 ? '#5fd16a' : '#ef5350'; const up = a.moodFlash > 0; const bx = Math.round(X + 5 * zcss + 6), by = Math.round(Y + 1); ctx.fillRect(bx + 1, by + (up ? 0 : 3), 1, 1); ctx.fillRect(bx, by + (up ? 1 : 2), 3, 1); ctx.fillRect(bx + 1, by + 2 - (up ? 0 : 1), 1, 2); }
      }
      if (a.alertT > 0) { const ic = getIcon('exclaim'); ctx.drawImage(ic, Math.round(X - ic.width), Math.round(Y - 22), ic.width * 2, ic.height * 2); }
      if (a.id === selected || a.id === hovered || a.id === followId) { sel.push(a); continue; }
      let top = Y - 3;
      if (showAllTags) { const r = drawTag(ctx, X, top, a.d.name, a.stance); top = r.y - 1; }
      if (a.bubble) drawAgentBubble(a, X, top);
    }
    for (const a of sel) {
      const [hx, hy] = S(a.x, a.y - 20);
      const X = hx * k, Y = hy * k;
      const r = drawTag(ctx, X, Y - 3, a.d.name, a.stance, { selected: a.id === selected });
      if (a.bubble) drawAgentBubble(a, X, r.y - 1);
      if (a.id === selected) {
        const bob = Math.round(Math.sin(realTime * 5) * 2);
        ctx.fillStyle = '#ffd166'; const ax = Math.round(X), ay = Math.round(r.y - 8 + bob - (a.bubble ? 200 : 0));
        if (!a.bubble) { ctx.fillRect(ax - 4, ay, 9, 2); ctx.fillRect(ax - 3, ay + 2, 7, 1); ctx.fillRect(ax - 2, ay + 3, 5, 1); ctx.fillRect(ax - 1, ay + 4, 3, 1); }
      }
    }
    // banner
    if (banner) {
      const al = clamp(Math.min(banner.t * 3, (banner.dur - banner.t) * 1.5), 0, 1);
      ctx.globalAlpha = al;
      const W = cw / uiScale;
      ctx.font = '700 13px system-ui, sans-serif';
      const text = banner.text;
      const tw = Math.min(ctx.measureText(text).width, W - 80);
      const bw = tw + 46, bh = 30, bx = Math.round(W / 2 - bw / 2), by = 12;
      ctx.fillStyle = OUTLINE; ctx.fillRect(bx - 2, by, bw + 4, bh); ctx.fillRect(bx, by - 2, bw, bh + 4);
      ctx.fillStyle = banner.color; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(bx, by, bw, 3);
      const ic = getIcon(banner.icon); ctx.drawImage(ic, bx + 8, by + 15 - ic.height, ic.width * 2, ic.height * 2);
      ctx.fillStyle = '#fffaf0'; ctx.textBaseline = 'middle';
      let t = text; while (ctx.measureText(t).width > tw && t.length > 3) t = t.slice(0, -2);
      if (t !== text) t = t.slice(0, -1) + '…';
      ctx.fillText(t, bx + 34, by + bh / 2 + 1);
      ctx.globalAlpha = 1; ctx.textBaseline = 'top';
    }
    ctx.restore();
  }
  function drawAgentBubble(a, X, top) {
    const b = a.bubble;
    const fade = clamp(Math.min(b.t * 6, (b.life - b.t) * 3), 0, 1);
    ctx.globalAlpha = fade;
    const zc = cam.z / dpr;
    const lay = zc < 2 && b.layout ? { lines: [b.layout.lines[0] + (b.layout.lines.length > 1 && !b.layout.lines[0].endsWith('…') ? '…' : '')], w: b.layout.w } : b.layout;
    drawBubble(ctx, X, top + 4, lay, b.icon, { accent: b.accent });
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ ambient (real-time) updates
  function ambientTick(dt) {
    realTime += dt;
    const bubbleDt = playing ? dt * Math.max(1, Math.sqrt(speed)) : 0;
    for (const a of agents) {
      if (a.bubble) { a.bubble.t += bubbleDt; if (a.bubble.t >= a.bubble.life) a.bubble = null; }
      if (a.alertT > 0) a.alertT -= dt;
    }
    if (playing) {
      const edt = dt * Math.max(1, Math.sqrt(speed));
      for (const e of effects) e.t += edt;
      effects = effects.filter(e => e.t < e.dur + (e.type === 'heart' ? 1.5 : 0));
    }
    if (weather) {
      weather.t += dt;
      weather.alpha = clamp(Math.min(weather.t / 1.5, (weather.dur - weather.t) / 2), 0, 1);
      for (const p of weather.drops) {
        if (weather.kind === 'rain') { p.y += dt * p.v; p.x -= dt * p.v * 0.12 * (ch / cw); }
        else { p.y += dt * p.v * 0.12; p.x += Math.sin(realTime * 1.5 + p.ph) * dt * 0.01; }
        if (p.y > 1.02) { p.y = -0.03; p.x = Math.random() * 1.1; }
        if (p.x < -0.02) p.x += 1.04; if (p.x > 1.04) p.x -= 1.04;
      }
      if (weather.t >= weather.dur) weather = null;
    }
    if (festival) {
      festival.t += dt;
      festival.alpha = clamp(Math.min(festival.t / 0.8, (festival.dur - festival.t) / 2), 0, 1);
      const c = world.places.plaza.center;
      if (festival.t < festival.dur - 2) for (let i = 0; i < 3; i++) particles.push({ x: c.x + (Math.random() - 0.5) * 18 * TILE, y: c.y - 7 * TILE + Math.random() * 3 * TILE, vx: (Math.random() - 0.5) * 20, vy: 10 + Math.random() * 20, life: 3 + Math.random() * 2, c: ['#e2574c', '#f5d06b', '#5b9bd5', '#7cc47a', '#e57fb2', '#ffffff'][Math.floor(Math.random() * 6)], w: Math.random() < 0.5 ? 2 : 1, h: Math.random() < 0.5 ? 1 : 2 });
      for (const p of particles) { p.x += (p.vx + Math.sin(realTime * 4 + p.y) * 12) * dt; p.y += p.vy * dt; p.life -= dt; }
      particles = particles.filter(p => p.life > 0);
      if (festival.t >= festival.dur) { festival = null; particles = []; }
    }
    if (rumor) {
      const prev = rumor.t * TILE * 16; rumor.t += dt; const cur = rumor.t * TILE * 16;
      const c = world.places.plaza.center;
      for (const a of agents) { if (a.sleeping) continue; const d = Math.hypot(a.x - c.x, (a.y - c.y) / 0.8); if (d >= prev && d < cur) { a.alertT = 1.6; } }
      if (rumor.t > 6) rumor = null;
    }
    if (banner) { banner.t += dt; if (banner.t >= banner.dur) banner = null; }
  }

  // ------------------------------------------------------------ main loop
  let last = performance.now(), raf = 0, fpsAcc = 0, fpsN = 0, fps = 60;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
    fpsAcc += dt; fpsN++; if (fpsAcc >= 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    if (world) {
      pathBudget = 10;
      if (playing) {
        let g = dt * speed;
        while (g > 0) { const s = Math.min(g, 0.1); simTick(s); g -= s; if (!playing) break; }
      }
      ambientTick(dt);
    }
    render();
  }
  resize();
  raf = requestAnimationFrame(frame);

  // ------------------------------------------------------------ public API
  function load(d) {
    if (!d || !Array.isArray(d.agents)) throw new Error('Invalid town data');
    const prev = data;
    const sameTown = prev && world && prev.meta && d.meta && prev.meta.simulation_id === d.meta.simulation_id
      && prev.agents.length === d.agents.length && prev.agents.every((a, i) => a.id === d.agents[i].id && a.type === d.agents[i].type);
    data = d;
    data.rounds = Array.isArray(d.rounds) ? d.rounds : [];
    data.posts = d.posts || {}; data.follows = d.follows || [];
    data.meta = d.meta || {};
    minutesPerRound = +data.meta.minutes_per_round || 60;
    rounds = [...data.rounds].sort((a, b) => a.round - b.round);
    const likes = Object.values(data.posts).map(p => +p.likes || 0).sort((a, b) => a - b);
    hotThreshold = Math.max(3, likes.length ? likes[Math.floor(likes.length * 0.85)] : 3);
    let keep = null;
    if (sameTown) {
      keep = new Map(agents.map(a => [a.id, { x: a.x, y: a.y, sleeping: a.sleeping, dir: a.dir }]));
    } else {
      clearCharacterCache();
      world = buildWorld(data);
    }
    agents = data.agents.map((a, i) => makeAgent(a, i));
    agentById = new Map(agents.map(a => [a.id, a]));
    selected = null; hovered = null; followId = null; hype = null; effects = []; atEnd = false;
    playing = false;
    if (!keep) {
      cam.z = clamp(Math.round(2 * dpr), zMin(), zMax());
      cam.x = world.places.plaza.center.x; cam.y = world.places.plaza.center.y - 2 * TILE; cam.tx = null;
      clampCam();
    }
    emit('data-loaded', { data });
    if (keep) {
      for (const a of agents) { const k = keep.get(a.id); if (k) { a.x = k.x; a.y = k.y; a.sleeping = k.sleeping; a.dir = k.dir; } }
      seek(rounds.length ? rounds[0].round : 0, { teleport: false });
    } else seek(rounds.length ? rounds[0].round : 0);
    emitState();
  }
  function play() {
    if (!data) return;
    if (atEnd) seek(rounds[0].round);
    playing = true; last = performance.now(); emitState();
  }
  function pause() { playing = false; emitState(); }
  function setSpeed(x) {
    x = Number(x); if (!isFinite(x) || x <= 0) return;
    speed = clamp(x, 0.25, 16); emitState();
  }
  function select(id, opts = {}) {
    const nid = id == null || !agentById.has(id) ? null : id;
    const changed = nid !== selected;
    selected = nid;
    if (nid == null && followId != null) followId = null;
    if (nid != null && !opts.fromCanvas) {
      const a = agentById.get(nid);
      const wx = a.sleeping ? a.home.x * TILE + 8 : a.x, wy = a.sleeping ? a.home.y * TILE : a.y;
      const vw = cw / cam.z, vh = ch / cam.z;
      if (Math.abs(wx - cam.x) > vw * 0.35 || Math.abs(wy - cam.y) > vh * 0.35) { cam.tx = wx; cam.ty = wy; }
    }
    if (changed) emit('agent-selected', { agentId: nid });
  }
  function followCamera(id) {
    followId = id == null || !agentById.has(id) ? null : id;
    if (followId != null) { cam.tx = null; if (selected !== followId) select(followId, { fromCanvas: true }); if (cam.z < zMin() + 1) cam.z = zMin() + 1; }
  }
  function godEvent(ev = {}) {
    const kind = ev.kind || 'rumor', text = String(ev.text || '').trim();
    if (!world) return;
    if (kind === 'weather') {
      const snow = /snow|blizzard|cold|winter|frost|freez|ice|neige|雪/i.test(text);
      const n = snow ? 260 : 380;
      weather = { kind: snow ? 'snow' : 'rain', t: 0, dur: 30, alpha: 0, drops: Array.from({ length: n }, () => ({ x: Math.random() * 1.04, y: Math.random(), v: 0.9 + Math.random() * 0.8, l: 8 + Math.random() * 10, s: Math.random() < 0.3 ? 3 : 2, ph: Math.random() * 6 })) };
      banner = { text: `GOD · ${snow ? 'Snow' : 'Rain'}${text ? ': ' + text : ''}`, t: 0, dur: 6, color: snow ? '#6c8aae' : '#4a6fa5', icon: snow ? 'star' : 'speech' };
    } else if (kind === 'festival') {
      festival = { t: 0, dur: 40, alpha: 0 };
      banner = { text: `GOD · Festival${text ? ': ' + text : ''}`, t: 0, dur: 6, color: '#c9563f', icon: 'music' };
      // gather some agents at the plaza
      for (const a of agents) if (!a.sleeping && !a.task && !a.queue.length && a.rnd() < 0.45) { setPath(a, pickSpot(world.places.plaza.spots, a.rnd), 1.4); a.wanderT = 8 + a.rnd() * 6; a.activity = 'celebrating at the festival'; }
    } else {
      rumor = { t: 0, text };
      banner = { text: `GOD · Rumor${text ? ': ' + text : ''}`, t: 0, dur: 7, color: '#7a4fb0', icon: 'exclaim' };
    }
  }
  function getAgentState(id) {
    const a = agentById.get(id); if (!a) return null;
    return {
      id: a.id, x: a.x / TILE, y: a.y / TILE, mood: a.mood, activity: a.activity, lastAction: a.lastAction,
      stats: { ...a.stats }, sleeping: a.sleeping, home: { ...a.home }, district: a.d.type,
    };
  }

  return {
    load, play, pause, setSpeed, seek, select,
    getData: () => data,
    getAgentState,
    // extras
    followCamera, godEvent,
    getState: () => ({ playing, speed, round: rounds[roundIdx] ? rounds[roundIdx].round : 0, totalRounds: totalRounds(), hour: clockHour(), fps, roundProgress: roundT / ROUND_SECONDS }),
    getWorld: () => world,
    focus(id) { const a = agentById.get(id); if (a) { cam.tx = a.x; cam.ty = a.y; } },
    setZoom(zz) { zoomAt(zz * dpr, cw / 2, ch / 2); },
    setCamera(x, y, zz) { if (zz) cam.z = clamp(Math.round(zz * dpr), zMin(), zMax()); cam.x = x * TILE; cam.y = y * TILE; cam.tx = null; followId = null; clampCam(); },
    resize,
    destroy() { cancelAnimationFrame(raf); if (ro) ro.disconnect(); },
    speeds: SPEEDS,
  };
}
