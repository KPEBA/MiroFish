#!/usr/bin/env python3
"""Generate a realistic FAKE MiroFish simulation directory (no LLM, deterministic).

Scenario: "Saltmarsh Bay", a small coastal town, debates a proposed NorthGrid data center.
14 agents, 24 rounds x 60 min, Twitter + Reddit. Mimics MiroFish/OASIS file formats, including the
known "initial posts duplicated in round 0 and round 1" bug and actions that lack targets.

Usage: python3 make_sample_sim.py [out_dir]     (default: /home/user/mirofish-sample-sim)
"""
import json
import os
import random
import shutil
import sqlite3
import sys
from collections import defaultdict

OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/user/mirofish-sample-sim"
SIM_ID = "sim_sample_saltmarsh"
ROUNDS = 24
MPR = 60

MARIA, TOM, PRIYA, DANA, GREG, LENA, JONAS, CHLOE, SAM, RITA, WALT, AMARA, HENRIK, PETE = range(14)

# id, name, username, type, stance, bias, influence, activity, active_hours, profession, mbti, age, gender, bio, persona
A = [
    (MARIA, "Maria Alvarez", "maria_alvarez", "Resident", "opposing", -0.6, 0.9, 0.7, list(range(6, 23)), "Elementary school teacher", "ISFJ", 41, "female",
     "Teacher, mom of two, 400 m from the Old Cannery. Asks too many questions at town meetings.",
     "Maria has lived in Saltmarsh Bay all her life and drinks well water. She distrusts big companies but is honest enough to correct herself when shown evidence."),
    (TOM, "Tom Becker", "tom_b_cold_storage", "Resident", "supportive", 0.6, 0.8, 0.6, list(range(0, 3)) + list(range(5, 22)), "Cold-storage technician", "ESTP", 38, "male",
     "Night shift at the cannery freezer. Two kids, one mortgage. Wants jobs that stay.",
     "Tom watched three local employers close. He believes the town needs steady paychecks and is impatient with what he sees as panic."),
    (PRIYA, "Priya Nair", "priya_courier", "Journalist", "neutral", 0.0, 2.4, 0.9, list(range(0, 24)), "Reporter, Bay Courier", "ENTJ", 33, "female",
     "Reporter at the Bay Courier. Documents over opinions. DMs open.",
     "Priya is relentless and fair. She keeps a public log of corrections and works late. A scoop matters to her, but accuracy matters more."),
    (DANA, "Dana Whitlock", "mayor_whitlock", "CityOfficial", "supportive", 0.5, 2.8, 0.6, list(range(7, 23)), "Mayor of Saltmarsh Bay", "ENFJ", 54, "female",
     "Mayor of Saltmarsh Bay. Proud of this town. Office hours Tuesdays.",
     "Dana champions the data center for the tax base but insists on process. She tends to speak in careful, formal sentences."),
    (GREG, "Greg Hallam", "council_hallam", "CityOfficial", "neutral", 0.1, 1.5, 0.5, list(range(8, 22)), "Town councilman", "ESTJ", 59, "male",
     "Councilman, District 2. Former harbor master. Practical over political.",
     "Greg believes in getting things built. He is defensive when criticized and has family ties to local contractors."),
    (LENA, "Lena Fischer", "lena_fischer", "Activist", "opposing", -0.9, 1.7, 0.9, list(range(0, 24)), "Coastal conservation organizer", "ENFP", 36, "female",
     "Tide Watch coalition. Protect the mudflats, protect the herons.",
     "Lena runs the Tide Watch coalition. Passionate, quick to organize, sometimes quick to assume the worst of developers."),
    (JONAS, "Jonas Reyes", "jonas_reyes", "Activist", "opposing", -0.7, 1.2, 0.7, list(range(9, 24)), "Union electrician turned organizer", "INTJ", 45, "male",
     "Organizer. Community benefits, not corporate promises.",
     "Jonas is pro-jobs but anti-secrecy. He pushes for enforceable community benefit agreements and gets angry at vague promises."),
    (CHLOE, "Chloe Park", "chloe_park", "Student", "opposing", -0.7, 0.8, 0.9, list(range(0, 3)) + list(range(7, 24)), "Environmental science student", "INFP", 20, "female",
     "Env sci @ Bay State. Petitions, memes, and tide charts.",
     "Chloe is idealistic and online constantly. She mobilizes classmates but sometimes shares claims before checking them."),
    (SAM, "Sam Okoye", "sam_okoye", "Student", "neutral", 0.0, 0.7, 0.8, list(range(0, 4)) + list(range(10, 24)), "Computer science student", "INTP", 21, "male",
     "CS student. Sleep is optional. Curious about everything, committed to nothing yet.",
     "Sam likes the technology but not the secrecy. He asks naive questions that turn out to be good ones."),
    (RITA, "Rita Moreno", "rita_moreno", "BusinessOwner", "supportive", 0.7, 1.1, 0.7, list(range(5, 22)), "Owner, Harbor Light Diner", "ESFJ", 49, "female",
     "Harbor Light Diner. Pie since 1998. Every customer matters.",
     "Rita has watched her lunch crowd shrink since the cannery closed. Warm, talkative, optimistic, and not shy about telling people to calm down."),
    (WALT, "Walt Ferris", "walt_ferris", "BusinessOwner", "opposing", -0.5, 0.9, 0.6, list(range(4, 20)), "Owner, Ferris Marine Supply", "ISTJ", 62, "male",
     "Ferris Marine Supply since 1991. Boats, bait, and common sense.",
     "Walt depends on harbor traffic and the tidal flats. Grumpy but fair, concerned about trucks, noise, and what happens when a company leaves."),
    (AMARA, "Dr. Amara Singh", "dr_amara_singh", "Scientist", "neutral", 0.0, 1.8, 0.6, list(range(7, 23)), "Hydrogeologist, Bay State University", "INTJ", 44, "female",
     "Hydrogeologist. Aquifers, not opinions. I show my work.",
     "Amara cares about the aquifer and evidence. She writes long careful threads and corrects both sides."),
    (HENRIK, "Dr. Henrik Voss", "henrik_voss", "Scientist", "supportive", 0.4, 1.4, 0.5, list(range(8, 22)), "Power systems engineer", "ENTP", 51, "male",
     "Grid engineer. Curtailed wind is wasted wind. Opinions my own.",
     "Henrik sees data centers as a way to use surplus renewable power. Enthusiastic, occasionally condescending about 'non-technical' worries."),
    (PETE, "Pete Lund", "old_pete_lund", "Resident", "observer", 0.0, 0.6, 0.5, list(range(4, 22)), "Retired fisherman", "ISFP", 74, "male",
     "Retired fisherman. Walks the flats every morning. Watching, mostly.",
     "Pete has seen the cannery boom and bust. He rarely takes sides, and speaks in folksy observations."),
]
AG = {a[0]: a for a in A}
STANCE_SLANT = {"supportive": 1, "opposing": -1, "neutral": 0, "observer": 0}
rng = random.Random(20260314)

