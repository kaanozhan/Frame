#!/usr/bin/env node
/**
 * Orientation Eval Scorer — deterministic scoring of run-eval.js artifacts.
 * No LLM judging: everything is computed from meta.json + transcript.jsonl.
 *
 * Metrics per task×arm, aggregated per arm:
 *   - first-try success  — the task's successCheck passed on the produced diff
 *   - wrong-file edits   — changed files outside expectedFiles (meta files
 *                          like STRUCTURE.json excluded: agents legitimately
 *                          regenerate them alongside a change)
 *   - search effort      — Grep/Glob/grep-ish-Bash tool calls before the
 *                          first Edit/Write
 *   - turns, tokens, duration — from the transcript
 *
 * Usage:
 *   node scripts/eval/score.js <resultsDir>           # summary table
 *   node scripts/eval/score.js <resultsDir> --json    # machine-readable
 */

const fs = require('fs');
const path = require('path');

const META_FILES = new Set(['STRUCTURE.json', 'tasks.json', 'PROJECT_NOTES.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const SEARCHY_BASH = /\b(grep|rg|find|fd|ag)\b/;

function scoreTranscript(file) {
  const stats = { searchBeforeFirstEdit: 0, toolCalls: 0, turns: 0, inputTokens: 0, outputTokens: 0 };
  if (!fs.existsSync(file)) return stats;

  let sawEdit = false;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch (e) { continue; }

    if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
      stats.turns++;
      for (const block of event.message.content) {
        if (block.type !== 'tool_use') continue;
        stats.toolCalls++;

        const isEdit = EDIT_TOOLS.has(block.name);
        const isSearch = SEARCH_TOOLS.has(block.name) ||
          (block.name === 'Bash' && block.input && SEARCHY_BASH.test(String(block.input.command || '')));

        if (isEdit) sawEdit = true;
        if (isSearch && !sawEdit) stats.searchBeforeFirstEdit++;
      }
    }

    if (event.type === 'result' && event.usage) {
      stats.inputTokens = event.usage.input_tokens || 0;
      stats.outputTokens = event.usage.output_tokens || 0;
    }
  }
  return stats;
}

function scoreRun(runDir) {
  const metaPath = path.join(runDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  const expected = new Set(meta.expectedFiles || []);
  const wrongFiles = (meta.changedFiles || [])
    .filter(f => !expected.has(f) && !META_FILES.has(f));

  return {
    task: meta.task,
    arm: meta.arm,
    pass: Boolean(meta.checkPassed) && !meta.timedOut,
    timedOut: Boolean(meta.timedOut),
    wrongFiles,
    changedCount: (meta.changedFiles || []).length,
    durationMs: meta.durationMs || 0,
    ...scoreTranscript(path.join(runDir, 'transcript.jsonl'))
  };
}

function aggregate(runs) {
  const n = runs.length;
  const sum = (fn) => runs.reduce((a, r) => a + fn(r), 0);
  const avg = (fn) => n ? sum(fn) / n : 0;
  return {
    tasks: n,
    passed: runs.filter(r => r.pass).length,
    passRate: n ? runs.filter(r => r.pass).length / n : 0,
    tasksWithWrongFileEdits: runs.filter(r => r.wrongFiles.length > 0).length,
    totalWrongFileEdits: sum(r => r.wrongFiles.length),
    avgSearchBeforeFirstEdit: avg(r => r.searchBeforeFirstEdit),
    avgToolCalls: avg(r => r.toolCalls),
    avgTurns: avg(r => r.turns),
    avgDurationSec: avg(r => r.durationMs / 1000),
    totalOutputTokens: sum(r => r.outputTokens)
  };
}

function main() {
  const args = process.argv.slice(2);
  const resultsDir = args.find(a => !a.startsWith('--'));
  if (!resultsDir || !fs.existsSync(resultsDir)) {
    console.error('Usage: node scripts/eval/score.js <resultsDir> [--json]');
    process.exit(1);
  }

  const runs = fs.readdirSync(resultsDir)
    .filter(d => fs.existsSync(path.join(resultsDir, d, 'meta.json')))
    .map(d => scoreRun(path.join(resultsDir, d)))
    .filter(Boolean);

  if (runs.length === 0) {
    console.error(`No scored runs found in ${resultsDir}`);
    process.exit(1);
  }

  const byArm = {};
  for (const run of runs) {
    (byArm[run.arm] = byArm[run.arm] || []).push(run);
  }
  const summary = {};
  for (const [arm, armRuns] of Object.entries(byArm)) {
    summary[arm] = aggregate(armRuns);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({ summary, runs }, null, 2));
    return;
  }

  const arms = Object.keys(summary).sort(); // bare, frame
  const rows = [
    ['metric', ...arms],
    ['tasks', ...arms.map(a => summary[a].tasks)],
    ['first-try success', ...arms.map(a => `${summary[a].passed}/${summary[a].tasks} (${(summary[a].passRate * 100).toFixed(0)}%)`)],
    ['tasks w/ wrong-file edits', ...arms.map(a => summary[a].tasksWithWrongFileEdits)],
    ['total wrong-file edits', ...arms.map(a => summary[a].totalWrongFileEdits)],
    ['avg searches before 1st edit', ...arms.map(a => summary[a].avgSearchBeforeFirstEdit.toFixed(1))],
    ['avg tool calls', ...arms.map(a => summary[a].avgToolCalls.toFixed(1))],
    ['avg turns', ...arms.map(a => summary[a].avgTurns.toFixed(1))],
    ['avg duration (s)', ...arms.map(a => summary[a].avgDurationSec.toFixed(0))],
    ['total output tokens', ...arms.map(a => summary[a].totalOutputTokens)]
  ];

  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  for (const [ri, row] of rows.entries()) {
    console.log(row.map((cell, i) => String(cell).padEnd(widths[i] + 2)).join(''));
    if (ri === 0) console.log(widths.map(w => '-'.repeat(w + 2)).join(''));
  }

  // Per-task detail for anything that failed or edited wrong files
  const problems = runs.filter(r => !r.pass || r.wrongFiles.length > 0);
  if (problems.length > 0) {
    console.log('\nDetails (failed or wrong-file):');
    for (const r of problems) {
      const parts = [];
      if (!r.pass) parts.push(r.timedOut ? 'TIMEOUT' : 'check failed');
      if (r.wrongFiles.length) parts.push(`wrong: ${r.wrongFiles.join(', ')}`);
      console.log(`  ${r.task} [${r.arm}] — ${parts.join(' · ')}`);
    }
  }
}

main();
