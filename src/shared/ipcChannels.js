/**
 * IPC Channel Constants
 * Single source of truth for all IPC channel names
 */

const IPC = {
  // Terminal
  START_TERMINAL: 'start-terminal',
  RESTART_TERMINAL: 'restart-terminal',
  TERMINAL_INPUT: 'terminal-input',
  TERMINAL_OUTPUT: 'terminal-output',
  TERMINAL_RESIZE: 'terminal-resize',

  // Project
  SELECT_PROJECT_FOLDER: 'select-project-folder',
  CREATE_NEW_PROJECT: 'create-new-project',
  PROJECT_SELECTED: 'project-selected',

  // File Tree
  LOAD_FILE_TREE: 'load-file-tree',
  FILE_TREE_DATA: 'file-tree-data',

  // History
  LOAD_PROMPT_HISTORY: 'load-prompt-history',
  PROMPT_HISTORY_DATA: 'prompt-history-data',
  TOGGLE_HISTORY_PANEL: 'toggle-history-panel',

  // Commands
  RUN_COMMAND: 'run-command',

  // Workspace
  LOAD_WORKSPACE: 'load-workspace',
  WORKSPACE_DATA: 'workspace-data',
  WORKSPACE_UPDATED: 'workspace-updated',
  ADD_PROJECT_TO_WORKSPACE: 'add-project-to-workspace',
  REMOVE_PROJECT_FROM_WORKSPACE: 'remove-project-from-workspace',

  // Frame Project
  INITIALIZE_FRAME_PROJECT: 'initialize-frame-project',
  FRAME_PROJECT_INITIALIZED: 'frame-project-initialized',
  CHECK_IS_FRAME_PROJECT: 'check-is-frame-project',
  IS_FRAME_PROJECT_RESULT: 'is-frame-project-result',
  GET_FRAME_CONFIG: 'get-frame-config',
  FRAME_CONFIG_DATA: 'frame-config-data',

  // File Editor
  READ_FILE: 'read-file',
  FILE_CONTENT: 'file-content',
  WRITE_FILE: 'write-file',
  FILE_SAVED: 'file-saved',

  // Multi-Terminal
  TERMINAL_CREATE: 'terminal-create',
  TERMINAL_CREATED: 'terminal-created',
  TERMINAL_DESTROY: 'terminal-destroy',
  TERMINAL_DESTROYED: 'terminal-destroyed',
  TERMINAL_INPUT_ID: 'terminal-input-id',
  TERMINAL_OUTPUT_ID: 'terminal-output-id',
  TERMINAL_RESIZE_ID: 'terminal-resize-id',
  TERMINAL_FOCUS: 'terminal-focus',

  // Tasks Panel
  LOAD_TASKS: 'load-tasks',
  TASKS_DATA: 'tasks-data',
  ADD_TASK: 'add-task',
  UPDATE_TASK: 'update-task',
  DELETE_TASK: 'delete-task',
  TASK_UPDATED: 'task-updated',
  TOGGLE_TASKS_PANEL: 'toggle-tasks-panel',

  // Plugins Panel
  LOAD_PLUGINS: 'load-plugins',
  PLUGINS_DATA: 'plugins-data',
  TOGGLE_PLUGIN: 'toggle-plugin',
  PLUGIN_TOGGLED: 'plugin-toggled',
  TOGGLE_PLUGINS_PANEL: 'toggle-plugins-panel',
  REFRESH_PLUGINS: 'refresh-plugins',

  // GitHub Panel
  LOAD_GITHUB_ISSUES: 'load-github-issues',
  GITHUB_ISSUES_DATA: 'github-issues-data',
  TOGGLE_GITHUB_PANEL: 'toggle-github-panel',
  OPEN_GITHUB_ISSUE: 'open-github-issue'
};

module.exports = { IPC };
