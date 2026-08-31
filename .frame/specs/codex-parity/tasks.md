# Tasks — Codex reaches Frame the way Claude Code does

- T01 · Measure Codex's hook environment against a scratch `CODEX_HOME`: `apply_patch`'s `tool_input` shape, the `additionalContext` inline ceiling, whether `if` gates without spawning node, and whether trust state is readable from disk; record the findings in the spec folder.
- T02 · Add `src/shared/toolVocabulary.js` mapping semantic roles (edit, shell, search) to each CLI's tool names, matcher strings and per-tool path extractor, with tests asserting the `claude-code` entry reproduces today's hardcoded behaviour.
- T03 · Move `module-hint`, `docs-hint`, `spec-hint` and `spec-command-hint` onto the vocabulary, keeping the existing Claude suites passing unchanged and adding each script's Codex tool-name cases.
- T04 · Add `CODEX_HINT_HOOKS` and `installCodexHintHook`/`removeCodexHintHook` writing `CODEX_HOME/hooks.json` merge-safely with a visible opt-out, with tests seeding a foreign `hooks.json` and asserting it survives install, re-install and removal.
- T05 · Detect untrusted Codex hooks, record the `hooks.untrusted` suppression, and surface the state through `healthNotice` so a silently disabled hook is visible.
- T06 · Adapt `src/templates/commands/codex/spec.plan.md` to Codex's tools and approval semantics, and report what fraction genuinely diverges from the Claude version to settle the template strategy.
- T07 · Produce `spec.new.md`, `spec.tasks.md` and `spec.implement.md` for Codex by the strategy T06 settled, with tests asserting `getCommandPrompt` returns a prompt rather than an error for all four commands with `'codex'`.
- T08 · Extend the `spec-command-hint` drift guard to Codex so the staged prompt stays byte-identical to `getCommandPrompt`'s on both tools, and verify a live Codex `spec.plan` run reaches the decision gate.
- T09 · Retire the wrapper: point `aiToolManager`'s codex command at `'codex'`, delete `getCodexWrapperTemplate` and `.frame/bin/codex`, and prove AGENTS.md now arrives through the `SessionStart` hook.
- T10 · Remove the Codex-launch decision from `audit-q3-cross-platform`'s plan and record the reversal there, naming this spec, so the archive holds one asked decision rather than two contradictory ones.
