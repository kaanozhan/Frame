/**
 * cloudBriefsCopy tests — the words the cloud Briefs view says.
 * Runs with Node's built-in runner: `npm test` (node --test test/).
 * Pure: no DOM, no Electron.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const copy = require('../src/renderer/cloudBriefsCopy');
const { ROLE_FORBIDDEN } = require('../src/renderer/cloudRoles');

const ME = 'u-me';
const OTHER = 'u-other';
// Noon UTC, so the date reads the same in every viewer time zone.
const AT = '2026-09-10T12:00:00.000Z';

function ev(event, data = {}, actorId = ME) {
  return { id: 'e1', at: AT, actorId, event, data };
}

function sentence(event, data, actorId) {
  return copy.eventSentence(ev(event, data, actorId), ME).sentence;
}

// ─── Columns ──────────────────────────────────────────────────

test('groupByColumn groups by status and keeps the list order', () => {
  const briefs = [
    { id: 'a', status: 'done' },
    { id: 'b', status: 'backlog' },
    { id: 'c', status: 'active' },
    { id: 'd', status: 'backlog' },
    { id: 'e', status: 'closed' },
  ];
  const groups = copy.groupByColumn(briefs);
  assert.deepEqual(groups.backlog.map((b) => b.id), ['b', 'd']);
  assert.deepEqual(groups.active.map((b) => b.id), ['c']);
  assert.deepEqual(groups.done.map((b) => b.id), ['a']);
  assert.deepEqual(groups.closed.map((b) => b.id), ['e']);
});

test('groupByColumn puts an unknown status in Backlog and survives no list', () => {
  assert.deepEqual(copy.groupByColumn([{ id: 'x', status: 'weird' }]).backlog.map((b) => b.id), ['x']);
  assert.deepEqual(copy.groupByColumn(undefined), { backlog: [], active: [], done: [], closed: [] });
});

test('the columns are Backlog / Active / Done; Active fills on its own and Done is a person\'s move', () => {
  assert.deepEqual(copy.COLUMNS.map((c) => c.title), ['Backlog', 'Active', 'Done']);
  assert.equal(copy.COLUMNS[0].hint, undefined);
  assert.equal(copy.COLUMNS[1].hint, 'A brief moves here on its own once work starts on a machine.');
  assert.equal(copy.COLUMNS[2].hint, 'Move a brief here when its work is finished.');
});

// ─── Labels ───────────────────────────────────────────────────

test('kind, status and priority labels', () => {
  assert.equal(copy.KIND_COPY.proposal.badge, 'PROPOSAL');
  assert.equal(copy.KIND_COPY.work.label, 'Work');
  assert.equal(copy.statusLabel('active'), 'Active');
  assert.equal(copy.statusLabel('nope'), 'Backlog');
  assert.equal(copy.priorityLabel('high'), 'High');
  assert.equal(copy.priorityLabel(null), '');
});

// ─── Ending facts ─────────────────────────────────────────────

test('endingFact: closed wins over dropped over recorded; open briefs have none', () => {
  const all = {
    closedAt: AT, closeReason: 'shipped',
    droppedAt: AT, dropReason: 'dup',
    recordedDecisionAt: AT,
  };
  assert.deepEqual(copy.endingFact(all), { label: 'Closed', reason: 'shipped', at: AT });
  assert.deepEqual(copy.endingFact({ ...all, closedAt: null }), { label: 'Dropped', reason: 'dup', at: AT });
  assert.deepEqual(
    copy.endingFact({ recordedDecisionAt: AT, closedAt: null, droppedAt: null }),
    { label: 'Recorded as decision', reason: null, at: AT }
  );
  assert.equal(copy.endingFact({ closedAt: null, droppedAt: null, recordedDecisionAt: null }), null);
});

test('endingLine reads as the card shows it', () => {
  assert.equal(copy.endingLine({ closedAt: AT, closeReason: 'shipped' }), 'Closed: shipped');
  assert.equal(copy.endingLine({ droppedAt: AT, dropReason: null }), 'Dropped');
  assert.equal(copy.endingLine({ recordedDecisionAt: AT }), 'Recorded as decision');
  assert.equal(copy.endingLine({}), '');
});

// ─── People and dates ─────────────────────────────────────────

test('actorLabel says You only for the caller', () => {
  assert.equal(copy.actorLabel(ME, ME), 'You');
  assert.equal(copy.actorLabel(OTHER, ME), 'A workspace member');
  assert.equal(copy.actorLabel('', ''), 'A workspace member');
});

test('formatDate reads day, month and year, and is empty for no date', () => {
  const out = copy.formatDate(AT);
  assert.match(out, /10/);
  assert.match(out, /Sep/);
  assert.match(out, /2026/);
  assert.equal(copy.formatDate(null), '');
  assert.equal(copy.formatDate('not a date'), '');
});

// ─── History sentences ────────────────────────────────────────

test('eventSentence names the actor and carries the date', () => {
  const mine = copy.eventSentence(ev('comment-added', {}, ME), ME);
  assert.equal(mine.sentence, 'You commented.');
  assert.equal(mine.date, copy.formatDate(AT));
  assert.equal(sentence('comment-added', {}, OTHER), 'A workspace member commented.');
});

test('eventSentence covers every event the web knows', () => {
  const cases = [
    ['created', {}, 'You created this brief as a proposal.'],
    ['created', { kind: 'work' }, 'You created this brief as work.'],
    ['created', { kind: 'work', priority: 'high' }, 'You created this brief as work with high priority.'],
    ['decided', {}, 'You transformed this proposal to work.'],
    ['decided', { priority: 'low' }, 'You transformed this proposal to work with low priority.'],
    ['dropped', {}, 'You dropped this proposal.'],
    ['dropped', { reason: 'dup' }, 'You dropped this proposal: dup.'],
    ['decision-recorded', {}, 'You recorded this proposal as a decision.'],
    ['updated', {}, 'You saved this brief unchanged.'],
    ['updated', { title: 'x' }, 'You changed the title.'],
    ['updated', { title: 'x', body: 'y' }, 'You changed the title and the description.'],
    [
      'updated',
      { title: 'x', body: 'y', priority: 'medium', targetBranch: 'dev' },
      'You changed the title, the description, the priority to medium and the target branch to dev.',
    ],
    ['part-added', {}, 'You added a part.'],
    ['part-added', { title: 'API' }, 'You added the part “API”.'],
    ['part-updated', {}, 'You edited a part.'],
    ['part-removed', {}, 'You removed a part.'],
    ['part-removed', { title: 'API' }, 'You removed the part “API”.'],
    ['parts-reordered', {}, 'You reordered the parts.'],
    ['attachment-added', {}, 'You added an attachment.'],
    ['attachment-added', { title: 'Doc' }, 'You attached “Doc”.'],
    ['attachment-removed', {}, 'You removed an attachment.'],
    ['attachment-removed', { title: 'Doc' }, 'You removed the attachment “Doc”.'],
    ['comment-added', {}, 'You commented.'],
    ['closed', {}, 'You closed this work.'],
    ['closed', { reason: 'shipped' }, 'You closed this work: shipped.'],
    ['reopened', {}, 'You reopened this work.'],
    ['reopened', { ended: 'dropped' }, 'You reopened this dropped proposal.'],
    ['reopened', { ended: 'recorded' }, 'You reopened this proposal recorded as a decision.'],
    ['milestone-set', { milestoneId: 'm1' }, 'You moved this brief into a milestone.'],
    ['milestone-set', { milestoneId: null }, 'You took this brief out of its milestone.'],
    ['assignee-set', { assigneeId: null }, 'You cleared the assignee.'],
    ['assignee-set', { assigneeId: ME }, 'You took this brief on.'],
  ];
  for (const [event, data, expected] of cases) {
    assert.equal(sentence(event, data, ME), expected, `${event} ${JSON.stringify(data)}`);
  }
});

test('shaped reads as the web says it, for one part and for several', () => {
  assert.equal(sentence('shaped', { count: 3 }, ME), 'You shaped this brief into 3 parts.');
  assert.equal(sentence('shaped', { count: 1 }, OTHER), 'A workspace member shaped this brief into 1 part.');
  assert.equal(sentence('shaped', {}, ME), 'You shaped this brief into 0 parts.');
});

test('shapedLine dates a shaped brief and is empty for an unshaped one', () => {
  assert.equal(copy.shapedLine(AT), `Shaped ${copy.formatDate(AT)}`);
  assert.equal(copy.shapedLine(null), '');
  assert.equal(copy.shapedLine('nope'), '');
});

test('started reads as the web says it, for one part and for several', () => {
  assert.equal(sentence('started', { count: 3 }, ME), 'You started work on this brief\'s 3 parts.');
  assert.equal(sentence('started', { count: 1 }, OTHER), 'A workspace member started work on this brief\'s 1 part.');
  assert.equal(sentence('started', {}, ME), 'You started work on this brief\'s 0 parts.');
});

test('startedLine dates a started brief and is empty for an unstarted one', () => {
  assert.equal(copy.startedLine(AT), `Started ${copy.formatDate(AT)}`);
  assert.equal(copy.startedLine(null), '');
  assert.equal(copy.startedLine('nope'), '');
});

test('assignee-set from someone else says who it went to', () => {
  assert.equal(sentence('assignee-set', { assigneeId: ME }, OTHER), 'A workspace member assigned this brief to you.');
  assert.equal(
    sentence('assignee-set', { assigneeId: 'u-third' }, OTHER),
    'A workspace member assigned this brief to a workspace member.'
  );
});

test('an event this port does not know still reads as a sentence', () => {
  assert.equal(sentence('something-new', {}, ME), 'You changed this brief.');
  assert.equal(copy.eventSentence({ event: 'closed', actorId: OTHER, data: null }, ME).sentence, 'A workspace member closed this work.');
});

// ─── Errors ───────────────────────────────────────────────────

test('reasonMessage has a sentence for every read failure and a fallback', () => {
  for (const reason of ['network', 'notFound', 'notConnected', 'unauthorized', 'noWorkspace']) {
    assert.ok(copy.reasonMessage(reason).length > 0);
  }
  assert.match(copy.reasonMessage('other'), /Try again/);
  assert.notEqual(copy.reasonMessage('network'), copy.reasonMessage('other'));
});

// ─── New brief ────────────────────────────────────────────────

test('submitLabel follows the kind, and says Creating… while pending', () => {
  assert.equal(copy.submitLabel('work', false), 'Create work');
  assert.equal(copy.submitLabel('proposal', false), 'Create proposal');
  assert.equal(copy.submitLabel('work', true), 'Creating…');
  assert.equal(copy.submitLabel('proposal', true), 'Creating…');
});

test('createErrorMessage turns reasons into the web\'s sentences', () => {
  assert.equal(copy.createErrorMessage('badRequest'), 'Check the title, description and links, then try again.');
  assert.equal(copy.createErrorMessage('notFound'), 'This project does not exist.');
  assert.equal(copy.createErrorMessage('network'), copy.reasonMessage('network'));
  assert.equal(copy.createErrorMessage('notConnected'), copy.reasonMessage('notConnected'));
  assert.equal(copy.createErrorMessage('other'), 'Something went wrong. Try again.');
  assert.equal(copy.createErrorMessage(undefined), 'Something went wrong. Try again.');
});

test('attachmentNotice names the brief and adds the error sentence', () => {
  assert.equal(
    copy.attachmentNotice(12, 'network'),
    `Brief #12 was created, but some links were not attached. ${copy.reasonMessage('network')}`,
  );
  assert.match(copy.attachmentNotice(3, 'notFound'), /^Brief #3 was created, but some links were not attached\. This brief does not exist\.$/);
  assert.match(copy.attachmentNotice(3, 'other'), /Something went wrong\. Try again\.$/);
});

test('the form\'s fixed sentences match the web', () => {
  assert.equal(copy.TITLE_REQUIRED, 'Give the brief a title.');
  assert.equal(copy.LINK_TITLE_REQUIRED, 'Each link needs a title.');
  assert.equal(copy.INVALID_LINK, 'That is not a full link. It should start with https://.');
  assert.equal(copy.AI_LINKS_TITLE, 'AI conversations & links');
});

// ─── Discussions ──────────────────────────────────────────────

test('discussion-recorded reads as the web says it, with and without a provider', () => {
  const e = (data) => ({ event: 'discussion-recorded', actorId: 'u1', at: '2026-09-21T10:00:00.000Z', data });
  assert.equal(copy.eventSentence(e({ summary: 'S', provider: 'Claude Code' }), 'u1').sentence, 'You recorded a discussion held with Claude Code.');
  assert.equal(copy.eventSentence(e({ summary: 'S' }), 'u2').sentence, 'A workspace member recorded a discussion.');
});

test('discussionRecords keeps the records only, newest first, with who, when and what', () => {
  const events = [
    { id: 'e1', event: 'created', actorId: 'u1', at: '2026-09-01T10:00:00.000Z', data: { kind: 'proposal' } },
    { id: 'e2', event: 'discussion-recorded', actorId: 'u1', at: '2026-09-02T10:00:00.000Z', data: { summary: ' First ', provider: 'Codex CLI' } },
    { id: 'e3', event: 'discussion-recorded', actorId: 'u2', at: '2026-09-05T10:00:00.000Z', data: { summary: 'Second', url: 'https://claude.ai/artifact/y' } },
  ];
  const records = copy.discussionRecords(events, 'u1');
  assert.deepEqual(records.map((r) => r.id), ['e3', 'e2']);
  assert.deepEqual(records[1], { id: 'e2', date: copy.formatDate('2026-09-02T10:00:00.000Z'), actor: 'You', provider: 'Codex CLI', summary: 'First', url: '', inLinks: false });
  assert.equal(records[0].actor, 'A workspace member');
  assert.equal(records[0].url, 'https://claude.ai/artifact/y');
  assert.equal(events[0].id, 'e1'); // the caller's array is not reordered
});

test('discussionRecords drops a non-http(s) url and a record without a summary, and survives no list', () => {
  const records = copy.discussionRecords([
    { id: 'a', event: 'discussion-recorded', data: { summary: '<script>x</script>', url: 'javascript:alert(1)' } },
    { id: 'b', event: 'discussion-recorded', data: { summary: '   ' } },
    { id: 'c', event: 'discussion-recorded', data: null },
  ]);
  assert.deepEqual(records.map((r) => [r.id, r.url, r.summary]), [['a', '', '<script>x</script>']]);
  assert.deepEqual(copy.discussionRecords(undefined), []);
});

test('the Discuss labels', () => {
  assert.equal(copy.DISCUSS_LABEL, 'Discuss');
  assert.equal(copy.GO_TO_DISCUSSION_LABEL, 'Go to discussion');
  assert.equal(copy.DISCUSSIONS_TITLE, 'Discussions');
});

test('discussErrorMessage has a sentence for each reason and a fallback', () => {
  for (const reason of ['notAnOpenProposal', 'unknownTool', 'notFound', 'network', 'notConnected', 'unauthorized', 'noWorkspace']) {
    assert.notEqual(copy.discussErrorMessage(reason), copy.discussErrorMessage('other'), reason);
  }
  assert.match(copy.discussErrorMessage('notAnOpenProposal'), /open proposal/);
  assert.match(copy.discussErrorMessage('whatever'), /could not start/);
});

test('discussionCountLabel counts records and is empty for none or unknown', () => {
  assert.equal(copy.discussionCountLabel(1), '1 discussion recorded');
  assert.equal(copy.discussionCountLabel(2), '2 discussions recorded');
  for (const none of [0, null, undefined, 1.5]) assert.equal(copy.discussionCountLabel(none), '', String(none));
});

test('discussingIn names the lane', () => {
  assert.equal(copy.discussingIn('Frame 3'), 'Discussing in Frame 3');
  assert.equal(copy.discussingIn(''), 'Discussing');
});

test('proposalStage follows the four states', () => {
  const proposal = { kind: 'proposal', status: 'backlog' };
  assert.equal(copy.proposalStage({ brief: proposal, laneOpen: false, discussionCount: 0 }), 'discuss');
  assert.equal(copy.proposalStage({ brief: proposal, laneOpen: false, discussionCount: null }), 'discuss');
  assert.equal(copy.proposalStage({ brief: proposal, laneOpen: true, discussionCount: 2 }), 'discussing');
  assert.equal(copy.proposalStage({ brief: proposal, laneOpen: false, discussionCount: 1 }), 'decide');
  assert.equal(copy.proposalStage({ brief: { kind: 'work', status: 'backlog' }, laneOpen: false, discussionCount: 1 }), 'none');
  assert.equal(copy.proposalStage({ brief: { kind: 'proposal', status: 'closed' }, laneOpen: false }), 'none');
  assert.equal(copy.proposalStage({ brief: { kind: 'work', status: 'active' }, laneOpen: true }), 'discussing');
});

// ─── Shape ────────────────────────────────────────────────────

test('workStage offers Shape only on open, unshaped work', () => {
  const work = { kind: 'work', status: 'backlog', shapedAt: null };
  assert.equal(copy.workStage({ brief: work, laneOpen: false }), 'shape');
  assert.equal(copy.workStage({ brief: { ...work, status: 'active' }, laneOpen: false }), 'shape');
  assert.equal(copy.workStage({ brief: { ...work, shapedAt: '2026-09-20T10:00:00.000Z', startedAt: '2026-09-25T10:00:00.000Z' }, laneOpen: false }), 'none');
  assert.equal(copy.workStage({ brief: { ...work, status: 'closed' }, laneOpen: false }), 'none');
  assert.equal(copy.workStage({ brief: { kind: 'proposal', status: 'backlog', shapedAt: null }, laneOpen: false }), 'none');
  assert.equal(copy.workStage({ brief: null, laneOpen: false }), 'none');
});

test('workStage offers Start Work on open, shaped, unstarted work, even with a lane open', () => {
  const shaped = { kind: 'work', status: 'backlog', shapedAt: '2026-09-20T10:00:00.000Z', startedAt: null };
  assert.equal(copy.workStage({ brief: shaped, laneOpen: false }), 'start');
  assert.equal(copy.workStage({ brief: shaped, laneOpen: true }), 'start');
});

test('workStage does not offer Start Work on a started, closed, unshaped or proposal brief', () => {
  const shaped = { kind: 'work', status: 'backlog', shapedAt: '2026-09-20T10:00:00.000Z', startedAt: null };
  assert.equal(copy.workStage({ brief: { ...shaped, status: 'active', startedAt: '2026-09-25T10:00:00.000Z' }, laneOpen: false }), 'none');
  assert.equal(copy.workStage({ brief: { ...shaped, status: 'closed' }, laneOpen: false }), 'none');
  assert.equal(copy.workStage({ brief: { ...shaped, shapedAt: null }, laneOpen: false }), 'shape');
  assert.equal(copy.workStage({ brief: { ...shaped, kind: 'proposal' }, laneOpen: false }), 'none');
});

test('workStage gives way to an open lane of either purpose', () => {
  assert.equal(copy.workStage({ brief: { kind: 'work', status: 'backlog', shapedAt: null }, laneOpen: true }), 'lane');
  assert.equal(copy.workStage({ brief: { kind: 'proposal', status: 'backlog' }, laneOpen: true }), 'lane');
});

test('laneLabel names the lane by its purpose, and a lane without one is a Discuss lane', () => {
  assert.equal(copy.laneLabel('shape', 'Frame 3'), 'Shaping in Frame 3');
  assert.equal(copy.laneLabel('shape', ''), 'Shaping');
  assert.equal(copy.laneLabel('discuss', 'Frame 3'), 'Discussing in Frame 3');
  assert.equal(copy.laneLabel(undefined, 'Frame 3'), 'Discussing in Frame 3');
});

test('shapedNotice names the brief and its part count, and leaves an unknown count out', () => {
  assert.equal(copy.shapedNotice(5, 1), 'Brief #5 was shaped into 1 part and is ready to run.');
  assert.equal(copy.shapedNotice(5, 3), 'Brief #5 was shaped into 3 parts and is ready to run.');
  assert.equal(copy.shapedNotice(5, undefined), 'Brief #5 was shaped and is ready to run.');
  assert.equal(copy.shapedNotice(5, 0), 'Brief #5 was shaped and is ready to run.');
  assert.equal(copy.OPEN_BRIEF_LABEL, 'Open brief');
});

test('partCountLabel counts a shaped card\'s parts by shape, and is empty for none or unknown', () => {
  assert.equal(copy.partCountLabel({ spec: 1, task: 0 }), '1 spec');
  assert.equal(copy.partCountLabel({ spec: 0, task: 1 }), '1 task');
  assert.equal(copy.partCountLabel({ spec: 2, task: 1 }), '2 specs · 1 task');
  assert.equal(copy.partCountLabel({ spec: 0, task: 3 }), '3 tasks');
  for (const none of [null, undefined, { spec: 0, task: 0 }]) assert.equal(copy.partCountLabel(none), '', String(none));
});

test('the Shape words', () => {
  assert.equal(copy.SHAPE_LABEL, 'Shape');
  assert.equal(copy.GO_TO_SHAPING_LABEL, 'Go to shaping');
  assert.match(copy.SHAPE_HINT, /approve/);
});

test('shapeErrorMessage has a sentence for each reason and a fallback', () => {
  for (const reason of ['notShapeable', 'unknownTool', 'notFound', 'network', 'notConnected', 'unauthorized', 'noWorkspace']) {
    assert.notEqual(copy.shapeErrorMessage(reason), copy.shapeErrorMessage('other'), reason);
  }
  assert.match(copy.shapeErrorMessage('notShapeable'), /not been shaped/);
  assert.match(copy.shapeErrorMessage('unauthorized'), /signed out/);
  assert.match(copy.shapeErrorMessage('whatever'), /could not start/);
});

test('newCommentsLabel and the Move to Work words', () => {
  assert.equal(copy.newCommentsLabel(1), '1 new comment');
  assert.equal(copy.newCommentsLabel(3), '3 new comments');
  assert.equal(copy.newCommentsLabel(0), '');
  assert.equal(copy.MOVE_TO_WORK_LABEL, 'Move to Work');
  assert.equal(copy.REDISCUSS_LABEL, 'Re-discuss');
  assert.match(copy.decideErrorMessage('alreadyWork'), /already moved/);
  assert.match(copy.decideErrorMessage('whatever'), /went wrong/);
});

test('newCommentIds marks others\' comments after the latest record', () => {
  const events = [
    { event: 'discussion-recorded', at: '2026-09-02T10:00:00.000Z' },
    { event: 'discussion-recorded', at: '2026-09-05T10:00:00.000Z' },
  ];
  const comments = [
    { id: 'c1', authorId: 'u2', createdAt: '2026-09-03T10:00:00.000Z' },
    { id: 'c2', authorId: 'u2', createdAt: '2026-09-06T10:00:00.000Z' },
    { id: 'c3', authorId: 'u1', createdAt: '2026-09-07T10:00:00.000Z' },
  ];
  assert.deepEqual([...copy.newCommentIds(comments, events, 'u1')], ['c2']);
  assert.equal(copy.newCommentIds(comments, [], 'u1').size, 0);
});

test('discussionRecords says a write-up went to Links when the brief holds that url', () => {
  const events = [
    { id: 'e1', event: 'discussion-recorded', data: { summary: 'Old', url: 'https://claude.ai/artifact/old' } },
    { id: 'e2', event: 'discussion-recorded', data: { summary: 'New', url: 'https://claude.ai/artifact/new' } },
  ];
  const attachments = [{ id: 'a1', title: 'Discussion write-up (2026-09-21)', url: 'https://claude.ai/artifact/new' }];
  const records = copy.discussionRecords(events, 'u1', attachments);
  assert.deepEqual(records.map((r) => [r.id, r.inLinks]), [['e2', true], ['e1', false]]);
  assert.equal(records[1].url, 'https://claude.ai/artifact/old');
  assert.equal(copy.WRITE_UP_IN_LINKS, 'Write-up added to Links');
});

// ─── Start Work ───────────────────────────────────────────────

test('startErrorMessage has a sentence for every refusal, naming what it can', () => {
  assert.equal(copy.startErrorMessage({ reason: 'recordRefTaken' }),
    'Another brief already uses one of these spec or task names. Pull the latest changes and start again.');
  assert.equal(copy.startErrorMessage({ reason: 'branchTaken', detail: 'feat/login' }), 'A branch named feat/login already exists. Pick another name.');
  assert.equal(copy.startErrorMessage({ reason: 'badBranch', detail: 'a b' }), '“a b” is not a branch name git accepts.');
  assert.equal(copy.startErrorMessage({ reason: 'baseMissing', detail: 'origin/dev' }),
    'The branch origin/dev is not on this machine. Fetch it, or pick another base.');
  assert.equal(copy.startErrorMessage({ reason: 'alreadyBegun', detail: 'feat/login' }), 'This part was already begun on feat/login.');
  assert.equal(copy.startErrorMessage({ reason: 'badDefinition', part: 'Fix typo', detail: 'noDescription' }),
    '“Fix typo” has no Description section. Edit it on the web, then start again.');
  for (const reason of ['notStartable', 'notWork', 'alreadyClosed', 'notShaped', 'alreadyStarted', 'partsMismatch', 'notFound', 'network', 'notConnected', 'unauthorized', 'noWorkspace']) {
    const sentence = copy.startErrorMessage({ reason });
    assert.notEqual(sentence, 'Start Work could not run. Try again.', reason);
    assert.match(sentence, /\.$/, reason);
  }
  assert.equal(copy.startErrorMessage({ reason: 'mystery' }), 'Start Work could not run. Try again.');
  assert.equal(copy.startErrorMessage(null), 'Start Work could not run. Try again.');
});

test('partialMessage names the failed step, what was written and what is missing with its ref', () => {
  assert.equal(copy.partialMessage({
    step: 'files',
    error: 'disk full',
    written: ['login-flow'],
    missing: [{ title: 'Fix typo', shape: 'task', ref: 'task-fix-typo' }],
  }), 'The brief is started in Frame Cloud, but writing the parts failed: disk full. Written: login-flow. '
    + 'Not written — create these by hand under the same names: “Fix typo” (task task-fix-typo).');
  assert.equal(copy.partialMessage({ step: 'branch', written: [], missing: [{ title: 'A', shape: 'spec', ref: 'a' }] }),
    'The brief is started in Frame Cloud, but creating the branch failed. Not written — create these by hand under the same names: “A” (spec a).');
  assert.match(copy.partialMessage({ step: 'stash', written: [], missing: [] }), /stashing your changes failed\.$/);
});

test('startedNotice names the part and its branch, the brief on its first part, and the stash when there was one', () => {
  assert.equal(copy.startedNotice({ mode: 'start', number: 5, part: { title: 'Login flow' }, branch: 'feat/login', stashMessage: null }),
    'Brief #5 started: “Login flow” on feat/login.');
  assert.equal(copy.startedNotice({ mode: 'begin', number: 5, part: { title: 'Fix typo' }, branch: 'fix/typo', stashMessage: 'Start Work #5' }),
    'Began “Fix typo” on fix/typo. Your changes were stashed as “Start Work #5”.');
});

test('the Start Work dialog words', () => {
  assert.equal(copy.START_WORK_LABEL, 'Start Work');
  assert.equal(copy.startDialogTitle(5), 'Start work on brief #5');
  assert.equal(copy.beginWithLabel('Login flow'), 'Begin with “Login flow”');
  assert.equal(copy.ORCHESTRATE_LABEL, 'Orchestrate');
  assert.equal(copy.COMING_SOON, 'Coming soon');
  assert.equal(copy.beginDialogTitle('Fix typo'), 'Begin “Fix typo”');
  assert.equal(copy.FROM_LABEL, 'from');
  assert.equal(copy.dirtyWarning('feat/x', 1), 'feat/x has 1 uncommitted change. Stash them so the new branch starts clean, or cancel and commit them first.');
  assert.match(copy.dirtyWarning('', 3), /^This folder has 3 uncommitted changes\./);
  assert.equal(copy.startSubmitLabel(true), 'Starting…');
  assert.match(copy.baseMissingLine(''), /no target branch/);
  assert.match(copy.baseMissingLine('main'), /^The target branch main is not on this machine\./);
});

test('the part link words', () => {
  assert.equal(copy.OPEN_SPEC_LABEL, 'Open spec');
  assert.equal(copy.OPEN_TASK_LABEL, 'Open task');
  assert.equal(copy.partNotHereMessage('task-fix-typo'), 'task-fix-typo is not in this folder\'s tasks. It may be on another branch or machine.');
});

// ─── A started brief's progress ───────────────────────────────

const specPart = { id: 'p1', shape: 'spec', recordRef: 'login-flow' };
const taskPart = { id: 'p2', shape: 'task', recordRef: 'task-fix-typo' };

test('partStatus reads a spec part by its phase, with the next command to run', () => {
  const at = (phase, extra = {}) => copy.partStatus({ part: specPart, spec: { phase, ...extra } });
  assert.deepEqual(at('specified'), { label: 'Not started', tone: 'idle', run: 'spec.plan', laneName: null });
  assert.deepEqual(at('planned'), { label: 'Planned', tone: 'idle', run: 'spec.tasks', laneName: null });
  assert.deepEqual(at('tasks_generated'), { label: 'Tasks ready', tone: 'idle', run: 'spec.implement', laneName: null });
  assert.deepEqual(at('implementing', { task_count: 7, completed_count: 3 }),
    { label: 'Implementing · 3/7', tone: 'active', run: 'spec.implement', laneName: null });
  assert.equal(at('implementing').label, 'Implementing');
  assert.deepEqual(at('done'), { label: 'Implemented', tone: 'implemented', run: null, laneName: null });
});

test('partStatus reads a task part by its status', () => {
  const at = (status) => copy.partStatus({ part: taskPart, task: { status } });
  assert.deepEqual(at('pending'), { label: 'Not started', tone: 'idle', run: 'task', laneName: null });
  assert.deepEqual(at('in_progress'), { label: 'In progress', tone: 'active', run: 'task', laneName: null });
  assert.deepEqual(at('completed'), { label: 'Implemented', tone: 'implemented', run: null, laneName: null });
});

test('partStatus for a part the folder does not hold: On <branch> when this machine began it, else Not started with Begin', () => {
  assert.deepEqual(copy.partStatus({ part: { ...specPart, begunBranch: 'feat/login' }, task: { status: 'pending' } }),
    { label: 'On feat/login', tone: 'elsewhere', laneName: null, run: null });
  assert.deepEqual(copy.partStatus({ part: taskPart }), { label: 'Not started', tone: 'idle', laneName: null, run: 'begin' });
  assert.deepEqual(copy.partStatus({ part: { ...taskPart, begunBranch: null } }), { label: 'Not started', tone: 'idle', laneName: null, run: 'begin' });
});

test('partStatus reads the folder\'s record first, even for a part begun on another branch', () => {
  assert.equal(copy.partStatus({ part: { ...taskPart, begunBranch: 'fix/typo' }, task: { status: 'in_progress' } }).label, 'In progress');
});

test('partStatus lets a live lane win, and offers no Run then', () => {
  const lane = (status, agentName = 'claude') => ({ name: 'Frame 3', status, agentName });
  assert.deepEqual(copy.partStatus({ part: specPart, spec: { phase: 'specified' }, lane: lane('agent-working') }),
    { label: 'Working', tone: 'active', laneName: 'Frame 3', run: null });
  assert.equal(copy.partStatus({ part: taskPart, task: { status: 'in_progress' }, lane: lane('agent-approval') }).label, 'Needs approval');
  assert.equal(copy.partStatus({ part: taskPart, task: { status: 'in_progress' }, lane: lane('agent-idle') }).label, 'Awaiting input');
  // A lane without a live agent, and a finished part, keep their own state.
  assert.equal(copy.partStatus({ part: taskPart, task: { status: 'pending' }, lane: lane('agent-working', null) }).run, 'task');
  assert.equal(copy.partStatus({ part: taskPart, task: { status: 'completed' }, lane: lane('agent-working') }).label, 'Implemented');
});

test('partStatus of a part without a ref is empty', () => {
  assert.deepEqual(copy.partStatus({ part: { shape: 'spec' } }), { label: '', tone: 'idle', laneName: null, run: null });
  assert.deepEqual(copy.partStatus(), { label: '', tone: 'idle', laneName: null, run: null });
});

test('partsSummary counts merged, in progress and elsewhere, only with more than one part', () => {
  const s = (tone) => ({ tone });
  assert.equal(copy.partsSummary([s('active')]), '');
  assert.equal(copy.partsSummary([]), '');
  assert.equal(copy.partsSummary([s('done'), s('idle')]), '1 of 2 merged');
  assert.equal(copy.partsSummary([s('active'), s('attention'), s('elsewhere'), s('done')]), '1 of 4 merged · 2 in progress · 1 on another branch');
  assert.equal(copy.partsSummary([s('elsewhere'), s('elsewhere'), s('idle')]), '0 of 3 merged · 2 on other branches');
  // An implemented part is neither merged nor in progress: it has its own piece (the web's).
  assert.equal(copy.partsSummary([s('implemented'), s('done')]), '1 of 2 merged · 1 implemented');
});

test('partsSummary counts merged out of the live parts and the dropped beside them', () => {
  const target = 'main';
  const parts = [
    { ...specPart, id: 'a', mergedAt: '2026-11-01T10:00:00.000Z', mergedBase: 'main' },
    { ...taskPart, id: 'b', droppedAt: '2026-11-02T10:00:00.000Z', dropReason: 'Not needed' },
    { ...specPart, id: 'c', recordRef: 'other-spec' },
    { ...taskPart, id: 'd', recordRef: 'task-other' },
  ];
  const statuses = parts.map((part) => copy.partStatus({ part, target }));
  assert.equal(copy.partsSummary(statuses), '1 of 3 merged · 1 dropped');
  const s = (tone) => ({ tone });
  assert.equal(copy.partsSummary([s('dropped'), s('dropped'), s('done')]), '1 of 1 merged · 2 dropped');
  assert.equal(copy.partsSummary([s('active'), s('elsewhere'), s('dropped')]), '0 of 2 merged · 1 in progress · 1 on another branch · 1 dropped');
});

// ─── Done: merged, dropped and the cloud's branch ─────────────

const MERGED = { mergedAt: '2026-11-01T10:00:00.000Z', mergedBase: 'main' };

test('countsAsMerged needs a merge into the brief\'s current target', () => {
  assert.equal(copy.countsAsMerged(MERGED, 'main'), true);
  assert.equal(copy.countsAsMerged(MERGED, 'develop'), false);
  assert.equal(copy.countsAsMerged({ mergedAt: null, mergedBase: 'main' }, 'main'), false);
  assert.equal(copy.countsAsMerged({ mergedAt: '2026-11-01T10:00:00.000Z', mergedBase: null }, 'main'), false);
  assert.equal(copy.countsAsMerged(MERGED, ''), false);
  assert.equal(copy.countsAsMerged(MERGED, undefined), false);
  assert.equal(copy.countsAsMerged(undefined, 'main'), false);
});

test('partStatus reads a dropped part first, with its reason and no Run', () => {
  const dropped = { ...specPart, droppedAt: '2026-11-02T10:00:00.000Z', dropReason: 'Covered by #12' };
  assert.deepEqual(copy.partStatus({ part: dropped, spec: { phase: 'implementing' }, target: 'main' }),
    { label: 'Dropped · Covered by #12', tone: 'dropped', laneName: null, run: null });
  assert.equal(copy.partStatus({ part: { ...dropped, dropReason: null }, target: 'main' }).label, 'Dropped');
  // Dropped wins over a merge and a live lane.
  const lane = { name: 'Frame 3', status: 'agent-working', agentName: 'claude' };
  assert.equal(copy.partStatus({ part: { ...dropped, ...MERGED }, lane, target: 'main' }).tone, 'dropped');
});

test('partStatus reads a merged part as Merged into <target>, with no Run or Begin, whatever its local state', () => {
  const merged = { ...taskPart, ...MERGED };
  const want = { label: 'Merged into main', tone: 'done', laneName: null, run: null };
  assert.deepEqual(copy.partStatus({ part: merged, task: { status: 'pending' }, target: 'main' }), want);
  assert.deepEqual(copy.partStatus({ part: merged, task: { status: 'completed' }, target: 'main' }), want);
  assert.deepEqual(copy.partStatus({ part: merged, target: 'main' }), want);
  assert.deepEqual(copy.partStatus({ part: { ...merged, branch: 'fix/typo' }, target: 'main' }), want);
});

test('partStatus lets a merge win over a live lane', () => {
  const lane = { name: 'Frame 3', status: 'agent-working', agentName: 'claude' };
  assert.deepEqual(copy.partStatus({ part: { ...specPart, ...MERGED }, spec: { phase: 'implementing' }, lane, target: 'main' }),
    { label: 'Merged into main', tone: 'done', laneName: null, run: null });
});

test('partStatus reads a part merged into an old target by its local state again', () => {
  const part = { ...specPart, ...MERGED };
  assert.deepEqual(copy.partStatus({ part, spec: { phase: 'done' }, target: 'develop' }),
    { label: 'Implemented', tone: 'implemented', run: null, laneName: null });
  assert.equal(copy.partStatus({ part: { ...part, branch: 'feat/login' }, target: 'develop' }).label, 'On feat/login');
});

test('partStatus reads the cloud\'s branch for a part begun on another machine', () => {
  assert.deepEqual(copy.partStatus({ part: { ...specPart, branch: 'feat/login' }, target: 'main' }),
    { label: 'On feat/login', tone: 'elsewhere', laneName: null, run: null });
  // The cloud's branch wins over this machine's older record of it.
  assert.equal(copy.partStatus({ part: { ...specPart, branch: 'feat/login-2', begunBranch: 'feat/login' } }).label, 'On feat/login-2');
  // The folder's record still wins over the cloud's branch.
  assert.equal(copy.partStatus({ part: { ...taskPart, branch: 'fix/typo' }, task: { status: 'in_progress' } }).label, 'In progress');
});

test('partStatus skips the cloud\'s branch when this machine\'s own branch is gone, so Begin comes back', () => {
  const gone = { ...taskPart, branch: 'fix/typo', branchGone: true, begunBranch: null };
  assert.deepEqual(copy.partStatus({ part: gone, target: 'main' }), { label: 'Not started', tone: 'idle', laneName: null, run: 'begin' });
});

// ─── GitHub tracking: a part's pull request ───────────────────

const PR_URL = 'https://github.com/lab/my-app/pull/7';
/** A part with an open PR #7 into main, and the given review. */
const openPr = (review = null, extra = {}) => ({
  ...taskPart, branch: 'fix/typo', prNumber: 7, prState: 'open', prBase: 'main', prReview: review, prUrl: PR_URL, ...extra,
});

