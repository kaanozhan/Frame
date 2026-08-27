/**
 * Spec-Driven Development hint
 *
 * Projects initialized before the feature defaulted to on still carry
 * `features.specDriven: false`, which means specs their AI session writes
 * never surface in the Specs panel. This is the pointer to the fix: a small
 * popover anchored on the sidebar's Project Settings button — where the
 * switch lives — offering to turn it on right there.
 *
 * Deliberately quiet: only for Frame projects with the flag off, never for
 * new projects (they start enabled), and "Don't show again" is remembered
 * per project. Turning the feature off from Project Settings also silences it — a
 * choice the user just made is not something to nag about.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');

const DISMISSED_KEY = 'specDrivenHintDismissed';
const ANCHOR_ID = 'project-settings-btn';
// Let the app finish opening the project (loader fade, panels settling)
// before something pops up in the corner.
const SHOW_DELAY_MS = 900;

let popoverEl = null;
let shownForPath = null;
let showTimer = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;

  // Frame status arrives after the project path (main answers
  // CHECK_IS_FRAME_PROJECT asynchronously), so both edges re-evaluate.
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
 * Show the hint if this project qualifies. Safe to call repeatedly — a
 * popover already shown for the same project is left as it is.
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
    const enabled = await ipcRenderer.invoke(IPC.IS_SPEC_DRIVEN_ENABLED, projectPath);
    if (enabled === true) return;
    // The project may have changed while we were awaiting.
    if (state.getProjectPath() !== projectPath) return;
    schedule(projectPath);
  } catch (err) {
    console.error('specDrivenHint: could not evaluate', err);
  }
}

function schedule(projectPath) {
  clearTimeout(showTimer);
  shownForPath = projectPath;
  showTimer = setTimeout(() => {
    showTimer = null;
    if (state.getProjectPath() !== projectPath) return;
    render(projectPath);
  }, SHOW_DELAY_MS);
}

/** Re-check after the Project Settings toggle changed the flag. */
function refresh() {
  hide();
  evaluate();
}

function render(projectPath) {
  hide();
  shownForPath = projectPath;

  popoverEl = document.createElement('div');
  popoverEl.className = 'spec-driven-hint';
  popoverEl.setAttribute('role', 'dialog');
  popoverEl.setAttribute('aria-label', 'Spec-Driven Development is off');
  popoverEl.innerHTML = `
    <button type="button" class="spec-driven-hint-close" aria-label="Dismiss">&#x2715;</button>
    <div class="spec-driven-hint-title">Spec-Driven Development is off</div>
    <p class="spec-driven-hint-text">
      Specs your AI writes stay hidden from the Specs panel while this is off.
      New projects have it on — you can switch it here, in Project Settings &rarr; Workflow.
    </p>
    <div class="spec-driven-hint-error" role="alert"></div>
    <div class="spec-driven-hint-actions">
      <button type="button" class="spec-driven-hint-never">Don't show again</button>
      <button type="button" class="spec-driven-hint-enable">Turn it on</button>
    </div>
  `;
  document.body.appendChild(popoverEl);
  position();

  popoverEl.querySelector('.spec-driven-hint-close').addEventListener('click', hide);
  popoverEl.querySelector('.spec-driven-hint-never').addEventListener('click', () => {
    dismissForever(projectPath);
  });
  popoverEl.querySelector('.spec-driven-hint-enable').addEventListener('click', (e) => {
    enable(projectPath, e.currentTarget);
  });

  // A click anywhere else means "later" — the hint returns on the next open.
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);
}

function onOutsideClick(e) {
  if (!popoverEl) return;
  if (popoverEl.contains(e.target)) return;
  // Clicking the Project Settings button itself opens the modal, which supersedes
  // the hint — close it either way.
  hide();
}

/** Anchor to the Project Settings button: same baseline, just outboard of the rail. */
function position() {
  if (!popoverEl) return;
  const anchor = document.getElementById(ANCHOR_ID);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // Sidebar hidden — nothing to point at.
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

async function enable(projectPath, btn) {
  const errorEl = popoverEl ? popoverEl.querySelector('.spec-driven-hint-error') : null;
  if (btn) btn.disabled = true;
  try {
    const result = await ipcRenderer.invoke(IPC.SET_SPEC_DRIVEN, {
      projectPath,
      enabled: true
    });
    if (!result || !result.success) {
      if (errorEl) {
        errorEl.textContent = 'Could not turn it on: ' + ((result && result.error) || 'unknown error');
      }
      if (btn) btn.disabled = false;
      return;
    }
    hide();
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Could not turn it on: ' + err.message;
    if (btn) btn.disabled = false;
  }
}

async function dismissForever(projectPath) {
  hide();
  await markDismissed(projectPath);
}

/**
 * Remember that this project should not be hinted at again. Lives in user
 * settings, not the project's .frame/config.json — it is a preference about
 * Frame's UI, not a fact about the project.
 */
async function markDismissed(projectPath) {
  if (!projectPath) return;
  try {
    const list = await readDismissed();
    if (list.includes(projectPath)) return;
    list.push(projectPath);
    await ipcRenderer.invoke(IPC.SET_USER_SETTING, DISMISSED_KEY, list);
  } catch (err) {
    console.error('specDrivenHint: could not persist dismissal', err);
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
  shownForPath = null;
}

module.exports = { init, refresh, markDismissed };
