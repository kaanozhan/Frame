## T01 — Point the report placeholders at `.frame/runtime/commands/<tool>/`

Replaced `specManager.js`'s module-level `REPORT_TEMPLATE_REL` / `REPORT_GENERATOR_REL`
strings with tool-scoped `reportTemplateRel(tool)` / `reportGeneratorRel(tool)` over a new
`commandRelPath(tool, file)`, and swapped `RUNTIME_ASSETS_REL` for `RUNTIME_COMMANDS_REL` in
`scripts/spec-command-hint.js` so both interpolation paths resolve under the staged commands
directory. Departed from `tasks.md` only in naming: the two became camelCase functions rather
than keeping SCREAMING_CASE names that no longer denote constants. Files: `src/main/specManager.js`,
`scripts/spec-command-hint.js`, `test/implementLaunch.test.js`.

_Captured: 2026-08-31 · 3 file changes_

---
