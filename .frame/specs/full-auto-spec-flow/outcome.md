## T01 — Add specFlow rules module

Added src/shared/specFlow.js with FLOW_MODES, normalizeFlowMode, shouldStartFullAuto, fullAutoResumeAction and fullAutoStageLabel, plus test/specFlow.test.js (5 tests). Beyond the plan, the stage label also names 'waiting for permission' for a lane at agent-approval.

_Captured: 2026-11-21 · 2 file change(s)_

---

## T02 — Carry flow_mode through main and server

Added flow_mode to listSpecsCore's entries (only when present, like reports) and to STATUS_KEYS in src/server/specs.js, with its refusal message and the method list in src/server/README.md updated. Tests in test/specAutoStaging.test.js (new) and test/serverSpecs.test.js. Deviation: src/server/README.md was not in the plan's Files; it only documents the allowed keys.

_Captured: 2026-11-21 · 5 file change(s)_

---

## T03 — Add the full_auto_offer dialect value

Added full_auto_offer to both dialects in scripts/toolVocabulary.js, five lines each so the rendered spec.new prompts stay line-for-line comparable, and pinned it in test/toolVocabulary.test.js. No template uses it yet (T06).

_Captured: 2026-11-21 · 2 file change(s)_

---

