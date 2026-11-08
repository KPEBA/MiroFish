// Swarm Town — live.js
// Connects to a running MiroFish backend and converts its simulation output into
// the town_data.json contract (see CONTRACT.md), feeding the engine via the event bus.
//
// DESIGN (incremental updates):
//   The contract has no "append rounds" command, so every time new rounds arrive we emit
//   'cmd-load-data' with the FULL, updated town_data (a fresh object each time), then restore the
//   viewer: we remember the last round/playing/speed seen on the bus ('state' / 'round' events) and
//   re-emit 'cmd-seek' {round}, 'cmd-speed' and 'cmd-play' if it was playing. If the viewer was sitting
//   on the newest round ("following live") they are moved to the new newest round instead.
//   Polling: run-status every >=3s; at most MAX_ROUNDS_PER_TICK action requests per tick (sequential).
//   Rounds still in progress (== current_round while running) are not fetched until they are complete.
//
// All MiroFish responses are {success, data} / {success:false, error}.
import { emit, on } from './bus.js';

const POLL_MS = 3000;
const MAX_ROUNDS_PER_TICK = 8;

const TYPE_MAP = {
  CREATE_POST: 'POST', CREATE_COMMENT: 'COMMENT',
  LIKE_POST: 'LIKE', LIKE_COMMENT: 'LIKE',
  DISLIKE_POST: 'DISLIKE', DISLIKE_COMMENT: 'DISLIKE',
  REPOST: 'REPOST', QUOTE_POST: 'QUOTE',
  FOLLOW: 'FOLLOW', MUTE: 'MUTE',
  SEARCH_POSTS: 'SEARCH', SEARCH_USER: 'SEARCH',
  TREND: 'TREND', REFRESH: 'IDLE', DO_NOTHING: 'IDLE',
};

export function mapActionType(t) {
  return TYPE_MAP[String(t || '').toUpperCase()] || 'IDLE';
}

async function api(base, path, opts) {
  let res;
  try {
    res = await fetch(base + path, opts);
  } catch (e) {
    throw new Error(`Cannot reach ${base} (${e.message}). Is the backend running on that address?`);
  }
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!body) throw new Error(`HTTP ${res.status} from ${path} (no JSON body)`);
  if (body.success === false || (!res.ok && body.success !== true)) {
    throw new Error(body.error || `HTTP ${res.status} from ${path}`);
  }
  return body.data !== undefined ? body.data : body;
}

