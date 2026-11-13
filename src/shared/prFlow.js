/**
 * prFlow — the rules behind a workspace's way out: push, pull request,
 * checks, merge (workspace-pr-flow spec).
 *
 * Pure by design: git/gh output and plain values in, row state and text
 * out. Main runs the commands; the renderer draws the result; this module
 * decides what the output means.
 */

/** Integer from `git rev-list --count` output; 0 for anything unreadable. */
function parseCount(stdout) {
  const n = parseInt(String(stdout == null ? '' : stdout).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Fold `statusCheckRollup` into counts. CheckRun entries carry
 * `status` + `conclusion`; StatusContext entries carry `state`.
 */
function checksSummary(rollup) {
  const summary = { passing: 0, failing: 0, pending: 0, failingNames: [] };
  for (const c of Array.isArray(rollup) ? rollup : []) {
    if (!c) continue;
    const name = c.name || c.context || c.workflowName || 'check';
    const status = String(c.status || '').toUpperCase();
    const conclusion = String(c.conclusion || '').toUpperCase();
    const state = String(c.state || '').toUpperCase();
    if (c.__typename === 'StatusContext' || (!status && state)) {
      if (state === 'SUCCESS') summary.passing += 1;
      else if (state === 'PENDING' || state === 'EXPECTED') summary.pending += 1;
      else { summary.failing += 1; summary.failingNames.push(name); }
      continue;
    }
    if (status && status !== 'COMPLETED') { summary.pending += 1; continue; }
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) summary.passing += 1;
    else { summary.failing += 1; summary.failingNames.push(name); }
  }
  return summary;
}

/**
 * `gh pr view --json number,url,state,isDraft,mergeable,mergeStateStatus,
 * reviewDecision,statusCheckRollup,comments,…` → the row's PR state.
 * `ready` means: open, not a draft, mergeable, no failing or pending checks.
 */
function mapPrView(json) {
  if (!json || typeof json !== 'object' || !json.number) return null;
  const raw = String(json.state || '').toUpperCase();
  const state = raw === 'MERGED' ? 'merged' : raw === 'CLOSED' ? 'closed' : json.isDraft ? 'draft' : 'open';
  const checks = checksSummary(json.statusCheckRollup);
  const mergeable = String(json.mergeable || '').toUpperCase() === 'MERGEABLE';
  return {
    number: json.number,
    url: json.url || null,
    state,
    checks,
    comments: Array.isArray(json.comments) ? json.comments.length : 0,
    reviewDecision: json.reviewDecision || null,
    mergeable,
    ready: state === 'open' && mergeable && checks.failing === 0 && checks.pending === 0
  };
}

/** The first paragraph under a markdown `## <heading>`, trimmed; '' when absent. */
function sectionLead(markdown, heading) {
  const text = String(markdown || '');
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'mi');
  const m = re.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^##\s+/m);
  const body = (next === -1 ? rest : rest.slice(0, next)).trim();
  return body.split(/\n\s*\n/)[0].trim();
}

/**
 * Title and body for a workspace's PR.
 *   - With a spec: the spec's title; the body opens with its Problem and Goal
 *     leads, lists completed tasks from outcome.md when there are any, and
 *     points at the spec folder (which rides the branch).
 *   - Without: the oldest commit subject as title, every subject as a list.
 *     `commits` is `git log --format=%s` order: newest first.
 * The user edits both before the PR is created.
 *
 * @param {{ spec?: { slug, title, spec, outcome }, commits?: string[], branch?: string }} input
 */