# --------------------------------------------------------------------------- scripted story
# (round, agent, platform, kind, text/query, key, ref, slant)
SCRIPT = []


def S(rnd, who, plat, kind, text=None, key=None, ref=None, sl=None):
    SCRIPT.append(dict(r=rnd, a=who, p=plat, k=kind, t=text, key=key, ref=ref, sl=sl))


T, R = "twitter", "reddit"
# round 0 - initial posts (event_config.initial_posts)
S(0, DANA, T, "post", "Big news for Saltmarsh Bay: the council is reviewing a proposal from NorthGrid to build a 40 MW data center on the Old Cannery site. Jobs, tax revenue, and a new fiber backbone. Public hearing Friday 6pm at Town Hall. #SaltmarshBay", "i1", sl=1)
S(0, PRIYA, R, "post", "Explainer: what we know about the proposed NorthGrid data center at the Old Cannery site. NorthGrid filed a 40 MW project with the planning office: roughly 120 permanent jobs, $2.1M a year in property tax, construction of about 18 months. Open questions: water supply for cooling, backup diesel generators, truck traffic on Cannery Road, and who benefits. I'll update this post as documents come in.", "i2", sl=0)
S(0, LENA, T, "post", "A 40 MW data center next to the tidal flats? Nobody asked the people who live here. Where will the cooling water come from? Where do the herons go? #NoDataCenter #SaltmarshBay", "i3", sl=-1)

