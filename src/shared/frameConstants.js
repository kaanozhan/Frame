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

/**
 * Root-level file names written by pre-overlay Frame versions.
 *
 * These are **detection only**. Frame no longer creates, reads as live data,
 * or modifies anything at the project root — the overlay owns exactly
 * `.frame/` (see the non-invasive-overlay spec). The names survive so the
 * legacy-layout scan can recognize a project initialized by an older Frame
 * and say "this needs migration" instead of "not a Frame project".
 *
 * `FRAME_FILES` is kept as an alias while the remaining pre-overlay call
 * sites are converted.
 */
const LEGACY_ROOT_FILES = {
  AGENTS: 'AGENTS.md',
  CLAUDE_SYMLINK: 'CLAUDE.md',
  GEMINI_SYMLINK: 'GEMINI.md',
  STRUCTURE: 'STRUCTURE.json',
  NOTES: 'PROJECT_NOTES.md',
  TASKS: 'tasks.json',
  QUICKSTART: 'QUICKSTART.md'
};

const FRAME_FILES = LEGACY_ROOT_FILES;

/**
 * The live layout: every Frame meta artifact, addressed relative to the
 * project root and always inside `.frame/`.
 *
 * Posix separators — these are repo-relative identifiers (footprints, docs,
 * comparisons), not filesystem paths. Join through `frameStore`, which owns
 * the only conversion to an absolute path; callers should not rebuild these
 * by hand.
 */
const FRAME_META_FILES = {
  AGENTS: `${FRAME_DIR}/AGENTS.md`,
  STRUCTURE: `${FRAME_DIR}/STRUCTURE.json`,
  NOTES: `${FRAME_DIR}/PROJECT_NOTES.md`,
  TASKS: `${FRAME_DIR}/tasks.json`,
  QUICKSTART: `${FRAME_DIR}/QUICKSTART.md`,
  CONFIG: `${FRAME_DIR}/${FRAME_CONFIG_FILE}`
};

// Frame bin directory for AI tool wrappers
const FRAME_BIN_DIR = 'bin';

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
//
// Bare file names on purpose: both consumers (specManager, orchestrationManager)
// match a footprint entry's *basename* against this list, which makes it
// layout-agnostic — `.frame/tasks.json` and a pre-overlay root `tasks.json`
// both reduce to `tasks.json`. Spelling these as `.frame/`-relative paths
// would silently stop every one of those matches.
const ORCH_META_FILES = ['tasks.json', 'STRUCTURE.json', 'PROJECT_NOTES.md', 'AGENTS.md', 'CLAUDE.md'];

// Frame version
const FRAME_VERSION = '1.0';

module.exports = {
  FRAME_DIR,
  FRAME_CONFIG_FILE,
  WORKSPACE_DIR,
  WORKSPACE_FILE,
  FRAME_FILES,
  LEGACY_ROOT_FILES,
  FRAME_META_FILES,
  FRAME_BIN_DIR,
  ORCH_WORKTREES_DIR,
  ORCH_BUS_DIR,
  ORCH_BUS_ENV,
  ORCH_BRANCH_PREFIX,
  orchWorkBranch,
  orchIntegrationBranch,
  ORCH_META_FILES,
  FRAME_VERSION
};
