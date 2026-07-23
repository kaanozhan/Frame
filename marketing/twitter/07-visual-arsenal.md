# 07 — Visual Arsenal (Priority Order)

Twitter posts with images get 3-5× more engagement. But producing visuals nobody uses is waste. This priority order optimizes for: low production cost × high reuse × high Twitter ROI.

**Volume target:** 5 high-quality visuals in the first month. Not 15 mediocre ones.

---

## Priority 1 — This week (2-3 hours of work)

### 1. Pinned tweet thread cover image

- **What:** Frame logo + tagline #3 ("structure, context, and memory for agentic coding"). 1200×675 px.
- **Tool:** Figma (free) or Excalidraw (free).
- **Use:** First tweet of the pinned thread. Boosts thread engagement noticeably.
- **Effort:** ~30 min.

### 2. 3×3 terminal grid screenshot

- **What:** Frame in real use. Top-left Claude Code, top-right logs, middle file editor, bottom-row git/dev-server. Real session, not mock.
- **Important:** Use the bundled sample project (added in v2.2.x) to avoid leaking real code.
- **Tool:** CleanShot X for screenshot + annotation.
- **Use:** Pillar E #2 setup-porn post, and reply ammunition for Scenario 4.
- **Effort:** ~45 min (clean window, arrange, capture, color check).

### 3. `outcome.md` example screenshot

- **What:** Side-by-side: `plan.md` vs `outcome.md` from one of Frame's own recent commits. Divergence highlighted with annotations.
- **Tool:** CleanShot X with arrows/callouts.
- **Use:** Pillar A #7 manifesto thread visual.
- **Effort:** ~45 min (pick a good commit, screenshot both files, annotate).

---

## Priority 2 — Week 2 (3-4 hours)

### 4. "Single AGENTS.md → 3 AI tools" diagram

- **What:** Single AGENTS.md node, three arrows out, labeled with each mechanism (Claude: symlink, Gemini: symlink, Codex: wrapper script).
- **Tool:** Excalidraw (preferred — handdrawn aesthetic resonates on Twitter) or tldraw.
- **Use:** Multi-AI standard thread + reply ammunition for Scenario 3.
- **Effort:** ~60 min.

### 5. Commit-as-anchor flow diagram

- **What:** Timeline: code edit → commit triggers pre-commit hook → STRUCTURE.json updates → new session opens → AI reads fresh structure. Show how STRUCTURE.json + tasks.json + PROJECT_NOTES.md all update at commit.
- **Tool:** Excalidraw.
- **Use:** Pillar A #4 manifesto post visual.
- **Effort:** ~60 min.

---

## Priority 3 — Weeks 3-4 (opportunistic)

### 6. Demo GIF: `/spec.implement` loop

- **What:** ≤30 sec recording. Frame Specs panel showing `/spec.implement` running. Task completes in Claude Code, panel auto-updates, `outcome.md` gets a new entry.
- **Tool:** Kap (free, mac, mp4→gif) or CleanShot X.
- **Constraints:** ≤30 sec, ≤8MB, smooth playback, no jarring cuts.
- **Use:** Workflow tutorial post (Pillar E #7).
- **Effort:** ~90 min (planning take, recording, trimming, exporting).

### 7. Before / After meme template

- **What:** "CLAUDE.md without Frame: stale by week 2" / "CLAUDE.md with Frame: updated every commit." Use ironically, low-stakes.
- **Tool:** Figma.
- **Use:** Opportunistic — only when a meme format takes off and Frame fits organically.
- **Risk:** Forced memes look desperate. Don't push.

### 8. Frame logo variation set

- **What:** Light/dark, square/wide, transparent. Asset library for avatar, header, post end-cards.
- **Tool:** Figma (export to multiple sizes).
- **Use:** Profile updates, future visual posts.
- **Effort:** ~60 min one-time investment.

---

## What NOT to make yet

- **Loom videos (1-2 min):** At current cadence, you'll accumulate unused videos. Defer to Week 5+ when audience justifies it.
- **Architecture diagrams (Frame internals):** Too technical for Twitter. Save for blog or docs.
- **Comparison memes (Frame vs Cursor):** Adversarial tone risks backlash. Refraining intentionally — see positioning doc.
- **Animated explainers:** High effort, low ROI on Twitter (auto-play is the killer feature). Stick to static + short GIFs.

---

## Tool stack summary

| Purpose | Tool | Cost |
|---------|------|------|
| Static graphics | Figma | Free |
| Diagrams (handdrawn) | Excalidraw | Free |
| Diagrams (flowchart) | tldraw | Free |
| Screenshots + annotation | CleanShot X | $30 one-time (mac) |
| MP4 → GIF | Kap | Free (mac) |
| GIF quality (alt) | Gifski | $5 |
| Code snippet cards | ray.so | Free |
| Code snippet (alt) | carbon.now.sh | Free |

**Total tool budget:** $30 (CleanShot X). Everything else free tier.

---

## Quality bar checklist (before posting any visual)

- [ ] Frame's logo / brand color used consistently?
- [ ] No real customer data or sensitive code visible?
- [ ] Annotations readable on mobile (most Twitter views)?
- [ ] If a screenshot: window decoration removed or made consistent?
- [ ] If a GIF: under 8MB, loops cleanly, no jarring cuts?
- [ ] If a diagram: legible at thumbnail size (Twitter renders small)?

---

## Asset storage

Keep all source files inside `marketing/assets/` (also `.gitignore`'d as part of `marketing/`). Naming convention: `YYYY-MM-DD_pillar-X_description.png/gif/svg`.

Example: `2026-05-20_pillarE2_terminal-grid.png`.

This makes it easy to: find them later, see what's been used, avoid re-creating identical assets.
