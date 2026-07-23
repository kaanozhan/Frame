# Decisions Log

Append-only. Date-stamped. Reasoning preserved, not summarized.

---

## [2026-05-19] Foundational positioning decisions

Captured during the initial playbook session with Claude Opus 4.7.

### Persona

**Decision:** Solo Kaan personal account. No separate `@frame_dev` or brand account active. **But: reserve the Frame handle now** (claim @frame / @framecool / @frame_dev — whichever is available) with a placeholder bio pointing to @kaanozhan, to prevent squatting.

**Reasoning:** Single account = all energy concentrated. Indie builder model (levelsio, eyaltoledano, simonw) works. Manifesto is first-person — brand account would break its voice. Brand account can be activated later when one of these triggers fires:
- Kaan personal reaches 5K+ followers
- Frame adds a DevRel / content person
- Frame product announcements become too dense for personal feed

Until then: handle is reserved, personal is primary.

### Pitch (one-liner)

**Decision:** "structure, context, and memory for agentic coding."

**Reasoning:** Chose the manifesto-tone variant over the more specific "what you wrap around Claude Code so large projects stop falling apart" (#5). Bio / pinned thread material — leans philosophical. Acknowledged trade-off: #3 is less immediately concrete in bio but stronger as thread-opener material.

**Alternatives considered:**
- #5 — most spec ific, "wrap around Claude Code" novel phrasing, recommended by Claude but not chosen
- #2 — Multi-AI angle, hides the Claude amnesia problem

### Language

**Decision:** English only as planned content. Turkish reserved for opportunistic replies to Turkish devs.

**Reasoning:** Frame's real audience is global Claude Code users. TR dev community small + low Claude Code uptake. Splitting into bilingual content stream = 2× work for niche return.

### Monetization stance

**Decision:** Don't mention monetization in messaging yet.

**Reasoning:** Open core vs. fully OSS not decided. Keeping messaging flexible until model is clearer. No "support on GitHub Sponsors" CTAs yet.

### Cadence

**Decision:** Low volume — 2-3 organic posts/week + ad-hoc replies.

**Reasoning:** Solo dev burnout risk. Quality > quantity at this stage. No daily reply quota — minimum 5 substantive replies/week target.

### Claims / Benchmarks

**Decision:** Subjective claims only. No "cut tokens by X%" until actually measured.

**Reasoning:** No instrumentation in place to measure. Making up numbers = credibility risk. "Feels faster", "less re-explaining" acceptable until benchmarks exist. Future task: instrument STRUCTURE.json intentIndex usage to support concrete claims.

### Monitoring approach

**Decision:** Path A (Lightweight: TweetDeck columns + Telegram queue + manual Claude drafting) for first 4-6 weeks. Custom monitoring bot (Path B) deferred until volume justifies $130/mo.

**Reasoning:** Twitter API Basic tier is $100/mo as of 2026. Need to learn signal patterns manually first before automating scoring. Path B build = 1 week dev work that pulls Kaan off Frame core.

### Marketing as separate project

**Decision:** Marketing work lives in `marketing/` folder inside Frame repo but `.gitignore`'d. Not on GitHub.

**Reasoning:** Convenience of single workspace, but marketing artifacts shouldn't be public. Distinct from Frame product development — separate concerns, separate file tree.

---

---

## [2026-05-19] Strategic reframe — broader brand + multi-channel + community

Captured after second pass with Claude. Initial playbook was too tactically-focused on the niche audience. This reframe corrects course at the strategic layer.

### North Star metric

**Decision:** GitHub stars + monthly active users (in that order). 12-month target: 2,500-5,000 stars + 500-1,500 MAU.

**Reasoning:** Stars are social proof that unlocks conversations (Anthropic Startups, sponsorships, contributors). MAU keeps Frame honest about real utility. Tracked together — neither alone would be enough.

### Founder brand

**Decision:** "AI dev tooling thinker who builds Frame" — Simon Willison / swyx / Mitchell Hashimoto voice model.

**Reasoning:** Not pure product-centric (too narrow), not generic dev culture (dilutes Frame). The 40/40/20 content split (Frame-tangential / Frame-flavored / personal) operationalizes this.

**Alternatives considered:**
- Pure builder voice (rejected: too narrow audience)
- Generic dev thinker (rejected: dilutes Frame narrative)

### Audience strategy

**Decision:** Two-tier — niche spear (heavy Claude Code users) + broader banner (devs interested in AI). 1:1 alternating content.

**Reasoning:** Inner-circle-only content caps growth at niche size. Broader narrative content reaches the next wave entering the niche. Spear-and-banner model.

**Implication for existing Twitter docs:** Original 5 content pillars target Engaged-stage audience only. Need to add B1-B4 broader pillars (added to `03-content-pillars.md`).

### Channel sequencing

**Decision:** Q1: Twitter + Blog + Communities. Q2: add Newsletter. Q3: add YouTube. Q4: sustain.

**Reasoning:** Channel proliferation is the #1 indie founder marketing failure. Solo dev cannot run 4 channels day-one. Sequence respects effort budget. Newsletter and YouTube need audience to seed, hence later.

**Alternatives considered:** All four at once (rejected: burns out solo founder).

### Community strategy

**Decision:** X Communities (already member) + selected HN engagement + 1 Reddit sub. Discord deferred until 1K+ stars or unprompted demand.

**Reasoning:** Communities = lurk-heavy, lead with useful, never promote-first. Discord without demand = depressing empty room.

### Positioning category

**Decision:** Frame positions as "open-source project layer for agentic development" — perpendicular to AI-in-editor tools, not competitive with them.

**Reasoning:** Strongest possible positioning because not competing for the same mental slot as Cursor/Cline. Category name "agentic project layer" doesn't exist yet — Frame can define it.

### Big launches reserved

**Decision:** Frame Server beta (Q2-Q3) + Plugin marketplace (Q4) = two big launches. Star milestones = understated. Show HN card spent only on real milestone.

**Reasoning:** Launch fatigue is real. Save HN for moments that actually deserve it.

---

---

## [2026-05-19] Vision-level reframe — paradigm shift + agent-first

Captured after Kaan explained the full vision. Previous strategy was treating Frame as "a better dev tool"; the actual vision is much larger — Frame embodies a worldview about how software development has fundamentally changed. Strategy doc `00-strategy.md` was substantially revised.

### The two propositions Frame stands on

1. **The paradigm has shifted.** Small teams (3-4 people) now ship what used to take 50. Productivity is 100×. Micro-task management is friction, not management. Roles (PM / engineer / product engineer) are merging. The tools built for the old paradigm — Jira, Confluence, Cursor as editor-first surface, JetBrains — are mis-shaped.
2. **Frame is built for agents first, humans second.** Every other dev tool puts humans in the center and sprinkles AI on top. Frame inverts this. Agents work; humans observe and orchestrate. The platform optimizes for what agents need (context, structure, standards), and humans get a manageable surface as a byproduct.

These are the spine of all communications going forward.

### Agent-first framing — full emphasis decision

**Decision:** "Built for agents first, humans second" goes into bio, pinned thread, blog headline, conference talk titles. Full public emphasis.

**Reasoning:** Frame's strongest differentiation. No other dev tool says this. Risk of "Frame doesn't care about UX" misread is real but manageable with proper framing — the secondary surface (panel UI, kanban, specs dashboard) is still excellent, just not the primary design constraint.

**Alternatives considered:** Softer phrasing ("agent-aware", "agent-native") — rejected because it loses the category-defining sharpness.

### All-in-one claim — calibrated

**Decision:** Frame replaces tasks (Jira / Linear) and specs. Frame's spec / notes / structure files are reframed as **agent-readable knowledge layer** — a new category, not a Confluence replacement on the same axis.

**Reasoning:** Avoids the trap of overpromising "Frame is Confluence" when Frame doesn't have wikis in that shape. Instead, asserts that the *thing that used to be a wiki* has changed shape in the post-paradigm world. PROJECT_NOTES.md + outcome.md + STRUCTURE.json + spec files = the new shape. Agent-readable, git-versioned, markdown. Not better wiki — different category.

**Alternatives considered:**
- "Replaces Jira + Confluence + Cursor" — rejected as overclaim that audience would scrutinize
- Silent on doc replacement — rejected as too small for the vision

### Founder brand — sharpened

**Decision:** Kaan = "the indie builder articulating the paradigm shift in software development." Frame is the proof, Kaan is the articulator.

**Reasoning:** Stronger than "AI dev tooling thinker." Compounds — tool-builders are common, paradigm articulators with credible product evidence are rare. dhh / Rails analogy: tool + manifesto + community.

### Audience segmentation — redefined

**Decision:** Segment by paradigm acceptance (psychographic), not by tool usage (technographic). Inner tier = "the post-shift" (already crossed). Outer tier = "the suspecting" (sense the shift, haven't moved). Anyone still convinced the old paradigm is fine is **not Frame's audience** — don't try to convert them.

**Reasoning:** A Cursor power user with 2024 mindset is less Frame's audience than a less-AI-experienced solo founder who has crossed. Crossing matters more than skill level.

### Anti-positioning — competitor is a category, not a tool

**Decision:** Frame's competitor is **"old paradigm + AI bolt-on"** as a category, not Cursor / Jira / JetBrains individually. Anti-positioning statements target the category, not specific products.

**Reasoning:** Bigger fight, cleaner narrative, no fanboy wars with specific product communities.

### New dominant content pillar: B5 — Paradigm articulation

**Decision:** B5 (paradigm shift articulation) added to content pillars as the dominant pillar in the broader/banner 40%. Sample lines for the brand voice:

- "We don't write code anymore. We orchestrate agents that do."
- "When productivity is 100×, micro-task management isn't management — it's friction."
- "Most dev tools are 2022 products with a chat panel glued on."
- "Built for agents, observed by humans."
- "The unit of work isn't 'function' or 'PR' — it's 'spec → outcome.'"

One of these should be the signature line — used as bio, pinned thread opener, conference talk title.

---

## [YYYY-MM-DD] Template for future entries

### Topic
**Decision:**
**Reasoning:**
**Alternatives considered:**
**Status / follow-up:**
