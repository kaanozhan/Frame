#!/usr/bin/env node
/**
 * Spec command hint — Claude Code hook entry
 *
 * Makes a spec command entered from the terminal behave the way the button
 * does. Frame's UI path (`buildSpecCommandFile` in specManager.js) resolves
 * the spec, interpolates the current command template, writes it to
 * `.frame/runtime/prompts/` and hands the agent one sentence: *"Read <path>
 * and follow its instructions exactly."* Nothing in that chain fires for a
 * CLI session, so the same command typed in a terminal reached only the
 * docs, and the flow was improvised.
 *
 * What that costs is concrete, not theoretical: `spec.plan`'s Stage 2 is a
 * decision gate that resolves business and technical forks **with the user**
 * through the AskUserQuestion tool, and records each answer under
 * `### Resolved plan-time decisions`. It exists only inside the template
 * (17 KB), never in REFERENCE.md. A plan improvised without it also lacks
 * `## Footprint`, which is what orchestration's collision detection reads.
 *
 * Why this writes a file rather than injecting the template: the host inlines
 * a hook's additionalContext up to 2000 characters and spills the rest to a
 * file, and specManager already documents the sibling constraint — Claude
 * Code's terminal collapses large pastes into `[Pasted text #N]`. Both point
 * the same way, so this hook does exactly what the button does: materialise
 * the prompt on disk, hand over a short pointer.
 *
 * Scope. `spec.plan`, `spec.tasks` and `spec.implement` act on a spec that
 * already exists, so the target can be resolved and the prompt written.
 * `spec.new` has no target yet — the protocol's own step 1 treats it
 * differently — so it gets the template path and nothing more.
 *
 * Hard contract (same as scripts/spec-hint.js):
 *   - NEVER block, NEVER break: any failure → exit 0, empty output.
 *   - Ambiguity is handed to the agent, never guessed: zero or several
 *     candidate specs → say which, and let it ask.
 *   - No imports from siblings; `catalogLines` below is a deliberate copy of
 *     the six-line formatter in spec-index.js, not a require of the builder.
 *
 * Drift guard: test/spec-command-hint.test.js asserts this produces the
 * byte-identical prompt specManager's own `getCommandPrompt` produces, so the
 * duplication cannot quietly diverge from the path the button takes.
 *
 * Dependency-free plain node; ships to user projects' .frame/bin/.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPORTED = ['spec.new', 'spec.plan', 'spec.tasks', 'spec.implement'];

// How many candidate specs a "which one?" hint may name. Chosen so the whole
// payload stays under the host's 2000-character inline ceiling even with long
// slugs and titles; test/spec-command-hint.test.js asserts it against 40.
const LIST_CAP = 10;

// Which phase each command acts on, per the self-serve protocol in
// REFERENCE.md. spec.new is absent: it creates rather than advances.
const ACTS_ON = {
  'spec.plan': ['specified'],
  'spec.tasks': ['planned'],
  'spec.implement': ['tasks_generated', 'implementing']
};

// Conversational entry, kept deliberately narrow. A bare "plan" or
// "implement" is ordinary English and fires on half of all prompts, so a verb
// only counts when the word "spec" appears with it. Turkish forms are here
// because this project is worked in Turkish; the same reasoning applies —
// each is a verb that needs "spec" beside it to mean anything.
const VERBS = {
  'spec.plan': /\b(plan|planla|planlayalim|planlayalım)\b/i,
  'spec.tasks': /\b(tasks?|task'?lar|görevler|gorevler)\b/i,
  'spec.implement': /\b(implement|implemente|uygula|kodla)\b/i
};

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function resolveRoot(hookCwd) {
  if (process.env.FRAME_PROJECT_ROOT) return path.resolve(process.env.FRAME_PROJECT_ROOT);
  if (hookCwd && fs.existsSync(path.join(hookCwd, '.frame'))) return hookCwd;
  if (path.basename(__dirname) === 'bin' && path.basename(path.dirname(__dirname)) === '.frame') {
    return path.dirname(path.dirname(__dirname));
  }
  return process.cwd();
}

// ─── activity record ──────────────────────────────────────

let activity = null;
try {
  activity = require('./activity-log');
} catch {
  /* older .frame/bin generation — no record, same behavior as before */
}

// Which CLI this session is, so the right command templates are resolved.
// Guarded like activity-log; an older generation resolves claude-code, which
// is the only tool Frame shipped templates for before.
let vocab = null;
try {
  vocab = require('./toolVocabulary');
} catch {
  /* older generation — the inline fallback below is the old behaviour */
}

