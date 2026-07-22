#!/usr/bin/env node
/**
 * Orientation Eval Runner — measures whether Frame's context actually helps.
 *
 * For each task × arm, creates an ephemeral git worktree at the suite's
 * pinned commit, strips the Frame context in the `bare` arm, runs the agent
 * headless, and captures the transcript, the produced diff, and the
 * successCheck result under scripts/eval/results/. Scoring happens
 * separately in score.js — this file only produces raw artifacts.
 *
 * Usage:
 *   node scripts/eval/run-eval.js                     # all tasks, both arms
 *   node scripts/eval/run-eval.js --task <id>         # one task
 *   node scripts/eval/run-eval.js --arm frame|bare    # one arm
 *   node scripts/eval/run-eval.js --timeout 600       # seconds per run (default 600)
 *   node scripts/eval/run-eval.js --out <dir>         # results dir override
 *   node scripts/eval/run-eval.js --hooks             # frame arm runs with spec-knowledge hooks (injected-vs-not comparison)
 *
 * Agent CLI is configurable so other tools can slot in:
 *   FRAME_EVAL_AGENT       binary (default: claude)
 *   FRAME_EVAL_AGENT_ARGS  space-separated flags
 *     (default: --output-format stream-json --verbose --dangerously-skip-permissions)
 *   The prompt is always appended as: -p "<prompt>"
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SUITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'tasks.json'), 'utf-8'));

// Files whose absence defines the `bare` arm: everything Frame injects or
// instructs an agent to read, plus the lookup tool itself.
const FRAME_CONTEXT_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'STRUCTURE.json',
  'PROJECT_NOTES.md',
  'tasks.json',
  'scripts/find-module.js',
  '.frame/docs/REFERENCE.md'
];

const AGENT_CMD = process.env.FRAME_EVAL_AGENT || 'claude';
const AGENT_ARGS = (process.env.FRAME_EVAL_AGENT_ARGS ||
  '--output-format stream-json --verbose --dangerously-skip-permissions'
).split(' ').filter(Boolean);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    task: get('--task'),
    arm: get('--arm'),
    timeoutSec: Number(get('--timeout')) || 600,
    out: get('--out'),
    // --hooks: frame-arm worktrees get the spec-knowledge hooks
    // (.claude/settings.json + freshly built index + hint scripts), so runs
    // measure injected vs non-injected agent behavior. Bare arm never hooks.
    hooks: args.includes('--hooks')
  };
}

function git(cmd, cwd) {
  return execSync(cmd, { cwd: cwd || ROOT_DIR, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

// Frame-arm hook setup for --hooks runs: current hint scripts + a fresh
// index built inside the worktree (the pinned commit predates the layer),
// plus the hook registration. Best-effort — a failure degrades the run to
// un-hooked rather than aborting it.
const HOOK_SCRIPT_FILES = ['scripts/spec-index.js', 'scripts/spec-context.js', 'scripts/spec-hint.js'];

function setupHooks(wt) {
  try {
    for (const rel of HOOK_SCRIPT_FILES) {
      const dst = path.join(wt, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT_DIR, rel), dst);
    }
    const settingsDir = path.join(wt, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node scripts/spec-hint.js pre-edit' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node scripts/spec-hint.js prompt' }] }]
      }
    }, null, 2) + '\n');
    const built = spawnSync('node', [path.join(wt, 'scripts', 'spec-index.js'), '--force'], {
      cwd: wt, encoding: 'utf-8', timeout: 60000
    });
    return built.status === 0;
  } catch (e) {
    console.warn(`  (hook setup failed, running un-hooked: ${e.message})`);
    return false;
  }
}

function runOne(task, arm, resultsDir, timeoutSec, hooks) {
  const runDir = path.join(resultsDir, `${task.id}--${arm}`);
  fs.mkdirSync(runDir, { recursive: true });

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), `frame-eval-${task.id}-${arm}-`));
  console.log(`\n▶ ${task.id} [${arm}]`);

  try {
    git(`git worktree add --detach "${wt}" ${SUITE.pinnedCommit}`);

    if (arm === 'bare') {
      for (const file of FRAME_CONTEXT_FILES) {
        const p = path.join(wt, file);
        try { fs.rmSync(p, { force: true }); } catch (e) { /* symlink targets etc. */ }
      }
      // Commit the stripping so the captured diff is exactly what the agent
      // did — the removed context files must not show up as its changes.
      git('git add -A', wt);
      git('git -c user.email=eval@frame -c user.name=frame-eval commit -q --no-verify -m "strip frame context (bare arm)"', wt);
    }

    let hooksActive = false;
    if (hooks && arm === 'frame') {
      hooksActive = setupHooks(wt);
      // Commit the setup so it never shows up as agent-produced diff.
      git('git add -A', wt);
      git('git -c user.email=eval@frame -c user.name=frame-eval commit -q --no-verify -m "spec-knowledge hooks (frame arm)"', wt);
    }

    // Diff base: some agents commit their own work in the worktree, which
    // would make a HEAD-relative diff empty — always diff against the sha
    // the agent started from.
    const baseSha = git('git rev-parse HEAD', wt).trim();

    const started = Date.now();
    const result = spawnSync(AGENT_CMD, [...AGENT_ARGS, '-p', task.prompt], {
      cwd: wt,
      encoding: 'utf-8',
      timeout: timeoutSec * 1000,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env }
    });
    const durationMs = Date.now() - started;
    const timedOut = result.error && result.error.code === 'ETIMEDOUT';

    fs.writeFileSync(path.join(runDir, 'transcript.jsonl'), result.stdout || '');
    fs.writeFileSync(path.join(runDir, 'stderr.log'), result.stderr || '');

    // Capture the produced diff BEFORE the successCheck runs — the check may
    // itself mutate the worktree (e.g. regenerating STRUCTURE.json).
    git('git add -A', wt);
    const diff = git(`git diff ${baseSha}`, wt);
    fs.writeFileSync(path.join(runDir, 'diff.patch'), diff);
    const changedFiles = git(`git diff ${baseSha} --name-only`, wt)
      .split('\n').filter(Boolean);

    let checkPassed = false;
    try {
      execSync(task.successCheck, { cwd: wt, stdio: 'ignore', timeout: 60000 });
      checkPassed = true;
    } catch (e) {
      checkPassed = false;
    }

    const meta = {
      task: task.id,
      arm,
      hooksActive,
      pinnedCommit: SUITE.pinnedCommit,
      agent: `${AGENT_CMD} ${AGENT_ARGS.join(' ')}`,
      exitCode: result.status,
      timedOut: Boolean(timedOut),
      durationMs,
      changedFiles,
      expectedFiles: task.expectedFiles,
      checkPassed
    };
    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

    console.log(`  ${checkPassed ? '✓ check passed' : '✗ check failed'} · ${changedFiles.length} file(s) changed · ${(durationMs / 1000).toFixed(0)}s${timedOut ? ' · TIMED OUT' : ''}`);
    return meta;
  } finally {
    try { git(`git worktree remove --force "${wt}"`); } catch (e) {
      console.warn(`  (worktree cleanup failed: ${wt})`);
    }
  }
}

