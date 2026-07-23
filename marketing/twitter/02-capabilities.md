# 02 — Frame Capabilities, Mapped to Tweet Angles

7 capabilities. Each one has: what it does, what it solves, when to use it in content, what visual it needs. Ordered by Twitter ROI (uniqueness × visualizability).

---

## 1. `outcome.md` — Spec-Driven Dev with Reality Capture

**Twitter ROI:** ★★★★★ (most differentiated)

### What it does
4-file spec flow: `spec.md` (what) → `plan.md` (how) → `tasks.md` (broken down) → `outcome.md` (what actually shipped). The agent writes outcome.md while memory is fresh, capturing divergence and follow-ups.

### What it solves
Spec frameworks tell you intent (plan) and reality (code). The space between — what the agent did differently, what it learned, what to revisit — is normally lost the moment the session ends.

### Use case
You planned a feature in 3 tasks. The agent implemented in 5, changed 2 along the way. A week later, "why did we do it this way?" has no answer in the code — but `outcome.md` tells the story.

### Tweet angles
- **Manifesto:** "Plans are lies. Code is truth. The space between is where teams break."
- **Curiosity hook:** "I added a 4th file to spec-driven dev. It's the only one that matters."
- **Comparison (gentle):** "Why Spec Kit isn't enough — and what I added on top."

### Visual needed
Side-by-side screenshot: `plan.md` vs `outcome.md` for the same feature, divergence highlighted. 30-sec GIF: `/spec.implement` loop running in Frame's Specs panel.

---

## 2. Git Commit as Context Anchor

**Twitter ROI:** ★★★★★ (philosophical hook, manifesto material)

### What it does
Pre-commit hook auto-updates `STRUCTURE.json`. `tasks.json` and `PROJECT_NOTES.md` sync at commit time. The commit is the only deterministic moment "something real happened" — Frame builds its context system around it.

### What it solves
"When did the session end?" has no good answer. Frame stops trying to detect it and uses git commits instead.

### Use case
After a 4-hour session, Claude Code context fills up or you stop for the day. Next session reads `PROJECT_NOTES.md` + `STRUCTURE.json` + `tasks.json` from disk — picks up exactly where you left off, written at the moment something was actually finished.

### Tweet angles
- "Stop trying to detect 'session end'. Just use git commit."
- "The unsung benefit of small commits in agentic dev: AI memory."
- Contrarian to the "I rebase into one commit" crowd.
- Quote-tweet bait for any "Claude Code forgets things" thread.

### Visual needed
Diagram: "session timeline vs commit timeline as memory boundary" (Excalidraw). Short GIF: edit → commit → open new session → AI reads STRUCTURE.json instantly.

---

## 3. Multi-AI Standard — One Project Layer, Three Tools

**Twitter ROI:** ★★★★ (reply game gold)

### What it does
`AGENTS.md` is the single source. `CLAUDE.md` → symlink. `GEMINI.md` → symlink. Codex CLI → wrapper script at `.frame/bin/codex` that injects AGENTS.md as initial prompt.

