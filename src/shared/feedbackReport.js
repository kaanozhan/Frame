/**
 * Feedback report — the one composer.
 *
 * Everything a feedback report *says* is built here and nowhere else. The
 * panel collects a draft, this module turns it into a subject and a body, and
 * the transports (a prefilled GitHub issue, a prefilled GitHub discussion, a
 * mail draft) receive that finished pair as opaque strings they may only
 * encode. That is the whole reason this module exists: three destinations that
 * each built their own body would drift apart within two changes.
 *
 * Two consequences worth stating, because they are load-bearing:
 *
 *   - **The kind of feedback decides everything else.** `FEEDBACK_TYPES` is a
 *     single table: what the tab is called, what its fields ask for, where it
 *     delivers, and whether it attaches anything about the machine. The panel
 *     renders that table; it does not branch on it.
 *   - **The form shows what it sends.** `diagnosticsLines()` produces the
 *     preview block in the panel *and* the Environment section of the body,
 *     from the same call. They cannot disagree, because they are the same
 *     array — and where a kind attaches nothing, neither exists.
 *
 * Privacy is a property of this file: a body is the user's description plus,
 * at most, the two lines `diagnosticsLines()` returns, and there is no code
 * path here that appends a third. No project path, no project name, no
 * remote, no file contents — the same line `telemetry.js` and `PRIVACY.md`
 * hold.
 *
 * Pure — no Electron, no filesystem — so it runs under `node --test`.
 */

'use strict';

// Where a GitHub report goes — fixed, and deliberately not the open project's
// remote or `origin`. This feedback is about Frame; routing it at whatever
// repository the user happens to have open would file Frame's bugs in a
// stranger's tracker.
const FEEDBACK_REPO = 'kaanozhan/Frame';

// The Discussions category a feature idea opens under. `ideas` is GitHub's
// default category and its description is this feature almost verbatim
// ("share ideas for new features"), so a repository with Discussions enabled
// already has it. GitHub matches the category by slug, with dashes standing
// in for spaces — which is the reason not to invent a prettier name for it.
const FEEDBACK_DISCUSSION_CATEGORY = 'ideas';

/**
 * The three kinds of feedback, in the order the panel offers them.
 *
 * One table, because every one of these differences follows from the kind and
 * nothing else:
 *
 *   channel             — where it goes. A bug is a defect and belongs in the
 *                         tracker. A feature idea is a proposal, not a defect:
 *                         in a tracker it becomes an unassigned task that
 *                         reads as a rejection when closed, while a discussion
 *                         can be argued, upvoted, and converted into an issue
 *                         by GitHub the day the work is actually committed to.
 *                         Anything else is a message to people, not a record.
 *   attachesDiagnostics — whether the body carries the Environment section. A
 *                         bug report without a version is half a report; an
 *                         idea does not depend on the machine it occurred on.
 *   fields/placeholders — what each input is called and what it asks for. A
 *                         bug is narrated, an idea is argued, a message is
 *                         simply written; asking all three "what happened
 *                         instead?" gets two of them wrong.
 *
 * The copy lives beside the routing rather than in the panel because they are
 * the same decision: the tab is the kind, and the kind is this row.
 */
const FEEDBACK_TYPES = [
  {
    id: 'bug',
    label: 'Bug',
    channel: 'github_issue',
    attachesDiagnostics: true,
    fields: { title: 'Title', description: 'Description' },
    placeholders: {
      title: 'One line: what broke',
      description: 'What you did, what you expected, what happened instead.'
    },
    action: 'File an issue',
    note: 'Opens a prefilled issue on GitHub. You can add screenshots or edit it there before you submit.'
  },
  {
    id: 'idea',
    label: 'Feature idea',
    channel: 'github_discussion',
    attachesDiagnostics: false,
    fields: { title: 'Title', description: 'Description' },
    placeholders: {
      title: 'One line: what you want to be able to do',
      description: "What you're trying to do today, and why it is awkward."
    },
    action: 'Start a discussion',
    note: 'Opens a prefilled idea under Discussions. You can edit it there before you post.'
  },
  {
    id: 'message',
    label: 'Reach us',
    channel: 'email',
    attachesDiagnostics: true,
    fields: { title: 'Subject', description: 'Message' },
    placeholders: {
      title: 'What is this about?',
      description: 'A question, a problem, or anything you would rather not post publicly.'
    },
    action: 'Send an email',
    note: 'Goes to the Frame devs by email.'
  }
];

