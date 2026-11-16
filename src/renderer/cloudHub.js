/**
 * Frame Cloud — the modal behind the app header's Frame Cloud entry
 * (#cloud-entry, right of the Frame mark; frame-cloud-header-entry spec).
 *
 * One home for everything project-independent about Frame Cloud: the
 * account (the sign-in panes that used to live in Settings → Account), the
 * cloud workspace's projects, and this device's folders. It only draws what
 * main pushes — CLOUD_SESSION_STATE for the session, CLOUD_PROJECTS_STATE for
 * the lists — and its buttons invoke channels and wait for the next push.
 * The token never comes this way.
 *
 * The two tabs are drawn by cloudHubTabs; this module owns the overlay, the
 * sign-in panes, the signed-in header, the tab strip and the landing after a
 * sign-in. Server strings are written with textContent, never as HTML.
 */

const { ipcRenderer, shell, clipboard } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const settingsOverlay = require('./settingsOverlay');
const cloudWelcome = require('./cloudWelcome');
const noWorkspaceCopy = require('./cloudNoWorkspace');
const cloudRoles = require('./cloudRoles');
const earlyAccess = require('./cloudEarlyAccess');

const SIGNED_IN_NOTE_MS = 4000;
const TABS = ['projects', 'device'];
const PROMPT_DISMISSED_KEY = 'cloudConnectPromptDismissed';
// The states drawn inside the welcome layout (the tour + sign-in card).
const WELCOME_STATES = ['signedOut', 'requestingCode', 'awaitingApproval', 'registering', 'failed'];

// The ↗ after links that leave Frame, as in the Workspace row.
const EXTERNAL_ICON =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>';

const REASONS = {
  denied: 'Sign-in was denied in the browser.',
  expired: 'The code expired. Start again.',
  network: "Frame Cloud couldn't be reached.",
  rateLimited: 'Too many sign-in attempts. Wait a minute and try again.',
  noWorkspace: 'Create a workspace on the web first.'
};

let overlay = null;
let rootEl = null;
let sessionState = { state: 'unavailable' };
let projectsState = null;
let activeTab = 'projects';
let signedInNoteTimer = null;
// "Use another address": show the waitlist form again over the joined card.
let showWaitlistForm = false;
let joining = false; // a waitlist.join in flight
// Guards the landing: Frame Cloud never opens over onboarding or the tour.
let isBlocked = () => false;
let tabs = null;
const sessionListeners = new Set();
const projectsListeners = new Set();

/**
 * @param {{ isBlocked?: () => boolean, tabs?: object }} [opts]
 *   tabs: the tab renderer ({ init(hub), render(state, activeTab), onShow(tab) }).
 */
function init(opts = {}) {
  if (typeof opts.isBlocked === 'function') isBlocked = opts.isBlocked;
  rootEl = document.getElementById('cloud-overlay');
  overlay = settingsOverlay.create('cloud-overlay', onOpen);
  if (!overlay || !rootEl) {
    console.error('Frame Cloud: #cloud-overlay not found — the Frame Cloud modal is unavailable');
    return;
  }

  cloudWelcome.render(document.getElementById('cloud-pitch'));
  initEarlyAccess();

  rootEl.querySelectorAll('[data-cloud-action]').forEach((btn) => {
    btn.addEventListener('click', () => onAction(btn.dataset.cloudAction, btn));
  });
  rootEl.querySelectorAll('[data-cloud-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.cloudTab));
  });

  const webLink = document.getElementById('cloud-web-link');
  if (webLink) {
    webLink.addEventListener('click', (e) => {
      e.preventDefault();
      const origin = webOrigin(sessionState.verificationUrl);
      if (origin) shell.openExternal(origin);
    });
  }

  if (opts.tabs) {
    tabs = opts.tabs;
    tabs.init(api);
  }
  setTab(activeTab);

  ipcRenderer.on(IPC.CLOUD_SESSION_STATE, (event, state) => renderSession(state));
  ipcRenderer.on(IPC.CLOUD_PROJECTS_STATE, (event, state) => renderProjects(state));
  pullSession();
  pullProjects();
}

