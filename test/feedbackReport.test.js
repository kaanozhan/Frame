/**
 * The feedback composer — the module every report comes out of.
 *
 * What is under test here is what the user was promised: a report that says
 * exactly what the form showed them and nothing more, a form that refuses to
 * send an empty one, and a kind of feedback that decides where it goes rather
 * than asking the reporter to. The privacy assertion is deliberately written
 * as an exact-equality check rather than a set of `assert.match` calls — a
 * test that only looks for what *should* be in the body cannot catch the day
 * something else joins it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const feedback = require('../src/shared/feedbackReport');

const DRAFT = {
  title: 'Terminal tab loses its title after a rename',
  description: 'Renamed a tab, switched projects, came back — the title was back to "zsh".'
};

const DIAG = { appVersion: '2.6.0', os: 'darwin 24.3.0' };

// ─── validation ───────────────────────────────────────────

test('a complete draft validates', () => {
  assert.deepEqual(feedback.validate(DRAFT), { ok: true, errors: {} });
});

test('an empty title fails validation, and so does a whitespace one', () => {
  for (const title of ['', '   ', '\n\t']) {
    const { ok, errors } = feedback.validate({ ...DRAFT, title });
    assert.equal(ok, false);
    assert.equal(errors.title, 'Add a title.');
    assert.ok(!('description' in errors));
  }
});

test('an empty description fails validation', () => {
  const { ok, errors } = feedback.validate({ ...DRAFT, description: '  ' });
  assert.equal(ok, false);
  assert.equal(errors.description, 'Describe what happened.');
});

test('a draft carries no kind to be wrong about', () => {
  // The tab is the kind. Nothing typed into the form can disagree with where
  // the report is going, because nothing in the draft names a destination.
  assert.deepEqual(Object.keys(DRAFT).sort(), ['description', 'title']);
  assert.ok(!('type' in feedback.validate(DRAFT).errors));
});

test('validate never throws on a missing or malformed draft', () => {
  for (const junk of [undefined, null, {}, { title: 42 }, 'nonsense']) {
    const result = feedback.validate(junk);
    assert.equal(result.ok, false);
    assert.equal(typeof result.errors, 'object');
  }
});

// ─── the three kinds ──────────────────────────────────────

test('the three kinds each own their channel, their copy, and their diagnostics', () => {
  assert.deepEqual(
    feedback.FEEDBACK_TYPES.map((t) => [t.id, t.label, t.channel, t.attachesDiagnostics]),
    [
      ['bug', 'Bug', 'github_issue', true],
      ['idea', 'Feature idea', 'github_discussion', false],
      ['message', 'Reach us', 'email', true]
    ]
  );
});

test('every kind routes somewhere the oversize rule knows about', () => {
  for (const type of feedback.FEEDBACK_TYPES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(feedback.URL_LIMITS, type.channel),
      `${type.id} routes to ${type.channel}, which has no URL limit`
    );
  }
});

test('each kind asks for what that kind of report actually needs', () => {
  const prompts = new Set();
  for (const type of feedback.FEEDBACK_TYPES) {
    for (const field of ['title', 'description']) {
      assert.ok(type.fields[field].trim().length > 0, `${type.id}.fields.${field}`);
      const text = type.placeholders[field];
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 0, `${type.id}.placeholders.${field} is empty`);
      prompts.add(text);
    }
    assert.ok(type.action.trim().length > 0, `${type.id}.action`);
    assert.ok(type.note.trim().length > 0, `${type.id}.note`);
  }
  // Six distinct prompts, not one prompt shown six times — the whole reason
  // the copy is per-kind data rather than one string in the panel.
  assert.equal(prompts.size, feedback.FEEDBACK_TYPES.length * 2);
});

test('typeById finds a kind and refuses to invent one', () => {
  assert.equal(feedback.typeById('idea').channel, 'github_discussion');
  assert.equal(feedback.typeById('complaint'), null);
  assert.equal(feedback.typeById(undefined), null);
});

test('the recipient list is non-empty and every entry looks like an address', () => {
  assert.ok(feedback.FEEDBACK_RECIPIENTS.length > 0);
  for (const address of feedback.FEEDBACK_RECIPIENTS) {
    assert.match(address, /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/);
  }
});

// ─── diagnostics ──────────────────────────────────────────

test('the diagnostics are exactly two lines: version and OS', () => {
  assert.deepEqual(feedback.diagnosticsLines(DIAG), [
    'Frame version: 2.6.0',
    'OS: darwin 24.3.0'
  ]);
});

test('missing diagnostics read as unknown rather than empty or absent', () => {
  assert.deepEqual(feedback.diagnosticsLines({}), [
    'Frame version: unknown',
    'OS: unknown'
  ]);
});

// ─── the body ─────────────────────────────────────────────

test('the subject is the title as written, with nothing prepended', () => {
  assert.equal(feedback.compose(DRAFT, DIAG).subject, DRAFT.title);
  assert.ok(!feedback.compose(DRAFT, DIAG).subject.startsWith('['));
});

test('the body is the user text plus the shown diagnostics — and nothing else', () => {
  const { body } = feedback.compose(DRAFT, DIAG);
  const expected = [
    DRAFT.description,
    '',
    '### Environment',
    '',
    '- Frame version: 2.6.0',
    '- OS: darwin 24.3.0'
  ].join('\n');
  assert.equal(body, expected);
});

test('a kind that attaches nothing gets no Environment section at all', () => {
  // Not an empty section, and not one full of "unknown" — the idea tab
  // promises the reporter that only their own words travel, and this is the
  // assertion that keeps that promise literal.
  const { body } = feedback.compose(DRAFT);
  assert.equal(body, DRAFT.description);
  assert.ok(!body.includes('### Environment'));
  assert.ok(!body.includes('Frame version'));
});

test('the body carries the same diagnostic lines the form shows, bulleted', () => {
  const shown = feedback.diagnosticsLines(DIAG);
  const { body } = feedback.compose(DRAFT, DIAG);
  const carried = body.split('\n').slice(-shown.length);
  assert.deepEqual(carried, shown.map((line) => `- ${line}`));
});

test('the body is one markdown shape for every channel, not one per channel', () => {
  // The heading and the bullets are what GitHub needs to render the section;
  // the mail draft carries the identical bytes. A second, plain-text body
  // would break the invariant the whole module exists for.
  const { subject, body } = feedback.compose(DRAFT, DIAG);
  assert.match(body, /\n### Environment\n\n- Frame version: /);
  assert.equal(readMailto(feedback.mailtoUrl(subject, body)).body, body);
  assert.equal(readIssueUrl(feedback.issueUrl(subject, body)).body, body);
});

test('nothing about the open project reaches the body', () => {
  // The panel has a project open when it composes; the composer is never
  // given it, and this is the assertion that keeps it that way.
  const { subject, body } = feedback.compose(DRAFT, DIAG);
  for (const leak of ['/Users/', 'C:\\', '.frame', 'github.com', 'origin']) {
    assert.ok(!body.includes(leak), `body leaked ${leak}`);
    assert.ok(!subject.includes(leak), `subject leaked ${leak}`);
  }
});

test('CRLF from a textarea is normalised, so two reports cannot differ by bytes', () => {
  const crlf = feedback.compose({ ...DRAFT, description: 'one\r\ntwo\r\n' }, DIAG);
  const lf = feedback.compose({ ...DRAFT, description: 'one\ntwo' }, DIAG);
  assert.equal(crlf.body, lf.body);
});

// ─── the transports ───────────────────────────────────────
//
// The property these tests exist for is that a transport can only encode.
// Each one is read back apart — the URL parsed — and the result compared to
// what `compose()` produced.

/** What the mailto: draft actually carries, decoded. */
function readMailto(url) {
  const [scheme, query] = url.split('?');
  const params = new URLSearchParams(query);
  return {
    to: scheme.slice('mailto:'.length).split(',').map(decodeURIComponent),
    subject: params.get('subject'),
    body: params.get('body')
  };
}

