# Swarm Town — shared contract (original game, MiroFish visualizer)

Static browser game in /home/user/MiroFish/game. No build step, no frameworks, plain ES modules,
open via `python3 -m http.server` from game/. Canvas 2D, procedural pixel-art (no external assets).

## Files & owners
- adapter/export_town.py, adapter/make_sample_sim.py, data/town_data.json (sample) — ADAPTER agent
- index.html, js/engine.js, js/world.js, js/sprites.js — ENGINE agent
- js/ui.js, js/live.js, css/style.css — UI agent
- js/main.js — ENGINE agent (wires everything; imports ui.js `initUI(engine, bus)`)
- js/bus.js — fixed below (ENGINE agent creates it verbatim)

## town_data.json schema (v1)
{
  "version": 1,
  "meta": { "simulation_id": str, "title": str, "requirement": str, "narrative": str,
            "hot_topics": [str], "platforms": ["twitter","reddit"],
            "minutes_per_round": int, "total_rounds": int, "start_hour": 0, "source": "mirofish|sample" },
  "agents": [ { "id": int, "name": str, "username": str, "type": str /* entity_type */,
                "bio": str, "persona": str, "stance": "supportive|opposing|neutral|observer",
                "sentiment_bias": float /* -1..1 */, "influence": float, "activity_level": float,
                "active_hours": [int], "profession": str|null, "mbti": str|null, "age": int|null } ],
  "rounds": [ { "round": int, "day": int /*1-based*/, "hour": int /*0-23*/, "minute": int,
                "actions": [ {
                   "id": str /* unique */, "platform": "twitter|reddit", "agent_id": int,
                   "type": "POST|COMMENT|LIKE|DISLIKE|REPOST|QUOTE|FOLLOW|MUTE|SEARCH|TREND|IDLE",
                   "content": str|null,            /* text written by the agent */
                   "post_id": str|null,            /* "<platform>:<n>" created or targeted */
                   "target_agent_id": int|null,    /* author of targeted post / followee */
                   "target_content": str|null      /* snippet of targeted post/comment */
                } ] } ],
  "posts": { "<platform>:<n>": { "author_id": int, "content": str, "round": int,
                                 "likes": int, "dislikes": int, "shares": int, "comments": int } },
  "follows": [ { "from": int, "to": int, "round": int } ]
}
Time: hour = (start_hour + floor(((round-1)*minutes_per_round)/60)) mod 24, round 0 = initial posts at hour start_hour.

## Event bus (js/bus.js, exact content)
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));

## Events
Engine emits: 'data-loaded' {data} | 'round' {round, day, hour, minute} | 'action' {action, agent}
              | 'agent-selected' {agentId|null} | 'state' {playing, speed, round, totalRounds}
UI emits:     'cmd-play' {} | 'cmd-pause' {} | 'cmd-speed' {speed:0.5|1|2|4|8} | 'cmd-seek' {round}
              | 'cmd-select-agent' {agentId|null} | 'cmd-follow-camera' {agentId|null}
              | 'cmd-god-event' {text, kind:'rumor'|'weather'|'festival'} | 'cmd-load-data' {data}
Engine API object (exported from engine.js as `createEngine(canvas)`), returns
  { load(data), play(), pause(), setSpeed(x), seek(round), select(id), getData(), getAgentState(id) }
getAgentState(id) -> { id, x, y, mood /*-1..1*/, activity /*string*/, lastAction, stats:{posts,likes,comments,follows,followers} }

## Gameplay mapping (engine)
- Town map: central Plaza (twitter posts/reposts), Forum Hall (reddit posts/comments), Cafe, Library (SEARCH/TREND),
  Park, homes grouped into districts by agent `type`. Agents walk (A* or simple grid paths) to the place of their action.
- POST/QUOTE: walk to Plaza/Forum, speech bubble with content snippet, "noticeboard" grows.
- COMMENT/LIKE/DISLIKE/REPOST: walk toward target author (if known) and show emoji bubble (💬 👍 👎 🔁).
- FOLLOW: animated heart/line between agents; MUTE: 🔇.
- Day/night tint from hour; agents outside active_hours walk home and sleep (💤).
- Stance colors: supportive green, opposing red, neutral blue, observer gray. Mood drifts with likes/dislikes received.
- God events (cmd-god-event): visual only in replay (weather overlay, festival decorations, rumor ripple from Plaza) + logged in feed as "GOD".