// Where the Reach us tab delivers — the people, not an address Frame owns.
//
// `frame.cool` still has no mailbox behind it, so these are personal inboxes,
// and `mailto:` puts all three in the draft's To: field. Every reporter who
// opens the tab therefore reads all three addresses, and each recipient sees
// the others. That is accepted knowingly rather than discovered after the
// first report.
//
// TODO: replace this list with one shared address the day Frame has an
// account of its own — a frame.cool mailbox or a group alias. This is the
// only line that has to change: nothing else in the feedback flow knows who
// the recipients are, and `mailtoUrl()` reads the list rather than an
// address.
const FEEDBACK_RECIPIENTS = [
  'kaanozhan@gmail.com',
  'denizmrtoglu@gmail.com',
  'berkayilmaz11@gmail.com'
];

// How long a URL may get before we stop trying to carry the body in it.
//
// Both numbers are the *full encoded URL*, not the body alone, and both sit
// well under the real ceiling on purpose: the failure they prevent — a mail
// client or a GitHub form that opens blank — is invisible to Frame, so being
// approximately right and early beats being exactly right and late.
//
//   mailto — Windows' ShellExecute truncates somewhere around 2048 characters
//            and is the tightest handler of the three platforms.
//   GitHub — the front end rejects over-long query strings as the request
//            line approaches the usual 8 KB server limit; an issue form and a
//            discussion form are the same front end.
const URL_LIMITS = { email: 1800, github_issue: 6000, github_discussion: 6000 };

// Opens the diagnostics section of the body.
//
// Markdown, because two of the three channels are GitHub pages that other
// people read: a heading and a bulleted list render there as a heading and a
// list, where a bare `---` rule and two loose lines render as a rule and a
// run-on paragraph. The cost is that a plain-text mail reader sees the literal
// `###` and `-` — three characters of syntax, against a report that is
// actually legible. There is no second, plain-text body: two bodies would
// drift apart, and the form could not preview either.
const DIAGNOSTICS_HEADING = '### Environment';

const UNKNOWN = 'unknown';

/** The record for a kind, or `null` when the id is not one of ours. */
function typeById(id) {
  return FEEDBACK_TYPES.find((t) => t.id === id) || null;
}

// Draft text arrives from a `<textarea>`, which on Windows yields CRLF. GitHub
// and a mail client each normalise it differently, so the same report would
// differ by invisible bytes depending on where it went unless we settle it
// here, once, before anything is composed.
function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim();
}

/**
 * Is this draft sendable?
 *
 * Returns `{ ok, errors }` where `errors` is keyed by field, so the panel can
 * put each message beside the input it belongs to rather than in one summary
 * line. Empty title or empty description sends nothing — the two fields that
 * carry the report's actual content, and now the only two a draft has: the
 * kind is which tab you are on, not something typed into the form.
 */
