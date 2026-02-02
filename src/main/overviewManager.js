/**
 * Overview Manager Module
 * Gathers project data for overview dashboard
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { IPC } = require('../shared/ipcChannels');

let mainWindow = null;

/**
 * Initialize overview manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Load overview data for a project
 */
async function loadOverview(projectPath) {
  if (!projectPath) {
    return { error: 'No project selected' };
  }

  try {
    const [structure, tasks, decisions, stats] = await Promise.all([
      loadStructure(projectPath),
      loadTasks(projectPath),
      loadDecisions(projectPath),
      loadStats(projectPath)
    ]);

    return {
      error: null,
      projectPath,
      projectName: path.basename(projectPath),
      generatedAt: new Date().toISOString(),
      structure,
      tasks,
      decisions,
      stats
    };
  } catch (err) {
    console.error('Error loading overview:', err);
    return { error: err.message };
  }
}

/**
 * Load structure from STRUCTURE.json
 */
async function loadStructure(projectPath) {
  const structurePath = path.join(projectPath, 'STRUCTURE.json');

  try {
    if (!fs.existsSync(structurePath)) {
      return { modules: [], totalModules: 0 };
    }

    const data = JSON.parse(fs.readFileSync(structurePath, 'utf8'));
    const modules = data.modules || {};

    // Group by directory
    const groups = {};
    for (const [key, value] of Object.entries(modules)) {
      const dir = key.split('/')[0] || 'root';
      if (!groups[dir]) {
        groups[dir] = { name: dir, count: 0, modules: [] };
      }
      groups[dir].count++;
      groups[dir].modules.push({
        name: key,
        purpose: value.purpose || '',
        exports: value.exports || []
      });
    }

    return {
      groups: Object.values(groups),
      totalModules: Object.keys(modules).length,
      ipcChannels: data.ipcChannels ? Object.keys(data.ipcChannels).length : 0
    };
  } catch (err) {
    console.error('Error loading structure:', err);
    return { modules: [], totalModules: 0, error: err.message };
  }
}

/**
 * Load tasks from tasks.json
 */
async function loadTasks(projectPath) {
  const tasksPath = path.join(projectPath, 'tasks.json');

  try {
    if (!fs.existsSync(tasksPath)) {
      return { tasks: [], total: 0, completed: 0, pending: 0, inProgress: 0 };
    }

    const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    const tasks = data.tasks || [];

    const completed = tasks.filter(t => t.status === 'completed').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;

    return {
      tasks: tasks.slice(0, 10), // Last 10 tasks for display
      total: tasks.length,
      completed,
      pending,
      inProgress,
      progress: tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0
    };
  } catch (err) {
    console.error('Error loading tasks:', err);
    return { tasks: [], total: 0, completed: 0, pending: 0, inProgress: 0, error: err.message };
  }
}

/**
 * Load decisions from PROJECT_NOTES.md
 */
async function loadDecisions(projectPath) {
  const notesPath = path.join(projectPath, 'PROJECT_NOTES.md');

  try {
    if (!fs.existsSync(notesPath)) {
      return { decisions: [], total: 0 };
    }

    const content = fs.readFileSync(notesPath, 'utf8');

    // Parse ### [YYYY-MM-DD] Title format
    const decisionRegex = /###\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.+)/g;
    const decisions = [];
    let match;

    while ((match = decisionRegex.exec(content)) !== null) {
      decisions.push({
        date: match[1],
        title: match[2].trim()
      });
    }

    // Sort by date descending
    decisions.sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
      decisions: decisions.slice(0, 10), // Last 10 decisions
      total: decisions.length,
      lastDecision: decisions[0] || null
    };
  } catch (err) {
    console.error('Error loading decisions:', err);
    return { decisions: [], total: 0, error: err.message };
  }
}

/**
 * Load project stats (lines of code, files, git info)
 */
async function loadStats(projectPath) {
  try {
    const [linesOfCode, fileCount, gitInfo] = await Promise.all([
      countLinesOfCode(projectPath),
      countFiles(projectPath),
      getGitInfo(projectPath)
    ]);

    return {
      linesOfCode,
      fileCount,
      git: gitInfo
    };
  } catch (err) {
    console.error('Error loading stats:', err);
    return { linesOfCode: 0, fileCount: 0, git: null, error: err.message };
  }
}

/**
 * Count lines of code in src directory
 */
function countLinesOfCode(projectPath) {
  return new Promise((resolve) => {
    const srcPath = path.join(projectPath, 'src');

    if (!fs.existsSync(srcPath)) {
      resolve({ total: 0, byExtension: {} });
      return;
    }

    exec(`find "${srcPath}" -name "*.js" -exec cat {} \\; | wc -l`, (err, stdout) => {
      if (err) {
        resolve({ total: 0, byExtension: {} });
        return;
      }

      const total = parseInt(stdout.trim()) || 0;
      resolve({ total, byExtension: { js: total } });
    });
  });
}

