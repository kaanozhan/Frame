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
 *   node .frame/bin/implement-launch.js <slug> --full-auto
 *
 * `--full-auto` (full-auto-spec-flow) launches the whole rest of the spec
 * instead: it records `flow_mode: "full-auto"` beside the autonomous mode,
 * stages the plan, tasks and implement prompts plus the `spec.auto` prompt
 * that runs them in order, and starts the session on `spec.auto`.
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
const REPORT_GENERATOR_REL = path.posix.join(FRAME_DIR, 'runtime', 'commands', 'claude-code', 'build-implement-report.mjs');

// Template resolution order: the project's own override first, then the copy
// Frame staged into runtime/commands/ on project open / implement dispatch.
const TEMPLATE_OVERRIDE_REL = path.posix.join(FRAME_DIR, 'templates', 'commands', 'claude-code', 'spec.implement.md');
const TEMPLATE_STAGED_REL = path.posix.join(FRAME_DIR, 'runtime', 'commands', 'claude-code', 'spec.implement.md');

// Full auto (full-auto-spec-flow): the phase prompts spec.auto reads in turn,
// keyed by the variable that names each one inside spec.auto.md — the same
// names specManager.stagePhasePrompts fills.
const AUTO_PHASES = [
  ['plan_prompt_path', 'spec.plan'],
  ['tasks_prompt_path', 'spec.tasks'],
  ['implement_prompt_path', 'spec.implement']
];
const REPORT_TEMPLATE_REL = path.posix.join(FRAME_DIR, 'runtime', 'commands', 'claude-code', 'plan-report-template.html');
// Copy of scripts/toolVocabulary.js's Claude Code ask_mechanism — the one
// dialect phrase the phase templates use outside a branch full auto skips.
const ASK_MECHANISM = 'the `AskUserQuestion` tool';

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

// `<slug> [--full-auto]` in any order. Unknown flags are an error rather than
// a silent no-op: a typo must not launch the wrong mode with elevated flags.
function parseArgs(args) {
  const out = { slug: '', fullAuto: false, error: null };
  for (const arg of args) {
    if (arg === '--full-auto') out.fullAuto = true;
    else if (arg.startsWith('--')) out.error = `unknown option ${arg}`;
    else if (!out.slug) out.slug = arg.trim();
  }
  if (!out.slug && !out.error) out.error = 'usage: implement-launch.js <slug> [--full-auto]';
  return out;
}

// Where a staged prompt lands, per command.
function promptRelFor(slug, command) {
  return path.posix.join(FRAME_DIR, 'runtime', 'prompts', `${slug}__${command}.md`);
}

// A command's raw template: the project override, else the staged copy.
function templateCandidates(projectRoot, command) {
  return [
    path.join(projectRoot, FRAME_DIR, 'templates', 'commands', 'claude-code', `${command}.md`),
    path.join(projectRoot, FRAME_DIR, 'runtime', 'commands', 'claude-code', `${command}.md`)
  ];
}

// The variables a full-auto run's prompts are filled with. Mirrors what
// specManager.getCommandPrompt supplies for Claude Code.
function autoPromptVars({ projectRoot, slug, title, tasksPath }) {
  const vars = {
    project_path: projectRoot,
    slug,
    title,
    tasks_path: tasksPath,
    tool_id: 'claude-code',
    ask_mechanism: ASK_MECHANISM,
    report_template_path: REPORT_TEMPLATE_REL,
    report_generator_path: REPORT_GENERATOR_REL
  };
  for (const [key, command] of AUTO_PHASES) vars[key] = promptRelFor(slug, command);
  return vars;
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

// Full auto records both modes: flow_mode for every later dispatch, and the
// autonomous implement mode the run's implement phase resolves.
function recordFullAutoMode(projectRoot, slug) {
  const statusPath = path.join(projectRoot, STATUS_REL(slug));
  const status = readJson(statusPath);
  if (!status) return null;
  status.flow_mode = 'full-auto';
  status.implement_mode = 'autonomous';
  status.updated_at = new Date().toISOString();
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', 'utf8');
  return status;
}

// Task state lives in the main checkout's tasks.json, also when this runs in
// a Frame workspace (a linked worktree).
function mainTasksPath(projectRoot) {
  try {
    const out = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: projectRoot, encoding: 'utf8' });
    const dir = (out.stdout || '').trim();
    if (out.status === 0 && dir && path.basename(dir) === '.git') {
      return path.join(path.dirname(dir), FRAME_DIR, 'tasks.json');
    }
  } catch (_) { /* not a git checkout */ }
  return path.join(projectRoot, FRAME_DIR, 'tasks.json');
}

// Stage the three phase prompts and spec.auto's. Returns the auto prompt's
// relative path, or an error message naming the missing template.
function stageFullAuto(projectRoot, slug, title) {
  const vars = autoPromptVars({ projectRoot, slug, title, tasksPath: mainTasksPath(projectRoot) });
  for (const command of [...AUTO_PHASES.map(([, c]) => c), 'spec.auto']) {
    const src = templateCandidates(projectRoot, command).find((p) => fs.existsSync(p));
    if (!src) return { error: `no ${command} template on disk — open this project in Frame once so it stages the templates, then retry` };
    const abs = path.join(projectRoot, promptRelFor(slug, command));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, interpolate(fs.readFileSync(src, 'utf8'), vars), 'utf8');
  }
  return { relPath: promptRelFor(slug, 'spec.auto') };
}

function writePermissions(projectRoot) {
  const config = readJson(path.join(projectRoot, FRAME_DIR, CONFIG_FILE));
  const verification = resolveVerificationCommand(config);
  const absPath = path.join(projectRoot, PERMISSIONS_REL);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(buildPermissions(verification), null, 2) + '\n', 'utf8');
  return absPath;
}

function fail(message) {
  process.stderr.write(`implement-launch: ${message}\n`);
  return 1;
}

function main(argv) {
  const parsed = parseArgs(argv.slice(2));
  if (parsed.error) return fail(parsed.error);
  const { slug } = parsed;

  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) return fail('no .frame/ found from the current directory — run this from inside a Frame project');

  const specDir = path.join(projectRoot, FRAME_DIR, 'specs', slug);
  if (!fs.existsSync(specDir)) return fail(`spec "${slug}" not found under .frame/specs/`);

  if (parsed.fullAuto) {
    const status = recordFullAutoMode(projectRoot, slug);
    if (!status) return fail(`could not read ${STATUS_REL(slug)} — is this a valid spec?`);
    const settings = writePermissions(projectRoot);
    const staged = stageFullAuto(projectRoot, slug, status.title || slug);
    if (staged.error) return fail(staged.error);
    return launch(projectRoot, buildLaunchArgs(settings, staged.relPath));
  }

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

  return launch(projectRoot, buildLaunchArgs(settingsAbsPath, PROMPT_REL(slug)));
}

function launch(projectRoot, args) {
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
  parseArgs,
  promptRelFor,
  templateCandidates,
  autoPromptVars,
  AUTO_PHASES,
  IMPLEMENT_ALLOW,
  IMPLEMENT_DENY,
  REPORT_GENERATOR_REL,
  TEMPLATE_OVERRIDE_REL,
  TEMPLATE_STAGED_REL
};
