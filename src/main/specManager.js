/**
 * Spec-Driven Development Manager
 *
 * Owns .frame/specs/<slug>/{spec.md, plan.md, tasks.md, status.json}
 * for the active project. CRUD + file watcher + IPC.
 *
 * Data model is documented in PROJECT_NOTES.md (2026-04-29 entry).
 *
 * Mirrors the tasksManager.js pattern: stateless module-level functions
 * that take projectPath as input, plus a single watcher that lives for
 * the lifetime of the active project session.
 */

const fs = require('fs');
const path = require('path');
const { IPC } = require('../shared/ipcChannels');
const { FRAME_DIR } = require('../shared/frameConstants');
const tasksManager = require('./tasksManager');

const SPECS_DIR_NAME = 'specs';
const STATUS_FILE = 'status.json';
const SPEC_FILE = 'spec.md';
const PLAN_FILE = 'plan.md';
const TASKS_FILE = 'tasks.md';

const PHASES = ['draft', 'specified', 'planned', 'tasks_generated', 'implementing', 'done'];
const AI_TOOLS = ['claude-code', 'codex', 'gemini'];

const WATCH_DEBOUNCE_MS = 250;
const SLUG_MAX_LEN = 48;

let mainWindow = null;
let activeWatcher = null;
let activeWatchedProject = null;
let watchDebounce = null;

// ─── Path helpers ──────────────────────────────────────────

function getSpecsRoot(projectPath) {
  return path.join(projectPath, FRAME_DIR, SPECS_DIR_NAME);
}

function getSpecDir(projectPath, slug) {
  return path.join(getSpecsRoot(projectPath), slug);
}

// ─── Slug generation ──────────────────────────────────────
//
// Lowercase, kebab-case, [a-z0-9-] only, max 48 chars. Conflicts get
// `-2`, `-3`, ... suffixes. See PROJECT_NOTES.md for the canonical rules.

function generateSlug(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, SLUG_MAX_LEN)
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(projectPath, baseSlug) {
  const root = getSpecsRoot(projectPath);
  if (!fs.existsSync(path.join(root, baseSlug))) return baseSlug;
  let n = 2;
  while (fs.existsSync(path.join(root, `${baseSlug}-${n}`))) n++;
  return `${baseSlug}-${n}`;
}

// ─── Validation ────────────────────────────────────────────
//
// Shape check only — phase enum, required fields, ISO date strings.
// Returns null when valid, or a human-readable reason string.

function validateSpecStatus(obj) {
  if (!obj || typeof obj !== 'object') return 'not an object';
  if (typeof obj.slug !== 'string' || !obj.slug) return 'missing slug';
  if (typeof obj.title !== 'string' || !obj.title) return 'missing title';
  if (!PHASES.includes(obj.phase)) return `invalid phase: ${obj.phase}`;
  if (obj.ai_tool != null && !AI_TOOLS.includes(obj.ai_tool)) {
    return `invalid ai_tool: ${obj.ai_tool}`;
  }
  if (!Array.isArray(obj.generated_task_ids)) return 'generated_task_ids must be an array';
  for (const k of ['created_at', 'updated_at', 'last_phase_at']) {
    if (obj[k] != null && Number.isNaN(Date.parse(obj[k]))) {
      return `invalid timestamp: ${k}`;
    }
  }
  return null;
}

// ─── Filesystem helpers ────────────────────────────────────

function readFileSafe(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch (err) {
    console.error('specManager: read failed', p, err);
    return null;
  }
}

function readStatus(projectPath, slug) {
  const raw = readFileSafe(path.join(getSpecDir(projectPath, slug), STATUS_FILE));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('specManager: status.json parse failed', slug, err);
    return null;
  }
}

function writeStatus(projectPath, slug, status) {
  const dir = getSpecDir(projectPath, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, STATUS_FILE), JSON.stringify(status, null, 2) + '\n', 'utf8');
}

// ─── Public API ────────────────────────────────────────────

