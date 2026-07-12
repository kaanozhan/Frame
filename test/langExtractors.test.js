/**
 * Per-language extractor tests (T04/T05): each scripts/lang/* module must
 * extract description/exports/deps/functions from its language's idioms and
 * never emit garbage (TS annotations as params, private Python names, etc.).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const js = require('../scripts/lang/javascript');
const py = require('../scripts/lang/python');
const go = require('../scripts/lang/go');
const rust = require('../scripts/lang/rust');
const md = require('../scripts/lang/markdown');

/* ------------------------------ javascript ----------------------------- */

test('js: ESM exports, imports and TS annotation cleanup', () => {
  const content = [
    '/**',
    ' * Button helpers.',
    ' */',
    "import { theme } from './theme.js';",
    "import fs from 'fs';",
    '',
    '/**',
    ' * Render a label',
    ' */',
    'export function button(label: string, disabled?: boolean): string {',
    '  return label;',
    '}',
    '',
    "export const size = 'md';",
    'export default button;'
  ].join('\n');
  const lines = content.split('\n');

  assert.equal(js.extractDescription(content), 'Button helpers.');
  assert.deepEqual(js.extractExports(content), ['button', 'size', 'default']);
  assert.deepEqual(js.extractDependencies(content), ['theme', 'fs']);
  const fns = js.extractFunctions(content, lines);
  assert.deepEqual(fns.button.params, ['label', 'disabled']);
  assert.equal(fns.button.purpose, 'Render a label');
});

test('js: CJS extraction is unchanged (params keep defaults, require deps)', () => {
  const content = [
    '// legacy module',
    "const util = require('./util');",
    'function run(count = 1) {',
    '  return count;',
    '}',
    'module.exports = { run };'
  ].join('\n');
  const fns = js.extractFunctions(content, content.split('\n'));
  assert.deepEqual(fns.run.params, ['count = 1']);
  assert.deepEqual(js.extractExports(content), ['run']);
  assert.deepEqual(js.extractDependencies(content), ['util']);
});

test('js: export { a as b } re-export counts alias and dep', () => {
  const content = "export { color as theme } from './tokens.ts';";
  assert.deepEqual(js.extractExports(content), ['theme']);
  assert.deepEqual(js.extractDependencies(content), ['tokens']);
});

/* -------------------------------- python ------------------------------- */

test('py: docstrings, public defs/classes, imports, annotated params', () => {
  const content = [
    '"""Views for the site."""',
    'from django.http import HttpResponse',
    'import os, sys',
    '',
    '',
    'def index(request, page: int = 1):',
    '    """Render the landing page."""',
    '    return HttpResponse("hi")',
    '',
    '',
    'def _private():',
    '    pass',
    '',
    '',
    'class HealthCheck:',
    '    """Liveness."""',
    '',
    '    def status(self):',
    '        return True'
  ].join('\n');
  const lines = content.split('\n');

  assert.equal(py.extractDescription(content), 'Views for the site.');
  assert.deepEqual(py.extractExports(content), ['index', 'HealthCheck']);
  assert.deepEqual(py.extractDependencies(content).sort(), ['django.http', 'os', 'sys']);
  const fns = py.extractFunctions(content, lines);
  assert.deepEqual(fns.index.params, ['request', 'page']);
  assert.equal(fns.index.purpose, 'Render the landing page.');
  assert.equal(fns._private.purpose, undefined);
});

test('py: __all__ wins over scraped names', () => {
  const content = '__all__ = ["a", "b"]\n\ndef a():\n    pass\n\ndef c():\n    pass\n';
  assert.deepEqual(py.extractExports(content), ['a', 'b']);
});

/* ---------------------------------- go --------------------------------- */

test('go: package doc, exported names only, import block, params', () => {
  const content = [
    '// Package store keeps records in memory.',
    'package store',
    '',
    'import (',
    '\t"fmt"',
    '\tdb "example.com/x/db"',
    ')',
    '',
    '// Get returns a record by id.',
    'func Get(id string) string {',
    '\treturn id',
    '}',
    '',
    'func helper(n int) int {',
    '\treturn n',
    '}',
    '',
    'type Record struct{}'
  ].join('\n');
  const lines = content.split('\n');

  assert.equal(go.extractDescription(content), 'Package store keeps records in memory.');
  assert.deepEqual(go.extractExports(content), ['Get', 'Record']);
  assert.deepEqual(go.extractDependencies(content), ['fmt', 'example.com/x/db']);
  const fns = go.extractFunctions(content, lines);
  assert.deepEqual(fns.Get.params, ['id']);
  assert.equal(fns.Get.purpose, 'Get returns a record by id.');
  assert.ok(fns.helper); // unexported funcs still map (not exported though)
});

/* --------------------------------- rust -------------------------------- */

test('rust: //! doc, pub items, use roots, self skipped in params', () => {
  const content = [
    '//! Parsing utilities.',
    'use std::fmt;',
    'use crate::internal;',
    '',
    '/// Parse a line into tokens.',
    'pub fn parse(line: &str) -> Vec<&str> {',
    '    line.split_whitespace().collect()',
    '}',
    '',
    'pub struct Document {',
    '    pub tokens: Vec<String>,',
    '}',
    '',
    'impl Document {',
    '    /// Count tokens.',
    '    pub fn len(&self, extra: usize) -> usize {',
    '        self.tokens.len() + extra',
    '    }',
    '}'
  ].join('\n');
  const lines = content.split('\n');

  assert.equal(rust.extractDescription(content), 'Parsing utilities.');
  assert.deepEqual(rust.extractExports(content), ['parse', 'Document']);
  assert.deepEqual(rust.extractDependencies(content), ['std']);
  const fns = rust.extractFunctions(content, lines);
  assert.deepEqual(fns.parse.params, ['line']);
  assert.equal(fns.parse.purpose, 'Parse a line into tokens.');
  assert.deepEqual(fns.len.params, ['extra']);
});

/* ------------------------------- markdown ------------------------------ */

test('md: first heading is the description, nothing invented', () => {
  const content = 'Intro text.\n\n# API Reference\n\n## Endpoints\n';
  assert.equal(md.extractDescription(content), 'API Reference');
  assert.deepEqual(md.extractExports(content), []);
  assert.deepEqual(md.extractDependencies(content), []);
  assert.deepEqual(md.extractFunctions(content, []), {});
  assert.equal(md.optInLanguage, 'markdown');
});