test('partStatus reads an open PR by its review, after its number', () => {
  const at = (review) => copy.partStatus({ part: openPr(review), target: 'main' });
  const pr = (kind) => ({ number: 7, url: PR_URL, kind, base: 'main' });
  assert.deepEqual(at(null), { label: 'PR #7 · Open', tone: 'review', laneName: null, run: null, pr: pr('review') });
  assert.deepEqual(at('requested'), { label: 'PR #7 · In review', tone: 'review', laneName: null, run: null, pr: pr('review') });
  assert.deepEqual(at('approved'), { label: 'PR #7 · Approved', tone: 'review', laneName: null, run: null, pr: pr('review') });
  assert.deepEqual(at('changes_requested'),
    { label: 'PR #7 · Changes requested', tone: 'attention', laneName: null, run: null, pr: pr('changes') });
});

test('partStatus reads a PR merged into another base as Merged into <base>, not <target>', () => {
  const part = openPr(null, { prState: 'merged', prBase: 'release' });
  assert.deepEqual(copy.partStatus({ part, target: 'main' }), {
    label: 'Merged into release, not main', tone: 'attention', laneName: null, run: null,
    pr: { number: 7, url: PR_URL, kind: 'offTarget', base: 'release' },
  });
});

test('partStatus still reads a part the cloud counts as merged into the target as Merged into <target>', () => {
  const part = openPr(null, { prState: 'merged', ...MERGED });
  assert.deepEqual(copy.partStatus({ part, target: 'main' }), { label: 'Merged into main', tone: 'done', laneName: null, run: null });
});