function listSpecs(projectPath) {
  const root = getSpecsRoot(projectPath);
  if (!fs.existsSync(root)) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.error('specManager: listSpecs readdir failed', err);
    return [];
  }
  const specs = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    // Reconcile phase from filesystem state — catches the case where the AI
    // wrote a plan.md / tasks.md but didn't (or couldn't) update status.json.
    reconcilePhase(projectPath, ent.name);
    const status = readStatus(projectPath, ent.name);
    if (!status) continue;
    if (validateSpecStatus(status)) continue; // silently skip malformed
    specs.push({
      slug: status.slug,
      title: status.title,
      phase: status.phase,
      ai_tool: status.ai_tool || null,
      task_count: status.generated_task_ids.length,
      created_at: status.created_at || null,
      updated_at: status.updated_at || null
    });
  }
  specs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  return specs;
}

// ─── Phase derivation ──────────────────────────────────────
//
// Auto-advance phase based on which files exist on disk. The AI tool is
// supposed to update status.json after writing each artifact, but we don't
// rely on that — defense in depth.

function fileExists(projectPath, slug, name) {
  return fs.existsSync(path.join(getSpecDir(projectPath, slug), name));
}

function derivePhase(projectPath, slug, currentPhase) {
  // Once the user has manually moved into implementing / done, leave it
  // alone — those phases are owned by the user, not the filesystem.
  if (currentPhase === 'implementing' || currentPhase === 'done') return currentPhase;
  if (fileExists(projectPath, slug, TASKS_FILE)) return 'tasks_generated';
  if (fileExists(projectPath, slug, PLAN_FILE)) return 'planned';
  if (fileExists(projectPath, slug, SPEC_FILE)) return 'specified';
  return 'draft';
}

function reconcilePhase(projectPath, slug) {
  const status = readStatus(projectPath, slug);
  if (!status) return;
  const newPhase = derivePhase(projectPath, slug, status.phase);
  if (newPhase === status.phase) return;
  const now = new Date().toISOString();
  writeStatus(projectPath, slug, {
    ...status,
    phase: newPhase,
    updated_at: now,
    last_phase_at: now
  });
}

// ─── Command template loading + interpolation ──────────────
//
// Templates live in src/templates/commands/<aiTool>/<command>.md (Frame
// defaults). Projects can override per-template by dropping a file into
// .frame/templates/commands/<aiTool>/<command>.md. {placeholder} tokens
// are substituted via a simple regex — no expression evaluation.

const FRAME_TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const SUPPORTED_COMMANDS = ['spec.new', 'spec.plan', 'spec.tasks'];

function getDefaultTemplatePath(aiTool, command) {
  return path.join(FRAME_TEMPLATES_DIR, 'commands', aiTool, `${command}.md`);
}

function getOverrideTemplatePath(projectPath, aiTool, command) {
  return path.join(projectPath, FRAME_DIR, 'templates', 'commands', aiTool, `${command}.md`);
}

function loadCommandTemplate(projectPath, aiTool, command) {
  const override = readFileSafe(getOverrideTemplatePath(projectPath, aiTool, command));
  if (override) return override;
  return readFileSafe(getDefaultTemplatePath(aiTool, command));
}

function interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    return vars[key] != null ? String(vars[key]) : m;
  });
}

function getCommandPrompt(projectPath, slug, command, aiTool) {
  if (!SUPPORTED_COMMANDS.includes(command)) return { error: `unknown command: ${command}` };
  const tool = aiTool || 'claude-code';
  const status = readStatus(projectPath, slug);
  if (!status) return { error: 'spec not found' };
  const template = loadCommandTemplate(projectPath, tool, command);
  if (!template) return { error: `no ${tool} template for ${command}` };
  const prompt = interpolate(template, {
    project_path: projectPath,
    slug,
    title: status.title,
    description: '' // Slice 1.7: spec.new uses the seeded spec.md as input; description placeholder reserved for future use
  });
  return { prompt };
}

// ─── tasks.md → tasks.json sync (Slice 1.8) ────────────────
//
// When a spec advances to phase `tasks_generated`, parse its tasks.md and
// upsert each entry into the project's tasks.json with a `source` marker
// of the form `spec:<slug>:T<n>`. Re-syncs update titles in place but
// preserve user-set status (pending → in_progress → completed).
//
// Known limitation: deleting a spec-sourced task in the Tasks panel will
// have it re-imported on the next sync. Slice 3 can track dismissals.

const TASK_LINE_RE = /^\s*-\s*(T\d{1,3})\s*[·:.\-—]?\s*(.+?)\s*$/;

function parseTasksMarkdown(content) {
  if (!content) return [];
  const out = [];
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(TASK_LINE_RE);
    if (!m) continue;
    const description = m[2].trim();
    if (!description) continue;
    out.push({ taskId: m[1], description });
  }
  return out;
}

