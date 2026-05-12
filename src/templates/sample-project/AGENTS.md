# TaskFlow — Project Instructions

This is a **sample project** that ships with Frame to demonstrate the
spec-driven development workflow on a realistic codebase. You're looking
at a fictional SaaS called TaskFlow: a small team task manager built on
Node.js + Express + PostgreSQL + React.

> Open your own project when you're ready to start real work. Everything
> here is read-friendly — feel free to poke around, edit, break things.
> Nothing here ships anywhere.

---

## Project Navigation

**Read these files at the start of each session:**

1. **STRUCTURE.json** — module map (auth, db, api, ui)
2. **PROJECT_NOTES.md** — architectural decisions and "why" notes
3. **tasks.json** — pending and in-flight tasks

**Specs:**
- `.frame/specs/add-google-oauth/` — shipped (look at `outcome.md`)
- `.frame/specs/migrate-to-postgres/` — in progress (4 of 8 tasks done)
- `.frame/specs/email-notifications/` — planned, awaiting `/spec.tasks`

---

## Stack at a glance

- **Backend:** Node.js 20, Express 4, PostgreSQL 16 (migrated from SQLite)
- **Frontend:** React 18 + Vite
- **Auth:** Google OAuth (Passport.js) — see `src/auth/`
- **Database:** `src/db/client.js` is the canonical pool; migrations in
  `src/db/migrations/` (numbered, forward-only)

## Coding Conventions

- All new modules ship with a 5-line header doc explaining purpose +
  exports. See existing files for the pattern.
- Database access lives in `src/db/`; API handlers never touch SQL
  directly. They go through query helpers.
- React components stay under 150 lines. If a component grows past
  that, split it into a sub-folder with its own components/.
- Commit messages: imperative mood, one-line summary + optional body.

## Task Management

When the user describes work, draft it in `tasks.json` (status `pending`)
and confirm before adding. When a task is connected to a spec, the
`source` field uses `spec:<slug>:T<n>` form so the Specs panel can show
progress.

---

*Sample content. Frame uses this to demonstrate its workflow — your own
projects start with a much shorter AGENTS.md template that you fill in.*
