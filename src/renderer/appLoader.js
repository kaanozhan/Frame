/**
 * App Loader
 *
 * Full-screen splash shown on boot until the first PROJECT_REGISTRY_DATA arrives.
 * Avoids the brief flash of empty sidebar / unmounted terminal that users
 * see while the main process loads the project registry.
 *
 * It also plays Frame's intro: the mark fills along its own perimeter like a
 * progress ring, then the wordmark unrolls out of it and pushes it left. The
 * splash leaves only once BOTH the intro has finished and the project registry has
 * arrived — whichever is slower — so the animation is never cut mid-beat and
 * a slow boot never adds the intro's length on top of itself.
 *
 * Where it would have left, it asks whether this is a first run: with no
 * projects the surface is handed to onboarding.js instead, keeping the lockup
 * exactly where the intro put it (first-run-onboarding-screen spec). That is
 * also why the splash is parked rather than removed — the palette's Show
 * the Start Screen reuses this same element, and its same lockup, later.
 *
 * If the failsafe timeout fires before any data, the splash swaps to a
 * "couldn't load projects" state with a Retry button instead of silently
 * dropping the user into a blank app. Main has no error variant for
 * LOAD_PROJECT_REGISTRY — the timeout is the only failure signal the renderer has.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const onboarding = require('./onboarding');

const FAILSAFE_MS = 10000;
const FADE_MS = 280;

/* Intro beats. These mirror the durations in
   styles/components/app-loader.css — the two move together. */
const SWEEP_MS = 1900;   // mark fills around its perimeter
const REVEAL_MS = 560;   // wordmark unrolls, mark slides left
const HOLD_MS = 2000;    // finished lockup sits still, long enough to read
const REDUCED_MOTION_MS = 500; // no beats to play; just don't blink past it

let loaderEl = null;
let firstDataArrived = false;
let introDone = false;
let projects = null;      // the first PROJECT_REGISTRY_DATA payload, for the gate
let failsafeTimer = null;
let introTimers = [];
let initialized = false;
// The boot is over the first time the surface parks — after the fade to the
// app, or when the onboarding screen hands the app over. Listeners hear it
// once; a later park (the palette's start screen closing) is not a boot.
let bootLeft = false;
let bootLeaveListeners = [];

function init() {
  loaderEl = document.getElementById('app-loader');
  if (!loaderEl) return;
  // Init-once: a re-init must not stack a second PROJECT_REGISTRY_DATA listener.
  if (initialized) return;
  initialized = true;

  // The first registry push is what the surface is waiting for: it both
  // releases the loader and tells the gate whether this is a first run. It
  // also resolves the failure state — if data arrives late (slow main, or
  // after Retry), the loader stops being an error screen.
  ipcRenderer.on(IPC.PROJECT_REGISTRY_DATA, (event, payload) => {
    if (firstDataArrived) return;
    firstDataArrived = true;
    // Kept for the gate: the project count decides whether this boot ends on
    // the app or on the onboarding screen. Only the first push is consulted,
    // so a later one cannot re-open a screen the user has already left.
    projects = payload;
    hideWhenReady();
  });

  onboarding.init({ onLeave: park });
  playIntro();
  armFailsafe();
}

/* Drives the intro's beats by class. The wordmark's target width is measured
   just before it unrolls — CSS can't transition to "the content's width", and
   measuring late means the local fonts have long since settled. */
function playIntro() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    loaderEl.classList.add('app-loader-run', 'app-loader-reveal');
    introTimers.push(setTimeout(finishIntro, REDUCED_MOTION_MS));
    return;
  }

  loaderEl.classList.add('app-loader-run');

  introTimers.push(setTimeout(() => {
    if (!loaderEl) return;
    const wordmark = loaderEl.querySelector('.app-loader-wordmark');
    const text = loaderEl.querySelector('.app-loader-wordmark-text');
    if (wordmark && text) {
      wordmark.style.setProperty('--app-loader-wordmark-w', `${Math.ceil(text.scrollWidth)}px`);
    }
    loaderEl.classList.add('app-loader-reveal');
  }, SWEEP_MS));

  introTimers.push(setTimeout(finishIntro, SWEEP_MS + REVEAL_MS + HOLD_MS));
}

