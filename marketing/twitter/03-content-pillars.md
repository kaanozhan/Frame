# 03 — Content Pillars × Angles

5 pillars (A-E) for the **Engaged-stage** audience (already aware of Claude Code / agentic dev). Plus 4 broader pillars (B1-B4) for the **Stranger / Aware** stage — added after the 2026-05-19 strategic reframe.

**Ratio target:** ~40% broader (B1-B4) / ~40% Frame-flavored (A, B-tactical, C, D, E) / ~20% personal. See `../00-strategy.md` Section 4 and 7 for context.

Every Frame-flavored angle here is grounded in real Frame capability — not generic AI dev commentary.

---

## A. Technical Insight

Claude Code, agentic coding, context economy. Mostly product-free or Frame-implied. These build credibility before you ever push the product.

1. CLAUDE.md goes stale the moment you commit something CLAUDE.md doesn't know about. Here's how to keep it honest: a pre-commit hook that rewrites the structure section.
2. The unspoken cost of large codebases in agentic dev: your AI spends 30-40% of its tokens just figuring out where things live. The fix is an index, not more context.
3. Three files every agentic project should have on disk, not in a vector DB: project rules, module map, decisions log. Markdown wins because git versions it.
4. Stop trying to detect "session boundaries". There aren't any. Use git commits — that's the only deterministic moment something real happened.
5. What people miss about CLAUDE.md: it's not a system prompt. It's documentation the agent reads at boot. Treat it like a README written for the agent, not the human.
6. Agentic dev's hardest problem isn't capability. It's continuity. The model doesn't get worse — your project just gets bigger than the context window.
7. Spec → plan → tasks is everywhere. Nobody writes the fourth file: what actually shipped. Plans are intent. Code is reality. The space between is where institutional memory dies.
8. The reason Claude Code "forgets" isn't the model. It's that you didn't write anything down between sessions. The agent's memory is the filesystem.

---

## B. Problem / Solution (Reply game ammunition)

Each angle includes a trigger pattern + 1-2 draft reply tones. See `05-reply-scenarios.md` for fully-fleshed examples.

1. **Trigger:** "Claude Code keeps re-reading the same files."
   **Pattern:** Talk about indexing concept first; mention STRUCTURE.json + `find-module.js` as one implementation. Link Frame only if asked.

2. **Trigger:** "Switched from Cursor to Claude Code, missing project structure."
   **Pattern:** Acknowledge the gap. Outline AGENTS.md + tasks.json pattern. Mention Frame as one way to set it up automatically.

3. **Trigger:** "Got rate-limited on Claude, switched to Codex, lost all context."
   **Pattern:** "AGENTS.md + symlink to GEMINI.md gives all three tools the same brain. Spent a while on this — happy to share the wrapper script if useful."

4. **Trigger:** "Agent goes off the rails on big refactors."
   **Pattern:** Spec-driven flow as antidote — spec.md → plan.md → tasks.md, each step is a checkpoint. `outcome.md` catches the drift.

5. **Trigger:** "I keep losing track of what I asked Claude to do across sessions."
   **Pattern:** tasks.json + commit hook pattern. "Tasks live on disk, not in chat history. Commits sync them."

6. **Trigger:** "Multi-project Claude Code is a mess."
   **Pattern:** Per-project context isolation principle. Each project = own AGENTS.md + tasks.json + session.

7. **Trigger:** Anyone praising Cursor's tab completion but lamenting context.
   **Pattern (gentle):** "Tab completion solves writing. The context problem is a different layer — that's where things break at scale."

8. **Trigger:** "How do you keep your AI from re-suggesting things you already rejected?"
   **Pattern:** PROJECT_NOTES.md as decision log. Decisions go on disk; agent reads them next session.

---

## C. Build in Public

Low frequency (1 per 2 weeks). Each thread, not single tweet. Personal voice — Kaan's, not Frame's.

