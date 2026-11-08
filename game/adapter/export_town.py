#!/usr/bin/env python3
"""Convert a MiroFish simulation directory into Swarm Town's town_data.json (schema v1).

Usage:
    python3 export_town.py <sim_dir> -o town_data.json [--title T] [--max-content 280] [--validate]
    python3 export_town.py --validate-file town_data.json

Only the Python standard library is used. Missing files/tables produce warnings, not crashes.
"""
import argparse
import csv
import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict, deque

PLATFORMS = ("twitter", "reddit")
OUT_TYPES = ("POST", "COMMENT", "LIKE", "DISLIKE", "REPOST", "QUOTE", "FOLLOW", "MUTE", "SEARCH", "TREND", "IDLE")
STANCES = ("supportive", "opposing", "neutral", "observer")
TYPE_MAP = {
    "CREATE_POST": "POST", "CREATE_COMMENT": "COMMENT",
    "LIKE_POST": "LIKE", "LIKE_COMMENT": "LIKE",
    "DISLIKE_POST": "DISLIKE", "DISLIKE_COMMENT": "DISLIKE",
    "REPOST": "REPOST", "QUOTE_POST": "QUOTE", "FOLLOW": "FOLLOW", "MUTE": "MUTE",
    "SEARCH_POSTS": "SEARCH", "SEARCH_USER": "SEARCH", "TREND": "TREND", "DO_NOTHING": "IDLE",
}
SKIP_TYPES = {"INTERVIEW", "SIGN_UP", "REFRESH", "UNFOLLOW", "UNMUTE", "LISTEN_FROM_GROUP", "CREATE_GROUP",
              "JOIN_GROUP", "LEAVE_GROUP", "SEND_TO_GROUP", "PURCHASE_PRODUCT", "REPORT_POST", "UPDATE_REC_TABLE",
              "EXIT"}
NEEDS_TARGET = ("COMMENT", "LIKE", "DISLIKE", "REPOST", "QUOTE", "FOLLOW", "MUTE")


# --------------------------------------------------------------------------- helpers
def to_int(v):
    if v is None or isinstance(v, bool):
        return None
    try:
        if isinstance(v, str):
            v = v.strip()
            if ":" in v:
                v = v.rsplit(":", 1)[1]
        return int(v)
    except (ValueError, TypeError):
        return None


def to_float(v, default):
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


def clean(s, limit=None):
    if s is None:
        return None
    s = re.sub(r"\s+", " ", str(s)).strip()
    if limit and len(s) > limit:
        s = s[: max(1, limit - 1)].rstrip() + "…"
    return s


