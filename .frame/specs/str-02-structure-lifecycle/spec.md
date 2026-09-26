---
keywords: STR, structure, lifecycle, incremental updates, pre-commit, freshness, worktree, reconciliation
related: reliable-structure-generation, str-03-local-file-retrieval, str-04-jev-evaluation, audit-q3-generic-any-project, audit-q3-core-value-efficacy, audit-q3-reliability-recovery, audit-q3-performance-resources, frame-bin-out-of-repo
---

# STR-02 — Structure Lifecycle

## Problem

A correct initial map becomes misleading when files change. Current incremental discovery can miss new roots and untracked files, while the commit path combines staged and unstaged changes and reads working-tree content. Existing-map checks do not establish freshness. Concurrent updates, branch changes, and missed events can leave agents using the wrong snapshot.

## Goal

Keep the STR-01 map current throughout development, including before the first commit, with bounded incremental updates and reconciliation after missed events. Explicitly distinguish the working-tree view used by agents from any map published with a commit. Expose freshness and a revision identity so retrieval can invalidate stale results.

## Constraints

- Series: **STR — Structure Reliability and Retrieval**. Order: STR-01 → STR-02 → STR-03 → STR-04. Depends on `reliable-structure-generation`; provides the freshness contract for `str-03-local-file-retrieval`.
- Reuse STR-01's discovery policy, identifiers, extractors, and safe publication. Incremental output must converge to a full scan of the same snapshot; do not introduce a second definition of eligible files.
- Preserve curated metadata and deterministic no-change output from `audit-q3-core-value-efficacy`; apply recovery rules from `audit-q3-reliability-recovery`.
- Preserve existing user hooks and staged application content. Follow `frame-bin-out-of-repo` for script delivery; support repositories whose hook path or worktree layout differs from a simple `.git/hooks` directory.
- Keep scans off the main event loop and coalesce changes, respecting `audit-q3-performance-resources`. No remote service is required.

## Success Criteria

1. When eligible files are created, edited, renamed, or deleted, including untracked files and new roots, then the working-tree map converges within a documented refresh bound without requiring a commit.
2. When ignore policy or project configuration changes, then reconciliation discovers newly eligible files and removes newly excluded generated entries while preserving curated metadata.
3. When a file is partially staged, then the commit artifact describes the staged snapshot without leaking unstaged content; the agent's working-tree view remains distinguishable and correct. No unrelated changes are staged.
4. When a branch switches, a merge/rebase changes files, or a project reopens after offline edits, then the map reconciles against the current checkout before being represented as fresh.
5. When updates overlap or a process crashes, then an older job cannot replace a newer result, no corrupt artifact is published, and a later reconciliation can recover.
6. When events are missed, then reconciliation reaches the same generated map as a full scan. When nothing changes, then no artifact rewrite or revision churn occurs.
7. When projects or worktrees share a repository, then each working-tree view and its revision remain isolated. When Git or hook integration is unavailable, then local updates still work and the unavailable commit integration is visible.
8. When lifecycle fixtures replay changes, then checks compare incremental and full results, cover staged/unstaged separation, and record refresh latency and scan counts under burst load.

## Out of Scope

- Initial discovery and explicit full-rebuild implementation: STR-01.
- Query ranking, hint delivery, and retrieval cache policy: STR-03.
- Semantic services and Jev: STR-04.
- General watcher, task/spec, PTY, or UI performance refactors in `audit-q3-performance-resources`.