1. **"Why I built Frame instead of using Cursor"** — 5-tweet personal narrative. Terminal-first, context loss frustration, Claude Code as the actual interface. Candidate for pinned tweet.
2. **"What I learned shipping Frame v2.0 → v2.2 in [N] weeks"** — 4-tweet retro. What broke, what worked, what users actually used.
3. **"The feature I almost shipped but killed at the last minute"** — vulnerability post. (`outcome.md` was originally going to be auto-generated from git diff — pulled back to agent-written; explain why.)
4. **"Frame just crossed [milestone] stars. Here's what I learned about open source in the AI era."** — save for 500, 750, 1K stars.
5. **"Building solo while the AI tooling space gets $XXm rounds: how I'm thinking about it"** — positioning post. Don't bash competitors; reframe.
6. **"Spec-driven dev in Frame: the four-file workflow I didn't think would work"** — feature deep-dive thread, demo GIF included.
7. **"3 ideas I rejected for Frame this month and why"** — taste signal. Shows judgment, not just features.
8. **"Why Frame stays terminal-first when every other tool is going GUI-first"** — contrarian positioning thread.

---

## D. Comparison / Positioning

Use carefully — never bash. Always reframe as "different problem."

1. Cursor wraps the AI around an editor. Frame wraps a project standard around the AI. Different problems.
2. Aider is a great agent. Frame isn't an agent at all — it's the project shell agents run inside.
3. Spec Kit is for one-off spec docs. Frame's spec workflow is for the continuous loop: spec → plan → tasks → outcome → next spec.
4. When to use Cursor: writing code with AI in the loop. When to use Claude Code + Frame: AI does the work, you orchestrate.
5. Cline & Continue solve the agent-in-editor problem. Frame solves the project-around-agent problem. Both are real.
6. Devin promises autonomy. Frame admits agents need scaffolding. Two bets, both legitimate, very different products.
7. VS Code workspaces don't isolate AI context. Frame projects do. Small difference, huge in practice for multi-project devs.
8. What Roo, Cline, and Continue have in common: they assume you're in an editor. Frame assumes you're in a terminal. That's the only real fork in the road.

---

## E. Workflow / Tutorial

1 per 2-3 weeks (high effort). Each one ~30 sec Loom + 4-tweet summary. Evergreen value.

1. **"How I onboard a fresh Claude Code session to a 50-file project in 10 seconds"** — STRUCTURE.json + AGENTS.md demo.
2. **"My agentic dev setup, in one window"** — 3×3 grid screenshot tour. High viral potential — algorithm loves "setup porn."
3. **"From idea to merged PR with `/spec.*` commands in Frame"** — end-to-end demo, 60-sec Loom.
4. **"Switching from Claude Code to Codex mid-feature without losing context"** — multi-AI demo.
5. **"Keeping CLAUDE.md alive over 6 months: the commit hook pattern"** — technical tutorial, code in the tweet.
6. **"Spec → outcome: what the four spec files look like for a real feature I just shipped"** — show actual files from a recent Frame commit.
7. **"The `/spec.implement` loop, demoed end-to-end"** — Loom, 90 sec.
8. **"My tasks.json pattern: how I let Claude pick what to work on next"** — solo PM workflow.

---

---

## Broader pillars (revised 2026-05-19) — for the "suspecting" outer tier

These do not mention Frame, or mention it only incidentally. Their job: build Kaan's identity as the indie voice articulating the paradigm shift, and reach devs who sense the shift but haven't crossed yet.

**B5 is the new dominant pillar** (added in the vision-level reframe). The original B1-B4 still apply but operate under B5's narrative umbrella.

### B5. Paradigm shift articulation (new dominant pillar)

The story of what software development becomes after the shift. Manifesto-tone but grounded.