function composePr({ spec = null, commits = [], branch = '' } = {}) {
  const subjects = (commits || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (spec && spec.slug) {
    const problem = sectionLead(spec.spec, 'Problem');
    const goal = sectionLead(spec.spec, 'Goal');
    const parts = [];
    if (problem) parts.push(`## Why\n\n${problem}`);
    if (goal) parts.push(`## What\n\n${goal}`);
    const doneTasks = String(spec.outcome || '').split(/^## /m).slice(1)
      .map((e) => e.split('\n')[0].trim()).filter((l) => /^T\d+/.test(l));
    if (doneTasks.length) parts.push(`## Done\n\n${doneTasks.map((t) => `- ${t}`).join('\n')}`);
    parts.push(`Spec: \`.frame/specs/${spec.slug}/\``);
    return { title: spec.title || spec.slug, body: parts.join('\n\n') };
  }
  const title = subjects.length ? subjects[subjects.length - 1] : (branch || 'Update');
  const body = subjects.length > 1 ? subjects.slice().reverse().map((s) => `- ${s}`).join('\n') : '';
  return { title, body };
}

const MERGE_ORDER = ['squash', 'merge', 'rebase'];

/**
 * The merge method to use: the project's setting when the repo allows it,
 * else the first the repo allows in the order squash → merge → rebase.
 * `allowed` is `gh repo view --json squashMergeAllowed,mergeCommitAllowed,
 * rebaseMergeAllowed`. Returns null when nothing is allowed.
 */
function pickMergeMethod(allowed, setting) {
  const flags = allowed || {};
  const ok = {
    squash: flags.squashMergeAllowed !== false,
    merge: flags.mergeCommitAllowed !== false,
    rebase: flags.rebaseMergeAllowed !== false
  };
  if (setting && ok[setting]) return setting;
  return MERGE_ORDER.find((m) => ok[m]) || null;
}

/**
 * The prompt "Fix failing checks" hands the workspace's agent. It names the
 * checks and the commands that show their logs; it does not paste logs.
 */
function fixChecksPrompt({ branch, number, failingNames = [] }) {
  const names = failingNames.length ? failingNames.map((n) => `- ${n}`).join('\n') : '- (see `gh pr checks`)';
  return [
    `The CI checks on PR #${number} (branch \`${branch}\`) are failing:`,
    '',
    names,
    '',
    `Find out why: run \`gh pr checks ${number}\` to list them, then \`gh run view <run-id> --log-failed\` for the failing job's log.`,
    'Fix the cause in this workspace, run the project\'s tests, commit the fix, and stop. Do not push — the user pushes from Frame.'
  ].join('\n');
}

/** A workspace branch may be pushed unless it is (or names) its own base. */
function isPushable({ branch, base }) {
  if (!branch) return false;
  if (base && (branch === base || branch === `origin/${base}`)) return false;
  return true;
}

/**
 * The argv for pushing a workspace branch (workspace-hardening L1). The push
 * always names its target — `origin refs/heads/B:refs/heads/B` — so neither
 * the branch's upstream nor the user's `push.default` can send it anywhere
 * else (a branch made from `origin/main` tracks main, and a bare `git push`
 * under `push.default=upstream` would update main). `-u` is added when the
 * upstream is not already `origin/B`, which also re-points a wrong one.
 * Returns `{ args }` or `{ error }` for an invalid name or the base itself.
 */
function pushArgs({ branch, base, upstream = null }) {
  const { isValidBranchName } = require('./gitRefNames');
  if (!isValidBranchName(branch)) return { error: `"${branch}" is not a valid branch name.` };
  if (!isPushable({ branch, base })) return { error: `Refusing to push ${branch}: it is the base branch.` };
  const args = ['push'];
  if (upstream !== `origin/${branch}`) args.push('-u');
  args.push('origin', `refs/heads/${branch}:refs/heads/${branch}`);
  return { args };
}

// ─── Update from base (update-from-base spec) ─────────────────

/** `git diff --name-only --diff-filter=U -z` → conflicted paths, in order, no duplicates. */
function parseConflicts(stdout) {
  const out = [];
  for (const p of String(stdout || '').split('\0')) {
    const path = p.replace(/^\n+|\n+$/g, '');
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/**
 * The update items a workspace row offers: `[{ id, label }]`.
 * Merging → resolve with an agent and abort; otherwise "Update from <base>",
 * with the behind count when it is known (it reflects the last fetch, so the
 * item shows even at 0 — the action fetches first).
 */
function updateMenuState({ behind = 0, merging = false, conflicts = [], base = 'main' } = {}) {
  const b = base || 'main';
  if (merging) {
    const n = (conflicts || []).length;
    return [
      { id: 'update:resolve', label: n ? `Resolve Conflicts with Agent (${n})` : 'Finish Merge with Agent' },
      { id: 'update:abort', label: 'Abort Update' }
    ];
  }
  return [{ id: 'update:run', label: behind > 0 ? `Update from ${b} (${behind})` : `Update from ${b}` }];
}

/** The prompt that hands an update's conflicts to an agent in the workspace. */
function conflictPrompt({ branch, base = 'main', files = [] }) {
  const list = files.length ? files.map((f) => `- ${f}`).join('\n') : '- (run `git status` to list them)';
  return [
    `Merging \`origin/${base}\` into this workspace's branch \`${branch}\` stopped on conflicts in:`,
    '',
    list,
    '',
    `Resolve each conflict, keeping the intent of both this branch and ${base}. Then run the project's tests, stage the resolved files and complete the merge with \`git commit --no-edit\`.`,
    'Do not push — the user pushes from Frame. If a conflict cannot be resolved safely, stop and explain instead of guessing.'
  ].join('\n');
}

/** One sentence for the user about an update's result. */
function updateMessage(result) {
  const r = result || {};
  const note = r.fetchNote ? ` (${r.fetchNote})` : '';
  if (r.error) return `Update failed: ${r.error}`;
  switch (r.state) {
    case 'updated':
      return `Merged ${r.commits} commit${r.commits === 1 ? '' : 's'} from ${r.base || 'the base'} — not pushed${note}`;
    case 'up-to-date':
      return `Already up to date with ${r.base || 'the base'}${note}`;
    case 'dirty':
      return `Commit or stash your ${r.count} uncommitted change${r.count === 1 ? '' : 's'} first`;
    case 'conflict': {
      const n = (r.files || []).length;
      return `Update stopped on ${n} conflicted file${n === 1 ? '' : 's'}`;
    }
    default:
      return 'Update finished';
  }
}

/**
 * Whether a PR read back after `gh pr merge` has actually merged. On a
 * merge-queue repository the command succeeds while the PR stays open; an
 * unreadable PR is not taken as merged (workspace-hardening L13b).
 */
function mergeLanded(pr) {
  return !!pr && pr.state === 'merged';
}

/**
 * The base a workspace opened from an existing branch should record
 * (workspace-hardening L4, decision B2): the branch's upstream when that is
 * another branch (`origin/develop` → `develop`), else the project's default
 * branch. The dialog prefills it; the user can change it.
 */
function baseForBranch({ branch, upstream, defaultBranch }) {
  const { isValidBranchName } = require('./gitRefNames');
  if (upstream) {
    const name = String(upstream).startsWith('origin/') ? String(upstream).slice('origin/'.length) : String(upstream);
    if (name && name !== branch && isValidBranchName(name)) return name;
  }
  return defaultBranch && isValidBranchName(defaultBranch) ? defaultBranch : null;
}

module.exports = {
  parseConflicts,
  updateMenuState,
  conflictPrompt,
  updateMessage,
  parseCount,
  checksSummary,
  mapPrView,
  sectionLead,
  composePr,
  pickMergeMethod,
  fixChecksPrompt,
  isPushable,
  pushArgs,
  mergeLanded,
  baseForBranch,
  MERGE_ORDER
};
