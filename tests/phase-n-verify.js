#!/usr/bin/env node
// Phase N verification — exercises the four functional acceptance criteria
// for the profile-YAML-fallback + project-tree-dedup fixes. Self-contained:
// builds a temp supervisorRoot with a handful of YAMLs and a workspaces.json
// equivalent in-memory so we don't depend on the user's live config.
//
// Run: node tests/phase-n-verify.js

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag} — ${name}${detail ? '\n      ' + detail : ''}`);
}

const profileReader = require(path.join(REPO, 'src/main/supervisor-bridge/profileReader.js'));
const projectTree = require(path.join(REPO, 'src/renderer/supervisor-ui/projectTree.js'));
const profilePanel = require(path.join(REPO, 'src/renderer/supervisor-ui/profilePanel.js'));

// ──────────────────────────────────────────────────────────────────────────
// Build a temp supervisorRoot with realistic YAMLs.
// ──────────────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-n-'));
const supRoot = path.join(tmp, 'sup');
const profilesDir = path.join(supRoot, 'profiles');
fs.mkdirSync(profilesDir, { recursive: true });
const minimalYaml = (id) => [
  `id: ${id}`,
  'worker:',
  '  provider: claude_code',
  '  permission:',
  '    allowed_tools: [Read, Bash]',
  'policy:',
  '  escalate_categories: [dependency]',
  'budgets:',
  '  iteration_cap: 2',
].join('\n');
for (const id of ['kitli-kids', 'lemonadestand', 'mason', 'localized', 'supervisor-self']) {
  fs.writeFileSync(path.join(profilesDir, `${id}.yaml`), minimalYaml(id));
}

// ──────────────────────────────────────────────────────────────────────────
// C1 — Multi-variant lookup: "kitli kids" (space, raw display name) resolves
// to profiles/kitli-kids.yaml via the slug variant.
// ──────────────────────────────────────────────────────────────────────────
// The read() entry point still enforces SAFE_PROJECT_ID, so to exercise the
// pure variant matcher we call readSupervisorYaml() directly.
{
  const r = profileReader.readSupervisorYaml(supRoot, 'kitli kids');
  const ok = r && r.ok === true
    && r.source_type === 'supervisor-yaml'
    && /kitli-kids\.yaml$/.test(r.source_path)
    && r.profile && r.profile.id === 'kitli-kids';
  record('C1: readSupervisorYaml("kitli kids") → kitli-kids.yaml', ok,
    `source=${r && r.source_path} id=${r && r.profile && r.profile.id}`);
}

// C1b — Mixed-case input resolves to the lowercased YAML. On case-insensitive
// filesystems (macOS APFS default) fs.existsSync hits on the literal first
// variant; on Linux the lowercased variant is the one that matches. Either
// way the parsed profile id is the canonical (lowercased) one.
{
  const r = profileReader.readSupervisorYaml(supRoot, 'Localized');
  const ok = r && r.ok === true
    && /[Ll]ocalized\.yaml$/.test(r.source_path)
    && r.profile && r.profile.id === 'localized';
  record('C1b: readSupervisorYaml("Localized") → localized.yaml', ok,
    `source=${r && r.source_path} parsed_id=${r && r.profile && r.profile.id}`);
}

// C1c — A truly unknown project still returns null (no false positives).
{
  const r = profileReader.readSupervisorYaml(supRoot, 'nope-not-a-real-project');
  record('C1c: unknown project → null', r === null,
    `r=${r === null ? 'null' : JSON.stringify(r)}`);
}

// C1d — Boundary recovery: read() with a raw display name (space) used to
// fail validation; with the relaxed check it should reach variant lookup
// and resolve kitli-kids.yaml.
{
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-n-c1d-'));
  const r = profileReader.read({
    project_id: 'kitli kids',
    project_path: tmpProject,
    supervisorRoot: supRoot,
  });
  const ok = r.ok === true
    && r.source_type === 'supervisor-yaml'
    && /kitli-kids\.yaml$/.test(r.source_path);
  record('C1d: read() recovers from raw display name input', ok,
    `ok=${r.ok} source=${r.source_path} error=${r.error}`);
  fs.rmSync(tmpProject, { recursive: true, force: true });
}

// C1e — Path-traversal still rejected.
{
  const r = profileReader.read({
    project_id: '../escape',
    supervisorRoot: supRoot,
  });
  record('C1e: read() rejects path-traversal id', r.ok === false && /invalid/.test(r.error || ''),
    `ok=${r.ok} error=${r.error}`);
}

// ──────────────────────────────────────────────────────────────────────────
// C2 — projectTree.dedupBySlug collapses "kitli kids" + "kitli-kids" into one
// row with Frame's path + supervisor's id.
// ──────────────────────────────────────────────────────────────────────────
{
  const input = [
    { name: 'kitli kids', id: 'kitli-kids', path: '/tmp/kitli-kids/develop', isFrameProject: true, sources: ['frame-workspace'] },
    { name: 'kitli-kids', id: 'kitli-kids', path: '', isFrameProject: false, sources: ['supervisor-profile'] },
    { name: 'renovive', id: 'renovive', path: '/tmp/renovive/develop', isFrameProject: true, sources: ['frame-workspace'] },
    { name: 'renovive-qa', id: 'renovive-qa', path: '', isFrameProject: false, sources: ['supervisor-profile'] },
  ];
  const out = projectTree.dedupBySlug(input);
  const byId = Object.fromEntries(out.map((p) => [p.id, p]));
  const kitli = byId['kitli-kids'];
  const ok = out.length === 3
    && kitli
    && kitli.name === 'kitli kids'           // Frame label preferred
    && kitli.id === 'kitli-kids'             // supervisor id preserved
    && kitli.path === '/tmp/kitli-kids/develop'
    && kitli.isFrameProject === true
    && (kitli.sources || []).includes('frame-workspace')
    && (kitli.sources || []).includes('supervisor-profile')
    && byId['renovive'] && byId['renovive-qa']; // separate slugs stay separate
  record('C2: dedupBySlug collapses display-name+slug duplicates', ok,
    `n=${out.length} kitli-name=${kitli && kitli.name} kitli-id=${kitli && kitli.id} kitli-path=${kitli && kitli.path}`);
}

// C2b — Idempotent: dedup on already-deduped input is a no-op.
{
  const once = projectTree.dedupBySlug([
    { name: 'mason', id: 'mason', path: '/tmp/mason', sources: ['frame-workspace', 'supervisor-profile'] },
  ]);
  const twice = projectTree.dedupBySlug(once);
  record('C2b: dedupBySlug idempotent', JSON.stringify(once) === JSON.stringify(twice),
    `once=${JSON.stringify(once)}`);
}

// ──────────────────────────────────────────────────────────────────────────
// C3 — profilePanel.slugifyProjectName produces the canonical YAML stem.
// ──────────────────────────────────────────────────────────────────────────
{
  const cases = [
    ['kitli kids', 'kitli-kids'],
    ['Kitli Kids', 'kitli-kids'],
    ['  spaced  out  ', 'spaced-out'],
    ['Localized Scraper', 'localized-scraper'],
    ['already-slug', 'already-slug'],
    ['', ''],
  ];
  const failures = cases.filter(([input, expected]) => profilePanel.slugifyProjectName(input) !== expected);
  record('C3: slugifyProjectName covers display-name shapes', failures.length === 0,
    failures.map(([i, e]) => `'${i}' → '${profilePanel.slugifyProjectName(i)}' (expected '${e}')`).join(' · ') || 'all cases pass');
}

// ──────────────────────────────────────────────────────────────────────────
// C4 — End-to-end: profileReader.read() with the slugified id resolves the
// supervisor YAML (and rejects garbage upstream).
// ──────────────────────────────────────────────────────────────────────────
{
  // Build an isolated project with NO .frame/profile.json so the YAML
  // fallback is the only path that succeeds.
  const project = path.join(tmp, 'no-frame-project');
  fs.mkdirSync(project, { recursive: true });
  // Slugified id should hit lemonadestand.yaml.
  const slug = profilePanel.slugifyProjectName('lemonadestand');
  const r = profileReader.read({
    project_id: slug,
    project_path: project,
    supervisorRoot: supRoot,
  });
  const ok = r.ok === true
    && r.source_type === 'supervisor-yaml'
    && /lemonadestand\.yaml$/.test(r.source_path)
    && r.profile && r.profile.id === 'lemonadestand';
  record('C4: profileReader.read(slug) → matching supervisor YAML', ok,
    `slug=${slug} source=${r.source_path} parsed_id=${r.profile && r.profile.id}`);
}

// ──────────────────────────────────────────────────────────────────────────
// Cleanup + summary
// ──────────────────────────────────────────────────────────────────────────
fs.rmSync(tmp, { recursive: true, force: true });

const fails = results.filter((r) => !r.ok).length;
console.log('');
console.log('=== PHASE N PROFILE FALLBACK + TREE DEDUP ===');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} — ${r.name}`);
console.log('');
console.log(`HEAD: ${require('child_process').execSync('git rev-parse --short HEAD').toString().trim()}`);
console.log(`Result: ${fails === 0 ? 'ALL CRITERIA PASS' : `${fails} FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
