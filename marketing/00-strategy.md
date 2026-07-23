# Frame — Marketing Strategy

**Owner:** Kaan
**Last updated:** 2026-05-19
**Status:** Foundational. Expect quarterly revision based on signal.

> This document sits above all tactical playbooks (`twitter/`, future `blog/`, `newsletter/`, etc.). When tactical decisions conflict with strategy, strategy wins. When strategy stops matching reality, revise the strategy — don't paper over it with tactics.

---

## 1. North Star

**Primary metric (12 months):** **GitHub stars + monthly active users**, in that order.

- **Stars** are social proof. They unlock conversations (Anthropic Startups, sponsorships, partnerships, contributor interest, press). At 250 stars now → 12-month target: **2,500-5,000**.
- **Monthly active users** is the truer signal that Frame is actually useful, not just admired. 12-month target: **500-1,500 MAU** (currently estimated <100 based on commit activity and issue volume).

**Why this combo, not just stars:** Stars-only optimization leads to demo-driven products. MAU forces real utility. Tracking both keeps Frame honest.

**Leading indicators to watch monthly:**
- Twitter follower growth (proxy for top-of-funnel awareness)
- Frame website traffic (intent signal)
- GitHub issues + PRs from non-Kaan contributors (ecosystem signal)
- Mentions of Frame in Claude Code / agentic dev contexts without prompting (organic discovery signal)