1. We don't write code anymore. We orchestrate agents that do. Most dev tools haven't accepted this yet.
2. Productivity went 100×. Micro-task management didn't survive the transition. The friction isn't producing code anymore — it's the system around the producing.
3. The unit of work isn't "function" or "PR." It's "spec → outcome." Tools optimized for the old units feel wrong, but most devs can't yet articulate why.
4. Roles are merging. The "PM" and "engineer" distinction made sense when one person couldn't be both. That assumption is gone in a small team running on agents.
5. Most dev tools are 2022 products with a chat panel glued on. The paradigm changed underneath — they didn't.
6. Built for agents, observed by humans. Every other dev tool is the opposite. Watch which way the puck is going.
7. 3-4 people now ship what used to take 50. The tools assumed 50. The tools assumed Jira. The tools assumed standups. None of that survives the new shape.
8. When you've actually crossed into the new paradigm, the friction with your old tools becomes physical. You can feel it. You start avoiding Jira. You stop opening Notion. The signs are there before you have words for them.
9. The next year of dev tooling isn't about adding AI features. It's about which products were architected for a world where agents are the primary user. Most aren't.
10. We're in the awkward middle — the work has changed but the words for the work haven't. Phrases like "vibe coding" are reaching for it. So is "agentic dev." Neither quite gets there.

### B1. Agentic dev observations (broad takes — under B5 umbrella)

1. The "session" as a unit of work is becoming obsolete in agentic dev. What's replacing it.
2. What "productivity" means when AI writes 80% of your code.
3. The fastest-growing dev skill of 2026 isn't a language — it's prompt taste.
4. Why "context window" is the wrong metric to obsess over.
5. The agentic dev workflow split: one camp wants autonomy, the other wants scaffolding. Both are right for different work.
6. How AI changes what "ownership" of code means in a team.
7. Three things about agentic dev that I was wrong about a year ago.
8. The single skill that separates devs who get value from AI from devs who don't.

### B2. Tool ecosystem commentary

1. Cursor's tab completion is the best in the space. Here's where it stops being useful.
2. Why Spec Kit is right about specs and wrong about everything after specs.
3. What Devin gets right that the indie tools haven't caught up to (and vice versa).
4. Cline solved a specific problem brilliantly. The problem it didn't solve is bigger.
5. The Codex CLI is underrated. Here's the one thing it does better than Claude Code.
6. When to use Aider vs Cursor vs Claude Code — a decision framework, not a ranking.
7. Why the JetBrains AI features feel a generation behind, even though they shipped recently.
8. The one tool I expected to dominate the agentic dev space that hasn't, and why.

### B3. Dev culture + workflow

1. I haven't typed `git status` in three months. Here's what that means for how I work.
2. The most useful thing in my `.zshrc` in 2026 is one alias.
3. Why solo devs are getting more done than 3-person teams from 2024.
4. The phrase "vibe coding" deserves more respect than it gets. It's pointing at something real.
5. Junior devs in 2026 don't need to learn the same things juniors needed in 2020.
6. The senior dev skill that doubled in value when AI showed up: code reading.
7. Why I deleted Linear from my workflow and what's filled the gap.
8. Working solo without a manager + AI as a junior pair is the most underrated dev setup.

### B4. Strong opinions on the meta

1. Most AI dev tooling is solving the wrong problem. The wrong problem is interesting.
2. Open-source AI tooling has an 18-month window to be recognizable as a category. The window is now.
3. The next dev tooling consolidation wave will hit by 2027. Here's who gets eaten and who doesn't.
4. "AI-native dev" doesn't mean what most companies marketing it think it means.
5. The thing the big AI labs underestimate about indie devs is how fast our tools iterate.
6. There's a missing layer in agentic dev that nobody's named yet. Naming things is half the work.
7. Why benchmark numbers for coding agents mislead everyone.
8. The AI dev tooling market will look less like "Cursor vs JetBrains" and more like "the AI layer + everything underneath it." Frame and friends live in the everything underneath.

---

## How to use this menu

- **Stuck for what to post?** Alternate broader (B1-B4) with Frame-flavored (A/C/D/E). Default to broader if Frame-flavored has dominated recent posts.
- **Saw a reply opportunity?** Match it to B's triggers; adapt one of the patterns.
- **Want a high-leverage post?** E #2 (setup porn), A #7 (`outcome.md` manifesto), or B4 #6 (missing-layer / naming).
- **About to launch something?** C — pick the angle that matches what's been built.
- **Comparison thread brewing?** D for Frame-vs-tool, B2 for ecosystem commentary without Frame mention.

Don't burn through all ~70 angles. Most won't be used in the first 6 months. Quality > coverage. Maintain the 40/40/20 ratio across any rolling 10-post window.
