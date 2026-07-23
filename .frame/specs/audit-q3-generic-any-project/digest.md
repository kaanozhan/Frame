---
keywords: detection, project-agnostic, generic, fixtures, ci, templates, multi-language
related: audit-q3-core-value-efficacy, structure-non-standard-layouts
supersedes: structure-non-standard-layouts
---
De-hardcoded Frame from its own shape: `detect-project.js` persists
{languages, packageManager, sourceRoots, layout, commands} into
`.frame/config.json` as the single source of truth read by parser (multi-root
walker), templates (real commands, Project Facts), init and onboarding.
Frame vocabulary removed from shipped scripts (config-driven IPC, tokenized
intent grouping) with sentinel tests enforcing it. Cross-platform
credentials fallback, real session path encoding, platform-aware shells.
Six fixtures (golden js byte-compat, Django, Go, Rust, pnpm monorepo, docs)
run the real pipeline in the repo's first CI (ubuntu+macos). Decisions:
parser stays dependency-free regex (tree-sitter stays swappable behind the
extractor interface); backwards compat pinned byte-for-byte by the golden
fixture.

Chain: spec.md → plan.md → tasks.md → outcome.md