test('partStatus lets a closed PR, or one merged into the target before the cloud counts it, fall through', () => {
  assert.equal(copy.partStatus({ part: openPr(null, { prState: 'closed' }), target: 'main' }).label, 'On fix/typo');
  assert.equal(copy.partStatus({ part: openPr('approved', { prState: 'merged' }), target: 'main' }).label, 'On fix/typo');
  assert.equal(copy.partStatus({ part: openPr(null, { prState: 'closed' }), task: { status: 'in_progress' }, target: 'main' }).label,
    'In progress');
});

test('partStatus lets a live lane on an unfinished record win over an open PR', () => {
  const lane = { name: 'Frame 3', status: 'agent-working', agentName: 'claude' };
  assert.deepEqual(copy.partStatus({ part: openPr('changes_requested'), task: { status: 'in_progress' }, lane, target: 'main' }),
    { label: 'Working', tone: 'active', laneName: 'Frame 3', run: null });
  // A finished record's lane does not win: the PR does.
  assert.equal(copy.partStatus({ part: openPr('approved'), task: { status: 'completed' }, lane, target: 'main' }).label, 'PR #7 · Approved');
  // A lane without a live agent does not win either.
  assert.equal(copy.partStatus({ part: openPr(), task: { status: 'pending' }, lane: { ...lane, agentName: null }, target: 'main' }).label,
    'PR #7 · Open');
});

