// Supervisor UI (renderer) — Phase B composition.
//
// Per docs/frame-edit-discipline.md §1.6, the renderer addition is a standalone
// module under src/renderer/supervisor-ui/ exposing ONE init() function. The
// Frame edit is a single supervisor-mod line in src/renderer/index.js that
// invokes init().
//
// Q1 resolution (see docs/frame-modifications.md): src/renderer/multiTerminalUI.js
// openSection(type, itemRef, factory, opts) treats `type` as an opaque string
// (only used for "find existing viewport of same type" matching at L222-224).
// No dispatch table; no registration required. This module is the factory.
//
// Phase B: createViewport().render(el) composes header + projectTree + kanban
// and wires teardown into the viewport's dispose() hook (already invoked by
// multiTerminalUI on section close — see multiTerminalUI.js:248).

const path = require('path');
const SUP = require('../../shared/supervisor-ipc');

let seq = 0;
let stylesInjected = false;
// Phase E: the OS-notification click handler needs to drive kanban.scrollToTask
// on whichever supervisor viewport is currently mounted. createViewport keeps
// its own `controllers` in closure for normal teardown; we mirror the last
// rendered set here purely so the click path can find it without plumbing.
let latestControllers = null;

function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  // index.html is loaded with loadFile('index.html') (see src/main/index.js:55);
  // relative href resolves against the project root.
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'src/renderer/supervisor-ui/styles.css';
  link.dataset.supervisorStyles = '1';
  document.head.appendChild(link);
}

