// Supervisor project tree — Phase B.
//
// Left rail listing supervisor-known projects. Source: /api/memory/projects
// (the actual server has no /api/meta.projects array — that was inferred in
// the brief; reality lives in supervisor/scripts/monitor/server.py:691).
//
// Per project, lazy-fetch docs (via SUPERVISOR_LIST_PROJECT_DOCS IPC). Clicking
// a doc routes through editor.openFile(absPath).
//
// `queue/` child (per-project task filter) is deferred: workspace tasks don't
// carry a project_id field. `.frame/specs/` child is deferred: no backend
// endpoint exists for it yet. Both reappear when their data sources land.

const { ipcRenderer } = require('electron');
const SUP = require('../../shared/supervisor-ipc');
const { SUPERVISOR_API } = require('./header');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function fetchJson(p) {
  const res = await fetch(`${SUPERVISOR_API}${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function openDoc(absPath) {
  try {
    const editor = require('../editor');
    editor.openFile(absPath, 'supervisor');
  } catch (err) {
    console.warn('[supervisor] editor.openFile failed:', err);
  }
}

function create(root) {
  let alive = true;

  root.innerHTML = '<div class="sup-tree-empty">Loading projects…</div>';

  function buildDocsChildEl(projectId) {
    const wrap = document.createElement('div');
    wrap.className = 'sup-tree-node';
    wrap.innerHTML = `
      <div class="sup-tree-row group" data-act="toggle-docs">
        <span class="sup-chev">▸</span>
        <span class="sup-label">docs</span>
      </div>
      <div class="sup-tree-children"></div>
    `;
    const childrenEl = wrap.querySelector('.sup-tree-children');
    const rowEl = wrap.querySelector('.sup-tree-row');
    let loaded = false;
    rowEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      const expanded = wrap.classList.toggle('expanded');
      rowEl.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
      if (expanded && !loaded) {
        loaded = true;
        childrenEl.innerHTML = '<div class="sup-tree-loading">loading…</div>';
        try {
          const docs = await ipcRenderer.invoke(
            SUP.SUPERVISOR_LIST_PROJECT_DOCS,
            { project_id: projectId, project_path: null }
          );
          if (!alive) return;
          childrenEl.innerHTML = '';
          if (!docs || !docs.length) {
            childrenEl.innerHTML = '<div class="sup-tree-loading">no docs</div>';
            return;
          }
          docs.forEach((d) => {
            const row = document.createElement('div');
            row.className = 'sup-tree-row leaf';
            row.title = d.path;
            row.innerHTML = `<span class="sup-label">${esc(d.label)}</span>`;
            row.addEventListener('click', (ev) => {
              ev.stopPropagation();
              openDoc(d.path);
            });
            childrenEl.appendChild(row);
          });
        } catch (err) {
          childrenEl.innerHTML = `<div class="sup-tree-loading">error: ${esc(err.message || err)}</div>`;
        }
      }
    });
    return wrap;
  }

  function buildProjectNode(p) {
    const node = document.createElement('div');
    node.className = 'sup-tree-node';
    const notesLabel = typeof p.notes === 'number' ? `${p.notes}` : '';
    node.innerHTML = `
      <div class="sup-tree-row project">
        <span class="sup-chev">▸</span>
        <span class="sup-label">${esc(p.name)}</span>
        <span class="sup-meta-chip">${esc(notesLabel)}</span>
      </div>
      <div class="sup-tree-children"></div>
    `;
    const rowEl = node.querySelector('.sup-tree-row');
    const childrenEl = node.querySelector('.sup-tree-children');
    let built = false;
    rowEl.addEventListener('click', () => {
      const expanded = node.classList.toggle('expanded');
      rowEl.querySelector('.sup-chev').textContent = expanded ? '▾' : '▸';
      if (expanded && !built) {
        built = true;
        childrenEl.appendChild(buildDocsChildEl(p.name));
      }
    });
    return node;
  }

  async function load() {
    try {
      const projects = await fetchJson('/api/memory/projects');
      if (!alive) return;
      root.innerHTML = '';
      if (!projects || !projects.length) {
        root.innerHTML = '<div class="sup-tree-empty">No projects registered</div>';
        return;
      }
      projects.forEach((p) => {
        root.appendChild(buildProjectNode(p));
      });
    } catch (err) {
      if (!alive) return;
      root.innerHTML = `<div class="sup-tree-empty">supervisor unreachable<br/><small>${esc(err.message || err)}</small></div>`;
    }
  }

  function start() {
    load();
  }

  function stop() {
    alive = false;
  }

  start();
  return { start, stop, refresh: load };
}

module.exports = { create };