/**
 * Which host this record came from. The activity registry keeps one value per
 * CLI so "Codex hooks are installed but nothing has ever run" is answerable
 * from the log alone — which is how Frame detects an untrusted Codex hook,
 * since Codex writes nothing to disk when it declines to run one.
 */
let hookCli = null;

/** Called once, from the entry point, with the parsed payload. */
function setHookCli(payload) {
  hookCli = (vocab && vocab.cliOf(payload, process.argv[3])) || 'claude-code';
}

function hookHost() {
  return hookCli === 'codex' ? 'codex-hook' : 'claude-hook';
}

function note(root, ev, fields) {
  if (!activity || !root) return;
  try {
    activity.appendSync(activity.projectKey(root), {
      ev,
      kind: ev === 'hint.injected' ? 'action' : 'suppression',
      host: hookHost(),
      mode: 'spec-command',
      ...fields
    });
  } catch {
    /* the record is never worth a failed prompt */
  }
}

const quiet = (root, reason) => note(root, 'hint.quiet', { reason });

function emit(context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context }
  }));
}

// ─── intent ───────────────────────────────────────────────

/** Which spec command this prompt is asking for, or null. */
function commandOf(prompt) {
  const p = String(prompt || '');
  for (const cmd of SUPPORTED) {
    // `/spec.plan`, `spec.plan`, `spec plan` — the explicit forms. These are
    // what a user types when the slash command does not exist, which is the
    // case this hook is here for.
    const bare = cmd.replace('.', '[. ]');
    if (new RegExp(`(^|\\s)/?${bare}\\b`, 'i').test(p)) return cmd;
  }
  if (!/\bspec\b/i.test(p)) return null; // a verb alone is just English
  for (const [cmd, re] of Object.entries(VERBS)) {
    if (re.test(p)) return cmd;
  }
  return null;
}

/** A slug the prompt names outright — an explicit target always wins. */
function namedSlug(root, prompt) {
  const dir = path.join(root, '.frame', 'specs');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return null;
  }
  const p = String(prompt || '').toLowerCase();
  // Longest first, so "auth-tokens" is not shadowed by "auth".
  return entries.map((d) => d.name).sort((a, b) => b.length - a.length)
    .find((slug) => p.includes(slug.toLowerCase())) || null;
}

/** Specs whose phase this command acts on. */
function candidates(root, command) {
  const phases = ACTS_ON[command];
  if (!phases) return [];
  const dir = path.join(root, '.frame', 'specs');
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out = [];
  for (const slug of names) {
    const status = readJson(path.join(dir, slug, 'status.json'));
    if (status && phases.includes(status.phase)) out.push({ slug, title: status.title || slug, phase: status.phase });
  }
  return out;
}

// ─── the prompt the button would have built ───────────────

const RUNTIME_PROMPTS_REL = '.frame/runtime/prompts';
const RUNTIME_ASSETS_REL = '.frame/runtime/assets';

function templatePath(root, tool, command) {
  const override = path.join(root, '.frame', 'templates', 'commands', tool, `${command}.md`);
  if (fs.existsSync(override)) return override;
  return path.join(root, '.frame', 'runtime', 'commands', tool, `${command}.md`);
}

function interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (m, key) => (vars[key] != null ? String(vars[key]) : m));
}

/** Six-line copy of spec-index.js's formatter — see the header note. */
function catalogLines(index) {
  return Object.entries(index.topics).map(([slug, t]) => {
    const title = t.title.length > 90 ? `${t.title.slice(0, 87)}…` : t.title;
    return `- ${slug} · ${title} · ${t.phase}${t.keywords.length ? ` · ${t.keywords.slice(0, 8).join(', ')}` : ''}`;
  });
}

function specCatalog(root) {
  const idx = readJson(path.join(root, '.frame', 'index', 'spec-index.json'));
  if (!idx || !idx.topics) return '';
  const lines = catalogLines(idx);
  return lines.length ? lines.join('\n') : '';
}

function buildPrompt(root, slug, command, tool) {
  const template = readText(templatePath(root, tool, command));
  if (!template) return null;
  const status = readJson(path.join(root, '.frame', 'specs', slug, 'status.json'));
  if (!status) return null;
  return interpolate(template, {
    project_path: root,
    slug,
    title: status.title,
    description: '',
    report_template_path: `${RUNTIME_ASSETS_REL}/plan-report-template.html`,
    report_generator_path: `${RUNTIME_ASSETS_REL}/build-implement-report.mjs`,
    spec_catalog: command === 'spec.new' ? specCatalog(root) : ''
  });
}

