---
keywords: report staging, runtime assets, template drift, command staging, report auto-open, in-app viewer, FRAME_NODE, SPEC_DATA
related: spec-reports-one-shell-two-themes-in-app, cli-spec-command-parity, deep-spec-plan, implement-modes
---
Closed both ends of the report pipeline. **Staging:** `.frame/runtime/commands/<tool>/` is now the
only staged copy — `specManager`'s `stageCommandAsset` and its `.frame/runtime/assets/` directory are
deleted, `implement-launch.js` reads the staged copy directly instead of bridging to the old one, and
`stageCommandFiles` removes a leftover legacy directory wherever it finds one (old prompts carry the
interpolated old path, so orphaning it was not enough). Deleting that stager cost per-dispatch
freshness, so `stageCommandFiles` runs on **every** spec dispatch, not only `spec.implement`. This
deliberately reverses `spec-reports-one-shell-two-themes-in-app`'s recorded `.frame/runtime/assets/`
constraint; its reason (the CLI cannot read `app.asar`) is preserved.
**Opening:** the generator skips `openInBrowser` when `FRAME_NODE` is set — chosen over a
`{report_open_flag}` placeholder, which would need filling correctly on both interpolation paths.
The app notices a report itself: `listSpecs` carries a `reports` array (emitted only when non-empty,
~4% payload growth vs ~22% for always-present booleans) so `pushSpecData`'s skip-unchanged gate lets
the push through, and `reportSection`'s module-level `SPEC_DATA` listener opens on an absent→present
transition. State, not event: per-task regenerations produce no transition, so no second tab. Origin
decides focus — `agentDispatch` arms `expectReport()` for runs this window started (foreground);
anything else (conductor worker, CLI) gets a background chip. Rejected: a dedicated
`SPEC_REPORT_READY` channel — an instruction the agent can skip is how this divergence arose.

Chain: spec.md → plan.md → tasks.md → outcome.md