function syncTasksFromMarkdown(projectPath, slug) {
  const tasksMdPath = path.join(getSpecDir(projectPath, slug), TASKS_FILE);
  const md = readFileSafe(tasksMdPath);
  if (!md) return { synced: 0 };

  const parsed = parseTasksMarkdown(md);
  if (parsed.length === 0) return { synced: 0 };

  // tasksManager.loadTasks owns shape normalization (flat array since v2.0,
  // legacy nested shape transparently migrated). Going through it also
  // wires us into the self-write guard so our writes don't trigger the
  // tasks.json file watcher into a loop.
  const tasksData = tasksManager.loadTasks(projectPath);
  if (!tasksData) return { synced: 0, error: 'no tasks.json in project' };
  if (!Array.isArray(tasksData.tasks)) tasksData.tasks = [];

  const now = new Date().toISOString();
  const generatedIds = [];
  let added = 0, updated = 0, unchanged = 0;

  for (const item of parsed) {
    const sourceMarker = `spec:${slug}:${item.taskId}`;
    const id = `task-spec-${slug}-${item.taskId}`;
    const existing = tasksData.tasks.find(t => t && t.source === sourceMarker);
    if (existing) {
      generatedIds.push(existing.id);
      if (existing.title !== item.description) {
        existing.title = item.description;
        existing.updatedAt = now;
        updated++;
      } else {
        unchanged++;
      }
    } else {
      tasksData.tasks.push({
        id,
        title: item.description,
        description: '',
        source: sourceMarker,
        status: 'pending',
        priority: 'medium',
        category: 'feature',
        context: `From spec: ${slug}`,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      });
      tasksData.metadata = tasksData.metadata || {};
      tasksData.metadata.totalCreated = (tasksData.metadata.totalCreated || 0) + 1;
      generatedIds.push(id);
      added++;
    }
  }

  // Only save if something actually changed — saveTasks bumps lastUpdated and
  // the self-write guard, both of which we want to keep stable on no-op syncs.
  if (added > 0 || updated > 0) {
    tasksManager.saveTasks(projectPath, tasksData);
  }

  // Reflect the latest mapping in status.json so the panel shows accurate
  // task counts even after re-imports.
  const status = readStatus(projectPath, slug);
  if (status && !arraysEqual(status.generated_task_ids, generatedIds)) {
    writeStatus(projectPath, slug, {
      ...status,
      generated_task_ids: generatedIds,
      updated_at: now
    });
  }

  // Push a fresh TASKS_DATA so any open Tasks panel / Kanban dashboard
  // picks up the new rows without needing a manual reload.
  if ((added > 0 || updated > 0) && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.TASKS_DATA, { projectPath, tasks: tasksData });
  }

  return { synced: parsed.length, added, updated, unchanged };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function syncAllSpecTasks(projectPath) {
  const root = getSpecsRoot(projectPath);
  if (!fs.existsSync(root)) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (fs.existsSync(path.join(root, ent.name, TASKS_FILE))) {
      syncTasksFromMarkdown(projectPath, ent.name);
    }
  }
}

function getSpec(projectPath, slug) {
  const dir = getSpecDir(projectPath, slug);
  if (!fs.existsSync(dir)) return null;
  const status = readStatus(projectPath, slug);
  if (!status) return null;
  return {
    status,
    spec: readFileSafe(path.join(dir, SPEC_FILE)),
    plan: readFileSafe(path.join(dir, PLAN_FILE)),
    tasks: readFileSafe(path.join(dir, TASKS_FILE))
  };
}

function createSpec(projectPath, opts) {
  const { title, ai_tool, description } = opts || {};
  if (!title || typeof title !== 'string') return { error: 'title required' };
  const baseSlug = generateSlug(title);
  if (!baseSlug) return { error: 'could not derive slug from title' };
  const slug = uniqueSlug(projectPath, baseSlug);
  const now = new Date().toISOString();

  // If the user typed a description in the modal, seed spec.md with it so
  // the panel has something to show right away. /spec.new (Slice 1.7) will
  // later replace this draft with a proper template-driven spec authored
  // by the active AI tool.
  const trimmedDescription = typeof description === 'string' ? description.trim() : '';
  const hasDescription = trimmedDescription.length > 0;

  const status = {
    slug,
    title,
    phase: hasDescription ? 'specified' : 'draft',
    ai_tool: AI_TOOLS.includes(ai_tool) ? ai_tool : null,
    generated_task_ids: [],
    created_at: now,
    updated_at: now,
    last_phase_at: now
  };
  writeStatus(projectPath, slug, status);

  if (hasDescription) {
    const dir = getSpecDir(projectPath, slug);
    const seed = `# ${title}\n\n${trimmedDescription}\n`;
    fs.writeFileSync(path.join(dir, SPEC_FILE), seed, 'utf8');
  }

  return { slug, status };
}