function main() {
  const opts = parseArgs();

  const tasks = opts.task
    ? SUITE.tasks.filter(t => t.id === opts.task)
    : SUITE.tasks;
  if (tasks.length === 0) {
    console.error(`No task matches "${opts.task}". Available: ${SUITE.tasks.map(t => t.id).join(', ')}`);
    process.exit(1);
  }

  const arms = opts.arm ? [opts.arm] : ['frame', 'bare'];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultsDir = opts.out || path.join(__dirname, 'results', `run-${stamp}`);
  fs.mkdirSync(resultsDir, { recursive: true });

  console.log(`Suite: ${tasks.length} task(s) × ${arms.length} arm(s) @ ${SUITE.pinnedCommit.slice(0, 7)}`);
  console.log(`Agent: ${AGENT_CMD} ${AGENT_ARGS.join(' ')}`);
  console.log(`Results: ${path.relative(ROOT_DIR, resultsDir)}`);

  const all = [];
  for (const task of tasks) {
    for (const arm of arms) {
      try {
        all.push(runOne(task, arm, resultsDir, opts.timeoutSec, opts.hooks));
      } catch (e) {
        console.error(`  ✗ ${task.id} [${arm}] crashed: ${e.message}`);
        all.push({ task: task.id, arm, crashed: true, error: e.message });
      }
    }
  }

  fs.writeFileSync(path.join(resultsDir, 'runs.json'), JSON.stringify(all, null, 2) + '\n');
  console.log(`\nDone. Score with: node scripts/eval/score.js ${path.relative(ROOT_DIR, resultsDir)}`);
}

main();
