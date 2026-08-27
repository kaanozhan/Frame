/**
 * Doc-health hint
 *
 * The last piece of the invariant: Frame now checks, on every project open,
 * that the documents it keeps for the agent still describe a project that
 * exists — and this is where a broken check becomes something a person can
 * see. Without it the check is what the bug was: correct, quiet, and useless.
 *
 * Two findings reach the user, and only two, because only these two are
 * things Frame will not decide alone:
 *
 *   - **a section Frame cannot prove is its own.** The repair pass leaves it
 *     untouched on purpose — the user's own text may say something Frame's
 *     would contradict, and two overlapping protocols is how an agent ends up
 *     following the wrong one. Adding Frame's section anyway is offered here,
 *     as a choice, and it is additive: their prose stays exactly where it is.
 *   - **a path the prose names that is not on disk.** Frame cannot conjure an
 *     arbitrary file, so this is reported, not repaired.
 *
 * Everything else the pass fixes on its own and says nothing about.
 *
 * Shape and mechanics are `specDrivenHint.js`'s, deliberately: same anchored
 * quiet popover, same "don't show again" persisted per project through user
 * settings, same CSS. A second visual idiom for a structurally identical
 * moment would be a worse answer than a copied one.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

const DISMISSED_KEY = 'docsHealthHintDismissed';
const ANCHOR_ID = 'sidebar-settings-btn';
// Let the app finish opening the project before something appears in the
// corner — and land after specDrivenHint, so two popovers never race for the
// same anchor on the same open.
const SHOW_DELAY_MS = 1600;

let popoverEl = null;
let shownForPath = null;
let showTimer = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;

  state.onProjectChange(() => {
    hide();
    evaluate();
  });
  state.onFrameStatusChange(() => evaluate());

  window.addEventListener('resize', position);
  document.addEventListener('keydown', (e) => {
    if (popoverEl && e.key === 'Escape') hide();
  });
}

/**
 * Show the hint if this project has something only a person can settle. Safe
 * to call repeatedly.
 */
async function evaluate() {
  const projectPath = state.getProjectPath();
  if (!projectPath || !state.getIsFrameProject()) {
    hide();
    return;
  }
  if ((popoverEl || showTimer) && shownForPath === projectPath) return;
  if (!document.getElementById(ANCHOR_ID)) return;

  try {
    if (await isDismissed(projectPath)) return;
    const health = await ipcRenderer.invoke(IPC.GET_DOCS_HEALTH, projectPath);
    const findings = actionable(health);
    if (!findings) return;
    // The project may have changed while we were awaiting.
    if (state.getProjectPath() !== projectPath) return;
    schedule(projectPath, findings);
  } catch (err) {
    console.error('docsHealthHint: could not evaluate', err);
  }
}

/**
 * What is worth interrupting for. `unreadable` is deliberately absent: a
 * document Frame cannot read is a filesystem problem the user will meet
 * elsewhere, and a popover about it would be a second symptom, not a fix.
 */
function actionable(health) {
  if (!health) return null;
  const unmatched = Array.isArray(health.unmatchedSections) ? health.unmatchedSections : [];
  const missing = Array.isArray(health.missingPaths) ? health.missingPaths : [];
  if (unmatched.length === 0 && missing.length === 0) return null;
  return { unmatched, missing };
}

