#!/usr/bin/env node
// Phase I verification — exercises the four functional acceptance criteria
// against the committed code (HEAD = e16776e). Self-contained: stubs electron
// + a minimal DOM so the renderer module can run under plain node. NOT a real
// test framework — just a CLI proof script.
//
// Run: node tests/phase-i-verify.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const REPO = path.resolve(__dirname, '..');
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag} — ${name}${detail ? '\n      ' + detail : ''}`);
}

// ──────────────────────────────────────────────────────────────────────────
// Criterion 1 — Profile tab appears in supervisor right pane
// ──────────────────────────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(REPO, 'src/renderer/supervisor-ui/index.js'), 'utf8');
  const hasTabbar = /class="supervisor-tabbar"/.test(src);
  const hasKanbanTab = /data-tab="kanban"[^>]*>Kanban</.test(src);
  const hasProfileTab = /data-tab="profile"[^>]*>Profile</.test(src);
  const hasProfilePane = /supervisor-profile sup-tabpane/.test(src);
  const hasTabActivate = /activateTab/.test(src);
  record(
    'C1: Profile tab present in render() with tab bar + pane + activator',
    hasTabbar && hasKanbanTab && hasProfileTab && hasProfilePane && hasTabActivate,
    `tabbar=${hasTabbar} kanban-tab=${hasKanbanTab} profile-tab=${hasProfileTab} profile-pane=${hasProfilePane} activator=${hasTabActivate}`
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Stubs for electron + tiny DOM — needed before requiring the renderer module
// ──────────────────────────────────────────────────────────────────────────
const profileReader = require(path.join(REPO, 'src/main/supervisor-bridge/profileReader.js'));

let ipcInvokedWith = null;
const fakeElectron = {
  ipcRenderer: {
    invoke(channel, payload) {
      ipcInvokedWith = { channel, payload };
      // Re-route the renderer's IPC call straight into the main-side handler.
      // This is exactly what supervisor-bridge/index.js does at runtime.
      if (channel === 'supervisor:read-profile') {
        return Promise.resolve(profileReader.read(payload || {}));
      }
      return Promise.resolve({ ok: false, error: 'unhandled channel: ' + channel });
    },
  },
};
const origLoad = Module._load;
Module._load = function(req, parent) {
  if (req === 'electron') return fakeElectron;
  return origLoad.call(this, req, parent);
};

// Minimal DOM stub — supports the surface profilePanel.create() actually uses.
class FakeNode {
  constructor(tag, html) {
    this.tagName = (tag || 'div').toUpperCase();
    this._html = '';
    this._listeners = [];
    this._attrs = {};
    this.classList = {
      _cls: new Set(),
      add: (c) => this.classList._cls.add(c),
      remove: (c) => this.classList._cls.delete(c),
      contains: (c) => this.classList._cls.has(c),
      toggle: (c, v) => {
        const has = this.classList._cls.has(c);
        const want = (v === undefined) ? !has : !!v;
        if (want) this.classList._cls.add(c); else this.classList._cls.delete(c);
        return want;
      },
    };
    this.dataset = {};
    if (html != null) this.innerHTML = html;
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this._reparse(); }
  _reparse() {
    // Light-touch parse: discover elements by id and by classname so
    // querySelector(...) below has something to return. We don't need a real
    // tree — just the lookups the panel performs.
    this._byId = {};
    const idRe = /id="([^"]+)"/g; let m;
    while ((m = idRe.exec(this._html))) this._byId[m[1]] = new FakeNode('div');
  }
  querySelector(sel) {
    if (sel.startsWith('#')) return this._byId[sel.slice(1)] || null;
    return null;
  }
  querySelectorAll() { return []; }
  addEventListener(type, fn) { this._listeners.push({ type, fn }); }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  removeAttribute(k) { delete this._attrs[k]; }
  click() { this._listeners.filter((l) => l.type === 'click').forEach((l) => l.fn({})); }
}
global.document = {
  createElement: (tag) => new FakeNode(tag),
  head: { appendChild: () => {} },
};

const profilePanel = require(path.join(REPO, 'src/renderer/supervisor-ui/profilePanel.js'));

// ──────────────────────────────────────────────────────────────────────────
// Criterion 2 — Selecting a project → Profile tab shows that project's profile
// (We invoke the same flow projectTree.onSelectProject → profile.setProject.)
// ──────────────────────────────────────────────────────────────────────────
async function c2() {
  const host = new FakeNode('div');
  const panel = profilePanel.create(host, { onOpenFile: () => {} });
  // setProject re-loads with the new project. The fake IPC routes straight
  // to profileReader.read — using the real kitli-kids fixture on disk.
  panel.setProject({
    name: 'kitli-kids',
    path: '/Users/christophercampbell/Desktop/lemonade-stand/kitli-kids/develop',
  });
  // Allow the queued microtask resolution chain to flush.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const html = host.innerHTML;
  const last = panel.__getLastLoaded();
  const ipcCorrect = ipcInvokedWith
    && ipcInvokedWith.channel === 'supervisor:read-profile'
    && ipcInvokedWith.payload.project_path === '/Users/christophercampbell/Desktop/lemonade-stand/kitli-kids/develop';
  const ok = last
    && last.ok === true
    && last.source_type === 'frame-json'
    && /Profile: <strong>Kitli Kids<\/strong>/.test(html)
    && /Workdir/.test(html)
    && /Escalate cats/.test(html)
    && /dependency/.test(html); // an actual policy value
  record(
    'C2: Project selection → Profile panel rerenders with that project',
    ipcCorrect && ok,
    `ipc-ok=${!!ipcCorrect} source=${last && last.source_type} html-has-title=${/Kitli Kids/.test(html)} html-has-policy=${/dependency/.test(html)}`
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Criterion 3 — Falls back to supervisor YAML when .frame/profile.json absent
// (Build an isolated temp project with NO .frame/profile.json + a
//  supervisorRoot/profiles/<id>.yaml. Verify the reader picks the YAML.)
// ──────────────────────────────────────────────────────────────────────────
function c3() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-i-c3-'));
  const project = path.join(tmp, 'no-frame-project');
  fs.mkdirSync(project, { recursive: true });
  const supRoot = path.join(tmp, 'sup');
  fs.mkdirSync(path.join(supRoot, 'profiles'), { recursive: true });
  const yamlPath = path.join(supRoot, 'profiles', 'isolated.yaml');
  fs.writeFileSync(yamlPath, [
    'id: isolated',
    'worker:',
    '  provider: claude_code',
    '  permission:',
    '    allowed_tools: [Read, Bash]',
    'policy:',
    '  escalate_categories: [dependency, secrets]',
    '  rules:',
    '    - { category: naming, route: auto_answer }',
    'budgets:',
    '  iteration_cap: 2',
    '  spend_ceiling_task_usd: 5',
  ].join('\n'));

  const r = profileReader.read({
    project_id: 'isolated',
    project_path: project,    // exists but has no .frame/profile.json
    supervisorRoot: supRoot,
  });
  const ok = r.ok === true
    && r.source_type === 'supervisor-yaml'
    && r.source_path === yamlPath
    && r.profile && r.profile.id === 'isolated'
    && Array.isArray(r.profile.policy && r.profile.policy.escalate_categories)
    && r.profile.policy.escalate_categories.includes('dependency');
  record(
    'C3: YAML fallback when .frame/profile.json missing',
    ok,
    `source_type=${r.source_type} path=${r.source_path} parsed_id=${r.profile && r.profile.id}`
  );

  // Cleanup
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ──────────────────────────────────────────────────────────────────────────
// Criterion 4 — "Open YAML in Frame ↗" opens the source file (via onOpenFile)
// (Simulate the rendered button's click, assert onOpenFile got the absolute
//  source_path the reader returned.)
// ──────────────────────────────────────────────────────────────────────────
async function c4() {
  const host = new FakeNode('div');
  let openCalledWith = null;
  const panel = profilePanel.create(host, {
    onOpenFile: (abs) => { openCalledWith = abs; },
  });
  panel.setProject({
    name: 'kitli-kids',
    path: '/Users/christophercampbell/Desktop/lemonade-stand/kitli-kids/develop',
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  // After render, profilePanel grabs the #sup-profile-open button via
  // querySelector. Our FakeNode resolves it from the parsed innerHTML id map.
  const btn = host.querySelector('#sup-profile-open');
  let buttonExists = !!btn;
  let clickedOk = false;
  let expectedPath = '/Users/christophercampbell/Desktop/lemonade-stand/kitli-kids/develop/.frame/profile.json';
  if (btn) {
    btn.click();
    clickedOk = openCalledWith === expectedPath;
  }
  record(
    'C4: "Open … in Frame ↗" button wires through onOpenFile',
    buttonExists && clickedOk,
    `btn-rendered=${buttonExists} called-with=${openCalledWith || '(none)'} expected=${expectedPath}`
  );
}

// ──────────────────────────────────────────────────────────────────────────
(async () => {
  await c2();
  c3();
  await c4();
  const fails = results.filter((r) => !r.ok).length;
  console.log('');
  console.log(`=== PHASE I PROFILE PANEL (READ-ONLY V1) ===`);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} — ${r.name}`);
  console.log('');
  console.log(`HEAD: ${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}`);
  console.log(`Result: ${fails === 0 ? 'ALL CRITERIA PASS' : `${fails} FAILURE(S)`}`);
  process.exit(fails === 0 ? 0 : 1);
})();
