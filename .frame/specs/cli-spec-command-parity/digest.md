---
keywords: spec commands, CLI parity, managed block, command staging, self-serve protocol, REFERENCE.md, legacy migration, version stamp
related: implement-modes-v2, codex-parity, spec-docs-delivery-invariant, fix-report-staging-and-opening
---
Made spec commands self-serve from a CLI session: on project open Frame stages the four command templates and report assets into `.frame/runtime/commands/<tool>/` and upgrades a version-stamped managed block in REFERENCE.md and AGENTS.md telling the agent to follow them.

- Engine `src/shared/docsManagedBlock.js` (pure): `<!-- frame:managed:spec-section v=N -->` markers, rewritten only when the stamp is below `SPEC_SECTION_VERSION`, every byte outside untouched. A file without markers migrates once, only when heading and whitespace-normalised body match a shipped generation; a customised body or a dangling marker leaves the file alone. T03 added the `---` line as a section bound after heading-only bounds overran in a round-trip test.
- Staging `src/main/commandStaging.js`: override-first (`.frame/templates/commands/<tool>/`), write-if-changed, `implement-launch.js` into `.frame/bin/`; it retired `stageImplementCommandFiles`. Runs on WATCH_SPECS, at init and in `ensureSpecDrivenArtifacts` (so re-enabling restages); `upgradeSpecDocs` runs beside it and never creates a missing file. The UI dispatch path is unchanged.
- Decisions: protocol taught in the docs only; rejected `.claude/commands/spec.*.md` shims (a second staged surface, tool-specific, and Frame does not write the user's `.claude/`). Target spec by phase: one candidate is taken silently, otherwise ask; a named spec wins. No manual `.frame/bin/` refresh, because the packaged templates live in app.asar. The autonomous ceiling is stated with both handoffs: the Frame button or `node .frame/bin/implement-launch.js <slug>`.
- T07: only `spec.implement.md` changed (`$FRAME_NODE` exists only in a Frame launch; the direct `implement-report.html` path); the other three templates stayed byte-identical.
- What it missed, fixed later: `41bdc51` (2026-07-23) let AGENTS matchers recognise pre-split full sections, whose old mini-flow kept shadowing the protocol; `spec-docs-delivery-invariant` stopped the pointer landing when REFERENCE.md was missing; Frame's own repo had no marker (`unmatched`) and got the block only in `2f25f10` (2026-08-28), which also added `spec-command-hint.js` on UserPromptSubmit because prose-delivered steps are followed 1–44% of the time; `fix-report-staging-and-opening` deleted `stageCommandAsset`, a second stager T05 left behind.
- Rules: only the managed block is Frame's to rewrite; a spec flow is never run from memory; a consolidation task names what it deletes.

Chain: spec.md → plan.md → tasks.md → outcome.md
