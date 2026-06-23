// Supervisor UI (renderer) — Phase A skeleton.
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

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');

let seq = 0;

function createViewport() {
  const key = `supervisor-vp:${++seq}`;

  function navigate(/* itemRef */) {
    // Phase A: section has no sub-navigation. Phase B introduces project /
    // kanban routing via this hook.
  }

  function getChip() {
    return { type: 'supervisor', title: 'Supervisor' };
  }

  function render(el) {
    el.innerHTML = `
      <div style="padding: 24px; font-family: var(--font-sans); color: var(--text-primary);">
        <h2 style="margin: 0 0 8px;">Supervisor — Loading…</h2>
        <p style="color: var(--text-secondary); margin: 0;">
          Phase A skeleton. Real content arrives in Phase B.
        </p>
        <p style="color: var(--text-secondary); margin: 16px 0 0; font-size: 12px;">
          Phase A handshake: <span id="supervisor-ping-result">testing…</span>
        </p>
      </div>
    `;
    // Round-trip SUPERVISOR_PING to confirm the bridge wiring is alive.
    ipcRenderer.invoke(SUP.SUPERVISOR_PING).then((r) => {
      const out = el.querySelector('#supervisor-ping-result');
      if (out) out.textContent = JSON.stringify(r);
    }).catch((err) => {
      const out = el.querySelector('#supervisor-ping-result');
      if (out) out.textContent = `error: ${err && err.message ? err.message : String(err)}`;
    });
  }

  function dispose() {
    // Phase A has no listeners to tear down. Phase C will unsubscribe from
    // SUPERVISOR_STATE here.
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
