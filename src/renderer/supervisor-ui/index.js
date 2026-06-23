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
    // Phase B section has no sub-navigation. Phase D will route to a specific
    // project / task here.
  }

  function getChip() {
    return { type: 'supervisor', title: 'Supervisor' };
  }

  function render(el) {
    injectStylesOnce();
    el.innerHTML = `
      <div class="supervisor-root">
        <div class="supervisor-header" id="supervisor-header"></div>
        <div class="supervisor-body">
          <aside class="supervisor-tree" id="supervisor-tree"></aside>
          <main class="supervisor-kanban" id="supervisor-kanban"></main>
        </div>
      </div>
    `;
    const header = require('./header').create(el.querySelector('#supervisor-header'));
    const tree = require('./projectTree').create(el.querySelector('#supervisor-tree'));
    const kanban = require('./kanban').create(el.querySelector('#supervisor-kanban'));
    controllers = { header, tree, kanban };
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

function init() {
  const { register } = require('../commandRegistry');
  register({
    id: 'supervisor.open',
    title: 'Open Supervisor',
    category: 'Supervisor',
    shortcut: 'CmdOrCtrl+Shift+U',
    run: () => open(),
  });
}

const api = { init, open, createViewport };
module.exports = api;