test('partStatus keeps the folder record\'s Run on a PR row, and none when the folder does not hold it', () => {
  assert.equal(copy.partStatus({ part: openPr('changes_requested'), task: { status: 'pending' }, target: 'main' }).run, 'task');
  const spec = copy.partStatus({ part: { ...openPr(), shape: 'spec', recordRef: 'login-flow' }, spec: { phase: 'implementing' }, target: 'main' });
  assert.deepEqual([spec.label, spec.run], ['PR #7 · Open', 'spec.implement']);
  assert.equal(copy.partStatus({ part: openPr(), task: { status: 'completed' }, target: 'main' }).run, null);
  assert.equal(copy.partStatus({ part: openPr(), target: 'main' }).run, null);
  const offTarget = openPr(null, { prState: 'merged', prBase: 'release' });
  assert.equal(copy.partStatus({ part: offTarget, task: { status: 'in_progress' }, target: 'main' }).run, 'task');
});

test('partStatus on a Done brief keeps a PR row\'s label and link but offers no Run', () => {
  const facts = { part: openPr('changes_requested'), task: { status: 'pending' }, target: 'main' };
  const open = copy.partStatus(facts);
  assert.deepEqual(copy.partStatus({ ...facts, done: true }), { ...open, run: null });
  assert.equal(copy.partStatus({ ...facts, done: true }).pr.url, PR_URL);
});

