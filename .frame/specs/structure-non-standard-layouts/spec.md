# STRUCTURE.json auto-fill for non-standard project layouts

## Problem

The `update-structure.js` parser hardcodes `SRC_DIR = path.join(ROOT_DIR, 'src')`
and walks JavaScript files only. This works for Frame's own repo and for
single-package projects that follow the `src/`-based convention, but
silently produces an empty STRUCTURE.json for:

- **Monorepos** with `packages/*/src/`, `apps/*/src/`, or pnpm/turborepo
  workspaces — no single source dir
- **Projects that use `app/`, `lib/`, `server/`, `client/`** instead of `src/`
- **Root-level code** — CLIs, scripts, single-file utilities
- **Non-JS projects** — TypeScript (compiled output handled, source not),
  Python, Go, Rust, etc.
- **ES module syntax** — `import`/`export` instead of CommonJS
  `require`/`module.exports`

For these users the pre-commit hook fires, the parser runs, but
STRUCTURE.json modules block stays `{}`. AI assistants then have no
intent index to navigate by, defeating the whole point of the
mechanism.

We're intentionally shipping the first version with `src/`-only support
(Frame's existing convention) and deferring this work. This spec
captures the problem so we can return to it without re-discovering
context.

## Goal

Make STRUCTURE.json auto-fill work meaningfully for the three most
common layouts beyond single-`src/`:

1. **Monorepos** — discover each package's source dir and produce one
   grouped STRUCTURE.json (or per-package, TBD in /spec.plan)
2. **Alternative root names** — `app/`, `lib/`, `server/`, `client/`,
   or user-configured paths
3. **Non-JS languages** — at minimum TypeScript and Python, since those
   are the most likely first targets for Frame adoption

ES modules support is folded into the JS/TS work — same regex pass.

## Constraints

- **Don't break the current behavior.** Single-`src/` JS projects must
  produce the exact same STRUCTURE.json output they do today, byte-for-byte.
- **No new runtime dependencies.** Parser must stay pure Node
  (`fs`/`path`) so it ships in `.frame/bin/` and runs from a git hook
  without `node_modules`. A language-specific parser can be a separate
  pluggable file but must still be dependency-free.
- **Config lives in `.frame/config.json`.** Users opt into a custom
  layout via a `sourceDirs` (or similar) field. No CLI flags, no env
  vars at the user level.
- **Graceful degradation.** Unknown layout / language → empty modules
  block, no crash, no garbage output. Same fail-soft posture as today.
- **Backwards compatible config.** A `.frame/config.json` without the
  new field continues to work exactly as today (defaults to `["src"]`).

## Success criteria

- A monorepo with `packages/foo/src/` and `packages/bar/src/` produces
  a STRUCTURE.json that includes modules from both packages, namespaced
  in some discoverable way (e.g., `foo/lib/whatever`, `bar/lib/whatever`)
- A project with `app/` instead of `src/` works after the user sets
  `sourceDirs: ["app"]` in `.frame/config.json`
- A TypeScript project (`.ts`/`.tsx` files with ES `import`/`export`)
  produces a populated modules block, including export names and
  function definitions
- A Python project (`.py` files) produces a populated modules block
  for top-level functions and class definitions
- Frame's own repo (single `src/`, CommonJS JS) produces a STRUCTURE.json
  identical to the pre-change output — no diff in committed file
- The pre-commit hook still completes in under 1s for a 100-file repo

## Out of scope

- **Go / Rust / Java / C++ language parsers** — defer until requested
  by an actual user. Pluggable architecture should make this easy
  later, but we don't ship them in v1 of this work.
- **Per-monorepo-package STRUCTURE.json files.** Single root-level
  STRUCTURE.json is the model for now; per-package files (with a
  root-level index) is a future evolution.
- **Watch mode / IDE-side live updates.** Already decided: pre-commit
  is the right trigger; not revisiting.
- **AST-based parsing** (TypeScript compiler API, tree-sitter). Stick
  with regex parsing — fast, dependency-free, "good enough for an
  index." If users want true semantic accuracy they can manually edit.
- **Intent index alias rules for non-JS projects.** Existing alias
  table in `generateIntentIndex` is JS-feature-named (`pty`,
  `terminalManager`, etc.). For other languages we either generalize
  the heuristic (strip common suffixes) or document that intentIndex
  is best-effort. Decide in /spec.plan.

## Open questions for /spec.plan

- **Monorepo discovery:** auto-detect via `package.json` workspaces /
  `pnpm-workspace.yaml` / `turbo.json`, or require explicit config in
  `.frame/config.json`? Auto-detect is friendlier but more code.
- **Module key collision:** in a monorepo, two packages can both have
  `main/index`. Do we prefix with package name (`packages/foo/main/index`)
  or use a flat namespaced key (`foo:main/index`)? Affects both the
  parser output and the `find-module.js` lookup contract.
- **Language parser dispatch:** one big `parseFile.js` with branches,
  or `parsers/js.js`, `parsers/ts.js`, `parsers/py.js`? The latter is
  cleaner but means more files in `.frame/bin/`. Lean toward separate
  files.
- **TypeScript vs JavaScript:** can the JS parser handle `.ts`/`.tsx`
  with just regex extensions, or do we need TS-specific syntax
  (type-only imports, decorators) handled? Probably 90% overlap.
- **Configuration surface:** is `sourceDirs: string[]` enough, or do we
  need a richer config (per-dir language hint, ignore patterns,
  per-package overrides)? Start minimal, expand if users hit limits.
- **Intent index for foreign languages:** generic suffix-stripper as
  fallback, or skip intentIndex generation when language isn't JS?
  Affects whether `find-module.js` is useful in those projects.