// Opening re-reads both states and asks the server once: device.me when
// signed in (then the project list), invite.mode when signed out.
function onOpen() {
  // The after-sign-in notice belongs to that moment, not to later visits.
  hideDevicesPrompt();
  // The tour's step is not remembered: every opening starts at step one.
  cloudWelcome.reset();
  pullSession().then((state) => {
    if (!state || state.state === 'unavailable') return;
    ipcRenderer.invoke(IPC.CLOUD_REFRESH).then(renderSession).catch(() => {});
    if (state.state === 'signedIn') refreshProjects();
  });
  pullProjects();
}

// ─── Early access ─────────────────────────────────────────

/** Fill the early-access pane's static words once and wire its controls. */
function initEarlyAccess() {
  const { COPY } = earlyAccess;
  setText('cloud-early-title', COPY.title);
  setText('cloud-early-lede', COPY.lede);
  setText('cloud-waitlist-label', COPY.emailLabel);
  setText('cloud-waitlist-join', COPY.join);
  setText('cloud-early-joined-title', COPY.joinedTitle);
  setText('cloud-waitlist-another', COPY.useAnother);
  setText('cloud-early-already', COPY.alreadyInvited);
  setText('cloud-early-signin', COPY.signIn);
  setText('cloud-invite-hint', COPY.awaitingHint);
  setText('cloud-failed-waitlist', COPY.joinWaitlistAction);
  const input = document.getElementById('cloud-waitlist-email');
  if (input) input.placeholder = COPY.emailPlaceholder;
  setText('cloud-waitlist-fallback', `${COPY.fallbackLink} ↗`);
  const form = document.getElementById('cloud-early-form');
  const join = document.getElementById('cloud-waitlist-join');
  const syncJoin = () => {
    if (join) join.disabled = joining || !(input && input.value.trim());
  };
  if (input) input.addEventListener('input', () => {
    syncJoin();
    showJoinFailure(null);
  });
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (joining || !input || !input.value.trim()) return;
      joining = true;
      syncJoin();
      showJoinFailure(null);
      ipcRenderer
        .invoke(IPC.CLOUD_JOIN_WAITLIST, input.value)
        .then((result) => {
          if (result && result.ok) {
            // Main publishes the joined address; the card replaces the form.
            showWaitlistForm = false;
            input.value = '';
          } else {
            showJoinFailure((result && result.reason) || 'network');
          }
        })
        .catch((err) => {
          console.error('Frame Cloud: could not join the waitlist', err);
          showJoinFailure('network');
        })
        .finally(() => {
          joining = false;
          syncJoin();
          renderEarlyAccess(sessionState);
          // Main's push can land before the flag above is cleared.
          notifySession();
        });
    });
  }
  syncJoin();
  const fallback = document.getElementById('cloud-waitlist-fallback');
  if (fallback) fallback.addEventListener('click', () => shell.openExternal(earlyAccess.WAITLIST_URL));
  const another = document.getElementById('cloud-waitlist-another');
  if (another) {
    another.addEventListener('click', () => {
      showWaitlistForm = true;
      renderEarlyAccess(sessionState);
      if (input) input.focus();
      // The header entry follows the window: with the form back, it calls
      // to the waitlist again.
      notifySession();
    });
  }
}

/** One line under the form for a failed join (null clears it), and frame.cool as the way out. */
function showJoinFailure(reason) {
  const error = document.getElementById('cloud-waitlist-error');
  const fallback = document.getElementById('cloud-waitlist-fallback');
  const failure = reason ? earlyAccess.joinFailure(reason) : null;
  if (error) {
    error.textContent = failure ? failure.message : '';
    error.hidden = !failure;
  }
  if (fallback) fallback.hidden = !(failure && failure.showFallback);
}

