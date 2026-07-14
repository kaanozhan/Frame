# Plan — Project-agnostic Frame — works for any user, any project

## Architecture

The through-line of every finding is the same: a fact about the Frame repo
(`src/`, `.js`, CommonJS, Electron IPC, Frame module names, macOS, Claude) is
baked in as a constant. The fix is one shared mechanism — a **detection pass**
that turns those constants into *detected inputs* persisted in
`.frame/config.json` — plus generalizing each consumer (parser, templates,
environment managers, onboarding) to read that input, and a fixture/CI layer
so correctness signals stop coming only from Frame's own repo.

Resolved open questions (from the spec's "Open questions for /spec.plan"):

- **Detection source of truth → persist it.** Detection writes a `project`
  block into `.frame/config.json` (the config home mandated by
  `structure-non-standard-layouts` — no new config file). User-editable,
  re-runnable, and readable by the shipped parser with plain `fs`.
- **Parser architecture → dependency-free per-language extractors now;
  tree-sitter later, behind the same seam.** The shipped parser must run from
  a git hook in `.frame/bin/` without `node_modules`
  (`structure-non-standard-layouts` hard constraint), and this spec's own
  out-of-scope line defers deep AST work. So: pluggable regex extractors per
  language, one file each, behind a small interface. The 2026-07-06
  tree-sitter decision belongs to `codebase-graph-onboarding` — when that
  engine lands it replaces extractor internals behind this same interface.
- **Relationship to `structure-non-standard-layouts` → this spec supersedes
  it**, consuming it as the structure-only slice and honoring its constraints
  (byte-identical output for single-`src/` CJS projects, config in
  `.frame/config.json`, dependency-free parser, graceful degradation). Mark
  that spec superseded when this one ships.
- **Detect vs. ask → detect, persist, surface, never block.** Init runs
  detection silently, shows a one-line summary ("Detected: Python · poetry ·
  source root `app/` — review QUICKSTART.md"), and the generated AGENTS.md
  instructs the agent to verify/correct the recorded commands in the first
  session. No mandatory setup dialog.
- **Intent index without Frame's aliases → derived tokenization + agent
  curation.** Generic grouping from dir/basename token analysis (tokens
  spanning ≥ 2 files become intents); the shipped `intent-map.json` for user
  projects is an empty skeleton the user's agent curates, never Frame's map.

### 1. Detection layer — `scripts/detect-project.js`

Dependency-free (pure `fs`/`path`) so it works both as a module required by
Electron main *and* as a CLI shipped into `.frame/bin/` via `PARSER_FILES`
(users re-run it after restructuring: `node .frame/bin/detect-project.js --write`).

Detection reads manifest files, never source contents:

- `package.json` (+ `workspaces`, `pnpm-workspace.yaml`, lockfiles → npm/pnpm/yarn;
  `scripts` → real dev/build/test commands; deps → framework hints)
- `pyproject.toml` / `requirements.txt` / `setup.py` / `manage.py` → Python
  (+ poetry/uv/pip; Django hint)
- `Cargo.toml` (+ `[workspace]`) → Rust · `go.mod` → Go · `Gemfile` → Ruby
- No manifest + mostly `.md` files → docs repo
- Source roots: first match among manifest hints, then conventional dirs
  (`src`, `lib`, `app`, `server`, `client`, `cmd` + `internal`,
  `packages/*/src`, `apps/*`), else repo root with default ignores.

Output shape, persisted under `project` in `.frame/config.json`:

```json
{
  "project": {
    "languages": ["python"],
    "packageManager": "poetry",
    "sourceRoots": ["app", "core"],
    "layout": "single",
    "commands": { "install": "poetry install", "test": "poetry run pytest", "dev": null, "build": null },
    "markers": ["pyproject.toml", "manage.py"],
    "detectedAt": "…",
    "confidence": "high"
  }
}
```

Honest degradation: unknown stack → `languages: []`, `sourceRoots: ["."]`,
`confidence: "none"`, and every downstream consumer says so ("couldn't detect
a source root — scanning repo root; review STRUCTURE.json") instead of
guessing. Backwards compat: a config without the `project` block behaves
exactly like today (`sourceRoots: ["src"]`, JS only). On Frame's own repo
detection must infer precisely today's behavior.

### 2. Structure generation — generalize `scripts/update-structure.js`

- **Walker.** `getAllJSFiles()` → `getAllSourceFiles()`: iterates
  `project.sourceRoots` from config (fallback `["src"]`), collects extensions
  registered by the language extractors, applies a built-in ignore set
  (`node_modules`, `vendor`, `.venv`, `venv`, `target`, `dist`, `build`,
  `.git`, `__pycache__`, …) plus top-level `.gitignore` directory patterns
  (simple prefix/glob subset — not a full gitignore engine), uses `lstatSync`
  and never follows symlinks, and caps depth (12) and file count (5000) with
  a printed warning when a cap trips — no emptiness, garbage, or hangs.
- **Pluggable extractors — `scripts/lang/*.js`.** One dependency-free module
  per language exporting `{ extensions, extractExports, extractDependencies,
  extractFunctions, extractPurpose }`; a registry in `update-structure.js`
  dispatches by extension:
  - `javascript.js` — current CJS logic **plus** ESM (`import`/`export`) and
    TS/TSX/JSX/MJS/CJS extensions; strips TS type annotations from captured
    params instead of emitting junk. Existing CJS-on-`src/` output stays
    byte-identical (guarded by a golden-file test).
  - `python.js` — `def`/`class`, top-level `import`s, docstring first line as
    purpose. `go.js` — exported (capitalized) funcs/types, imports, package
    name. `rust.js` — `pub fn`/`pub struct`/`pub trait`, `use` deps.
    `markdown.js` — first heading as purpose, no exports (docs repos get a
    file map, not garbage).
  - Unknown extension → file listed with path + size only. Good-enough +
    honest, per the spec's out-of-scope line.
- **De-Frame the vocabulary.** `syncIPCChannels()` loses the hardcoded
  `src/shared/ipcChannels.js` path and the literal `categoryRules` table of
  Frame channel names: it runs only when config names a channels file
  (`project.ipcChannelsFile`), and derives categories from the channels' own
  name tokens. Frame's repo sets that field in its own `.frame/config.json`;
  every other project simply has no `ipcChannels` section. Auto-grouping in
  `generateIntentIndex()` replaces the Frame-flavored camelCase `suffixes`
  list with generic dir/basename tokenization (an intent = a token spanning
  ≥ 2 files). (`structureBootstrap.js` already seeds a skeleton
  `intent-map.json` instead of Frame's curated map — that part landed with
  audit-q3-core-value-efficacy; nothing left to do there.)
- **Remove the `no-src` skip.** `runInitialFullScan()` in
  `structureBootstrap.js` always runs; the parser itself decides what to scan
  from config and reports honestly when detection found nothing.

### 3. Parametric templates — `src/shared/frameTemplates.js`

Template getters gain a `project` parameter (the detected block; `null` falls
back to today's generic text, so existing callers keep working):

- `getQuickstartTemplate(name, project)` — real install/dev/build/test
  commands from detection (no hardcoded `npm`), real top-level tree from
  `sourceRoots`, and the `todos.json` → `tasks.json` bug fixed (both
  occurrences). Unknown commands render as an explicit
  `# TODO: confirm — Frame couldn't detect this` line, not a wrong guess.
- `getStructureTemplate(name, project)` — drops the presumed
  `ipcChannels`/`dataFlow`/`entryPoint` Electron shape; base shape is
  `modules` + `intentIndex` + optional `architectureNotes`, seeded with the
  detected languages/roots.
- `getAgentsTemplate(name, options, project)` — gains a `## Project Facts`
  section (stack, package manager, source roots, commands, marked
  "detected — verify") and an explicit instruction: *record this project's
  own stack, conventions, entrypoints, and commands here as you learn them;
  never assume this project's shape generalizes* — closing the audit's
  meta-failure (Finding 9). Wording stays tool-agnostic.
- `src/main/frameProject.js` — `initializeFrameProject()` runs the detector
  first, persists the `project` block into `.frame/config.json`, threads it
  into every template call, and returns the detection summary so the renderer
  can show it.

### 4. Environment parity + fail-loud

Pattern for all four: resolve cross-platform where possible; where not,
send a **specific machine-readable reason** to the renderer so panels render
"why", never a silent empty state. (`claudeUsageManager` already has the
`degradedPayload(reason)` shape — reuse it as the convention.)

- `claudeUsageManager.js` — before giving up on non-macOS, read Claude Code's
  file-based store (`~/.claude/.credentials.json`); Keychain becomes the
  macOS-first path, the file the portable fallback. Reasons: `no-credentials`,
  `keychain-unsupported` (existing), `token-expired`.
- `claudeSessionsManager.js` — `encodeProjectPath()` matches Claude Code's
  real encoding (`.` replaced as well as `/`, and Windows `\`/drive-colon);
  when the encoded dir doesn't exist, distinguish `no-sessions-dir` from
  "zero sessions".
- `pluginsManager.js` — preflight `git --version` before `git clone`; clone
  failure classified (`git-missing`, `network`, `other`) and sent with the
  plugins payload; `src/renderer/pluginsPanel.js` renders the reason in its
  empty state.
- `aiToolManager.js` — on first run, probe which CLIs exist (`claude`,
  `codex`, `gemini` via the login shell) and default `activeTool` to an
  installed one instead of hard `claude`; shell fallback becomes
  platform-aware (`/bin/bash` on Linux, `COMSPEC` on Windows, `/bin/zsh`
  only on macOS) in both `aiToolManager.js` and legacy `pty.js`.

### 5. Generic-path onboarding

- `src/renderer/welcomeOverlay.js` — "Open your own project" becomes a real
  peer of the sample CTA (not a dead end), leading into init + detection.
- `src/renderer/sampleBanner.js` — generalized into a first-run banner for
  *any* newly initialized project: shows the detection summary and next steps
  ("review QUICKSTART.md", "run your agent — it reads AGENTS.md"), with the
  sample-specific copy as one variant. Wrong detection → the banner's "review"
  link is the correction path (edit `.frame/config.json`, re-run the scan).

### 6. Cross-project validation — fixtures + CI

- `test/fixtures/` — six minimal fixture repos (a handful of files each):
  `js-src-app/` (today's convention — golden-file byte-compat guard),
  `django-app/`, `go-service/` (`cmd/`+`internal/`), `rust-workspace/`,
  `pnpm-monorepo/` (`packages/*/src`), `docs-repo/` (Markdown only).
- `test/projectAgnostic.test.js` (node --test, same runner as the existing
  `test/*.test.js`) — for each fixture: run `detect-project.js`, assert the
  detected language/roots/commands; run `update-structure.js` with
  `FRAME_PROJECT_ROOT`, assert a non-empty stack-appropriate `modules` block
  and **zero Frame vocabulary** (no Frame IPC names, aliases, or suffixes) in
  the output; render QUICKSTART/AGENTS from the detection and assert real
  commands, no `npm` on non-Node fixtures, no `todos.json`.
- `test/detectProject.test.js`, `test/langExtractors.test.js` — unit tests
  for the detector and each extractor (including the symlink-cycle and
  ignore-dir walker cases).
- `.github/workflows/ci.yml` — first CI for the repo: checkout + setup-node +
  `npm test` on push/PR (ubuntu + macos). The whole suite uses Node's
  built-in runner and repo-local modules only, so CI must **not** run
  `npm ci` (the `postinstall` electron-rebuild needs Electron binaries and
  would make CI slow/fragile for zero benefit). Closes the "validated only
  against itself" gap and prevents the next agent from re-baking a
  Frame-repo assumption.

## Files

- `scripts/detect-project.js` — **New** — dependency-free stack/roots/commands detector (module + CLI), shipped to user `.frame/bin/`.
- `scripts/update-structure.js` — **Modified** — config-driven multi-root walker with ignores/symlink/depth caps, extractor registry, de-Framed `syncIPCChannels` + generic intent grouping, no-src skip removed from its callers' contract.
- `scripts/lang/javascript.js` — **New** — JS/TS/JSX/MJS/CJS extractor (CJS byte-compat + ESM/TS).
- `scripts/lang/python.js` — **New** — Python extractor.
- `scripts/lang/go.js` — **New** — Go extractor.
- `scripts/lang/rust.js` — **New** — Rust extractor.
- `scripts/lang/markdown.js` — **New** — docs-repo extractor (headings → purpose).
- `src/main/structureBootstrap.js` — **Modified** — ship `detect-project.js` + `scripts/lang/*` in `PARSER_FILES` (the copy loop is flat today — needs subdir support), remove the `skipped-no-src` branch.
- `src/shared/frameTemplates.js` — **Modified** — `project`-parametric QUICKSTART (fix `todos.json`→`tasks.json`), generic STRUCTURE shape, AGENTS.md Project Facts + record-your-stack instruction.
- `src/main/frameProject.js` — **Modified** — run detection at init, persist `project` block, thread into templates, return summary.
- `src/main/claudeUsageManager.js` — **Modified** — file-based credential fallback, reason codes.
- `src/main/claudeSessionsManager.js` — **Modified** — correct path encoding, `no-sessions-dir` reason.
- `src/main/pluginsManager.js` — **Modified** — git/network preflight, classified failure reasons in payload.
- `src/main/aiToolManager.js` — **Modified** — installed-CLI default, platform-aware shell fallback.
- `src/main/pty.js` — **Modified** — platform-aware default shell for the legacy path.
- `src/renderer/pluginsPanel.js` — **Modified** — render marketplace failure reason in empty state.
- `src/renderer/welcomeOverlay.js` — **Modified** — "Open your own project" as a first-class CTA.
- `src/renderer/sampleBanner.js` — **Modified** — generalized first-run banner with detection summary.
- `test/fixtures/**` — **New** — six minimal fixture repos (js-src golden, Django, Go, Rust workspace, pnpm monorepo, docs).
- `test/projectAgnostic.test.js` — **New** — init/parse/template assertions per fixture, incl. no-Frame-vocabulary check.
- `test/detectProject.test.js` — **New** — detector unit tests.
- `test/langExtractors.test.js` — **New** — extractor + walker unit tests.
- `.github/workflows/ci.yml` — **New** — run `npm test` on push/PR (ubuntu + macos).
- `.frame/config.json` — **Modified** — Frame's own repo gains its `project` block + `ipcChannelsFile` (dogfooding the detection).

## Scope notes

- The spec's environment findings partially landed already:
  `claudeUsageManager` has the non-macOS `degradedPayload` path — this spec
  extends it (file-based credentials) rather than re-creating it. The
  intentIndex alias table already moved to `scripts/intent-map.json`, and
  `structureBootstrap.js` already seeds user projects with a skeleton map
  rather than Frame's (both via audit-q3-core-value-efficacy); what remains
  here is generalizing the Frame-flavored suffix grouping.
- `structure-non-standard-layouts` is superseded by steps 1–3; mark its
  status accordingly when this ships (meta bookkeeping, conductor lane).
- Frame meta files (`STRUCTURE.json`, `tasks.json`, `PROJECT_NOTES.md`,
  `AGENTS.md`) are untouched by workers and excluded from the Footprint;
  `.frame/config.json` is repo-local config, not a meta file, but the edit is
  one small block — keep it in the step that dogfoods detection.

## Footprint

- scripts/detect-project.js
- scripts/update-structure.js
- scripts/lang/**
- src/main/structureBootstrap.js
- src/shared/frameTemplates.js
- src/main/frameProject.js
- src/main/claudeUsageManager.js
- src/main/claudeSessionsManager.js
- src/main/pluginsManager.js
- src/main/aiToolManager.js
- src/main/pty.js
- src/renderer/pluginsPanel.js
- src/renderer/welcomeOverlay.js
- src/renderer/sampleBanner.js
- test/fixtures/**
- test/projectAgnostic.test.js
- test/detectProject.test.js
- test/langExtractors.test.js
- .github/workflows/ci.yml
- .frame/config.json

## Dependencies

None. The detector and extractors are pure Node (`fs`/`path`) by hard
constraint (they ship to `.frame/bin/` and run from a git hook without
`node_modules`); tests use the built-in `node --test` runner already wired to
`npm test`; CI uses stock GitHub Actions.

## Sequencing

1. **Detector** — `scripts/detect-project.js` (module + CLI) with unit tests
   (`test/detectProject.test.js`) covering all six fixture shapes; verify it
   infers exactly `{src, javascript, npm}` on Frame's own repo.
2. **Fixtures + golden file** — create `test/fixtures/*` including
   `js-src-app/` with a committed golden STRUCTURE.json, so every later step
   has a regression net before the parser changes.
3. **Walker generalization** — config-driven `sourceRoots`, ignore set +
   `.gitignore` dirs, no symlink following, depth/file caps with honest
   warnings; remove the `skipped-no-src` branch in `structureBootstrap.js`.
   Golden file must stay byte-identical.
4. **Extractor registry + `scripts/lang/javascript.js`** — move current CJS
   logic behind the interface, add ESM/TS/JSX support and TS-annotation
   cleanup. Golden file still byte-identical for the CJS fixture.
5. **Remaining extractors** — `python.js`, `go.js`, `rust.js`, `markdown.js`
   with `test/langExtractors.test.js`; wire `test/projectAgnostic.test.js`
   asserting non-empty, stack-appropriate modules per fixture.
6. **De-Frame the vocabulary** — config-driven `syncIPCChannels`
   (`ipcChannelsFile`) and tokenization-based intent grouping; add Frame's
   `project` + `ipcChannelsFile` block to `.frame/config.json` and confirm
   Frame's own STRUCTURE.json output is unchanged. Add the
   no-Frame-vocabulary assertion to the fixture tests.
7. **Parametric templates** — thread `project` through
   `getQuickstartTemplate` (fix `todos.json`), `getStructureTemplate`,
   `getAgentsTemplate` (Project Facts + record-your-stack instruction); init
   in `frameProject.js` runs detection, persists the block, passes it in.
   Extend fixture tests to assert QUICKSTART/AGENTS content.
8. **Environment parity** — credentials file fallback (usage), path-encoding
   fix (sessions), git/network preflight + reason rendering (plugins +
   pluginsPanel), installed-CLI default + platform shells (aiTool + pty).
   Each lands with its specific reason string visible in the UI empty state.
9. **Generic onboarding** — welcomeOverlay "Open your own project" CTA and
   the generalized first-run detection banner in sampleBanner.js; verify by
   initializing a scratch non-JS repo end-to-end in the app.
10. **CI** — `.github/workflows/ci.yml` running `npm test` on ubuntu + macos
    (no `npm ci` — see Architecture §6); confirm the matrix runs the fixture
    suite green, closing the "validated only against itself" loop.
