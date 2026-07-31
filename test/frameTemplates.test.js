/**
 * frameTemplates tests (T08): what the generated files may and may not say
 * once Frame is an overlay.
 *
 * The load-bearing assertion is negative — no template may reference a root
 * instruction file or a planted symlink, because the overlay creates neither
 * and a template that claims otherwise sends an agent looking for a file that
 * is not there.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const templates = require('../src/shared/frameTemplates');

// ─── wrapper template ─────────────────────────────────────────

test('the wrapper execs the real CLI with the preamble as initial prompt', () => {
  const script = templates.getWrapperTemplate('codex', {});
  assert.ok(script.startsWith('#!/usr/bin/env bash'));
  assert.ok(script.includes('exec codex "$(cat "$PREAMBLE_FILE")" "$@"'));
  assert.ok(script.includes('exec codex "$@"'), 'no fallback when the preamble is missing');
});

test('the wrapper is generalized per tool, not written per CLI', () => {
  for (const tool of ['codex', 'gemini', 'some-future-cli']) {
    const script = templates.getWrapperTemplate(tool, {});
    assert.ok(script.includes(`exec ${tool} `), `${tool} is not execed`);
    assert.ok(script.includes(`Frame AI Tool Wrapper for ${tool}`));
  }
});

test('a tool with a prompt flag gets it in front of the prompt', () => {
  const script = templates.getWrapperTemplate('sometool', { promptFlag: '--prompt' });
  assert.ok(script.includes('exec sometool --prompt "$(cat "$PREAMBLE_FILE")" "$@"'));
});

test('the wrapper reads the preamble from a file, never inlines it', () => {
  const script = templates.getWrapperTemplate('codex', {});
  // Inlining multi-line prose full of quotes and backticks into a generated
  // shell script is how these break; the preamble stays data.
  assert.ok(script.includes('PREAMBLE_FILE='));
  assert.ok(script.includes('.frame/runtime/preamble.txt'));
});

test('the wrapper finds the project root by .frame/, not by a root AGENTS.md', () => {
  const script = templates.getWrapperTemplate('codex', {});
  assert.ok(script.includes('-d "$dir/.frame"'));
  assert.ok(!/AGENTS\.md/.test(script), 'the wrapper still hunts for a root AGENTS.md');
});

test('a custom preamble location is honoured', () => {
  const script = templates.getWrapperTemplate('codex', { preambleFile: '.frame/runtime/other.txt' });
  assert.ok(script.includes('.frame/runtime/other.txt'));
});

// ─── spec-hint settings ───────────────────────────────────────

test('the spec-hint settings carry both hook events', () => {
  const settings = templates.getSpecHintSettings();
  assert.ok(settings.hooks.PreToolUse);
  assert.ok(settings.hooks.UserPromptSubmit);
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Edit|Write');
  assert.ok(JSON.stringify(settings).includes('.frame/bin/spec-hint.js'));
});

test('the settings object is JSON-serializable as a settings file', () => {
  const settings = templates.getSpecHintSettings();
  assert.deepEqual(JSON.parse(JSON.stringify(settings)), settings);
});

test('every spec-hint command runs from inside .frame/', () => {
  const commands = JSON.stringify(templates.getSpecHintSettings()).match(/"command":"([^"]+)"/g) || [];
  assert.ok(commands.length > 0);
  for (const command of commands) {
    assert.ok(command.includes('.frame/'), `${command} points outside Frame's footprint`);
  }
});

// ─── the global layer's content ───────────────────────────────

test('the global AGENTS core references no root file and no symlink', () => {
  const text = templates.getAgentsTemplate('Frame', {
    global: true,
    referencePath: 'REFERENCE.md'
  });

  assert.ok(!/symlink/i.test(text), 'the overlay plants no symlink');
  assert.ok(!/Creation date/.test(text));
  assert.ok(!/Project Facts/.test(text));
  assert.ok(text.includes('REFERENCE.md'));
});

test('the global core points at the reference it was given', () => {
  const text = templates.getAgentsTemplate('Frame', {
    global: true,
    referencePath: '/abs/frame-global/REFERENCE.md'
  });
  assert.ok(text.includes('/abs/frame-global/REFERENCE.md'));
  assert.ok(!text.includes('.frame/docs/REFERENCE.md'), 'the default path leaked into the global copy');
});

test('Frame-owned scripts are addressed under .frame/bin/', () => {
  const text = templates.getAgentsTemplate('Frame', { global: true, referencePath: 'REFERENCE.md' });
  for (const script of ['find-module.js', 'spec-context.js', 'check-freshness.js']) {
    assert.ok(text.includes(`.frame/bin/${script}`), `${script} is not addressed inside .frame/`);
  }
});

test('the project variant still renders its own facts and stamp', () => {
  const text = templates.getAgentsTemplate('MyProject', {
    project: { languages: ['javascript'], packageManager: 'npm', commands: {} }
  });
  assert.ok(text.includes('# MyProject - Frame Project'));
  assert.ok(/Project Facts/.test(text));
  assert.ok(/Creation date/.test(text));
});

// ─── config template ──────────────────────────────────────────

test('the config template carries gitSharing and none of the dead flags', () => {
  const config = templates.getFrameConfigTemplate('MyProject');
  assert.equal(config.settings.gitSharing, 'local', 'default sharing mode is local');
  assert.deepEqual(Object.keys(config.settings), ['gitSharing'], 'a dead flag survived in settings');
  assert.equal(config.features.specDriven, true, 'spec-driven defaults on');
});

test('the config template takes both init answers from options', () => {
  const config = templates.getFrameConfigTemplate('MyProject', { gitSharing: 'repo', specDriven: false });
  assert.equal(config.settings.gitSharing, 'repo');
  assert.equal(config.features.specDriven, false);
});

test('an invalid gitSharing option falls back to local', () => {
  const config = templates.getFrameConfigTemplate('MyProject', { gitSharing: 'team' });
  assert.equal(config.settings.gitSharing, 'local');
});