/** Signed out: today's pane, the waitlist form, or the joined card. */
function renderEarlyAccess(s) {
  let mode = earlyAccess.paneMode(s);
  if (mode === 'joined' && showWaitlistForm) mode = 'form';
  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  };
  show('cloud-classic', mode === 'classic');
  show('cloud-early', mode !== 'classic');
  show('cloud-early-form', mode === 'form');
  show('cloud-early-joined', mode === 'joined');
  if (mode === 'joined') setText('cloud-waitlist-joined-body', earlyAccess.joinedBody(s.waitlistEmail));
}

/**
 * The session as the window presents it. "Use another address" brings the
 * waitlist form back without forgetting the stored address, so until the next
 * join the listeners (the header entry) read it as not joined, like the pane.
 */
function presentedSession() {
  if (!showWaitlistForm || !sessionState.waitlistEmail) return sessionState;
  const { waitlistEmail, ...rest } = sessionState;
  return rest;
}

function notifySession() {
  const s = presentedSession();
  for (const listener of sessionListeners) listener(s);
}

function pullSession() {
  return ipcRenderer
    .invoke(IPC.CLOUD_GET_STATE)
    .then((state) => {
      renderSession(state);
      return state;
    })
    .catch((err) => {
      console.error('Frame Cloud: could not read the session state', err);
      return null;
    });
}

function pullProjects() {
  return ipcRenderer
    .invoke(IPC.CLOUD_PROJECTS_GET_STATE)
    .then((state) => {
      renderProjects(state);
      return state;
    })
    .catch((err) => {
      console.error('Frame Cloud: could not read the projects state', err);
      return null;
    });
}

/** Re-read the list; the candidates follow (both tabs read them). */
function refreshProjects() {
  return ipcRenderer
    .invoke(IPC.CLOUD_PROJECTS_REFRESH)
    .then((state) => {
      renderProjects(state);
      if (tabs && tabs.onShow) tabs.onShow(activeTab, { force: true });
      return state;
    })
    .catch((err) => {
      console.error('Frame Cloud: could not refresh the projects', err);
      return null;
    });
}

// ─── Actions ──────────────────────────────────────────────

async function onAction(action, btn) {
  switch (action) {
    case 'signIn':
      return invokeSession(IPC.CLOUD_SIGN_IN, btn);
    case 'cancel':
      return invokeSession(IPC.CLOUD_CANCEL_SIGN_IN, btn);
    case 'signOut':
      return invokeSession(IPC.CLOUD_SIGN_OUT, btn);
    case 'refresh':
      if (btn) btn.disabled = true;
      await refreshProjects();
      if (btn) btn.disabled = false;
      return;
    case 'openBrowser':
      if (isWebUrl(sessionState.verificationUrl)) shell.openExternal(sessionState.verificationUrl);
      return;
    case 'joinWaitlist':
      // failed → signed out, where the waitlist form is.
      return invokeSession(IPC.CLOUD_CANCEL_SIGN_IN, btn);
    case 'openWorkspace':
      ipcRenderer.invoke(IPC.CLOUD_OPEN_WORKSPACE_ON_WEB).catch((err) => {
        console.error('Frame Cloud: could not open the workspace on the web', err);
      });
      return;
    case 'copyUrl':
      if (!sessionState.verificationUrl) return;
      clipboard.writeText(sessionState.verificationUrl);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      return;
    default:
      return;
  }
}

