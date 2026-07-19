/**
 * Structure Bootstrap
 *
 * Ships the STRUCTURE.json auto-fill machinery into a user project on Frame
 * initialization. Three things happen here:
 *
 *   1. Copy scripts/update-structure.js + scripts/find-module.js into
 *      .frame/bin/ so the project carries its own parser. Same code as
 *      Frame's own repo; the only portability change is reading
 *      FRAME_PROJECT_ROOT from env.
 *
 *   2. Install a pre-commit hook that runs the parser on staged changes.
 *      Detects existing hook setups (husky, lefthook, vanilla custom) and
 *      either appends to them idempotently or surfaces manual instructions —
 *      we never overwrite the user's existing hook content.
 *
 *   3. Run one full-mode parse so STRUCTURE.json is populated immediately
 *      after init, not on the next commit. Only runs when STRUCTURE.json was
 *      just created by Frame (we don't touch a pre-existing one).
 *
 * Failures in any step are non-fatal: a project must successfully initialize
 * even if hook install fails (no git, permission issues, etc.).
 */

const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { FRAME_DIR, FRAME_BIN_DIR } = require('../shared/frameConstants');
const {
  getStructureHookSnippet,
  getStructurePreCommitHookTemplate,
  FRAME_HOOK_MARKER_START,
  FRAME_HOOK_MARKER_END
} = require('../shared/frameTemplates');

// Resolve the location of Frame's bundled scripts/ folder. In dev this is
// the repo root; under electron-builder's asar the same relative path holds
// because the asar mirrors the source tree.
const SCRIPTS_SOURCE_DIR = path.join(__dirname, '..', '..', 'scripts');
const PARSER_FILES = ['update-structure.js', 'find-module.js', 'check-freshness.js', 'detect-project.js', 'intent-map.json'];

/**
 * Copy parser scripts from Frame's bundled scripts/ into the project's
 * .frame/bin/ folder. Overwrites prior copies (so updates to Frame ship the
 * latest parser to all projects on their next init).
 */
function copyParserScripts(projectPath) {
  const binDir = path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR);
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const copied = [];
  for (const file of PARSER_FILES) {
    const src = path.join(SCRIPTS_SOURCE_DIR, file);
    const dst = path.join(binDir, file);
    if (!fs.existsSync(src)) {
      // Bundled script missing — log and continue. Not fatal.
      console.warn(`[frame] parser script missing at ${src}, skipping`);
      continue;
    }
    // intent-map.json is agent-editable per-project curation: seed a skeleton
    // once (Frame's own curation would list modules the project doesn't
    // have), never overwrite an existing copy. Scripts always ship the latest.
    if (file === 'intent-map.json') {
      if (!fs.existsSync(dst)) {
        try {
          fs.writeFileSync(dst, JSON.stringify({
            _comment: 'Curated concept → modules map for STRUCTURE.json\'s intentIndex. Agent-editable: add a concept when a feature spans files whose names don\'t say what they do, and synonyms for the words people actually search. Format: { "<concept>": { "modules": ["main/fooManager", ...], "synonyms": ["bar", ...] } }. Module keys must match STRUCTURE.json (missing ones are skipped at generation).'
          }, null, 2) + '\n');
          copied.push(file);
        } catch (err) {
          console.warn(`[frame] failed to seed ${file}: ${err.message}`);
        }
      }
      continue;
    }
    try {
      fs.copyFileSync(src, dst);
      if (file.endsWith('.js')) {
        // Make executable so `./` invocation works, though we always call via `node`.
        fs.chmodSync(dst, 0o755);
      }
      copied.push(file);
    } catch (err) {
      console.warn(`[frame] failed to copy ${file}: ${err.message}`);
    }
  }

  // Ship the per-language extractors (scripts/lang/*) alongside the parser —
  // update-structure.js requires them relative to its own location.
  const langSrcDir = path.join(SCRIPTS_SOURCE_DIR, 'lang');
  if (fs.existsSync(langSrcDir)) {
    const langDstDir = path.join(binDir, 'lang');
    if (!fs.existsSync(langDstDir)) {
      fs.mkdirSync(langDstDir, { recursive: true });
    }
    for (const file of fs.readdirSync(langSrcDir).filter((f) => f.endsWith('.js'))) {
      try {
        fs.copyFileSync(path.join(langSrcDir, file), path.join(langDstDir, file));
        copied.push(`lang/${file}`);
      } catch (err) {
        console.warn(`[frame] failed to copy lang/${file}: ${err.message}`);
      }
    }
  }
  return copied;
}