// ─── mode ─────────────────────────────────────────────────

function promptMode(input) {
  const root = resolveRoot(input.cwd);
  const command = commandOf(input.prompt);
  if (!command) return; // not a spec command — silent and unrecorded

  // Which CLI is asking decides which template directory holds its flow.
  // Without the vocabulary this is the single tool Frame shipped for before.
  const tool = vocab ? vocab.cliOf(input, process.argv[3]) : 'claude-code';
  const tpl = templatePath(root, tool, command);
  if (!fs.existsSync(tpl)) {
    // The protocol's own instruction for this case: say so, and stop.
    note(root, 'hint.quiet', { reason: 'no-index' });
    return emit(`\`${command}\` was asked for, but no template is staged at ` +
      `\`${path.relative(root, tpl)}\`. Tell the user to open this project in Frame once so it stages ` +
      `the current templates, and stop — do not reconstruct the flow from memory.`);
  }
  const tplRel = path.relative(root, tpl).split(path.sep).join('/');

  if (command === 'spec.new') {
    note(root, 'hint.injected', { reason: undefined });
    return emit(`\`spec.new\` was asked for. Its flow lives in \`${tplRel}\` — read that file and ` +
      `follow it exactly, interpolating {project_path}, {slug}, {title}, {description} and ` +
      `{spec_catalog}. Do not write spec.md from memory; the template is the flow.`);
  }

  const named = namedSlug(root, input.prompt);
  const pool = candidates(root, command);
  const target = named || (pool.length === 1 ? pool[0].slug : null);

  if (!target) {
    note(root, 'hint.quiet', { reason: pool.length ? 'no-stale-free-match' : 'no-match' });
    // The list is bounded because additionalContext is inlined only up to
    // 2000 characters — an unbounded list would push the pointer itself past
    // the ceiling and get the whole hint spilled to a file. What is dropped
    // is stated rather than silently cut: a truncated list that reads as
    // complete would have the agent offer the user a choice that is missing
    // options.
    const shown = pool.slice(0, LIST_CAP);
    const rest = pool.length - shown.length;
    const listed = pool.length
      ? `Candidates in a phase \`${command}\` acts on:\n${shown.map((s) => `- ${s.slug} · ${s.title} · ${s.phase}`).join('\n')}`
        + (rest ? `\n(+${rest} more — run \`node .frame/bin/spec-command-hint.js\` targets, or list .frame/specs/*/status.json)` : '')
        + `\nAsk the user which one, then read \`${tplRel}\` and follow it exactly.`
      : `No spec is in a phase \`${command}\` acts on (${(ACTS_ON[command] || []).join(' or ')}). Say so rather than picking one.`;
    return emit(`\`${command}\` was asked for. ${listed}`);
  }

  const prompt = buildPrompt(root, target, command, tool);
  if (!prompt) return quiet(root, 'no-context');

  let relPath;
  try {
    const dir = path.join(root, RUNTIME_PROMPTS_REL);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${target}__${command}.md`;
    fs.writeFileSync(path.join(dir, file), prompt, 'utf8');
    relPath = `${RUNTIME_PROMPTS_REL}/${file}`;
  } catch {
    // Could not stage it — point at the template instead of failing.
    note(root, 'hint.injected', {});
    return emit(`\`${command}\` on spec \`${target}\`. Read \`${tplRel}\` and follow it exactly, ` +
      `interpolating {project_path}=${root}, {slug}=${target}.`);
  }

  note(root, 'hint.injected', {});
  emit(`\`${command}\` on spec \`${target}\`. Frame has staged the interpolated flow for you: ` +
    `**read \`${relPath}\` and follow its instructions exactly.** It is the current template, ` +
    `including every stage and every \`status.json\` update it prescribes — do not improvise the flow.`);
}

try {
  const input = JSON.parse(readStdin() || '{}');
  setHookCli(input);
  if (process.argv[2] === 'prompt') promptMode(input);
} catch { /* silence is the contract */ }

// `exitCode`, not `process.exit(0)` — an explicit exit can tear the process
// down before a stdout write has drained. Same reason as docs-hint.js.
process.exitCode = 0;
