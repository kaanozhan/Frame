/**
 * The guided tour's steps and rules (first-run-guided-tour spec).
 *
 * Everything the tour decides lives here, with no DOM and no `ipcRenderer`:
 * which steps exist and what they say, which one comes first or next, whether
 * the tour starts by itself, and where a card goes beside its target. The host
 * (`guidedTour.js`) only measures and paints — the same split
 * `onboarding/onboardingGate.js` and `dock/dockState.js` make.
 *
 * Copy rule, inherited from the How to Use Frame guide: a card states only
 * what the code confirms. A UI change that renames a view, a button or a
 * command this copy names should update the card too.
 */

/** User setting (GET/SET_USER_SETTING) written when the tour is skipped or finished. */
const SETTING_KEY = 'guidedTourDone';

const PLACEMENTS = ['top', 'right', 'bottom', 'left'];
const ADVANCES = ['next', 'project'];

/*
 * Each step lists its targets in order of preference; the host shows the
 * first one that is on screen. `needsNav` names the sidebar nav row the
 * host has to reveal (sidebar open, Projects tab, group expanded) before the
 * target can be measured.
 */
const STEPS = [
  {
    id: 'project',
    title: 'Start with a project',
    body: 'Frame works inside a project. Open a folder, create a new one or clone from GitHub, and the tour continues once it is open.',
    targets: [{ selector: '.lane-board-empty-start .project-start', placement: 'bottom' }],
    advance: 'project',
    requiresProject: false,
    requiresNoProject: true
  },
  {
    id: 'switcher',
    title: 'Your projects',
    body: 'This is the project you are in. Open it to switch to another project or add a new one.',
    targets: [{ selector: '#sidebar-current-project-wrap', placement: 'right' }],
    advance: 'next',
    requiresProject: true,
    requiresNoProject: false
  },
  {
    id: 'agent',
    title: 'Bring your own agent',
    body: 'Frame has no AI of its own: it runs the agent you already use, Claude Code or Codex. Pick it here, and Start opens it in a terminal.',
    targets: [{ selector: '#app-header .lane-bar-launcher', placement: 'bottom' }],
    advance: 'next',
    requiresProject: true,
    requiresNoProject: false
  },
  {
    id: 'terminals',
    title: 'Work from the terminal',
    body: 'Frame is terminal-first: you drive the work by talking to your agent in its terminal, as you would anywhere else. Terminals shows them all, and each terminal gets a chip whose dot tells you when the agent needs you.',
    targets: [
      { selector: '.lane-bar-terminals', placement: 'bottom' },
      { selector: '.project-nav-item[data-view="terminals"]', placement: 'right', needsNav: 'terminals' }
    ],
    advance: 'next',
    requiresProject: true,
    requiresNoProject: false
  },
  {
    id: 'specs',
    title: 'Specs for bigger work',
    body: 'Sizable work goes spec, plan, tasks before any code. Each step\'s button hands the prompt to your agent in a terminal, and every step leaves a file in the project.',
    targets: [{ selector: '.project-nav-item[data-view="specs"]', placement: 'right', needsNav: 'specs' }],
    advance: 'next',
    requiresProject: true,
    requiresNoProject: false
  },
  {
    id: 'tasks',
    title: 'Tasks',
    body: 'Your own tasks, in progress above pending, with what is done one click away. The play button on a pending task sends it to an agent terminal; the tasks a spec generates stay hidden until you show them.',
    targets: [{ selector: '.project-nav-item[data-view="tasks"]', placement: 'right', needsNav: 'tasks' }],
    advance: 'next',
    requiresProject: true,
    requiresNoProject: false
  },
  {
    id: 'settings',
    title: 'Settings',
    body: 'The gear opens Frame Settings: interface size, privacy and updates. Project Settings sits at the foot of the project\'s navigation.',
    closing: 'That is the tour. Frame keeps the context; your agent does the work, in the terminal.',
    targets: [{ selector: '#frame-settings-btn', placement: 'right' }],
    advance: 'next',
    requiresProject: true,
    requiresNoProject: false
  }
];

/**
 * Does the tour start by itself after boot? Once per user: any stored value
 * means it was skipped or finished. A failed read does not start it — a tour
 * that reappears on every launch is worse than one missed once.
 */
function shouldAutoStart({ done, readFailed } = {}) {
  if (readFailed) return false;
  return done === null || done === undefined;
}

function applies(step, hasProject) {
  if (step.requiresProject && !hasProject) return false;
  if (step.requiresNoProject && hasProject) return false;
  return true;
}

/**
 * The index of the first step after `from` that applies to the current
 * project state and whose target is available, or -1 when none is left.
 *
 * @param {number} from  current index; -1 to start from the beginning
 * @param {object} ctx
 * @param {boolean} ctx.hasProject
 * @param {(step: object) => boolean} [ctx.isAvailable]  defaults to always
 * @param {Array} [ctx.steps]  defaults to STEPS
 */
