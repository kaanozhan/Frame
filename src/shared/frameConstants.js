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

// Frame auto-generated files
const FRAME_FILES = {
  AGENTS: 'AGENTS.md',
  CLAUDE_SYMLINK: 'CLAUDE.md',
  GEMINI_SYMLINK: 'GEMINI.md',
  STRUCTURE: 'STRUCTURE.json',
  NOTES: 'PROJECT_NOTES.md',
  TASKS: 'tasks.json',
  QUICKSTART: 'QUICKSTART.md'
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
  ORCH_WORKTREES_DIR,
  ORCH_BUS_DIR,
  ORCH_BUS_ENV,
  ORCH_BRANCH_PREFIX,
  orchWorkBranch,
  orchIntegrationBranch,
  ORCH_META_FILES,
  FRAME_VERSION
};
