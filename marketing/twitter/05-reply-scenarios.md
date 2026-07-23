# 05 — Reply Scenarios

5 fully-fleshed reply scenarios. Each scenario: trigger pattern → 2 draft replies (different tones) → notes on when each fits.

**Universal rules:**
- First 5 words must deliver value. Skim wins on Twitter.
- Never "Great point!" / "Love this!" — empty.
- One of three: specific technical detail, your own experience, an interesting counter-question.
- Frame mention only when organically asked for, or thread depth justifies it.
- Threaded replies with image/GIF outperform text-only 3-5×.
- First 30 minutes after the tweet posts is when algorithm rewards replies. Faster > later.

---

## Scenario 1 — Claude Code amnesia complaint

### Trigger pattern
- "Why does Claude Code forget everything between sessions"
- "Tired of re-explaining my project to Claude every time"
- "Claude Code's context is so limiting"

### Draft A — Technical, no product

> The agent isn't forgetting — there's just nothing on disk for it to read. A markdown file at the project root that the agent loads at boot fixes 80% of this. CLAUDE.md for Claude, AGENTS.md as the more general convention.

### Draft B — Light product mention (if thread is deep)

> Yeah, this was my whole reason for building Frame (frame.cool). The fix is structural: AGENTS.md + a module map + a decisions log, all kept current by a commit hook. Happy to share the patterns if you want — they work without Frame too.

### Notes
- A is default in most cases.
- B only when: (a) thread is mature with multiple replies, (b) original poster engages back, (c) someone else asks "is there a tool for this?"
- Conversion potential: medium. People complaining are venting; not always shopping.

---

## Scenario 2 — Cursor → Claude Code migration nostalgia

### Trigger pattern
- "Switched from Cursor to Claude Code but I miss [project view / tab management / structure]"
- "Claude Code is great but I miss having a real IDE around it"

### Draft A — Empathy first

> Same migration here. Terminal is the better surface for agentic work, but you lose the project shell. The gap nobody's filled well yet: project structure that's terminal-native but the AI can use.

### Draft B — With offer

> Felt this exact gap and ended up building something around it (frame.cool). Whether you use it or not, the core idea is portable: keep project rules, module map, and tasks as markdown the agent reads on boot.

### Notes
- Lead with empathy, never "use my tool" as first move.
- This is one of the highest-conversion reply types — these are pre-qualified Frame users.
- Image of Frame's 3×3 grid here is a strong tactical move (only if you have it ready).

---

## Scenario 3 — Multi-AI / rate limit lament

### Trigger pattern
- "Got rate limited on Claude, tried Codex, but now I have to re-onboard it to my project"
- "How do you all handle Claude rate limits? Codex doesn't know my codebase."

### Draft A — Technical, specific

> The fix is a single AGENTS.md as the project source of truth, with CLAUDE.md and GEMINI.md as symlinks pointing to it. Codex needs a wrapper script since it doesn't auto-read files — happy to share if useful.

### Draft B — Product-forward (this is the rare scenario where it works)

> This is solvable: one file (AGENTS.md), three readers. Symlink for Claude + Gemini, wrapper script for Codex CLI. Frame does this automatically (frame.cool) but the pattern works standalone.

### Notes
- **Highest conversion scenario for Frame.** Frame solves this exact thing and almost no one else does. Strong Frame mention OK here.
- Don't lead with the link — lead with the solution, then offer.
- The wrapper script can be a standalone gist that gets attention even without Frame.

---

## Scenario 4 — "How do you organize your AI dev workflow?" prompt

### Trigger pattern
- "Show me your setup"
- "What's your agentic workflow?"
- "Drop your terminal setup screenshots"

### Draft A — Screenshot reply

> [3×3 terminal grid screenshot of Frame in real use]
> One window, 9 PTYs. Claude Code top-left, dev server bottom-left, logs middle, git status right. Built Frame to make this layout the default instead of fighting tmux.

### Draft B — Text only

> Multi-terminal in a single pane (so I can see Claude + dev + logs + git at once), a markdown file the AI reads on boot, and small commits as the memory checkpoint. The window manager + project standard combo is what works for me.

### Notes
- Screenshot replies get 3-5× more engagement.
- A is preferred whenever Kaan's setup is camera-ready (clean projects, no embarrassing console output).
- Profile-visit driver: people see the screenshot and click through to find what it is.

---

## Scenario 5 — Spec-driven dev / Spec Kit discussion

### Trigger pattern
- Anyone discussing Spec Kit, BMAD, "specs before code" in AI dev
- Tweets about "AI hallucinates when I don't plan first"
- Spec-driven dev manifestos

### Draft A — The hook (most differentiated)

> The piece I felt was missing from most spec frameworks: a fourth file that captures what actually shipped vs what was planned, written by the agent while memory's fresh. Plans are intent, code is reality, that file is the story between.

### Draft B — Longer, threaded if thread is active

> I've been running a 4-file spec flow: `spec.md` (what), `plan.md` (how), `tasks.md` (broken down), `outcome.md` (what actually shipped + divergence + follow-ups). The fourth file is the one I almost didn't add — turned out to be the most valuable.

### Notes
- Frame mention only if asked directly. This is your most differentiated talking point — use it liberally without naming Frame.
- The phrase "the fourth file" is sticky. Use it.
- Manifesto-tone — fits perfectly with chosen pitch #3.

---

## Reply selection logic

When a tweet matches multiple scenarios, prioritize in this order:
1. **Scenario 3** (multi-AI / rate limit) — highest conversion
2. **Scenario 5** (`outcome.md`) — highest differentiation
3. **Scenario 2** (Cursor migration) — highest pre-qualification
4. **Scenario 1** (amnesia) — broadest pattern, useful for volume
5. **Scenario 4** (setup porn) — only when you have a screenshot ready

When in doubt: lower frequency, higher quality. One great reply > five mediocre ones.

---

## Common mistakes to avoid

- ❌ Replying just to reply ("Great point!", "100%", "This.")
- ❌ Replying to top influencers with no specific addition (they get hundreds of these, you'll be ignored)
- ❌ Linking Frame in every reply (algorithmic penalty + reputation damage)
- ❌ Engaging in tool wars (Cursor vs Cline vs Frame — never)
- ❌ Replying past the 1-hour window unless the thread is still active
- ❌ Threading replies to your own reply — let one good message land alone

---

## When to send the reply to a draft queue first

For Tier 1 accounts (Anthropic team, top influencers): write the reply, but put it in your Telegram drafts queue and sleep on it 10 minutes. Re-read before posting. Public missteps in these threads have outsized cost.