S(1, SAM, T, "like", ref="i3")
S(2, SAM, T, "post", "can't sleep. reading about the data center thing. 40 MW is like... a lot? genuinely curious what that means for our power bill", "s1", sl=0)
S(2, LENA, T, "comment", "Short answer: nobody has published the grid-impact study. Ask for it at Friday's hearing.", ref="s1", key="s1c")
S(3, PRIYA, T, "post", "Working on follow-ups for the data center story. If you have documents or questions for Friday's hearing, DMs are open. I'll check everything before I publish it.", "pr0", sl=0)
S(3, SAM, T, "follow", ref=PRIYA)
S(4, LENA, R, "post", "Why I oppose the Old Cannery data center (long post). The site sits 200 m from the tidal flats, a feeding ground for herons and shorebirds. Construction means pile driving, dewatering, and about 300 truck trips a week. Operation means 24/7 noise from chillers and diesel backup tests. Tide Watch is not against technology. We are against a decision being made in a month with almost no public documents. Please come Friday.", "l_r", sl=-1)
S(4, CHLOE, R, "comment", "Signing the Tide Watch letter. I can print flyers at the library tomorrow.", ref="l_r")
S(5, PETE, T, "post", "Up at 4 like always. Tide's out and the mudflats smell like salt and herring. Hope they don't pave over my morning walk.", "pete1", sl=0)
S(5, LENA, T, "like", ref="pete1")
S(6, WALT, T, "post", "Opened the shop at 5. A data center on Cannery Road means ~300 truck trips a week during construction. Anyone seen the traffic study? Asking for the boats and the school buses both.", "w1", sl=-1)
S(6, PRIYA, T, "follow", ref=WALT)
S(7, CHLOE, T, "post", "Morning! Petition against the data center: 212 signatures already. Link in bio. Clean energy yes, backroom deals no. #SaveSaltmarsh", "c1", sl=-1)
S(7, JONAS, T, "repost", ref="c1")
S(7, TOM, T, "post", "Night shift at the cannery freezer ending. Honest question: where are the jobs if not projects like this? 120 permanent jobs is not nothing. #SaltmarshBay", "t1", sl=1)
S(7, RITA, T, "comment", "Amen, Tom. Come by the diner, breakfast is on me.", ref="t1")
S(8, MARIA, R, "comment", "I live 400 meters from the site and nobody sent me a notice. I teach second grade, I do not have time to read zoning filings. Why is this the first time we are hearing about it?", ref="i2", key="m_c1")
S(8, MARIA, T, "post", "Heard from my neighbor that the data center will pump 2 MILLION gallons of groundwater a DAY. Our wells will run dry by summer. Please share before Friday!", "rumor1", sl=-1)
S(8, DANA, T, "post", "Reminder: the hearing is Friday 6pm at Town Hall. All voices welcome, and written comments are open until Thursday. #SaltmarshBay", "d2", sl=1)
S(8, WALT, T, "like", ref="rumor1")
S(9, JONAS, T, "repost", ref="rumor1")
S(9, CHLOE, T, "quote", "If this is true we need answers NOW. @mayor_whitlock what is the water plan?", ref="rumor1", key="c_q1", sl=-1)
S(9, HENRIK, T, "comment", "Modern data centers typically use closed-loop cooling. 2M gallons/day sounds like an old evaporative design. Has anyone seen the actual permit application?", ref="rumor1", key="h1")
S(9, GREG, T, "post", "The council has not yet received a water-use filing from NorthGrid. I will post it here the moment we do.", "g1", sl=0)
S(9, SAM, T, "like", ref="h1")
S(9, PETE, T, "repost", ref="rumor1")
S(10, RITA, T, "post", "The diner has lost a third of its lunch crowd since the cannery closed. A data center means 120 families with paychecks. Let's not panic over a Facebook rumor, folks. #SaltmarshBay", "rita1", sl=1)
S(10, TOM, T, "repost", ref="rita1")
S(10, PRIYA, T, "comment", "Checking this: NorthGrid's filing mentions closed-loop cooling but I have asked for the water-supply agreement. Will report what I find, not what I heard.", ref="rumor1", key="pr1")
S(10, CHLOE, R, "post", "Megathread: the data center - what's confirmed, what's rumor, what's still unknown. Please source your claims. I'll keep the top comment updated.", "meg", sl=0)
S(10, MARIA, T, "like", ref="pr1")
S(11, AMARA, R, "comment", "Hydrogeologist here. Closed-loop systems use a small fraction of the 2M gallon figure, but the aquifer question is still real: construction dewatering and emergency backup cooling are separate. Ask for the water-supply agreement and monitoring wells.", ref="meg", key="am_c")
S(11, WALT, R, "comment", "Add traffic to the list. 300 trucks a week on a road that floods at spring tides.", ref="meg")
S(11, DANA, R, "comment", "Mayor here. I'm reading this thread. The town will publish every NorthGrid document received. Process first, vote second.", ref="meg", key="d_c")
S(11, PETE, R, "comment", "Back when the cannery ran, the whole town smelled of fish and nobody complained. Jobs mattered more. But we also drained the creek. Both things are true.", ref="meg")
S(11, JONAS, R, "like", ref="am_c")
S(12, PRIYA, T, "post", "BREAKING: Documents obtained by the Bay Courier show Councilman Greg Hallam met privately with NorthGrid executives in March, six weeks before the project was made public. His brother-in-law's firm, Hallam & Rowe Excavation, is listed as a site-prep subcontractor. #SaltmarshBay", "scandal", sl=-1)
S(12, PRIYA, R, "post", "Bay Courier investigation: Hallam met NorthGrid before the public did. Full documents attached to the story: March calendar entries, an email from NorthGrid's land agent thanking the councilman for 'early guidance', and a subcontractor list naming Hallam & Rowe Excavation, owned by his wife's brother. Hallam did not respond to two requests for comment before publication.", "scandal_r", sl=-1)
S(12, LENA, T, "quote", "This is exactly what we feared. A deal made in a back room, then a 'public hearing' to rubber-stamp it. #NoDataCenter", ref="scandal", key="l_q", sl=-1)
S(12, JONAS, T, "repost", ref="scandal")
S(12, MARIA, T, "repost", ref="scandal")
S(12, WALT, T, "dislike", ref="g1")
S(12, SAM, R, "comment", "Wait, so the councilman who is supposed to be neutral had meetings no one knew about? That's... not great.", ref="scandal_r", key="sam_c")
S(13, DANA, T, "post", "I was not aware of any private meetings. I have asked the town attorney to review all disclosures and will report back. Process matters, and so does trust. #SaltmarshBay", "d3", sl=0)
S(13, GREG, T, "post", "The March meeting was a general introduction with a local employer. I mentioned it verbally to colleagues and I have nothing to hide. My brother-in-law's firm bids on every town job. This is a smear.", "g2", sl=1)
S(13, CHLOE, T, "comment", "Verbally? Where is the record? The public can't attend a verbal disclosure.", ref="g2", key="c_c2")
S(13, TOM, T, "comment", "One meeting isn't corruption. Wait for facts before burning a man's name.", ref="g2")
S(13, MARIA, R, "comment", "I am a teacher, I disclose every gift over $20. A councilman can write down a meeting.", ref="scandal_r")
S(13, SAM, T, "search", "Hallam Rowe Excavation NorthGrid", key=None)
S(13, RITA, T, "like", ref="g2")
S(13, WALT, T, "dislike", ref="g2")
S(14, TOM, T, "mute", ref=LENA)
S(14, RITA, T, "mute", ref=JONAS)
S(14, HENRIK, T, "post", "Whatever one thinks of the politics, the grid case is real: the region curtails about 12% of wind output a year. A flexible load like a data center can soak that up. This is solvable with good siting and a binding efficiency standard.", "hv1", sl=1)
S(14, AMARA, T, "comment", "Fair point on curtailment. But 'flexible load' is a promise, not a contract. Ask NorthGrid to commit in writing to demand-response terms.", ref="hv1", key="am_hv")
S(14, SAM, T, "like", ref="am_hv")
S(15, GREG, T, "post", "I will recuse myself from all votes and deliberations on the NorthGrid proposal pending the town attorney's review. I should have documented the March meeting. That's on me.", "g3", sl=0)
S(15, PRIYA, T, "comment", "Noted. The Bay Courier will keep covering the review. Documents are posted at the link in my bio.", ref="g3")
S(15, LENA, T, "comment", "Recusal is a start but not enough. The whole process needs a reset, not just one seat.", ref="g3", key="l_c3")
S(15, PETE, T, "post", "A man owning up is worth more than ten men explaining. Hope the rest of us can do the same.", "pete2", sl=0)
S(15, DANA, T, "like", ref="g3")
S(16, AMARA, R, "post", "Ran the numbers on the aquifer. Using NorthGrid's filed design, closed-loop cooling needs roughly 15,000-40,000 gallons/day of make-up water, about 1-2% of the rumored 2M. That claim is almost certainly wrong. What is NOT trivial: (1) dewatering during construction, (2) the 11 diesel generators' fuel storage near the flats, (3) no monitoring wells in the plan. My recommendation: independent review plus six monitoring wells before any permit. Data and assumptions in the thread.", "am1", sl=0)
S(16, HENRIK, R, "comment", "Agree with the figures, though I would argue generator hours can be capped by permit. Let's ask for that.", ref="am1")
S(16, MARIA, R, "comment", "Thank you. So the 2 million figure was wrong?", ref="am1", key="m_c2")
S(16, AMARA, R, "comment", "Almost certainly wrong for normal operation. Construction and emergency modes are the real questions.", ref="am1", key="am_c2")
S(16, MARIA, T, "post", "Correction: the 2 million gallons/day claim I shared appears to be wrong. Still want monitoring wells and a real hearing. I'd rather be accurate than loud.", "maria2", sl=0)
S(16, CHLOE, T, "like", ref="maria2")
S(16, PRIYA, T, "repost", ref="maria2")
S(17, CHLOE, T, "post", "Student rally tonight 7pm on the Town Hall steps. Clean energy yes, backroom deals no. Bring signs, bring friends, bring thermoses. #SaveSaltmarsh", "c2", sl=-1)
S(17, SAM, T, "quote", "Count me in. Also bringing coffee for whoever's standing outside.", ref="c2", key="sam_q", sl=0)
S(17, RITA, T, "post", "Business owners: let's meet at the diner Wednesday 7am. Hear NorthGrid out, ask hard questions. Coffee and pie on me.", "rita2", sl=1)
S(17, WALT, T, "comment", "I'll be there, Rita. With a list.", ref="rita2")
S(18, DANA, T, "post", "Announcing an independent review: a third-party engineer will audit NorthGrid's water, traffic, and noise plans. Results public by December 1. The council vote waits for it. #SaltmarshBay", "d4", sl=0)
S(18, LENA, T, "comment", "An independent review is good. Who picks the reviewer, and who pays them?", ref="d4", key="l_c4")
S(18, PRIYA, R, "comment", "Follow-up: the mayor's office confirms the reviewer will be chosen by a three-person panel (one town, one university, one resident). I'll post the names when I have them.", ref="scandal_r", key="pr_c3")
S(18, TOM, T, "like", ref="d4")
S(18, HENRIK, T, "like", ref="d4")
S(19, JONAS, R, "post", "Proposal: a Community Benefits Agreement checklist for any data center. (1) Local hiring floor of 60%. (2) Written, enforceable water and noise limits. (3) Monitoring wells owned by the town. (4) Generator-test hours capped. (5) Annual public audit. (6) Decommissioning bond. If NorthGrid says yes to all six, I'll personally stop opposing.", "j1", sl=0)
S(19, TOM, R, "comment", "Finally something I can get behind. I'd add apprenticeship slots for the high school.", ref="j1", key="t_c")
S(19, AMARA, R, "comment", "Add: publish monthly water-use and temperature data. Transparency is cheap if the numbers are good.", ref="j1")
S(19, WALT, R, "comment", "Add: truck routes away from the harbor road. Put that in writing.", ref="j1")
S(19, SAM, T, "follow", ref=AMARA)
S(20, DANA, R, "comment", "Mayor here. We will add a Community Benefits Agreement item to the hearing agenda. Thank you, Jonas.", ref="j1", key="d_c2")
S(20, PETE, T, "post", "Went to the diner. Rita's pie, Walt's gripes, Maria's list of questions, Tom's grin. Funny how a town gets along better over pie.", "pete3", sl=0)
S(20, RITA, T, "like", ref="pete3")
S(20, MARIA, T, "like", ref="pete3")
S(20, WALT, T, "repost", ref="pete3")
S(20, HENRIK, T, "post", "Reminder to everyone worried about generator noise: tested generators can be required to run 2 hours a month in daytime. That's a permit condition, not a miracle.", "hv2", sl=1)
S(20, LENA, T, "follow", ref=JONAS)
S(21, PRIYA, T, "post", "About 150 people on the Town Hall steps tonight. Mostly students, plus teachers, fishermen, a few business owners. Speeches were short, signs were polite, nobody shouted. Photos in thread. #SaltmarshBay", "pr_rally", sl=0)
S(21, SAM, T, "repost", ref="pr_rally")
S(21, CHLOE, T, "repost", ref="pr_rally")
S(21, MARIA, T, "like", ref="pr_rally")
S(21, LENA, T, "like", ref="pr_rally")
S(22, DANA, T, "post", "The council vote is postponed until the independent review is complete. I'm grateful to everyone who showed up, argued, corrected themselves, and stayed. #SaltmarshBay", "d5", sl=1)
S(22, LENA, T, "comment", "Cautious win. We'll be watching the review as hard as we watched the rumor mill.", ref="d5", key="l_c5")
S(22, HENRIK, T, "comment", "Delay has a cost, but a defensible decision is worth it. Fine by me.", ref="d5")
S(22, WALT, T, "like", ref="d5")
S(22, RITA, T, "like", ref="d5")
S(22, JONAS, T, "follow", ref=DANA)
S(23, SAM, T, "post", "weird feeling: I came into this thinking it was a tech thing and it turned out to be a how-do-we-decide-things thing. Going to try to write that up for the student paper.", "sam2", sl=0)
S(23, MARIA, T, "follow", ref=AMARA)
S(23, PETE, T, "like", ref="sam2")
S(24, PRIYA, R, "post", "What happened in Saltmarsh Bay these 24 hours: a rumor (2M gallons/day) spread fast and was corrected by its own author. A councilman's undisclosed meeting surfaced and he recused himself. The vote was postponed for an independent review. The data center question is still open. The decision process is better than it was yesterday. I'll keep covering it.", "pr_wrap", sl=0)
S(24, AMARA, R, "comment", "Thank you for including the corrections. That's what keeps a town's information honest.", ref="pr_wrap")
S(24, TOM, R, "comment", "Still hoping for the jobs. But I'll take a process I can trust.", ref="pr_wrap")
S(24, MARIA, R, "like", ref="pr_wrap")

