## Fix — `cliOf` read Claude Code payloads as Codex

T01 measured `turn_id`, `tool_use_id`, `model` and `permission_mode` in Codex payloads and none of them in Claude Code's, so `toolVocabulary.cliOf` took any of `turn_id`, `permission_mode` or `model` as a Codex signal; Claude Code 2.1 now sends `permission_mode` and `tool_use_id`, and payloads captured from Claude Code 2.1.304 on 2026-10-20 resolved prompt and Bash pre-tool calls to Codex. Frame's Claude Code hooks name no CLI, so those calls were logged as `codex-hook` and the hints used Codex's 20 000-character inline cap instead of Claude Code's 2 000. `cliOf` now treats only `turn_id` as Codex's, and `test/toolVocabulary.test.js` carries the captured Claude Code field sets. Codex was not installed on the machine, so the Codex side rests on T01's recorded fields and the existing fixtures.

_Captured: 2026-10-20 · 2 file changes_

---
