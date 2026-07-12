/**
 * detect-project tests (T01): manifest-driven stack detection must produce
 * correct languages/packageManager/sourceRoots/commands per project shape,
 * degrade honestly on unknown stacks, and infer exactly today's behavior
 * (src + javascript + npm) on Frame's own repo.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectProject, writeProjectConfig } = require('../scripts/detect-project');

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-detect-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** Write files into tmpRoot: { 'relative/path': 'content' } */
function scaffold(files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

test('JS app with src/ and npm lockfile', () => {
  scaffold({
    'package.json': JSON.stringify({
      name: 'app',
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' }
    }),
    'package-lock.json': '{}',
    'src/index.js': ''
  });
  const p = detectProject(tmpRoot);
  assert.deepEqual(p.languages, ['javascript']);
  assert.equal(p.packageManager, 'npm');
  assert.deepEqual(p.sourceRoots, ['src']);
  assert.equal(p.layout, 'single');
  assert.equal(p.commands.dev, 'npm run dev');
  assert.equal(p.commands.build, 'npm run build');
  assert.equal(p.commands.test, 'npm test');
  assert.equal(p.commands.install, 'npm install');
  assert.equal(p.confidence, 'high');
});

test('tsconfig.json marks the project as TypeScript', () => {
  scaffold({
    'package.json': JSON.stringify({ name: 'app' }),
    'tsconfig.json': '{}',
    'src/index.ts': ''
  });
  const p = detectProject(tmpRoot);
  assert.deepEqual(p.languages, ['typescript']);
  assert.ok(p.markers.includes('tsconfig.json'));
});

test('npm placeholder test script is not a test command', () => {
  scaffold({
    'package.json': JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' }
    })
  });
  const p = detectProject(tmpRoot);
  assert.equal(p.commands.test, null);
});

test('pnpm monorepo via pnpm-workspace.yaml', () => {
  scaffold({
    'package.json': JSON.stringify({ name: 'mono' }),
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'packages/ui/src/index.js': '',
    'packages/core/index.js': ''
  });
  const p = detectProject(tmpRoot);
  assert.equal(p.packageManager, 'pnpm');
  assert.equal(p.layout, 'monorepo');
  assert.ok(p.sourceRoots.includes(path.join('packages', 'ui', 'src')));
  assert.ok(p.sourceRoots.includes(path.join('packages', 'core')));
});

test('yarn workspaces via package.json workspaces field', () => {
  scaffold({
    'package.json': JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }),
    'yarn.lock': '',
    'apps/web/src/index.js': ''
  });
  const p = detectProject(tmpRoot);
  assert.equal(p.packageManager, 'yarn');
  assert.equal(p.layout, 'monorepo');
  assert.deepEqual(p.sourceRoots, [path.join('apps', 'web', 'src')]);
});

test('Django app with poetry', () => {
  scaffold({
    'pyproject.toml': '[tool.poetry]\nname = "site"\n[tool.poetry.dependencies]\npytest = "^8"\n',
    'manage.py': '',
    'mysite/__init__.py': '',
    'mysite/settings.py': ''
  });
  const p = detectProject(tmpRoot);
  assert.deepEqual(p.languages, ['python']);
  assert.equal(p.packageManager, 'poetry');
  assert.ok(p.sourceRoots.includes('mysite'));
  assert.equal(p.commands.install, 'poetry install');
  assert.equal(p.commands.dev, 'python manage.py runserver');
  assert.equal(p.commands.test, 'poetry run pytest');
});

test('plain pip project with requirements.txt and src layout', () => {
  scaffold({
    'requirements.txt': 'flask\n',
    'src/tool/__init__.py': ''
  });
  const p = detectProject(tmpRoot);
  assert.equal(p.packageManager, 'pip');
  assert.equal(p.commands.install, 'pip install -r requirements.txt');
  assert.ok(p.sourceRoots.includes('src'));
});

