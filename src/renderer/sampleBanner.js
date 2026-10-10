/**
 * Sample Banner
 *
 * Whenever the user enters the bundled sample project, shows the "this is
 * sample content" banner and auto-opens the Tasks view so the populated
 * content is immediately visible.
 *
 * Opt-out: clicking the banner's × dismisses it, and the view can be closed.
 */

const state = require('./state');

let bannerEl = null;
let closeBtnEl = null;
let initialized = false;
let dismissedForCurrentSession = false;

function init() {
  if (initialized) return;
  bannerEl = document.getElementById('sample-banner');
  closeBtnEl = document.getElementById('sample-banner-close');

  if (!bannerEl) return;

  closeBtnEl?.addEventListener('click', () => {
    dismissedForCurrentSession = true;
    setVisible(false);
  });

  // Banner appears whenever the user is in the sample project. Dismissal
  // is per-sample-open: if they switch away and come back, banner shows
  // again. Avoids being silently buried after one click.
  state.onSampleChange((isSample) => {
    if (isSample) {
      dismissedForCurrentSession = false;
      // Auto-open the center Tasks view so the user immediately sees the
      // populated tasks the sample exists to demonstrate (side panels are
      // retired — retire-rail-and-panels spec). Wrapped in try/catch because
      // if the modules failed to init, we still want the banner to show.
      try {
        require('./terminal').getMultiTerminalUI().showTasksBoard();
      } catch (err) { console.error('sampleMode: opening tasks view failed', err); }
    }
    setVisible(isSample && !dismissedForCurrentSession);
  });

  // Initial paint — covers the case where the sample is already open
  // (e.g., session resumed after restart).
  setVisible(state.getIsSampleProject());

  initialized = true;
}

function setVisible(visible) {
  if (!bannerEl) return;
  bannerEl.classList.toggle('visible', !!visible);
}

module.exports = { init };