function schedule(projectPath, findings) {
  clearTimeout(showTimer);
  shownForPath = projectPath;
  showTimer = setTimeout(() => {
    showTimer = null;
    if (state.getProjectPath() !== projectPath) return;
    render(projectPath, findings);
  }, SHOW_DELAY_MS);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** The one-line explanation, chosen by which finding is the more actionable. */
function describe({ unmatched, missing }) {
  if (unmatched.length > 0) {
    const docs = unmatched.map((s) => `<code>${escapeHtml(s.doc)}</code>`).join(' and ');
    return `${docs} already has a spec section that Frame did not write, so Frame left it
      alone. Until one of them carries Frame's own, an agent asked to plan or implement a
      spec will improvise the flow instead of following the current one.`;
  }
  const first = missing[0];
  const rest = missing.length - 1;
  return `Frame's instructions point at <code>${escapeHtml(first.path)}</code>, which is not
    there${rest > 0 ? `, along with ${rest} other missing path${rest === 1 ? '' : 's'}` : ''}.
    An agent following them will hit a dead end.`;
}

function render(projectPath, findings) {
  hide();
  shownForPath = projectPath;

  const canAppend = findings.unmatched.length > 0;

  popoverEl = document.createElement('div');
  popoverEl.className = 'spec-driven-hint';
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-label', "Frame's agent docs need attention");
  popoverEl.innerHTML = `
    <button type="button" class="spec-driven-hint-close" aria-label="Dismiss">&#x2715;</button>
    <div class="spec-driven-hint-title">Frame's agent docs need a look</div>
    <p class="spec-driven-hint-text">${describe(findings)}</p>
    <div class="spec-driven-hint-error" role="alert"></div>
    <div class="spec-driven-hint-actions">
      <button type="button" class="spec-driven-hint-never">Don't show again</button>
      ${canAppend ? '<button type="button" class="spec-driven-hint-enable">Add Frame\'s section</button>' : ''}
    </div>
  `;
  document.body.appendChild(popoverEl);
  position();

  popoverEl.querySelector('.spec-driven-hint-close').addEventListener('click', hide);
  popoverEl.querySelector('.spec-driven-hint-never').addEventListener('click', () => {
    dismissForever(projectPath);
  });
  const appendBtn = popoverEl.querySelector('.spec-driven-hint-enable');
  if (appendBtn) {
    appendBtn.addEventListener('click', (e) => {
      appendSections(projectPath, findings.unmatched, e.currentTarget);
    });
  }

  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
}

function onOutsideClick(e) {
  if (!popoverEl) return;
  if (popoverEl.contains(e.target)) return;
  // A click elsewhere means "later" — the hint returns on the next open.
  hide();
}

/** Anchor to the Settings button, the same way specDrivenHint does. */
function position() {
  if (!popoverEl) return;
  const anchor = document.getElementById(ANCHOR_ID);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hide();
    return;
  }
  const gap = 8;
  const width = popoverEl.offsetWidth;
  const height = popoverEl.offsetHeight;
  const left = Math.min(rect.right + gap, window.innerWidth - width - gap);
  const top = Math.min(
    Math.max(rect.bottom - height, gap),
    window.innerHeight - height - gap
  );
  popoverEl.style.left = `${Math.max(gap, left)}px`;
  popoverEl.style.top = `${top}px`;
}

/**
 * Carry out the one thing Frame would not do unasked. Each document is
 * appended to separately, so a failure on one does not silently swallow the
 * other, and any failure is reported in the popover rather than the console.
 */
async function appendSections(projectPath, unmatched, btn) {
  const errorEl = popoverEl ? popoverEl.querySelector('.spec-driven-hint-error') : null;
  if (btn) btn.disabled = true;
  const failures = [];
  try {
    for (const section of unmatched) {
      const result = await ipcRenderer.invoke(IPC.APPEND_DOCS_SECTION, {
        projectPath,
        doc: section.doc
      });
      if (!result || !result.success) {
        failures.push(`${section.doc}: ${(result && result.error) || 'unknown error'}`);
      }
    }
  } catch (err) {
    failures.push(err.message);
  }

  if (failures.length > 0) {
    if (errorEl) errorEl.textContent = `Could not add the section — ${failures.join('; ')}`;
    if (btn) btn.disabled = false;
    return;
  }
  hide();
}

async function dismissForever(projectPath) {
  hide();
  await markDismissed(projectPath);
}

/**
 * Remembered in user settings rather than the project's config: it is a
 * preference about Frame's UI, not a fact about the project.
 */
async function markDismissed(projectPath) {
  if (!projectPath) return;
  try {
    const list = await readDismissed();
    if (list.includes(projectPath)) return;
    list.push(projectPath);
    await ipcRenderer.invoke(IPC.SET_USER_SETTING, DISMISSED_KEY, list);
  } catch (err) {
    console.error('docsHealthHint: could not persist dismissal', err);
  }
}

async function isDismissed(projectPath) {
  const list = await readDismissed();
  return list.includes(projectPath);
}

async function readDismissed() {
  const stored = await ipcRenderer.invoke(IPC.GET_USER_SETTING, DISMISSED_KEY);
  return Array.isArray(stored) ? stored.slice() : [];
}

function hide() {
  clearTimeout(showTimer);
  showTimer = null;
  document.removeEventListener('mousedown', onOutsideClick);
  if (popoverEl) {
    popoverEl.remove();
    popoverEl = null;
  }
}

module.exports = { init };
