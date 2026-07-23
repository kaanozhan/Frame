# 08 — Monitoring & Reply Drafting Infrastructure

Two paths. **Path A (lightweight) is the recommended starting point** for the first 4-6 weeks. Path B (custom bot) is documented for later when volume justifies cost.

---

## Reality check — Twitter API pricing (2026)

| Tier | Monthly cost | Limit | Verdict |
|------|--------------|-------|---------|
| Free | $0 | 100 reads/mo | Useless |
| Basic | $100 | 10K reads, 3K posts | Marginal |
| Pro | $5,000 | Production-grade | Out of scope |

This pricing reality is the single biggest constraint on bot architecture. **Custom bots that use the official API start at $100/mo.** Scraping alternatives have legal + reliability issues. Hence the recommendation below.

---

# Path A — Lightweight (Recommended for Weeks 1-6)

**Stack:** X Premium ($8/mo) + TweetDeck columns + Telegram channel (free) + Claude API for drafting (only when triggered manually).

## Architecture

```
┌─────────────────────────────────────────────┐
│           TweetDeck / X Pro (manual)         │
│                                              │
│  Col 1: Tier 1-2 List (anthropic + power)   │
│  Col 2: "claude code" keyword               │
│  Col 3: "CLAUDE.md" keyword                 │
│  Col 4: "agentic coding" keyword            │
│  Col 5: Frame mentions                      │
│  Col 6: "spec kit" / "spec-driven"          │
└──────────────────┬──────────────────────────┘
                   │
                   │ Kaan sees high-signal tweet
                   ▼
┌─────────────────────────────────────────────┐
│  Bookmark in X + paste URL to Telegram      │
│  channel "frame-replies-queue"              │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  At reply time (1× daily or ad-hoc):         │
│                                              │
│  1. Open Telegram channel                    │
│  2. For each queued tweet, paste into       │
│     Claude (web or CLI) with prompt:        │
│     "You're helping me draft a Twitter      │
│      reply for Frame. Context: [playbook    │
│      core]. Tweet: [paste]. Draft 2-3       │
│      replies in different tones."           │
│  3. Pick + edit + post                       │
└─────────────────────────────────────────────┘
```

## Setup time
~30 minutes total.

## Cost
- X Premium: $8/mo
- Claude usage: existing (Kaan already has access)
- Telegram: free
- **Total: $8/mo**

## Pros
- Zero deployment, zero maintenance
- No Twitter API rate limits or costs
- Matches Kaan's actual volume (5-10 substantive replies/week)
- Telegram-as-queue is friction-free

## Cons
- Manual signal catching — if Kaan doesn't open TweetDeck, signals decay
- No automated scoring
- 5-min poll discipline is on Kaan

## Setup steps

1. Subscribe to X Premium ($8) — unlocks TweetDeck-style multi-column view.
2. Create 6 columns per the layout above.
3. Create a private Telegram channel: `frame-replies-queue`. Just you.
4. Habit: 10 min TweetDeck pass in the morning + 10 min in the evening.
5. High-signal tweets: copy URL → paste to Telegram channel.
6. Reply session (once a day): open Telegram, paste each tweet into Claude with the standard prompt below, edit drafts, post.

## Standard Claude prompt for drafting

```
You're helping me draft a Twitter reply for my project Frame
(structure, context, and memory for agentic coding — built for
developers using Claude Code, Codex, and Gemini).

Tweet I'm replying to:
[PASTE TWEET]

Context I want to bring up (pick whichever fits naturally — don't
force them):
- AGENTS.md as single source for multi-AI projects
- STRUCTURE.json + intentIndex for fast file lookup
- Git commit as deterministic context anchor
- outcome.md as the missing 4th file in spec-driven dev
- Per-project session isolation
- Terminal-first + 3×3 grid for parallel agentic work

Draft 2-3 reply options in different tones:
1. Technical / no product mention
2. Empathetic / personal experience
3. Direct / brief Frame mention (only if thread depth justifies)

Constraints:
- First 5 words must deliver value
- Under 280 chars unless threading makes sense
- Never "Great point!" / generic affirmations
- If product mention: tasteful, not salesy
```

Save this prompt as a Claude project or as a snippet. Reuse for every reply.

---

# Path B — Custom Monitoring Bot (defer until justified)

Only build this if Kaan is consistently doing 30+ replies/week AND it's been working manually for at least a month.

## Realistic stack

```
┌──────────────────────────────────────────────┐
│         Worker (Railway / Fly.io / Vercel cron)│
│                                                │
│  Every 10 min:                                 │
│  ─── Fetch latest tweets from sources          │
│       ├─ Twitter API Basic ($100/mo, limited)  │
│       ├─ OR: Browser automation w/ Playwright  │
│       │   (logged-in account, parse DOM)       │
│       └─ OR: Nitter mirror (unreliable)        │
│                                                │
│  ─── For each new tweet:                       │
│       ├─ Check de-dupe cache (SQLite)          │
│       ├─ Score with Claude API:                │
│       │    "Reply opportunity for Frame?       │
│       │     Score 1-10, explain."              │
│       └─ If score >= 7:                        │
│             ├─ Generate 2-3 draft replies      │
│             ├─ Send Telegram message:          │
│             │   - Tweet URL                    │
│             │   - Score + reasoning            │
│             │   - 3 drafts (different tones)   │
│             └─ Cache as "notified"             │
└──────────────────────────────────────────────┘
```