SEARCHES = ["NorthGrid data center", "Old Cannery site", "aquifer water use", "Saltmarsh hearing Friday", "Hallam Rowe Excavation"]
USER_SEARCHES = ["Priya Nair", "Dr. Amara Singh", "Greg Hallam", "Tide Watch"]
FIRST_GENERIC_COMMENTS = ["Well said.", "This needs more attention.", "Good question, curious about the answer too."]


# --------------------------------------------------------------------------- DB + log writers
SCHEMA = """
CREATE TABLE user (user_id INTEGER PRIMARY KEY, agent_id INTEGER, user_name TEXT, name TEXT, bio TEXT,
    created_at DATETIME, num_followings INTEGER DEFAULT 0, num_followers INTEGER DEFAULT 0);
CREATE TABLE post (post_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, original_post_id INTEGER, content TEXT DEFAULT '',
    quote_content TEXT, created_at DATETIME, num_likes INTEGER DEFAULT 0, num_dislikes INTEGER DEFAULT 0,
    num_shares INTEGER DEFAULT 0, num_reports INTEGER DEFAULT 0);
CREATE TABLE comment (comment_id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, user_id INTEGER, content TEXT,
    created_at DATETIME, num_likes INTEGER DEFAULT 0, num_dislikes INTEGER DEFAULT 0);
CREATE TABLE "like" (like_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, post_id INTEGER, created_at DATETIME);
CREATE TABLE dislike (dislike_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, post_id INTEGER, created_at DATETIME);
CREATE TABLE comment_like (comment_like_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, comment_id INTEGER, created_at DATETIME);
CREATE TABLE comment_dislike (comment_dislike_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, comment_id INTEGER, created_at DATETIME);
CREATE TABLE follow (follow_id INTEGER PRIMARY KEY AUTOINCREMENT, follower_id INTEGER, followee_id INTEGER, created_at DATETIME);
CREATE TABLE mute (mute_id INTEGER PRIMARY KEY AUTOINCREMENT, muter_id INTEGER, mutee_id INTEGER, created_at DATETIME);
CREATE TABLE trace (user_id INTEGER, created_at DATETIME, action TEXT, info TEXT);
"""