**Lagging indicators (don't optimize, just observe):**
- Twitter impressions (vanity)
- Like counts (vanity unless extremely high)
- Total downloads (only useful with retention data)

---

## 2. Audience Funnel

Five stages. Each stage has a different content type that moves people forward. Confusing stages = wasted effort.

| Stage | Mental state | What moves them forward | Content type |
|-------|--------------|-------------------------|--------------|
| **Stranger** | Doesn't know Frame, may not know Claude Code | Curiosity about agentic dev | Broad-audience tweets, blog posts on dev tooling, YouTube thumbnails |
| **Aware** | Saw Frame mentioned once, hasn't engaged | Concrete demonstration of value | Screenshots, GIFs, one specific capability shown well |
| **Engaged** | Followed, occasionally likes, hasn't visited frame.cool | Reason to invest 5 minutes | Threads with depth, blog deep-dives, "why this matters" content |
| **User** | Installed Frame, used it at least once | Reason to keep using + tell others | Tutorials, workflow tips, "patterns I've discovered" |
| **Advocate** | Promotes Frame unprompted | Community feeling + insider access | Contributor calls, Discord invites, early access to features, public credit |

### Where most marketing fails

Solo devs over-produce content for Engaged → User and under-produce for Stranger → Aware. They preach to the choir. Frame's growth gap is at the top of funnel — most devs interested in AI tooling don't know Frame exists yet.

**Implication:** Roughly 40% of content should target Stranger / Aware (broad takes, not Frame-specific). 40% target Engaged (Frame-flavored insight). 20% serve User / Advocate (tutorials, community).

This is the single biggest correction from the initial Twitter playbook, which was 80%+ Engaged-stage content.

---

## 3. Positioning

### Frame's positioning in one sentence

> **Frame is what software development looks like after the paradigm shift — built for agents first, humans second.**

### The two propositions stacked underneath

1. **Paradigm shift is real.** The way humans build software has changed. Small teams (3-4 people) now ship what used to take 50. Devs are becoming PM-engineers; PMs with technical literacy can ship code. Productivity is 100×. The need for micro-task management evaporates. The tools built for the old paradigm — Jira, Confluence, Cursor as an editor-first surface, JetBrains — are increasingly the wrong shape.
2. **Agents are the primary user, not humans.** Every other dev tool puts humans in the center and sprinkles AI on top as assistance. Frame inverts this. Agents do the work; the platform's job is to give *them* the context, the structure, the standards. Humans observe and orchestrate. The surface is more manageable for humans because it's not optimized for them — it's optimized for the agents working underneath.

These two propositions are the spine. Every piece of content, every feature description, every reply should be derivable from one or both.

### The category Frame creates

Not "AI-assisted IDE." Not "project management for devs." Not "Cursor for terminal."

**Frame is the development platform for the post-paradigm software team.** A category Frame defines and currently owns alone.

### Where Frame sits in the mental map

```
       ┌─────────────────────── OLD PARADIGM ──────────────────────┐
       │                                                            │
       │   IDE (Cursor / JetBrains / VS Code)                       │
       │   Project tracker (Jira / Linear / GitHub Projects)        │
       │   Knowledge base (Confluence / Notion wiki)                │
       │   Code assistant (Copilot / Cursor tab completion)         │
       │                                                            │
       │     ← all these tools are adding "AI features" on top      │
       │       of fundamentally human-centric surfaces              │
       └────────────────────────────────────────────────────────────┘

                                  vs

       ┌─────────────────────── NEW PARADIGM ──────────────────────┐
       │                                                            │
       │   ╔═════════════════════════════════════════════════════╗  │
       │   ║                       Frame                          ║  │
       │   ║                                                      ║  │
       │   ║   Agents work in: terminal, multi-agent grid         ║  │
       │   ║   Agents read: AGENTS.md, STRUCTURE.json,            ║  │
       │   ║                outcome.md, tasks.json                ║  │
       │   ║   Humans see: panel UI, kanban, specs dashboard      ║  │
       │   ║                                                      ║  │
       │   ║   Replaces: IDE + project tracker + agent-           ║  │
       │   ║             readable knowledge layer (the new        ║  │
       │   ║             shape of what used to be a wiki)         ║  │
       │   ╚═════════════════════════════════════════════════════╝  │
       │                                                            │
       │              Built for agents, observed by humans          │
       └────────────────────────────────────────────────────────────┘
```

Frame is not on the same axis as Cursor or Jira. It's a new category on the new paradigm side of the diagram.

### The enemy (anti-positioning)

Frame's competitors are not specific tools. Frame's competitor is **"old paradigm + AI bolt-on" as a category**.

This is the cluster of products saying: "your existing workflow + a chat sidebar / tab completion / Jira AI assistant = future-ready." That category is fundamentally mis-shaped for what teams actually need post-shift, and Frame's job is to make this visible.

Anti-positioning statements (use sparingly, never aggressively):

- Sprinkling AI on Jira doesn't fix Jira. The micro-task management it was built for stopped being the bottleneck two years ago.
- A Cursor with better tab completion is still optimized for humans typing. Frame is optimized for agents shipping.
- Most "AI dev tools" are 2022 products with a 2025 chat panel glued on. Frame is what the platform looks like when you start from the new paradigm, not the old one.

### What Frame is NOT (clarifying boundaries)

- Not a code editor (and not "Cursor for terminal" — that framing makes Frame sound smaller than it is)
- Not an agent (Frame doesn't write code; agents do)
- Not a Claude Code competitor (Frame *runs* Claude Code, Codex, Gemini)
- Not "Jira but better" (it's a different category, not a replacement on the same axis)
- Not for everyone — Frame is for people who have actually crossed into the new paradigm. Pre-shift users will not get it, and that's OK.

### What Frame should mean to people in 12 months

When someone in a small team says "we don't use Jira anymore" or "I haven't opened Cursor in months," the natural follow-up should be: *"are you on Frame?"*

This is the marker — when Frame becomes the assumed answer to "what do people on the other side of the paradigm use," the strategy worked.

---

## 4. Founder Brand: Kaan as "the indie builder articulating the paradigm shift"

Kaan is not just "a person who builds Frame." Kaan is the indie voice telling the story of what software development becomes after the paradigm shift. Frame is the proof of the story.

### The narrative arc Kaan owns

There's a paradigm shift happening in how software gets built. Most people sense it but can't articulate it. The tools they use still belong to the pre-shift world. Kaan articulates the shift, ships Frame as the platform for the post-shift world, and builds publicly while doing it.

This is a stronger founder position than "I build dev tools." Tool-builders are common. Paradigm articulators with credible product evidence are rare. Frame as evidence + Kaan as articulator is a compound asset.

### Voice model

Closest references:
- **@simonw (Simon Willison)** — technical depth, broad curiosity, ships things, writes well
- **@swyx (Shawn Wang)** — conceptual synthesis, names things, ecosystem-level thinking
- **@mitchellh (Mitchell Hashimoto)** — quiet authority, terminal-comfortable, deliberate

**Bonus reference for the paradigm-articulator angle:**
- **@dhh (David Heinemeier Hansson)** — Rails, Basecamp. Built a tool that embodied a worldview, articulated the worldview tirelessly, attracted a community that self-selected for that worldview. Frame's narrative shape rhymes with this: tool + manifesto + community.

**Anti-references:**
- Theo / t3dotgg — too entertainment-driven
- LinkedIn-tone founder posts — too forced
- "AI guru" accounts — credibility-zero with target audience
- "10× engineer" / hustle culture content — wrong audience, wrong values

### The 3-themes split (updated)

Kaan's content should look like:

- **~40% paradigm articulation** — observations about how software development has changed, what the new shape looks like, what the old paradigm got wrong, where the next 12 months go. Frame may not appear, or appears as evidence. **This is the new dominant pillar — replaces the old "Frame-tangential AI tooling thinking."**
- **~40% Frame-built-in-public** — what shipped this week, what was rejected, how Frame works, design decisions. Frame is the subject. Builds product trust.
- **~20% personal / human** — workspace screenshots, hot takes, frustrations turned into features. Builds relatability.

The 40/40/20 ratio still holds — but the 40% top slice is more focused than before. It's not "general AI dev commentary" anymore; it's "the story of the paradigm shift and what comes next."

### What Kaan should NOT post

- Bashing competing tools by name (the enemy is "old paradigm + AI bolt-on" as a category, not specific products)
- "Frame is the best" without showing why
- Hedge / qualified takes — paradigm articulation requires conviction, not "AI might change things eventually"
- Generic AI commentary indistinguishable from a hundred other accounts
- Negativity about other founders / companies
- Subtweets
- Engaging in tool wars (Cursor vs Frame, etc.) — Frame is in a different category, doesn't need to play the comparison game

### The line that should appear often

Different phrasings of one core idea, repeated over weeks until it becomes Kaan-coded:

- "We don't write code anymore. We orchestrate agents that do."
- "The unit of work isn't 'function' or 'PR' — it's 'spec → outcome.'"
- "Most of these tools are 2022 products with a chat panel glued on."
- "Built for agents, observed by humans."
- "When productivity is 100×, micro-task management isn't management — it's friction."

Pick one as the signature line for the pinned thread and the bio.

---

## 5. Two-Tier Audience Strategy

Frame's audience is not segmented by "how much AI tooling do you use." It's segmented by **whether you've crossed the paradigm shift or not.** This is psychographic, not technographic — and it matters because the same dev using Claude Code daily can be pre-shift or post-shift in mindset.

### Inner tier: the post-shift

- **Who they are:** People who have actually crossed. Small teams or solos shipping 100× their old throughput. PM-engineers and engineer-PMs whose roles have merged. Founders running on Claude Code + Codex + Gemini who already quietly stopped opening Jira. They feel the mismatch with old-paradigm tools as a daily friction.
- **Size:** Small but expanding visibly month over month. Estimated 5K-30K globally today.
- **Behavior:** Vocal on Twitter. Hangs in X Communities, specific Discords, certain HN threads. Recognizes each other.
- **Conversion:** Very high — Frame addresses the exact friction they're already feeling.
- **Content type:** Manifesto, deep dives, "here's how we actually work now," product demos that demonstrate the new shape.
- **Risk:** Small tribe, tribal dynamics. A wrong move spreads fast in the same channels.

### Outer tier: the suspecting

- **Who they are:** People who *sense* the paradigm is shifting but haven't moved yet. Still on Cursor, still on Jira, but starting to feel the mismatch. Senior engineers reading about agentic dev. Devs evaluating "should I switch." Tech leads thinking about team workflows for 2026-2027.
- **Size:** 10-50× larger than the inner tier and growing fast as the shift accelerates.
- **Behavior:** Lurks. Reads. Doesn't yet post strong opinions because they don't have a strong frame yet.
- **Conversion today:** Low. Conversion in 6-12 months: high — they'll cross when the new paradigm becomes culturally obvious.
- **Content type:** Paradigm articulation, "what's actually happening" framing posts, accessible explainers, blog SEO. Reach-oriented content.
- **Risk:** Goes inside-baseball and they tune out before crossing.

### Outside both tiers — explicitly not the audience

People still convinced the old paradigm is fine. Devs who think AI tooling is a fad, who use Cursor's tab completion and consider that the AI revolution done. **Not Frame's audience.** Don't try to convert them — they're a 2027-2028 problem at the earliest. Trying to evangelize them dilutes the message for the people who matter.

### The spear-and-banner model (updated semantics)

Same structure, refined meaning:

- **Spear** = content for the post-shift inner tier. Deep, specific, demonstrates that you live the same way they do. Builds credibility and tribal recognition.
- **Banner** = paradigm articulation aimed at the suspecting outer tier. Framing posts that name what they're sensing. Pulls them across the line.

Most indie tools have only the spear and stay niche-trapped. Most enterprise tools have only the banner and lack credibility. Frame's growth depends on doing both.

**Practical ratio:**
- 1 spear post : 1 banner post (alternating across any rolling 10-post window)
- Spear posts → reply game, niche communities, Frame demos
- Banner posts → paradigm threads, blog SEO posts, conference talk material

### The transition flow

A person typically arrives in this order:
1. **Sees a banner post** — paradigm articulation that names what they were sensing. Follows Kaan.
2. **Reads a spear post** later — sees evidence Kaan is on the other side, not just commenting from outside.
3. **Visits frame.cool** — sees the product is real, opinionated, and ships.
4. **Tries Frame** — usually on a side project first.
5. **Crosses** — at some point, Frame becomes their main workflow, and they start posting from the other side.

Each post should serve at least one of these steps. If a post serves none, don't ship it.

---

## 6. Channel Sequencing (Anti-Proliferation)

Four channels were chosen: Twitter, Blog, Newsletter, YouTube + communities. **All four cannot start simultaneously.** Channel proliferation is the #1 indie founder marketing failure.

### Recommended sequence

```
       Q1 (Jun-Aug)      Q2 (Sep-Nov)      Q3 (Dec-Feb)     Q4 (Mar-May)
       ────────────      ────────────      ─────────────    ─────────────
       Twitter           Twitter            Twitter          Twitter
       Blog (drip)       Blog (regular)     Blog             Blog
       Communities       Communities        Communities      Communities
                         Newsletter         Newsletter       Newsletter
                                            YouTube (exp)    YouTube (reg)
```

### Why this order

**Q1 — Twitter + Blog + Communities only**
- Twitter: top of funnel, fastest signal, where audience already is
- Blog: long-form home for Twitter thread expansions. SEO compounds slowly — start early. Even 1 post/month is fine. Frame.cool already exists; use it.
- Communities: X Communities + selected HN engagement + one Reddit sub at most (r/ClaudeAI or r/LocalLLaMA — verify which has Frame's audience). Discord deferred.
- Newsletter: **deferred**. Don't start until 500+ Twitter followers exist to seed it. An empty newsletter is humiliating; a 50-subscriber newsletter is depressing.
- YouTube: **deferred**. Effort/payoff terrible at small audience. Defer to Q3.

**Q2 — add Newsletter**
- Seed list from Twitter followers + frame.cool email signup.
- Cadence: monthly. "Here's what shipped, here's what I'm thinking about, here's what I'm reading."
- Substack is fine. Don't over-engineer.

**Q3 — add YouTube (experimental)**
- Start with one workflow video per month. Production quality matters less than substance early on.
- Frame's photogenic features (terminal grid, /spec.implement loop) translate well.
- If the first 3 videos hit, scale to bi-weekly.

**Q4 — sustain all channels**
- Steady cadence, no new channel additions
- Reassess: drop one if it's not earning its time

### Anti-proliferation rules

- **No new channel without retiring something or hitting a follower threshold** (e.g., +500 net followers in past 60 days).
- **YouTube is the one exception** — start it on time even if other metrics are slow, because YouTube compounds over 1-2 years and waiting kills the upside.
- **Discord is never on this list.** It's a community endpoint, not a content channel. Start a Frame Discord (or GitHub Discussions) only when there's genuine demand — usually around 1K stars or 10+ unprompted DMs asking "is there a community".

---

## 7. Content Pillars (Revised for Broader Brand)

Original Twitter playbook had 5 pillars, all Frame-niche. Revising to fit the 40/40/20 founder brand split, with paradigm articulation as the new dominant pillar.

### Broader / Banner (40%) — for the suspecting outer tier

These pillars don't mention Frame, or only mention it incidentally. The dominant new one is B5.

**B5. Paradigm shift articulation (the new dominant pillar)** — the story of what software development becomes after the shift. This is the pillar that builds Kaan's identity as the indie articulator. Examples:
- "We don't write code anymore. We orchestrate agents that do. Most dev tools haven't accepted this yet."
- "Productivity went 100×. Micro-task management didn't survive the transition."
- "Roles are merging. The 'PM' and 'engineer' distinction made sense when one person couldn't be both. That assumption is dead."
- "Stop comparing AI tooling to its 2024 ancestor. The shape of the work has changed underneath."
- "Built for agents, observed by humans — this is the inversion most tools haven't made."

**B1. Agentic dev observations** — adjacent to B5 but less manifesto, more day-to-day. Examples:
- "The 'session' as a unit of work is obsolete. Here's what's replacing it."
- "The fastest-growing dev skill of 2026 isn't a language — it's prompt taste."

**B2. Tool ecosystem commentary** — opinions on Cursor / Cline / Aider / Devin / Spec Kit. Generous in tone, sharp in framing.
- "Cursor's tab completion is genuinely the best in the space. Here's where it stops being useful when you've crossed."
- "Why Spec Kit is right about specs and wrong about everything after specs."

**B3. Dev culture + workflow** — universal dev experience filtered through the new-paradigm lens.
- "I haven't typed `git status` in three months."
- "The most useful thing in my .zshrc in 2026 is one alias."

**B4. Strong opinions on the meta**
- "Most AI dev tooling is solving the wrong problem. The wrong problem is interesting."
- "AI dev tooling has 18 months before being recognizable as a category. The window is now."

### Frame-flavored (40%) — "Engaged" funnel stage

Original 5 pillars (A, B-tactical, C, D, E from the Twitter playbook) cover this. Refer to `twitter/03-content-pillars.md`.

### Personal / human (20%)

- Workspace screenshots (Kaan's actual setup)
- A frustration that became a feature ("I kept losing X, so I built Y")
- Reading list / influence posts ("This week I'm thinking about…")
- Frame milestone celebrations (kept understated)

### Where these get used per channel

- **Twitter:** All three categories, distributed per 40/40/20.
- **Blog:** B1-B4 expanded into 800-1500 word posts. Frame-flavored deep-dives separate.
- **Newsletter:** Blends all three. More personal voice OK because it's permission-based.
- **YouTube:** Almost exclusively Frame-flavored (Tutorial / Demo / Spec workflow) because video is highest-effort and needs strongest connection to product.
- **Communities:** Mostly B-tactical (reply game) + occasional B1-B4 long-form posts.

---

## 8. Launch Cadence

Frame's growth comes from a mix of **drip launches** (continuous feature releases) and **big launches** (rare, milestone events).

### Drip launches (every 2-4 weeks)

Every feature ship is a marketing moment. Pattern:
1. Ship feature.
2. Update README + changelog.
3. Single tweet announcing it, with GIF/screenshot.
4. Sometimes: a blog post if the feature deserves explanation.

Don't oversell drip launches. They're proof of life, not events.

### Big launches (planned milestones)

These get coordinated multi-channel treatment.

**Likely big launches in next 12 months:**

| Milestone | Approximate timing | Channels |
|-----------|-------------------|----------|
| Frame v3.0 (if a major version shift makes sense) | Q3 2026 | Twitter thread, blog post, HN Show, ProductHunt, Reddit, X Communities |
| Frame Server beta | Q2-Q3 2026 (when ready) | Twitter, blog, HN, /r/selfhosted, /r/ClaudeAI |
| 1,000 stars milestone | Hopefully Q2 2026 | Twitter only, understated tone |
| Frame plugin marketplace launch | Q4 2026 (if shipped) | Full multi-channel |
| First year retrospective | Anniversary of repo creation | Blog post, Twitter thread |

### Anti-pattern to avoid

Don't manufacture launches. If a feature isn't actually a milestone, calling it one cheapens future milestones. The audience notices.

---

## 9. Community Strategy

Communities operate differently than broadcast channels. Read more than you post. When you post, be useful first, promote never.

### X Communities

Kaan is already in some. Action items:
- List which exact communities you're in (note for `twitter/06-target-accounts.md` follow-up).
- For each community, before posting Frame content: lurk for 2 weeks, learn the norms.
- High-value behavior: helpful technical replies in community posts. Frame mention only when directly relevant.
- Frame posts in communities (when posted): always lead with a problem or insight, never with the product link.

### Hacker News

- Frame Show HN exists as a one-time card — play it on a real milestone (Frame Server beta, or v3.0). Don't waste it.
- Engage with HN agentic dev posts in comments. Be the technical voice that adds substance.
- Avoid HN drama. The audience punishes it.

### Reddit

Probably 1-2 subreddits, not many.
- r/ClaudeAI — likely fit.
- r/LocalLLaMA — adjacent, lower fit.
- r/programming — too broad.
- r/selfhosted — relevant when Frame Server ships.

Reddit needs more lurking than X. 3+ weeks of comment karma before any post.

### GitHub Discussions (Frame's own)

Enable when there's actual community to host (usually 500+ stars or 5+ unprompted feature requests).

### Discord — deferred

Don't start a Frame Discord until late Q3 2026 at earliest. Empty Discords kill momentum. Wait until external demand exists.

---

## 10. Moat Narrative

The conventional "what if Cursor copies you" question is too small a frame for Frame's moat. The real question is: **what protects Frame against the entire "old paradigm + AI bolt-on" category?**

### The structural moat

Frame's moat is not features — it's a structural bet that vendors cannot match without abandoning their own positioning:

1. **Agent-first surface design.** Every other tool optimizes for human users with AI as assistance. Frame inverts. Cursor cannot become agent-first without alienating their existing human-centric audience. JetBrains cannot. Jira / Linear cannot. The inversion is a one-way door — they're trapped on the human-first side because their product DNA was set there.

2. **All-in-one for the post-paradigm role.** Frame replaces tasks (Jira), specs / knowledge (Confluence as a category — Frame reframes it as agent-readable knowledge layer), and IDE-as-orchestration-surface (Cursor / VS Code). Vendors who own one of these slots cannot own the others without 3-way cannibalization or major acquisitions. Frame starts integrated.

3. **Tool-agnosticism is structural.** Cursor will never support Claude Code + Codex + Gemini equally — they'd commoditize their own moat. Anthropic will never seriously support Codex. JetBrains AI ties to JetBrains' models / strategy. Only an indie, OSS, terminal-first tool can credibly remain neutral across AI vendors. Frame is the natural Switzerland.

4. **Built by people living the new paradigm.** Kaan and team don't use Jira, Confluence, Cursor. Frame is dogfooded by people who have actually crossed. This authenticity is impossible to manufacture from inside a vendor whose revenue depends on the old paradigm.

5. **Files over databases bet.** AGENTS.md, STRUCTURE.json, PROJECT_NOTES.md, outcome.md — markdown + git. Portable, vendor-neutral, agent-readable, human-greppable. If Frame disappeared tomorrow, the artifacts still work. This is a trust signal vendor-locked products cannot match.

6. **Indie OSS in a consolidating market.** As AI dev tooling consolidates around big vendors with rounds, "the indie open-source option" becomes more valuable, not less. The narrative arc favors Frame's stance.

### The category Frame defends

Frame is not defending its features against copies. Frame is defending **a category** — "post-paradigm dev platform" — against a category — "old paradigm with AI sprinkled on." That fight is much bigger than any single competitor's feature parity attempt.

### If a big player copies a specific feature

Response template (don't react in the moment, prepare in advance):

> "[Big Player] adding [feature] validates the direction. It's the right move for the ecosystem. Frame remains the agent-first, open-source, files-canonical implementation — different shape, same direction."

Never get defensive in public. Never claim Frame was first if it wasn't. Reframe to the structural difference and stay calm.

### If a big player copies the agent-first framing

This is the more interesting case — if Cursor or JetBrains starts marketing "AI-first" or "agent-first" themselves. Response:

> "Slapping 'agent-first' on a product that was designed human-first doesn't make it true. The test is whether the surface is optimized for what agents need or what humans want to see. [Their product] is still the latter. Frame is the former."

This is fair, sharp, and defensible because it's structurally true — they can rebrand, but they can't rebuild from the studs without breaking their existing users.

---

## 11. Risk Register

| Risk | Likelihood | Impact | Response |
|------|------------|--------|----------|
| Anthropic ships an official "Claude Code Projects" feature | Medium | High | Position Frame as the cross-tool implementation. Multi-AI is Frame's structural edge. |
| Cursor adds AGENTS.md auto-injection | High | Medium | Acknowledge, reframe — Cursor for in-editor, Frame for terminal-first agentic workflows. |
| Codex CLI removes the file-reading workaround that Frame's wrapper depends on | Medium | Medium | Engineering response, not marketing. But communicate stability/portability of AGENTS.md pattern. |
| Claude Code itself loses ground to a competitor | Low | High | Frame's multi-AI bet pays off here — already supports Codex + Gemini. |
| Kaan burns out, ships slow for 3+ months | Medium | High | Marketing-side: front-load evergreen content (blog posts) so the channel doesn't go dark. Build "second voice" eventually. |
| First HN / PH launch flops | Medium | Medium | Plan for it. The launch is a moment, not the strategy. Recovery: blog post about lessons, more measured second launch. |
| Frame contributor / fork creates competing product | Low | Low | Reframe as ecosystem growth. Don't fork-shame. |

---

## 12. 12-Month Marketing Roadmap

Each quarter has a theme + 2-3 milestones.

### Q1 (Jun-Aug 2026) — Foundation
- **Theme:** "Frame exists and is worth watching"
- Twitter cadence + first viral attempt
- Blog: 3-4 substantive posts on AGENTS.md pattern, spec-driven dev, agentic context economy
- Communities: lurk + occasional helpful replies
- **Milestone:** 500 stars + 100 MAU + Twitter following 250→750

### Q2 (Sep-Nov 2026) — Voice
- **Theme:** "Kaan is becoming a voice in agentic dev"
- Newsletter launches with seeded list
- Frame Server beta launch (if ready) — first big launch
- 1-2 conference proposals submitted
- **Milestone:** 1,000 stars + 250 MAU + newsletter 200+ subscribers

### Q3 (Dec 2026-Feb 2027) — Reach
- **Theme:** "Frame is in the conversation when agentic dev comes up"
- YouTube launches with monthly workflow videos
- Frame mentioned in at least 2 major dev newsletters or podcasts
- Possible Anthropic Startups acceptance + partnership opportunities
- **Milestone:** 2,500 stars + 750 MAU + YouTube 500+ subs

### Q4 (Mar-May 2027) — Sustain & Scale
- **Theme:** "Frame is the default suggestion for agentic project layer"
- Plugin marketplace launch (if shipped) — second big launch
- First year retrospective
- Consider opening up to contributors / community-led features
- **Milestone:** 5,000 stars + 1,500 MAU + healthy contributor base

---

## 13. What Success Looks Like (12 Months From Now)

Concrete picture, written in present tense, to be read at year-end as a check:

> A solo founder running a small SaaS is reading Twitter. They see a thread from Kaan: "Most dev tools are 2022 products with a chat panel glued on. Here's what the post-paradigm version looks like." It reframes something they'd been feeling for months but couldn't articulate — that their Jira board is friction, that their Cursor setup is a compromise, that the way they actually ship code now doesn't match the way the tools assume work happens.
>
> They click through to frame.cool, watch a 60-second demo, see Frame's terminal grid running Claude Code and Codex in parallel with a spec dashboard on the side. They install it that night. The setup takes minutes — AGENTS.md is auto-created, their existing project gets a STRUCTURE.json, Claude Code in the new pane reads it without re-onboarding.
>
> Two weeks later they've stopped opening Linear for that project. The kanban in Frame is enough. The specs panel replaced their Notion docs for that codebase. They tweet: "I haven't used Linear in two weeks. Frame is just better-shaped for how I actually work now." The tweet gets 400 likes and three replies from people asking what Frame is.
>
> Six months in, that founder is one of the regulars in Frame's small but growing community. They've contributed a small PR. They've referred two friends.
>
> Meanwhile: Kaan is consistently quoted in AI dev tooling discussions. When someone tweets "the new paradigm" or "post-paradigm" in a dev context, half the replies tag Kaan. Anthropic's DevRel knows who he is. He's been on two podcasts and turned down a third.
>
> Twelve months in: Frame has 4,000+ stars, 1,200 MAU, and a small but real community. Twitter following is 3K-5K. Newsletter has 800-1,500 subscribers. YouTube is fledgling but the workflow videos that exist have steady viewership.
>
> Frame still hasn't made money — and that's been a deliberate choice. The foundation is laid for whatever monetization Kaan eventually picks: hosted Frame Server, sponsorships, enterprise consulting, or just sustained OSS with backers. But the category position matters more than revenue right now.
>
> Most importantly: when a founder or small team says "we've moved past the old stack," the natural follow-up is "you on Frame?" That answer being assumed is the success marker. Frame is no longer "Kaan's project." It's the platform for people on the other side of the shift, and Kaan is the indie voice who named the shift.

If, in 12 months, this picture is broadly true, the strategy worked. If it's not, this document gets revised and we learn what we were wrong about.
