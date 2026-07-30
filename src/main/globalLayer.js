/**
 * globalLayer — Frame's own instructions, stored once outside every project.
 *
 * How to recognize a task, when to capture a note, the spec workflow,
 * structure upkeep: that content is identical in every project and belongs to
 * Frame, not to the user's repository. It lives in user-scoped storage —
 * `userData/frame-global/{AGENTS.md, REFERENCE.md}`, beside `user-settings.json`
 * and `ai-tool-config.json` — and is referenced by path at launch, never copied
 * into a working tree.
 *
 * That is what makes the overlay possible at all: opening a company repo adds
 * nothing to it, and updating Frame updates every project's agent behavior
 * without a single write to any repository.
 *
 * ── Upgrades vs. user additions ──
 * The user may extend these files, so an upgrade must not flatten them. The
 * generated spec section carries `docsManagedBlock` markers and is replaced in
 * place when its version moves; everything outside the markers is the user's
 * and is preserved. The same managed-block machinery that used to chase a copy
 * per project now runs once, here.
 *
 * A file the user has edited outside the managed block is never regenerated
 * wholesale — only a missing file is written from the template.
 */

const fs = require('fs');
const path = require('path');
const templates = require('../shared/frameTemplates');
const managedBlock = require('../shared/docsManagedBlock');

const GLOBAL_DIR_NAME = 'frame-global';
const AGENTS_FILE = 'AGENTS.md';
const REFERENCE_FILE = 'REFERENCE.md';

// Injected by init(); kept out of the module's require graph so the suite can
// exercise this without Electron.
let userDataPath = null;

/**
 * @param {string} dataPath - Electron's `app.getPath('userData')`.
 */
function init(dataPath) {
  userDataPath = dataPath;
}

function dirPath() {
  if (!userDataPath) throw new Error('globalLayer: init(userDataPath) has not been called');
  return path.join(userDataPath, GLOBAL_DIR_NAME);
}

function agentsPath() {
  return path.join(dirPath(), AGENTS_FILE);
}

function referencePath() {
  return path.join(dirPath(), REFERENCE_FILE);
}

/**
 * Frame's generic core: no Project Facts, no creation stamp, and no spec
 * section.
 *
 * The spec workflow is deliberately absent from the core — whether a project
 * runs spec-driven is per-project state (`features.specDriven`), and the core
 * is shared by all of them. The activation signal moves to the launch-time
 * preamble, which says nothing at all when the flag is off; a project with the
 * workflow disabled must have no text anywhere telling an agent to write specs.
 * The full protocol still lives in REFERENCE.md, where it is documentation
 * rather than an instruction to act.
 */
function renderAgents() {
  return templates.getAgentsTemplate('Frame', {
    global: true,
    specDriven: false,
    referencePath: REFERENCE_FILE
  });
}

function renderReference() {
  return templates.getReferenceTemplate('Frame');
}

function writeFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

/**
 * Bring one file to the current version.
 *   'created'  — was missing, written from the template
 *   'upgraded' — managed block replaced in place, user additions untouched
 *   'current'  — nothing to do
 */
function ensureFile(target, render, body, version, legacyMatchers) {
  let existing;
  try {
    existing = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    writeFile(target, render());
    return 'created';
  }

  if (!body) return 'current';

  const upgraded = managedBlock.upgradeDoc(existing, { body, version, legacyMatchers });
  if (upgraded === null) return 'current';
  writeFile(target, upgraded);
  return 'upgraded';
}

/**
 * Create or upgrade the global layer. Called once at app ready; safe to call
 * again. Never throws at the caller — a home directory that cannot be written
 * degrades the preamble, it does not stop the app.
 */
function ensure() {
  try {
    fs.mkdirSync(dirPath(), { recursive: true });

    return {
      // The core carries no managed block, so there is nothing to upgrade in
      // place — it is written once and then belongs to the user.
      agents: ensureFile(agentsPath(), renderAgents, null, null, null),
      // REFERENCE.md carries the spec protocol as a managed block: this is the
      // single copy that the per-project chase in upgradeSpecDocs existed to
      // replace.
      reference: ensureFile(
        referencePath(),
        renderReference,
        templates.SPEC_DRIVEN_SECTION,
        templates.SPEC_SECTION_VERSION,
        templates.REFERENCE_SPEC_LEGACY_MATCHERS
      )
    };
  } catch (err) {
    console.error('globalLayer: could not ensure the global layer:', err.message);
    return { agents: 'error', reference: 'error', error: err.message };
  }
}

module.exports = {
  init,
  ensure,
  dirPath,
  agentsPath,
  referencePath,
  renderAgents,
  renderReference,
  GLOBAL_DIR_NAME
};