test('Go module with cmd/ and internal/', () => {
  scaffold({
    'go.mod': 'module example.com/svc\n\ngo 1.22\n',
    'cmd/svc/main.go': '',
    'internal/db/db.go': ''
  });
  const p = detectProject(tmpRoot);
  assert.deepEqual(p.languages, ['go']);
  assert.deepEqual(p.sourceRoots, ['cmd', 'internal']);
  assert.equal(p.commands.test, 'go test ./...');
  assert.equal(p.commands.build, 'go build ./...');
});

test('Rust workspace expands member crates', () => {
  scaffold({
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n',
    'crates/parser/src/lib.rs': '',
    'crates/cli/src/main.rs': ''
  });
  const p = detectProject(tmpRoot);
  assert.deepEqual(p.languages, ['rust']);
  assert.equal(p.packageManager, 'cargo');
  assert.equal(p.layout, 'monorepo');
  assert.ok(p.sourceRoots.includes(path.join('crates', 'parser', 'src')));
  assert.ok(p.sourceRoots.includes(path.join('crates', 'cli', 'src')));
  assert.equal(p.commands.test, 'cargo test');
});

test('docs repo: mostly Markdown, no manifest', () => {
  scaffold({
    'README.md': '# Hi',
    'docs/guide.md': '',
    'docs/api.md': ''
  });
  const p = detectProject(tmpRoot);
  assert.deepEqual(p.languages, ['markdown']);
  assert.equal(p.layout, 'docs');
  assert.deepEqual(p.sourceRoots, ['docs']);
  assert.equal(p.confidence, 'low');
});

test('unknown stack degrades honestly', () => {
  scaffold({ 'data.bin': 'xx' });
  const p = detectProject(tmpRoot);
  assert.deepEqual(p.languages, []);
  assert.deepEqual(p.sourceRoots, ['.']);
  assert.equal(p.layout, 'unknown');
  assert.equal(p.confidence, 'none');
  assert.equal(p.commands.test, null);
});

test("Frame's own repo infers exactly today's behavior", () => {
  const p = detectProject(path.join(__dirname, '..'));
  assert.deepEqual(p.languages, ['javascript']);
  assert.equal(p.packageManager, 'npm');
  assert.ok(p.sourceRoots.includes('src'));
  assert.equal(p.layout, 'single');
  assert.equal(p.commands.test, 'npm test');
  assert.equal(p.confidence, 'high');
});

test('writeProjectConfig merges into .frame/config.json preserving keys', () => {
  scaffold({
    '.frame/config.json': JSON.stringify({ version: '1.0', name: 'app', settings: { x: 1 } }),
    'package.json': JSON.stringify({ name: 'app' })
  });
  const project = detectProject(tmpRoot);
  writeProjectConfig(tmpRoot, project);
  const config = JSON.parse(fs.readFileSync(path.join(tmpRoot, '.frame', 'config.json'), 'utf-8'));
  assert.equal(config.version, '1.0');
  assert.deepEqual(config.settings, { x: 1 });
  assert.deepEqual(config.project.languages, ['javascript']);
});

test('writeProjectConfig preserves repo-local project keys (ipcChannelsFile)', () => {
  scaffold({
    '.frame/config.json': JSON.stringify({ project: { ipcChannelsFile: 'src/ipc.js' } }),
    'package.json': JSON.stringify({ name: 'app' })
  });
  writeProjectConfig(tmpRoot, detectProject(tmpRoot));
  const config = JSON.parse(fs.readFileSync(path.join(tmpRoot, '.frame', 'config.json'), 'utf-8'));
  assert.equal(config.project.ipcChannelsFile, 'src/ipc.js');
  assert.deepEqual(config.project.languages, ['javascript']);
});

test('writeProjectConfig throws without a .frame directory', () => {
  scaffold({ 'package.json': '{}' });
  assert.throws(() => writeProjectConfig(tmpRoot, detectProject(tmpRoot)), /\.frame directory not found/);
});
