/**
 * cloudTour — the five-step tour on the left of the signed-out Frame Cloud
 * window (frame-cloud-header-entry spec): its words, its fixed sample data
 * and the stepping rules. `cloudWelcome.js` is the DOM host.
 *
 * Every claim here is something Frame does today. The examples are fixed
 * sample data: they are never the user's briefs and read no cloud state.
 * Nothing names a trial, a price or a paid tier; "plan" is allowed here and
 * only here, because planning is the tour's subject.
 *
 * Each step is `{ id, name, title, lede, example }`, and an example is one of
 *   { kind: 'features', items: [{ title, text }] }
 *   { kind: 'board', milestone: { name, due, progress, ratio },
 *     columns: [{ name, cards: [{ number, kind, title, foot, tone, parts? }] }] }
 *   { kind: 'lane', chip, lines: [{ who, text }], record: { title, text }, action }
 *   { kind: 'parts', chip, rows: [{ label, status, tone }], note?, action? }
 * A `tone` is one of TONES; the host maps it to a class.
 * Pure: no DOM, no Electron, so `node --test` covers it.
 */

const EYEBROW = 'Frame Cloud';

const TRUST_LEAD = 'Your code stays on your machines.';
const TRUST = `${TRUST_LEAD} Frame Cloud stores briefs, project names and branch names, never your source.`;

const EXAMPLE_KINDS = ['features', 'board', 'lane', 'parts'];
const TONES = ['ok', 'review', 'active', 'muted'];

const STEPS = [
  {
    id: 'overview',
    name: 'Overview',
    title: 'Plan the work where the code is.',
    lede: 'Frame Cloud adds the plan to your project: what you decided to build and how far it is. Use it on your own, or bring a team.',
    example: {
      kind: 'features',
      items: [
        { title: 'A board for your plan', text: 'Proposals and work in one place, in Frame and on the web.' },
        { title: 'Decide with your agent', text: 'Discuss a proposal inside the project. What you settle is recorded on the brief.' },
        { title: 'Briefs become specs and tasks', text: 'The agent splits the work against your code. Each part starts on its own branch.' },
        { title: 'Progress from GitHub', text: 'Pull requests, reviews and merges update the brief for you.' },
        { title: 'Milestones', text: 'What the current milestone holds and how far it is, on the board and on Home.' },
        { title: 'Solo or with a team', text: 'Start with a workspace of your own. Invite people as admin, developer or viewer when you need them.' },
      ],
    },
  },
  {
    id: 'board',
    name: 'Board',
    title: 'One board, from idea to done.',
    lede: 'Every brief is a proposal or a piece of work. The started milestone sits on top, and the same board opens on the web and on your other machines.',
    example: {
      kind: 'board',
      milestone: { name: 'Beta launch', due: 'Ends Nov 20, 2026', progress: '4 of 9 done', ratio: 4 / 9 },
      columns: [
        {
          name: 'Backlog',
          cards: [
            { number: 14, kind: 'Proposal', title: 'Offline mode for the board', foot: '2 new comments', tone: 'muted' },
          ],
        },
        {
          name: 'Active',
          cards: [
            {
              number: 12,
              kind: 'Work',
              title: 'Per-device connection',
              foot: '1 of 3 merged · 1 in review',
              tone: 'muted',
              parts: [
                { label: 'Spec · Connection record', status: 'Merged', tone: 'ok' },
                { label: 'Spec · Connect in place', status: 'PR #41 · In review', tone: 'review' },
                { label: 'Task · Disconnect dialog', status: 'In progress', tone: 'active' },
              ],
            },
          ],
        },
        {
          name: 'Done',
          cards: [
            { number: 9, kind: 'Work', title: 'Roles for workspace members', foot: '2 specs · 1 task', tone: 'ok' },
          ],
        },
      ],
    },
  },
  {
    id: 'discuss',
    name: 'Discuss',
    title: 'Talk a proposal through with your agent.',
    lede: 'Discuss opens an agent in the project with the brief and its comments. When you agree, what you settled is recorded on the brief for everyone.',
    example: {
      kind: 'lane',
      chip: '#14 · Offline mode for the board',
      lines: [
        { who: 'Agent', text: 'I read the brief, 2 comments and the board code. The open question is what happens to a move made offline.' },
        { who: 'You', text: 'Queue it and send it when the connection is back.' },
      ],
      record: {
        title: 'Recorded on the brief',
        text: "Offline moves are queued and sent on reconnect. Conflicts keep the server's state.",
      },
      action: 'Move to Work',
    },
  },
  {
    id: 'shape',
    name: 'Shape & Start',
    title: 'The brief becomes specs and tasks.',
    lede: 'Shape lets the agent split the work against your code. Each part then starts on its own branch, with its spec or task already written in the folder.',
    example: {
      kind: 'parts',
      chip: '#14 · shaped into 3 parts',
      rows: [
        { label: 'Spec · Queue for offline moves', status: 'On feat/offline-queue', tone: 'active' },
        { label: 'Spec · Reconnect and replay', status: 'Not started · Begin', tone: 'muted' },
        { label: 'Task · Offline indicator in the header', status: 'Not started · Begin', tone: 'muted' },
      ],
      note: '.frame/specs/offline-queue/spec.md → /spec.plan',
    },
  },
  {
    id: 'track',
    name: 'Track',
    title: 'Progress comes from GitHub.',
    lede: 'Nobody writes a status update. Pull requests, reviews and merges show on each part, and you move the brief to Done when the work is finished.',
    example: {
      kind: 'parts',
      chip: '#14 · 1 of 3 merged · 1 in review',
      rows: [
        { label: 'Spec · Queue for offline moves', status: 'Merged into main', tone: 'ok' },
        { label: 'Spec · Reconnect and replay', status: 'PR #52 · In review', tone: 'review' },
        { label: 'Task · Offline indicator in the header', status: 'Implemented', tone: 'muted' },
      ],
      action: 'Move to Done',
    },
  },
];

/** Any value → a step index that exists; anything that is not a number is step one. */
function clamp(i) {
  const n = Math.trunc(Number(i));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), STEPS.length - 1);
}

/** The step after `i`; the last step stays the last. */
function next(i) {
  return clamp(clamp(i) + 1);
}

/** The step before `i`; the first step stays the first. */
function back(i) {
  return clamp(clamp(i) - 1);
}

function canNext(i) {
  return clamp(i) < STEPS.length - 1;
}

function canBack(i) {
  return clamp(i) > 0;
}

/** "2 of 5 · Board" */
function counter(i) {
  const at = clamp(i);
  return `${at + 1} of ${STEPS.length} · ${STEPS[at].name}`;
}

function collect(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collect(v, out));
  return out;
}

/** Every string the tour can show, counters included — what the copy guards read. */
function strings() {
  return collect([EYEBROW, TRUST, STEPS, STEPS.map((_, i) => counter(i))], []);
}

module.exports = {
  EYEBROW,
  TRUST,
  TRUST_LEAD,
  EXAMPLE_KINDS,
  TONES,
  STEPS,
  clamp,
  next,
  back,
  canNext,
  canBack,
  counter,
  strings,
};