/**
 * Detect what kind of pre-commit hook setup the project has.
 *
 * Returns one of:
 *   - 'no-git'   — no .git/ folder, hook install impossible
 *   - 'husky'    — .husky/ folder exists and core.hooksPath points to it
 *   - 'lefthook' — lefthook.yml present in project root
 *   - 'custom'   — .git/hooks/pre-commit exists with non-default content
 *   - 'vanilla'  — no existing hook (or only the .sample), safe to write
 */
async function detectHookSetup(projectPath) {
  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return 'no-git';
  }

  // Lefthook check — config file in project root
  if (
    fs.existsSync(path.join(projectPath, 'lefthook.yml')) ||
    fs.existsSync(path.join(projectPath, 'lefthook.yaml'))
  ) {
    return 'lefthook';
  }

  // Husky check — .husky/ folder + core.hooksPath
  const huskyDir = path.join(projectPath, '.husky');
  if (fs.existsSync(huskyDir) && fs.statSync(huskyDir).isDirectory()) {
    try {
      const hooksPath = await new Promise((resolve, reject) => {
        exec('git config --get core.hooksPath', {
          cwd: projectPath,
          encoding: 'utf8',
          timeout: 5000
        }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
      });
      if (hooksPath && hooksPath.replace(/\/$/, '').endsWith('.husky')) {
        return 'husky';
      }
    } catch (_) {
      // git config returned non-zero (not set) — fall through
    }
    // Folder exists but hooksPath not set; treat as husky-in-progress
    return 'husky';
  }

  // Vanilla check — does .git/hooks/pre-commit exist with real content?
  const hookFile = path.join(gitDir, 'hooks', 'pre-commit');
  if (fs.existsSync(hookFile)) {
    try {
      const content = fs.readFileSync(hookFile, 'utf8');
      // Git's default samples end in .sample; if a bare pre-commit file
      // exists with non-trivial content, treat it as custom.
      if (content.trim().length > 0) {
        return 'custom';
      }
    } catch (_) {
      // Can't read — treat as custom to be safe (don't overwrite blind)
      return 'custom';
    }
  }

  return 'vanilla';
}

/**
 * Check if our managed snippet is already present in a hook file.
 */
function hasFrameSnippet(hookFilePath) {
  try {
    const content = fs.readFileSync(hookFilePath, 'utf8');
    return content.includes(FRAME_HOOK_MARKER_START);
  } catch (_) {
    return false;
  }
}

/**
 * Install (or append) the pre-commit hook based on detected setup.
 *
 * Returns: { status, message, manualInstructions? }
 *   status: 'installed' | 'appended' | 'already-installed' | 'skipped-custom'
 *           | 'skipped-no-git' | 'skipped-lefthook' | 'error'
 *   manualInstructions: string shown to user when we can't auto-install
 */
async function installPreCommitHook(projectPath) {
  const setup = await detectHookSetup(projectPath);

  if (setup === 'no-git') {
    return {
      status: 'skipped-no-git',
      message: 'Not a git repository — pre-commit hook not installed. STRUCTURE.json will only update via manual rescan.'
    };
  }

  if (setup === 'lefthook') {
    // Don't auto-edit lefthook.yml — it's structured config we'd risk
    // breaking. Surface manual instructions instead.
    return {
      status: 'skipped-lefthook',
      message: 'Lefthook detected — add this to your lefthook.yml manually:',
      manualInstructions: [
        'pre-commit:',
        '  commands:',
        '    frame-structure:',
        '      run: node .frame/bin/update-structure.js --changed && git add STRUCTURE.json',
        '      env:',
        '        FRAME_PROJECT_ROOT: "{root}"'
      ].join('\n')
    };
  }

  if (setup === 'husky') {
    const huskyHook = path.join(projectPath, '.husky', 'pre-commit');
    return appendToHookFile(huskyHook, /* createIfMissing */ true, /* needsShebang */ true);
  }

  if (setup === 'custom') {
    // Existing custom vanilla hook — don't auto-append in v1. Show what to add.
    return {
      status: 'skipped-custom',
      message: 'Existing pre-commit hook detected — add this snippet to .git/hooks/pre-commit manually:',
      manualInstructions: getStructureHookSnippet()
    };
  }

  // setup === 'vanilla' — safe to write a fresh hook file
  const hookFile = path.join(projectPath, '.git', 'hooks', 'pre-commit');
  try {
    fs.mkdirSync(path.dirname(hookFile), { recursive: true });
    fs.writeFileSync(hookFile, getStructurePreCommitHookTemplate(), { mode: 0o755 });
    return { status: 'installed', message: 'Pre-commit hook installed at .git/hooks/pre-commit' };
  } catch (err) {
    return { status: 'error', message: `Failed to install hook: ${err.message}` };
  }
}