class Platform:
    def __init__(self, name):
        self.name = name
        self.db_path = os.path.join(OUT, "%s_simulation.db" % name)
        if os.path.exists(self.db_path):
            os.remove(self.db_path)
        self.con = sqlite3.connect(self.db_path)
        self.con.executescript(SCHEMA)
        for a in A:
            self.con.execute("INSERT INTO user (user_id, agent_id, user_name, name, bio, created_at) VALUES (?,?,?,?,?,?)",
                             (a[0], a[0], a[2], a[1], a[13], self.stamp(0)))
        os.makedirs(os.path.join(OUT, name), exist_ok=True)
        self.log = open(os.path.join(OUT, name, "actions.jsonl"), "w", encoding="utf-8")
        self.posts = {}      # pid -> dict(author, text, slant, round)
        self.comments = {}   # cid -> dict(post, author, text, slant)
        self.liked = set()   # (agent, kind, id)
        self.followed = set()
        self.muted = set()
        self.ncount = 0

    def stamp(self, rnd):
        # twitter keeps an integer step (OASIS), reddit keeps a datetime string
        if self.name == "twitter":
            return rnd
        return "2025-03-14 %02d:00:00" % rnd if rnd < 24 else "2025-03-15 %02d:00:00" % (rnd - 24)

    def wall(self, rnd):
        self.ncount += 1
        return "2026-03-14T10:%02d:%02d.%03d000" % (min(59, rnd * 2), self.ncount % 60, rng.randint(0, 999))

    def event(self, **kw):
        self.log.write(json.dumps(kw, ensure_ascii=False) + "\n")

    def trace(self, agent, rnd, action, info):
        self.con.execute("INSERT INTO trace VALUES (?,?,?,?)", (agent, self.stamp(rnd), action, json.dumps(info, ensure_ascii=False)))

    def act(self, rnd, agent, atype, args, info=None, dup=False):
        self.event(round=rnd, timestamp=self.wall(rnd), agent_id=agent, agent_name=AG[agent][1], action_type=atype,
                   action_args=args, result=None, success=True)
        if not dup:
            self.trace(agent, rnd, atype.lower(), info if info is not None else args)

    def sql(self, q, *a):
        if len(a) == 1 and isinstance(a[0], tuple):
            a = a[0]
        return self.con.execute(q, a)


