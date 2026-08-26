# Tasks — spec-status-repair

- [x] T01 · repairSpecStatus(): fill slug from the folder name and default
      generated_task_ids, never overwrite an existing slug; wire it into
      listSpecs (with a one-time write-back) and updateSpecStatus.
- [x] T02 · listSpecs surfaces what it cannot repair: malformed entries with
      the validator's reason, logged; folders holding no spec file stay
      skipped.
- [x] T03 · Renderer: malformed cards in the specs dashboard and the spec
      section — reason shown, interactions that assume a valid spec disabled.
- [x] T04 · Document the required status.json shape in spec.new.md and
      CONDUCTOR.md (src/templates, not the staged copy).
- [x] T05 · Tests (repair rules, slug never overwritten, malformed surfaced,
      non-spec folders ignored, valid specs untouched) + live verification
      with a conductor-shaped spec, watchdog quiet, no repeat writes.
