# Swarm Town data adapter

Turns a MiroFish simulation output directory into `town_data.json` (schema v1, see `../CONTRACT.md`).
Python 3 standard library only.

## 1. Try it with the bundled sample

```bash
cd game/adapter
python3 make_sample_sim.py                 # writes /home/user/mirofish-sample-sim/ (or pass another dir)
python3 export_town.py /home/user/mirofish-sample-sim -o ../data/town_data.json --pretty --validate
cd .. && python3 -m http.server 8000       # open http://localhost:8000
```

The sample ("Saltmarsh Bay debates a data center": 14 agents, 24 rounds x 60 min, Twitter + Reddit) uses the
real MiroFish file layout, both SQLite DBs, and reproduces the known bugs (initial posts logged twice,
comments without post_id, follows without target, mutes without target).

## 2. Export a real MiroFish run

```bash
python3 export_town.py /path/to/MiroFish/backend/uploads/simulations/<sim_id> \
    -o ../data/town_data.json --title "My Town" --max-content 280 --validate
```

Options: `--start-hour N` (simulated hour of round 1, default 0), `--pretty`, `--max-content N`,
`--validate` (check output against the contract; exit code 1 on failure),
`--validate-file FILE` (validate an existing JSON only).

The printed summary lists agents, rounds, actions by type, duplicates removed, warnings, and
targets that could not be resolved.

## 3. Load in the game
Serve `game/` with `python3 -m http.server`; the game loads `data/town_data.json`. A different file can be
pushed at runtime through the `cmd-load-data` event.

## Inputs used (all optional, missing ones produce warnings)
`simulation_config.json`, `reddit_profiles.json`, `twitter_profiles.csv`, `twitter/actions.jsonl`,
`reddit/actions.jsonl`, `twitter_simulation.db`, `reddit_simulation.db`, `state.json`.
If a platform has no `actions.jsonl`, actions are rebuilt from its SQLite `trace` table.

## Mapping decisions
- Types: CREATE_POST=POST, CREATE_COMMENT=COMMENT, LIKE_POST/LIKE_COMMENT=LIKE, DISLIKE_*=DISLIKE, REPOST, QUOTE_POST=QUOTE,
  FOLLOW, MUTE, SEARCH_POSTS/SEARCH_USER=SEARCH, TREND, DO_NOTHING=IDLE. INTERVIEW, failed actions, sign_up/refresh are skipped.
- Time: always the contract formula from `round` and `minutes_per_round` (log `simulated_hour` is ignored).
  Round 0 = initial posts. `total_rounds` = highest round seen (not the configured maximum); `rounds` has an entry
  for every round 0..total_rounds, empty ones included.
- Duplicates: a CREATE_POST repeating the same platform+author+content in round <= 1 is dropped, as is any repeated post_id.
- Targets: from SQLite (post author, comment -> post, follow/mute tables), else from names in the action args.
- `post_id`: the post created (POST, QUOTE) or targeted (COMMENT, LIKE, DISLIKE, REPOST). Comment likes point to the parent post.
- `posts{}` holds original posts and quotes (not plain reposts); counts come from SQLite, else are derived from actions.