if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)
P = {T: Platform(T), R: Platform(R)}
KEYS = {}   # key -> (platform, post_id) or (platform, 'c', comment_id)


def slant_of(agent, explicit):
    return explicit if explicit is not None else STANCE_SLANT[AG[agent][4]]


def do_post(rnd, e):
    pl = P[e["p"]]
    sl = slant_of(e["a"], e["sl"])
    cur = pl.sql("INSERT INTO post (user_id, content, created_at) VALUES (?,?,?)", (e["a"], e["t"], pl.stamp(rnd)))
    pid = cur.lastrowid
    pl.posts[pid] = dict(author=e["a"], text=e["t"], slant=sl, round=rnd)
    if e["key"]:
        KEYS[e["key"]] = (e["p"], pid)
    pl.act(rnd, e["a"], "CREATE_POST", {"content": e["t"]}, {"content": e["t"], "post_id": pid})
    return pid


def do_comment(rnd, e):
    pl = P[e["p"]]
    pp, pid = KEYS[e["ref"]][:2]
    assert pp == e["p"], e
    cur = pl.sql("INSERT INTO comment (post_id, user_id, content, created_at) VALUES (?,?,?,?)", (pid, e["a"], e["t"], pl.stamp(rnd)))
    cid = cur.lastrowid
    pl.comments[cid] = dict(post=pid, author=e["a"], text=e["t"], slant=slant_of(e["a"], e["sl"]))
    if e["key"]:
        KEYS[e["key"]] = (e["p"], "c", cid)
    # known MiroFish gap: CREATE_COMMENT carries no post_id
    pl.act(rnd, e["a"], "CREATE_COMMENT", {"content": e["t"], "comment_id": cid}, {"content": e["t"], "comment_id": cid})


def do_like(rnd, agent, plat, ref, dislike=False):
    pl = P[plat]
    k = KEYS[ref] if isinstance(ref, str) else ref
    if len(k) == 3:   # comment like
        cid = k[2]
        c = pl.comments[cid]
        if (agent, "c", cid) in pl.liked or c["author"] == agent:
            return False
        pl.liked.add((agent, "c", cid))
        pl.sql("INSERT INTO %s (user_id, comment_id, created_at) VALUES (?,?,?)" % ("comment_dislike" if dislike else "comment_like"), agent, cid, pl.stamp(rnd))
        pl.sql("UPDATE comment SET %s = %s + 1 WHERE comment_id=?" % (("num_dislikes",) * 2 if dislike else ("num_likes",) * 2), cid)
        args = {"comment_id": cid, "comment_content": c["text"], "comment_author_name": AG[c["author"]][1]}
        pl.act(rnd, agent, "DISLIKE_COMMENT" if dislike else "LIKE_COMMENT", args)
        return True
    pid = k[1]
    po = pl.posts[pid]
    if (agent, "p", pid) in pl.liked or po["author"] == agent:
        return False
    pl.liked.add((agent, "p", pid))
    tbl = "dislike" if dislike else "like"
    cur = pl.sql('INSERT INTO "%s" (user_id, post_id, created_at) VALUES (?,?,?)' % tbl, agent, pid, pl.stamp(rnd))
    pl.sql("UPDATE post SET %s = %s + 1 WHERE post_id=?" % (("num_dislikes",) * 2 if dislike else ("num_likes",) * 2), pid)
    args = {"post_id": pid, "post_content": po["text"], "post_author_name": AG[po["author"]][1]}
    args["dislike_id" if dislike else "like_id"] = cur.lastrowid
    pl.act(rnd, agent, "DISLIKE_POST" if dislike else "LIKE_POST", args, {"post_id": pid, ("dislike_id" if dislike else "like_id"): cur.lastrowid})
    return True


def do_repost(rnd, e):
    pl = P[e["p"]]
    pid = KEYS[e["ref"]][1]
    po = pl.posts[pid]
    if po["author"] == e["a"]:
        return
    cur = pl.sql("INSERT INTO post (user_id, original_post_id, content, created_at) VALUES (?,?,?,?)", (e["a"], pid, "", pl.stamp(rnd)))
    pl.sql("UPDATE post SET num_shares = num_shares + 1 WHERE post_id=?", pid)
    pl.posts[cur.lastrowid] = dict(author=e["a"], text=po["text"], slant=po["slant"], round=rnd, repost=True)
    pl.act(rnd, e["a"], "REPOST", {"post_id": pid, "new_post_id": cur.lastrowid, "original_content": po["text"],
                                   "original_author_name": AG[po["author"]][1]})


