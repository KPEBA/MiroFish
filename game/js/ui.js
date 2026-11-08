// Swarm Town — ui.js : all DOM UI (top bar, sidebar, timeline, toasts, dialogs). No frameworks.
import { emit, on } from './bus.js';
import { createLiveClient } from './live.js';

const STANCE_COLOR = { supportive: '#6fbf73', opposing: '#e0645c', neutral: '#5b9bd5', observer: '#9a9a9a' };
const ICONS = { POST: '✍️', COMMENT: '💬', LIKE: '👍', DISLIKE: '👎', REPOST: '🔁', QUOTE: '📎',
  FOLLOW: '➕', MUTE: '🔇', SEARCH: '🔍', TREND: '📈', IDLE: '💤', GOD: '⚡' };
const VERBS = { POST: 'posted', COMMENT: 'commented', LIKE: 'liked a post', DISLIKE: 'disliked a post',
  REPOST: 'reposted', QUOTE: 'quoted', FOLLOW: 'followed', MUTE: 'muted', SEARCH: 'searched', TREND: 'checked trends', IDLE: 'is idle' };
const PLATFORM = { twitter: { icon: '🐦', label: 'Square' }, reddit: { icon: '📜', label: 'Forum' } };
const SPEEDS = [0.5, 1, 2, 4, 8];
const FEED_CAP = 300;
const STOP = new Set(('the and for are but not you your with this that have has had was were will would can could should from they them their there here what when who how why '
  + 'about into just than then also been being more most some such only over very much many even like its it\'s i\'m dont don\'t does did our out all any get got one two '
  + 'too off own same those these which while where after before because again against between both each few other another still might must shall via amp http https').split(/\s+/));

// ---------- helpers ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
function tryStore(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* ignore */ } return null; }

