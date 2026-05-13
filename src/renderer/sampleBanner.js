/**
 * Sample Mode (banner + auto-opened side panels)
 *
 * Coordinates the UX that fires whenever the user enters the bundled
 * sample project:
 *   - Shows the top "this is sample content" banner
 *   - Auto-opens Tasks and Specs panels so the user immediately sees
 *     the populated content (the whole point of the sample is to
 *     demonstrate what those panels look like with real-feeling data)
 *
 * All of this is opt-out: clicking the banner's × dismisses it for the
 * current sample-session, and panels can be closed individually.
 */

const state = require('./state');
const tasksPanel = require('./tasksPanel');
const specPanel = require('./specPanel');

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
      // Auto-open the side panels so the user immediately sees the
      // populated tasks + specs the sample exists to demonstrate.
      // Wrapped in try/catch because if the modules failed to init for
      // any reason, we still want the banner to show.
      try { tasksPanel.show(); } catch (err) { console.error('sampleMode: tasksPanel.show failed', err); }
      try { specPanel.show(); } catch (err) { console.error('sampleMode: specPanel.show failed', err); }
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