function validate(draft) {
  const errors = {};
  const d = draft || {};

  if (!normalizeText(d.title)) errors.title = 'Add a title.';
  if (!normalizeText(d.description)) errors.description = 'Describe what happened.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * The diagnostics, as the exact lines the user sees and the body carries.
 *
 * Two values, no more: Frame's version and the OS. The panel renders this
 * array above the send button; `compose()` bullets the same array into the
 * body. Adding a line here adds it to both, which is the only way a diagnostic
 * should ever be added.
 */
function diagnosticsLines(diagnostics) {
  const d = diagnostics || {};
  return [
    `Frame version: ${normalizeText(d.appVersion) || UNKNOWN}`,
    `OS: ${normalizeText(d.os) || UNKNOWN}`
  ];
}

/**
 * The one body builder.
 *
 * `subject` is the title as written — no prefix, because every kind now has
 * exactly one destination that already says what it is: a bug lands in the
 * issue tracker, an idea under Discussions, a message in an inbox addressed
 * to three people who know what Frame is.
 *
 * `diagnostics` is optional, and that is the whole mechanism behind a kind
 * that attaches nothing: **with no diagnostics there is no Environment
 * section**, not an empty one and not one full of `unknown`. Nothing else is
 * ever added — a transport that wants to say more has to change this
 * function, where the change lands on every channel at once.
 */
function compose(draft, diagnostics) {
  const d = draft || {};
  const subject = normalizeText(d.title);
  const description = normalizeText(d.description);

  const body = diagnostics
    ? [
        description,
        '',
        DIAGNOSTICS_HEADING,
        '',
        ...diagnosticsLines(diagnostics).map((line) => `- ${line}`)
      ].join('\n')
    : description;

  return { subject, body };
}

// ─── The transports ───────────────────────────────────────
//
// Each one takes a finished `subject` and `body` and does nothing to them but
// encode. None concatenates, re-orders or appends — which is why a report
// arrives as composed as a matter of what the code *can* do, rather than a
// convention it agrees to honour.

/** A `mailto:` draft for the user's own mail client. */
function mailtoUrl(subject, body, recipients) {
  const to = (recipients || FEEDBACK_RECIPIENTS).map(encodeURIComponent).join(',');
  const parts = [`subject=${encodeURIComponent(subject)}`];
  // An empty body is left out rather than sent as `body=`: the oversize path
  // builds a subject-only URL, and it should be exactly that.
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to}?${parts.join('&')}`;
}

/**
 * GitHub's prefilled new-issue page.
 *
 * A page rather than `gh issue create` on purpose. Filing from the CLI
 * publishes at once, under whichever account `gh` is signed into, and gives
 * the reporter no chance to read how the markdown renders, fix a sentence, or
 * drag in the screenshot that is usually the most useful thing in a bug
 * report. One extra click buys all three.
 */
function issueUrl(subject, body) {
  const query = new URLSearchParams({ title: subject });
  if (body) query.set('body', body);
  return `https://github.com/${FEEDBACK_REPO}/issues/new?${query.toString()}`;
}

/**
 * GitHub's prefilled new-discussion page, under the Ideas category.
 *
 * Same three parameters as the issue form (`category`, `title`, `body`) and
 * the same handoff: Frame opens the page, the reporter posts it. The category
 * has to exist on the repository — if Discussions is turned off, this URL is
 * a 404 that Frame cannot see, which is why the category is a constant and
 * not something a caller can get wrong.
 */
function discussionUrl(subject, body) {
  const query = new URLSearchParams({ category: FEEDBACK_DISCUSSION_CATEGORY, title: subject });
  if (body) query.set('body', body);
  return `https://github.com/${FEEDBACK_REPO}/discussions/new?${query.toString()}`;
}

const URL_BUILDERS = {
  email: (subject, body, recipients) => mailtoUrl(subject, body, recipients),
  github_issue: (subject, body) => issueUrl(subject, body),
  github_discussion: (subject, body) => discussionUrl(subject, body)
};

/**
 * How a channel should actually deliver this report.
 *
 * One rule for every channel, in one place. Normally the body rides in the
 * URL (`mode: 'url'`). When the encoded URL would pass the channel's
 * threshold, the body cannot be trusted to survive the handoff — so the
 * caller gets `mode: 'clipboard'`, a URL carrying the subject alone, and the
 * body to put on the clipboard. The user then meets a compose window with an
 * explanation and a paste, never a blank one and no idea why.
 */
function deliveryFor(channel, subject, body, recipients) {
  const builder = URL_BUILDERS[channel];
  if (!builder) return { channel, mode: 'url', url: null, clipboardBody: null };

  const build = (text) => builder(subject, text, recipients);
  const limit = URL_LIMITS[channel];
  const full = build(body);
  if (!limit || full.length <= limit) {
    return { channel, mode: 'url', url: full, clipboardBody: null };
  }
  return { channel, mode: 'clipboard', url: build(''), clipboardBody: body };
}

module.exports = {
  FEEDBACK_TYPES,
  FEEDBACK_RECIPIENTS,
  FEEDBACK_REPO,
  FEEDBACK_DISCUSSION_CATEGORY,
  URL_LIMITS,
  DIAGNOSTICS_HEADING,
  typeById,
  validate,
  diagnosticsLines,
  compose,
  mailtoUrl,
  issueUrl,
  discussionUrl,
  deliveryFor
};
