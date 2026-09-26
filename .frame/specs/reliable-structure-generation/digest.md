---
keywords: STR, structure, generation, initialization, file discovery, coverage, parser, full rebuild, gitignore, recovery, attempt state
related: str-02-structure-lifecycle, str-03-local-file-retrieval, str-04-jev-evaluation, audit-q3-generic-any-project, audit-q3-core-value-efficacy, audit-q3-reliability-recovery, non-invasive-overlay, frame-bin-out-of-repo, frame-storage-seam
---
STRUCTURE.json generation split into discovery (root-wide walk, one policy:
hard exclusions, replaceable default dirs, nested .gitignore layers, config
`exclude` last — matches git), generation (every eligible file an entry,
metadata-only when unparsed; identity = file path; old keys kept, `@file:`
fallback keys; deleted curated keys held in `curatedKeyOwners`; authored
prose kept via provenance hashes; directory groups in `legacyModuleGroups`)
and state (overlay-first ownership, writer lock, `runtime/structure/scan.json`
attempts, content-addressed recovery, fsSafe publish). Incomplete inventory
keeps a usable map; extraction errors still publish. CLI: `--full` repair,
`--json` envelope, 0/1/2 exits, read-only `--check`. Rules established:
single-path matcher API (pinned); Frame's own files never counted; automatic
intents keep the old source-root population (retrieval is STR-03's);
archive live and backup bytes before replacing a corrupt map.

Chain: spec.md → plan.md → tasks.md → outcome.md
