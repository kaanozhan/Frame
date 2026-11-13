# Plan — Workspace review

## Architecture

### Resolved plan-time decisions

Business (asked):
- **B1 Where the review lives:** a section tab in the center (like today's diff tab). The left column holds the file list and pending comments; the right column holds the diff. It reuses the section framework (`host.openSection`, viewport `render`/`navigate`/`dispose`), keeps the terminals full width and reads at full width. Rejected: Conductor's right-hand git panel, which narrows Frame's terminal-centred middle and needs a new layout. The workspaces spec had parked that panel here; the review does not need it.
- **B2 Which agent gets the review:** a "Send to" picker in the review panel. The default is the workspace's agent lane when there is one, the most recently active when there are several, else "New agent". Rejected: always a new lane, which loses the running agent's context.
- **B3 Viewed state:** remembered per workspace on this machine (localStorage `frame-review-viewed`, `{ [projectPath#workspaceId]: { [path]: contentHash } }`), so it survives restarts and drops automatically when a file's content changes. Rejected: session only.
- **B4 Shortcut:** ⌘⌥R ("review"), the same family as Create PR's ⌘⌥P. ⌘⇧D is the Tasks dashboard. Rejected: ⌘⌥D.

Business (silent):
- "Review Changes…" is the first PR-flow item in a workspace's row menu (`workspacePr.menuItems`) and a palette command. Opening it selects the workspace first; a workspace switch disposes section tabs, so the review is naturally per workspace.
- Pending comments live in memory per workspace while the review tab is open. They are cleared when sent and lost when the tab closes; persisting them is out of scope.
- Only lines on the new side can be commented: added or context lines with a new line number. Deleted lines carry no anchor in the working tree.

Technical (asked):
- **T1 Test posture:** pure logic only (testing record).

Technical (silent):
- **Git, in `gitDiffManager.js`** (the diff module), argv, in the workspace's folder:
  - `REVIEW_FILES { root, base }`:
    1. `git merge-base origin/<base> HEAD` (falling back to the local `<base>`);
    2. `git diff -z --numstat <mb>` and `git diff -z --name-status <mb>` (committed + uncommitted tracked changes vs the merge base);
    3. `git ls-files --others --exclude-standard -z` (untracked);
    4. `git hash-object --` for the files that still exist.

    Returns `{ error, mergeBase, files: [{ path, oldPath?, status: A|M|D|R|U, added, removed, binary, hash }] }`.
  - `REVIEW_FILE_DIFF { root, mergeBase, path, untracked }`: `git diff <mb> -- <path>`, or `git diff --no-index -- /dev/null <path>` for untracked. Returns `{ diff, isBinary, tooLarge }` with a 2 MB ceiling.
- **Pure rules** in `src/shared/reviewModel.js`: numstat/name-status parsing and merging with untracked, viewed state, the clicked line → `{ path, line, text }` mapping, prompt composition, size limits.
- **Line clicks:** diff2html renders line numbers as cells (unified: `.line-num2` = new side; split: the right table's `.d2h-code-side-linenumber`). One delegated click handler on the diff host reads the new-side number and the row's code text. A commented line gets a marker class.
- **Sending:** agent lanes are the workspace's terminals (`getTerminalsInScope`) whose `laneStatus.getStatus(id).agentName` is set. An existing lane gets `agentDispatch.dispatch({ terminalId, prompt })`; a new one gets `dispatch({ createNew: true, prompt })`.
- **The existing diff tab** (`diffSection.js`, `GET_GIT_DIFF`) stays untouched.

### Data shapes

```
ReviewFile = { path, oldPath?, status: 'A'|'M'|'D'|'R'|'U', added, removed, binary, hash }
Comment    = { id, path, line, text: '<quoted code line>', body: '<comment>' }
```

The prompt is one block. It opens with a line saying these are review comments on the workspace's branch, then one entry per comment: `path:line`, the quoted line, the comment. It ends with: address them, commit, don't push.

## Files

- `src/shared/reviewModel.js` — **New**: pure `parseNumstat`, `parseNameStatus`, `mergeChangedFiles`, `viewedSummary`, `reconcileViewed`, `lineAnchor`, `composeReviewPrompt`, `MAX_DIFF_BYTES`
- `test/reviewModel.test.js` — **New**: tests for the above
- `src/main/gitDiffManager.js` — **Modified**: `REVIEW_FILES`, `REVIEW_FILE_DIFF`
- `src/shared/ipcChannels.js` — **Modified**: the two channels
- `src/renderer/reviewSection.js` — **New**: review section viewport (file list with status/+/-, viewed ticks, remaining count, diff with mode toggle, line comments, pending list, "Send to" picker, send)
- `src/renderer/workspacePr.js` — **Modified**: "Review Changes…" menu item and action
- `src/renderer/index.js` — **Modified**: host wiring for the review section; `workspace.review` command (⌘⌥R)
- `src/main/menu.js` — **Modified**: Review Changes… ⌘⌥R
- `src/renderer/styles/components/review.css` — **New**: review layout, file list, comment box, markers
- `src/renderer/styles/main.css` — **Modified**: import `review.css`

## Footprint

- src/shared/reviewModel.js
- test/reviewModel.test.js
- src/main/gitDiffManager.js
- src/shared/ipcChannels.js
- src/renderer/reviewSection.js
- src/renderer/workspacePr.js
- src/renderer/index.js
- src/main/menu.js
- src/renderer/styles/components/review.css
- src/renderer/styles/main.css

## Dependencies

None.

## Sequencing

1. **Pure core.** `src/shared/reviewModel.js` with `test/reviewModel.test.js`:
   - parse `--numstat -z` (binary `-`, renames) and `--name-status -z`, and merge them with untracked paths and content hashes into `ReviewFile`s;
   - `reconcileViewed` (drop viewed entries whose hash changed or whose file left) and `viewedSummary` (viewed / remaining);
   - `lineAnchor` (cell number + code text → `{ line, text }`, rejecting old-side-only lines);
   - `composeReviewPrompt`;
   - `MAX_DIFF_BYTES`.
2. **Git in main.** `REVIEW_FILES` and `REVIEW_FILE_DIFF` in `gitDiffManager.js` (merge-base with fallback, numstat + name-status, untracked, hash-object, per-file diff with the size ceiling); channels in `ipcChannels.js`.
3. **Review tab with files, diffs and viewed.**
   - `src/renderer/reviewSection.js` viewport:
     - file list with status and +/-, and a header "N files · M left";
     - diff of the selected file (split/unified);
     - viewed ticks collapsing files, persisted per workspace with `reconcileViewed` on every load;
     - refresh on `GIT_STATUS_DATA` for the workspace root.
   - Opened by "Review Changes…" in `workspacePr.js`, the `workspace.review` command (⌘⌥R) in `index.js` and the menu item in `menu.js`. Each selects the workspace first.
   - Styles in `review.css`, imported from `main.css`.
4. **Line comments.**
   - A click on a new-side line number opens an inline comment box under the row.
   - Saved comments appear in the pending list (path:line, quoted code, text) with edit/remove, and the row gets a marker.
5. **Send the review.**
   - "Send to" picker: the workspace's agent lanes, default the most recently active, else New agent.
   - "Send review (n)" composes the prompt and dispatches it to the chosen lane or a new one, then clears the pending list.
