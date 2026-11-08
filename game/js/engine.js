// Swarm Town — engine.js : playback clock, agents (A* walking, tasks, sleep/wander), rendering, camera, effects.
// API: createEngine(canvas) -> { load, play, pause, setSpeed, seek, select, getData, getAgentState, ...extras }
import { emit } from './bus.js';
import { t, prettyType } from './i18n.js';
import { buildWorld } from './world.js';
import {
  TILE, getCharacter, clearCharacterCache, getIcon, ACTION_ICON, STANCE_COLORS, drawBubble, drawTag, wrapText, getGlow,
  mulberry32, hashStr, makeCanvas, UI_FONT, TAG_FONT, OUTLINE,
} from './sprites.js';
import { getColossus, COLOSSUS_FRAMES, COLOSSUS_W, makeBreachDecal, makeTent as makeCampTent, makeHerald } from './walls_sprites.js';

export const ROUND_SECONDS = 6;         // game-seconds per round at speed 1
const WALK = 3.0;                        // tiles / game-second
const MAX_MUL = 6;                       // hurry multiplier cap
const SPEEDS = [0.5, 1, 2, 4, 8];
const PLATFORM_PLACE = { twitter: 'plaza', reddit: 'forum' };
// Activities are stored as {k, v} keys so they can be translated at read time (language may change mid-play).
const ICON_ACT = { POST: 1, QUOTE: 1, COMMENT: 1, LIKE: 1, DISLIKE: 1, REPOST: 1, FOLLOW: 1, MUTE: 1, SEARCH: 1, TREND: 1, IDLE: 1 };
const A = (k, v) => ({ k, v });
let placePrefix = 'place.';
const activityText = a => (a && typeof a === 'object' ? t(a.k, a.v && a.v.place ? { ...a.v, place: t(placePrefix + a.v.place + 'The') } : a.v) : String(a || ''));
// three_walls world events: how many rounds each one stays visible
const EV_DUR = { sighting: 6, alarm: 3, breach: 4, evacuation: 5, expedition_out: 1, expedition_back: 2, shortage: 4, riot: 3, decree: 2, fire: 4 };
const EV_STYLE = {
  sighting: ['#3d4a5c', 'eye'], alarm: ['#a3332a', 'bell'], breach: ['#7a2420', 'exclaim'], evacuation: ['#9a6a2a', 'exclaim'],
  expedition_out: ['#3f5a3a', 'star'], expedition_back: ['#3f5a3a', 'star'], shortage: ['#7a5a32', 'sack'], riot: ['#b0452a', 'angry'],
  decree: ['#4a2e5a', 'scroll'], fire: ['#c0561e', 'fire'],
};

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
  // three_walls theme state
  let W3 = false;
  let wEvents = [], godWEvents = [], godSeq = 0;
  let wparticles = [], colossiNow = [], gatesClosed = false, alarmLvl = 0;
  const decalCache = new Map();
  let tentSprites = null, heraldImg = null;

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
    const ring = W3 ? (world.agentRing.get(d.id) || 'outer') : null;
    return {
      id: d.id, d, i, rnd, sprite: getCharacter(d.id, ring), home: door, homeObj: home && home.house, ring, ov: null, away: false,
      x: door.x * TILE + 8, y: door.y * TILE + 12, path: null, pi: 0, dir: 0, walkPhase: 0, moving: false, mul: 1,
      queue: [], task: null, sleeping: false, bubble: null, mood: base, base,
      stats: freshStats(), lastAction: null, activity: A('act.idle'), wanderT: rnd() * 3, offX: Math.round(rnd() * 6 - 3), offY: Math.round(rnd() * 4 - 2),
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
    if (W3) {
      if ((act.type === 'POST' || act.type === 'QUOTE') && a.ring === 'inner') { a.place = 'council'; return pickSpot(P.council.spots, a.rnd); }
      if (act.type === 'IDLE') { const k = pickSpot(world.ringPlaces[a.ring] || world.ringPlaces.outer, a.rnd); a.place = k; return pickSpot(P[k].spots, a.rnd); }
    }
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
      a.goingHome = false; a.place = 'plaza'; a.activity = A('act.joinPlaza');
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
    const budget = a.away ? 0 : a.queue.length >= 2 ? 0.15 : Math.min(2.2, remaining * 0.8);
    a.task = { entry, phase: 'walk', el: 0, budget, linger: 0 };
    if (budget > 0.2 && dest) { setPath(a, dest, 1, budget); pathBudget--; }
    else { a.path = null; a.moving = false; }
    a.activity = (a.place ? A('act.walkTo', { place: a.place }) : (act.target_agent_id != null && agentById.get(act.target_agent_id) ? A('act.headTo', { name: agentById.get(act.target_agent_id).d.name }) : A('act.move')));
  }
  function perform(a, entry, quiet = false) {
    if (entry.done) return;
    entry.done = true;
    const act = entry.action;
    applyAction(act, true);
    const tg = act.target_agent_id != null ? agentById.get(act.target_agent_id) : null;
    a.activity = A(act.type in ICON_ACT ? 'act.' + act.type : 'act.idle');
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
    if (W3 && rounds[idx]) for (const ev of allEvents()) if (ev.round === rounds[idx].round && !ev.god) fireWorldEvent(ev, true);
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
      a.path = null; a.moving = false; a.activity = A('act.idle'); a.place = null; a.goingHome = false;
      a.ov = null; a.away = false;
    }
    wparticles = [];
  }
  function seek(round, opts = {}) {
    if (!data || !rounds.length) return;
    round = Number(round);
    let idx = rounds.findIndex(r => r.round >= round);
    if (idx < 0) idx = rounds.length - 1;
    // teleport unless this is a small step (±1 round) or explicitly disabled; agents then just walk on
    const teleport = opts.teleport != null ? opts.teleport : Math.abs(idx - roundIdx) > 1;
    resetSim();
    for (let i = 0; i < idx; i++) { for (const act of rounds[i].actions || []) applyAction(act, false); driftMoods(); }
    if (teleport) {
      const ri = roundInfo(idx);
      const hour = ri.hour + ri.minute / 60;
      for (const a of agents) {
        a.wanderT = a.rnd() * 3;
        if (!isAwake(a, hour)) { placeAt(a, a.home); a.sleeping = true; a.activity = A('act.sleeping'); continue; }
        a.sleeping = false;
        let spot;
        if (a.lastAction) spot = destinationFor(a, a.lastAction, true);
        else spot = world.randomSpotNear(a.home.x, a.home.y + 1, 4, a.rnd);
        placeAt(a, spot || a.home);
        a.activity = a.lastAction ? A('act.hanging') : A('act.idle');
      }
    }
    if (W3) { if (teleport && banner && banner.sub != null) banner = null; rederiveEvents(rounds[idx] ? rounds[idx].round : 0, teleport); }
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
    if (W3 && (a.ov || a.away) && overrideTick(a, dt)) return;
    // idle life
    if (a.moving) { stepAgent(a, dt); if (!a.moving && a.goingHome) { a.sleeping = true; a.goingHome = false; a.activity = A('act.sleeping'); } return; }
    const awake = isAwake(a, hour);
    if (!awake) {
      if (a.sleeping) return;
      const t = tileOf(a);
      if (t.x === a.home.x && t.y === a.home.y) { a.sleeping = true; a.activity = A('act.sleeping'); return; }
      if (pathBudget <= 0) return;
      pathBudget--;
      a.goingHome = true; a.activity = A('act.home');
      if (!setPath(a, a.home, 1.3)) { placeAt(a, a.home); a.sleeping = true; a.goingHome = false; }
      return;
    }
    if (a.sleeping) { a.sleeping = false; placeAt(a, a.home); a.activity = A('act.woke'); a.wanderT = 0.5 + a.rnd() * 2; a.bubble = { icon: getIcon('coffee'), layout: null, t: 0, life: 1.5 }; }
    a.wanderT -= dt;
    if (a.wanderT > 0 || pathBudget <= 0) return;
    pathBudget--;
    a.wanderT = 2.5 + a.rnd() * 5;
    const P = world.places, r = a.rnd();
    let dest;
    if (hype && r < 0.35) { dest = pickSpot(P.plaza.boardSpots, a.rnd); a.place = 'plaza'; a.activity = A('act.joinPlaza'); }
    else if (r < 0.62) { const t = tileOf(a); dest = world.randomSpotNear(t.x, t.y, 5, a.rnd); a.activity = A('act.stroll'); }
    else if (r < 0.75) { dest = world.randomSpotNear(a.home.x, a.home.y + 1, 4, a.rnd); a.activity = A('act.potter'); }
    else { const k = W3 ? pickSpot(world.ringPlaces[a.ring] || world.ringPlaces.outer, a.rnd) : ['park', 'cafe', 'plaza', 'park'][Math.floor(a.rnd() * 4)]; dest = pickSpot(P[k].spots, a.rnd); a.place = k; a.activity = A('act.wander', { place: k }); }
    if (dest) setPath(a, dest, 0.55 + a.rnd() * 0.25);
  }

  // ------------------------------------------------------------ camera & input
  const zMin = () => Math.max(1, Math.round(dpr));
  const zMax = () => Math.max(zMin() + 3, Math.round(6 * dpr));
  const zFloor = () => (W3 ? zMin() / 2 : zMin());   // the walled city allows a half-scale overview
  const normZ = z => (z < zMin() ? zFloor() : clamp(Math.round(z), zMin(), zMax()));
  const stepZ = d => (d > 0 ? (cam.z < zMin() ? zMin() : cam.z + 1) : (cam.z <= zMin() ? zFloor() : cam.z - 1));
  function clampCam() {
    if (!world) return;
    const vw = cw / cam.z, vh = ch / cam.z;
    cam.x = world.pxW <= vw ? world.pxW / 2 : clamp(cam.x, vw / 2, world.pxW - vw / 2);
    cam.y = world.pxH <= vh ? world.pxH / 2 : clamp(cam.y, vh / 2, world.pxH - vh / 2);
  }
  const offs = () => ({ ox: Math.round(cw / 2 - cam.x * cam.z), oy: Math.round(ch / 2 - cam.y * cam.z) });
  function screenToWorld(px, py) { const { ox, oy } = offs(); return { x: (px - ox) / cam.z, y: (py - oy) / cam.z }; }
  function zoomAt(newZ, px, py) {
    newZ = normZ(newZ);
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
      if (a.away) continue;
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
      if (d / pinch.d > 1.3) { zoomAt(stepZ(1), mx, my); pinch.d = d; } else if (d / pinch.d < 0.77) { zoomAt(stepZ(-1), mx, my); pinch.d = d; }
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
    zoomAt(stepZ(e.deltaY < 0 ? 1 : -1), p.x, p.y);
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
    cam.z = cam.z < zMin() ? zFloor() : clamp(cam.z, zMin(), zMax());
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
    ctx.fillStyle = W3 ? '#15171c' : '#3a7fb5'; ctx.fillRect(0, 0, cw, ch);
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
    if (W3) drawBreaches(vx0, vy0, vx1, vy1);
    // y-sorted objects + agents (+ colossi, camp tents, heralds in the walled city)
    const vis = [];
    for (const a of agents) if (!a.sleeping && !a.away && a.x > vx0 - 16 && a.x < vx1 + 16 && a.y > vy0 - 8 && a.y < vy1 + 30) vis.push(a);
    if (W3) collectDynamic(vis, vx0, vy0, vx1, vy1);
    vis.sort((p, q) => p.y - q.y);
    const objs = world.objects;
    let ai = 0;
    const drawVis = v => (v.draw ? v.draw() : drawAgentSprite(v));
    for (let k = 0; k < objs.length; k++) {
      const o = objs[k];
      while (ai < vis.length && vis[ai].y + 2 < o.baseY) drawVis(vis[ai++]);
      if (o.x > vx1 || o.y > vy1 || o.x + o.img.width < vx0 || o.y + o.img.height < vy0) continue;
      ctx.drawImage(o.kind === 'gate' && gatesClosed ? o.imgClosed : o.img, o.x, o.y);
      if (o.kind === 'board') drawBoardPapers(o);
      else if (o.kind === 'fountain') drawFountainFx(o);
      else if (W3) drawObjectFx(o);
    }
    while (ai < vis.length) drawVis(vis[ai++]);

    drawWorldEffects(z);
    if (W3) drawFog(z);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (W3) drawLightingWalls(z, ox, oy); else drawLighting(z, ox, oy);
    drawWeather();
    drawScreenUI(z, ox, oy, vx0, vy0, vx1, vy1);
  }

  function drawLoading() {
    ctx.fillStyle = '#fff8ec'; ctx.font = `${Math.round(14 * dpr)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t('canvas.loading'), cw / 2, ch / 2); ctx.textAlign = 'left';
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
      if (L.kind === 'building' && zcss < 1) continue;
      const [x, y] = S(L.x, L.y);
      if (L.kind === 'ring') {
        const lt = (L.text || (L.key ? t(L.key) : '')).toUpperCase();
        ctx.font = `800 ${L.big ? 18 : 13}px system-ui, sans-serif`;
        const tw = ctx.measureText(lt).width;
        ctx.fillStyle = 'rgba(10,10,14,0.6)'; ctx.fillText(lt, x * k - tw / 2 + 1, y * k + 1);
        ctx.fillStyle = L.big ? 'rgba(232,214,170,0.9)' : 'rgba(214,204,182,0.78)'; ctx.fillText(lt, x * k - tw / 2, y * k);
        ctx.font = TAG_FONT;
        continue;
      }
      if (L.kind === 'place') {
        ctx.font = '800 12px system-ui, sans-serif';
        const lt = L.key ? t(L.key) : L.text;
        const tw = ctx.measureText(lt).width;
        ctx.fillStyle = 'rgba(43,34,51,0.55)'; ctx.fillText(lt, x * k - tw / 2 + 1, y * k + 1);
        ctx.fillStyle = 'rgba(255,248,236,0.92)'; ctx.fillText(lt, x * k - tw / 2, y * k);
        ctx.font = TAG_FONT;
      } else {
        let text = L.key ? t(L.key) : prettyType(L.text);
        if (L.key === 'place.forum') text += '  ·  ' + t('n.threads', { n: board.reddit });
        if (L.counter === 'reddit') text = t(L.key, { threads: t('n.threads', { n: board.reddit }) });
        drawTag(ctx, x * k, y * k - 2, text, L.kind === 'district' ? L.color : (L.color || (L.key === 'place.forum' ? '#ff8a3a' : '#f2a65a')), { bg: W3 ? 'rgba(20,20,26,0.82)' : 'rgba(43,34,51,0.78)' });
      }
    }
    // noticeboard count badge
    {
      const o = world.board; const [x, y] = S(o.x + o.img.width / 2, o.y);
      if (zcss >= 1 || !W3) drawTag(ctx, x * k, y * k - 2, t(W3 ? 'wplace.board' : 'place.board', { posts: t('n.posts', { n: board.twitter }) }), '#4fb3e8', { bg: 'rgba(43,34,51,0.85)' });
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
    if (W3) drawEventIcons(S, k, zcss, vx0, vy0, vx1, vy1);
    const list = agents.filter(a => !a.sleeping && !a.away && a.x > vx0 - 40 && a.x < vx1 + 40 && a.y > vy0 - 20 && a.y < vy1 + 60).sort((p, q) => p.y - q.y);
    // bubble declutter: newest bubbles claim space first; overlapping ones shrink to icon or hide
    {
      const withB = list.filter(a => a.bubble).sort((p, q) => (p.id === selected) - (q.id === selected) || q.bubble.t - p.bubble.t).reverse();
      const taken = [];
      if (hype && hype.layout) { const o = world.board; const [bx, by] = S(o.x + o.img.width / 2, o.y); taken.push(drawBubble(ctx, bx * k, by * k - 44, hype.layout, getIcon('fire'), { measureOnly: true })); }
      const hit = r => taken.some(t => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y);
      for (const a of withB) {
        const [hx, hy] = S(a.x, a.y - 20);
        const X = hx * k, Y = hy * k, b = a.bubble;
        const lay = bubbleLayout(b);
        const top = Y - 3 - ((showAllTags || a.id === selected || a.id === hovered || a.id === followId) ? 17 : 0);
        let r = drawBubble(ctx, X, top + 4, lay, b.icon, { measureOnly: true });
        b.mode = 'full';
        if (a.id !== selected && a.id !== hovered && hit(r)) {
          b.mode = 'icon';
          r = drawBubble(ctx, X, top + 4, null, b.icon, { measureOnly: true });
          if (hit(r)) { const o = taken.filter(t => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y).length; b.mode = o > 1 ? 'hide' : 'icon'; }
        }
        if (b.mode !== 'hide') taken.push(r);
      }
    }
    const sel = [];
    for (const a of list) {
      const [hx, hy] = S(a.x, a.y - 20);
      const X = hx * k, Y = hy * k;
      if (zcss >= 2) {
        // mood pip beside the head (+ arrow flash when mood just changed)
        const c = moodColor(a.mood);
        const px = Math.round(X + 7 * zcss), py = Math.round(Y + 3 * zcss);
        ctx.fillStyle = OUTLINE; ctx.fillRect(px - 1, py - 1, 6, 6);
        ctx.fillStyle = c; ctx.fillRect(px, py, 4, 4);
        if (a.moodFlash) {
          const up = a.moodFlash > 0; ctx.fillStyle = up ? '#5fd16a' : '#ef5350';
          const bx = px + 6, by = py - 1;
          if (up) { ctx.fillRect(bx + 1, by, 1, 1); ctx.fillRect(bx, by + 1, 3, 1); ctx.fillRect(bx + 1, by + 2, 1, 3); }
          else { ctx.fillRect(bx + 1, by, 1, 3); ctx.fillRect(bx, by + 3, 3, 1); ctx.fillRect(bx + 1, by + 4, 1, 1); }
        }
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
      let tw = Math.min(ctx.measureText(text).width, W - 80);
      let subLay = null;
      if (banner.sub) { subLay = banner.subLay || (banner.subLay = wrapText(ctx, banner.sub, Math.min(420, W - 90), 2)); ctx.font = '700 13px system-ui, sans-serif'; tw = Math.min(Math.max(tw, subLay.w), W - 80); }
      const bw = tw + 46, bh = subLay ? 34 + subLay.lines.length * 14 : 30, bx = Math.round(W / 2 - bw / 2), by = 12;
      ctx.fillStyle = OUTLINE; ctx.fillRect(bx - 2, by, bw + 4, bh); ctx.fillRect(bx, by - 2, bw, bh + 4);
      ctx.fillStyle = banner.color; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(bx, by, bw, 3);
      const ic = getIcon(banner.icon); ctx.drawImage(ic, bx + 8, by + 15 - ic.height, ic.width * 2, ic.height * 2);
      ctx.fillStyle = '#fffaf0'; ctx.textBaseline = 'middle';
      let t = text; while (ctx.measureText(t).width > tw && t.length > 3) t = t.slice(0, -2);
      if (t !== text) t = t.slice(0, -1) + '…';
      ctx.fillText(t, bx + 34, subLay ? by + 16 : by + bh / 2 + 1);
      if (subLay) { ctx.font = UI_FONT; ctx.fillStyle = 'rgba(255,246,230,0.9)'; subLay.lines.forEach((l, i) => ctx.fillText(l, bx + 34, by + 34 + i * 14)); }
      ctx.globalAlpha = 1; ctx.textBaseline = 'top';
    }
    ctx.restore();
  }
  function bubbleLayout(b) {
    if (!b.layout) return null;
    if (cam.z / dpr >= 2) return b.layout;
    if (!b.short) { const l0 = b.layout.lines[0]; b.short = { lines: [l0 + (b.layout.lines.length > 1 && !l0.endsWith('…') ? '…' : '')], w: b.layout.w + 8 }; }
    return b.short;
  }
  function drawAgentBubble(a, X, top) {
    const b = a.bubble;
    const fade = clamp(Math.min(b.t * 6, (b.life - b.t) * 3), 0, 1);
    ctx.globalAlpha = fade;
    if (b.mode === 'hide') { ctx.globalAlpha = 1; return; }
    const lay = b.mode === 'icon' ? null : bubbleLayout(b);
    drawBubble(ctx, X, top + 4, lay, b.icon, { accent: lay ? b.accent : null });
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
    if (W3) ambientWalls(dt);
  }


  // ================================================================ three_walls: world events & visuals
  let evAll = [];
  const refreshEvents = () => { evAll = wEvents.concat(godWEvents).sort((p, q) => p.round - q.round); };
  function allEvents() { return evAll; }
  const curRound = () => (rounds[roundIdx] ? rounds[roundIdx].round : 0);
  const evProgress = ev => (curRound() - ev.round) + Math.min(roundT, ROUND_SECONDS) / ROUND_SECONDS;
  const evActive = ev => { const p = evProgress(ev); return p >= 0 && p < EV_DUR[ev.kind]; };
  const ringName = r => { const n = data && data.meta && data.meta.world && data.meta.world.rings && data.meta.world.rings[r]; return n || t('wring.' + (r || 'outer')); };
  const innerOf = r => (r === 'outer' || r === 'beyond' ? 'middle' : r === 'middle' ? 'inner' : null);
  const evHash = (ev, salt = '') => hashStr(ev.id + salt + (ev.seed || ''));
  function breachSite(ev) {
    if (ev._site) return ev._site;
    const sites = world.breachSites[ev.ring || 'outer'] || world.breachSites.outer;
    ev._site = sites[evHash(ev) % sites.length];
    return ev._site;
  }
  function fireTarget(ev) {
    if (ev._target !== undefined) return ev._target;
    const ring = ev.ring || 'middle';
    if (ring === 'middle' && world.forges && world.forges.length) { ev._target = world.forges[evHash(ev, 'f') % world.forges.length]; return ev._target; }
    const list = (world.fireTargets[ring] && world.fireTargets[ring].length ? world.fireTargets[ring] : world.fireTargets.middle) || [];
    ev._target = list.length ? list[evHash(ev, 'f') % list.length] : null;
    return ev._target;
  }
  function agentsOfRing(ring) { return agents.filter(a => a.ring === ring || (ring === 'outer' && a.ring === 'beyond' && !a.away)); }
  function pickSome(list, n, ev, salt) { return [...list].sort((p, q) => (hashStr(salt + p.id + ev.id) % 997) - (hashStr(salt + q.id + ev.id) % 997)).slice(0, n); }
  function setOv(a, ov, live) {
    a.ov = { arrived: false, wait: 0, rad: 2, mul: 1.2, ...ov };
    if (a.sleeping) { a.sleeping = false; a.goingHome = false; placeAt(a, a.home); }
    if (!live) {
      const s = ov.rad === 0 ? ov.dest : world.randomSpotNear(ov.dest.x, ov.dest.y, Math.max(1, ov.rad), a.rnd);
      placeAt(a, s); a.ov.arrived = true; a.ov.wait = a.rnd() * 3;
      if (ov.awayOnArrive) a.away = true;
    }
    a.activity = A(ov.act);
  }
  function applyEventBehaviors(ev, live) {
    const until = ev.round + EV_DUR[ev.kind];
    const ring = ev.ring || 'outer';
    const awake = a => !a.away;
    switch (ev.kind) {
      case 'alarm': case 'sighting':
        if (live) for (const a of agents) if (!a.sleeping && !a.away) a.alertT = ev.kind === 'alarm' ? 3 : 1.8;
        break;
      case 'breach': {
        const nxt = innerOf(ring);
        const gates = nxt ? world.gates.filter(g => g.ring === nxt) : [];
        for (const a of agentsOfRing(ring).filter(awake)) {
          let dest = world.places.council.spots[0];
          if (gates.length) { let best = null, bd = Infinity; for (const g of gates) { const d = Math.hypot(g.outside.x * TILE - a.x, g.outside.y * TILE - a.y); if (d < bd) { bd = d; best = g; } } dest = best.outside; }
          setOv(a, { kind: 'flee', dest, rad: 3, until: until + 1, mul: 2.2, act: 'act.flee' }, live);
          if (live) a.alertT = 2.5;
        }
        if (live) spawnDust(ev, 140);
        break;
      }
      case 'evacuation': {
        const camp = world.camps[ring] || world.camps.outer;
        for (const a of agentsOfRing(ring).filter(awake)) setOv(a, { kind: 'evac', dest: pickSpot(camp.spots, a.rnd), rad: 3, until: until + 1, mul: 1.4, act: 'act.evacuate' }, live);
        break;
      }
      case 'expedition_out': {
        const back = allEvents().find(e => e.kind === 'expedition_back' && e.round > ev.round);
        const edge = { x: world.geo.C - 1, y: world.H - 2 };
        for (const a of expeditionMembers()) setOv(a, { kind: 'expedition', dest: edge, rad: 0, until: back ? back.round : 1e9, mul: 1.15, act: 'act.expedition', awayOnArrive: true }, live);
        break;
      }
      case 'expedition_back': {
        const edge = { x: world.geo.C, y: world.H - 2 };
        for (const a of expeditionMembers()) {
          a.away = false;
          if (live) { placeAt(a, edge); setOv(a, { kind: 'return', dest: a.home, rad: 2, until, mul: 1.1, act: 'act.return' }, true); }
          else setOv(a, { kind: 'return', dest: a.home, rad: 2, until, mul: 1.1, act: 'act.return' }, false);
        }
        break;
      }
      case 'shortage': {
        const pool = agents.filter(a => (a.ring === 'outer' || a.ring === 'middle') && !a.away);
        pickSome(pool, Math.min(world.queue.length, 10), ev, 'q').forEach((a, k) => setOv(a, { kind: 'queue', dest: world.queue[k] || world.places.granary.spots[0], rad: 0, until, mul: 1.2, act: 'act.queue' }, live));
        break;
      }
      case 'riot': {
        const pool = agents.filter(a => (a.ring === (ev.ring || 'middle') || a.ring === 'outer') && !a.away);
        pickSome(pool, 12, ev, 'r').forEach(a => setOv(a, { kind: 'riot', dest: pickSpot(world.riotSpots, a.rnd), rad: 2, until, mul: 1.5, act: 'act.riot' }, live));
        break;
      }
      case 'decree': {
        for (const a of agents) {
          if (a.away || hashStr('d' + a.id + ev.id) % 3) continue;
          const k = a.ring === 'inner' ? 'council' : a.ring === 'middle' ? 'forum' : 'plaza';
          setOv(a, { kind: 'listen', dest: pickSpot(world.places[k].spots, a.rnd), rad: 2, until, mul: 1.1, act: 'act.listen' }, live);
        }
        break;
      }
      case 'fire': {
        const o = fireTarget(ev); if (!o) break;
        const door = { x: o.tx + Math.floor(o.fw / 2), y: o.ty + o.fh + 1 };
        const pool = agents.filter(a => a.ring === (ev.ring || 'middle') && !a.away).sort((p, q) => Math.hypot(p.x - door.x * TILE, p.y - door.y * TILE) - Math.hypot(q.x - door.x * TILE, q.y - door.y * TILE));
        pool.slice(0, 6).forEach(a => setOv(a, { kind: 'fire', dest: door, rad: 2, until, mul: 1.8, act: 'act.fire' }, live));
        break;
      }
    }
  }
  function expeditionMembers() {
    const b = agents.filter(a => a.ring === 'beyond');
    return b.length ? b : [];
  }
  function fireWorldEvent(ev, live) {
    const [color, icon] = EV_STYLE[ev.kind] || ['#7a4fb0', 'exclaim'];
    banner = { text: ev.title || t('wev.kind.' + ev.kind), sub: ev.text || '', t: 0, dur: 7, color, icon };
    if (!ev.god) emit('world-event', { event: ev, round: ev.round, id: ev.id });
    applyEventBehaviors(ev, live);
  }
  function rederiveEvents(r, teleport) {
    const evs = allEvents();
    let outEv = null;
    for (const ev of evs) {
      if (ev.round >= r) break;
      if (ev.kind === 'expedition_out') outEv = ev; else if (ev.kind === 'expedition_back') outEv = null;
    }
    for (const ev of evs) {
      if (ev.round >= r) continue;
      if (ev.kind === 'expedition_out' || ev.kind === 'expedition_back') continue;
      if (r < ev.round + EV_DUR[ev.kind]) applyEventBehaviors(ev, !teleport);
    }
    if (outEv) applyEventBehaviors(outEv, !teleport);
    const backEv = evs.find(e => e.kind === 'expedition_back' && e.round < r && r < e.round + EV_DUR.expedition_back);
    if (backEv && !outEv) applyEventBehaviors(backEv, !teleport);
  }
  function overrideTick(a, dt) {
    const ov = a.ov;
    if (!ov) { if (a.away) return true; return false; }
    if (curRound() >= ov.until) { a.ov = null; if (ov.kind === 'expedition') { /* stays away until the return event */ return a.away; } return false; }
    if (a.moving) { stepAgent(a, dt); if (!a.moving && ov.awayOnArrive) a.away = true; return true; }
    if (a.away) return true;
    if (a.sleeping) { a.sleeping = false; placeAt(a, a.home); }
    ov.wait -= dt;
    if (ov.wait > 0 || pathBudget <= 0) return true;
    pathBudget--;
    const dest = ov.arrived && ov.rad > 0 ? world.randomSpotNear(ov.dest.x, ov.dest.y, ov.rad, a.rnd) : ov.dest;
    const t0 = tileOf(a);
    if (ov.arrived && ov.rad === 0 && t0.x === dest.x && t0.y === dest.y) { ov.wait = 2; return true; }
    setPath(a, dest, ov.arrived ? 0.5 : ov.mul);
    ov.wait = ov.arrived ? 2 + a.rnd() * 4 : 0.2;
    ov.arrived = true;
    a.activity = A(ov.act);
    return true;
  }

  // ---------------------------------------------------------------- visuals
  function spawnDust(ev, n) {
    const s = breachSite(ev); if (!s) return;
    const cx = (s.x + 0.5) * TILE, cy = ((s.y0 + s.y1) / 2 + 0.5) * TILE;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 30;
      wparticles.push({ x: cx + (Math.random() - 0.5) * 70, y: cy + (Math.random() - 0.5) * 50, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 6, life: 2 + Math.random() * 3, max: 5, s: 2 + Math.floor(Math.random() * 4), c: ['#8a8378', '#a39c8f', '#6e685f', '#b8b0a2'][i & 3], kind: 'dust' });
    }
  }
  function drawBreaches(vx0, vy0, vx1, vy1) {
    const r = curRound();
    for (const ev of allEvents()) {
      if (ev.kind !== 'breach' || ev.round > r) continue;
      const s = breachSite(ev); if (!s) continue;
      let d = decalCache.get(ev.id);
      if (!d) { d = makeBreachDecal(5, s.y1 - s.y0 + 1, s.dir, evHash(ev, 'd')); decalCache.set(ev.id, d); }
      const x = (s.x - 2) * TILE + d.ox, y = s.y0 * TILE + d.oy;
      if (x > vx1 || y > vy1 || x + d.img.width < vx0 || y + d.img.height < vy0) continue;
      ctx.drawImage(d.img, x, y);
    }
  }
  function computeColossi() {
    const list = [];
    for (const ev of allEvents()) {
      if (ev.kind !== 'sighting' && ev.kind !== 'breach') continue;
      if (!evActive(ev)) continue;
      const p = evProgress(ev), dur = EV_DUR[ev.kind];
      const fade = clamp(Math.min(p / 0.5, (dur - p) / 0.8), 0, 1);
      if (ev.kind === 'sighting') {
        // three giants stalk along one side of the horizon, in the fog
        const G = world.geo, h0 = evHash(ev), side = ev.god ? (h0 % 4) : ((h0 % 3) === 2 ? 3 : (h0 % 3)); // mostly north / east / west
        const base = [-Math.PI / 2, 0, Math.PI, Math.PI / 2][side];
        const rr = G.RO + 13;
        for (let j = 0; j < 3; j++) {
          const a = base + (j - 1) * 0.42 + ((p / dur) - 0.5) * 0.35 * (j % 2 ? -1 : 1);
          const dx = Math.cos(a), dy = Math.sin(a), q = Math.pow(dx ** 4 + dy ** 4, 0.25); // rounded-square radius
          const rj = rr + (j === 1 ? 5 : 0);
          list.push({ x: (G.C + dx / q * rj) * TILE, y: (G.C + dy / q * rj) * TILE, alpha: fade, sil: true, walk: true, v: j % 2, face: (j % 2 ? -1 : 1), ph: j * 0.37 });
        }
      } else {
        const s = breachSite(ev); if (!s) continue;
        const outY = s.dir > 0 ? s.y1 + 3 : s.y0 - 1;
        const appr = clamp(p / 0.7, 0, 1), leave = clamp((p - (dur - 1.2)) / 1.2, 0, 1);
        const off = (1 - appr) * 12 + leave * 14;
        list.push({ x: (s.x + 3.5) * TILE, y: (outY + s.dir * off) * TILE, alpha: fade, sil: false, walk: appr < 1 || leave > 0, v: 1, face: -1, ph: 0 });
      }
    }
    return list;
  }
  function collectDynamic(vis, vx0, vy0, vx1, vy1) {
    // colossi
    for (const c of colossiNow) {
      if (c.x < vx0 - 60 || c.x > vx1 + 60 || c.y < vy0 - 10 || c.y > vy1 + 130) continue;
      vis.push({ y: c.y, draw: () => drawColossus(c) });
    }
    // camp tents during evacuations
    for (const ev of allEvents()) {
      if (ev.kind === 'evacuation' && evActive(ev)) {
        const camp = world.camps[ev.ring || 'outer'] || world.camps.outer;
        if (!tentSprites) tentSprites = [0, 1, 2, 3].map(i => makeCampTent(hashStr('camp' + i)));
        const al = clamp(evProgress(ev) / 0.4, 0, 1);
        camp.tents.forEach((tp, i) => {
          const sp = tentSprites[i % 4], x = tp.x * TILE + sp.ox, y = tp.y * TILE + sp.oy;
          if (x > vx1 || y > vy1 || x + 50 < vx0 || y + 40 < vy0) return;
          vis.push({ y: (tp.y + 1) * TILE, draw: () => { ctx.globalAlpha = al; ctx.drawImage(sp.img, x, y); ctx.globalAlpha = 1; } });
        });
      }
      if (ev.kind === 'decree' && evActive(ev)) {
        if (!heraldImg) heraldImg = makeHerald();
        for (const k of ['plaza', 'forum', 'council']) {
          const P = world.places[k]; if (!P.center) continue;
          const x = P.center.x - 7, y = P.center.y - 26 + Math.round(Math.abs(Math.sin(realTime * 4)) * -2);
          vis.push({ y: P.center.y, draw: () => ctx.drawImage(heraldImg, x, y) });
        }
      }
    }
  }
  function drawColossus(c) {
    const fr = c.walk ? Math.floor(realTime * 2.2 + c.ph * 4) % COLOSSUS_FRAMES : 0;
    const sp = getColossus(fr, c.v, c.sil);
    const breathe = c.walk ? 0 : Math.round(Math.sin(realTime * 1.3 + c.ph) * 1);
    ctx.globalAlpha = c.alpha * (c.sil ? 0.92 : 1);
    if (c.face < 0) { ctx.save(); ctx.translate(Math.round(c.x), 0); ctx.scale(-1, 1); ctx.drawImage(sp.img, -Math.round(sp.img.width / 2), Math.round(c.y - sp.footY + breathe)); ctx.restore(); }
    else ctx.drawImage(sp.img, Math.round(c.x - sp.img.width / 2), Math.round(c.y - sp.footY + breathe));
    ctx.globalAlpha = 1;
    // shadow-ish ground darkening
    ctx.fillStyle = `rgba(8,8,10,${0.25 * c.alpha})`; ctx.fillRect(Math.round(c.x - 26), Math.round(c.y - 3), 52, 5);
  }
  function drawObjectFx(o) {
    if (o.kind === 'tower' && alarmLvl > 0 && o.bell) {
      const sw = Math.round(Math.sin(realTime * 10 + o.x) * 2);
      ctx.fillStyle = '#1e1d22'; ctx.fillRect(o.bell.x - 8, o.bell.y - 2, 16, 15);
      ctx.fillStyle = '#b8873f'; ctx.fillRect(o.bell.x - 5 + sw, o.bell.y, 10, 8); ctx.fillRect(o.bell.x - 7 + sw, o.bell.y + 7, 14, 3); ctx.fillStyle = '#e6c06a'; ctx.fillRect(o.bell.x - 3 + sw, o.bell.y + 1, 2, 5);
      const ph = (realTime * 1.6) % 1;
      ctx.strokeStyle = `rgba(255,214,120,${(1 - ph) * 0.9})`; ctx.lineWidth = 1;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(o.bell.x, o.bell.y + 5, 10 + ph * 16, side < 0 ? Math.PI * 0.7 : -Math.PI * 0.3, side < 0 ? Math.PI * 1.3 : Math.PI * 0.3); ctx.stroke(); }
    } else if (o.kind === 'forge' && o.fire) {
      const f = (Math.sin(realTime * 13 + o.x) + 1) / 2;
      ctx.fillStyle = f > 0.5 ? '#ffd27a' : '#ff9a3a'; ctx.fillRect(o.fire.x - 3, o.fire.y - 2 - Math.round(f * 2), 6, 3);
      ctx.fillStyle = '#fff1b8'; ctx.fillRect(o.fire.x - 1, o.fire.y - 1, 2, 2);
    } else if (o.kind === 'torch') {
      const f = Math.sin(realTime * 11 + o.x * 0.3);
      ctx.fillStyle = f > 0 ? '#ffd27a' : '#ff9a3a'; ctx.fillRect(o.x + 3, o.y + 1 - (f > 0.5 ? 1 : 0), 2, 2);
    }
    if (o.burning) drawFlames(o);
  }
  function drawFlames(o) {
    const w = o.img.width, n = Math.max(3, Math.floor(w / 8));
    const roofY = o.y + Math.round(o.img.height * 0.42);
    const tongue = (x, base, h, wd, col) => { for (let yy = 0; yy < h; yy++) { const k = 1 - yy / h, ww = Math.max(1, Math.round(wd * k)), sw = Math.round(Math.sin(realTime * 9 + yy * 0.5 + x) * k * 1.5); ctx.fillStyle = col; ctx.fillRect(Math.round(x - ww / 2 + sw), Math.round(base - yy), ww, 1); } };
    for (let i = 0; i < n; i++) {
      const x = o.x + 6 + i * (w - 12) / Math.max(1, n - 1), ph = realTime * 6 + i * 1.9;
      const h = (10 + Math.round((Math.sin(ph) + 1) * 6 + (i % 3) * 4)) * o.burnK;
      const base = roofY + ((i * 7) % 5);
      tongue(x, base, h, 8, '#c0401e'); tongue(x, base, h * 0.75, 6, '#ff8a2a'); tongue(x, base, h * 0.45, 3, '#ffd77a');
    }
  }
  function drawWParticles() {
    for (const p of wparticles) {
      const al = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = p.kind === 'smoke' ? al * 0.55 : al * 0.85;
      ctx.fillStyle = p.c; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;
  }
  function drawFog(z) {
    drawWParticles();
    const f = world.fog;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.95;
    ctx.drawImage(f, 0, 0, f.width, f.height, 0, 0, world.pxW, world.pxH);
    const dx = Math.sin(realTime * 0.05) * 3 * TILE, dy = Math.cos(realTime * 0.04) * 2 * TILE;
    ctx.globalAlpha = 0.35;
    ctx.drawImage(f, 0, 0, f.width, f.height, dx - 2 * TILE, dy - 2 * TILE, world.pxW + 4 * TILE, world.pxH + 4 * TILE);
    ctx.restore();
  }
  function ambientWalls(dt) {
    colossiNow = computeColossi();
    let alarm = 0, closed = false;
    const r = curRound();
    for (const ev of allEvents()) {
      if (ev.round > r + 1) break;
      if (!evActive(ev)) continue;
      if (ev.kind === 'alarm') { alarm = 1; closed = true; }
      if (ev.kind === 'breach' && evProgress(ev) < 2.2) { closed = true; alarm = Math.max(alarm, 0.8); }
    }
    alarmLvl = alarm; gatesClosed = closed;
    // burning buildings
    for (const o of world.fireTargets.middle.concat(world.fireTargets.outer, world.fireTargets.inner)) o.burning = false;
    for (const ev of allEvents()) {
      if (ev.kind !== 'fire' || !evActive(ev)) continue;
      const o = fireTarget(ev); if (!o) continue;
      const p = evProgress(ev);
      o.burning = true; o.burnK = clamp(Math.min(p / 0.6, (EV_DUR.fire - p) / 1.2), 0.2, 1);
      if (Math.random() < dt * 14) wparticles.push({ x: o.x + Math.random() * o.img.width, y: o.y + o.img.height * 0.25, vx: (Math.random() - 0.5) * 6 + 4, vy: -14 - Math.random() * 10, life: 3 + Math.random() * 2, max: 5, s: 3 + Math.floor(Math.random() * 3), c: Math.random() < 0.2 ? '#ff9a3a' : '#3a3836', kind: 'smoke' });
    }
    for (const c of colossiNow) if (!c.sil && c.walk && Math.random() < dt * 8) wparticles.push({ x: c.x + (Math.random() - 0.5) * 40, y: c.y - 2, vx: (Math.random() - 0.5) * 12, vy: -4 - Math.random() * 6, life: 1.5 + Math.random(), max: 2.5, s: 2 + Math.floor(Math.random() * 3), c: '#8a8378', kind: 'dust' });
    for (const p of wparticles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; if (p.kind === 'dust') p.vy += 3 * dt; p.life -= dt; }
    if (wparticles.length) wparticles = wparticles.filter(p => p.life > 0);
    if (wparticles.length > 900) wparticles.splice(0, wparticles.length - 900);
    if (alarm > 0) for (const a of agents) if (!a.sleeping && !a.away && a.alertT <= 0 && (hashStr('al' + a.id) + Math.floor(realTime * 0.5)) % 5 === 0) a.alertT = 0.9;
  }
  function drawEventIcons(S, k, zcss, vx0, vy0, vx1, vy1) {
    const r = curRound();
    const s = zcss >= 1 ? 2 : 1;
    for (const ev of allEvents()) {
      if (ev.round > r + 1) break;
      if (!evActive(ev)) continue;
      if (ev.kind === 'shortage' && world.granary) {
        const o = world.granary, ic = getIcon('sack'), bob = Math.round(Math.sin(realTime * 4) * 3);
        const [x, y] = S(o.x + o.img.width / 2, o.y);
        ctx.globalAlpha = 0.65 + 0.35 * Math.abs(Math.sin(realTime * 3));
        ctx.drawImage(ic, x * k - ic.width * s, y * k - 10 - ic.height * s * 2 + bob, ic.width * s * 2, ic.height * s * 2);
        ctx.globalAlpha = 1;
      }
      if (ev.kind === 'decree') {
        const ic = getIcon('scroll');
        for (const key of ['plaza', 'forum', 'council']) {
          const P = world.places[key]; if (!P.center) continue;
          const [x, y] = S(P.center.x, P.center.y - 34);
          ctx.drawImage(ic, x * k - ic.width * s / 2 * 1.5, y * k - ic.height * s * 1.5 + Math.round(Math.sin(realTime * 5) * 2), ic.width * s * 1.5, ic.height * s * 1.5);
        }
      }
    }
    const ai = getIcon('angry');
    for (const a of agents) {
      if (!a.ov || a.ov.kind !== 'riot' || a.sleeping || a.away) continue;
      if (a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1 + 20) continue;
      const [x, y] = S(a.x, a.y - 24);
      const bob = Math.round(Math.abs(Math.sin(realTime * 6 + a.i)) * -4);
      ctx.drawImage(ai, x * k - ai.width * s / 2, y * k - ai.height * s + bob, ai.width * s, ai.height * s);
    }
  }
  function drawLightingWalls(z, ox, oy) {
    const h = clockHour();
    const dk = darknessAt(h);
    const warm = Math.max(0, 1 - Math.abs(h - 18.4) / 1.6) * 0.7 + Math.max(0, 1 - Math.abs(h - 6.3) / 1.0) * 0.4;
    let r = lerp(206, 42, dk), g = lerp(208, 48, dk), b = lerp(218, 84, dk);
    g *= lerp(1, 0.85, warm); b *= lerp(1, 0.72, warm);
    const pulse = alarmLvl > 0 ? (Math.sin(realTime * 6) + 1) / 2 : 0;
    if (alarmLvl > 0) { g *= 1 - 0.06 * pulse * alarmLvl; b *= 1 - 0.08 * pulse * alarmLvl; }
    if (weather) { const k = weather.alpha * 0.15; r *= 1 - k; g *= 1 - k; b *= 1 - k * 0.6; }
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; ctx.fillRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'source-over';
    if (alarmLvl > 0) {
      // pulsing red vignette at the screen edges
      const rr = Math.hypot(cw, ch) / 2, gr = ctx.createRadialGradient(cw / 2, ch / 2, rr * 0.45, cw / 2, ch / 2, rr);
      gr.addColorStop(0, 'rgba(170,20,12,0)'); gr.addColorStop(1, `rgba(170,20,12,${(0.14 + 0.18 * pulse) * alarmLvl})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, cw, ch);
    }
    const glow = getGlow();
    ctx.globalCompositeOperation = 'lighter';
    const a = clamp((dk - 0.1) / 0.6, 0, 1);
    if (a > 0) {
      ctx.fillStyle = `rgba(255,190,100,${0.75 * a})`;
      const lit = [];
      for (const o of world.objects) {
        if (!o.windows || !o.windows.length) continue;
        if (o.x * z + ox > cw || o.y * z + oy > ch || (o.x + o.img.width) * z + ox < 0 || (o.y + o.img.height) * z + oy < 0) continue;
        if (o.filler) { if (hashStr(o.tx + ',' + o.ty + ':' + Math.floor(h)) % 3 === 0) continue; }
        else if (o.kind === 'house') { const ow = agentById.get(o.owner); if (!ow || (ow.sleeping && hashStr(o.owner + ':' + Math.floor(h)) % 3 !== 0)) continue; }
        for (const w of o.windows) { const x = w.x * z + ox, y = w.y * z + oy; ctx.fillRect(x, y, w.w * z, w.h * z); lit.push([x + w.w * z / 2, y + w.h * z / 2, Math.max(w.w, w.h)]); }
      }
      ctx.globalAlpha = 0.45 * a;
      for (const [x, y, s] of lit) { const S = s * z * 2.2; ctx.drawImage(glow, x - S / 2, y - S / 2, S, S); }
    }
    // torches, braziers & forges: always a little visible, strong at night
    const ta = 0.18 + 0.7 * a;
    for (const L of world.lamps) {
      const fl = L.flicker ? 0.85 + 0.15 * Math.sin(realTime * 9 + L.x * 0.7) : 1;
      const x = L.x * z + ox, y = L.y * z + oy, S = (L.forge ? 60 : 54) * z * fl;
      if (x < -S || y < -S || x > cw + S || y > ch + S) continue;
      ctx.globalAlpha = ta * fl; ctx.drawImage(glow, x - S / 2, y - S / 2, S, S);
    }
    // burning buildings
    for (const o of world.fireTargets.middle.concat(world.fireTargets.outer, world.fireTargets.inner)) {
      if (!o.burning) continue;
      const x = (o.x + o.img.width / 2) * z + ox, y = (o.y + o.img.height * 0.35) * z + oy, S = 150 * z * (0.9 + 0.1 * Math.sin(realTime * 8));
      ctx.globalAlpha = 0.55 + 0.3 * a; ctx.drawImage(glow, x - S / 2, y - S / 2, S, S);
    }
    // colossus eyes
    for (const c of colossiNow) {
      const sp = getColossus(0, c.v, c.sil);
      for (const e of sp.eyes) {
        const ex = c.face < 0 ? c.x + (sp.img.width / 2 - e.x) : c.x - sp.img.width / 2 + e.x;
        const x = ex * z + ox, y = (c.y - sp.footY + e.y) * z + oy, S = 22 * z;
        ctx.globalAlpha = c.alpha * (0.35 + 0.6 * Math.max(a, dk)); ctx.drawImage(glow, x - S / 2, y - S / 2, S, S);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
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
    const prevRound = rounds[roundIdx] ? rounds[roundIdx].round : null;
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
      W3 = world.theme === 'three_walls';
      placePrefix = W3 ? 'wplace.' : 'place.';
      decalCache.clear();
    }
    godWEvents = [];
    wEvents = W3 ? (Array.isArray(data.meta.events) ? data.meta.events : [])
      .filter(e => e && EV_DUR[e.kind] != null && isFinite(+e.round))
      .map((e, i) => ({ ...e, round: +e.round, id: 'wev:' + i + ':' + e.round + ':' + e.kind }))
      .sort((p, q) => p.round - q.round) : [];
    refreshEvents();
    agents = data.agents.map((a, i) => makeAgent(a, i));
    agentById = new Map(agents.map(a => [a.id, a]));
    selected = null; hovered = null; followId = null; hype = null; effects = []; atEnd = false;
    playing = false;
    if (!keep) {
      resize();
      cam.z = clamp(Math.round((cw / dpr < 700 || ch / dpr < 420 ? 1 : 2) * dpr), zMin(), zMax());
      cam.x = world.places.plaza.center.x; cam.y = world.places.plaza.center.y - 2 * TILE; cam.tx = null;
      if (W3) { cam.z = zMin(); cam.x = world.geo.C * TILE; cam.y = (world.geo.C + world.geo.RM * 0.55) * TILE; }
      clampCam();
    }
    emit('data-loaded', { data });
    if (keep) {
      for (const a of agents) { const k = keep.get(a.id); if (k) { a.x = k.x; a.y = k.y; a.sleeping = k.sleeping; a.dir = k.dir; } }
      seek(prevRound != null ? prevRound : (rounds.length ? rounds[0].round : 0), { teleport: false });
    } else seek(rounds.length ? rounds[0].round : 0, { teleport: true });
    emitState();
  }
  function play() {
    if (!data) return;
    if (atEnd) seek(rounds[0].round, { teleport: true });
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
    if (EV_DUR[kind] != null) {
      if (!W3) return;
      const wev = { round: rounds[roundIdx] ? rounds[roundIdx].round : 0, kind, ring: ev.ring || (kind === 'breach' ? 'outer' : null), god: true, id: 'god:' + (++godSeq),
        title: t('wev.god.' + kind), text: text && text !== kind ? text : t('wev.godText.' + kind, { ring: ringName(ev.ring || 'outer') }), seed: Math.floor(Math.random() * 1e9) };
      godWEvents.push(wev); refreshEvents();
      fireWorldEvent(wev, true);
      return;
    }
    if (kind === 'weather') {
      const snow = /snow|blizzard|cold|winter|frost|freez|ice|neige|雪/i.test(text);
      const n = snow ? 260 : 380;
      weather = { kind: snow ? 'snow' : 'rain', t: 0, dur: 30, alpha: 0, drops: Array.from({ length: n }, () => ({ x: Math.random() * 1.04, y: Math.random(), v: 0.9 + Math.random() * 0.8, l: 8 + Math.random() * 10, s: Math.random() < 0.3 ? 3 : 2, ph: Math.random() * 6 })) };
      banner = { text: `${t(snow ? 'god.bannerSnow' : 'god.bannerRain')}${text ? ': ' + text : ''}`, t: 0, dur: 6, color: snow ? '#6c8aae' : '#4a6fa5', icon: snow ? 'star' : 'speech' };
    } else if (kind === 'festival') {
      festival = { t: 0, dur: 40, alpha: 0 };
      banner = { text: `${t('god.bannerFestival')}${text ? ': ' + text : ''}`, t: 0, dur: 6, color: '#c9563f', icon: 'music' };
      // gather some agents at the plaza
      for (const a of agents) if (!a.sleeping && !a.task && !a.queue.length && a.rnd() < 0.45) { setPath(a, pickSpot(world.places.plaza.spots, a.rnd), 1.4); a.wanderT = 8 + a.rnd() * 6; a.activity = A('act.festival'); }
    } else {
      rumor = { t: 0, text };
      banner = { text: `${t('god.bannerRumor')}${text ? ': ' + text : ''}`, t: 0, dur: 7, color: '#7a4fb0', icon: 'exclaim' };
    }
  }
  function getAgentState(id) {
    const a = agentById.get(id); if (!a) return null;
    return {
      id: a.id, x: a.x / TILE, y: a.y / TILE, mood: a.mood, activity: activityText(a.activity), lastAction: a.lastAction,
      stats: { ...a.stats }, sleeping: a.sleeping, home: { ...a.home }, district: a.d.type, ring: a.ring, away: a.away,
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
    getWorldEvents: () => allEvents(),
    getColossi: () => colossiNow.map(c => ({ x: c.x / TILE, y: c.y / TILE, alpha: c.alpha, sil: c.sil })),
    setCamera(x, y, zz) { if (zz) cam.z = normZ(zz * dpr); cam.x = x * TILE; cam.y = y * TILE; cam.tx = null; followId = null; clampCam(); },
    resize,
    destroy() { cancelAnimationFrame(raf); if (ro) ro.disconnect(); },
    speeds: SPEEDS,
  };
}
