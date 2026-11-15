/**
 * Send files to server — pick the files git does not carry and send them to
 * a server workspace (server-copy-files).
 *
 * Opened after a server workspace is created (before its setup script and
 * agent start, since setup often needs `.env`) and from a server workspace's
 * row menu. Nothing is sent unless ticked; the rules — tree, defaults, heavy
 * folders, size verdict, Remember patterns — live in the tested
 * shared/sendFilesModel; this file only draws them.
 *
 * open({ projectPath, workspace, context: 'create'|'resend' })
 *   → Promise<{ sent: result } | { skipped: true } | { error }>
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const model = require('../shared/sendFilesModel');
const { escapeHtml } = require('./htmlUtils');

const SERVER_LABEL = { same: 'on the server', changed: 'changed on this Mac', missing: '' };

function open({ projectPath, workspace, context = 'resend' } = {}) {
  return new Promise((resolve) => {
    const host = (workspace && workspace.host) || 'the server';
    const overlay = document.createElement('div');
    overlay.className = 'spec-modal-overlay';
    overlay.innerHTML = `
      <div class="spec-modal send-files-modal" role="dialog" aria-modal="true" aria-labelledby="sf-title">
        <h3 id="sf-title">Send files to ${escapeHtml(host)}</h3>
        <p class="sf-sub">Files git does not carry, from this Mac to <strong>${escapeHtml((workspace && workspace.name) || 'the workspace')}</strong>. Nothing is sent unless it is ticked.</p>
        <div class="sf-body"><div class="sf-note">Reading the project…</div></div>
        <div class="sf-footer" hidden>
          <div class="sf-bulk">
            <button type="button" class="btn btn-secondary sf-all">Select all</button>
            <button type="button" class="btn btn-secondary sf-none">Select none</button>
            <span class="sf-size"></span>
          </div>
          <div class="sf-verdict" hidden></div>
          <label class="sf-remember"><input type="checkbox" class="sf-remember-box"> Remember this choice for this project</label>
        </div>
        <div class="spec-modal-actions">
          <button type="button" class="btn btn-secondary sf-skip">${context === 'create' ? 'Continue without files' : 'Cancel'}</button>
          <button type="button" class="btn btn-primary sf-send" disabled>Send</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const body = overlay.querySelector('.sf-body');
    const footer = overlay.querySelector('.sf-footer');
    const sizeEl = overlay.querySelector('.sf-size');
    const verdictEl = overlay.querySelector('.sf-verdict');
    const sendBtn = overlay.querySelector('.sf-send');
    const skipBtn = overlay.querySelector('.sf-skip');
    let tree = null;
    let selected = new Set();
    let busy = false;

    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); finish({ skipped: true }); }
    };
    document.addEventListener('keydown', onKey, true);
    skipBtn.addEventListener('click', () => { if (!busy) finish({ skipped: true }); });

    function nodeState(node) {
      const ls = model.leaves(node);
      const on = ls.filter((l) => selected.has(l.path)).length;
      return on === 0 ? 'none' : on === ls.length ? 'all' : 'some';
    }

    function rowHtml(node, depth) {
      const state = node.leaf ? (selected.has(node.path) ? 'all' : 'none') : nodeState(node);
      const notes = [];
      // A folder's contents are not compared: one that exists is just "on the server".
      const label = node.type === 'dir' && node.server === 'changed' ? 'folder on the server' : SERVER_LABEL[node.server];
      if (node.server && label) notes.push(`<span class="sf-tag sf-${node.type === 'dir' ? 'same' : node.server}">${label}</span>`);
      if (node.heavy) notes.push('<span class="sf-tag sf-heavy">rebuild on the server</span>');
      const size = node.leaf ? `<span class="sf-row-size">${model.formatBytes(node.size, node.sizeCut)}</span>` : '';
      const icon = node.type === 'dir' ? (node.leaf ? '▸' : '▾') : '';
      return `
        <label class="sf-row" style="padding-left:${8 + depth * 16}px" data-path="${escapeHtml(node.path)}" data-group="${node.group}">
          <input type="checkbox" class="sf-check"${state === 'all' ? ' checked' : ''} data-state="${state}">
          <span class="sf-icon">${icon}</span>
          <span class="sf-name">${escapeHtml(node.name)}${node.type === 'dir' ? '/' : ''}</span>
          ${notes.join('')}
          ${size}
        </label>`;
    }

    function groupHtml(root, title, note) {
      const rows = [];
      const walk = (n, depth) => {
        for (const c of n.children || []) {
          rows.push(rowHtml(c, depth));
          if (!c.leaf) walk(c, depth + 1);
        }
      };
      walk(root, 0);
      if (!rows.length) return '';
      return `<div class="sf-group"><div class="sf-group-title">${title}</div>${note ? `<div class="sf-group-note">${note}</div>` : ''}${rows.join('')}</div>`;
    }

    function findNode(groupName, p) {
      let hit = null;
      const walk = (n) => { if (n.path === p && n !== tree[groupName]) hit = n; (n.children || []).forEach(walk); };
      walk(tree[groupName]);
      return hit;
    }

    function render() {
      const html = groupHtml(tree.ignored, 'Ignored by git', '')
        + groupHtml(tree.untracked, 'Not committed yet', 'New files git does not track yet — committing them is usually the better way. Sent to this workspace only.');
      body.innerHTML = html || '<div class="sf-note">This project has no files outside git to send.</div>';
      body.querySelectorAll('.sf-check').forEach((box) => {
        box.indeterminate = box.dataset.state === 'some';
      });
      const { bytes, files, cut } = model.selectionSize(tree, selected);
      const verdict = model.sizeVerdict(bytes);
      sizeEl.textContent = files ? `${files} item${files === 1 ? '' : 's'} · ${model.formatBytes(bytes, cut)}` : 'Nothing ticked';
      verdictEl.hidden = verdict === 'ok';
      verdictEl.className = `sf-verdict sf-verdict-${verdict}`;
      verdictEl.textContent = verdict === 'refuse'
        ? 'More than 1 GB — untick dependency or build folders; they should be rebuilt on the server.'
        : verdict === 'warn' ? 'More than 50 MB — check that no dependency or build folder is ticked.' : '';
      sendBtn.disabled = busy || files === 0 || verdict === 'refuse';
    }

    body.addEventListener('change', (e) => {
      const box = e.target.closest('.sf-check');
      if (!box) return;
      const row = box.closest('.sf-row');
      const node = findNode(row.dataset.group, row.dataset.path);
      if (!node) return;
      selected = model.toggle(selected, node, box.checked);
      render();
    });
    overlay.querySelector('.sf-all').addEventListener('click', () => { selected = model.selectAll(tree); render(); });
    overlay.querySelector('.sf-none').addEventListener('click', () => { selected = new Set(); render(); });

    sendBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      sendBtn.textContent = 'Sending…';
      render();
      let res;
      try {
        res = await ipcRenderer.invoke(IPC.SEND_FILES_SEND, {
          projectPath,
          workspaceId: workspace.id,
          serverKey: workspace.serverKey || null,
          paths: [...selected],
          remember: overlay.querySelector('.sf-remember-box').checked
        });
      } catch (err) {
        res = { error: err.message };
      }
      busy = false;
      sendBtn.textContent = 'Send';
      if (!res || res.error) {
        render();
        verdictEl.hidden = false;
        verdictEl.className = 'sf-verdict sf-verdict-refuse';
        verdictEl.textContent = (res && res.error) || 'The files could not be sent.';
        return;
      }
      finish({ sent: res });
    });

    (async () => {
      let data;
      try {
        data = await ipcRenderer.invoke(IPC.SEND_FILES_LIST, { projectPath, workspaceId: workspace.id, serverKey: workspace.serverKey || null });
      } catch (err) {
        data = { error: err.message };
      }
      if (!overlay.isConnected) return;
      if (!data || data.error) {
        body.innerHTML = `<div class="sf-note sf-error">${escapeHtml((data && data.error) || 'Could not read the project.')}</div>`;
        skipBtn.textContent = context === 'create' ? 'Continue without files' : 'Close';
        return;
      }
      tree = model.buildTree({ ignored: data.ignored, untracked: data.untracked, sizes: data.sizes, server: data.server });
      selected = model.defaultSelection(tree, data.copyFiles);
      footer.hidden = model.leaves(tree).length === 0;
      render();
      // Nothing missing: say so, and Continue is the one click (spec S3).
      const missing = model.leaves(tree).filter((l) => !l.heavy && l.server !== 'same');
      if (model.leaves(tree).length && !missing.length) {
        body.insertAdjacentHTML('afterbegin', '<div class="sf-note">Everything here is already on the server.</div>');
      }
    })();
  });
}

/** One line for a notice: what was sent, overwritten and skipped. */
function summary(result) {
  if (!result) return '';
  const n = (result.written || []).length;
  const parts = [`Sent ${n} file${n === 1 ? '' : 's'} to the server`];
  if ((result.overwritten || []).length) parts.push(`overwrote ${result.overwritten.join(', ')}`);
  if ((result.skipped || []).length) parts.push(`skipped ${result.skipped.map((s) => `${s.path} (${s.reason})`).join(', ')}`);
  return `${parts.join('; ')}.`;
}

module.exports = { open, summary };
