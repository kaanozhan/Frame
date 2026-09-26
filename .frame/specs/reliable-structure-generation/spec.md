---
keywords: STR, structure, generation, initialization, file discovery, coverage, parser, full rebuild
related: str-02-structure-lifecycle, str-03-local-file-retrieval, str-04-jev-evaluation, audit-q3-generic-any-project, audit-q3-core-value-efficacy, audit-q3-reliability-recovery, non-invasive-overlay, frame-bin-out-of-repo, frame-storage-seam
---

# STR-01 — Reliable Structure Generation

## Problem

Agents need a trustworthy file map before search optimizations can help. Frame already attempts an initial STRUCTURE scan, but successful execution does not establish complete coverage: mixed layouts lose files, unsupported languages disappear, workspace limits truncate discovery, and same-stem files can overwrite one another. An existing map can also prevent bootstrap from repairing an incomplete result. These failures make an incomplete map look authoritative.

## Goal

Produce a reliable `.frame/STRUCTURE.json` when initializing empty or imported projects, and provide an explicit full rebuild that repairs existing maps. Every eligible project file has a distinct entry, regardless of layout or parser support. The result distinguishes complete coverage, partial coverage, and failure; an empty map is valid only after a successful scan finds no eligible files.

## Constraints

- Series: **STR — Structure Reliability and Retrieval**. Delivery order: STR-01 generation → STR-02 lifecycle (`str-02-structure-lifecycle`) → STR-03 local retrieval (`str-03-local-file-retrieval`) → STR-04 optional Jev evaluation (`str-04-jev-evaluation`). This spec has no dependency on the later stages; its existing slug remains stable.
- Retain the standalone, local generation approach of `audit-q3-generic-any-project`: no model calls, network access, or installation of dependencies into the user's project. Detection and source-root hints must not silently restrict discovery to familiar layouts; this explicitly tightens that spec's source-root assumption.
- Define one inspectable inclusion/exclusion policy for project-owned source and supporting text files. Respect explicit exclusions; omit dependencies, generated output, binaries, and Frame's own metadata by default. Parser availability must not decide eligibility.
- Preserve deterministic output, architecture notes, and curated intent ownership from `audit-q3-core-value-efficacy`. Changes to identifiers or metadata must keep existing consumers usable and preserve curated references.
- Follow `audit-q3-reliability-recovery` for safe publication and recovery. Failed or interrupted scans must not destroy the last valid map or present old data as a newly completed scan.
- Preserve the storage and repository-footprint decisions of `non-invasive-overlay`, `frame-storage-seam`, and `frame-bin-out-of-repo`. Generated metadata must not require edits to application source or manifests.

## Success Criteria

1. When an empty project is initialized, then it receives a valid empty map with a completed scan result, rather than a template mistaken for scanned content.
2. When an imported project has root-level files, multiple source directories, nested packages, or more than 24 workspace packages, then every eligible file is represented exactly once or the result explicitly reports incomplete coverage.
3. When an eligible file has no supported extractor, then its path and basic file metadata remain discoverable. When extraction fails, then the failure is reported without silently dropping that file or fabricating semantic details.
4. When files share a stem across extensions or directories, then they retain distinct identities and neither entry overwrites the other.
5. When exclusions apply, then discovery follows the declared policy consistently, including applicable nested ignore rules and negation semantics, and exposes the policy used to determine coverage.
6. When limits, unreadable paths, cancellation, or timeouts prevent completion, then both the caller and persisted scan state identify incomplete coverage and its reason; initialization never reports map generation as complete.
7. When a full rebuild is requested for a missing, malformed, empty, or incomplete map, then it rescans the current project, removes obsolete generated entries, and preserves recoverable user-authored metadata. Unrecoverable metadata is reported and retained for recovery.
8. When unchanged inputs are scanned again, then generated map bytes remain unchanged. When publication is interrupted, then readers retain a valid prior map, if one exists.
9. When initialization and full rebuild run through Frame's shipped scripts in a project without Frame's development dependencies, then fixture checks verify the same coverage and failure behavior end to end.

## Out of Scope

- Incremental updates, commit hooks, file watchers, branch switching, and automatic refresh on project reopen.
- Search ranking, query caches, token benchmarks, and hook behavior, including `audit-q3-deterministic-graph-hints`.
- Jev integration, embeddings, and agent-generated semantic enrichment.
- Complete semantic parsing of every language or reconstruction of project architecture.
- General onboarding redesign and unrelated performance work in `audit-q3-performance-resources`.
