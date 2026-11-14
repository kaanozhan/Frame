
## T01 — Per-checkout spec readers

Added `listSpecsIn`, `getSpecIn`, `readSpecReportIn`, `updateSpecStatusIn` and `buildSpecCommandFileIn` to `src/main/specManager.js`. Each runs the existing reader under `inCheckout(root)`, which maps every slug of that one checkout to itself for the duration of the synchronous call and then restores the project's map. `listSpecs` now delegates to `listSpecsCore(projectPath, tasksProject, locations)`, and `getCommandPrompt` / `buildSpecCommandFile` take an optional trailing `tasksProject`; the existing signatures are unchanged. Tests in `test/serverSpecs.test.js`.

_Captured: 2026-11-14 · 2 file change(s)_

---