def norm_name(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def first(d, keys):
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return None


def read_json(path, warn):
    if not os.path.isfile(path):
        warn("missing file: %s" % os.path.basename(path))
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        warn("cannot parse %s: %s" % (os.path.basename(path), e))
        return None


def round_time(rnd, mpr, start_hour):
    """Contract: hour = (start + floor(((round-1)*mpr)/60)) mod 24; round 0 = initial posts at start_hour."""
    if rnd <= 0:
        return 1, start_hour % 24, 0
    mins = (rnd - 1) * mpr
    hour = (start_hour + mins // 60) % 24
    day = 1 + (start_hour * 60 + mins) // (24 * 60)
    return day, hour, mins % 60


def normalize_stance(stance, bias):
    s = str(stance or "").strip().lower()
    if s in STANCES:
        return s
    if s in ("support", "pro", "positive", "favorable"):
        return "supportive"
    if s in ("oppose", "against", "negative", "opposed", "critical"):
        return "opposing"
    if bias is not None:
        if bias > 0.25:
            return "supportive"
        if bias < -0.25:
            return "opposing"
        return "neutral"
    return "neutral"


# --------------------------------------------------------------------------- sqlite access
class PlatformDB:
    def __init__(self, path, platform, warn):
        self.platform = platform
        self.available = False
        self.users, self.posts, self.comments, self.follows = {}, {}, {}, {}
        self.mutes_by_id = {}
        self.mutes_by_muter = defaultdict(deque)
        self.follows_by_follower = defaultdict(deque)
        self.post_lookup = defaultdict(deque)      # (user_id, text) -> post_ids in order
        self.comment_lookup = defaultdict(deque)   # (user_id, text) -> comment_ids
        self.comment_counts = Counter()
        self.trace = []
        if not os.path.isfile(path):
            warn("missing database: %s" % os.path.basename(path))
            return
        try:
            con = sqlite3.connect("file:%s?mode=ro" % os.path.abspath(path), uri=True)
            con.row_factory = sqlite3.Row
        except sqlite3.Error as e:
            warn("cannot open %s: %s" % (os.path.basename(path), e))
            return
        self.available = True

        def rows(sql, name):
            try:
                return [dict(r) for r in con.execute(sql)]
            except sqlite3.Error as e:
                warn("%s: table '%s' unreadable (%s)" % (os.path.basename(path), name, e))
                return []

        for r in rows("SELECT * FROM user", "user"):
            uid = to_int(first(r, ("agent_id", "user_id")))
            if uid is not None:
                self.users[uid] = r
        for r in rows("SELECT * FROM post ORDER BY post_id", "post"):
            pid = to_int(r.get("post_id"))
            if pid is None:
                continue
            self.posts[pid] = r
            uid = to_int(r.get("user_id"))
            for txt in (r.get("content"), r.get("quote_content")):
                if txt:
                    self.post_lookup[(uid, str(txt).strip())].append(pid)
        for r in rows("SELECT * FROM comment ORDER BY comment_id", "comment"):
            cid = to_int(r.get("comment_id"))
            if cid is None:
                continue
            self.comments[cid] = r
            self.comment_counts[to_int(r.get("post_id"))] += 1
            self.comment_lookup[(to_int(r.get("user_id")), str(r.get("content") or "").strip())].append(cid)
        for r in rows("SELECT * FROM follow ORDER BY follow_id", "follow"):
            fid = to_int(r.get("follow_id"))
            self.follows[fid] = r
            self.follows_by_follower[to_int(r.get("follower_id"))].append(fid)
        for r in rows("SELECT * FROM mute", "mute"):
            mid = to_int(r.get("mute_id"))
            self.mutes_by_id[mid] = r
            self.mutes_by_muter[to_int(r.get("muter_id"))].append(r)
        self.trace = rows("SELECT rowid AS _rowid, * FROM trace ORDER BY rowid", "trace")
        con.close()


# --------------------------------------------------------------------------- the exporter
class Exporter:
    def __init__(self, sim_dir, max_content=280, title=None, start_hour=0):
        self.dir = sim_dir
        self.max_content = max_content
        self.title = title
        self.start_hour = start_hour
        self.warnings = []
        self.config = {}
        self.agents = {}          # id -> agent dict
        self.name_map = {}
        self.dbs = {}
        self.reg = {p: {} for p in PLATFORMS}      # created/known posts
        self.creg = {p: {} for p in PLATFORMS}     # comments known from actions
        self.follows = []
        self._follow_seen = set()
        self.unresolved = Counter()
        self.unresolved_post = Counter()
        self.by_type = Counter()
        self.dedup = 0
        self.skipped = Counter()
        self.seen_posts = set()
        self.synthetic = Counter()
        self.max_round_seen = 0
        self.content_pid = {}     # (platform, author_id, content) -> post_id learned from other actions
        self.next_pid = {p: 1 for p in PLATFORMS}

    def warn(self, msg):
        self.warnings.append(msg)

    def t(self, s, limit=None):
        return clean(s, limit or self.max_content)

    # ---- agents
    def load_agents(self):
        d = self.dir
        cfg = read_json(os.path.join(d, "simulation_config.json"), self.warn)
        self.config = cfg if isinstance(cfg, dict) else {}
        profiles = {}
        rp = read_json(os.path.join(d, "reddit_profiles.json"), self.warn)
        if isinstance(rp, list):
            for p in rp:
                uid = to_int(p.get("user_id", p.get("agent_id")))
                if uid is not None:
                    profiles[uid] = dict(p)
        tcsv = os.path.join(d, "twitter_profiles.csv")
        tprof = {}
        if os.path.isfile(tcsv):
            try:
                with open(tcsv, encoding="utf-8", newline="") as f:
                    for row in csv.DictReader(f):
                        uid = to_int(row.get("user_id"))
                        if uid is not None:
                            tprof[uid] = row
            except (OSError, csv.Error) as e:
                self.warn("cannot read twitter_profiles.csv: %s" % e)
        else:
            self.warn("missing file: twitter_profiles.csv")

        entries = []
        for c in self.config.get("agent_configs") or []:
            uid = to_int(c.get("agent_id"))
            if uid is not None:
                entries.append((uid, c))
        if not entries:
            ids = sorted(set(profiles) | set(tprof))
            if ids:
                self.warn("no agent_configs; building agents from profiles")
            entries = [(i, {}) for i in ids]
        self._pending_agent_entries = (entries, profiles, tprof)

    def build_agents(self):
        entries, profiles, tprof = self._pending_agent_entries
        for uid, c in entries:
            self._make_agent(uid, c, profiles.get(uid, {}), tprof.get(uid, {}))
        # fall back to sqlite user tables
        for db in self.dbs.values():
            for uid, r in db.users.items():
                if uid not in self.agents:
                    self._make_agent(uid, {}, {"name": r.get("name"), "username": r.get("user_name"),
                                                "bio": r.get("bio")}, {})

    def _make_agent(self, uid, c, rp, tp):
        name = first(c, ("entity_name",)) or first(rp, ("name",)) or first(tp, ("name",)) or "Agent %d" % uid
        username = first(rp, ("username",)) or first(tp, ("username",)) or re.sub(r"\W+", "_", name.lower()).strip("_")
        bias = c.get("sentiment_bias")
        bias = max(-1.0, min(1.0, to_float(bias, 0.0)))
        hours = c.get("active_hours")
        hours = sorted({h % 24 for h in (to_int(x) for x in hours) if h is not None}) if isinstance(hours, list) else []
        age = to_int(rp.get("age"))
        agent = {
            "id": uid, "name": clean(name), "username": str(username).lstrip("@"),
            "type": str(first(c, ("entity_type",)) or "Agent"),
            "bio": clean(first(rp, ("bio",)) or first(tp, ("description",)) or "", 600),
            "persona": clean(first(rp, ("persona",)) or first(tp, ("user_char",)) or "", 1500),
            "stance": normalize_stance(c.get("stance"), bias if "sentiment_bias" in c else None),
            "sentiment_bias": bias,
            "influence": to_float(c.get("influence_weight"), 1.0),
            "activity_level": to_float(c.get("activity_level"), 0.5),
            "active_hours": hours or list(range(24)),
            "profession": clean(rp.get("profession")) if rp.get("profession") else None,
            "mbti": rp.get("mbti") or None,
            "age": age,
        }
        self.agents[uid] = agent
        for key in (name, username, rp.get("name"), tp.get("name"), tp.get("username"), c.get("entity_name")):
            n = norm_name(key)
            if n:
                self.name_map.setdefault(n, uid)

    def name_to_id(self, name):
        n = norm_name(name)
        return self.name_map.get(n) if n else None

    def ensure_agent(self, uid, name=None):
        if uid is None:
            return
        if uid not in self.agents:
            self.warn("agent %s appears in actions but not in config/profiles; created stub" % uid)
            self._make_agent(uid, {}, {"name": name}, {})

    # ---- raw action loading
    def load_raw(self):
        raw = []
        seq = 0
        for p in PLATFORMS:
            self.dbs[p] = PlatformDB(os.path.join(self.dir, "%s_simulation.db" % p), p, self.warn)
        for p in PLATFORMS:
            path = os.path.join(self.dir, p, "actions.jsonl")
            got = 0
            if os.path.isfile(path):
                bad = 0
                with open(path, encoding="utf-8", errors="replace") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            o = json.loads(line)
                        except ValueError:
                            bad += 1
                            continue
                        if not isinstance(o, dict):
                            continue
                        if "action_type" not in o:
                            if o.get("event_type") in ("round_start", "round_end") and to_int(o.get("round")) is not None:
                                self.max_round_seen = max(self.max_round_seen, to_int(o["round"]))
                            continue
                        if o.get("success") is False:
                            self.skipped["failed"] += 1
                            continue
                        seq += 1
                        raw.append(dict(platform=p, round=to_int(o.get("round")) or 0, ts=str(o.get("timestamp") or ""),
                                        agent_id=to_int(o.get("agent_id")), agent_name=o.get("agent_name"),
                                        atype=str(o.get("action_type")).upper(),
                                        args=o.get("action_args") if isinstance(o.get("action_args"), dict) else {},
                                        seq=seq))
                        got += 1
                if bad:
                    self.warn("%s: %d unparsable lines skipped" % (path, bad))
            else:
                self.warn("missing file: %s/actions.jsonl" % p)
            if got == 0 and self.dbs[p].trace:
                n = self._raw_from_trace(p, raw, seq)
                seq += n
                if n:
                    self.warn("%s: no actions.jsonl data; reconstructed %d actions from sqlite trace table" % (p, n))
        for r in raw:
            self.max_round_seen = max(self.max_round_seen, r["round"])
        raw.sort(key=lambda r: (r["round"], r["ts"], r["seq"]))
        return raw

    def _raw_from_trace(self, p, raw, seq):
        rows = [r for r in self.dbs[p].trace if str(r.get("action") or "").upper() not in SKIP_TYPES]
        keep = []
        for r in rows:
            keep.append(r)
        vals = [r.get("created_at") for r in keep]
        ints = [to_int(v) if not isinstance(v, str) or re.fullmatch(r"\s*-?\d+\s*", v) else None for v in vals]
        use_int = bool(keep) and all(i is not None for i in ints)
        rank = {}
        if not use_int:
            for v in sorted({str(v) for v in vals}):
                rank[v] = len(rank) + 1
        n = 0
        for r, i in zip(keep, ints):
            info = r.get("info")
            args = {}
            if isinstance(info, str):
                try:
                    args = json.loads(info)
                except ValueError:
                    args = {}
            elif isinstance(info, dict):
                args = info
            if not isinstance(args, dict):
                args = {}
            n += 1
            raw.append(dict(platform=p, round=i if use_int else rank[str(r.get("created_at"))], ts="",
                            agent_id=to_int(r.get("user_id")), agent_name=None,
                            atype=str(r.get("action") or "").upper(), args=args, seq=seq + n))
        return n

    # ---- registry helpers
    def new_reg(self, p, pid, author, content, rnd, derived=False):
        e = self.reg[p].get(pid)
        if e is None:
            e = {"author_id": author, "content": content, "round": rnd, "likes": 0, "dislikes": 0, "shares": 0,
                 "comments": 0, "derived": derived}
            self.reg[p][pid] = e
        else:
            if e["author_id"] is None:
                e["author_id"] = author
            if not e["content"]:
                e["content"] = content
        return e

    def lookup_post(self, p, pid):
        pid = to_int(pid)
        if pid is None:
            return None, None
        db = self.dbs[p]
        row = db.posts.get(pid)
        if row:
            return to_int(row.get("user_id")), (row.get("quote_content") or row.get("content"))
        e = self.reg[p].get(pid)
        if e:
            return e["author_id"], e["content"]
        return None, None

    def target_post(self, p, args, rnd, name_keys, content_keys, pid_keys=("post_id",)):
        pid = to_int(first(args, pid_keys))
        author, content = self.lookup_post(p, pid)
        if author is None:
            author = self.name_to_id(first(args, name_keys))
        if not content:
            content = first(args, content_keys)
        if pid is not None and pid not in self.dbs[p].posts and (author is not None or content):
            self.new_reg(p, pid, author, content, rnd, derived=True)
        return pid, author, content

    def claim_post(self, p, aid, content, explicit=None):
        """Find/assign the id of a post just created by aid."""
        pid = to_int(explicit)
        text = str(content or "").strip()
        if pid is None:
            q = self.dbs[p].post_lookup.get((aid, text))
            while q:
                cand = q.popleft()
                if cand not in self.reg[p]:
                    pid = cand
                    break
        if pid is None:
            pid = self.content_pid.get((p, aid, text))
            if pid is not None and pid in self.reg[p]:
                pid = None
        if pid is None:
            while self.next_pid[p] in self.reg[p] or self.next_pid[p] in self.dbs[p].posts:
                self.next_pid[p] += 1
            pid = self.next_pid[p]
            self.synthetic[p] += 1
        return pid

    def prescan(self, raw):
        """Learn post ids / contents that other actions reveal, before converting."""
        mx = {p: 0 for p in PLATFORMS}
        for r in raw:
            p, a = r["platform"], r["args"]
            for k in ("post_id", "quoted_id", "new_post_id", "original_post_id"):
                v = to_int(a.get(k))
                if v is not None:
                    mx[p] = max(mx[p], v)
            pid = to_int(a.get("post_id"))
            if pid is None:
                continue
            author = self.name_to_id(first(a, ("post_author_name", "original_author_name")))
            content = first(a, ("post_content", "original_content"))
            if author is not None and content:
                self.content_pid.setdefault((p, author, str(content).strip()), pid)
        for p in PLATFORMS:
            m = max([mx[p]] + list(self.dbs[p].posts))
            self.next_pid[p] = m + 1

    # ---- conversion
    def convert(self, r):
        p, t, a, rnd = r["platform"], r["atype"], r["args"], r["round"]
        aid = r["agent_id"]
        if aid is None:
            self.skipped["no_agent"] += 1
            return None
        if t in SKIP_TYPES:
            self.skipped[t.lower()] += 1
            return None
        if t not in TYPE_MAP:
            self.skipped["unknown:" + t] += 1
            return None
        self.ensure_agent(aid, r.get("agent_name"))
        ot = TYPE_MAP[t]
        db = self.dbs[p]
        act = {"platform": p, "agent_id": aid, "type": ot, "content": None, "post_id": None,
               "target_agent_id": None, "target_content": None}
        pid = target = None
        tcontent = None

        if t == "CREATE_POST":
            content = first(a, ("content",)) or ""
            explicit = to_int(a.get("post_id"))
            k1 = (p, aid, str(content).strip())
            if explicit is not None and (p, "id", explicit) in self.seen_posts:
                self.dedup += 1
                return None
            if rnd <= 1 and k1 in self.seen_posts:
                self.dedup += 1
                return None
            pid = self.claim_post(p, aid, content, explicit)
            self.seen_posts.add(k1)
            self.seen_posts.add((p, "id", pid))
            self.new_reg(p, pid, aid, content, rnd)
            act["content"] = self.t(content)
        elif t == "QUOTE_POST":
            qtext = first(a, ("quote_content", "content")) or ""
            qid, target, tcontent = self.target_post(p, a, rnd, ("original_author_name", "post_author_name"),
                                                     ("original_content", "post_content"), ("quoted_id", "post_id"))
            pid = self.claim_post(p, aid, qtext, a.get("new_post_id"))
            self.new_reg(p, pid, aid, qtext, rnd)
            if qid is not None and qid in self.reg[p]:
                self.reg[p][qid]["shares"] += 1
            act["content"] = self.t(qtext)
            if pid is None:
                pid = qid
        elif t == "REPOST":
            pid, target, tcontent = self.target_post(p, a, rnd, ("original_author_name", "post_author_name"),
                                                     ("original_content", "post_content"),
                                                     ("post_id", "original_post_id"))
            if pid is None:
                row = db.posts.get(to_int(a.get("new_post_id")))
                if row and to_int(row.get("original_post_id")) is not None:
                    pid, target, tcontent = self.target_post(p, {"post_id": row["original_post_id"]}, rnd, (), ())
            if pid in self.reg[p]:
                self.reg[p][pid]["shares"] += 1
        elif t == "CREATE_COMMENT":
            content = first(a, ("content", "comment_content")) or ""
            cid = to_int(a.get("comment_id"))
            row = db.comments.get(cid) if cid is not None else None
            if row is None and cid is None:
                q = db.comment_lookup.get((aid, str(content).strip()))
                if q:
                    cid = q.popleft()
                    row = db.comments.get(cid)
            pid = to_int(row.get("post_id")) if row else to_int(a.get("post_id"))
            _, target, tcontent = self.target_post(p, dict(a, post_id=pid), rnd, ("post_author_name",),
                                                   ("post_content",))
            if cid is not None:
                self.creg[p][cid] = {"post_id": pid, "author_id": aid, "content": content}
            if pid in self.reg[p]:
                self.reg[p][pid]["comments"] += 1
            act["content"] = self.t(content)
        elif t in ("LIKE_POST", "DISLIKE_POST"):
            pid, target, tcontent = self.target_post(p, a, rnd, ("post_author_name",), ("post_content",))
            if pid in self.reg[p]:
                self.reg[p][pid]["likes" if t == "LIKE_POST" else "dislikes"] += 1
        elif t in ("LIKE_COMMENT", "DISLIKE_COMMENT"):
            cid = to_int(a.get("comment_id"))
            row = db.comments.get(cid)
            if row:
                pid, target, tcontent = to_int(row.get("post_id")), to_int(row.get("user_id")), row.get("content")
            elif cid in self.creg[p]:
                c = self.creg[p][cid]
                pid, target, tcontent = c["post_id"], c["author_id"], c["content"]
            else:
                pid = to_int(a.get("post_id"))
                target = self.name_to_id(first(a, ("comment_author_name",)))
                tcontent = first(a, ("comment_content",))
        elif t == "FOLLOW":
            fid = to_int(a.get("follow_id"))
            row = db.follows.get(fid)
            if row:
                target = to_int(row.get("followee_id"))
            if target is None:
                target = to_int(first(a, ("followee_id", "target_user_id", "followed_user_id")))
            if target is None:
                target = self.name_to_id(first(a, ("target_user_name", "followee_name", "user_name")))
            if target is None and fid is None:
                q = db.follows_by_follower.get(aid)
                if q:
                    target = to_int(db.follows[q.popleft()].get("followee_id"))
            if target is not None and (aid, target) not in self._follow_seen:
                self._follow_seen.add((aid, target))
                self.follows.append({"from": aid, "to": target, "round": rnd})
        elif t == "MUTE":
            mid = to_int(a.get("mute_id"))
            row = db.mutes_by_id.get(mid)
            if row:
                target = to_int(row.get("mutee_id"))
            if target is None:
                target = to_int(first(a, ("mutee_id", "target_user_id")))
            if target is None:
                target = self.name_to_id(first(a, ("target_user_name",)))
            if target is None and db.mutes_by_muter.get(aid):
                target = to_int(db.mutes_by_muter[aid].popleft().get("mutee_id"))
        elif t in ("SEARCH_POSTS", "SEARCH_USER"):
            act["content"] = self.t(first(a, ("query", "keywords", "content")))
        # TREND / DO_NOTHING carry nothing

        if target is not None and target not in self.agents:
            self.warn("target agent id %s is not a known agent (action by %s)" % (target, aid))
            target = None
        if ot in NEEDS_TARGET and target is None:
            self.unresolved[ot] += 1
        if ot in ("COMMENT", "LIKE", "DISLIKE", "REPOST") and pid is None:
            self.unresolved_post[ot] += 1
        act["post_id"] = "%s:%d" % (p, pid) if pid is not None else None
        act["target_agent_id"] = target
        act["target_content"] = self.t(tcontent) if tcontent else None
        self.by_type[ot] += 1
        return act

    # ---- posts
    def build_posts(self):
        posts = {}
        for p in PLATFORMS:
            db = self.dbs[p]
            for pid, row in db.posts.items():
                if to_int(row.get("original_post_id")) is not None and not row.get("quote_content"):
                    continue  # plain repost row: counted as a share of the original
                e = self.reg[p].get(pid, {})
                rnd = e.get("round")
                if rnd is None:
                    ca = row.get("created_at")
                    rnd = to_int(ca) if isinstance(ca, int) or (isinstance(ca, str) and ca.strip().isdigit()) else 0
                posts["%s:%d" % (p, pid)] = {
                    "author_id": to_int(row.get("user_id")),
                    "content": self.t(row.get("quote_content") or row.get("content") or ""),
                    "round": rnd or 0,
                    "likes": to_int(row.get("num_likes")) or 0, "dislikes": to_int(row.get("num_dislikes")) or 0,
                    "shares": to_int(row.get("num_shares")) or 0,
                    "comments": db.comment_counts.get(pid, e.get("comments", 0)),
                }
            for pid, e in self.reg[p].items():
                key = "%s:%d" % (p, pid)
                if key in posts or e["author_id"] is None:
                    continue
                posts[key] = {"author_id": e["author_id"], "content": self.t(e["content"] or ""), "round": e["round"],
                              "likes": e["likes"], "dislikes": e["dislikes"], "shares": e["shares"],
                              "comments": e["comments"]}
        for key, v in list(posts.items()):
            if v["author_id"] not in self.agents:
                self.warn("post %s has unknown author %s; dropped" % (key, v["author_id"]))
                del posts[key]
        return dict(sorted(posts.items(), key=lambda kv: (kv[0].split(":")[0], int(kv[0].split(":")[1]))))

    # ---- main
    def run(self):
        self.load_agents()
        raw = self.load_raw()
        self.build_agents()
        if not raw and not self.agents:
            raise SystemExit("error: nothing to export: no agents and no actions found in %s" % self.dir)
        if not raw:
            self.warn("no actions found (no actions.jsonl and no usable trace tables)")
        self.prescan(raw)
        converted = []
        for r in raw:
            a = self.convert(r)
            if a:
                converted.append((r["round"], a))
        cfg = self.config
        tc = cfg.get("time_config") or {}
        mpr = to_int(tc.get("minutes_per_round")) or 60
        if not tc.get("minutes_per_round"):
            self.warn("minutes_per_round missing; assuming 60")
        total = max([self.max_round_seen] + [r for r, _ in converted] + [0])
        if total == 0:
            th = to_float(tc.get("total_simulation_hours"), 0)
            total = int(th * 60 // mpr) if th else 0
        rounds = []
        by_round = defaultdict(list)
        for rnd, a in converted:
            by_round[rnd].append(a)
        for rnd in range(0, total + 1):
            day, hour, minute = round_time(rnd, mpr, self.start_hour)
            acts = by_round.get(rnd, [])
            for i, a in enumerate(acts):
                a["id"] = "r%d-%d" % (rnd, i + 1)
            acts = [dict([("id", a["id"])] + [(k, v) for k, v in a.items() if k != "id"]) for a in acts]
            rounds.append({"round": rnd, "day": day, "hour": hour, "minute": minute, "actions": acts})
        ev = cfg.get("event_config") or {}
        state = read_json(os.path.join(self.dir, "state.json"), lambda m: None) or {}
        sim_id = state.get("simulation_id") or cfg.get("simulation_id") or os.path.basename(os.path.abspath(self.dir))
        req = cfg.get("simulation_requirement") or ""
        platforms = [p for p in PLATFORMS if any(a["platform"] == p for _, a in converted)] or \
                    [p for p in PLATFORMS if self.dbs[p].available]
        title = self.title or (clean(re.split(r"(?<=[.!?])\s", req.strip())[0], 90) if req else "Swarm Town: %s" % sim_id)
        meta = {
            "simulation_id": str(sim_id), "title": title, "requirement": clean(req, 2000) or "",
            "narrative": clean(ev.get("narrative_direction"), 2000) or "",
            "hot_topics": [clean(x, 120) for x in (ev.get("hot_topics") or []) if x],
            "platforms": platforms, "minutes_per_round": mpr, "total_rounds": total, "start_hour": self.start_hour,
            "source": "sample" if state.get("is_sample") else "mirofish",
        }
        agents = [self.agents[i] for i in sorted(self.agents)]
        return {"version": 1, "meta": meta, "agents": agents, "rounds": rounds, "posts": self.build_posts(),
                "follows": self.follows}

    def summary(self, data):
        lines = ["Swarm Town export summary", "  simulation : %s" % data["meta"]["simulation_id"],
                 "  platforms  : %s" % ", ".join(data["meta"]["platforms"]),
                 "  agents     : %d" % len(data["agents"]),
                 "  rounds     : %d (+ round 0), %d min/round" % (data["meta"]["total_rounds"],
                                                                  data["meta"]["minutes_per_round"]),
                 "  posts      : %d   follows: %d" % (len(data["posts"]), len(data["follows"])),
                 "  actions    : %d total" % sum(self.by_type.values())]
        for t in OUT_TYPES:
            if self.by_type[t]:
                lines.append("      %-8s %5d" % (t, self.by_type[t]))
        lines.append("  duplicates removed (initial-post bug): %d" % self.dedup)
        if self.synthetic.total():
            lines.append("  synthetic post ids assigned: %s" % dict(self.synthetic))
        if self.skipped:
            lines.append("  skipped: %s" % dict(self.skipped))
        lines.append("  unresolved targets : %s" % (dict(self.unresolved) or "none"))
        lines.append("  actions missing post_id : %s" % (dict(self.unresolved_post) or "none"))
        for w in dict.fromkeys(self.warnings):
            lines.append("  WARNING: %s" % w)
        return "\n".join(lines)


# --------------------------------------------------------------------------- validation
def validate(data):
    """Return a list of contract violations (empty list == valid)."""
    errs = []

    def err(m):
        if len(errs) < 200:
            errs.append(m)

    def isint(v):
        return isinstance(v, int) and not isinstance(v, bool)

    def isnum(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool)

    if not isinstance(data, dict):
        return ["root is not an object"]
    if data.get("version") != 1:
        err("version must be 1")
    meta = data.get("meta")
    if not isinstance(meta, dict):
        err("meta missing")
        meta = {}
    for k in ("simulation_id", "title", "requirement", "narrative"):
        if not isinstance(meta.get(k), str):
            err("meta.%s must be str" % k)
    if not (isinstance(meta.get("hot_topics"), list) and all(isinstance(x, str) for x in meta["hot_topics"])):
        err("meta.hot_topics must be [str]")
    pl = meta.get("platforms")
    if not (isinstance(pl, list) and pl and all(x in PLATFORMS for x in pl)):
        err("meta.platforms must be a non-empty subset of twitter/reddit")
    for k in ("minutes_per_round", "total_rounds", "start_hour"):
        if not isint(meta.get(k)):
            err("meta.%s must be int" % k)
    if isint(meta.get("minutes_per_round")) and meta["minutes_per_round"] <= 0:
        err("meta.minutes_per_round must be > 0")
    if meta.get("source") not in ("mirofish", "sample"):
        err("meta.source must be mirofish|sample")

    ids = set()
    agents = data.get("agents")
    if not isinstance(agents, list) or not agents:
        err("agents must be a non-empty list")
        agents = []
    for i, a in enumerate(agents):
        w = "agents[%d]" % i
        if not isinstance(a, dict):
            err(w + " not an object")
            continue
        if not isint(a.get("id")):
            err(w + ".id must be int")
        elif a["id"] in ids:
            err(w + ".id duplicate %s" % a["id"])
        else:
            ids.add(a["id"])
        for k in ("name", "username", "type", "bio", "persona"):
            if not isinstance(a.get(k), str):
                err("%s.%s must be str" % (w, k))
        if a.get("stance") not in STANCES:
            err(w + ".stance invalid: %r" % a.get("stance"))
        sb = a.get("sentiment_bias")
        if not (isnum(sb) and -1 <= sb <= 1):
            err(w + ".sentiment_bias must be number in [-1,1]")
        for k in ("influence", "activity_level"):
            if not isnum(a.get(k)):
                err("%s.%s must be number" % (w, k))
        ah = a.get("active_hours")
        if not (isinstance(ah, list) and all(isint(h) and 0 <= h <= 23 for h in ah)):
            err(w + ".active_hours must be [int 0-23]")
        for k, ty in (("profession", str), ("mbti", str)):
            if a.get(k) is not None and not isinstance(a.get(k), ty):
                err("%s.%s must be %s|null" % (w, k, ty.__name__))
        if a.get("age") is not None and not isint(a.get("age")):
            err(w + ".age must be int|null")

    posts = data.get("posts")
    if not isinstance(posts, dict):
        err("posts must be an object")
        posts = {}
    for key, p in posts.items():
        w = "posts[%s]" % key
        if not re.fullmatch(r"(twitter|reddit):\d+", key):
            err(w + " bad key")
        if not isinstance(p, dict):
            err(w + " not an object")
            continue
        if p.get("author_id") not in ids:
            err(w + ".author_id unknown: %r" % p.get("author_id"))
        if not isinstance(p.get("content"), str):
            err(w + ".content must be str")
        for k in ("round", "likes", "dislikes", "shares", "comments"):
            if not isint(p.get(k)) or p[k] < 0:
                err("%s.%s must be int >= 0" % (w, k))

    rounds = data.get("rounds")
    if not isinstance(rounds, list) or not rounds:
        err("rounds must be a non-empty list")
        rounds = []
    mpr, sh = meta.get("minutes_per_round"), meta.get("start_hour")
    seen_ids = set()
    for i, r in enumerate(rounds):
        w = "rounds[%d]" % i
        if not isinstance(r, dict):
            err(w + " not an object")
            continue
        if r.get("round") != i:
            err("%s.round must be %d (sequential from 0)" % (w, i))
        if isint(mpr) and isint(sh) and mpr > 0:
            d, h, m = round_time(i, mpr, sh)
            if (r.get("day"), r.get("hour"), r.get("minute")) != (d, h, m):
                err("%s day/hour/minute %r != expected %r" % (w, (r.get("day"), r.get("hour"), r.get("minute")), (d, h, m)))
        if not isinstance(r.get("actions"), list):
            err(w + ".actions must be list")
            continue
        for j, a in enumerate(r["actions"]):
            x = "%s.actions[%d]" % (w, j)
            if not isinstance(a, dict):
                err(x + " not an object")
                continue
            if not isinstance(a.get("id"), str) or a["id"] in seen_ids:
                err(x + ".id must be a unique str")
            seen_ids.add(a.get("id"))
            if a.get("platform") not in PLATFORMS:
                err(x + ".platform invalid")
            elif isinstance(pl, list) and a["platform"] not in pl:
                err(x + ".platform not listed in meta.platforms")
            if a.get("agent_id") not in ids:
                err(x + ".agent_id unknown: %r" % a.get("agent_id"))
            t = a.get("type")
            if t not in OUT_TYPES:
                err(x + ".type invalid: %r" % t)
            for k in ("content", "post_id", "target_content"):
                if k not in a or (a[k] is not None and not isinstance(a[k], str)):
                    err("%s.%s must be str|null (key required)" % (x, k))
            if "target_agent_id" not in a or (a["target_agent_id"] is not None and a["target_agent_id"] not in ids):
                err(x + ".target_agent_id must be a known agent id|null")
            pid = a.get("post_id")
            if isinstance(pid, str):
                if not re.fullmatch(r"(twitter|reddit):\d+", pid):
                    err(x + ".post_id bad format: %r" % pid)
                elif pid.split(":")[0] != a.get("platform"):
                    err(x + ".post_id platform mismatch")
            if t in ("POST", "QUOTE"):
                if not a.get("content"):
                    err(x + " %s needs content" % t)
                if pid not in posts:
                    err(x + " %s post_id %r missing from posts{}" % (t, pid))
            if t == "COMMENT" and not a.get("content"):
                err(x + " COMMENT needs content")
    if isint(meta.get("total_rounds")) and rounds and len(rounds) != meta["total_rounds"] + 1:
        err("len(rounds)=%d but meta.total_rounds=%r (expected total_rounds+1)" % (len(rounds), meta.get("total_rounds")))

    fl = data.get("follows")
    if not isinstance(fl, list):
        err("follows must be a list")
        fl = []
    for i, f in enumerate(fl):
        if not (isinstance(f, dict) and f.get("from") in ids and f.get("to") in ids and isint(f.get("round"))):
            err("follows[%d] invalid: %r" % (i, f))
    return errs


# --------------------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="Export a MiroFish simulation directory to Swarm Town town_data.json")
    ap.add_argument("sim_dir", nargs="?", help="MiroFish simulation directory")
    ap.add_argument("-o", "--output", default="town_data.json", help="output JSON path (default: town_data.json)")
    ap.add_argument("--title", help="game title (default: derived from the simulation requirement)")
    ap.add_argument("--max-content", type=int, default=280, help="truncate texts to N chars (default 280)")
    ap.add_argument("--start-hour", type=int, default=0, help="simulated hour of round 1 (default 0)")
    ap.add_argument("--pretty", action="store_true", help="indent the output JSON")
    ap.add_argument("--validate", action="store_true", help="validate the exported file against the contract")
    ap.add_argument("--validate-file", metavar="JSON", help="only validate an existing town_data.json and exit")
    args = ap.parse_args(argv)

    if args.validate_file:
        with open(args.validate_file, encoding="utf-8") as f:
            errs = validate(json.load(f))
        print("INVALID: %d problem(s)" % len(errs) if errs else "VALID: %s conforms to schema v1" % args.validate_file)
        for e in errs:
            print("  - " + e)
        return 1 if errs else 0

    if not args.sim_dir:
        ap.error("sim_dir is required (or use --validate-file)")
    if not os.path.isdir(args.sim_dir):
        ap.error("not a directory: %s" % args.sim_dir)
    ex = Exporter(args.sim_dir, max_content=args.max_content, title=args.title, start_hour=args.start_hour)
    data = ex.run()
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        if args.pretty:
            json.dump(data, f, ensure_ascii=False, indent=1)
        else:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(ex.summary(data))
    print("  written    : %s (%d bytes)" % (args.output, os.path.getsize(args.output)))
    if args.validate:
        errs = validate(data)
        if errs:
            print("VALIDATION FAILED (%d):" % len(errs))
            for e in errs:
                print("  - " + e)
            return 1
        print("VALIDATION OK: conforms to schema v1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