function finishIntro() {
  introDone = true;
  hideWhenReady();
}

function clearIntroTimers() {
  introTimers.forEach(clearTimeout);
  introTimers = [];
}

/* The splash owes the user two things: a finished intro and a loaded
   registry. Neither alone is enough to leave.

   And it may not leave at all: on a first run the surface becomes the
   onboarding screen, which parks it later through the onLeave hook. */
function hideWhenReady() {
  if (!firstDataArrived || !introDone) return;
  clearFailureState();
  if (onboarding.takeOver(projects)) {
    clearIntroTimers();
    if (failsafeTimer) {
      clearTimeout(failsafeTimer);
      failsafeTimer = null;
    }
    return;
  }
  hide();
}

function armFailsafe() {
  if (failsafeTimer) clearTimeout(failsafeTimer);
  failsafeTimer = setTimeout(() => {
    if (!firstDataArrived) showFailureState();
  }, FAILSAFE_MS);
}

/*
 * Additive, not destructive. This used to replace the surface's innerHTML,
 * which was fine when the splash had nothing to lose — but it would now take
 * the lockup and the onboarding panel with it, and a retry that succeeds on a
 * first run has to be able to show that panel. So the error is appended and
 * the rest is hidden by class.
 */
function showFailureState() {
  if (!loaderEl) return;
  // The intro is beside the point once boot has failed — stop its beats so a
  // late timer can't hide the error the user still needs to read.
  clearIntroTimers();
  introDone = true;
  loaderEl.classList.remove('app-loader-run', 'app-loader-reveal');
  loaderEl.classList.add('app-loader-failed');

  let errorEl = loaderEl.querySelector('.app-loader-error');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.className = 'app-loader-error';
    errorEl.innerHTML = `
      <div class="app-loader-error-mark">&#10022;</div>
      <div class="app-loader-error-title">Couldn't load your projects</div>
      <div class="app-loader-error-detail">The project list didn't respond in time. You can retry, or restart Frame if this keeps happening.</div>
      <button type="button" class="btn app-loader-retry">Retry</button>
    `;
    loaderEl.appendChild(errorEl);
    errorEl.querySelector('.app-loader-retry').addEventListener('click', () => {
      errorEl.querySelector('.app-loader-error-title').textContent = 'Retrying…';
      ipcRenderer.send(IPC.LOAD_PROJECT_REGISTRY);
      armFailsafe();
    });
  }
}

/* A retry that worked: drop the error and let the normal join decide between
   the app and the onboarding screen. */
function clearFailureState() {
  if (!loaderEl) return;
  loaderEl.classList.remove('app-loader-failed');
  const errorEl = loaderEl.querySelector('.app-loader-error');
  if (errorEl) errorEl.remove();
}

function hide() {
  if (failsafeTimer) {
    clearTimeout(failsafeTimer);
    failsafeTimer = null;
  }
  clearIntroTimers();
  if (!loaderEl) return;
  loaderEl.classList.add('app-loader-hidden');
  setTimeout(park, FADE_MS);
}

/*
 * The end of the fade, and onboarding's way out. The node is kept and hidden
 * rather than removed: the palette can reopen the onboarding screen on this
 * same surface later in the session, and rebuilding it elsewhere would mean a
 * second copy of the lockup that can sit a pixel off the first. Hidden, it is
 * inert — nothing else in the renderer queries #app-loader.
 */
function park() {
  if (!loaderEl) return;
  loaderEl.classList.add('app-loader-hidden', 'app-loader-parked');
  if (bootLeft) return;
  bootLeft = true;
  const listeners = bootLeaveListeners;
  bootLeaveListeners = [];
  listeners.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error('appLoader: a boot-leave listener failed', err);
    }
  });
}

/**
 * Run `cb` once, when the boot surface first gets out of the way of the app
 * (the guided tour starts from here). Already gone → on the next tick.
 */
function onBootLeave(cb) {
  if (typeof cb !== 'function') return;
  if (bootLeft) {
    setTimeout(cb, 0);
    return;
  }
  bootLeaveListeners.push(cb);
}

module.exports = { init, onBootLeave };
