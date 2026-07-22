#!/usr/bin/env node
/**
 * Frame implement-launch helper.
 *
 * The single source of the flagged autonomous launch line, runnable with the
 * Frame app closed. Given a spec slug it records the autonomous mode, writes
 * the implement permission file, stages and interpolates the implement prompt
 * from the templates Frame already copied to disk, and execs the CLI with the
 * permission flags plus the read-this-file instruction — so the new session
 * reaches its first task with zero typed input.
 *
 *   node .frame/bin/implement-launch.js <slug>
 *
 * Self-contained on purpose: `.frame/bin` scripts can't read app.asar, so the
 * allow/deny rule sets and the verification-command resolution are carried
 * here as copies of src/main/specManager.js's (unchanged by this spec — keep
 * them in sync if that file's sets change). Everything above main() is pure
 * (no filesystem, no exec) so it can be tested directly.
 *
 * Node 18, no dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ─── Constants (mirror of specManager.js) ─────────────────────

const FRAME_DIR = '.frame';
const CONFIG_FILE = 'config.json';
const STATUS_REL = (slug) => path.posix.join(FRAME_DIR, 'specs', slug, 'status.json');
const PERMISSIONS_REL = path.posix.join(FRAME_DIR, 'implement-permissions.json');
const PROMPT_REL = (slug) => path.posix.join(FRAME_DIR, 'runtime', 'prompts', `${slug}__spec.implement.md`);
const REPORT_GENERATOR_REL = path.posix.join(FRAME_DIR, 'runtime', 'assets', 'build-implement-report.mjs');

// Template resolution order: the project's own override first, then the copy
// Frame staged into runtime/commands/ on project open / implement dispatch.
const TEMPLATE_OVERRIDE_REL = path.posix.join(FRAME_DIR, 'templates', 'commands', 'claude-code', 'spec.implement.md');
const TEMPLATE_STAGED_REL = path.posix.join(FRAME_DIR, 'runtime', 'commands', 'claude-code', 'spec.implement.md');
const GENERATOR_STAGED_REL = path.posix.join(FRAME_DIR, 'runtime', 'commands', 'claude-code', 'build-implement-report.mjs');

// Pushing and history rewrites other than the mode's own `commit --amend`.
const IMPLEMENT_DENY = [
  'Bash(git push)',
  'Bash(git push *)',
  'Bash(git reset --hard *)',
  'Bash(git rebase *)',
  'Bash(git filter-branch *)',
  'Bash(git filter-repo *)',
  'Bash(git reflog expire *)',
  'Bash(git update-ref -d *)'
];

// Editing plus the git plumbing the loop needs. `Edit` covers Write/NotebookEdit.
const IMPLEMENT_ALLOW = [
  'Edit',
  'Read',
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git status*)',
  'Bash(git diff*)',
  'Bash(git show *)',
  'Bash(git log *)',
  'Bash(git rev-parse *)'
];

// ─── Pure helpers ─────────────────────────────────────────────

// {key} → vars[key]; unknown placeholders are left intact (same contract as
// specManager.interpolate).
function interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (m, key) => (vars[key] != null ? String(vars[key]) : m));
}

// The project's own check, in descending order of what actually verifies a
// change. Blank/absent → null (the run proceeds without one and says so).
function resolveVerificationCommand(config) {
  const commands = (config && config.project && config.project.commands) || {};
  for (const key of ['test', 'lint', 'build']) {
    const value = typeof commands[key] === 'string' ? commands[key].trim() : '';
    if (value) return value;
  }
  return null;
}

// The implement-permissions.json body. When a verification command exists,
// both its exact and prefixed forms resolve as rules (the space before `*`
// is load-bearing).
function buildPermissions(verification) {
  const allow = [...IMPLEMENT_ALLOW];
  if (verification) {
    allow.push(`Bash(${verification})`, `Bash(${verification} *)`);
  }
  return { permissions: { allow, deny: [...IMPLEMENT_DENY] } };
}

// The CLI launch line: the permission flags plus the short read-this-file
// instruction as the initial prompt argument.
function buildLaunchArgs(settingsAbsPath, promptRelPath) {
  return [
    '--settings', settingsAbsPath,
    '--permission-mode', 'auto',
    `Read ${promptRelPath} and follow its instructions exactly.`
  ];
}

// Raw template path: override → staged. `existsFn` is injectable for tests.
// Returns the chosen absolute path, or null when neither is present.
function resolveRawTemplatePath(projectRoot, existsFn = fs.existsSync) {
  const override = path.join(projectRoot, TEMPLATE_OVERRIDE_REL);
  if (existsFn(override)) return override;
  const staged = path.join(projectRoot, TEMPLATE_STAGED_REL);
  if (existsFn(staged)) return staged;
  return null;
}

// ─── Impure: filesystem + exec ────────────────────────────────

// Walk up from a starting dir to the nearest ancestor that holds a .frame/
// directory. Returns that dir, or null.
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, FRAME_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

// Merge implement_mode: autonomous into the spec's status.json, preserving
// every other key.
function recordAutonomousMode(projectRoot, slug) {
  const statusPath = path.join(projectRoot, STATUS_REL(slug));
  const status = readJson(statusPath);
  if (!status) return false;
  status.implement_mode = 'autonomous';
  status.updated_at = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf8');
  return true;
}

function writePermissions(projectRoot) {
  const config = readJson(path.join(projectRoot, FRAME_DIR, CONFIG_FILE));
  const verification = resolveVerificationCommand(config);
  const absPath = path.join(projectRoot, PERMISSIONS_REL);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(buildPermissions(verification), null, 2) + '\n', 'utf8');
  return absPath;
}

// Ensure the report generator sits at runtime/assets/, copying the staged
// runtime/commands/ copy if Frame hasn't put it there yet. Best-effort — a
// missing generator only costs the report, never the run.
function ensureReportGenerator(projectRoot) {
  const dst = path.join(projectRoot, REPORT_GENERATOR_REL);
  if (fs.existsSync(dst)) return;
  const staged = path.join(projectRoot, GENERATOR_STAGED_REL);
  if (!fs.existsSync(staged)) return;
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(staged, dst);
  } catch (_) { /* best effort */ }
}

