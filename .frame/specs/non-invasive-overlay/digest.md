---
keywords: non-invasive overlay, .frame-only footprint, zero-touch, launch-time injection, global instruction layer, git exclude, storage seam
related: embedded-migration, activity-monitor, spec-knowledge-layer, cli-spec-command-parity
---
Frame became a read-only overlay: everything it creates in a working tree lives
under `.frame/`, and nothing else is created, modified, deleted or symlinked.
Init's consume-and-symlink of `CLAUDE.md`/`GEMINI.md` is gone, the spec-hint
hooks stopped being merged into `.claude/settings.json`, and husky's tracked
`pre-commit` is now show-the-snippet only (vanilla `.git/hooks/` stays — it is
local-only). `.frame/` is hidden via `.git/info/exclude`, but **conditionally**:
the entry is written only while `.frame/` is untracked and removed once any
`.frame/` path is tracked, so "commit `.frame/`" is the whole opt-in and new
spec folders never go invisible on a teammate's clone. Rejected: editing the
user's `.gitignore` (theirs), and a permanent exclude entry (silent team drift).

Because no root file is planted, context reaches the AI at **launch** instead:
`contextPreamble` composes *pointers* — never content — to the global layer, the
optional `.frame/AGENTS.md`, and the repo's own instruction files, plus a
domain-precedence sentence (repo owns code conventions, Frame owns the
meta-workflow). Per tool, declaratively: Claude Code by flag
(`--append-system-prompt`, `--settings`), Codex/Gemini via a `.frame/bin/<id>`
wrapper that reads the preamble from a file (inlining prose full of quotes and
backticks breaks generated shell scripts).

Frame's own instructions now live once in `userData/frame-global/`, so the
spec-driven toggle has no per-project file to edit and collapsed to a pure
config-flag write; the flag is read fresh at every launch, and when off the
preamble mentions specs **nowhere** — never a negative instruction.

Rules established: storage goes through `frameStore`'s *data* API (paths only
via separately named `…Path()` entries, so "must be a real file" call sites stay
visible for the later Frame-owned store); the scripts resolve meta artifacts
`.frame/`-first with a root fallback until `embedded-migration` runs; footprint
tests walk and diff the whole tree rather than checking named files — that is
what caught the root `STRUCTURE.json` escape.

Chain: spec.md → plan.md → tasks.md → outcome.md
