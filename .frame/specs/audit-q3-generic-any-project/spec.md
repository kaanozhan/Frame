# Project-agnostic Frame — works for any user, any project

> Audit-sourced findings spec (Q3 2026 deep-dive review). Captured, not yet planned — recorded via the `audit-q3` study. This spec confronts the founder's stated worry directly: Frame was built only ever by dogfooding on the Frame repo itself (an Electron/JS app on macOS), so agents kept solving the immediate Frame task and baked the Frame repo's shape into the product — while Frame must work for *any* user, on *any* project.

## Problem

Frame's premise — durable, structural context so a future agent arrives *knowing*
what/why/outcome instead of scanning code and guessing — only holds if Frame
works on an arbitrary user's project. Today large parts of it silently assume
**Frame's own shape**: a `src/` root, `.js` CommonJS files, Electron IPC, Frame's
module names, the founder's macOS, and Claude Code. On a Django / Rust / Go /
TypeScript / monorepo / docs repo, the core mechanisms produce empty, stale, or
misleading output — and fail silently. This is the "self-hosting blind spot," and
it is not hidden: Frame's own spec files and code comments admit it.

### 1. Structure generation is hardcoded to `src/` + `.js` + CommonJS + Electron
`scripts/update-structure.js` (shipped verbatim into every user's `.frame/bin/`):
- **`src/`-only root** — `SRC_DIR = path.join(ROOT_DIR, 'src')` (`:25`), `getAllJSFiles()` walks only `src/` (`:311`), `--changed` filters `f.startsWith('src/')` (`:281`). Any repo using `lib/`, `app/`, `packages/` (monorepo), `cmd/`+`internal/` (Go), package dirs (Python), or root-level code gets `modules: {}` forever.
- **`.js`-only** discovery (`:321`) — `.ts/.tsx/.jsx/.mjs/.cjs` (even a Vite/Next app), `.py`, `.go`, `.rs`, `.java` all yield nothing. A plain TypeScript app with a `src/` still gets an empty map.
- **CommonJS-only parsing** — `extractExports` matches only `module.exports` (`:79-104`); `extractDependencies` only `require()` (`:109-127`); `extractFunctions` regexes JS `function`/arrow forms (`:132-186`, captures TS type annotations as junk params). ESM/TS/Python/Go/Rust → empty or garbage exports/deps/functions.
- **`getAllJSFiles` has no ignore list and follows symlinks** (`:311-327`, `fs.statSync`) — recurses into `node_modules`/`vendor`/`.venv`/`target`; a symlink cycle → infinite loop; a large vendored tree → pathologically slow. (Frame's own `src/` happens to contain none of these, so it never bit us.)
- **`structureBootstrap.js:254-260`** literally skips the initial scan when there is no `src/` (`status: 'skipped-no-src'`), so non-`src/` projects get an empty STRUCTURE.json that is never populated — "forever-stale."

### 2. Frame ships its OWN codebase vocabulary into every user project
`scripts/update-structure.js`:
- **`syncIPCChannels()`** (`:365-438`) hardcodes `src/shared/ipcChannels.js` and a `categoryRules` table of **literal Frame IPC channel names** (`TERMINAL_CREATE`, `LOAD_GITHUB_ISSUES`, `INITIALIZE_FRAME_PROJECT`, `LOAD_CLAUDE_USAGE`…). "IPC channels" is an Electron concept that exists in no other app.
- **`generateIntentIndex()`** (`:513-587`) ships an **`aliases` table of Frame's own module names** → intents (`pty`→terminal, `claudeUsageManager`→claude-usage, `githubManager`, `gitBranchesManager`…) and a `suffixes` list of Frame's camelCase UI convention (`Manager`, `Panel`, `UI`, `Selector`, `TabBar`, `Grid`). On any other project these tables match nothing — Frame's repo brain, dead weight in every user's `.frame/bin/`. This is the single clearest instance of "built for the Frame repo" leaking into product code; `find-module.js` inherits all of it.

### 3. Injected context teaches Frame's bookkeeping, not the user's project
- `frameTemplates.js:102-276` `getAgentsTemplate()` — the AGENTS.md written into a user's project is **~85% Frame process ceremony** (tasks.json rules, PROJECT_NOTES cadence, STRUCTURE.json format, "Frame's core purpose is to prevent context loss", `:188`) and **0% about the user's project**. The only interpolation is `${projectName}` in the H1 (`:106`, branded "…- Frame Project"). init never learned anything about the project, so there is nothing project-specific to say — no stack, no build/test/run commands, no layout, no conventions.
- `frameTemplates.js:371-431` QUICKSTART — hardcodes `npm install`/`npm run dev`/`npm test` and a `src/` tree, and points the AI at **`todos.json`** (`:408/:423`) — a file Frame never creates (it creates `tasks.json`). Actively misleading on a non-Node project.
- `frameTemplates.js:281-300` STRUCTURE.json template presumes a `modules{}`/`dataFlow[]`/`ipcChannels`/`entryPoint` architecture — an Electron shape handed to a docs monorepo or Rust workspace to fill in.
- Meta-failure (Finding 9 of the audit): Frame's whole pitch is "capture project intent," yet its shipped guidance contains **no instruction for the user's agent to record project-specific facts** (language, framework, build/test commands, entrypoints, conventions). Nothing in `SPEC_DRIVEN_SECTION` nudges an agent to avoid baking in project-specific assumptions either. **Frame's own guidance reproduces exactly the blind spot the founder is worried about** — it optimizes the bookkeeping ritual, not genuine project understanding.

### 4. Environment assumes the founder's macOS + Claude setup (silent degradation)
- `claudeUsageManager.js:31-33` reads the Claude token via the **macOS-only** `security` Keychain CLI (`2>/dev/null` swallows "command not found"). Every Linux/Windows user (and Claude Code's file-based `~/.claude/.credentials.json` store) → permanently empty usage panel, read as "not logged in."
- `claudeSessionsManager.js:27-29` encodes the project path replacing only `/`, but Claude Code also replaces `.` → any user whose path contains a dot (`my.app`, `v2.0`, `.config`) silently gets an empty session list.
- `pluginsManager.js:202-206` `execSync('git clone …')` with no `git`/network preflight → offline/no-git/proxy users get an empty marketplace, cause hidden in `console.log`.
- `aiToolManager.js` defaults the active tool hard to `claude` (`:130`) even when only Gemini is installed; `/bin/zsh` fallback (`:15-21`) is founder-flavored (Linux default is bash; `/bin/zsh` may not exist). `pty.js:48` (legacy) has no Windows shell branch at all.
- Recurring pattern: **detect-the-founder's-setup, fail silently into an empty panel** with the real cause in `console.log` — reads as "nothing here" rather than "unsupported / not configured."

### 5. Init never inspects the project; onboarding funnels everyone into a JS sample
- `frameProject.js:174` `initializeFrameProject()` writes a fixed file set with **zero inspection of the target** — no read of `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`, no language/framework/layout sniff. Every project gets the identical Frame-shaped scaffold.
- `welcomeOverlay.js:110` — the primary first-run CTA opens the bundled **Node/Express + React sample** (`src/templates/sample-project/`), with JS-flavored sample specs. `sampleBanner.js` gives guided empty-states **only for the sample**. A user who picks "Open Folder" on their real (non-JS) repo gets no equivalent onboarding — the generic-project path is a dead end.

### 6. Nothing validates Frame against any project but itself (the loop is closed on one shape)
No `.github/` (no CI), no test runner, no `test` script; the only test asset is one JS spec fixture and the one JS sample project. **Every correctness signal Frame has ever received about init/parsing/scaffolding came from running on Frame's own Electron/JS repo or a hand-made JS sample.** There is no fixture/harness/CI that runs `initializeFrameProject` against a Python/Rust/Go/docs tree and asserts the output is useful. Nothing prevents the next agent from re-baking a Frame-repo assumption.

### The meta-point, in Frame's own words
`.frame/specs/structure-non-standard-layouts/spec.md` already says it: *"The parser hardcodes `SRC_DIR = 'src'` and walks JavaScript files only. **This works for Frame's own repo**… but silently produces an empty STRUCTURE.json for [monorepos, Python/Go/Rust, ES modules]… **We're intentionally shipping the first version with `src/`-only support (Frame's existing convention) and deferring this work.**"** That deferral, repeated across the subsystems above, *is* the self-hosting blind spot. This spec exists to stop deferring it and make project-agnosticism a first-class product requirement, not a someday-fix.

## Goal

Make Frame genuinely project-agnostic — useful and correct on an arbitrary user's
project on an arbitrary machine — by turning "the Frame repo's shape" from a
hardcoded assumption into a *detected* input. Concretely:

- **Detect the project.** A detection pass in init reads `package.json` /
  `pyproject.toml` / `Cargo.toml` / `go.mod` / `requirements.txt` / etc. to infer
  language(s), package manager, source roots, build/test/run commands, and layout,
  and threads the result into every template and the parser.
- **Generalize structure generation.** Config/detection-driven source roots (not
  hardcoded `src/`), multi-language file discovery, pluggable per-language parsers,
  `.gitignore`-aware ignores + symlink/depth caps, and **removal of Frame's own
  IPC/alias/suffix vocabulary from the shipped defaults** (make any such mapping
  repo-local and derived, never Frame's module names). Remove the `no-src` skip.
- **Make templates parametric.** QUICKSTART build/test commands from detection (and
  fix the `todos.json` → `tasks.json` bug); STRUCTURE.json shape that doesn't
  presume modules/IPC/dataFlow; and an AGENTS.md that instructs the agent to
  **record the user's own stack, conventions, and commands** — making "capture
  project intent" real for the user's project, not Frame's bookkeeping.
- **Environment parity + fail-loud.** Cross-platform token/credential reading,
  shell/CLI resolution, and marketplace/git preflights that **surface a specific
  reason** instead of an empty panel.
- **Real onboarding for the generic path**, not just the JS sample.
- **Cross-project validation.** Fixtures for Python/Rust/Go/monorepo/docs repos + a
  runner + CI asserting init produces a non-empty, stack-appropriate STRUCTURE.json
  and QUICKSTART for each — so the dogfooding loop is no longer closed on one shape.

## Constraints

- **Files-as-canonical-source, one place, Claude-native** (per the 2026-07-02
  vision note) — genericity must not add a service dependency for local use; the
  context stays plain files in the user's repo.
- **Don't over-fit the detection.** Better to degrade gracefully and honestly
  ("couldn't detect a source root — scanning repo root, review STRUCTURE.json")
  than to guess wrong and mislead an agent (stale/wrong context is worse than none).
- **Backwards compatible for Frame itself** — Frame's own repo (Electron/JS/`src/`)
  must keep working; detection should infer exactly today's behavior for it.
- **Tool-agnostic** — injected context and spec commands must serve Claude, Codex,
  Gemini (and future CLIs); no Claude-only or JS-only assumptions in shipped
  templates.

## Success criteria

- `initializeFrameProject` on a Python/Rust/Go/TS/monorepo/docs repo produces a
  **non-empty, stack-appropriate** STRUCTURE.json, a QUICKSTART with that project's
  real build/test commands (no `npm`, no `todos.json`), and an AGENTS.md that
  captures the user's stack — verified by fixtures + CI, not by eyeballing Frame.
- The shipped `update-structure.js` contains **no Frame-specific module names, IPC
  channels, or aliases**; the intent index is derived generically from the user's
  repo.
- Structure generation handles multiple source roots, multiple languages/extensions,
  and ignores/symlinks/large repos without emptiness, garbage, or hangs.
- Usage/sessions/plugins/CLI features either work cross-platform or **fail loud with
  a specific, correct reason**; no silent "empty panel = founder-setup assumption."
- A new user who opens Frame on their own (non-JS) project gets real onboarding, not
  a JS-sample dead end.
- A CI matrix runs init against ≥4 non-JS/non-`src/` project fixtures and asserts
  usefulness — closing the "validated only against itself" gap.

## Out of scope

- Deep semantic/AST analysis or a language server per language — start with good-enough
  per-language extractors and honest degradation.
- The security/atomicity/reliability fixes (covered in the other `audit-q3-*` specs
  and `.frame/FINDINGS-*.md`), except where genericity directly overlaps.
- Rewriting the sample project — adding generic-path onboarding does not require
  removing the JS sample.

## Open questions for /spec.plan

- **Detection source of truth:** infer everything at init from manifest files, or
  store a small `.frame/project.json` (detected language/roots/commands) that the
  parser + templates read? The latter makes it user-editable and re-runnable.
- **Parser architecture:** per-language regex extractors (cheap, ships now) vs.
  tree-sitter/one-grammar-per-language (accurate, heavier dependency) — where's the
  line for a solo-founder-scale first version? **(Decided 2026-07-06 in
  `codebase-graph-onboarding`: lead with tree-sitter, permissive-OSS + local as hard
  constraints, semantic graph deferred. The code map is a commodity/derived layer to
  delegate to an OSS engine, not to hand-roll.)**
- **Relationship to `structure-non-standard-layouts`:** that spec is the JS/TS/Python
  root-detection starting point; does this spec supersede it (broader — vocabulary,
  templates, environment, validation) or consume it as its structure-only slice?
- **How much to detect vs. ask:** silently infer build/test commands, or confirm them
  with the user on first init (a 30-second setup that guarantees correctness)?
- **Intent index without Frame's aliases:** can a generic concept→file map be derived
  usefully from dir/name tokenization + description keywords alone, or does it need
  the agent to help build it once at onboarding?
- **Validation fixtures:** which project shapes are the canonical test set (Django,
  Go module, Rust workspace, pnpm monorepo, docs/Markdown repo, notebook repo)?