function createViewport() {
  const key = `supervisor-vp:${++seq}`;
  let controllers = null;
  let rendered = false;

  function navigate(/* itemRef */) {
    // multiTerminalUI.openSection() calls navigate() once after creating the
    // viewport — every other section module (diffSection, specSection,
    // taskSection, orchestrator) signals notifySectionChanged() here to
    // trigger the host's section render. Without this, the viewport stays
    // off-screen and render() is never invoked.
    const terminal = require('../terminal');
    const host = terminal.getMultiTerminalUI();
    if (host) host.notifySectionChanged();
  }

  function getChip() {
    return { type: 'supervisor', title: 'Supervisor' };
  }

  function render(el) {
    injectStylesOnce();
    // Phase I: the right pane gains a tab bar so the Profile panel can live
    // alongside the kanban without competing for vertical space. Default tab
    // stays Kanban — clicking Profile switches visibility via CSS .active
    // toggles so both controllers can stay mounted (kanban's polling/state
    // listener already deals with being off-screen).
    el.innerHTML = `
      <div class="supervisor-root">
        <div class="supervisor-header" id="supervisor-header"></div>
        <div class="supervisor-body">
          <aside class="supervisor-tree" id="supervisor-tree"></aside>
          <main class="supervisor-main">
            <div class="supervisor-tabbar" role="tablist">
              <button type="button" class="sup-tab active" role="tab"
                      data-tab="kanban" aria-selected="true">Kanban</button>
              <button type="button" class="sup-tab" role="tab"
                      data-tab="profile" aria-selected="false">Profile</button>
              <button type="button" class="sup-tab" role="tab"
                      data-tab="memory" aria-selected="false">Memory</button>
            </div>
            <div class="supervisor-tabpanes">
              <div class="supervisor-kanban sup-tabpane active"
                   id="supervisor-kanban" role="tabpanel" data-tab="kanban"></div>
              <div class="supervisor-profile sup-tabpane"
                   id="supervisor-profile" role="tabpanel" data-tab="profile"></div>
              <div class="supervisor-memory sup-tabpane"
                   id="supervisor-memory" role="tabpanel" data-tab="memory"></div>
            </div>
          </main>
        </div>
      </div>
    `;
    const header = require('./header').create(el.querySelector('#supervisor-header'));
    const kanban = require('./kanban').create(el.querySelector('#supervisor-kanban'));
    // Shared file-opener used by the Profile and Memory panels — Phase P
    // routes through ./openFile so .md citations land in Frame's markdown
    // viewer and .yaml/.json/code sources land in the user's default OS
    // editor (VS Code, etc) instead of silently failing in the overlay.
    const { openFile } = require('./openFile');
    const openInFrameEditor = (absPath) => openFile(absPath);
    const profile = require('./profilePanel').create(
      el.querySelector('#supervisor-profile'),
      { onOpenFile: openInFrameEditor }
    );
    const memory = require('./memoryPanel').create(
      el.querySelector('#supervisor-memory'),
      { onOpenFile: openInFrameEditor }
    );
    const projectFilter = require('./projectFilter');
    const tree = require('./projectTree').create(
      el.querySelector('#supervisor-tree'),
      {
        onScrollToTask: (id) => kanban.scrollToTask(id),
        // Phase I: surface the selected project to the profile panel. We
        // don't auto-flip the tab — the spec wants the user to manually
        // switch tabs, and yanking them out of the kanban on every tree
        // click would be hostile. The Profile pane just stays primed for
        // whenever they do switch.
        onSelectProject: (project) => {
          profile.setProject(project);
          memory.setProject(project);
          // Phase M: clicking a project also drives the global project
          // filter so kanban + header dropdown follow. The user can clear
          // the filter from the header (or by picking "All projects").
          projectFilter.set(project && project.name);
        },
      }
    );
    // Wire kanban → profile + tree + header so the YAML fallback and the
    // merged-project list can resolve. The kanban controller already
    // resolves supervisorRoot during its initial poll; we propagate it on a
    // 1.5s delay (enough for the first /api/meta round-trip).
    setTimeout(() => {
      if (!rendered || !kanban) return;
      const sr = typeof kanban.getSupervisorRoot === 'function'
        ? kanban.getSupervisorRoot() : null;
      try { if (sr) profile.setSupervisorRoot(sr); } catch {}
      try { if (sr && typeof tree.setSupervisorRoot === 'function') tree.setSupervisorRoot(sr); } catch {}
      try { if (sr && typeof header.setSupervisorRoot === 'function') header.setSupervisorRoot(sr); } catch {}
    }, 1500);

    function activateTab(name) {
      const tabs = el.querySelectorAll('.supervisor-tabbar .sup-tab');
      const panes = el.querySelectorAll('.supervisor-tabpanes .sup-tabpane');
      tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach((p) => p.classList.toggle('active', p.dataset.tab === name));
    }
    el.querySelectorAll('.supervisor-tabbar .sup-tab').forEach((t) => {
      t.addEventListener('click', () => activateTab(t.dataset.tab));
    });

    controllers = { header, tree, kanban, profile, memory };
    latestControllers = controllers;
    rendered = true;
  }

  function dispose() {
    // multiTerminalUI.closeSection() calls viewport.dispose() — wire down all
    // pollers + listeners here so the supervisor view stops polling /api/* once
    // the user closes the tab.
    if (controllers) {
      try { controllers.header.stop(); } catch {}
      try { controllers.tree.stop(); } catch {}
      try { controllers.kanban.stop(); } catch {}
      try { if (controllers.profile) controllers.profile.stop(); } catch {}
      try { if (controllers.memory) controllers.memory.stop(); } catch {}
      if (latestControllers === controllers) latestControllers = null;
      controllers = null;
    }
    rendered = false;
  }

  return {
    type: 'supervisor',
    key,
    viewClass: 'section-view',
    navigate,
    getChip,
    render,
    dispose,
  };
}

function open() {
  const terminal = require('../terminal');
  const host = terminal.getMultiTerminalUI();
  if (!host) return;
  host.openSection('supervisor', null, api, { newTab: false });
}

