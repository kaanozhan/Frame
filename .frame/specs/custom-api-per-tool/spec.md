# Custom API endpoint + key per AI tool

## Problem

Frame launches each AI CLI (Claude Code, Codex, Gemini) against the tool's
default API. Users who route their models through a proxy/router — e.g. 9router,
OpenRouter, or a self-hosted gateway — have no in-app way to point Frame's tools
at their endpoint. They're forced to hand-edit shell profiles or
`~/.claude/settings.json`, which is fiddly and easy to get wrong (one tester:
"Hermes is still trying to configure it"; another hit an earlier bug where Frame
reset those settings — now fixed in PR #99). There is no first-class,
discoverable way to connect a custom API per tool.

## Goal

Let users connect a custom API per AI tool from inside Frame: set a **base URL +
API key** for each of Claude / Codex / Gemini in an AI-tool settings surface.
Frame injects the right env vars into that tool's terminal at launch — it
already injects `extraEnv` into the PTY — so the agent talks to the user's
endpoint, in **both normal and orchestrator lanes**. Unset = today's behavior.

## Constraints

- **Env injection, not config rewrites.** Frame owns the PTY env (`extraEnv`);
  merge the per-tool vars there at launch. Never edit the tools' own config files.
- **Right var per tool:** Claude → `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`
  (or `ANTHROPIC_AUTH_TOKEN`); Codex → `OPENAI_BASE_URL` + `OPENAI_API_KEY`;
  Gemini → its base-URL + key vars (confirm exact names in plan).
- **Secrets are user data:** store in the app's user settings (`userData`), never
  in the repo/project; mask in the UI; never log them.
- Must **not** clobber or depend on `~/.claude/settings.json` (we got burned there).
- Same launch path for the orchestrator **conductor + worker** lanes.
- **Backwards compatible:** empty config → unchanged; env already set in the
  user's shell keeps working (login-shell PTY still inherits it).

## Success criteria

- In AI-tool settings, the user sets base URL + key per tool; values persist
  across launches.
- Starting a tool injects those vars into its PTY and the agent reaches the
  custom endpoint (verified with e.g. 9router / OpenRouter).
- Works in normal lanes **and** orchestrator lanes.
- Unset tools behave exactly as before.
- Secrets live in `userData` (user-settings.json), not the repo; masked in UI;
  absent from logs.
- The CLI availability check still passes with a custom endpoint configured.

## Out of scope

- A custom launch command / wrapper (e.g. `ccr code`) — different mechanism, can
  be a follow-up.
- Per-project (vs global) API config.
- Model selection / routing UI beyond base URL + key.
- Managing or validating the router itself.

## Open questions for /spec.plan

- Exact env var names Codex CLI and Gemini CLI honor for base URL + key (verify
  against current CLI versions).
- Where the settings UI lives — the existing AI-tool selector area vs a dedicated
  settings panel.
- Secret storage in `userData`: plain JSON vs OS keychain (keychain safer but
  heavier) — decide.
- Whether to add a "test connection" button.
