/**
 * Frame Constants
 * Configuration constants for Frame project management
 */

// Frame project folder name (inside each project)
const FRAME_DIR = '.frame';

// Frame config file name
const FRAME_CONFIG_FILE = 'config.json';

// Workspace directory name (in user home: ~/.frame/)
const WORKSPACE_DIR = '.frame';

// Workspace file name
const WORKSPACE_FILE = 'workspaces.json';

// Frame auto-generated files. Names only — where they live (root or .frame/)
// is frameStore's business, never a caller's.
const FRAME_FILES = {
  AGENTS: 'AGENTS.md',
  CLAUDE_SYMLINK: 'CLAUDE.md',
  STRUCTURE: 'STRUCTURE.json',
  NOTES: 'PROJECT_NOTES.md',
  TASKS: 'tasks.json',
  QUICKSTART: 'QUICKSTART.md'
};

// Frame bin directory for AI tool wrappers
const FRAME_BIN_DIR = 'bin';

// ─── Overlay layout (.frame/) ────────────────────────────────

// Pointer file Claude Code loads at session start; it @-imports
// .frame/AGENTS.md, which is how Frame reaches an AI session without
// planting anything at the project root. Project-relative, joined by callers.
const CLAUDE_RULE_PATH = '.claude/rules/frame.md';

// Managed ignore file inside .frame/ (never the project's tracked .gitignore)
const FRAME_GITIGNORE_FILE = '.gitignore';

// Root files older Frame projects carry as symlinks to AGENTS.md. Migration
// removes them when they point at AGENTS.md; a real file is never touched.
const LEGACY_SYMLINKS = ['CLAUDE.md', 'GEMINI.md'];

// Where migration parks a copy of every root file before it moves it
const MIGRATION_BACKUP_DIR = 'migration-backup';

// What each .frame/ entry *is*, which decides how git and (later) sync treat
// it. Paths are relative to .frame/. Class is not the same as tracking: some
// derived entries stay tracked (below), so the managed .frame/.gitignore block
// is built from these lists minus those.
const FRAME_FILE_CLASSES = {
  instruction: ['AGENTS.md', 'docs/'],
  data: ['tasks.json', 'PROJECT_NOTES.md', 'QUICKSTART.md', 'specs/'],
  derived: [
    'STRUCTURE.json',
    'index/',
    'specs/*/implement-report.html',
    'specs/*/plan-report.html',
    'specs/*/report-data.json'
  ],
  runtime: [
    'runtime/',
    'worktrees/',
    'orchestration/',
    'migration-backup/',
    'bin/',
    'implement-permissions.json',
    '*.bak',
    '*.tmp',
    '*.corrupt-*'
  ]
};

// Derived, but committed anyway. STRUCTURE.json because teammates and
// worktrees read it; it is refreshed from the project's own sources on every
// open, so a stale committed copy heals itself.
//
// bin/ used to be in this list too. T15 of the non-invasive-overlay spec put
// it here so a teammate cloning a repo would get the scripts the tracked
// .claude/settings.json hooks point at; that is reversed here, and bin/ is
// back in the runtime class D6 of that same spec originally gave it. Both of
// T15's rationales have since lapsed, and nothing shipped depends on them:
//   - No released build ships the tracking. `git tag --contains a8c1c8c` is
//     empty and v2.6.0 predates T15, so there is no installed base to repair.
//   - The clone-without-Frame user does not exist while Frame ships only as
//     the IDE (package.json declares no bin entry), and the hook guard
//     `[ ! -f .frame/bin/x.js ] || exec node ...` already makes a script-less
//     checkout silent rather than broken.
//   - Both worktree paths already assume bin/ may be absent and fall back to
//     an absolute path (orchestrationManager.js binDirFor, and the pre-commit
//     snippet's --git-common-dir fallback), so that path is now the normal
//     one rather than the exception.
// The scripts are still copied into every checkout on every project open by
// copyParserScripts; only git's view of them changed. See the
// frame-bin-out-of-repo spec.
const FRAME_TRACKED_DERIVED = ['STRUCTURE.json'];

// ─── Orchestration (conductor / parallel spec execution) ──

// Worker worktrees live under .frame/worktrees/<slug>
const ORCH_WORKTREES_DIR = 'worktrees';

// Conductor↔worker command bus lives under .frame/runtime/orch-bus/. The
// absolute path is injected into every spawned terminal via the env var below
// so the bus is shared even though each worktree has its own .frame/ copy.
const ORCH_BUS_DIR = 'runtime/orch-bus';
const ORCH_BUS_ENV = 'FRAME_ORCH_BUS';

// Branch naming. Workers commit to the work branch; the conductor merges
// work → integration locally — never main, never pushed.
const ORCH_BRANCH_PREFIX = 'frame';
const orchWorkBranch = (slug) => `${ORCH_BRANCH_PREFIX}/${slug}/work`;
const orchIntegrationBranch = (slug) => `${ORCH_BRANCH_PREFIX}/${slug}/integration`;

// Meta files excluded from footprint conflict analysis (reconciled separately,
// otherwise every spec collides on them).
const ORCH_META_FILES = ['tasks.json', 'STRUCTURE.json', 'PROJECT_NOTES.md', 'AGENTS.md', 'CLAUDE.md'];

// Frame version
const FRAME_VERSION = '1.0';

module.exports = {
  FRAME_DIR,
  FRAME_CONFIG_FILE,
  WORKSPACE_DIR,
  WORKSPACE_FILE,
  FRAME_FILES,
  FRAME_BIN_DIR,
  CLAUDE_RULE_PATH,
  FRAME_GITIGNORE_FILE,
  LEGACY_SYMLINKS,
  MIGRATION_BACKUP_DIR,
  FRAME_FILE_CLASSES,
  FRAME_TRACKED_DERIVED,
  ORCH_WORKTREES_DIR,
  ORCH_BUS_DIR,
  ORCH_BUS_ENV,
  ORCH_BRANCH_PREFIX,
  orchWorkBranch,
  orchIntegrationBranch,
  ORCH_META_FILES,
  FRAME_VERSION
};