function handleNotifyClick({ taskId, kind } = {}) {
  // Always open / focus the section first so a closed tab still routes to the
  // task. open() reuses the existing viewport when one is present.
  open();
  if (!taskId) return;
  // multiTerminalUI.openSection() runs render() synchronously when it creates
  // a new viewport, but state propagation through notifySectionChanged() is
  // async (it goes through _onStateChange). Defer the scroll one tick so the
  // kanban is mounted + visible before we ask it to scroll.
  setTimeout(() => {
    const k = latestControllers && latestControllers.kanban;
    if (k && typeof k.scrollToTask === 'function') {
      try { k.scrollToTask(taskId); } catch (err) {
        console.warn('[supervisor] scrollToTask failed:', err);
      }
    }
    // Phase R: a click on a "task done" toast should open the detail modal
    // directly so the user lands on the deliverables / lifecycle recap
    // instead of having to also click the card. OS-notification clicks omit
    // `kind` and keep the original scroll-only behavior so they don't slam
    // a modal over the user's current view on escalations / failures.
    if (kind === 'done') {
      const k2 = latestControllers && latestControllers.kanban;
      const sr = k2 && typeof k2.getSupervisorRoot === 'function' ? k2.getSupervisorRoot() : null;
      const { SUPERVISOR_API } = require('./header');
      const taskDetailModal = require('./taskDetailModal');
      const { openFile } = require('./openFile');
      fetch(`${SUPERVISOR_API}/api/workspace`)
        .then((r) => r.ok ? r.json() : null)
        .then((ws) => {
          if (!ws) return;
          const cols = ws.columns || {};
          const all = [
            ...(cols.pending || []),
            ...(cols.active || []),
            ...(cols.awaiting || []),
            ...(cols.done || []),
          ];
          const t = all.find((x) => x && x.id === taskId);
          if (!t) return;
          try {
            taskDetailModal.open(t, { supervisorRoot: sr, onOpenFile: openFile });
          } catch (err) {
            console.warn('[supervisor] open detail modal from toast failed:', err);
          }
        })
        .catch(() => { /* quiet — toast click is best-effort */ });
    }
  }, 120);
}

// Phase F: predicate for the palette `when` clause. A command should only be
// offered when the supervisor section is the currently-active tab. We can't
// just check `latestControllers` because that's truthy for any open viewport,
// even one in a background tab. Ask multiTerminalUI for the active section.
function isSupervisorActive() {
  try {
    const host = require('../terminal').getMultiTerminalUI();
    if (!host || !host.isSectionVisible) return false;
    const active = typeof host._activeSection === 'function' ? host._activeSection() : null;
    return !!(active && active.type === 'supervisor');
  } catch {
    return false;
  }
}

function init() {
  const { ipcRenderer } = require('electron');
  const { register } = require('../commandRegistry');
  register({
    id: 'supervisor.open',
    title: 'Open Supervisor',
    category: 'Supervisor',
    shortcut: 'CmdOrCtrl+Shift+U',
    run: () => open(),
  });
  // Phase F: palette commands for the four most common supervisor actions.
  // Submit-task and Tail are section-gated so they don't surface when the
  // user is in some unrelated view; daemon start/stop are global because the
  // daemon affects every supervisor session regardless of which tab is open.
  register({
    id: 'supervisor.submit-task',
    title: 'Supervisor — Submit task',
    category: 'Supervisor',
    shortcut: 'CmdOrCtrl+Shift+N',
    when: () => isSupervisorActive(),
    run: () => require('./submitTaskPanel').open(),
  });
  register({
    id: 'supervisor.start-daemon',
    title: 'Supervisor — Start daemon',
    category: 'Supervisor',
    run: () => {
      ipcRenderer.invoke(SUP.SUPERVISOR_DAEMON_START)
        .catch((err) => console.warn('[supervisor] daemon start failed:', err));
    },
  });
  register({
    id: 'supervisor.stop-daemon',
    title: 'Supervisor — Stop daemon (confirm)',
    category: 'Supervisor',
    run: () => {
      if (!window.confirm('Stop the supervisor daemon? In-flight tasks finish first.')) return;
      ipcRenderer.invoke(SUP.SUPERVISOR_DAEMON_STOP)
        .catch((err) => console.warn('[supervisor] daemon stop failed:', err));
    },
  });
  register({
    id: 'supervisor.tail-current',
    title: 'Supervisor — Tail current in-flight task',
    category: 'Supervisor',
    when: () => isSupervisorActive(),
    run: () => require('./kanban').expandTailOnFirstInflight(),
  });
  // Phase E: start the OS-notification detector at init() so escalations /
  // failures / daemon-stale alerts fire for the whole Frame session, not just
  // while the supervisor tab is open. The detector itself is idempotent —
  // calling start() twice is a no-op.
  const notifications = require('./notifications');
  notifications.start({ onNotifyClick: handleNotifyClick });
  // Phase F: the sidebar-footer heartbeat chip mounts itself when the host
  // calls require('./sidebar-ui/sidebarChip').mount(); subscribing to
  // SUPERVISOR_STATE is started lazily on mount and runs for the whole
  // Frame session.
}

const api = { init, open, createViewport, __getLatestControllers: () => latestControllers };
module.exports = api;
