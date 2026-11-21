---
keywords: frame cloud, brief done, merged part, part branch, completion commit, recordBranch, recordCompletion, dropped part
related: frame-cloud-brief-start, frame-cloud-briefs-read-only, frame-cloud-brief-shape
---

# Frame Cloud brief done

## Problem

A started brief never reaches Done from Frame. A part's row goes from
"On <branch>" to its spec's or task's own state. A finished spec reads
"Done" even though nothing has reached the target branch. "On <branch>" is
known only on the machine that pressed Begin (`<userData>/cloud-starts.json`).
A teammate's Frame and the web show the same part as Not started.

FrameCloud's `brief-done` (merged on its `main`, #25) now decides Done itself:

- A part is merged once GitHub's `compare` shows its completion commit on the
  brief's target.
- The brief is Done once every live part is merged.

The cloud waits on two facts only Frame has: the branch a part was begun on,
and the commit where it finished. Until Frame sends them, a part begun from
Frame can only be marked merged by hand (Link commit on the web).

## Goal

Frame reports facts, the cloud decides, and Frame shows the result.

- **Begin records the branch.** After Begin cuts and checks out a part's
  branch, Frame calls `brief.recordBranch` with the branch name and the
  commit it was cut from. Begin itself behaves as today.
- **A local finish records the commit.** When a part's spec reaches `done` or
  its task becomes `completed`, Frame calls `brief.recordCompletion` with the
  tip of the part's branch. It calls again when later commits move that tip.
- **The part row reads the cloud.** `partStatus` takes the new part fields,
  in this order: dropped → merged on the current target → live lane → local
  record → the cloud's branch → Not started.
  - A dropped part reads "Dropped · <reason>".
  - A merged part reads "Merged into <target>".
  - "On <branch>" comes from the cloud's `branch`, so every machine shows it.
- **A local finish is not Done.** The spec or task state that reads "Done"
  today gets a new name (see Open Questions). Done means merged.
- **The summary counts merges.** `partsSummary` reads
  "1 of 3 merged · 1 dropped": merged out of the live parts, with dropped
  parts counted beside.
- **The Done column fills on its own.** The Briefs view already groups by the
  server's status, so a Done brief moves there. Its parts offer no Begin or
  Run.

## Constraints

- **The contract is FrameCloud's `brief-done`.** Sources: that repo's
  `.frame/specs/brief-done/plan.md` and the handoff in its outcome T09.
  - **The two calls.** `brief.recordBranch({ id, partId, branch, baseSha })`
    and `brief.recordCompletion({ id, partId, sha })`. SHAs are 40 lowercase
    hex characters, as `git rev-parse` prints them, and `branch` is a valid
    git branch name. Both return the brief detail.
  - **Repeats.** A call that carries the stored values writes nothing, so
    resending is safe.
  - **Final refusals.** `PART_DROPPED`, `PART_MERGED` and `NOT_STARTED` never
    change. Frame does not resend a call they refused.
  - **`recordBranch`.** On a live part it replaces the old branch, which
    covers a part begun again. On a merged or dropped part it is refused. It
    leaves `completion_sha` alone.
  - **`recordCompletion`.** Accepted on a part with no recorded branch, on a
    merged part and on a Done brief. Refused on a dropped part.
  - **New read fields.**
    - On a part: `branch`, `completionSha`, `mergedAt`, `mergeSha`,
      `mergedBase`, `mergeEvidence`, `droppedAt`, `dropReason`.
    - On a brief: `doneAt`.
    - On list items and the detail: `mergeTracking` (`ready | needs_github`).
    - `brief.list` now carries each brief's parts, without `definition`.
- **Only two new writes.** Earlier specs allow `brief.create`,
  `addAttachment`, `recordDiscussion`, `decide`, `shape` and `start`. This
  spec adds `recordBranch` and `recordCompletion`. No Frame call marks a part
  merged or a brief Done (FrameCloud C3).
- **The merged rule.** A part counts as merged only while its `mergedBase`
  equals the brief's current `targetBranch`. This is the web's
  `countsAsMerged` rule.
