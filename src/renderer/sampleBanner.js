/**
 * First-run banners (sample mode + post-init detection)
 *
 * Sample mode: whenever the user enters the bundled sample project, shows
 * the "this is sample content" banner and auto-opens Tasks and Specs panels
 * so the populated content is immediately visible.
 *
 * Detection: right after ANY project is initialized as a Frame project,
 * shows a one-shot banner with the detected stack summary and next steps —
 * the generic-path equivalent of the sample's guided entry, so a user's own
 * (non-JS) repo is not an onboarding dead end.
 *
 * All of this is opt-out: clicking a banner's × dismisses it, and panels
 * can be closed individually.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const tasksPanel = require('./tasksPanel');
const specPanel = require('./specPanel');

let bannerEl = null;
let closeBtnEl = null;
let detectionBannerEl = null;
let detectionTextEl = null;
let initialized = false;
let dismissedForCurrentSession = false;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** One-line summary of the detected stack for the post-init banner */
function detectionSummary(project) {
  if (!project || !project.languages || project.languages.length === 0) {
    return "Frame is set up, but couldn't detect this project's stack — review <strong>.frame/config.json</strong> and <strong>QUICKSTART.md</strong>. Your AI agent starts from <strong>AGENTS.md</strong>.";
  }
  const bits = [
    project.languages.join(', '),
    project.packageManager,
    (project.sourceRoots || []).filter(r => r !== '.').map(r => `${r}/`).join(', ')
  ].filter(Boolean);
  return `Frame set up for <strong>${escapeHtml(bits.join(' · '))}</strong> — review <strong>QUICKSTART.md</strong>, correct anything in <strong>.frame/config.json</strong>. Your AI agent starts from <strong>AGENTS.md</strong>.`;
}

function setDetectionVisible(visible) {
  if (!detectionBannerEl) return;
  detectionBannerEl.classList.toggle('visible', !!visible);
}

function init() {
  if (initialized) return;
  bannerEl = document.getElementById('sample-banner');
  closeBtnEl = document.getElementById('sample-banner-close');
  detectionBannerEl = document.getElementById('detection-banner');
  detectionTextEl = document.getElementById('detection-banner-text');

  document.getElementById('detection-banner-close')?.addEventListener('click', () => {
    setDetectionVisible(false);
  });

  // Post-init detection banner: fires for the project the user just
  // initialized (the sample has its own banner). Hidden again on any
  // project switch — it's a first-run moment, not a persistent chrome.
  ipcRenderer.on(IPC.FRAME_PROJECT_INITIALIZED, (event, { projectPath, config, success }) => {
    if (!success || !config) return;
    if (projectPath !== state.getProjectPath()) return;
    if (state.getIsSampleProject()) return;
    if (detectionTextEl) detectionTextEl.innerHTML = detectionSummary(config.project || null);
    setDetectionVisible(true);
  });
  state.onProjectChange(() => setDetectionVisible(false));

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
