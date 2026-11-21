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

## T04 — Write spec.auto.md and register spec.auto

Added src/templates/commands/claude-code/spec.auto.md and registered spec.auto in SUPPORTED_COMMANDS, COMMAND_TEMPLATE_FILES and the server's COMMANDS. buildSpecCommandFile('spec.auto') stages the three phase prompts (stagePhasePrompts) and passes their paths to getCommandPrompt through a new optional extraVars argument; launchFlagsFor adds getAutoLaunchFlags. scripts/spec-command-hint.js was left without spec.auto on purpose: the bare-CLI path is implement-launch.js --full-auto (T07).

_Captured: 2026-11-21 · 6 file change(s)_

---

## T05 — Add full-auto branches to the plan and implement templates

Added a 'Full auto — the gate decides, it does not ask' subsection to spec.plan.md's Stage 2 and a 'Full auto' paragraph to spec.implement.md's pre-flight; both read flow_mode from status.json. Only new lines were added, so the Codex and Claude Code renders still differ only in their dialect lines.

_Captured: 2026-11-21 · 2 file change(s)_

---

## T06 — Ask the flow question at the end of spec.new

Added 'How the rest of this spec runs' to spec.new.md's After writing, filled by the full_auto_offer dialect; full auto also records implement_mode autonomous and names the implement-launch.js --full-auto fallback. Deviation: test/codexTemplates.test.js (not in the plan) had its spec.new drift ceiling raised from 1 to 6 lines for the new dialect value. scripts/spec-command-hint.js (not in the plan) now hands {full_auto_offer}'s value to a terminal-typed /spec.new, which its own test requires of every spec.new token.

_Captured: 2026-11-21 · 3 file change(s)_

---