test('partStatus shows no PR row unless tracking is ready', () => {
  for (const tracking of ['off', 'needs_github']) {
    assert.deepEqual(copy.partStatus({ part: openPr('approved'), target: 'main', tracking }),
      { label: 'On fix/typo', tone: 'elsewhere', laneName: null, run: null }, tracking);
    const offTarget = openPr(null, { prState: 'merged', prBase: 'release' });
    assert.equal(copy.partStatus({ part: offTarget, task: { status: 'in_progress' }, target: 'main', tracking }).label, 'In progress', tracking);
  }
  assert.equal(copy.partStatus({ part: openPr('approved'), target: 'main', tracking: 'ready' }).label, 'PR #7 · Approved');
  assert.equal(copy.partStatus({ part: openPr('approved'), target: 'main' }).label, 'PR #7 · Approved');
});

test('partStatus reads a PR with no URL with a null url, and no PR row for a bad number', () => {
  assert.equal(copy.partStatus({ part: openPr(null, { prUrl: null }), target: 'main' }).pr.url, null);
  assert.equal(copy.partStatus({ part: openPr(null, { prNumber: null }), target: 'main' }).label, 'On fix/typo');
  assert.equal(copy.partStatus({ part: openPr(null, { prNumber: 0 }), target: 'main' }).label, 'On fix/typo');
});