- **Begin is unchanged.** frame-cloud-brief-start's order stays: cloud first,
  then stash, branch, files and lane. Its branch rules stay too.
  `recordBranch` runs after the branch exists, and it never undoes or fails
  a Begin.
- **The branch moves to the cloud.** frame-cloud-brief-start kept the begun
  branch only in `cloud-starts.json` and left writing it to the cloud to Done.
  This spec does that, and the row shows the cloud's `branch`.
- **The token stays in main** (frame-cloud-brief-discussions). The renderer
  never calls the cloud.
- **Tests.** Unit tests cover the pure core: the new `partStatus` order, the
  summary, the merged rule, and what to send and when to stop resending. The
  Electron shell is not unit-tested, as in the earlier cloud specs. The
  implementation runs against a local FrameCloud server.

## Success Criteria

- When Begin cuts `feat/x` from a commit, then `recordBranch` is sent once
  with `feat/x` and that commit's full SHA. Begin's result is the same whether
  or not the call succeeds.
- When a part's spec reaches `done` or its task becomes `completed`, then
  `recordCompletion` is sent with the full SHA at the tip of the part's branch.
- When later commits move that tip, then the new SHA is sent. When the tip has
  not moved, nothing is sent.
- When the cloud refuses with `PART_DROPPED`, `PART_MERGED` or `NOT_STARTED`,
  then that call is not sent again for that part.
- When a part counts as merged, then its row reads "Merged into <target>" with
  no Run or Begin, whatever its local state.
- When a part is dropped, then its row reads "Dropped · <reason>" and the
  part leaves the summary's count.
- When a part was begun on another machine, then this machine's row reads
  "On <branch>" from the cloud.
- When a part's spec is `done` or its task `completed` but the part is not
  merged, then its row shows the local-finish name, never "Done".
- When a brief has `doneAt`, then it sits in the Done column.
- When a brief has four parts (one merged, one dropped, two pending), then
  the summary reads "1 of 3 merged · 1 dropped".

## Out of Scope

- `brief-pr`: reading PRs, review tones, `pr` merge evidence, and catching
  squash or rebase merges. Until then, Link commit on the web covers them.
- Drop part and Link commit in Frame. Both stay web-only for now.
- Begin's branch rules and the Briefs view's layout.
- Pushing the branch or opening a PR.
- Webhooks and CI state.
- FrameCloud's own `brief-done`, which is already merged there.
- Local briefs from `brief-capture-and-shaping`.

## Open Questions

- **The local finish's name.** Options: "Ready for PR", "Implemented" or
  "Done locally" (from the Brief Done Akışı page). Frame has no PR data until
  brief-pr, so "Ready for PR" would stay on after a PR opens.
- **When Frame notices a finish and later commits.** Options:
  - (a) When the Briefs view loads or refreshes, from the records it already
    reads.
  - (b) A main-side watch on the spec and task records and on the branch's
    tip.

  The spec lives on the part's branch. Either way, Frame sees it only where
  that branch is checked out, unless it reads the branch through git.
- **A call that fails** (signed out, or the server is unreachable). Options:
  - (a) Keep the unsent call beside the begun record in `cloud-starts.json`,
    and resend it on the next load.
  - (b) Drop it and leave the part to Link commit.
- **Parts begun before this feature.** They have no branch in the cloud.
  Options:
  - (a) Send each `cloud-starts.json` entry once: its branch (with the base
    found by `git merge-base`), or only `recordCompletion`, which the cloud
    accepts without a branch.
  - (b) Leave them to Link commit.
- **The "GitHub not connected" state.** When `mergeTracking` is
  `needs_github`, parts can never merge. Options:
  - (a) Frame shows a one-line notice that links to connecting GitHub, as the
    web does.
  - (b) Only the web says it.
- **A base that differs from the target.** Should Begin warn when the chosen
  base is not the brief's target, as happens with umbrella branches? For
  example: "This brief targets main. You are branching from …. Make it the
  target?" This touches Begin, which is otherwise out of scope.
