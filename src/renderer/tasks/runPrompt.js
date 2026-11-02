/**
 * Task run prompt — what Play hands the agent, and whether the task is
 * ready to start.
 *
 * Pure by design (tasks-list-view spec, D11): `tasksPanel.js` requires
 * `electron`, so its prompt builder delegates here, where it can be tested.
 * Every Play surface — the Tasks screen, Home's Active Tasks widget and the
 * task tab's Start Working — goes through `tasksPanel.openRunFlow`, so they
 * all get the same prompt (D1).
 *
 * Readiness (D15): a task is ready when `description` and
 * `acceptanceCriteria` are both non-empty after trimming. A task that is not
 * opens with a format step: the agent writes the missing fields into
 * tasks.json, shows the acceptance criteria and waits for confirmation. A
 * spec task is always ready — its body lives in the spec's `tasks.md`, which
 * the sync owns. The agent never invents `userRequest`: a task that has none
 * keeps none.
 */

const { isSpecTask } = require('./listModel');

const READY_FIELDS = Object.freeze(['description', 'acceptanceCriteria']);

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/** The readiness fields this task still lacks; always [] for a spec task. */
function missingFields(task) {
  if (!task || isSpecTask(task)) return [];
  return READY_FIELDS.filter(field => !filled(task[field]));
}

function formatStep(task, missing) {
  const fields = missing.map(f => `\`${f}\``).join(' and ');
  // The entry in tasks.json is where the agent finds the user's original
  // request (`userRequest`) when the New Task form recorded one.
  return `this task is not ready yet: its ${fields} ${missing.length > 1 ? 'are' : 'is'} empty.`
    + ` Read this task in tasks.json (task id: ${task.id}) and the code it concerns, then write ${missing.length > 1 ? 'them' : 'it'} into that entry.`
    + ` Never add or change \`userRequest\`.`
    + ` Show me the acceptance criteria and wait for my confirmation before continuing`;
}

// A task run hears at most two recorded decisions (decision-cards-core D17).
const MAX_CARDS = 2;

/**
 * The recorded decisions that match this task, as one sentence — the prompt
 * is typed into a terminal, so it stays on one line. Each card is
 * `{ id, decision, story }`, matched and capped by the main process; none
 * means nothing is added and the prompt is exactly what it was.
 */
function cardsSegment(cards) {
  const list = (Array.isArray(cards) ? cards : [])
    .filter((c) => c && filled(c.decision) && filled(c.id))
    .slice(0, MAX_CARDS);
  if (!list.length) return '';
  const items = list.map((c) => `"${c.decision.trim()}" (card ${c.id}${filled(c.story) ? `, story: ${c.story}` : ''})`);
  return `Recorded decisions that may apply — respect them, or tell me before overturning one: ${items.join('; ')}`;
}

/**
 * Build the task prompt that gets injected into the AI CLI. A task missing
 * its description or acceptance criteria opens with the format step. If the
 * user asked for a new branch, instruct the AI to (1) surface any
 * uncommitted changes for an explicit decision rather than silently carrying
 * or discarding them, and (2) either use the user-provided branch name or —
 * when none was given — suggest one and wait for confirmation before
 * creating it. Uncommitted-check comes before the branch so the branch
 * decision is never made on top of an unresolved working tree.
 * `opts.cards` — the recorded decisions matched to this task — follow the
 * task's own text.
 */
function buildTaskPrompt(task, opts = {}) {
  let prompt = `Work on this task: ${task.title}`;
  if (task.description) prompt += `. ${task.description}`;
  if (task.priority === 'high') prompt += ` (High priority)`;
  if (filled(task.acceptanceCriteria)) prompt += `. Acceptance criteria: ${task.acceptanceCriteria.trim()}`;
  const cards = cardsSegment(opts.cards);
  if (cards) prompt += `. ${cards}`;

  const steps = [];
  const missing = missingFields(task);
  if (missing.length > 0) steps.push(formatStep(task, missing));

  if (opts.branchMode === 'new') {
    const branchStep = opts.newBranchName
      ? `create and switch to a new branch named "${opts.newBranchName}"`
      : `suggest an appropriate branch name based on this task, wait for my confirmation, and then create and switch to that branch`;

    steps.push(`check for uncommitted changes on the current branch — if any exist, ask me what to do with them (commit, stash, or discard) and act on my decision before continuing`);
    steps.push(branchStep);
  }

  if (steps.length > 0) {
    prompt += `. Before starting, do the following in order:`
      + steps.map((step, i) => ` ${i === 0 ? 'First' : 'Then'}, ${step}.`).join('');
  }

  // Close the loop: the agent flips the task to completed in tasks.json
  // when it's genuinely done; the tasks watcher pushes the change straight
  // back into the UI. Terminal-side signals can't tell "done" from
  // "stopped", so this stays the only auto-completion path.
  prompt += ` When the task is fully complete, update this task's status to "completed" in tasks.json (task id: ${task.id}).`;

  return prompt;
}

module.exports = { READY_FIELDS, MAX_CARDS, isSpecTask, missingFields, buildTaskPrompt };