test('partStatus reads the cloud\'s completion as Implemented for a part the folder does not hold', () => {
  const completed = { ...taskPart, branch: 'fix/typo', completionSha: 'a'.repeat(40) };
  for (const tracking of ['ready', 'off', 'needs_github']) {
    assert.deepEqual(copy.partStatus({ part: completed, target: 'main', tracking }),
      { label: 'Implemented', tone: 'implemented', laneName: null, run: null }, tracking);
  }
  // The folder's own record wins: work restarted after the completion.
  assert.deepEqual(copy.partStatus({ part: completed, task: { status: 'in_progress' }, target: 'main' }),
    { label: 'In progress', tone: 'active', laneName: null, run: 'task' });
  // An open PR wins over the completion while tracking is ready.
  assert.equal(copy.partStatus({ part: { ...openPr(), completionSha: 'a'.repeat(40) }, target: 'main' }).label, 'PR #7 · Open');
});

test('partStatus gives no pr to a row without PR fields', () => {
  const rows = [
    copy.partStatus({ part: taskPart }),
    copy.partStatus({ part: taskPart, task: { status: 'in_progress' } }),
    copy.partStatus({ part: { ...taskPart, branch: 'fix/typo' }, target: 'main' }),
    copy.partStatus({ part: { ...taskPart, ...MERGED }, target: 'main' }),
  ];
  for (const row of rows) assert.equal('pr' in row, false, row.label);
});

// ─── GitHub tracking: the summary and the attention line ──────

/** A status with a tone, and a PR of `kind` when given. */
const st = (tone, kind) => (kind ? { tone, pr: { number: 7, url: null, kind, base: kind === 'offTarget' ? 'release' : 'main' } } : { tone });

test('partsSummary under ready reads every piece in the web\'s order, then Frame\'s own', () => {
  const all = [
    st('done'), st('review', 'review'), st('review', 'review'), st('attention', 'changes'), st('implemented'),
    st('active'), st('elsewhere'), st('dropped'), st('attention', 'offTarget'),
  ];
  assert.equal(copy.partsSummary(all, 'ready'),
    '1 of 8 merged · 2 in review · 1 changes requested · 1 implemented · 1 in progress · 1 on another branch · 1 dropped');
  assert.equal(copy.partsSummary(all), copy.partsSummary(all, 'ready'));
});

test('partsSummary leaves out every zero piece', () => {
  assert.equal(copy.partsSummary([st('review', 'review'), st('idle')]), '0 of 2 merged · 1 in review');
  assert.equal(copy.partsSummary([st('attention', 'changes'), st('attention', 'changes'), st('done')]), '1 of 3 merged · 2 changes requested');
  assert.equal(copy.partsSummary([st('idle'), st('idle')]), '0 of 2 merged');
});

test('partsSummary counts a lane\'s attention as in progress, but not a PR\'s', () => {
  assert.equal(copy.partsSummary([st('attention'), st('attention', 'changes'), st('attention', 'offTarget')]),
    '0 of 3 merged · 1 changes requested · 1 in progress');
});

test('partsSummary when tracking is not ready counts merged parts as implemented', () => {
  for (const tracking of ['off', 'needs_github']) {
    assert.equal(copy.partsSummary([st('done'), st('implemented'), st('idle')], tracking), '2 of 3 implemented', tracking);
    assert.equal(copy.partsSummary([st('implemented'), st('active'), st('attention'), st('elsewhere'), st('dropped')], tracking),
      '1 of 4 implemented · 2 in progress · 1 on another branch · 1 dropped', tracking);
    assert.equal(copy.partsSummary([st('idle'), st('idle')], tracking), '0 of 2 implemented', tracking);
  }
});

