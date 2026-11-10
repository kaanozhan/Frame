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

module.exports = {
  parseCount,
  checksSummary,
  mapPrView,
  sectionLead,
  composePr,
  pickMergeMethod,
  fixChecksPrompt,
  isPushable,
  MERGE_ORDER
};