/**
 * Count files in src directory
 */
function countFiles(projectPath) {
  return new Promise((resolve) => {
    const srcPath = path.join(projectPath, 'src');

    if (!fs.existsSync(srcPath)) {
      resolve({ total: 0 });
      return;
    }

    exec(`find "${srcPath}" -name "*.js" | wc -l`, (err, stdout) => {
      if (err) {
        resolve({ total: 0 });
        return;
      }

      resolve({ total: parseInt(stdout.trim()) || 0 });
    });
  });
}

/**
 * Get git information
 */
function getGitInfo(projectPath) {
  return new Promise((resolve) => {
    exec('git log --oneline -1', { cwd: projectPath }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }

      const lastCommit = stdout.trim();

      exec('git rev-list --count HEAD', { cwd: projectPath }, (err2, stdout2) => {
        const commitCount = err2 ? 0 : parseInt(stdout2.trim()) || 0;

        exec('git branch --show-current', { cwd: projectPath }, (err3, stdout3) => {
          const branch = err3 ? 'unknown' : stdout3.trim();

          resolve({
            lastCommit,
            commitCount,
            branch
          });
        });
      });
    });
  });
}

/**
 * Get file git history (contributors, commits, blame)
 */
async function getFileGitHistory(projectPath, filePath) {
  console.log('getFileGitHistory called:', projectPath, filePath);

  if (!projectPath || !filePath) {
    return { error: 'Missing parameters' };
  }

  try {
    // Run sequentially to avoid issues, with timeout
    console.log('Getting commits...');
    const commits = await getFileCommits(projectPath, filePath);
    console.log('Commits:', commits.length);

    console.log('Getting contributors...');
    const contributors = await getFileContributors(projectPath, filePath);
    console.log('Contributors:', contributors.length);

    // Skip blame for now - it's slow
    const blame = [];

    console.log('Returning result');
    return {
      error: null,
      filePath,
      commits,
      contributors,
      blame
    };
  } catch (err) {
    console.error('Error loading file git history:', err);
    return { error: err.message };
  }
}

/**
 * Get recent commits for a file
 */
function getFileCommits(projectPath, filePath) {
  return new Promise((resolve) => {
    const cmd = `git log --oneline --format="%h|%an|%ar|%s" -10 -- "${filePath}"`;

    exec(cmd, { cwd: projectPath, timeout: 5000 }, (err, stdout) => {
      if (err) {
        console.log('getFileCommits error:', err.message);
        resolve([]);
        return;
      }

      const commits = stdout.trim().split('\n')
        .filter(line => line)
        .map(line => {
          const [hash, author, date, ...messageParts] = line.split('|');
          return {
            hash,
            author,
            date,
            message: messageParts.join('|')
          };
        });

      resolve(commits);
    });
  });
}

/**
 * Get contributors for a file
 */
function getFileContributors(projectPath, filePath) {
  return new Promise((resolve) => {
    const cmd = `git shortlog -sne -- "${filePath}"`;

    exec(cmd, { cwd: projectPath, timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }

      const contributors = stdout.trim().split('\n')
        .filter(line => line)
        .map(line => {
          const match = line.trim().match(/^\s*(\d+)\s+(.+?)\s+<(.+?)>$/);
          if (match) {
            return {
              commits: parseInt(match[1]),
              name: match[2],
              email: match[3]
            };
          }
          return null;
        })
        .filter(c => c);

      resolve(contributors);
    });
  });
}

/**
 * Get blame summary for a file (who wrote how many lines)
 */
function getFileBlame(projectPath, filePath) {
  return new Promise((resolve) => {
    const cmd = `git blame --line-porcelain -- "${filePath}" 2>/dev/null | grep "^author " | sort | uniq -c | sort -rn | head -5`;

    exec(cmd, { cwd: projectPath }, (err, stdout) => {
      if (err) {
        resolve([]);
        return;
      }

      const blameData = stdout.trim().split('\n')
        .filter(line => line)
        .map(line => {
          const match = line.trim().match(/^\s*(\d+)\s+author\s+(.+)$/);
          if (match) {
            return {
              lines: parseInt(match[1]),
              author: match[2]
            };
          }
          return null;
        })
        .filter(b => b);

      resolve(blameData);
    });
  });
}

/**
 * Setup IPC handlers
 */
function setupIPC(ipcMain) {
  ipcMain.handle(IPC.LOAD_OVERVIEW, async (event, projectPath) => {
    return await loadOverview(projectPath);
  });

  ipcMain.handle(IPC.GET_FILE_GIT_HISTORY, async (event, projectPath, filePath) => {
    return await getFileGitHistory(projectPath, filePath);
  });
}

module.exports = {
  init,
  loadOverview,
  getFileGitHistory,
  setupIPC
};
