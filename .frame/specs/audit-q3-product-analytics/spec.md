# Product analytics & instrumentation

> Audit-sourced findings spec (Q3 2026 deep-dive review). Captured, not yet planned — recorded via the `audit-q3` study.

## Problem
Frame ships telemetry that emits exactly **one** event — `app_started` — and nothing else. `trackAppStarted()` fires `aptabase.trackEvent('app_started')` (`src/main/telemetry.js:48`), called once per launch from `src/main/index.js:154`. A codebase-wide search for `trackEvent` confirms no other call site exists. The event carries only app version, OS, and an anonymous launch count (see `PRIVACY.md:7-13`).

Consequently the founder has **zero signal** on everything that matters for roadmap decisions:
- **Feature usage** — no idea whether the Orchestrator, spec-driven flow (`spec` → `plan` → `tasks`), plugins, or which AI tool (Claude Code / OpenCode / etc.) are actually used.
- **Activation** — do users ever initialize a Frame project, start an agent, or create a spec after installing? Unknown.
- **Retention** — the launch count hints at repeat launches but nothing ties usage to meaningful return behavior or cohorts.
- **Funnel / drop-off** — where do users stall between install → first project → first spec → first agent run? Invisible.
- **Errors & performance in the wild** — no count of failures (agent launch failures, merge conflicts, CLI-not-found, etc.), no timing. Bugs are only seen if a user files an issue.

Roadmap and prioritization are therefore made **blind**, on intuition and anecdote rather than data.

Compounding this, opt-out is **not durable**. `userSettings.load()` swallows any read/parse error and resets `cache = {}` (`src/main/userSettings.js:34-37`). `isEnabled()` then reads `userSettings.get('telemetryEnabled')`, gets `null`, and returns `null !== false === true` (`src/main/telemetry.js:68-71`). So if `user-settings.json` is ever corrupted or unreadable, a user who explicitly opted **out** is silently opted back **in** — a privacy regression that directly contradicts `PRIVACY.md`.

## Goal
Introduce a **small, deliberate set** of privacy-respecting events so the founder can answer basic product questions — *which features get used, do users activate, do they come back, what fails* — without weakening Frame's privacy stance. Specifically:
- **Activation milestones**: project initialized, first spec created, first agent/orchestrator run started.
- **Feature usage** (which surface, not its contents): orchestrator opened, spec phase advanced (`spec`/`plan`/`tasks`), plugin invoked, AI tool selected (tool identity only, e.g. `claude-code`).
- **Error occurrence counts**: an event with a coarse category/enum for notable failures (agent launch failed, merge conflict, CLI not found) — **counts and categories only, never messages, stack traces, paths, or content**.
- **Durable opt-out**: opt-out must survive settings corruption. On unreadable/corrupt settings, telemetry should **fail closed** (treat state as opt-out or otherwise not silently re-enable) rather than default back on.
- **Honest disclosure**: `PRIVACY.md` updated to enumerate every new event and reaffirm what is still never collected.

## Constraints
- **Honor existing PRIVACY.md commitments** (`PRIVACY.md:15-23`): no file paths, no file contents/code, no project names, no AI prompts/responses, no terminal I/O, no email/PII, no IP retention.
- **Preserve the opt-out (default-on) model** — do not switch to opt-in; keep the Settings toggle "Send anonymous usage stats" and the one-time notice banner as the consent surface.
- **Content-free events only** — event names + low-cardinality enum properties (OS, version, tool identity, error category). No free-form strings sourced from user data, no identifiers that could re-identify a user or project.
- **Aptabase is already integrated** (`src/main/telemetry.js:14,34`) — prefer extending it (a `track(name, props)` helper gated by `isEnabled()`) over adding a new vendor unless a concrete reason emerges.
- **Any new event MUST be reflected in PRIVACY.md before/with shipping** — the doc is a strong trust asset and must stay accurate.

## Success criteria
- A **named, documented event set** is defined (activation, feature-usage, error-count) with explicit, low-cardinality property schemas and zero content/PII fields.
- **Opt-out is honored even when `user-settings.json` is corrupt or unreadable** — a user who opted out stays opted out; the re-opt-in bug (`userSettings.js:34-37` + `telemetry.js:68-71`) is fixed and covered by a test.
- **`PRIVACY.md` is updated** to list every new event and its properties, and to restate the "we do not collect" list.
- The founder can concretely answer: *"Which features are used?"*, *"Do users activate (init a project / create a spec / start an agent)?"*, and *"What are the most common in-the-wild errors?"* from the analytics dashboard.

## Out of scope
- Session replay or any screen/interaction recording.
- Per-user tracking, stable user IDs, or cross-session identity/cohort stitching beyond Aptabase's anonymous mechanism.
- Any capture of code, prompts, responses, file paths, project names, or other content.

## Open questions for /spec.plan
- Which **exact** events and property enums make the first cut vs. a later phase — what is the minimal set that answers the founder's top questions without event sprawl?
- Stay on **Aptabase** or evaluate an alternative (e.g. PostHog) for funnel/retention views — does Aptabase's model support the funnel questions, or do we need more?
- How do we **validate no-PII / no-content** systematically — a lint/allowlist on event props, a schema gate, and/or a review checklist so a future contributor can't accidentally add a content-bearing property?
- What is the correct **fail-closed** behavior on settings corruption — treat as opt-out, or surface a re-consent prompt — and how do we distinguish "never set" (default on) from "was explicitly off but file got corrupted"?