test('partsSummary is still empty for one part or none, in both modes', () => {
  for (const tracking of ['ready', 'off']) {
    assert.equal(copy.partsSummary([st('review', 'review')], tracking), '');
    assert.equal(copy.partsSummary([], tracking), '');
    assert.equal(copy.partsSummary(undefined, tracking), '');
  }
});

test('partsSummary over real rows: an off project reads implemented', () => {
  const parts = [
    { ...taskPart, id: 'a', ...MERGED },
    { ...taskPart, id: 'b', recordRef: 'task-b', completionSha: 'a'.repeat(40) },
    { ...taskPart, id: 'c', recordRef: 'task-c', prNumber: 3, prState: 'open', prBase: 'main', prReview: null },
  ];
  const rows = (tracking) => parts.map((part) => copy.partStatus({ part, target: 'main', tracking }));
  assert.equal(copy.partsSummary(rows('off'), 'off'), '2 of 3 implemented');
  assert.equal(copy.partsSummary(rows('ready'), 'ready'), '1 of 3 merged · 1 in review · 1 implemented');
});

test('partAttention names the first flagged part, in order, and how many more', () => {
  const entries = [
    { title: 'Read it', status: st('review', 'review') },
    { title: 'Store it', status: st('attention', 'changes') },
    { title: 'Ship it', status: st('attention', 'offTarget') },
  ];
  assert.equal(copy.partAttention(entries, 'main'), 'Changes requested on Store it · 1 more');
  assert.equal(copy.partAttention(entries.slice(2), 'main'), 'Ship it merged into release, not main');
  assert.equal(copy.partAttention([entries[1]], 'main'), 'Changes requested on Store it');
  assert.equal(copy.partAttention([...entries, ...entries], 'main'), 'Changes requested on Store it · 3 more');
});

test('partAttention is empty when nothing asks, and ignores a lane\'s attention', () => {
  assert.equal(copy.partAttention([{ title: 'A', status: st('review', 'review') }, { title: 'B', status: st('attention') }], 'main'), '');
  assert.equal(copy.partAttention([], 'main'), '');
  assert.equal(copy.partAttention(undefined, 'main'), '');
});

test('partAttention over real rows: a live lane on the part, or tracking off, flags nothing', () => {
  const part = openPr('changes_requested');
  const lane = { name: 'Frame 3', status: 'agent-working', agentName: 'claude' };
  const at = (facts) => copy.partAttention([{ title: 'Store it', status: copy.partStatus({ part, target: 'main', ...facts }) }], 'main');
  assert.equal(at({}), 'Changes requested on Store it');
  assert.equal(at({ task: { status: 'in_progress' }, lane }), '');
  assert.equal(at({ tracking: 'off' }), '');
});

test('prLabel and the review words match the web', () => {
  assert.equal(copy.prLabel(12), 'PR #12');
  assert.deepEqual(copy.REVIEW_LABELS, { requested: 'In review', approved: 'Approved', changes_requested: 'Changes requested' });
});

// Overturns frame-cloud-brief-done D2's "Merges are tracked once GitHub is connected." (plan D4).
test('the tracking box is the web\'s, word for word, for no GitHub and for tracking off', () => {
  assert.deepEqual(copy.trackingWarning('needs_github'), {
    title: 'Not connected to GitHub',
    description: 'Pull requests and merges are not tracked. Connect GitHub in Settings.',
  });
  assert.deepEqual(copy.trackingWarning('off'), {
    title: 'GitHub tracking is off',
    description: 'Pull requests and merges are not tracked. Turn it on in Settings.',
  });
  assert.equal(copy.trackingWarning('ready'), null);
  assert.equal(copy.trackingWarning(undefined), null);
  assert.equal(copy.trackingWarning('maybe'), null);
  assert.equal(copy.OPEN_ON_WEB_LABEL, 'Open on web');
});

test('the Done words', () => {
  assert.equal(copy.IMPLEMENTED_LABEL, 'Implemented');
  assert.equal(copy.droppedLabel('Not needed'), 'Dropped · Not needed');
  assert.equal(copy.droppedLabel(null), 'Dropped');
  assert.equal(copy.mergedLabel('main'), 'Merged into main');
});

// ─── Moving to Done and back (manual Done) ────────────────────

test('the move words match the web', () => {
  assert.equal(copy.MOVE_TO_DONE_LABEL, 'Move to Done');
  assert.equal(copy.MOVE_BACK_LABEL, 'Move back to Active');
  assert.equal(copy.MOVING_TO_DONE_LABEL, 'Moving to Done…');
  assert.equal(copy.READY_FOR_DONE_LABEL, 'Ready for Done');
  assert.equal(copy.UNDO_LABEL, 'Undo');
  assert.equal(copy.REASON_LABEL, 'Reason');
  assert.equal(copy.MOVE_TO_DONE_ANYWAY_LABEL, 'Move to Done anyway');
  assert.equal(copy.movedNotice(5), 'Moved #5 to Done');
  assert.equal(copy.moveToDoneTitle(5), 'Move #5 to Done?');
  assert.equal(copy.moveBackTitle(5), 'Move #5 back to Active?');
  assert.equal(
    copy.moveToDoneDescription('main'),
    'Some parts are not merged into main yet, so the move records why the brief is done anyway.'
  );
  assert.equal(
    copy.MOVE_BACK_DESCRIPTION,
    'The brief returns to Active with its parts as they are, and Close and the target branch open again. The move records why.'
  );
});

test('missingPartsLine counts one part and several, naming the target', () => {
  assert.equal(copy.missingPartsLine(1, 'main'), '1 part not merged into main.');
  assert.equal(copy.missingPartsLine(3, 'develop'), '3 parts not merged into develop.');
  assert.equal(copy.missingPartsLine(2, ''), '2 parts not merged.');
});

const LIVE = (id, extra = {}) => ({ id, title: id, shape: 'task', recordRef: `task-${id}`, mergedAt: null, mergedBase: null, droppedAt: null, ...extra });

test('missingParts keeps live parts that do not count on the current target, in part order', () => {
  const brief = {
    targetBranch: 'main',
    parts: [
      LIVE('a'),
      LIVE('b', MERGED),
      LIVE('c', { droppedAt: '2026-11-02T10:00:00.000Z' }),
      LIVE('d', { mergedAt: '2026-11-01T10:00:00.000Z', mergedBase: 'develop' }),
      LIVE('e', { branch: 'fix/e' }),
    ],
  };
  assert.deepEqual(copy.missingParts(brief).map((p) => p.id), ['a', 'd', 'e']);
  // Every live part merged, or only dropped ones left: nothing is missing.
  assert.deepEqual(copy.missingParts({ targetBranch: 'main', parts: [LIVE('b', MERGED), LIVE('c', { droppedAt: 'x' })] }), []);
  // No parts read yet (the card of an unshaped brief), or no brief.
  assert.deepEqual(copy.missingParts({ targetBranch: 'main', parts: null }), []);
  assert.deepEqual(copy.missingParts(undefined), []);
});

test('needsReason asks only when tracking is ready and a live part is missing', () => {
  const missing = { targetBranch: 'main', parts: [LIVE('a'), LIVE('b', MERGED)] };
  const allMerged = { targetBranch: 'main', parts: [LIVE('b', MERGED), LIVE('c', { droppedAt: 'x' })] };
  assert.equal(copy.needsReason({ ...missing, mergeTracking: 'ready' }), true);
  assert.equal(copy.needsReason({ ...missing, mergeTracking: 'needs_github' }), false, 'untracked: nothing can be checked');
  assert.equal(copy.needsReason({ ...allMerged, mergeTracking: 'ready' }), false);
  assert.equal(copy.needsReason({ ...missing }), false, 'no tracking state read');
  assert.equal(copy.needsReason(undefined), false);
});