/** What the new-issue URL actually carries, decoded. */
function readIssueUrl(url) {
  const parsed = new URL(url);
  return {
    repo: parsed.pathname.replace(/^\/|\/issues\/new$/g, ''),
    subject: parsed.searchParams.get('title'),
    body: parsed.searchParams.get('body')
  };
}

/** What the new-discussion URL actually carries, decoded. */
function readDiscussionUrl(url) {
  const parsed = new URL(url);
  return {
    repo: parsed.pathname.replace(/^\/|\/discussions\/new$/g, ''),
    category: parsed.searchParams.get('category'),
    subject: parsed.searchParams.get('title'),
    body: parsed.searchParams.get('body')
  };
}

test('all three transports carry a byte-identical subject and body', () => {
  const { subject, body } = feedback.compose(DRAFT, DIAG);

  const carried = [
    readMailto(feedback.mailtoUrl(subject, body)),
    readIssueUrl(feedback.issueUrl(subject, body)),
    readDiscussionUrl(feedback.discussionUrl(subject, body))
  ];

  for (const one of carried) {
    assert.equal(one.subject, subject);
    assert.equal(one.body, body);
  }
});

test('a body full of characters a URL would eat survives every transport', () => {
  const hostile = 'a&b=c #hash +plus %25 "quote" <tag>\nnewline\tTAB — em dash 😀';
  const { subject, body } = feedback.compose({ ...DRAFT, description: hostile }, DIAG);

  assert.equal(readMailto(feedback.mailtoUrl(subject, body)).body, body);
  assert.equal(readIssueUrl(feedback.issueUrl(subject, body)).body, body);
  assert.equal(readDiscussionUrl(feedback.discussionUrl(subject, body)).body, body);
});