def do_quote(rnd, e):
    pl = P[e["p"]]
    pid = KEYS[e["ref"]][1]
    po = pl.posts[pid]
    cur = pl.sql("INSERT INTO post (user_id, original_post_id, content, quote_content, created_at) VALUES (?,?,?,?,?)",
                 (e["a"], pid, e["t"], e["t"], pl.stamp(rnd)))
    npid = cur.lastrowid
    pl.sql("UPDATE post SET num_shares = num_shares + 1 WHERE post_id=?", pid)
    pl.posts[npid] = dict(author=e["a"], text=e["t"], slant=slant_of(e["a"], e["sl"]), round=rnd)
    if e["key"]:
        KEYS[e["key"]] = (e["p"], npid)
    pl.act(rnd, e["a"], "QUOTE_POST", {"quoted_id": pid, "new_post_id": npid, "quote_content": e["t"],
                                       "original_content": po["text"], "original_author_name": AG[po["author"]][1]})


def do_follow(rnd, agent, plat, target):
    pl = P[plat]
    if (agent, target) in pl.followed or agent == target:
        return False
    pl.followed.add((agent, target))
    cur = pl.sql("INSERT INTO follow (follower_id, followee_id, created_at) VALUES (?,?,?)", agent, target, pl.stamp(rnd))
    pl.sql("UPDATE user SET num_followings = num_followings + 1 WHERE user_id=?", agent)
    pl.sql("UPDATE user SET num_followers = num_followers + 1 WHERE user_id=?", target)
    pl.act(rnd, agent, "FOLLOW", {"follow_id": cur.lastrowid})   # only follow_id, as in MiroFish
    return True


def do_mute(rnd, agent, plat, target):
    pl = P[plat]
    cur = pl.sql("INSERT INTO mute (muter_id, mutee_id, created_at) VALUES (?,?,?)", agent, target, pl.stamp(rnd))
    pl.act(rnd, agent, "MUTE", {}, {"mute_id": cur.lastrowid})   # no target in the log


def run_event(rnd, e):
    k = e["k"]
    if k == "post":
        do_post(rnd, e)
    elif k == "comment":
        do_comment(rnd, e)
    elif k == "like":
        do_like(rnd, e["a"], e["p"], e["ref"])
    elif k == "dislike":
        do_like(rnd, e["a"], e["p"], e["ref"], dislike=True)
    elif k == "repost":
        do_repost(rnd, e)
    elif k == "quote":
        do_quote(rnd, e)
    elif k == "follow":
        do_follow(rnd, e["a"], e["p"], e["ref"])
    elif k == "mute":
        do_mute(rnd, e["a"], e["p"], e["ref"])
    elif k == "search":
        P[e["p"]].act(rnd, e["a"], "SEARCH_POSTS", {"query": e["t"]})
    else:
        raise ValueError(k)


def filler(rnd, acted):
    hour = (rnd - 1) % 24
    order = [a[0] for a in A]
    rng.shuffle(order)
    for ag in order:
        a = AG[ag]
        if hour not in a[8]:
            continue
        if ag in acted and rng.random() < 0.6:
            continue
        plat = T if rng.random() < 0.65 else R
        if rng.random() > a[7] + 0.1:
            if rng.random() < 0.3:
                P[plat].act(rnd, ag, "DO_NOTHING", {})
            continue
        roll = rng.random()
        pl = P[plat]
        if roll < 0.6:
            cands = [(pid, po) for pid, po in pl.posts.items()
                     if po["author"] != ag and not po.get("repost") and po["round"] >= rnd - 6 and (ag, "p", pid) not in pl.liked]
            if not cands:
                continue
            mine = STANCE_SLANT[a[4]]
            weights = [1 + 1.5 * (po["slant"] == mine) + 0.6 * (po["round"] >= rnd - 2) + 0.4 * (AG[po["author"]][6]) for _, po in cands]
            pid, po = rng.choices(cands, weights)[0]
            if po["slant"] == mine and mine != 0:
                dis = rng.random() < 0.03
            elif po["slant"] == 0 or mine == 0:
                dis = rng.random() < 0.08
            else:
                dis = rng.random() < 0.55
            if not dis and po["slant"] != mine and mine != 0 and rng.random() < 0.7:
                continue
            do_like(rnd, ag, plat, (plat, pid), dislike=dis)
            acted.add(ag)
        elif roll < 0.75:
            cands = [(cid, c) for cid, c in pl.comments.items() if c["author"] != ag and (ag, "c", cid) not in pl.liked]
            if not cands:
                continue
            mine = STANCE_SLANT[a[4]]
            cid, c = rng.choice(cands)
            if c["slant"] == mine or mine == 0 or rng.random() < 0.3:
                do_like(rnd, ag, plat, (plat, "c", cid), dislike=(c["slant"] != mine and mine != 0 and rng.random() < 0.4))
                acted.add(ag)
        elif roll < 0.85:
            if rng.random() < 0.5:
                pl.act(rnd, ag, "SEARCH_POSTS", {"query": rng.choice(SEARCHES)})
            elif rng.random() < 0.6:
                pl.act(rnd, ag, "SEARCH_USER", {"query": rng.choice(USER_SEARCHES)})
            else:
                pl.act(rnd, ag, "TREND", {})
        elif roll < 0.89 and rnd >= 4:
            tgt = rng.choices([x[0] for x in A], [x[6] for x in A])[0]
            do_follow(rnd, ag, plat, tgt)
        else:
            pl.act(rnd, ag, "DO_NOTHING", {})


