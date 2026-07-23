# Frame Twitter Bot — Local

Local-only monitoring tool. Not committed to git.

## Setup (one time)

```bash
cd marketing/bot
cp .env.example .env
# Open .env in editor, paste your X Bearer Token after the =
npm install
```

## Run test bot v0

```bash
npm run test:v0
```

What it does:
- Searches 3 keywords (`"claude code"`, `"CLAUDE.md"`, `"agentic coding"`)
- Returns up to 100 tweets per keyword (max_results=100)
- Prints summary to console
- Saves full results to `data/results-YYYY-MM-DD.json`

Estimated cost per run: $0.30–$1.50 depending on tweet volume.

## Phase plan

- **v0 (this):** measure real tweet volume, validate API behavior. Run once a day manually for 3 days.
- **v1:** add mid-tier account monitoring (timeline reads).
- **v2:** add Claude API scoring + daily Telegram digest.
- **v3:** add cron schedule + internal kill switch (spending cap as code).

## Safety reminders

- `.env` is in `.gitignore` — never commit it.
- Bearer Token is read-only access. Cannot post on your behalf.
- X spending cap is set in Developer Console. Internal kill switch added in v3.