### What it solves
Each AI tool wants its own context file (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`). Without Frame you maintain three versions of the same content.

### Use case
Start a feature in Claude Code, hit rate limit, switch to Codex, then Gemini. All three read the same context. Zero re-onboarding.

### Tweet angles
- "I switch between Claude, Codex, and Gemini mid-feature. They all read the same project rules. Here's how:"
- "Tool lock-in is over. Here's the AGENTS.md pattern:"
- Reply ammunition: any "rate limited", "switched from Claude to Codex" mention.

### Visual needed
Diagram: single AGENTS.md, three arrows out, each with its mechanism (symlink, symlink, wrapper script). Short demo: AI tool selector dropdown switching mid-task.

---

## 4. STRUCTURE.json `intentIndex` — Zero-Search Navigation

**Twitter ROI:** ★★★★ (results-driven hook, needs measurement)

### What it does
Concept-to-files map. `find-module.js github` returns `githubManager.js` + `githubPanel.js`. AI doesn't grep — goes to the right file.

### What it solves
Claude Code in a large codebase burns 30-40% of tokens on "where is X" searches. (Currently subjective claim — see decisions-log for benchmark stance.)

### Use case
Fresh session, "add a button to the GitHub panel." AI runs `find-module github`, opens two files. No grep, no false starts.

### Tweet angles
- "I cut my Claude Code token spend ~30% with one file" (only when measured)
- "Stop letting your AI grep. Index your codebase for it."
- "The hidden tax of large codebases in agentic dev."

### Visual needed
Terminal recording: `find-module` command + result. Optional: comparison of file reads with/without intentIndex via session logs.

---

## 5. Per-Project Isolated Sessions

**Twitter ROI:** ★★★ (niche but sharp)

### What it does
Switch projects in Frame → context fully resets. Each project has its own `tasks.json`, `PROJECT_NOTES.md`, terminal session, AI tool state.

### What it solves
"Wrong project context bleeding into another project" — VS Code workspace switching doesn't isolate AI context.

### Use case
Project A: discussing DB migration. Switch to Project B: AI has zero memory of Project A. No bleed-over.

### Tweet angles
- "Multi-project devs: you need session isolation, not just folder switching."
- "Why I stopped using VS Code workspaces with Claude."

### Visual needed
GIF: switching between two projects in Frame, showing sidebar + terminal + tasks all reset.

---

## 6. Multi-Terminal Grid (up to 9, real PTY)

**Twitter ROI:** ★★★★ (visualizability 10/10 — setup porn)

### What it does
Up to 9 real PTY terminals in one window. Tabs or grid layouts (2×1, 2×2, 3×1, 3×2, 3×3). xterm.js + node-pty under the hood (same as VS Code).

### What it solves
Agentic workflows are inherently parallel — Claude Code, dev server, logs, git, tests. iTerm + alt-tab cycling stops being efficient.

### Use case
Top-left: Claude Code. Bottom-left: dev server. Right: logs + git status. Single pane of glass, no window switching.

### Tweet angles
- "My agentic dev setup: 4 terminals, 1 window, 0 alt-tab."
- "Claude Code + dev server + logs + git in 1 pane."
- Setup-porn posts (high RT potential, evergreen).

### Visual needed
3×3 grid screenshot of a real working session (not mock data). High photogenic value — use frequently.

---

## 7. Specs Panel + Tasks Panel + Kanban Dashboard

**Twitter ROI:** ★★★ (has "I replaced Linear" hook)

### What it does
Spec lifecycle UI (draft → specified → planned → tasks_generated → implementing → done). Drag-and-drop kanban for tasks. "Send to Claude" button beams a task into the active terminal as a prompt.

### What it solves
Tab-switching between Linear/Jira and your terminal to feed the AI tasks one at a time.

### Use case
Generated 8 tasks from a spec. See them on the kanban. Hit ▶ on the first — Frame sends it into Claude Code's terminal as the next prompt.

### Tweet angles
- "I deleted Linear from my agentic dev loop. Here's what replaced it."
- Build-in-public kanban GIF: "ship this week."

### Visual needed
Kanban drag GIF + "Send to Claude" button click + terminal receiving the task.

---

## Capability priority for content rollout

When picking what to post next, default to this order:

1. **`outcome.md`** — most unique, most underclaimed → manifesto thread (Week 4)
2. **Git commit as anchor** — philosophical hook → manifesto thread (Week 2)
3. **Multi-terminal grid** — moderate uniqueness but highest visualizability → recurring screenshot post
4. **Multi-AI standard** — reply ammunition + standalone explainer thread
5. **intentIndex** — needs benchmark numbers; defer until measured
6. **Per-project isolation** — niche post, share when responding to relevant pain
7. **Specs/Tasks/Kanban** — "I replaced X" hook, decent engagement, opportunistic
