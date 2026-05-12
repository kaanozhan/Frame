/**
 * Sample Banner
 *
 * Top-of-window strip shown while the user is inside Frame's bundled
 * sample project. Reminds them this is exploration content and offers
 * a one-click "Open My Project" CTA. Subscribes to state.onSampleChange
 * so visibility tracks the actual project mode.
 */

const state = require('./state');

let bannerEl = null;
let openBtnEl = null;
let initialized = false;

function init() {
  if (initialized) return;
  bannerEl = document.getElementById('sample-banner');
  openBtnEl = document.getElementById('sample-banner-open');
  if (!bannerEl) return;

  openBtnEl?.addEventListener('click', () => {
    state.selectProjectFolder();
  });

  state.onSampleChange((isSample) => setVisible(isSample));
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