function nextStepIndex(from, { hasProject, isAvailable, steps = STEPS } = {}) {
  for (let i = from + 1; i < steps.length; i++) {
    const step = steps[i];
    if (!applies(step, !!hasProject)) continue;
    if (typeof isAvailable === 'function' && !isAvailable(step)) continue;
    return i;
  }
  return -1;
}

/** Where a tour begins: step 1 with no project open, step 2 with one. */
function firstStepIndex(ctx = {}) {
  return nextStepIndex(-1, ctx);
}

/** The last step that applies with a project open, for the Done button. */
function isLastStep(index, { hasProject, steps = STEPS } = {}) {
  return index >= 0 && nextStepIndex(index, { hasProject, steps }) === -1;
}

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Place a card of `card` size beside `target` inside `viewport`.
 *
 * Tries the preferred side, then its opposite, then the remaining two, and
 * takes the first where the card fits without crossing the margin. When none
 * fits, it keeps the preferred side. Either way the cross axis is centred on
 * the target and clamped inside the viewport.
 *
 * @param {{top:number,left:number,width:number,height:number}} target
 * @param {{width:number,height:number}} card
 * @param {{width:number,height:number}} viewport
 * @param {'top'|'right'|'bottom'|'left'} placement
 * @returns {{top:number,left:number,placement:string}}
 */
function placeCard(target, card, viewport, placement = 'bottom', { gap = 12, margin = 16 } = {}) {
  const preferred = PLACEMENTS.includes(placement) ? placement : 'bottom';
  const order = [preferred, OPPOSITE[preferred], ...PLACEMENTS.filter((p) => p !== preferred && p !== OPPOSITE[preferred])];
  const right = target.left + target.width;
  const bottom = target.top + target.height;

  const fits = {
    top: target.top - gap - card.height >= margin,
    bottom: bottom + gap + card.height <= viewport.height - margin,
    left: target.left - gap - card.width >= margin,
    right: right + gap + card.width <= viewport.width - margin
  };
  const side = order.find((p) => fits[p]) || preferred;

  const maxLeft = viewport.width - margin - card.width;
  const maxTop = viewport.height - margin - card.height;
  let top;
  let left;
  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? target.top - gap - card.height : bottom + gap;
    left = target.left + target.width / 2 - card.width / 2;
  } else {
    left = side === 'left' ? target.left - gap - card.width : right + gap;
    top = target.top + target.height / 2 - card.height / 2;
  }
  return {
    top: Math.round(clamp(top, margin, maxTop)),
    left: Math.round(clamp(left, margin, maxLeft)),
    placement: side
  };
}

function sentenceCount(text) {
  return (text.match(/[.!?](\s|$)/g) || []).length;
}

/** Mistakes in a step list, as readable strings; empty when it is sound. */
function validate(steps = STEPS) {
  const errors = [];
  const ids = new Set();
  if (!Array.isArray(steps) || steps.length === 0) return ['steps must be a non-empty array'];
  steps.forEach((step, i) => {
    const at = step && step.id ? `step "${step.id}"` : `step ${i}`;
    if (!step || typeof step.id !== 'string' || !step.id) {
      errors.push(`${at}: missing id`);
    } else if (ids.has(step.id)) {
      errors.push(`${at}: duplicate id`);
    } else {
      ids.add(step.id);
    }
    if (!step || typeof step.title !== 'string' || !step.title.trim()) errors.push(`${at}: missing title`);
    if (!step || typeof step.body !== 'string' || !step.body.trim()) {
      errors.push(`${at}: missing body`);
    } else if (sentenceCount(step.body) > 2) {
      errors.push(`${at}: body is longer than two sentences`);
    }
    if (step && step.closing !== undefined && (typeof step.closing !== 'string' || !step.closing.trim())) {
      errors.push(`${at}: closing must be non-empty text`);
    }
    if (!step || !ADVANCES.includes(step.advance)) errors.push(`${at}: unknown advance`);
    if (step && step.requiresProject && step.requiresNoProject) errors.push(`${at}: requires both a project and none`);
    if (!step || !Array.isArray(step.targets) || step.targets.length === 0) {
      errors.push(`${at}: no targets`);
    } else {
      step.targets.forEach((t, j) => {
        if (!t || typeof t.selector !== 'string' || !t.selector.trim()) errors.push(`${at}: target ${j} has no selector`);
        if (!t || !PLACEMENTS.includes(t.placement)) errors.push(`${at}: target ${j} has an unknown placement`);
      });
    }
  });
  return errors;
}

module.exports = {
  SETTING_KEY,
  STEPS,
  PLACEMENTS,
  shouldAutoStart,
  nextStepIndex,
  firstStepIndex,
  isLastStep,
  placeCard,
  validate
};
