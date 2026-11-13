/**
 * GitHub panel row view-models — pure (github-view-tree-layout spec, G2 / C10).
 *
 * Every list item in the panel is one dense row:
 *
 *   { kind:'pr'|'issue'|'branch'|'worktree', id, number?, icon, iconClass,
 *     primary, secondary?, meta, labels?:[{name,color}],
 *     actions:[{id,label,danger?}], url?, current?, isRemote?, slug?,
 *     review?, checks? }
 *
 * `icon` is a semantic name (`pr-open`, `issue-closed`, `branch`, …); the
 * host maps it to a lucide glyph, so this module never touches `lucide`,
 * the DOM or Electron. Pinned by `test/githubRowModels.test.js`.
 */

const SLUG_MAX = 40;

// ─── time & color ─────────────────────────────────────────

/**
 * "just now" · "5 minutes ago" · "3 hours ago" · "yesterday" · "4 days ago"
 * · "2 weeks ago" · "6 months ago" · "2 years ago". `now` is injectable so
 * the output is stable under test. Unreadable input → ''.
 */
function relativeTime(dateString, now = Date.now()) {
  if (!dateString) return '';
  const date = new Date(dateString).getTime();
  if (!Number.isFinite(date)) return '';
  const diffMs = Math.max(0, now - date);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/** Black or white text for a hex background ("d73a4a" or "#d73a4a"). */
function contrastColor(hexColor) {
  const hex = String(hexColor || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 128 ? '#000000' : '#ffffff';
}

/** A CSS color for a GitHub label color, or null when it has none. */
function labelColor(color) {
  const hex = String(color || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

// ─── naming ───────────────────────────────────────────────

/** `issue-<n>-<kebab-slug>`; the slug is at most SLUG_MAX chars. */
function issueBranchName(number, title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug ? `issue-${number}-${slug}` : `issue-${number}`;
}

// ─── pull requests ────────────────────────────────────────

function prIcon(pr) {
  const state = String(pr.state || '').toUpperCase();
  if (state === 'MERGED') return 'pr-merged';
  if (state === 'CLOSED') return 'pr-closed';
  if (pr.isDraft) return 'pr-draft';
  return 'pr-open';
}

function reviewOf(pr) {
  const d = String(pr.reviewDecision || '').toUpperCase();
  if (d === 'APPROVED') return 'approved';
  if (d === 'CHANGES_REQUESTED') return 'changes-requested';
  if (d === 'REVIEW_REQUIRED') return 'review-required';
  return null;
}

/**
 * Collapse `statusCheckRollup` (an array of check runs / status contexts)
 * to one word: failure beats pending beats success; no checks → null.
 */
function checksOf(pr) {
  const rollup = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  if (rollup.length === 0) return null;
  let pending = false;
  for (const c of rollup) {
    const conclusion = String(c.conclusion || c.state || '').toUpperCase();
    const status = String(c.status || '').toUpperCase();
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)) {
      return 'failure';
    }
    if (status && status !== 'COMPLETED') pending = true;
    else if (!conclusion || conclusion === 'PENDING' || conclusion === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'success';
}

function prRow(pr, now) {
  const author = pr.author && pr.author.login ? pr.author.login : null;
  const time = relativeTime(pr.updatedAt || pr.createdAt, now);
  const icon = prIcon(pr);
  return {
    kind: 'pr',
    id: String(pr.number),
    number: pr.number,
    icon,
    iconClass: icon,
    primary: pr.title || '',
    secondary: pr.headRefName || null,
    meta: [author, time].filter(Boolean).join(' · '),
    author,
    time,
    review: reviewOf(pr),
    checks: checksOf(pr),
    url: pr.url || null,
    actions: [
      { id: 'checkout', label: 'Checkout' },
      { id: 'open', label: 'Open on GitHub' }
    ]
  };
}

function prRows(result, now) {
  const prs = result && Array.isArray(result.prs) ? result.prs : [];
  return prs.map((pr) => prRow(pr, now));
}

// ─── issues ───────────────────────────────────────────────

function issueRow(issue, now) {
  const open = String(issue.state || '').toUpperCase() === 'OPEN';
  const icon = open ? 'issue-open' : 'issue-closed';
  const time = relativeTime(issue.updatedAt || issue.createdAt, now);
  const labels = (Array.isArray(issue.labels) ? issue.labels : [])
    .filter((l) => l && l.name)
    .map((l) => ({ name: l.name, color: labelColor(l.color) }));
  return {
    kind: 'issue',
    id: String(issue.number),
    number: issue.number,
    icon,
    iconClass: icon,
    primary: issue.title || '',
    secondary: null,
    meta: time,
    time,
    labels,
    url: issue.url || null,
    actions: [
      { id: 'start-work', label: 'Start work' },
      { id: 'open', label: 'Open on GitHub' }
    ]
  };
}

function issueRows(result, now) {
  const issues = result && Array.isArray(result.issues) ? result.issues : [];
  return issues.map((issue) => issueRow(issue, now));
}

// ─── branches ─────────────────────────────────────────────

function branchRow(branch, currentBranch) {
  const current = branch.name === currentBranch;
  const isRemote = branch.isRemote === true;
  const actions = [];
  if (!current) actions.push({ id: 'switch', label: 'Switch' });
  if (!current && !isRemote) actions.push({ id: 'delete', label: 'Delete', danger: true });
  const sha = branch.commit || '';
  const time = branch.date || '';
  return {
    kind: 'branch',
    id: branch.name,
    icon: current ? 'branch-current' : 'branch',
    iconClass: current ? 'branch-current' : 'branch',
    primary: branch.name,
    secondary: null,
    meta: [sha, time].filter(Boolean).join(' · '),
    sha,
    time,
    current,
    isRemote,
    actions
  };
}

/**
 * Current branch first, then local branches by name, then remote branches
 * by name (the host draws those under the Remote sub-group). Rows named
 * HEAD are dropped the way the loader already drops them.
 */
function branchRows(result) {
  const currentBranch = result && result.currentBranch ? result.currentBranch : '';
  const branches = result && Array.isArray(result.branches) ? result.branches : [];
  const byName = (a, b) => a.name.localeCompare(b.name);
  const local = branches.filter((b) => !b.isRemote && b.name !== currentBranch).sort(byName);
  const remote = branches.filter((b) => b.isRemote).sort(byName);
  const current = branches.filter((b) => !b.isRemote && b.name === currentBranch);
  return current.concat(local, remote).map((b) => branchRow(b, currentBranch));
}

// ─── worktrees ────────────────────────────────────────────

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * The spec slug for a worktree at `<project>/.frame/worktrees/<slug>`
 * (the path `gitBranchesManager.orchWorktreePath` builds), else null.
 */
function worktreeSlug(worktreePath, projectPath) {
  const wt = normalizePath(worktreePath);
  const root = normalizePath(projectPath);
  if (!wt || !root) return null;
  const prefix = `${root}/.frame/worktrees/`;
  if (!wt.startsWith(prefix)) return null;
  const rest = wt.slice(prefix.length);
  if (!rest || rest.includes('/')) return null;
  return rest;
}

/**
 * @param {object} wt - a LOAD_GIT_WORKTREES row
 * @param {string} projectPath
 * @param {Map<string, {name: string}>} [workspacesByPath] - the project's
 *   workspace records keyed by normalised folder path (workspaces spec): a
 *   worktree that is a workspace is labelled with its name, the registry
 *   being the source of truth rather than the folder's location
 */
function worktreeRow(wt, projectPath, workspacesByPath) {
  const path = normalizePath(wt.path);
  const workspace = workspacesByPath ? workspacesByPath.get(path) : null;
  const name = path.split('/').filter(Boolean).pop() || path;
  const slug = worktreeSlug(path, projectPath);
  const isMain = wt.isMain === true;
  const branch = wt.branch || (wt.detached ? 'detached' : '');
  const actions = [{ id: 'open-terminal', label: 'Open terminal here' }];
  if (!isMain) actions.push({ id: 'remove', label: 'Remove', danger: true });
  // The main worktree is marked by its icon and bold name (`current`), not
  // by meta — its branch already sits in `secondary`.
  const metaParts = [];
  if (workspace) metaParts.push(`workspace · ${workspace.name}`);
  if (slug) metaParts.push(`spec · ${slug}`);
  return {
    kind: 'worktree',
    id: wt.path,
    icon: isMain ? 'worktree-main' : 'worktree',
    iconClass: isMain ? 'worktree-main' : 'worktree',
    primary: name,
    secondary: branch || null,
    meta: metaParts.join(' · '),
    path: wt.path,
    branch: branch || null,
    current: isMain,
    slug,
    workspace: workspace ? workspace.name : null,
    actions
  };
}

/** Index workspace records by normalised folder path for worktreeRows. */
function workspacesByPath(workspaces) {
  const map = new Map();
  for (const ws of workspaces || []) {
    if (ws && ws.path) map.set(normalizePath(ws.path), ws);
  }
  return map;
}

function worktreeRows(result, projectPath, workspaces) {
  const worktrees = result && Array.isArray(result.worktrees) ? result.worktrees : [];
  const byPath = workspaces ? workspacesByPath(workspaces) : null;
  return worktrees.map((wt) => worktreeRow(wt, projectPath, byPath));
}

// ─── filter ───────────────────────────────────────────────

/**
 * Rows whose primary text, `#number`, secondary text or slug contains the
 * query, case-insensitively. An empty query keeps every row.
 */
function filterRows(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows.slice();
  return rows.filter((row) => {
    const hay = [
      row.primary,
      row.number !== undefined && row.number !== null ? `#${row.number}` : null,
      row.number !== undefined && row.number !== null ? String(row.number) : null,
      row.secondary,
      row.slug
    ];
    return hay.some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
  });
}

module.exports = {
  SLUG_MAX,
  relativeTime,
  contrastColor,
  labelColor,
  issueBranchName,
  prRow,
  prRows,
  issueRow,
  issueRows,
  branchRow,
  branchRows,
  worktreeSlug,
  worktreeRow,
  worktreeRows,
  filterRows
};
