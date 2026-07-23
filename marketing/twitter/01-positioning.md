# 01 — Positioning & Messaging Architecture

Source for every tweet's tone, framing, and angle. Read this before drafting anything.

> **Updated 2026-05-19** after vision-level reframe. The earlier "structure, context, and memory" pitch (#3) was right for a niche project; the actual vision is bigger. New pitches center on paradigm shift + agent-first inversion. The old #3 is preserved at the bottom as a backup / softer phrasing for surfaces where the full vision-positioning is too much.

---

## Primary pitch (use first in most surfaces)

> **Frame is the development platform for the post-paradigm software team. Built for agents first, humans second.**

This is the full positioning compressed. It states the worldview (paradigm shifted), the inversion (agents primary), and the category (development platform). Use as headline on frame.cool, opening of conference talks, lead of long-form posts.

## Bio-length variations (Twitter / X / GitHub)

For places with character limits, compress to one of these:

1. **"Built for agents first, humans second. The dev platform for after the paradigm shift."**
2. **"Software development changed. Most tools haven't. Frame is the one built for what comes next."**
3. **"The platform for the post-paradigm software team. Agent-first by design."**
4. **"Frame: we orchestrate agents that ship code. The platform built for that, not retrofitted to it."**
5. (Backup, softer / less manifesto-heavy:) **"Structure, context, and memory for agentic coding. Commits are checkpoints, files are canonical."**

### Choosing per surface

| Surface | Pitch |
|---------|-------|
| Twitter bio | Bio #1 or #3 |
| Pinned thread opener | Primary pitch + 1-2 supporting lines |
| frame.cool homepage hero | Primary pitch |
| GitHub repo description | Bio #2 (works for repo-browsers who don't have the full context) |
| Conference talk title | Primary pitch, or "Software development changed. Here's what comes next." |
| Newsletter tagline | Bio #3 |
| YouTube channel description | Bio #4 |
| Reply ammunition (when needed) | Backup #5 — softer, less likely to start a debate mid-thread |

### Why "agent-first, human-second" is the irreducible core

This phrase is the *only* phrase in Frame's positioning that no competitor can credibly steal. Cursor cannot say it without alienating their existing users. JetBrains cannot. Jira cannot. Anthropic could — but Anthropic is a model lab, not a dev platform.

Use this phrase often. Repeat it across posts, blog headlines, talk titles. Repetition is what turns a phrase into a category marker.

---

## Core problem statement — at the paradigm level

Single paragraph. Paraphrasable into every thread opener.

> Software development changed in the last 18 months. Small teams now ship what used to take 50 people. Devs are becoming PM-engineers; PM-engineers are shipping code. The unit of work isn't "function" or "PR" anymore — it's "spec → outcome." Productivity is 100×, which means the friction isn't producing code, it's managing the system around the producing. But the tools haven't moved. Jira still wants you to estimate story points. Confluence wants you to maintain wikis. Cursor still puts the human at the keyboard center. They were all designed for a paradigm that ended. Frame is what the platform looks like when you start from the new paradigm — built for agents first, observed by humans.

### Variants for different post types
- **Short (one tweet):** Most dev tools are 2022 products with a chat panel glued on. The paradigm changed underneath — they didn't.
- **Conversational (reply):** "Agentic dev" isn't a feature. It's the new shape of the work. The tools that don't accept that are competing on the wrong axis.
- **Manifesto (thread opener):** We don't write code anymore. We orchestrate agents that do. Most dev tools haven't accepted this yet. Frame is built for what comes after.

### Tactical problem statement (when you need to ground in concrete pain)

Sometimes the paradigm framing is too abstract for a specific thread. Drop down to concrete:

> Claude Code, Codex, and Gemini are great until your project gets big. Then sessions start from zero. Decisions get forgotten. The agent re-reads the same files. CLAUDE.md drifts from reality. Tasks live in your head. You spend more time orienting the AI than building. Frame fixes the layer underneath: a project standard (AGENTS.md, STRUCTURE.json, PROJECT_NOTES.md, tasks.json) that every AI tool reads, kept honest by git commits, so context never starts from zero again.

Use this when the audience needs to feel a specific pain before they care about the paradigm framing.

---

## Unique angle (vs Cline / Continue / Cursor / Aider / Roo)

Never bash competitors. Always reframe as "different problem."

### The reframe matrix

| They do | Frame does |
|---------|-----------|
| AI-in-editor | Structure-around-AI |
| Each tool has its own context convention | One standard (AGENTS.md) works for all AI tools |
| Context = session memory | Context = files on disk, git-versioned |
| Session ends → context gone | Commit checkpoints → context survives |
| Editor + AI bundled (vendor lock-in) | Terminal-first, BYO AI |

### Single-sentence differentiator
> Cursor wraps the AI around an editor. Frame wraps a project standard around the AI.

### Tool-by-tool positioning
- **vs Cursor:** Different surfaces. Cursor for AI-assisted writing, Frame for AI-orchestrated building.
- **vs Cline:** Cline is an in-editor agent. Frame isn't an agent at all — it's the project shell agents run inside.
- **vs Aider:** Aider is a great agent. Frame is what holds the project together while any agent works on it.
- **vs Continue:** Continue solves agent-in-editor. Frame solves project-around-agent. Both real.
- **vs Devin:** Devin promises autonomy. Frame admits agents need scaffolding. Two bets.
- **vs Spec Kit:** Spec Kit is for one-off spec docs. Frame's spec workflow is for the continuous loop: spec → plan → tasks → outcome → next spec.

---

## Ideal Customer Profile (ICP)

### Who Frame is for
- Senior / staff / principal devs or very active indie makers
- **Daily Claude Code (or Codex / Gemini) users** — production code, not sandbox
- Codebase size: medium-plus (≥50K LOC or multi-module)
- Terminal-comfortable, CLI-first
- Forms opinions on AI tooling; willing to share them on Twitter
- Frustration signals: "CLAUDE.md keeps going stale", "I re-explain my project every session", "paid for Cursor but I keep going back to Claude Code"

### Who Frame is NOT for
- Juniors on hobby projects (overkill)
- Prompt engineering tutorial viewers
- Cursor-only users who don't use Claude Code
- Windsurf loyalists
- Anyone whose project fits in a single context window

### How ICP shows up in messaging
- Tone assumes competence (no "what is an agent?" explainers)
- References technical specifics (PTY, IPC, intentIndex)
- Doesn't apologize for being terminal-first
- Doesn't compete on price/free (because audience values working tools more than free tools)

---

## Why-now narrative

For pinned thread, manifesto posts, launch announcements, "why I'm building this" videos. Don't paraphrase mid-tweet — quote or stay silent.

```
2024: AI wrote code one function at a time.
2025: AI started writing whole features. Cursor, Cline, Aider exploded.
2026: AI is now writing weeks of work in single sessions.

But the tooling assumes the old model — a chat box, a diff view, a session.
There is no project layer. No memory between sessions. No standard the
agent and the human agree on.

This breaks at scale. Not in toy projects — in real ones.

Frame is the project layer.
```

### When to use this
- Pinned tweet (extended into 5-tweet thread)
- Annual / milestone posts
- "Why I'm building Frame" thread on `<account_milestone>` (e.g., 500 stars)
- Conference / podcast intro (verbal)

### When NOT to use this
- Reply game (too manifesto-y for in-thread)
- Tactical / how-to posts
- Anything where you need to be specific in <140 chars