test('both GitHub transports target the fixed repo, never the open project', () => {
  const { subject, body } = feedback.compose(DRAFT, DIAG);
  assert.equal(feedback.FEEDBACK_REPO, 'kaanozhan/Frame');
  assert.equal(readIssueUrl(feedback.issueUrl(subject, body)).repo, feedback.FEEDBACK_REPO);
  assert.equal(readDiscussionUrl(feedback.discussionUrl(subject, body)).repo, feedback.FEEDBACK_REPO);
});

test('the issue URL prefills a form and asks for nothing else', () => {
  const { subject, body } = feedback.compose(DRAFT, DIAG);
  const url = new URL(feedback.issueUrl(subject, body));
  // Only what the form needs to be readable before the reporter submits it.
  // A labels= parameter is deliberately absent: GitHub drops it for anyone
  // without triage rights, so it would be a promise the URL cannot keep.
  assert.deepEqual([...url.searchParams.keys()].sort(), ['body', 'title']);
  assert.equal(url.pathname, `/${feedback.FEEDBACK_REPO}/issues/new`);
});

test('the discussion URL names its category, and it is the default Ideas one', () => {
  const { subject, body } = feedback.compose(DRAFT);
  const read = readDiscussionUrl(feedback.discussionUrl(subject, body));
  // GitHub matches the category by slug. `ideas` ships with Discussions, so
  // a repository that has the feature on already has somewhere to put this.
  assert.equal(feedback.FEEDBACK_DISCUSSION_CATEGORY, 'ideas');
  assert.equal(read.category, 'ideas');
  assert.equal(new URL(feedback.discussionUrl(subject, body)).pathname,
    `/${feedback.FEEDBACK_REPO}/discussions/new`);
});

test('the mailto draft is addressed to the recipient list', () => {
  const mail = readMailto(feedback.mailtoUrl('s', 'b'));
  assert.deepEqual(mail.to, feedback.FEEDBACK_RECIPIENTS);
});

// ─── the oversize rule ────────────────────────────────────

test('a report that fits rides in the URL, on every channel', () => {
  const { subject, body } = feedback.compose(DRAFT, DIAG);
  for (const channel of ['email', 'github_issue', 'github_discussion']) {
    const delivery = feedback.deliveryFor(channel, subject, body);
    assert.equal(delivery.mode, 'url');
    assert.equal(delivery.clipboardBody, null);
    assert.ok(delivery.url.length <= feedback.URL_LIMITS[channel]);
  }
});

test('a body past the threshold falls to the clipboard with a subject-only URL', () => {
  const subject = 'Subject line';
  const body = 'x'.repeat(10000);

  for (const channel of ['email', 'github_issue', 'github_discussion']) {
    const delivery = feedback.deliveryFor(channel, subject, body);
    assert.equal(delivery.mode, 'clipboard');
    // The whole body reaches the clipboard — not a truncated one, which would
    // silently send half a report.
    assert.equal(delivery.clipboardBody, body);

    const read = channel === 'email'
      ? readMailto(delivery.url)
      : (channel === 'github_issue' ? readIssueUrl(delivery.url) : readDiscussionUrl(delivery.url));
    assert.equal(read.subject, subject);
    assert.equal(read.body, null);
  }
});

test('the channels have their own thresholds, and mailto is the tightest', () => {
  assert.ok(feedback.URL_LIMITS.email < feedback.URL_LIMITS.github_issue);
  // A body between the two limits: too long to mail, fine for a GitHub form.
  const body = 'x'.repeat(feedback.URL_LIMITS.email + 100);
  assert.equal(feedback.deliveryFor('email', 'S', body).mode, 'clipboard');
  assert.equal(feedback.deliveryFor('github_issue', 'S', body).mode, 'url');
  assert.equal(feedback.deliveryFor('github_discussion', 'S', body).mode, 'url');
});

test('an unknown channel delivers nothing rather than guessing one', () => {
  const delivery = feedback.deliveryFor('carrier_pigeon', 'S', 'B');
  assert.equal(delivery.url, null);
  assert.equal(delivery.clipboardBody, null);
});
