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

// Frame version
const FRAME_VERSION = '1.0';

module.exports = {
  FRAME_DIR,
  FRAME_CONFIG_FILE,
  WORKSPACE_DIR,
  WORKSPACE_FILE,
  FRAME_FILES,
  FRAME_BIN_DIR,
  FRAME_VERSION
};