export function initUI(engine, bus) {
  const live = createLiveClient();
  const $top = document.getElementById('topbar');
  const $side = document.getElementById('sidebar');
  const $time = document.getElementById('timeline');
  const $modal = document.getElementById('modal-root') || document.body.appendChild(el('div', { id: 'modal-root' }));
  const $toasts = document.body.appendChild(el('div', { id: 'toasts', 'aria-live': 'polite' }));

  // ---------- state ----------
  const S = {
    data: null, agents: new Map(), round: 0, day: 1, hour: 0, minute: 0,
    playing: false, speed: 1, totalRounds: 0, selected: null, follow: false,
    feedIds: new Set(), feedCount: 0, filters: { agent: 'all', platform: 'all', type: 'default' },
    likeCounts: new Map(), crossFollowToasted: false, toastedLikes: new Map(),
    chats: new Map(), tab: 'feed',
  };
  const agent = id => S.agents.get(id);
  const roundsUpTo = r => (S.data ? S.data.rounds.filter(x => x.round <= r) : []);

  // =====================================================================
  // TOP BAR
  // =====================================================================
  const $clock = el('div', { class: 'clock', title: 'Simulated time' }, 'Day 1 · 00:00');
  const $simTitle = el('div', { class: 'sim-title' }, 'No simulation loaded');
  const $play = el('button', { class: 'btn primary', id: 'btn-play', title: 'Play / pause (Space)', 'aria-label': 'Play or pause', onclick: togglePlay }, '▶');
  const $speedBtns = SPEEDS.map((s, i) => el('button', { class: 'btn speed', title: `Speed ${s}× (${i + 1})`, onclick: () => emit('cmd-speed', { speed: s }) }, `${s}×`));
  const $file = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: onFile });
  const $liveBtn = el('button', { class: 'btn', id: 'btn-live', title: 'Connect to a running MiroFish backend', onclick: openLiveDialog }, '📡 Live');
  const $loadBtn = el('button', { class: 'btn', title: 'Load a town_data.json file', onclick: () => $file.click() }, '📂 Load data');
  const $stepBack = el('button', { class: 'btn icon', title: 'Previous round (←)', 'aria-label': 'Previous round', onclick: () => seekBy(-1) }, '⏮');
  const $stepFwd = el('button', { class: 'btn icon', title: 'Next round (→)', 'aria-label': 'Next round', onclick: () => seekBy(1) }, '⏭');
  const $roundLbl = el('span', { class: 'round-lbl' }, 'R 0/0');
  $top.replaceChildren(
    el('div', { class: 'brand' }, el('span', { class: 'logo', 'aria-hidden': 'true' }, '🏘️'), el('span', { class: 'game-title' }, 'Swarm Town')),
    $simTitle, $clock,
    el('div', { class: 'controls' }, $stepBack, $play, $stepFwd, $roundLbl,
      el('div', { class: 'speed-group', role: 'group', 'aria-label': 'Speed' }, $speedBtns)),
    el('div', { class: 'top-actions' }, $loadBtn, $liveBtn, $file));

  function togglePlay() { emit(S.playing ? 'cmd-pause' : 'cmd-play', {}); }
  function seekBy(d) {
    if (!S.data) return;
    emit('cmd-seek', { round: clamp(S.round + d, 0, Math.max(0, S.totalRounds)) });
  }
  function onFile(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!d.agents || !d.rounds || !d.meta) throw new Error('Missing meta / agents / rounds — not a town_data.json');
        live.disconnect();
        emit('cmd-load-data', { data: d });
        toast('Loaded ' + f.name, '📂');
      } catch (err) { toast('Could not load file: ' + err.message, '⚠️', 'bad'); }
    };
    rd.readAsText(f);
  }
  function renderControls() {
    $play.textContent = S.playing ? '⏸' : '▶';
    $play.classList.toggle('active', S.playing);
    $speedBtns.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === S.speed));
    $roundLbl.textContent = `R ${S.round}/${S.totalRounds}`;
  }

  // =====================================================================
  // SIDEBAR scaffold
  // =====================================================================
  const TABS = [['feed', '📰', 'Feed'], ['agent', '🧑', 'Agent'], ['stats', '📊', 'Town'], ['god', '⚡', 'God']];
  const $panels = {};
  const $tabBtns = {};
  const $tablist = el('div', { class: 'tabs', role: 'tablist' });
  const $sheetHandle = el('button', { class: 'sheet-handle', 'aria-label': 'Expand or collapse panel', onclick: () => $side.classList.toggle('sheet-collapsed') }, el('span', { class: 'grip' }));
  for (const [id, ic, label] of TABS) {
    $tabBtns[id] = el('button', { class: 'tab', role: 'tab', id: 'tab-' + id, onclick: () => { setTab(id); $side.classList.remove('sheet-collapsed'); } }, el('span', { class: 'tic', 'aria-hidden': 'true' }, ic), ' ', label);
    $panels[id] = el('section', { class: 'panel', role: 'tabpanel', 'aria-labelledby': 'tab-' + id });
    $tablist.append($tabBtns[id]);
  }
  $side.replaceChildren($sheetHandle, $tablist, ...Object.values($panels));
  function setTab(id) {
    S.tab = id;
    for (const k in $panels) {
      $panels[k].hidden = k !== id;
      $tabBtns[k].classList.toggle('active', k === id);
      $tabBtns[k].setAttribute('aria-selected', k === id);
    }
    if (id === 'stats') refreshStats();
    if (id === 'agent') refreshAgentDynamic();
  }

  // =====================================================================
  // FEED
  // =====================================================================
  const $fAgent = el('select', { 'aria-label': 'Filter by agent', onchange: () => { S.filters.agent = $fAgent.value; applyFeedFilter(); } });
  const $fPlat = el('select', { 'aria-label': 'Filter by platform', onchange: () => { S.filters.platform = $fPlat.value; applyFeedFilter(); } },
    el('option', { value: 'all' }, 'All places'), el('option', { value: 'twitter' }, '🐦 Town Square'), el('option', { value: 'reddit' }, '📜 Forum'));
  const TYPE_GROUPS = [['default', 'All actions'], ['POST', 'Posts'], ['COMMENT', 'Comments'], ['LIKE', 'Likes'], ['DISLIKE', 'Dislikes'],
    ['REPOST', 'Reposts/quotes'], ['FOLLOW', 'Follows'], ['GOD', 'God events'], ['IDLE', 'Idle']];
  const $fType = el('select', { 'aria-label': 'Filter by type', onchange: () => { S.filters.type = $fType.value; applyFeedFilter(); } },
    TYPE_GROUPS.map(([v, l]) => el('option', { value: v }, l)));
  const $feedList = el('div', { class: 'feed-list', role: 'log', 'aria-live': 'off' });
  const $feedEmpty = el('div', { class: 'empty' }, 'The town is quiet. Press play to watch what happens.');
  $panels.feed.append(el('div', { class: 'filters' }, $fAgent, $fPlat, $fType), $feedList, $feedEmpty);

  function feedMatches(it) {
    const f = S.filters, t = it.dataset.type;
    if (f.agent !== 'all' && it.dataset.agent !== f.agent) return false;
    if (f.platform !== 'all' && it.dataset.platform !== f.platform && t !== 'GOD') return false;
    if (f.type === 'default') return t !== 'IDLE';
    if (f.type === 'REPOST') return t === 'REPOST' || t === 'QUOTE';
    return t === f.type;
  }
  function applyFeedFilter() {
    for (const it of $feedList.children) it.hidden = !feedMatches(it);
    $feedEmpty.hidden = [...$feedList.children].some(i => !i.hidden);
  }
  function feedText(a, ag) {
    const tgt = a.target_agent_id != null ? agent(a.target_agent_id) : null;
    switch (a.type) {
      case 'POST': case 'QUOTE': case 'COMMENT': return (a.content || '');
      case 'FOLLOW': return tgt ? `→ ${tgt.name}` : '';
      case 'LIKE': case 'DISLIKE': case 'REPOST':
        return (tgt ? `${tgt.name}: ` : '') + trunc(a.target_content || '', 120);
      case 'SEARCH': return a.content || '';
      default: return a.content || '';
    }
  }
  function addFeedItem(a, ag, opts = {}) {
    if (!opts.god && a.id != null) { if (S.feedIds.has(a.id)) return; S.feedIds.add(a.id); }
    const type = opts.god ? 'GOD' : a.type;
    const plat = PLATFORM[a.platform];
    const stance = ag ? ag.stance : 'observer';
    const it = el('article', { class: 'feed-item' + (opts.god ? ' god' : '') + (` t-${type}`), dataset: { agent: String(ag ? ag.id : 'god'), platform: a.platform || '', type } },
      el('span', { class: 'dot', style: { background: opts.god ? '#f2b84b' : STANCE_COLOR[stance] || '#999' }, title: stance }, opts.god ? '⚡' : (ag ? ag.name.trim().charAt(0).toUpperCase() : '?')),
      el('div', { class: 'fi-body' },
        el('div', { class: 'fi-head' },
          el('span', { class: 'fi-name' }, opts.god ? 'GOD' : (ag ? ag.name : `Agent ${a.agent_id}`)),
          plat && el('span', { class: 'badge plat', title: plat.label }, plat.icon),
          el('span', { class: 'fi-ic', title: type }, ICONS[type] || '•'),
          el('span', { class: 'fi-verb' }, opts.god ? '' : (VERBS[type] || type.toLowerCase())),
          el('span', { class: 'fi-time' }, opts.time || '')),
        (opts.god ? a.content : feedText(a, ag)) && el('div', { class: 'fi-text' }, opts.god ? a.content : feedText(a, ag))));
    if (!opts.god && ag) it.addEventListener('click', () => emit('cmd-select-agent', { agentId: ag.id }));
    it.hidden = !feedMatches(it);
    const sc = $panels.feed;
    const before = $feedList.scrollHeight;
    if (opts.append) $feedList.append(it); else $feedList.prepend(it);
    while ($feedList.children.length > FEED_CAP) $feedList.lastElementChild.remove();
    if (!it.hidden) $feedEmpty.hidden = true;
    if (!opts.append && $feedList.scrollTop > 0) $feedList.scrollTop += $feedList.scrollHeight - before;
    void sc;
  }
  function timeLabel(r) { const rr = S.data && S.data.rounds.find(x => x.round === r); return rr ? `D${rr.day} ${pad2(rr.hour)}:${pad2(rr.minute)}` : `R${r}`; }
  function rebuildFeed(upTo) {
    $feedList.replaceChildren();
    S.feedIds.clear();
    S.likeCounts.clear();
    const acts = [];
    for (const r of roundsUpTo(upTo)) for (const a of r.actions) {
      if (a.type === 'LIKE' && a.post_id) S.likeCounts.set(a.post_id, (S.likeCounts.get(a.post_id) || 0) + 1);
      if (a.type !== 'IDLE') acts.push([r, a]);
    }
    for (const [r, a] of acts.slice(-60)) addFeedItem(a, agent(a.agent_id), { append: false, time: timeLabel(r.round) });
    for (const [, a] of acts) S.feedIds.add(a.id);
    $feedEmpty.hidden = $feedList.children.length > 0;
    applyFeedFilter();
  }

  // =====================================================================
  // AGENT INSPECTOR
  // =====================================================================
  const $agentBody = el('div', { class: 'agent-body' });
  $panels.agent.append($agentBody);
  let $dyn = null, $moodMarker = null, $moodTxt = null, $statsGrid = null, $recent = null, $rel = null, $askInput = null, $askBtn = null, $askLog = null, $askHint = null;

  function pill(text, cls, color) { return el('span', { class: 'pill ' + (cls || ''), style: color ? { '--pc': color } : null }, text); }
  function renderAgent() {
    const ag = agent(S.selected);
    $agentBody.replaceChildren();
    if (!ag) {
      $agentBody.append(el('div', { class: 'empty' }, 'Click an agent in the town or in the feed to inspect them.'));
      return;
    }
    $moodMarker = el('span', { class: 'mood-marker' });
    $moodTxt = el('span', { class: 'mood-txt' });
    $statsGrid = el('div', { class: 'stat-grid' });
    $recent = el('div', { class: 'recent' });
    $rel = el('div', { class: 'rel' });
    const follow = el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: S.follow ? true : null, onchange: e => { S.follow = e.target.checked; emit('cmd-follow-camera', { agentId: S.follow ? ag.id : null }); } }), ' 🎥 Follow camera');
    $askLog = el('div', { class: 'chat-log' });
    $askInput = el('input', { type: 'text', placeholder: `Ask ${ag.name}…`, maxlength: 400, 'aria-label': 'Question for agent', onkeydown: e => { if (e.key === 'Enter') ask(ag); } });
    $askBtn = el('button', { class: 'btn primary', onclick: () => ask(ag) }, 'Ask');
    $askHint = el('div', { class: 'hint' });
    (S.chats.get(ag.id) || []).forEach(m => $askLog.append(chatMsg(m.who, m.text, m.cls)));
    $agentBody.append(
      el('header', { class: 'ag-head' },
        el('span', { class: 'dot big', style: { background: STANCE_COLOR[ag.stance] } }, ag.name.trim().charAt(0).toUpperCase()),
        el('div', {}, el('h2', {}, ag.name), el('div', { class: 'muted' }, '@' + ag.username)),
        el('button', { class: 'btn icon', title: 'Deselect (Esc)', 'aria-label': 'Deselect', onclick: () => emit('cmd-select-agent', { agentId: null }) }, '✕')),
      el('div', { class: 'pills' }, pill(ag.type, 'type'), pill(ag.stance, 'stance', STANCE_COLOR[ag.stance]),
        ag.mbti && pill(ag.mbti), ag.age != null && pill(ag.age + ' y/o'), ag.profession && pill(ag.profession)),
      ag.bio && el('p', { class: 'bio' }, ag.bio),
      ag.persona && el('details', { class: 'persona' }, el('summary', {}, 'Persona'), el('p', {}, ag.persona)),
      el('div', { class: 'mood' }, el('div', { class: 'mood-bar', title: 'Mood (-1 grumpy … +1 happy)' }, $moodMarker), $moodTxt),
      $statsGrid, follow,
      el('h3', {}, 'Recent actions'), $recent,
      el('h3', {}, 'Relationships'), $rel,
      el('h3', {}, 'Ask this agent'), $askLog,
      el('div', { class: 'ask-row' }, $askInput, $askBtn), $askHint);
    updateAskState();
    refreshAgentDynamic();
  }
  function chatMsg(who, text, cls) { return el('div', { class: 'msg ' + (cls || '') }, el('b', {}, who), ' ', text); }
  function updateAskState() {
    if (!$askInput) return;
    const ok = live.connected;
    $askInput.disabled = !ok; $askBtn.disabled = !ok;
    $askHint.textContent = ok
      ? 'Interviews need the simulation environment to still be alive on the backend (it waits for commands after the run finishes). Answers can take up to a minute.'
      : 'Interviews are only available when connected to a live MiroFish simulation (use the “Live” button). Replay files cannot answer questions.';
  }
  async function ask(ag) {
    const q = $askInput.value.trim();
    if (!q || !live.connected) return;
    $askInput.value = ''; $askBtn.disabled = true;
    const log = S.chats.get(ag.id) || []; S.chats.set(ag.id, log);
    const push = (who, text, cls) => { log.push({ who, text, cls }); if (S.selected === ag.id && $askLog) { $askLog.append(chatMsg(who, text, cls)); $askLog.scrollTop = 1e6; } };
    push('You', q, 'me');
    try {
      const rs = await live.interview(live.simId, ag.id, q);
      rs.forEach(r => push(ag.name + (r.platform ? ` (${PLATFORM[r.platform]?.label || r.platform})` : ''), r.response, 'them'));
    } catch (e) { push('Error', e.message, 'err'); }
    if ($askBtn) $askBtn.disabled = !live.connected;
  }
  function refreshAgentDynamic() {
    const ag = agent(S.selected);
    if (!ag || !$statsGrid || S.tab !== 'agent') return;
    let st = null;
    try { st = engine.getAgentState(ag.id); } catch { /* ignore */ }
    if (st) {
      const m = clamp(st.mood ?? 0, -1, 1);
      $moodMarker.style.left = ((m + 1) / 2 * 100) + '%';
      $moodTxt.textContent = `${m > 0.35 ? '😄' : m > 0.1 ? '🙂' : m < -0.35 ? '😠' : m < -0.1 ? '😕' : '😐'} ${m.toFixed(2)} · ${st.activity || ''}`;
      const s = st.stats || {};
      $statsGrid.replaceChildren(...[['Posts', s.posts], ['Likes', s.likes], ['Comments', s.comments], ['Follows', s.follows], ['Followers', s.followers]]
        .map(([l, v]) => el('div', { class: 'stat' }, el('b', {}, v ?? 0), el('span', {}, l))));
    }
    // recent
    const rec = [];
    outer: for (let i = S.data.rounds.length - 1; i >= 0; i--) {
      const r = S.data.rounds[i]; if (r.round > S.round) continue;
      for (let j = r.actions.length - 1; j >= 0; j--) {
        const a = r.actions[j];
        if (a.agent_id === ag.id && a.type !== 'IDLE') { rec.push([r, a]); if (rec.length >= 8) break outer; }
      }
    }
    $recent.replaceChildren(...(rec.length ? rec.map(([r, a]) => el('div', { class: 'rec' }, el('span', { class: 'fi-ic' }, ICONS[a.type] || '•'), ' ',
      el('span', { class: 'muted' }, timeLabel(r.round) + ' '), trunc(feedText(a, ag) || VERBS[a.type], 110))) : [el('div', { class: 'muted' }, 'Nothing yet.')]));
    const fol = S.data.follows.filter(f => f.round <= S.round);
    const chips = ids => ids.length ? ids.slice(0, 40).map(id => { const o = agent(id); return o && el('button', { class: 'chip', onclick: () => emit('cmd-select-agent', { agentId: id }) }, el('i', { style: { background: STANCE_COLOR[o.stance] } }), o.name); }) : [el('span', { class: 'muted' }, 'none')];
    $rel.replaceChildren(el('div', { class: 'muted small' }, 'Followers'), el('div', { class: 'chips' }, chips(fol.filter(f => f.to === ag.id).map(f => f.from))),
      el('div', { class: 'muted small' }, 'Following'), el('div', { class: 'chips' }, chips(fol.filter(f => f.from === ag.id).map(f => f.to))));
  }

  // =====================================================================
  // TOWN STATS
  // =====================================================================
  const $spark = el('canvas', { class: 'spark', height: 64, 'aria-label': 'Actions per round' });
  const $statsBody = el('div', { class: 'stats-body' });
  $panels.stats.append($statsBody);
  let statsTimer = null;
  function scheduleStats() { if (S.tab !== 'stats' || statsTimer) return; statsTimer = setTimeout(() => { statsTimer = null; refreshStats(); }, 500); }
  function bars(map, colorFn, total) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => el('div', { class: 'bar-row' },
      el('span', { class: 'bl' }, k), el('span', { class: 'bt' }, el('i', { style: { width: (v / Math.max(1, total) * 100) + '%', background: colorFn(k) } })), el('span', { class: 'bv' }, v)));
  }
  function refreshStats() {
    if (S.tab !== 'stats') return;
    if (!S.data) { $statsBody.replaceChildren(el('div', { class: 'empty' }, 'No data loaded.')); return; }
    const byType = new Map(), byStance = new Map();
    S.data.agents.forEach(a => { byType.set(a.type, (byType.get(a.type) || 0) + 1); byStance.set(a.stance, (byStance.get(a.stance) || 0) + 1); });
    const perRound = [], likes = new Map(), recvLikes = new Map(), words = new Map(), authors = new Map();
    for (const r of roundsUpTo(S.round)) {
      let n = 0;
      for (const a of r.actions) {
        if (a.type !== 'IDLE') n++;
        if (a.type === 'LIKE' && a.post_id) { likes.set(a.post_id, (likes.get(a.post_id) || 0) + 1); if (a.target_agent_id != null) recvLikes.set(a.target_agent_id, (recvLikes.get(a.target_agent_id) || 0) + 1); }
        if ((a.type === 'POST' || a.type === 'COMMENT' || a.type === 'QUOTE') && a.content) {
          tokenize(a.content).forEach(w => words.set(w, (words.get(w) || 0) + 1));
          if (a.type === 'POST' && a.post_id) authors.set(a.post_id, a);
        }
      }
      perRound.push(n);
    }
    const followers = new Map();
    S.data.follows.filter(f => f.round <= S.round).forEach(f => followers.set(f.to, (followers.get(f.to) || 0) + 1));
    const topPosts = [...authors.entries()].map(([pid, a]) => [pid, a, likes.get(pid) || 0]).sort((x, y) => y[2] - x[2]).slice(0, 5);
    const topWords = [...words.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14);
    const infl = S.data.agents.map(a => [a, (followers.get(a.id) || 0) * 2 + (recvLikes.get(a.id) || 0)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = perRound.reduce((a, b) => a + b, 0);
    $statsBody.replaceChildren(
      el('div', { class: 'stat-grid' }, ...[['Agents', S.data.agents.length], ['Actions', total], ['Posts', authors.size], ['Follows', S.data.follows.filter(f => f.round <= S.round).length]]
        .map(([l, v]) => el('div', { class: 'stat' }, el('b', {}, v), el('span', {}, l)))),
      el('h3', {}, 'Population by stance'), el('div', { class: 'bars' }, bars(byStance, k => STANCE_COLOR[k] || '#999', S.data.agents.length)),
      el('h3', {}, 'Population by type'), el('div', { class: 'bars' }, bars(byType, () => 'var(--accent)', S.data.agents.length)),
      el('h3', {}, 'Actions per round'), $spark,
      el('h3', {}, 'Top posts'), topPosts.length ? el('ol', { class: 'list' }, topPosts.map(([pid, a, n]) => el('li', { onclick: () => emit('cmd-select-agent', { agentId: a.agent_id }) },
        el('b', {}, `👍 ${n}`), ' ', el('span', { class: 'muted' }, (agent(a.agent_id)?.name || '?') + ': '), trunc(a.content, 100)))) : el('div', { class: 'muted' }, 'No posts yet.'),
      el('h3', {}, 'Trending words'), el('div', { class: 'words' }, topWords.length ? topWords.map(([w, c], i) => el('span', { class: 'word', style: { fontSize: (0.8 + 0.5 * (1 - i / topWords.length)) + 'rem' } }, w, el('sup', {}, c))) : el('span', { class: 'muted' }, 'Nothing trending yet.')),
      el('h3', {}, 'Most influential'), infl.length ? el('ol', { class: 'list' }, infl.map(([a, sc]) => el('li', { onclick: () => emit('cmd-select-agent', { agentId: a.id }) },
        el('i', { class: 'mini-dot', style: { background: STANCE_COLOR[a.stance] } }), ' ', el('b', {}, a.name), el('span', { class: 'muted' }, ` · score ${sc} · ${followers.get(a.id) || 0} followers`))))
        : el('div', { class: 'muted' }, 'No influence yet.'));
    drawSpark(perRound);
  }
  function tokenize(text) {
    const out = [];
    const m = text.toLowerCase().match(/#?[\p{L}\p{N}_']+/gu) || [];
    for (const t of m) {
      if (/[㐀-鿿]/.test(t)) { const c = t.replace(/[^㐀-鿿]/g, ''); for (let i = 0; i < c.length - 1; i++) out.push(c.slice(i, i + 2)); }
      else { const w = t.replace(/^'+|'+$/g, ''); if ((w.length >= 4 || (w[0] === '#' && w.length > 2)) && !STOP.has(w) && !/^\d+$/.test(w)) out.push(w); }
    }
    return out;
  }
  function drawSpark(vals) {
    const c = $spark, w = c.clientWidth || 300, h = 64, dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#f2a65a';
    const n = Math.max(vals.length, S.totalRounds + 1, 2), mx = Math.max(1, ...vals);
    g.strokeStyle = css.getPropertyValue('--line').trim() || '#444'; g.beginPath(); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.stroke();
    if (vals.length < 2) return;
    g.beginPath();
    vals.forEach((v, i) => { const x = i / (n - 1) * w, y = h - 4 - v / mx * (h - 10); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = accent; g.lineWidth = 1.6; g.stroke();
    g.lineTo((vals.length - 1) / (n - 1) * w, h); g.lineTo(0, h); g.closePath(); g.globalAlpha = 0.18; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
    g.fillStyle = css.getPropertyValue('--muted').trim() || '#999'; g.font = '10px sans-serif'; g.fillText('max ' + mx, 4, 11);
  }

  // =====================================================================
  // GOD MODE
  // =====================================================================
  const $rumor = el('input', { type: 'text', placeholder: 'A strange light was seen over the plaza…', maxlength: 140, 'aria-label': 'Rumor text', onkeydown: e => { if (e.key === 'Enter') god('rumor', $rumor.value.trim() || 'A mysterious rumor spreads…'); } });
  function god(kind, text, label) {
    emit('cmd-god-event', { text, kind });
    addFeedItem({ content: label || text, platform: '' }, null, { god: true, time: timeLabel(S.round) });
    toast(label || text, ICONS.GOD, 'god');
    if (kind === 'rumor') $rumor.value = '';
  }
  $panels.god.append(
    el('div', { class: 'god-intro' }, el('p', {}, 'Play with the town. Events are ', el('b', {}, 'purely visual in replay'), ' — they ripple across the map and are logged in the feed, but they do not change the recorded simulation data.')),
    el('h3', {}, '🗣️ Spread a rumor'), el('div', { class: 'ask-row' }, $rumor, el('button', { class: 'btn primary', onclick: () => god('rumor', $rumor.value.trim() || 'A mysterious rumor spreads…') }, 'Whisper')),
    el('h3', {}, '🌦️ Weather'), el('div', { class: 'god-row' },
      el('button', { class: 'btn god-btn', onclick: () => god('weather', 'rain', 'Rain begins to fall 🌧️') }, '🌧️ Rain'),
      el('button', { class: 'btn god-btn', onclick: () => god('weather', 'snow', 'Snow blankets the town ❄️') }, '❄️ Snow'),
      el('button', { class: 'btn god-btn', onclick: () => god('weather', 'clear', 'The sky clears ☀️') }, '☀️ Clear')),
    el('h3', {}, '🎉 Festival'), el('div', { class: 'god-row' }, el('button', { class: 'btn god-btn', onclick: () => god('festival', 'festival', 'A festival begins in the plaza 🎉') }, '🎉 Start festival')));

  // =====================================================================
  // TIMELINE
  // =====================================================================
  const $tl = el('canvas', { class: 'tl-canvas', 'aria-label': 'Timeline' });
  const $tlTip = el('div', { class: 'tl-tip', hidden: true });
  $time.replaceChildren(el('div', { class: 'tl-wrap' }, $tl, $tlTip));
  let tlCounts = [], tlSpikes = new Set(), tlDrag = false, tlRounds = [];
  function computeTimeline() {
    tlRounds = S.data ? S.data.rounds : [];
    tlCounts = tlRounds.map(r => r.actions.filter(a => a.type !== 'IDLE').length);
    const n = tlCounts.length || 1, mean = tlCounts.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(tlCounts.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    tlSpikes = new Set(); tlCounts.forEach((c, i) => { if (c > mean + 1.5 * sd && c > 3) tlSpikes.add(i); });
  }
  function roundFromX(x) {
    const w = $tl.clientWidth, n = Math.max(1, S.totalRounds + 1);
    return clamp(Math.round(x / w * (n - 1) + 0), 0, Math.max(0, S.totalRounds));
  }
  function drawTimeline() {
    const w = $tl.clientWidth, h = $tl.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if ($tl.width !== Math.round(w * dpr)) { $tl.width = Math.round(w * dpr); $tl.height = Math.round(h * dpr); }
    const g = $tl.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement), C = k => css.getPropertyValue(k).trim();
    const n = Math.max(1, S.totalRounds + 1), bw = w / n, top = 14, base = h - 3, mx = Math.max(1, ...tlCounts);
    let lastDay = null;
    tlRounds.forEach((r, i) => {
      const x = i * bw;
      if (r.day !== lastDay) {
        if (lastDay !== null) { g.fillStyle = C('--line'); g.fillRect(x, 0, 1, h); }
        g.fillStyle = C('--muted'); g.font = '10px sans-serif'; g.fillText('Day ' + r.day, x + 4, 10); lastDay = r.day;
      }
      const bh = tlCounts[i] / mx * (base - top - 2);
      g.fillStyle = r.round <= S.round ? C('--accent') : C('--bar-future');
      g.fillRect(x + (bw > 3 ? 0.5 : 0), base - bh, Math.max(1, bw - (bw > 3 ? 1 : 0)), bh);
      if (tlSpikes.has(i)) { g.fillStyle = C('--warn'); g.beginPath(); g.moveTo(x + bw / 2, top - 1); g.lineTo(x + bw / 2 - 3, top - 7); g.lineTo(x + bw / 2 + 3, top - 7); g.fill(); }
    });
    const px = (S.round + 0.5) * bw;
    g.fillStyle = C('--text'); g.fillRect(px - 1, 0, 2, h);
    g.beginPath(); g.arc(px, h - 5, 4, 0, 7); g.fill();
  }
  function tlPointer(e, commit) {
    const r = $tl.getBoundingClientRect(), x = e.clientX - r.left;
    const n = Math.max(1, S.totalRounds + 1), rd = clamp(Math.floor(x / r.width * n), 0, Math.max(0, S.totalRounds));
    if (commit) emit('cmd-seek', { round: rd });
    const rr = tlRounds[rd];
    $tlTip.hidden = false; $tlTip.textContent = rr ? `R${rd} · D${rr.day} ${pad2(rr.hour)}:${pad2(rr.minute)} · ${tlCounts[rd]} actions${tlSpikes.has(rd) ? ' ⚡ spike' : ''}` : `R${rd}`;
    $tlTip.style.left = clamp(x, 70, r.width - 70) + 'px';
  }
  $tl.addEventListener('pointerdown', e => { tlDrag = true; $tl.setPointerCapture(e.pointerId); tlPointer(e, true); });
  $tl.addEventListener('pointermove', e => tlPointer(e, tlDrag));
  $tl.addEventListener('pointerup', () => { tlDrag = false; });
  $tl.addEventListener('pointerleave', () => { if (!tlDrag) $tlTip.hidden = true; });
  new ResizeObserver(() => { drawTimeline(); if (S.tab === 'stats') refreshStats(); }).observe($time);

  // =====================================================================
  // TOASTS
  // =====================================================================
  function toast(text, icon, cls) {
    const t = el('div', { class: 'toast ' + (cls || '') }, el('span', { class: 'toast-ic' }, icon || '✨'), el('span', {}, text));
    $toasts.append(t);
    while ($toasts.children.length > 4) $toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4700);
  }
  const LIKE_STEPS = [5, 10, 25, 50, 100];
  function checkToasts(a) {
    if (a.type === 'LIKE' && a.post_id) {
      const n = (S.likeCounts.get(a.post_id) || 0) + 1;
      S.likeCounts.set(a.post_id, n);
      if (LIKE_STEPS.includes(n)) {
        const p = S.data.posts[a.post_id], au = p && agent(p.author_id);
        toast(`${au ? au.name + '’s' : 'A'} post just hit ${n} likes: “${trunc(p ? p.content : '', 60)}”`, '🔥');
      }
    } else if (a.type === 'FOLLOW' && !S.crossFollowToasted) {
      const f = agent(a.agent_id), t = agent(a.target_agent_id);
      if (f && t && ((f.stance === 'supportive' && t.stance === 'opposing') || (f.stance === 'opposing' && t.stance === 'supportive'))) {
        S.crossFollowToasted = true;
        toast(`${f.name} (${f.stance}) followed ${t.name} (${t.stance}) — a bridge across the divide!`, '🤝');
      }
    }
  }

  // =====================================================================
  // LIVE DIALOG
  // =====================================================================
  function openLiveDialog() {
    const info = live.getInfo();
    const $url = el('input', { type: 'text', value: tryStore('st.liveUrl') || info.baseUrl || 'http://localhost:5001', id: 'live-url', autocomplete: 'off' });
    const $sim = el('input', { type: 'text', value: tryStore('st.liveSim') || info.simId || '', id: 'live-sim', placeholder: 'sim_xxxxxxxxxxxx', autocomplete: 'off' });
    const $stat = el('div', { class: 'live-status', role: 'status' });
    const $go = el('button', { class: 'btn primary', onclick: go }, 'Connect');
    const $dis = el('button', { class: 'btn', onclick: () => { live.disconnect(); } }, 'Disconnect');
    const close = () => { off(); $modal.replaceChildren(); document.removeEventListener('keydown', escClose, true); };
    const escClose = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    function show(i) {
      const map = { disconnected: 'Not connected.', connecting: 'Checking backend…', loading: 'Loading config and profiles…', connected: `Connected to ${i.simId}. Waiting for rounds…`,
        running: `Live: ${i.runInfo.runner_status} · round ${i.runInfo.current_round}/${i.runInfo.total_rounds} · ${i.rounds} rounds imported`,
        completed: `Simulation completed · ${i.rounds} rounds imported`, stopped: `Simulation stopped · ${i.rounds} rounds imported`, idle: `Connected; simulation is idle (not started) · ${i.rounds} rounds imported` };
      $stat.className = 'live-status' + (i.status === 'error' ? ' err' : i.connected ? ' ok' : '');
      $stat.textContent = i.status === 'error' ? '⚠ ' + i.error : (map[i.status] || i.status);
      $go.disabled = i.status === 'connecting' || i.status === 'loading';
      $dis.hidden = !i.connected;
    }
    const off = live.onChange(show);
    async function go() {
      tryStore('st.liveUrl', $url.value.trim()); tryStore('st.liveSim', $sim.value.trim());
      try { await live.connect($sim.value.trim(), $url.value.trim()); setTimeout(close, 900); } catch { /* shown by status */ }
    }
    const dlg = el('div', { class: 'modal-backdrop', onclick: e => { if (e.target === dlg) close(); } },
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Connect to live simulation' },
        el('h2', {}, '📡 Connect to a live simulation'),
        el('p', { class: 'muted' }, 'Watch a running MiroFish simulation as it happens. The game polls the backend every 3 seconds.'),
        el('label', { for: 'live-url' }, 'Backend URL'), $url, el('label', { for: 'live-sim' }, 'Simulation ID'), $sim, $stat,
        el('div', { class: 'modal-actions' }, $dis, el('button', { class: 'btn', onclick: close }, 'Close'), $go)));
    $modal.replaceChildren(dlg);
    document.addEventListener('keydown', escClose, true);
    show(info);
    setTimeout(() => $sim.focus(), 0);
  }
  live.onChange(i => {
    $liveBtn.classList.toggle('live-on', i.connected);
    $liveBtn.textContent = i.connected ? (i.status === 'error' ? '📡 Live ⚠' : '🔴 Live') : '📡 Live';
    updateAskState();
  });

  // =====================================================================
  // KEYBOARD
  // =====================================================================
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || $modal.children.length) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (tag === 'BUTTON') e.target.blur(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(1); }
    else if (e.key >= '1' && e.key <= '5') emit('cmd-speed', { speed: SPEEDS[+e.key - 1] });
    else if (e.key === 'Escape') emit('cmd-select-agent', { agentId: null });
  });

  // =====================================================================
  // BUS
  // =====================================================================
  function onData(data) {
    S.data = data; S.agents = new Map(data.agents.map(a => [a.id, a]));
    S.totalRounds = data.meta.total_rounds ?? Math.max(0, data.rounds.length - 1);
    S.crossFollowToasted = false; S.selected = null; S.follow = false;
    $simTitle.textContent = data.meta.title || data.meta.simulation_id || 'Simulation';
    $simTitle.title = data.meta.requirement || '';
    const opts = [el('option', { value: 'all' }, 'All agents'), ...[...data.agents].sort((a, b) => a.name.localeCompare(b.name)).map(a => el('option', { value: String(a.id) }, a.name))];
    $fAgent.replaceChildren(...opts); S.filters.agent = 'all';
    prevRound = 0; computeTimeline(); rebuildFeed(S.round = 0);
    renderAgent(); refreshStats(); drawTimeline(); renderControls();
  }
  on('data-loaded', ({ data }) => onData(data));
  let prevRound = 0;
  on('round', ({ round, day, hour, minute }) => {
    const jump = round < prevRound || round > prevRound + 1;
    S.round = round; S.day = day; S.hour = hour; S.minute = minute; prevRound = round;
    $clock.textContent = `Day ${day} · ${pad2(hour)}:${pad2(minute)}`;
    if (jump && S.data) rebuildFeed(round);
    renderControls(); drawTimeline(); scheduleStats();
    if (S.tab === 'agent') refreshAgentDynamic();
  });
  on('action', ({ action, agent: ag }) => {
    if (!S.data || !action) return;
    const a = ag ? S.agents.get(ag.id) || ag : S.agents.get(action.agent_id);
    const wasNew = !S.feedIds.has(action.id);
    addFeedItem(action, a, { time: timeLabel(S.round) });
    if (wasNew) checkToasts(action);
  });
  on('state', s => {
    S.playing = s.playing; S.speed = s.speed; S.round = s.round ?? S.round;
    if (s.totalRounds != null && s.totalRounds !== S.totalRounds) { S.totalRounds = s.totalRounds; drawTimeline(); }
    renderControls();
  });
  on('agent-selected', ({ agentId }) => {
    S.selected = agentId ?? null;
    if (S.follow && agentId == null) S.follow = false;
    renderAgent();
    if (agentId != null) setTab('agent'); else if (S.tab === 'agent') setTab('feed');
  });
  setInterval(() => { if (S.tab === 'agent' && S.selected != null && S.playing) refreshAgentDynamic(); }, 1000);

  // initial
  setTab('feed'); renderAgent(); renderControls();
  $statsBody.append(el('div', { class: 'empty' }, 'No data loaded.'));
  const d0 = engine.getData && engine.getData();
  if (d0) onData(d0);
  return { toast, live };
}
