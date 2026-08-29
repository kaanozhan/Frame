/**
 * Slug-less `spec.new` staging tests (new-spec-agent-handoff T01).
 *
 * `spec.new` is the one command that runs before a spec exists: the New Spec
 * launcher hands the agent the user's raw text and the agent derives the slug.
 * Every other command reads an existing status.json, and `getCommandPrompt`
 * used to reject a missing one with `spec not found` — the very call the
 * launcher makes.
 *
 * These tests pin the four properties that path depends on:
 *
 *   - the user's text reaches {description} verbatim (it used to be hardcoded
 *     to '' behind a comment claiming spec.new read a seeded spec.md);
 *   - {slug} / {title} are not interpolated when there is no spec yet;
 *   - the catalog embed still lands, since the agent disambiguates its own
 *     slug against it;
 *   - each run gets its own prompt file. `${slug}__${command}.md` with a null
 *     slug yields `null__spec.new.md` and every run overwrites the last —
 *     which would destroy the recovery surface for an abandoned run's text.
 *
 * A project-local override template is used throughout, so the assertions
 * pin the staging mechanism rather than the current wording of the shipped
 * spec.new.md.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const specManager = require('../src/main/specManager');

const OVERRIDE_TEMPLATE = [
  'project: {project_path}',
  'slug: {slug}',
  'title: {title}',
  'description: {description}',
  'catalog:',
  '{spec_catalog}'
].join('\n');

let projectPath;

function writeOverrideTemplate(content) {
  const dir = path.join(projectPath, '.frame', 'templates', 'commands', 'claude-code');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec.new.md'), content, 'utf8');
}

function writeSpec(slug, title, phase) {
  const dir = path.join(projectPath, '.frame', 'specs', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({
    slug,
    title,
    phase,
    generated_task_ids: []
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'spec.md'), `# ${title}\n`, 'utf8');
}

beforeEach(() => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-specnew-'));
  fs.mkdirSync(path.join(projectPath, '.frame', 'specs'), { recursive: true });
  writeOverrideTemplate(OVERRIDE_TEMPLATE);
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
});

// ─── getCommandPrompt — the slug-less branch ──────────────

test('spec.new with no slug builds a prompt instead of "spec not found"', () => {
  const result = specManager.getCommandPrompt(projectPath, null, 'spec.new', 'claude-code', 'a thing');
  assert.equal(result.error, undefined);
  assert.ok(result.prompt);
});

test("the user's text reaches {description} verbatim", () => {
  const text = 'Users should be able to *export* a spec as PDF — {braces} and all';
  const { prompt } = specManager.getCommandPrompt(projectPath, null, 'spec.new', 'claude-code', text);
  assert.ok(prompt.includes(`description: ${text}`));
});

test('{slug} and {title} are left uninterpolated when no spec exists yet', () => {
  const { prompt } = specManager.getCommandPrompt(projectPath, null, 'spec.new', 'claude-code', 'a thing');
  assert.ok(prompt.includes('slug: {slug}'));
  assert.ok(prompt.includes('title: {title}'));
  assert.ok(!prompt.includes('slug: null'));
  assert.ok(!prompt.includes('title: undefined'));
});

test('the spec catalog is still embedded for the agent to disambiguate against', () => {
  writeSpec('existing-thing', 'Existing thing', 'done');
  const { prompt } = specManager.getCommandPrompt(projectPath, null, 'spec.new', 'claude-code', 'a thing');
  assert.ok(prompt.includes('existing-thing'));
});

test('a missing description interpolates to empty, never the literal token', () => {
  const { prompt } = specManager.getCommandPrompt(projectPath, null, 'spec.new', 'claude-code');
  assert.ok(prompt.includes('description: \n') || prompt.endsWith('description: '));
  assert.ok(!prompt.includes('{description}'));
});

test('the readStatus guard still rejects a slug-less call for every other command', () => {
  for (const command of ['spec.plan', 'spec.tasks', 'spec.implement']) {
    const result = specManager.getCommandPrompt(projectPath, null, command, 'claude-code', 'a thing');
    assert.equal(result.error, 'spec not found', `${command} must still require a spec`);
  }
});

test('a slug-bearing spec.new still reads status.json and interpolates both tokens', () => {
  writeSpec('known-spec', 'Known spec', 'draft');
  const { prompt } = specManager.getCommandPrompt(projectPath, 'known-spec', 'spec.new', 'claude-code', 'a thing');
  assert.ok(prompt.includes('slug: known-spec'));
  assert.ok(prompt.includes('title: Known spec'));
});

// ─── buildSpecCommandFile — the prompt file ───────────────

test('a slug-less run writes spec.new__<ts>.md, not null__spec.new.md', () => {
  const result = specManager.buildSpecCommandFile(projectPath, null, 'spec.new', 'claude-code', 'a thing');
  assert.equal(result.success, true);
  const name = path.basename(result.relPath);
  assert.match(name, /^spec\.new__\d{8}T\d{9}Z(-\d+)?\.md$/);
  assert.ok(!name.includes('null'));
});

test('the staged file holds the interpolated prompt, so an abandoned run is recoverable', () => {
  const text = 'the text the user typed and then walked away from';
  const result = specManager.buildSpecCommandFile(projectPath, null, 'spec.new', 'claude-code', text);
  const onDisk = fs.readFileSync(path.join(projectPath, result.relPath), 'utf8');
  assert.ok(onDisk.includes(`description: ${text}`));
});

test('consecutive runs never overwrite each other', () => {
  const first = specManager.buildSpecCommandFile(projectPath, null, 'spec.new', 'claude-code', 'first idea');
  const second = specManager.buildSpecCommandFile(projectPath, null, 'spec.new', 'claude-code', 'second idea');
  assert.notEqual(first.relPath, second.relPath);
  assert.ok(fs.readFileSync(path.join(projectPath, first.relPath), 'utf8').includes('first idea'));
  assert.ok(fs.readFileSync(path.join(projectPath, second.relPath), 'utf8').includes('second idea'));
});

test('two runs inside the same millisecond still get distinct files', () => {
  const promptsDir = path.join(projectPath, '.frame', 'runtime', 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true });
  const name = specManager.specNewPromptFilename(new Date('2026-08-29T08:10:30.782Z'));
  assert.equal(name, 'spec.new__20260829T081030782Z.md');
  // Same stamp already on disk — the next run must not land on it.
  fs.writeFileSync(path.join(promptsDir, name), 'taken', 'utf8');
  const before = fs.readdirSync(promptsDir).length;
  specManager.buildSpecCommandFile(projectPath, null, 'spec.new', 'claude-code', 'a thing');
  assert.equal(fs.readdirSync(promptsDir).length, before + 1);
  assert.equal(fs.readFileSync(path.join(promptsDir, name), 'utf8'), 'taken');
});

test('a slug-bearing command keeps its stable <slug>__<command>.md name', () => {
  writeSpec('known-spec', 'Known spec', 'draft');
  const result = specManager.buildSpecCommandFile(projectPath, 'known-spec', 'spec.new', 'claude-code', 'a thing');
  assert.equal(path.basename(result.relPath), 'known-spec__spec.new.md');
});
