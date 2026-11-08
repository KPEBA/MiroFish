#!/usr/bin/env python3
"""Add CONTRACT v1.1 "three_walls" metadata to an exported town_data.json.

Usage:
    python3 three_walls_meta.py town.json mapping.json [-o out.json] [--pretty]

mapping.json:
{
  "world":  {"name": "Твердь", "rings": {"outer": "...", "middle": "...", "inner": "..."}},
  "title":  "optional new meta.title",
  "default_ring": "middle",
  "rings":  {                      # first match wins; keys are case-insensitive substrings
     "by_name": {"Сиві Плащі": "beyond", ...},     # matched against agent name/username
     "by_type": {"Garrison": "outer", ...}         # matched against agent type
  },
  "agent_ring": {"3": "inner"},    # explicit overrides by agent id
  "events": [ {"round": 1, "kind": "sighting", "ring": "outer", "title": "...", "text": "..."} ]
}
Only the standard library is used. The result is validated (v1 via export_town.validate + v1.1 checks).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_town import validate  # noqa: E402

RINGS = ("outer", "middle", "inner", "beyond")
EVENT_KINDS = ("sighting", "alarm", "breach", "evacuation", "expedition_out", "expedition_back",
               "shortage", "riot", "decree", "fire")


def pick_ring(agent, mapping):
    explicit = mapping.get("agent_ring", {})
    if str(agent["id"]) in explicit:
        return explicit[str(agent["id"])]
    rules = mapping.get("rings", {})
    hay_name = f"{agent.get('name') or ''} {agent.get('username') or ''}".lower()
    for key, ring in rules.get("by_name", {}).items():
        if key.lower() in hay_name:
            return ring
    hay_type = (agent.get("type") or "").lower()
    for key, ring in rules.get("by_type", {}).items():
        if key.lower() in hay_type:
            return ring
    return mapping.get("default_ring", "middle")


def check_v11(data):
    errs = []
    meta = data.get("meta", {})
    if meta.get("map") not in (None, "town", "three_walls"):
        errs.append(f"meta.map invalid: {meta.get('map')!r}")
    world = meta.get("world")
    if world is not None:
        if not isinstance(world.get("name"), str):
            errs.append("meta.world.name must be str")
        for k in ("outer", "middle", "inner"):
            if not isinstance((world.get("rings") or {}).get(k), str):
                errs.append(f"meta.world.rings.{k} must be str")
    total = meta.get("total_rounds") or 0
    for i, ev in enumerate(meta.get("events") or []):
        if not isinstance(ev.get("round"), int) or ev["round"] < 0 or (total and ev["round"] > total):
            errs.append(f"events[{i}].round invalid: {ev.get('round')!r}")
        if ev.get("kind") not in EVENT_KINDS:
            errs.append(f"events[{i}].kind invalid: {ev.get('kind')!r}")
        if ev.get("ring") not in ("outer", "middle", "inner", None):
            errs.append(f"events[{i}].ring invalid: {ev.get('ring')!r}")
        for f in ("title", "text"):
            if not isinstance(ev.get(f), str) or not ev[f]:
                errs.append(f"events[{i}].{f} must be non-empty str")
    for a in data.get("agents", []):
        if "ring" in a and a["ring"] not in RINGS:
            errs.append(f"agent {a.get('id')} ring invalid: {a['ring']!r}")
    return errs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("town_json")
    ap.add_argument("mapping_json")
    ap.add_argument("-o", "--output", help="output path (default: overwrite town_json)")
    ap.add_argument("--pretty", action="store_true")
    args = ap.parse_args(argv)

    with open(args.town_json, encoding="utf-8") as f:
        data = json.load(f)
    with open(args.mapping_json, encoding="utf-8") as f:
        mapping = json.load(f)

    meta = data.setdefault("meta", {})
    meta["map"] = "three_walls"
    if mapping.get("world"):
        meta["world"] = mapping["world"]
    if mapping.get("title"):
        meta["title"] = mapping["title"]
    for a in data.get("agents", []):
        a["ring"] = pick_ring(a, mapping)
    meta["events"] = sorted(mapping.get("events", []), key=lambda e: e["round"])

    errs = list(validate(data) or []) + check_v11(data)
    if errs:
        for e in errs[:50]:
            print("ERROR:", e, file=sys.stderr)
        return 1
    out = args.output or args.town_json
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2 if args.pretty else None)
    for a in data["agents"]:
        print(f"  {a['id']:>3} {a['ring']:<7} {a.get('type')}: {a['name']}")
    print(f"events={len(meta['events'])} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