function fail(message) {
  process.stderr.write(`implement-launch: ${message}\n`);
  return 1;
}

function main(argv) {
  const slug = (argv[2] || '').trim();
  if (!slug) return fail('usage: implement-launch.js <slug>');

  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) return fail('no .frame/ found from the current directory — run this from inside a Frame project');

  const specDir = path.join(projectRoot, FRAME_DIR, 'specs', slug);
  if (!fs.existsSync(specDir)) return fail(`spec "${slug}" not found under .frame/specs/`);

  // Record autonomous first, so either entry path finds the mode.
  if (!recordAutonomousMode(projectRoot, slug)) {
    return fail(`could not read ${STATUS_REL(slug)} — is this a valid spec?`);
  }

  const settingsAbsPath = writePermissions(projectRoot);

  const templatePath = resolveRawTemplatePath(projectRoot);
  if (!templatePath) {
    return fail('no implement template on disk — open this project in Frame once so it stages the templates, then retry');
  }

  const raw = fs.readFileSync(templatePath, 'utf8');
  const prompt = interpolate(raw, {
    project_path: projectRoot,
    slug,
    report_generator_path: REPORT_GENERATOR_REL
  });

  const promptAbs = path.join(projectRoot, PROMPT_REL(slug));
  fs.mkdirSync(path.dirname(promptAbs), { recursive: true });
  fs.writeFileSync(promptAbs, prompt, 'utf8');

  ensureReportGenerator(projectRoot);

  const args = buildLaunchArgs(settingsAbsPath, PROMPT_REL(slug));
  const result = spawnSync('claude', args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      return fail('the `claude` CLI is not on your PATH — install it or open the project in Frame instead');
    }
    return fail(`could not launch claude — ${result.error.message}`);
  }
  return typeof result.status === 'number' ? result.status : 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  interpolate,
  resolveVerificationCommand,
  buildPermissions,
  buildLaunchArgs,
  resolveRawTemplatePath,
  findProjectRoot,
  IMPLEMENT_ALLOW,
  IMPLEMENT_DENY,
  REPORT_GENERATOR_REL,
  TEMPLATE_OVERRIDE_REL,
  TEMPLATE_STAGED_REL
};