test('doneLine reads as the web\'s header: with a reason, without one, and empty when not Done', () => {
  const at = '2026-11-08T12:00:00.000Z';
  assert.equal(copy.doneLine({ status: 'done', doneAt: at, doneReason: 'Docs follow in #12' }), `Done: Docs follow in #12 · ${copy.formatDate(at)}`);
  assert.equal(copy.doneLine({ status: 'done', doneAt: at, doneReason: null }), `Done · ${copy.formatDate(at)}`);
  assert.equal(copy.doneLine({ status: 'done', doneAt: null, doneReason: null }), 'Done');
  assert.equal(copy.doneLine({ status: 'active', doneAt: null, doneReason: null }), '');
  assert.equal(copy.doneLine({ status: 'closed', doneAt: at, doneReason: 'x' }), '');
  assert.equal(copy.doneLine(undefined), '');
});

test('the move History sentences match the web', () => {
  assert.equal(sentence('done', { target: 'main', reason: null, missing: [] }, ME), 'You moved this brief to Done.');
  assert.equal(sentence('done', { target: 'main', reason: 'Shipped', missing: [] }, OTHER), 'A workspace member moved this brief to Done: “Shipped”.');
  assert.equal(
    sentence('done', { target: 'main', reason: 'Docs later', missing: [{ partId: 'p1', title: 'Docs' }] }, ME),
    'You moved this brief to Done with 1 part not merged into main: “Docs later”.'
  );
  assert.equal(
    sentence('done', { target: 'develop', reason: 'Enough', missing: [{ partId: 'p1' }, { partId: 'p2' }] }, ME),
    'You moved this brief to Done with 2 parts not merged into develop: “Enough”.'
  );
  assert.equal(sentence('done-reverted', { reason: 'Docs part is not done' }, ME), 'You moved this brief back to Active: “Docs part is not done”.');
  assert.equal(sentence('done-reverted', {}, OTHER), 'A workspace member moved this brief back to Active.');
});

test('an old automatic done reads as an observation, with no actor in front', () => {
  assert.equal(sentence('done', { target: 'main' }, ME), 'This brief is done: every part is merged into main.');
  assert.equal(sentence('done', {}, OTHER), 'This brief is done: every part is merged.');
  // Written by the cloud before manual Done, so it may have no actor at all.
  assert.equal(copy.eventSentence({ id: 'e', at: AT, actorId: '', event: 'done', data: { target: 'main' } }, ME).sentence,
    'This brief is done: every part is merged into main.');
});

test('isObserved covers the old automatic done and a part merged', () => {
  assert.equal(copy.isObserved(ev('done', { target: 'main' })), true);
  assert.equal(copy.isObserved(ev('done', { target: 'main', missing: [] })), false);
  assert.equal(copy.isObserved(ev('done-reverted', { reason: 'x' })), false);
  // Overturns frame-cloud-brief-manual-done D8: part-merged reads as the cloud's observation (D19).
  assert.equal(copy.isObserved(ev('part-merged', { title: 'A' })), true);
  assert.equal(copy.isObserved(ev('part-merged')), true);
  assert.equal(copy.isObserved(undefined), false);
});

const MERGE_SHA = '0123456789abcdef0123456789abcdef01234567';

test('part-merged reads as the web says it, with no actor', () => {
  assert.equal(sentence('part-merged', { title: 'Store it', target: 'main', sha: MERGE_SHA }, OTHER),
    '“Store it” merged into main at 0123456.');
  assert.equal(sentence('part-merged', { title: 'Store it', target: 'main', sha: MERGE_SHA, pr: 12 }, ME),
    '“Store it” merged into main at 0123456 through PR #12.');
  // Written by the cloud, so it may have no actor at all.
  assert.equal(copy.eventSentence({ id: 'e', at: AT, actorId: '', event: 'part-merged', data: { title: 'A', target: 'main' } }, ME).sentence,
    '“A” merged into main.');
});

test('part-merged leaves out what the event does not carry', () => {
  assert.equal(sentence('part-merged', { target: 'main', sha: MERGE_SHA }, OTHER), 'A part merged into main at 0123456.');
  assert.equal(sentence('part-merged', { title: 'Store it', sha: MERGE_SHA }, OTHER), '“Store it” merged at 0123456.');
  assert.equal(sentence('part-merged', { title: 'Store it', target: 'main' }, OTHER), '“Store it” merged into main.');
  assert.equal(sentence('part-merged', { title: 'Store it', target: 'main', pr: 12 }, OTHER), '“Store it” merged into main through PR #12.');
  assert.equal(sentence('part-merged', {}, OTHER), 'A part merged.');
  // " through PR #N" only for a number.
  assert.equal(sentence('part-merged', { title: 'Store it', pr: '12' }, OTHER), '“Store it” merged.');
});

test('moveErrorMessage has the web\'s sentence for every refusal, the shared ones and a fallback', () => {
  assert.equal(copy.moveErrorMessage('alreadyDone'), 'This brief is done, so it cannot be closed and its target is fixed. Move it back to Active first.');
  assert.equal(copy.moveErrorMessage('notDone'), 'This brief is not done.');
  assert.equal(copy.moveErrorMessage('notStarted'), 'Work on this brief has not started yet.');
  assert.equal(copy.moveErrorMessage('alreadyClosed'), 'This brief is already closed.');
  assert.equal(copy.moveErrorMessage('notWork'), 'Only work can take a priority, a milestone, parts, a start or a close.');
  assert.equal(copy.moveErrorMessage('reasonRequired'), 'Give a reason.');
  assert.equal(copy.moveErrorMessage('notFound'), copy.decideErrorMessage('notFound'));
  for (const reason of ['network', 'notConnected', 'unauthorized', 'noWorkspace']) {
    assert.equal(copy.moveErrorMessage(reason), copy.reasonMessage(reason), reason);
  }
  assert.equal(copy.moveErrorMessage('other'), 'Something went wrong. Try again.');
  assert.equal(copy.moveErrorMessage(undefined), 'Something went wrong. Try again.');
});

test('partStatus on a Done brief keeps every label but offers no Begin or Run', () => {
  const lane = { name: 'Frame 3', status: 'agent-working', agentName: 'claude' };
  const cases = [
    { part: taskPart },
    { part: specPart, spec: { phase: 'planned' } },
    { part: specPart, spec: { phase: 'implementing', task_count: 4, completed_count: 1 } },
    { part: taskPart, task: { status: 'in_progress' } },
    { part: taskPart, task: { status: 'in_progress' }, lane },
    { part: { ...taskPart, ...MERGED }, target: 'main' },
    { part: { ...taskPart, branch: 'fix/typo' }, target: 'main' },
  ];
  for (const facts of cases) {
    const open = copy.partStatus(facts);
    const done = copy.partStatus({ ...facts, done: true });
    assert.deepEqual(done, { ...open, run: null }, JSON.stringify(facts));
  }
  assert.equal(copy.partStatus({ part: taskPart, done: true }).label, 'Not started');
  // After a move back, the same part offers Begin and Run again.
  assert.equal(copy.partStatus({ part: taskPart, done: false }).run, 'begin');
  assert.equal(copy.partStatus({ part: specPart, spec: { phase: 'planned' } }).run, 'spec.tasks');
});

test('Run, its hints and the lane line', () => {
  assert.equal(copy.runLabel('task'), 'Run');
  assert.equal(copy.runLabel('begin'), 'Begin');
  for (const run of ['spec.plan', 'spec.tasks', 'spec.implement', 'task', 'begin']) assert.match(copy.runHint(run), /\.$/, run);
  assert.equal(copy.runHint(null), '');
  assert.equal(copy.laneLine('Frame 3'), 'in Frame 3');
});

// ─── Roles ────────────────────────────────────────────────────

test('roleForbidden reads the one role sentence in every message table', () => {
  assert.equal(copy.reasonMessage('roleForbidden'), ROLE_FORBIDDEN);
  assert.equal(copy.decideErrorMessage('roleForbidden'), ROLE_FORBIDDEN);
  assert.equal(copy.discussErrorMessage('roleForbidden'), ROLE_FORBIDDEN);
  assert.equal(copy.shapeErrorMessage('roleForbidden'), ROLE_FORBIDDEN);
  assert.equal(copy.startErrorMessage({ reason: 'roleForbidden' }), ROLE_FORBIDDEN);
  assert.equal(copy.moveErrorMessage('roleForbidden'), ROLE_FORBIDDEN);
  assert.equal(copy.createErrorMessage('roleForbidden'), ROLE_FORBIDDEN);
});
