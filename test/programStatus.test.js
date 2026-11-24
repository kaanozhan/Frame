/**
 * programStatus — Claude Code's OSC 7501 status reports and bracketed-paste
 * mode, read from a terminal stream (lead-agent spec, T02).
 *
 * The CLAUDE_2_1_331_* strings are the control sequences captured from a real
 * Claude Code 2.1.331 start in a pty (2026-11-25): its startup modes, its
 * capability probes, and — once the probe was answered — its first report.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/shared/programStatus');

const CLAUDE_2_1_331_STARTUP = '\x1b[?25h\x1b[?25l\x1b[?2004h\x1b[?2031h\x1b[?1004h';
const CLAUDE_2_1_331_PROBES = '\x1b[>0q\x1b]7501;?\x07\x1b[c';
const CLAUDE_2_1_331_FIRST_REPORT = '\x1b]7501;state=idle:app=claude-code\x07';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('the captured 2.1.331 start: paste mode on, one probe, then an idle report', () => {
  const sc = P.createScanner();
  const a = sc.feed(`hello${CLAUDE_2_1_331_STARTUP}world`);
  assert.equal(a.pasteMode, true);
  assert.equal(a.probes, 0);
  const b = sc.feed(CLAUDE_2_1_331_PROBES);
  assert.equal(b.probes, 1);
  assert.deepEqual(b.reports, []);
  const c = sc.feed(CLAUDE_2_1_331_FIRST_REPORT);
  assert.deepEqual(c.reports, [{ state: 'idle', app: 'claude-code' }]);
  assert.equal(P.PROBE_ANSWER, '\x1b]7501;?\x07');
});

test('reports: kinds, progress, base64 title/msg, ST terminator, order', () => {
  const sc = P.createScanner();
  const r = sc.feed(
    `\x1b]7501;state=working:app=claude-code:progress=40:msg=${b64('Reading files')}\x07`
    + `text in between`
    + `\x1b]7501;state=blocked:app=claude-code:kind=permission:msg=${b64('Allow Bash?')}\x1b\\`
    + `\x1b]7501;state=done:app=claude-code:title=${b64('Fix the bug')}\x07`
  );
  assert.deepEqual(r.reports, [
    { state: 'working', app: 'claude-code', progress: 40, msg: 'Reading files' },
    { state: 'blocked', app: 'claude-code', kind: 'permission', msg: 'Allow Bash?' },
    { state: 'done', app: 'claude-code', title: 'Fix the bug' }
  ]);
});

test('subtask reports (with an id) are not the session and are dropped', () => {
  const sc = P.createScanner();
  const r = sc.feed('\x1b]7501;state=working:app=claude-code:id=task-1\x07\x1b]7501;state=idle:app=claude-code\x07');
  assert.deepEqual(r.reports, [{ state: 'idle', app: 'claude-code' }]);
});

test('sequences split across chunks are carried, at every split point', () => {
  const whole = `abc${CLAUDE_2_1_331_PROBES}\x1b[?2004l\x1b]7501;state=blocked:app=claude-code:kind=question\x07xyz`;
  for (let i = 1; i < whole.length; i++) {
    const sc = P.createScanner();
    const a = sc.feed(whole.slice(0, i));
    const b = sc.feed(whole.slice(i));
    assert.equal(a.probes + b.probes, 1, `probe at split ${i}`);
    assert.deepEqual([...a.reports, ...b.reports], [{ state: 'blocked', app: 'claude-code', kind: 'question' }], `report at split ${i}`);
    assert.equal(b.pasteMode !== undefined ? b.pasteMode : a.pasteMode, false, `paste mode at split ${i}`);
    assert.equal(sc.pending, '', `nothing left over at split ${i}`);
  }
});

test('paste mode: combined mode lists and the last change wins', () => {
  const sc = P.createScanner();
  assert.equal(sc.feed('\x1b[?1004;2004h').pasteMode, true);
  assert.equal(sc.feed('\x1b[?2004h\x1b[?2004l').pasteMode, false);
  assert.equal(sc.feed('\x1b[?25h').pasteMode, undefined, 'other modes say nothing about paste');
  assert.equal(sc.feed('plain text').pasteMode, undefined);
});

test('unrelated escapes are not held back, and a runaway tail is let go', () => {
  const sc = P.createScanner();
  sc.feed('\x1b[31mred');
  assert.equal(sc.pending, '');
  sc.feed('\x1b]0;title');
  assert.equal(sc.pending, '', 'OSC 0 is not ours');
  sc.feed(`\x1b]7501;state=working${'x'.repeat(P.MAX_CARRY + 10)}`);
  assert.equal(sc.pending, '', 'an unterminated tail longer than MAX_CARRY is dropped');
  sc.feed('\x1b]75');
  assert.equal(sc.pending, '\x1b]75', 'a prefix of ours is held');
  sc.reset();
  assert.equal(sc.pending, '');
});

test('parseReport ignores junk and needs a state', () => {
  assert.equal(P.parseReport('app=claude-code'), null);
  assert.deepEqual(P.parseReport('state=idle:noequals:=x:progress=abc'), { state: 'idle' });
});

test('bracketedPaste wraps text and strips embedded paste markers', () => {
  assert.equal(P.bracketedPaste('a\nb'), '\x1b[200~a\nb\x1b[201~');
  assert.equal(P.bracketedPaste('x\x1b[201~rm -rf'), '\x1b[200~xrm -rf\x1b[201~', 'a payload cannot end the paste early');
});