def write_static():
    os.makedirs(OUT, exist_ok=True)
    initial = [e for e in SCRIPT if e["r"] == 0]
    cfg = {
        "simulation_id": SIM_ID, "project_id": "proj_sample", "graph_id": "graph_sample",
        "simulation_requirement": "Simulate how public opinion in a small coastal town evolves over 24 hours after a proposal to build a 40 MW data center on the old cannery site. Track how rumors, official statements and journalism shape the debate.",
        "time_config": {"total_simulation_hours": 24, "minutes_per_round": MPR, "agents_per_hour_min": 3, "agents_per_hour_max": 10,
                        "peak_hours": [11, 12, 13, 19, 20, 21], "off_peak_hours": [0, 1, 2, 3, 4, 5], "morning_hours": [6, 7, 8, 9],
                        "work_hours": [10, 11, 12, 13, 14, 15, 16, 17, 18], "peak_activity_multiplier": 1.5,
                        "off_peak_activity_multiplier": 0.05, "morning_activity_multiplier": 0.4, "work_activity_multiplier": 0.7},
        "agent_configs": [{
            "agent_id": a[0], "entity_uuid": "00000000-0000-4000-8000-%012d" % a[0], "entity_name": a[1], "entity_type": a[3],
            "activity_level": a[7], "posts_per_hour": round(a[7] * 0.8, 2), "comments_per_hour": round(a[7] * 1.2, 2),
            "active_hours": a[8], "response_delay_min": 5, "response_delay_max": 60, "sentiment_bias": a[5], "stance": a[4],
            "influence_weight": a[6]} for a in A],
        "event_config": {
            "initial_posts": [{"content": e["t"], "poster_type": AG[e["a"]][3], "poster_agent_id": e["a"]} for e in initial],
            "scheduled_events": [],
            "hot_topics": ["data center", "water rights", "NorthGrid", "Old Cannery", "council transparency", "local jobs"],
            "narrative_direction": "A rumor about groundwater use spreads, a journalist exposes an undisclosed meeting by a councilman, and the town slowly shifts from slogans to a demand for process and evidence."},
        "twitter_config": {"platform": "twitter", "recency_weight": 0.4, "popularity_weight": 0.3, "relevance_weight": 0.3, "viral_threshold": 10, "echo_chamber_strength": 0.5},
        "reddit_config": {"platform": "reddit", "recency_weight": 0.3, "popularity_weight": 0.4, "relevance_weight": 0.3, "viral_threshold": 15, "echo_chamber_strength": 0.3},
        "llm_model": "sample-generator", "generated_at": "2026-03-14T09:55:00", "generation_reasoning": "Synthetic sample for Swarm Town.",
    }
    json.dump(cfg, open(os.path.join(OUT, "simulation_config.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    countries = "US"
    reddit = [{"user_id": a[0], "username": a[2], "name": a[1], "bio": a[13], "persona": a[14], "karma": rng.randint(300, 9000),
               "age": a[11], "gender": a[12], "mbti": a[10], "country": countries, "profession": a[9],
               "interested_topics": ["Local Politics", "Environment", "Community"]} for a in A]
    json.dump(reddit, open(os.path.join(OUT, "reddit_profiles.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    import csv
    with open(os.path.join(OUT, "twitter_profiles.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["user_id", "name", "username", "user_char", "description"])
        for a in A:
            w.writerow([a[0], a[1], a[2], a[14], a[13]])
    json.dump({"simulation_id": SIM_ID, "project_id": "proj_sample", "graph_id": "graph_sample", "enable_twitter": True,
               "enable_reddit": True, "status": "completed", "entities_count": len(A), "profiles_count": len(A),
               "entity_types": sorted({a[3] for a in A}), "config_generated": True, "is_sample": True,
               "created_at": "2026-03-14T09:50:00", "updated_at": "2026-03-14T10:50:00", "error": None},
              open(os.path.join(OUT, "state.json"), "w", encoding="utf-8"), indent=2)


def main():
    write_static()
    for pl in P.values():
        pl.event(event_type="simulation_start", timestamp="2026-03-14T10:00:00", platform=pl.name, total_rounds=ROUNDS, agents_count=len(A))
    by_round = defaultdict(list)
    for e in SCRIPT:
        by_round[e["r"]].append(e)
    initial_logged = []
    for rnd in range(0, ROUNDS + 1):
        for pl in P.values():
            pl.event(event_type="round_start", round=rnd, timestamp=pl.wall(rnd), simulated_hour=(rnd * 7) % 24)  # unreliable on purpose
        if rnd == 1:
            # known bug: the initial posts are logged again in round 1 (no new DB rows)
            for e in by_round[0]:
                P[e["p"]].act(1, e["a"], "CREATE_POST", {"content": e["t"]}, dup=True)
        acted = set()
        for e in by_round[rnd]:
            run_event(rnd, e)
            acted.add(e["a"])
        if rnd >= 1:
            filler(rnd, acted)
        for pl in P.values():
            pl.event(event_type="round_end", round=rnd, timestamp=pl.wall(rnd), actions_count=0)
    for pl in P.values():
        pl.event(event_type="simulation_end", timestamp="2026-03-14T10:50:00", total_rounds=ROUNDS)
        pl.con.commit()
        pl.con.close()
        pl.log.close()
    print("sample simulation written to %s" % OUT)
    for name in ("twitter", "reddit"):
        n = sum(1 for l in open(os.path.join(OUT, name, "actions.jsonl")) if '"action_type"' in l)
        print("  %-8s %d logged actions" % (name, n))


if __name__ == "__main__":
    main()