async function invokeSession(channel, btn) {
  if (btn) btn.disabled = true;
  try {
    renderSession(await ipcRenderer.invoke(channel));
  } catch (err) {
    console.error(`Frame Cloud: ${channel} failed`, err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Session ──────────────────────────────────────────────

function renderSession(state) {
  const previous = sessionState.state;
  sessionState = state && state.state ? state : { state: 'unavailable' };
  const s = sessionState;
  if (rootEl) {
    rootEl.querySelectorAll('[data-cloud-state]').forEach((pane) => {
      pane.hidden = pane.dataset.cloudState !== s.state;
    });
    const welcome = document.getElementById('cloud-welcome');
    if (welcome) welcome.hidden = !WELCOME_STATES.includes(s.state);
    setNote('signedOutUnreachable', s.state === 'signedOut' && s.serverUnreachable);
    setNote('ephemeral', s.state === 'signedIn' && s.ephemeral);
    setNote('signedInUnreachable', s.state === 'signedIn' && s.serverUnreachable);
    if (s.state !== 'signedIn') setNote('justSignedIn', false);

    if (s.state === 'signedOut') renderEarlyAccess(s);
    setNote('inviteHint', s.state === 'awaitingApproval' && s.inviteOnly === true);
    if (s.state === 'awaitingApproval') {
      setText('cloud-code', s.userCode || '');
      setText('cloud-url', s.verificationUrl || '');
    } else if (s.state === 'signedIn') {
      renderHeader(s);
      // Main brought the window forward; land the user on the result.
      if (previous === 'registering') land();
    } else if (s.state === 'failed') {
      const inviteExpired = s.reason === 'expired' && s.inviteOnly === true;
      setText('cloud-reason', inviteExpired ? earlyAccess.COPY.expired : REASONS[s.reason] || REASONS.network);
      const joinBtn = document.getElementById('cloud-failed-waitlist');
      if (joinBtn) joinBtn.hidden = !inviteExpired;
      const webLink = document.getElementById('cloud-web-link');
      if (webLink) webLink.hidden = !(s.reason === 'noWorkspace' && webOrigin(s.verificationUrl));
    }
  }
  // A server address that stops resolving takes the modal with it.
  if (s.state === 'unavailable' && overlay && overlay.isOpen()) overlay.close();
  notifySession();
}

function land() {
  if (overlay && !overlay.isOpen()) {
    if (isBlocked()) return;
    overlay.open();
  }
  setNote('justSignedIn', true);
  clearTimeout(signedInNoteTimer);
  signedInNoteTimer = setTimeout(() => setNote('justSignedIn', false), SIGNED_IN_NOTE_MS);
}

function renderHeader(s) {
  const user = s.user || {};
  const workspaceRow = noWorkspaceCopy.workspaceRow(s.workspace);
  // With a workspace, the role stands beside it ("Acme · Developer").
  const workspaceValue = s.workspace && s.workspace.slug ? cloudRoles.workspaceLine(s.workspace) : workspaceRow.value;
  const device = s.device || {};
  setText('cloud-user-name', user.name || user.email || '—');
  setText('cloud-user-sub', user.githubLogin ? `@${user.githubLogin}` : user.name ? user.email || '' : '');
  renderAvatar(user);
  setText('cloud-workspace', workspaceValue);
  setText('cloud-workspace-link-label', workspaceRow.link);
  setText('cloud-device', device.name || '—');
}

// The account picture when the server has one and it loads; initials
// otherwise ("Ada Lovelace" → "AL").
function renderAvatar(user) {
  const img = document.getElementById('cloud-avatar-img');
  const initials = document.getElementById('cloud-avatar-initials');
  if (initials) {
    initials.textContent = String(user.name || user.email || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('');
  }
  if (!img) return;
  const src = isWebUrl(user.image) ? user.image : '';
  if (!src) {
    img.hidden = true;
    img.removeAttribute('src');
    if (initials) initials.hidden = false;
    return;
  }
  if (img.getAttribute('src') === src) return;
  img.hidden = true;
  img.onload = () => {
    img.hidden = false;
    if (initials) initials.hidden = true;
  };
  img.onerror = () => {
    img.hidden = true;
    if (initials) initials.hidden = false;
  };
  img.src = src;
}

// ─── Projects ─────────────────────────────────────────────

function renderProjects(state) {
  if (!state || typeof state !== 'object') return;
  projectsState = state;
  const count = document.getElementById('cloud-device-count');
  if (count) {
    const n = state.status === 'signedOut' ? 0 : Number(state.unconnectedCount) || 0;
    count.textContent = n ? `(${n})` : '';
  }
  const updated = document.getElementById('cloud-last-updated');
  if (updated) {
    updated.textContent = state.lastUpdated && state.status !== 'loading'
      ? `Last updated ${formatRelative(new Date(state.lastUpdated))}`
      : state.status === 'loading' ? 'Loading…' : '';
    updated.classList.toggle('cloud-last-updated-stale', state.status === 'stale');
  }
  renderStandIn(state);
  if (tabs) tabs.render(state, activeTab);
  // One-shot, set by main only after a sign-in the user started.
  if (state.autoShowDevices) showDevicesPrompt(state);
  for (const listener of projectsListeners) listener(state);
}

/**
 * Which card stands in for the tab bar and both tabs, or null for the tabs:
 * `noWorkspace` signed in without a workspace (it wins, frame-cloud-roles D7),
 * `viewer` with a workspace whose role cannot work (D2). Only an explicit
 * `work: false` draws the viewer card, so a state without permissions never
 * flashes it.
 */
function standInFor(state) {
  if (!state) return null;
  if (state.status === 'noWorkspace') return 'noWorkspace';
  if (state.status === 'signedOut') return null;
  if (state.permissions && state.permissions.work === false) return 'viewer';
  return null;
}

/**
 * The stand-in panel: the tab bar, both tabs and the devices notice give way
 * to one card. Without a workspace it leads to creating one on the web; for a
 * viewer it says viewers follow the work on the web. A workspace that appears,
 * or a role that can work, brings the tabs back on the active one.
 */
function renderStandIn(state) {
  const panelEl = document.getElementById('cloud-no-workspace');
  if (!panelEl || !rootEl) return;
  const tabbar = document.getElementById('cloud-tabbar');
  const card = standInFor(state);
  if (!card) {
    if (panelEl.hidden) return;
    panelEl.hidden = true;
    panelEl.replaceChildren();
    delete panelEl.dataset.card;
    if (tabbar) tabbar.hidden = false;
    setTab(activeTab);
    return;
  }

  if (tabbar) tabbar.hidden = true;
  rootEl.querySelectorAll('[data-cloud-panel]').forEach((panel) => {
    panel.hidden = true;
  });
  hideDevicesPrompt();

  const copy = card === 'viewer'
    ? cloudRoles.viewerPanel({ workspace: state.cloudWorkspace, canOpenWeb: state.canOpenWeb })
    : noWorkspaceCopy.panel(Array.isArray(state.folders) ? state.folders.length : 0);
  const title = document.createElement('h3');
  title.className = 'cloud-no-workspace-title';
  title.textContent = copy.title;
  const body = document.createElement('p');
  body.className = 'cloud-no-workspace-body';
  body.textContent = copy.body;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-about-btn settings-about-btn-primary cloud-no-workspace-btn';
  const label = document.createElement('span');
  label.textContent = copy.button;
  button.appendChild(label);
  button.insertAdjacentHTML('beforeend', EXTERNAL_ICON); // static markup, no server string
  // Both open the workspace's web page: main picks /new when there is none.
  if (state.canOpenWeb) {
    button.addEventListener('click', () => onAction('openWorkspace', button));
  } else {
    button.disabled = true;
    button.title = copy.buttonTitle || noWorkspaceCopy.NO_WEB_ORIGIN;
  }
  const local = document.createElement('p');
  local.className = 'cloud-no-workspace-local';
  local.textContent = copy.local;
  panelEl.replaceChildren(title, body, button, local);
  panelEl.dataset.card = card;
  panelEl.hidden = false;
}

/**
 * After a user-started sign-in with folders left to connect: switch the
 * modal (already open from the sign-in) to On this device under one line.
 * Never opens the modal itself.
 */
function showDevicesPrompt(state) {
  if (!overlay || !overlay.isOpen()) return;
  const n = Number(state.unconnectedCount) || 0;
  const notice = document.getElementById('cloud-device-notice');
  if (!n || !notice) return;
  const ws = state.cloudWorkspace || {};
  const where = ws.name || ws.slug || 'Frame Cloud';
  const text = document.createElement('span');
  text.textContent = n === 1
    ? `1 project on this device isn't in ${where}.`
    : `${n} projects on this device aren't in ${where}.`;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'settings-about-btn cloud-row-btn';
  dismiss.textContent = "Don't show again";
  dismiss.addEventListener('click', () => {
    notice.hidden = true;
    // Stops only this automatic switch; the tab and its actions stay.
    ipcRenderer.invoke(IPC.SET_USER_SETTING, PROMPT_DISMISSED_KEY, true).catch((err) => {
      console.error('Frame Cloud: could not save the prompt preference', err);
    });
  });
  notice.replaceChildren(text, dismiss);
  notice.hidden = false;
  setTab('device', { force: true });
}

function hideDevicesPrompt() {
  const notice = document.getElementById('cloud-device-notice');
  if (notice) notice.hidden = true;
}

function setTab(tab, opts = {}) {
  if (!TABS.includes(tab)) return;
  const changed = tab !== activeTab;
  activeTab = tab;
  if (tab !== 'device') hideDevicesPrompt();
  if (rootEl) {
    rootEl.querySelectorAll('[data-cloud-tab]').forEach((btn) => {
      const on = btn.dataset.cloudTab === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // Without a workspace, or for a viewer, a card stands in for both tabs.
    const standIn = Boolean(standInFor(projectsState));
    rootEl.querySelectorAll('[data-cloud-panel]').forEach((panel) => {
      panel.hidden = standIn || panel.dataset.cloudPanel !== tab;
    });
  }
  if (tabs) {
    if (projectsState) tabs.render(projectsState, activeTab);
    if (tabs.onShow && (changed || opts.force)) tabs.onShow(tab, opts);
  }
}

// ─── Public API ───────────────────────────────────────────

/**
 * Open Frame Cloud. `tab` picks 'projects' or 'device'; `folderPath` asks the
 * device tab to bring that folder's row into view, and `confirmDisconnect`
 * opens that row's Disconnect question.
 */
function open({ tab, folderPath, confirmDisconnect } = {}) {
  if (!overlay) return;
  if (sessionState.state === 'unavailable') return;
  overlay.open();
  if (tab) setTab(tab, { folderPath, confirmDisconnect, force: true });
}

/** Palette "Frame Cloud: Sign in" and the Sign in buttons in both settings surfaces: open here and start. */
function signIn() {
  if (!overlay || sessionState.state === 'unavailable') return;
  overlay.open();
  if (sessionState.state !== 'signedIn') invokeSession(IPC.CLOUD_SIGN_IN);
}

/** Palette "Frame Cloud: Sign out": no modal. */
function signOut() {
  return invokeSession(IPC.CLOUD_SIGN_OUT);
}

// ─── Helpers ──────────────────────────────────────────────

function setNote(name, visible) {
  if (!rootEl) return;
  const el = rootEl.querySelector(`[data-cloud-note="${name}"]`);
  if (el) el.hidden = !visible;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// "Primary · secondary", built from text nodes — server strings never become HTML.
function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function webOrigin(url) {
  if (!isWebUrl(url)) return '';
  try {
    return new URL(url).origin;
  } catch (e) {
    return '';
  }
}

function formatRelative(date) {
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs)) return '';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const api = {
  init,
  open,
  close: () => overlay && overlay.close(),
  toggle: () => {
    if (!overlay) return;
    if (overlay.isOpen()) overlay.close();
    else open();
  },
  isOpen: () => Boolean(overlay && overlay.isOpen()),
  signIn,
  signOut,
  setTab,
  refreshProjects,
  formatRelative,
  accountState: () => sessionState.state,
  session: () => presentedSession(),
  projects: () => projectsState,
  activeTab: () => activeTab,
  /** Listen to session renders. Returns the unsubscribe function. */
  onSession: (fn) => {
    sessionListeners.add(fn);
    return () => sessionListeners.delete(fn);
  },
  /** Listen to projects renders. Returns the unsubscribe function. */
  onProjects: (fn) => {
    projectsListeners.add(fn);
    return () => projectsListeners.delete(fn);
  },
};

module.exports = api;