## Tech choices

- **Language:** Node.js (Kaan already uses it in Frame, ergonomic familiarity)
- **Deployment:** Railway ($5/mo hobby) or Fly.io (free tier)
- **Storage:** SQLite (de-dupe cache + reply log) — Redis is overkill
- **Twitter source:** see decision matrix below
- **AI:** Claude API
  - Sonnet 4.6 for scoring + drafting (cost-optimized)
  - Opus 4.7 only for manifesto-style longer drafts
- **Notification:** Telegram Bot API (free, instant)

## Twitter source decision matrix

| Option | Cost | Reliability | Legal |
|--------|------|-------------|-------|
| Twitter API Basic | $100/mo | High but rate-limited | ✅ |
| Twitter API Pro | $5K/mo | Production-grade | ✅ — out of scope |
| Playwright + logged-in account | $0 + dev time | Medium (DOM breaks) | ⚠️ ToS gray zone |
| Nitter public instance | $0 | Low (instances die) | ⚠️ |
| Self-host Nitter | $0 + ops | Medium | ⚠️ rate-limited by Twitter |

**If pursuing Path B:** Start with Twitter API Basic ($100/mo). Scraping has a higher hidden cost — broken DOM selectors, ToS risk, lost data when X changes its frontend.

## Cost estimate (monthly)

- Twitter API Basic: $100
- Railway hobby: $5
- Claude API:
  - 10K tweets/mo × scoring (~500 input + 100 output, Sonnet) ≈ $15
  - 50 tweets get drafted × 3 drafts (~1K input + 500 output, Sonnet) ≈ $10
- Telegram: $0
- **Total: ~$130/mo**

That's 16× Path A. ROI depends on whether you actually post 30+ replies/week.

## Code structure (if built)

```
frame-twitter-bot/
├── src/
│   ├── sources/
│   │   ├── twitter-api.js       # Twitter API v2 wrapper
│   │   ├── target-list.js       # 50 account config
│   │   └── keywords.js          # search query config
│   ├── scoring/
│   │   ├── claude-scorer.js     # Claude prompt + scoring logic
│   │   └── playbook-context.md  # Compressed version of this playbook
│   ├── drafting/
│   │   ├── claude-drafter.js    # 3-tone draft generation
│   │   └── templates/           # Tone templates from content-pillars
│   ├── notify/
│   │   └── telegram.js          # Telegram bot send
│   ├── storage/
│   │   ├── sqlite.js            # de-dupe + log
│   │   └── schema.sql
│   └── index.js                 # Main cron loop entry
├── package.json
└── .env                         # API keys
```

## Critical: Scoring prompt template

This prompt is the heart of the bot. Tune carefully on real tweets before going live.

```
SYSTEM:
You are scoring tweets for whether they're a high-quality reply
opportunity for Frame — an open-source project layer for agentic
coding (Claude Code, Codex, Gemini). Frame solves: context loss
between sessions, no project standard, stale CLAUDE.md, agents
re-searching the same files.

A high-score tweet (8-10):
- Names a specific pain Frame addresses
- Has engagement (>5 replies usually)
- Author is in dev / AI tooling space
- Not a 6+ month old tweet
- Not a paid promotion

Medium (5-7): adjacent but reply needs work to fit
Low (1-4): off-topic, too generic, or too crowded

OUTPUT JSON:
{
  "score": 1-10,
  "reason": "1 sentence",
  "best_pillar": "A|B|C|D|E",
  "suggested_angle": "playbook angle number if any"
}

USER:
Tweet: [TWEET_TEXT]
Author: [HANDLE], [BIO_FIRST_LINE]
Engagement: [REPLIES], [LIKES]
```

## Build sequence (7-day plan if pursued)

- **Day 1-2:** Twitter API access + target list config + de-dupe cache (SQLite schema, scheduled fetch).
- **Day 3-4:** Scoring prompt iteration on real tweets, tune threshold.
- **Day 5:** Drafting prompt + Telegram delivery.
- **Day 6:** Deploy to Railway, cron setup, log dashboard.
- **Day 7:** Live test, calibrate scoring sensitivity.

---

## Recommendation

**Stick with Path A for the first 4-6 weeks.** Why:

1. Manual signal catching teaches you what patterns actually convert. The bot's scoring prompt later depends on this knowledge.
2. The $130/mo for Path B is better spent on Frame product development at this audience size.
3. The activation energy of Path B (1 week of dev) pulls Kaan off Frame core. Bad trade unless audience justifies it.

**When to switch to Path B:**
- Consistently doing 30+ substantive replies/week
- Manual TweetDeck pass takes >40 min/day (becomes the bottleneck)
- At least one meaningful Frame conversion (sign-up, star, contributor) traced to a reply

Until then: Path A only.

---

## Path A optimizations that buy you a lot

While on Path A, small upgrades can dramatically improve signal:

- **Pin a Telegram saved-message of the standard Claude prompt** — paste it before each draft session.
- **Color-coded TweetDeck columns** if X Pro supports — Tier 1-2 in a distinct color.
- **Daily morning ritual: 10 min, scroll Tier 1-2 list, queue 3-5 tweets, close TweetDeck.** Don't doom-scroll.
- **Friday review: which queued tweets did you actually reply to?** If <50%, your queue threshold is too low. Tighten.