function updateSpecStatus(projectPath, slug, partial) {
  const current = readStatus(projectPath, slug);
  if (!current) return { error: 'spec not found' };
  const phaseChanged = partial && partial.phase && partial.phase !== current.phase;
  const now = new Date().toISOString();
  const merged = {
    ...current,
    ...partial,
    slug: current.slug, // slug is immutable
    updated_at: now,
    last_phase_at: phaseChanged ? now : current.last_phase_at
  };
  const reason = validateSpecStatus(merged);
  if (reason) return { error: reason };
  writeStatus(projectPath, slug, merged);
  return { status: merged };
}

function deleteSpec(projectPath, slug) {
  const dir = getSpecDir(projectPath, slug);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

// ─── Watcher ───────────────────────────────────────────────
//
// fs.watch with recursive: true. Supported on macOS, Windows, and Linux
// (Node ≥ 20.5). Electron 28 ships with a Node version that supports this
// across all three platforms — if that ever changes, swap in a poller.

function startWatching(projectPath) {
  stopWatching();
  if (!projectPath) return;
  const root = getSpecsRoot(projectPath);
  // Ensure the directory exists so fs.watch doesn't throw on a fresh project
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch (err) {
    console.error('specManager: could not create specs root', err);
    return;
  }
  try {
    activeWatcher = fs.watch(root, { recursive: true }, () => {
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => pushSpecData(projectPath), WATCH_DEBOUNCE_MS);
    });
    activeWatchedProject = projectPath;
  } catch (err) {
    console.error('specManager: fs.watch failed', err);
    return;
  }
  // Initial snapshot so the panel paints something immediately
  pushSpecData(projectPath);
}

function stopWatching() {
  if (activeWatcher) {
    try { activeWatcher.close(); } catch (err) { /* ignore */ }
  }
  activeWatcher = null;
  activeWatchedProject = null;
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
}

function pushSpecData(projectPath) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Sync any spec with tasks.md → tasks.json before listing, so renderer
  // sees consistent task counts and the Tasks panel auto-refreshes.
  syncAllSpecTasks(projectPath);
  const specs = listSpecs(projectPath);
  mainWindow.webContents.send(IPC.SPEC_DATA, { projectPath, specs });
}

// ─── Init + IPC ────────────────────────────────────────────

function init(window) {
  mainWindow = window;
}

function setupIPC(ipcMain) {
  ipcMain.handle(IPC.LIST_SPECS, (event, projectPath) =>
    listSpecs(projectPath)
  );
  ipcMain.handle(IPC.GET_SPEC, (event, { projectPath, slug }) =>
    getSpec(projectPath, slug)
  );
  ipcMain.handle(IPC.CREATE_SPEC, (event, { projectPath, opts }) =>
    createSpec(projectPath, opts)
  );
  ipcMain.handle(IPC.UPDATE_SPEC_STATUS, (event, { projectPath, slug, partial }) =>
    updateSpecStatus(projectPath, slug, partial)
  );
  ipcMain.handle(IPC.GET_SPEC_PROMPT, (event, { projectPath, slug, command, aiTool }) =>
    getCommandPrompt(projectPath, slug, command, aiTool)
  );
  ipcMain.on(IPC.WATCH_SPECS, (event, projectPath) => {
    startWatching(projectPath);
  });
  ipcMain.on(IPC.UNWATCH_SPECS, () => {
    stopWatching();
  });
}

module.exports = {
  init,
  setupIPC,
  // Exported for tests + future Slice 1.5 (project init) reuse
  generateSlug,
  validateSpecStatus,
  listSpecs,
  getSpec,
  createSpec,
  updateSpecStatus,
  deleteSpec,
  derivePhase,
  getCommandPrompt,
  parseTasksMarkdown,
  syncTasksFromMarkdown
};
