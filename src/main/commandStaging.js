/**
 * Command staging (cli-spec-command-parity).
 *
 * A CLI session asked conversationally to run a spec command can't reach
 * Frame's packaged templates inside app.asar, so Frame stages the current
 * command templates and their assets into the project itself:
 *
 *   .frame/runtime/commands/<tool>/  — the four spec.* templates,
 *                                      plan-report-template.html,
 *                                      build-implement-report.mjs
 *   .frame/bin/implement-launch.js   — the flagged-launch helper
 *
 * Staging runs on project open (WATCH_SPECS), on init/enable, and on every
 * implement dispatch; files are rewritten only when content differs so
 * repeated opens don't re-trigger watchers. Sources resolve override-first
 * (.frame/templates/commands/<tool>/) — the same precedence
 * specManager.loadCommandTemplate uses. Supersedes specManager's v2
 * stageImplementCommandFiles (same paths, superset of files).
 */

const fs = require('fs');
const path = require('path');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../shared/frameConstants');

// Packaged template roots — inside app.asar in a packaged build, plain
// directories in dev. Readable via fs either way.
const FRAME_TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const PACKAGED_COMMANDS_DIR = path.join(FRAME_TEMPLATES_DIR, 'commands');

const COMMAND_TEMPLATE_FILES = [
  'spec.new.md',
  'spec.plan.md',
  'spec.tasks.md',
  'spec.implement.md'
];
const COMMAND_ASSET_FILES = [
  'plan-report-template.html',
  'build-implement-report.mjs'
];
const IMPLEMENT_HELPER_FILE = 'implement-launch.js';

/**
 * Placeholders filled in at staging time.
 *
 * Distinct from `{project_path}` / `{slug}` and friends, which specManager
 * fills per dispatch: `{frame_global_path}` is a machine-wide location that
 * does not vary by spec or by run, so a staged template can carry the real
 * path and any reader — a CLI session that opens the file directly, not only
 * a Frame dispatch — sees something it can actually follow.
 *
 * Only the markdown templates are substituted. The assets are an HTML
 * template and a Node script whose braces mean something else entirely.
 */
const STAGED_PLACEHOLDER = 'frame_global_path';

/**
 * Pure: replace `{name}` for each key in `values`. A placeholder with no
 * value is left as written rather than blanked — a visible `{frame_global_path}`
 * is a legible bug, an empty path silently sends a reader to `/REFERENCE.md`.
 */
function substitutePlaceholders(content, values) {
  let out = content;
  for (const [key, value] of Object.entries(values || {})) {
    if (!value) continue;
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/**
 * Where the global REFERENCE lives, or '' before globalLayer is initialized
 * (which is the case in a test, and in any headless use of this module).
 */
function globalReferencePath() {
  try {
    return require('./globalLayer').referencePath();
  } catch (_) {
    return '';
  }
}

/**
 * Pure: resolve what to stage for one tool. Returns
 * [{ src, dst, executable? }] — templates and assets go to
 * .frame/runtime/commands/<tool>/ with the project override
 * (.frame/templates/commands/<tool>/<file>) winning over the packaged copy;
 * the launch helper goes to .frame/bin/ from templates/bin/ only (Frame
 * machinery, no user override). existsFn decides override presence, so
 * tests can drive resolution without a filesystem.
 */
function resolveStagingPlan(projectPath, tool, existsFn) {
  const exists = existsFn || fs.existsSync;
  const overrideDir = path.join(projectPath, FRAME_DIR, 'templates', 'commands', tool);
  const packagedDir = path.join(PACKAGED_COMMANDS_DIR, tool);
  const runtimeDir = path.join(projectPath, FRAME_DIR, 'runtime', 'commands', tool);

  const plan = [];
  for (const file of [...COMMAND_TEMPLATE_FILES, ...COMMAND_ASSET_FILES]) {
    const override = path.join(overrideDir, file);
    plan.push({
      src: exists(override) ? override : path.join(packagedDir, file),
      dst: path.join(runtimeDir, file),
      // Markdown only: the assets are an HTML template and a Node script
      // whose braces are not Frame placeholders.
      substitute: COMMAND_TEMPLATE_FILES.includes(file)
    });
  }
  plan.push({
    src: path.join(FRAME_TEMPLATES_DIR, 'bin', IMPLEMENT_HELPER_FILE),
    dst: path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, IMPLEMENT_HELPER_FILE),
    executable: true
  });
  return plan;
}

/**
 * Copy only when the destination content differs, so project-open staging
 * doesn't rewrite unchanged files (and re-trigger watchers) every time. A
 * missing source is skipped, not fatal — an empty tool dir or unbuilt helper
 * stages nothing, and a stale runtime copy is better than a crash on open.
 * (Moved here from specManager as part of retiring stageImplementCommandFiles.)
 */
function copyIfChanged(src, dst, transform) {
  let content;
  try {
    content = fs.readFileSync(src, 'utf8');
  } catch (_) {
    return false; // source not present — nothing to stage
  }
  if (typeof transform === 'function') content = transform(content);
  try {
    let existing = null;
    try { existing = fs.readFileSync(dst, 'utf8'); } catch (_) { /* new file */ }
    if (existing === content) return false;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, content, 'utf8');
    return true;
  } catch (err) {
    console.error(`commandStaging: staging ${dst} failed`, err);
    return false;
  }
}

/**
 * List the tool directories that actually ship under the packaged commands
 * root (claude-code is the only populated one today — empty dirs stage
 * nothing, so listing them is harmless).
 */
function availableTools() {
  try {
    return fs.readdirSync(PACKAGED_COMMANDS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (_) {
    return [];
  }
}

/**
 * Stage the command templates, assets and launch helper for every available
 * tool. Never throws — a staging failure must not break project open.
 */
function stageCommandFiles(projectPath) {
  if (!projectPath) return;

  // Resolved once per staging pass, not per file — it is the same path for
  // every tool and every template.
  const values = { [STAGED_PLACEHOLDER]: globalReferencePath() };
  const substitute = (content) => substitutePlaceholders(content, values);

  for (const tool of availableTools()) {
    for (const entry of resolveStagingPlan(projectPath, tool)) {
      const transform = entry.substitute ? substitute : null;
      if (copyIfChanged(entry.src, entry.dst, transform) && entry.executable) {
        try { fs.chmodSync(entry.dst, 0o755); } catch (_) { /* best effort */ }
      }
    }
  }
}

module.exports = {
  resolveStagingPlan,
  stageCommandFiles,
  copyIfChanged,
  substitutePlaceholders,
  STAGED_PLACEHOLDER,
  availableTools,
  COMMAND_TEMPLATE_FILES,
  COMMAND_ASSET_FILES,
  IMPLEMENT_HELPER_FILE,
  FRAME_TEMPLATES_DIR
};
