# Frame — Twitter Growth Playbook

**Status:** Foundation written 2026-05-19. Pre-launch (Week 0).
**Owner:** Kaan
**Scope:** Local-only working docs. Not in git, not on GitHub.

> **Read `../00-strategy.md` first.** This Twitter playbook is a tactical implementation under the broader marketing strategy. Strategic decisions (north star, founder brand, channel sequencing) live there; this folder is where they get operationalized on Twitter specifically.

---

## What this is

A self-contained growth playbook for Frame's Twitter presence. Created during a session with Claude Opus 4.7 with full access to Frame's codebase. All sections grounded in real Frame capabilities and pulled from README, PROJECT_NOTES.md, STRUCTURE.json, and commit history (state as of v2.2.2).

This is **marketing work**, deliberately separate from Frame's product codebase. Lives inside the Frame repo for convenience (single workspace) but is `.gitignore`'d.

---

## How to use

1. **Read `decisions-log.md` first.** It captures the key positioning decisions (pitch, persona, monetization stance, language strategy). All other docs assume these.
2. **Reference docs (read as needed):**
   - `01-positioning.md` — pitch, ICP, problem statement, why-now narrative
   - `02-capabilities.md` — 7 Frame capabilities mapped to tweet angles + visuals needed
3. **Working docs (active use):**
   - `03-content-pillars.md` — 5 pillars × 8 angles = ~40 ready-to-adapt tweet ideas
   - `04-content-calendar.md` — 4-week rolling calendar (low-volume cadence: 2-3 posts/week)
   - `05-reply-scenarios.md` — 5 reply scenarios with draft templates
4. **Infrastructure docs (one-time setup):**
   - `06-target-accounts.md` — ~50 categorized accounts + keyword watches
   - `07-visual-arsenal.md` — priority order of visuals to produce
   - `08-monitoring-bot.md` — Path A (lightweight) recommended for first 4-6 weeks; Path B (custom bot) deferred

---

## Current state of decisions (snapshot)

- **Persona:** Solo Kaan personal account (no separate Frame brand account)
- **Pitch:** "structure, context, and memory for agentic coding" (variation #3 from positioning doc)
- **Language:** English only (TR audience too small for Claude Code, opportunistic Turkish replies only)
- **Cadence:** Low volume — 2-3 organic posts/week + ad-hoc replies
- **Monetization talk:** TBD, not in messaging yet
- **Claims:** Subjective only (no token %, no benchmarks until measured)
- **Monitoring approach:** Path A (TweetDeck + Telegram queue + manual Claude drafting) for weeks 1-6

---

## Update protocol

- When a decision changes → update `decisions-log.md` with date + reasoning
- When a tweet performs unusually well or badly → note in `decisions-log.md` (this is how the playbook stays calibrated)
- When new content angles emerge → add to `03-content-pillars.md`
- This is a living doc. Expect heavy churn in weeks 1-4, stable after that.

---

## Out of scope (intentionally not here)

- Linkedin, blog, ProductHunt, HN — different surfaces, different playbooks
- Frame's internal product roadmap (lives in `tasks.json`)
- Anthropic Startups application — separate track