export function createLiveClient(baseUrl = 'http://localhost:5001') {
  let base = baseUrl.replace(/\/+$/, '');
  let simId = null;
  let timer = null;
  let busy = false;
  let connected = false;
  let status = 'disconnected';
  let lastError = null;
  let data = null;
  let lastFetchedRound = -1; // highest round already merged
  let counters = { twitter: 0, reddit: 0 };
  let followSet = new Set();
  let runInfo = { runner_status: 'idle', current_round: 0, total_rounds: 0 };
  const listeners = new Set();
  const view = { round: 0, playing: false, speed: 1, total: 0 };

  on('state', s => {
    if (s.round != null) view.round = s.round;
    if (s.playing != null) view.playing = s.playing;
    if (s.speed != null) view.speed = s.speed;
    if (s.totalRounds != null) view.total = s.totalRounds;
  });

  function notify() {
    const info = getInfo();
    listeners.forEach(fn => { try { fn(info); } catch { /* ignore */ } });
  }
  function setStatus(s, err) { status = s; lastError = err || null; notify(); }
  function getInfo() {
    return { status, connected, simId, baseUrl: base, error: lastError, runInfo: { ...runInfo },
             rounds: data ? data.rounds.length : 0, lastRound: lastFetchedRound };
  }

  function pushToEngine(initial) {
    const wasLive = !initial && view.total > 0 && view.round >= view.total;
    const keep = { round: view.round, playing: view.playing, speed: view.speed };
    emit('cmd-load-data', { data: structuredClone(data) });
    if (initial) return;
    // Restore the viewer (engine.load resets to the start).
    if (keep.speed && keep.speed !== 1) emit('cmd-speed', { speed: keep.speed });
    const lastR = data.rounds.length ? data.rounds[data.rounds.length - 1].round : 0;
    emit('cmd-seek', { round: wasLive ? lastR : Math.min(keep.round, lastR) });
    if (keep.playing) emit('cmd-play', {});
  }

  function roundTime(meta, r) {
    const mins = Math.max(0, r - 1) * meta.minutes_per_round;
    const total = (r === 0 ? 0 : mins);
    const hour = (meta.start_hour + Math.floor(total / 60)) % 24;
    const day = 1 + Math.floor((meta.start_hour * 60 + total) / 1440);
    return { hour, minute: total % 60, day };
  }

  function ensureRound(r) {
    // rounds array is dense: index == round number
    while (data.rounds.length <= r) {
      const n = data.rounds.length;
      const t = roundTime(data.meta, n);
      data.rounds.push({ round: n, day: t.day, hour: t.hour, minute: t.minute, actions: [] });
    }
    return data.rounds[r];
  }

  function postKey(platform, n) { return `${platform}:${n}`; }

  function addAction(raw) {
    const platform = raw.platform === 'reddit' ? 'reddit' : 'twitter';
    const args = raw.action_args || {};
    const type = mapActionType(raw.action_type);
    const rawType = String(raw.action_type || '').toUpperCase();
    const r = Math.max(0, raw.round_num | 0);
    const round = ensureRound(r);
    const a = {
      id: `${platform}-${r}-${round.actions.length}-${raw.agent_id}`,
      platform, agent_id: raw.agent_id, type,
      content: null, post_id: null, target_agent_id: null, target_content: null,
    };
    const posts = data.posts;
    const targetPost = (id) => (id != null ? posts[postKey(platform, id)] : null);

    if (type === 'POST' || type === 'QUOTE' || type === 'COMMENT') {
      a.content = args.content ?? args.quote_content ?? null;
    }
    if (type === 'POST') {
      const id = args.new_post_id ?? args.post_id ?? ++counters[platform];
      counters[platform] = Math.max(counters[platform], Number(id) || 0);
      a.post_id = postKey(platform, id);
      posts[a.post_id] = { author_id: raw.agent_id, content: a.content || '', round: r,
                           likes: 0, dislikes: 0, shares: 0, comments: 0 };
    } else if (type === 'QUOTE') {
      const orig = targetPost(args.post_id ?? args.quoted_id);
      if (orig) { a.target_agent_id = orig.author_id; a.target_content = orig.content.slice(0, 140); orig.shares++; }
      const id = args.new_post_id ?? ++counters[platform];
      counters[platform] = Math.max(counters[platform], Number(id) || 0);
      a.post_id = postKey(platform, id);
      posts[a.post_id] = { author_id: raw.agent_id, content: a.content || '', round: r,
                           likes: 0, dislikes: 0, shares: 0, comments: 0 };
    } else if (type === 'COMMENT' || type === 'LIKE' || type === 'DISLIKE' || type === 'REPOST') {
      const isCommentTarget = rawType.endsWith('_COMMENT');
      const pid = args.post_id ?? args.like_id ?? args.dislike_id ?? (isCommentTarget ? null : args.comment_id);
      const p = targetPost(pid);
      if (pid != null) a.post_id = postKey(platform, pid);
      if (p) {
        a.target_agent_id = p.author_id;
        a.target_content = p.content.slice(0, 140);
        if (type === 'LIKE') p.likes++;
        else if (type === 'DISLIKE') p.dislikes++;
        else if (type === 'REPOST') p.shares++;
        else if (type === 'COMMENT') p.comments++;
      }
      if (type === 'REPOST') a.content = null;
    } else if (type === 'FOLLOW') {
      const to = args.follow_id ?? args.followee_id ?? args.user_id;
      if (to != null) {
        a.target_agent_id = Number(to);
        const k = raw.agent_id + '>' + to;
        if (!followSet.has(k)) { followSet.add(k); data.follows.push({ from: raw.agent_id, to: Number(to), round: r }); }
      }
    } else if (type === 'SEARCH') {
      a.content = args.query ?? null;
    } else if (type === 'MUTE') {
      if (args.mute_id != null) a.target_agent_id = Number(args.mute_id);
    }
    round.actions.push(a);
  }

  function buildSkeleton(simInfo, config, profiles) {
    const tc = config?.time_config || {};
    const ec = config?.event_config || {};
    const mpr = tc.minutes_per_round || 60;
    const totalHours = tc.total_simulation_hours || 72;
    const agentsCfg = config?.agent_configs || [];
    const cfgById = new Map(agentsCfg.map(c => [c.agent_id, c]));
    const n = Math.max(profiles.length, agentsCfg.length);
    const agents = [];
    for (let i = 0; i < n; i++) {
      const p = profiles[i] || {};
      const c = cfgById.get(i) || {};
      agents.push({
        id: i,
        name: p.name || c.entity_name || `Agent ${i}`,
        username: p.username || p.user_name || `agent_${i}`,
        type: c.entity_type || p.source_entity_type || 'Person',
        bio: p.bio || '',
        persona: p.persona || '',
        stance: ['supportive', 'opposing', 'neutral', 'observer'].includes(c.stance) ? c.stance : 'neutral',
        sentiment_bias: c.sentiment_bias ?? 0,
        influence: c.influence_weight ?? 1,
        activity_level: c.activity_level ?? 0.5,
        active_hours: c.active_hours || Array.from({ length: 15 }, (_, k) => k + 8),
        profession: p.profession || null,
        mbti: p.mbti || null,
        age: p.age ?? null,
      });
    }
    const platforms = [];
    if (simInfo?.enable_twitter !== false) platforms.push('twitter');
    if (simInfo?.enable_reddit !== false) platforms.push('reddit');
    return {
      version: 1,
      meta: {
        simulation_id: simId,
        title: simInfo?.project_name || simInfo?.name || `Simulation ${simId}`,
        requirement: simInfo?.simulation_requirement || '',
        narrative: ec.narrative_direction || '',
        hot_topics: ec.hot_topics || [],
        platforms,
        minutes_per_round: mpr,
        total_rounds: Math.max(1, Math.ceil(totalHours * 60 / mpr)),
        start_hour: 0,
        source: 'mirofish',
      },
      agents,
      rounds: [],
      posts: {},
      follows: [],
    };
  }

  function addInitialPosts(config) {
    const ps = config?.event_config?.initial_posts || [];
    const r0 = ensureRound(0);
    ps.forEach((p, i) => {
      const aid = p.poster_agent_id;
      if (aid == null || !p.content) return;
      // Initial posts are published on every enabled platform in MiroFish; show them on the first one.
      const platform = data.meta.platforms[0] || 'twitter';
      const id = ++counters[platform];
      const key = postKey(platform, id);
      data.posts[key] = { author_id: aid, content: p.content, round: 0, likes: 0, dislikes: 0, shares: 0, comments: 0 };
      r0.actions.push({ id: `init-${i}`, platform, agent_id: aid, type: 'POST', content: p.content,
                        post_id: key, target_agent_id: null, target_content: null });
    });
  }

  async function tick() {
    if (busy || !connected) return;
    busy = true;
    try {
      const rs = await api(base, `/api/simulation/${encodeURIComponent(simId)}/run-status`);
      runInfo = {
        runner_status: rs.runner_status || 'idle',
        current_round: rs.current_round || 0,
        total_rounds: rs.total_rounds || 0,
        progress_percent: rs.progress_percent || 0,
      };
      const running = runInfo.runner_status === 'running' || runInfo.runner_status === 'starting';
      if (runInfo.total_rounds) data.meta.total_rounds = runInfo.total_rounds;
      const upTo = running ? runInfo.current_round - 1 : runInfo.current_round;
      let fetched = 0, changed = false;
      for (let r = lastFetchedRound + 1; r <= upTo && fetched < MAX_ROUNDS_PER_TICK; r++, fetched++) {
        if (r === 0) { lastFetchedRound = 0; continue; } // round 0 = initial posts from config
        const d = await api(base, `/api/simulation/${encodeURIComponent(simId)}/actions?round_num=${r}&limit=500`);
        ensureRound(r);
        const acts = (d.actions || []).filter(a => a.success !== false);
        acts.forEach(a => addAction({ ...a, round_num: r }));
        lastFetchedRound = r;
        changed = true;
      }
      if (changed) { data.meta.total_rounds = Math.max(data.meta.total_rounds, data.rounds.length - 1); pushToEngine(false); }
      setStatus(running ? 'running' : runInfo.runner_status);
      if (!running && lastFetchedRound >= upTo && runInfo.runner_status !== 'idle') {
        // finished/stopped: keep polling slowly is unnecessary
        if (['completed', 'stopped', 'failed'].includes(runInfo.runner_status)) { clearInterval(timer); timer = null; }
      }
    } catch (e) {
      setStatus('error', e.message); // keep polling; transient errors recover
    } finally { busy = false; }
  }

  async function connect(id, newBase) {
    disconnect();
    if (newBase) base = newBase.replace(/\/+$/, '');
    simId = String(id || '').trim();
    if (!simId) throw new Error('Simulation id is required.');
    setStatus('connecting');
    try {
      await api(base, '/health').catch(async () => {
        // /health returns plain JSON {status:'ok'} (no success flag); api() tolerates that, but rethrow net errors
        throw new Error(`Backend health check failed at ${base}/health`);
      });
      const simInfo = await api(base, `/api/simulation/${encodeURIComponent(simId)}`);
      setStatus('loading');
      const config = await api(base, `/api/simulation/${encodeURIComponent(simId)}/config`).catch(() => null);
      const prof = await api(base, `/api/simulation/${encodeURIComponent(simId)}/profiles?platform=reddit`).catch(() => null);
      const profiles = prof?.profiles || [];
      if (!profiles.length && !(config?.agent_configs || []).length) {
        throw new Error('Simulation has no agent profiles or config yet (prepare the simulation first).');
      }
      counters = { twitter: 0, reddit: 0 };
      followSet = new Set();
      lastFetchedRound = -1;
      data = buildSkeleton(simInfo, config, profiles);
      addInitialPosts(config);
      connected = true;
      pushToEngine(true);
      setStatus('connected');
      timer = setInterval(tick, POLL_MS);
      tick();
      return getInfo();
    } catch (e) {
      connected = false;
      setStatus('error', e.message);
      throw e;
    }
  }

  function disconnect() {
    if (timer) clearInterval(timer);
    timer = null; connected = false; busy = false;
    if (status !== 'disconnected') setStatus('disconnected');
  }

  // POST /api/simulation/interview
  //   body: {simulation_id, agent_id, prompt, platform?: 'twitter'|'reddit', timeout?: seconds}
  //   ok  : {success:true, data:{success, agent_id, prompt, result:{platforms:{twitter:{response},reddit:{response}}} | {response,platform}, timestamp}}
  //   Requires the simulation environment to be alive (post-run command-wait mode), else HTTP 400 {success:false,error}.
  // Returns [{platform, response}].
  async function interview(sim, agentId, prompt, platform) {
    const body = { simulation_id: sim || simId, agent_id: agentId, prompt, timeout: 60 };
    if (platform) body.platform = platform;
    const d = await api(base, '/api/simulation/interview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (d && d.success === false) throw new Error(d.error || 'Interview failed');
    const inner = d.result || d;
    const out = [];
    if (inner.platforms) {
      for (const [p, v] of Object.entries(inner.platforms)) {
        if (v && (v.response || v.error)) out.push({ platform: p, response: v.response || `(error) ${v.error}` });
      }
    } else if (inner.response) {
      out.push({ platform: inner.platform || platform || '', response: inner.response });
    }
    if (!out.length) throw new Error('Agent returned no response.');
    return out;
  }

  return {
    connect, disconnect, interview, getInfo,
    get connected() { return connected; },
    get simId() { return simId; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setBaseUrl(u) { base = u.replace(/\/+$/, ''); },
  };
}