/**
 * Append the Frame snippet to an existing hook file (husky case).
 */
function appendToHookFile(hookPath, createIfMissing, needsShebang) {
  try {
    if (!fs.existsSync(hookPath)) {
      if (!createIfMissing) {
        return { status: 'error', message: `Hook file not found: ${hookPath}` };
      }
      // Create with shebang + snippet
      const header = needsShebang ? '#!/bin/sh\n' : '';
      fs.mkdirSync(path.dirname(hookPath), { recursive: true });
      fs.writeFileSync(hookPath, header + '\n' + getStructureHookSnippet(), { mode: 0o755 });
      return { status: 'installed', message: `Pre-commit hook created at ${path.relative(path.dirname(path.dirname(hookPath)), hookPath)}` };
    }

    if (hasFrameSnippet(hookPath)) {
      return { status: 'already-installed', message: 'Frame structure snippet already present in hook' };
    }

    // Append snippet to existing content
    const existing = fs.readFileSync(hookPath, 'utf8');
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    fs.appendFileSync(hookPath, separator + getStructureHookSnippet());
    // Ensure executable bit is set
    try { fs.chmodSync(hookPath, 0o755); } catch (_) { /* best effort */ }
    return { status: 'appended', message: `Frame snippet appended to ${path.basename(hookPath)}` };
  } catch (err) {
    return { status: 'error', message: `Failed to append to hook: ${err.message}` };
  }
}

/**
 * Run the parser in full mode once so STRUCTURE.json gets populated with
 * the project's existing files. Spawns node asynchronously (same 30s kill
 * timeout as before) with the FRAME_PROJECT_ROOT env var so the bundled
 * script targets the right repo — the main event loop stays free while the
 * child scans.
 *
 * Returns: Promise<{ status, message }>
 */
function runInitialFullScan(projectPath) {
  const parserPath = path.join(projectPath, FRAME_DIR, FRAME_BIN_DIR, 'update-structure.js');
  if (!fs.existsSync(parserPath)) {
    return Promise.resolve({ status: 'error', message: 'Parser script not found at .frame/bin/update-structure.js' });
  }

  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn('node', [parserPath], {
      cwd: projectPath,
      env: { ...process.env, FRAME_PROJECT_ROOT: projectPath },
      timeout: 30000
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString();
    });
    child.on('error', (err) => {
      resolve({ status: 'error', message: `Initial scan failed: ${err.message}` });
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ status: 'ok', message: 'Initial STRUCTURE.json scan complete' });
      } else {
        resolve({
          status: 'error',
          message: `Initial scan exited with code ${code}: ${stderr.slice(0, 200)}`
        });
      }
    });
  });
}

/**
 * Top-level bootstrap orchestrator. Called from frameProject.js after the
 * standard init steps. structureWasCreated tells us whether THIS init run
 * created STRUCTURE.json (vs. preserving an existing one) — we only do the
 * initial scan when we created the file, never overwriting user content.
 */
async function bootstrapStructure(projectPath, structureWasCreated) {
  const summary = {
    copied: [],
    hook: null,
    initialScan: null
  };

  summary.copied = copyParserScripts(projectPath);
  summary.hook = await installPreCommitHook(projectPath);

  if (structureWasCreated) {
    summary.initialScan = await runInitialFullScan(projectPath);
  } else {
    summary.initialScan = {
      status: 'skipped-existing',
      message: 'STRUCTURE.json existed before init — preserved as-is, no auto-scan'
    };
  }

  return summary;
}

module.exports = {
  bootstrapStructure,
  copyParserScripts,
  detectHookSetup,
  installPreCommitHook,
  runInitialFullScan
};
