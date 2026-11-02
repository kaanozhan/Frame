/**
 * Project Insights Module
 *
 * Two project-level reads that outlived the Overview dashboard they were
 * written for: the decisions recorded in PROJECT_NOTES.md (rendered by the
 * center Decisions view) and per-file git history (used by the structure
 * map's info panel).
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const frameStore = require('./frameStore');
const { IPC } = require('../shared/ipcChannels');
// The shared card reader — parsing, the current set, matching. The file's
// path is frameStore's, not the reader's mirror of it.
const decisionCards = require(path.join(__dirname, '..', '..', 'scripts', 'decision-cards.js'));

// A task run hears at most this many cards (decision-cards-core D17).
const TASK_RUN_CARDS = 2;

let mainWindow = null;

/**
 * Initialize overview manager
 */
function init(window) {
  mainWindow = window;
}

/**
 * Load every decision recorded in PROJECT_NOTES.md.
 *
 * A decision is a `### [YYYY-MM-DD] Title` heading; its body is everything
 * up to the next heading of the same or higher level (`###`, `##`, `#`),
 * which is what makes the entry readable on its own. Nothing is truncated
 * here — the Decisions view shows the whole list and does its own filtering.
 */
async function loadDecisions(projectPath) {
  try {
    const content = frameStore.readNotes(projectPath);
    if (content === null) {
      return { decisions: [], total: 0 };
    }

    const lines = content.split('\n');
    const headingRe = /^(#{1,3})\s/;
    const decisionRe = /^###\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.+)$/;

    const decisions = [];
    let current = null;
    let body = [];

    const flush = () => {
      if (!current) return;
      current.body = body.join('\n').trim();
      decisions.push(current);
      current = null;
      body = [];
    };

    lines.forEach((line, index) => {
      const decision = line.match(decisionRe);
      if (decision) {
        flush();
        current = { date: decision[1], title: decision[2].trim(), line: index + 1, body: '' };
        return;
      }
      // Any other heading at h1-h3 ends the current decision's body; deeper
      // headings (#### and below) belong to it.
      if (current && headingRe.test(line)) {
        flush();
        return;
      }
      if (current) body.push(line);
    });
    flush();

    // Newest first. Same-date entries keep their file order, which is the
    // order they were appended in.
    decisions.sort((a, b) => (a.date === b.date ? a.line - b.line : new Date(b.date) - new Date(a.date)));

    return {
      decisions,
      total: decisions.length,
      lastDecision: decisions[0] || null
    };
  } catch (err) {
    console.error('Error loading decisions:', err);
    return { decisions: [], total: 0, error: err.message };
  }
}

/**
 * The project's decision cards, read now: `{ exists, cards, notes, malformed }`.
 *
 *   cards      the current set — superseded cards dropped — spec and spec-less
 *   notes      today's PROJECT_NOTES.md entries, so a notes card's story can
 *              be shown where the card is
 *   malformed  the card-file lines the reader skipped, with why
 *
 * With `opts.match` — a task's title and description — it also returns
 * `matches`: at most two spec-less cards that match it strongly (the same
 * score the hooks use), each with the `story` pointer a prompt names. A
 * project with no card file returns empty lists and no matches.
 */
async function loadDecisionCards(projectPath, opts = {}) {
  const empty = { exists: false, cards: [], notes: [], malformed: [] };
  if (!projectPath) return opts && opts.match !== undefined ? { ...empty, matches: [] } : empty;
  let text = null;
  try {
    text = fs.readFileSync(frameStore.decisionsPath(projectPath), 'utf8');
  } catch (err) {
    text = null;
  }
  const parsed = text === null ? { cards: [], malformed: [] } : decisionCards.parseCards(text);
  const cards = decisionCards.currentCards(parsed.cards);
  const notes = cards.length ? (await loadDecisions(projectPath)).decisions : [];
  const out = { exists: text !== null, cards, notes, malformed: parsed.malformed };

  if (opts && typeof opts.match === 'string') {
    out.matches = decisionCards.scoreCards(decisionCards.specLessCards(cards), opts.match, { corpus: cards })
      .slice(0, TASK_RUN_CARDS)
      .map(({ card }) => ({ ...card, story: decisionCards.storyPointer(card) }));
  }
  return out;
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
  ipcMain.handle(IPC.LOAD_DECISIONS, async (event, projectPath) => {
    return await loadDecisions(projectPath);
  });

  ipcMain.handle(IPC.LOAD_DECISION_CARDS, async (event, projectPath, opts) => {
    return await loadDecisionCards(projectPath, opts || {});
  });

  ipcMain.handle(IPC.GET_FILE_GIT_HISTORY, async (event, projectPath, filePath) => {
    return await getFileGitHistory(projectPath, filePath);
  });
}

module.exports = {
  init,
  loadDecisions,
  loadDecisionCards,
  getFileGitHistory,
  setupIPC
};
