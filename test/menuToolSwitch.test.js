/**
 * The app menu follows the active AI tool however it is switched (#34).
 *
 * The tool menu (labelled with the tool's name) is built from the active
 * tool. Before #34 only the menu's own switcher rebuilt it; a switch from the
 * renderer's selector (SET_AI_TOOL over IPC) left the previous tool's commands
 * in place. Electron and the analytics packages are stubbed (the
 * frameProjectOpen pattern); Menu records each template it is handed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-menu-tool-'));
// A saved choice, so init doesn't start first-run CLI detection.
fs.writeFileSync(path.join(userData, 'ai-tool-config.json'), JSON.stringify({ activeTool: 'claude', customTools: {} }));

const handlers = new Map();
const applied = [];
const Module = require('node:module');
const EXTERNAL_STUBS = {
  '@aptabase/electron/main': { initialize() {}, trackEvent() {} },
  'posthog-node': { PostHog: class { capture() {} captureException() {} identify() {} shutdown() { return Promise.resolve(); } } },
  electron: {
    app: { getPath: () => userData, getVersion: () => '0.0.0-test' },
    ipcMain: {
      handle(channel, fn) { handlers.set(channel, fn); },
      removeHandler(channel) { handlers.delete(channel); },
      on() {},
      removeAllListeners() {}
    },
    Menu: {
      buildFromTemplate: (template) => ({ template }),
      setApplicationMenu: (menu) => applied.push(menu.template)
    },
    shell: { openExternal() {} }
  }
};
const loadOriginal = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(EXTERNAL_STUBS, request)) {
    return EXTERNAL_STUBS[request];
  }
  return loadOriginal.call(this, request, ...rest);
};

const aiToolManager = require('../src/main/aiToolManager');
const menu = require('../src/main/menu');
const { IPC } = require('../src/shared/ipcChannels');

const sent = [];
const window = { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
aiToolManager.init(window, EXTERNAL_STUBS.electron.app);
menu.init(window, EXTERNAL_STUBS.electron.app, aiToolManager);
// init twice, as a recreated window would: still one rebuild per switch.
menu.init(window, EXTERNAL_STUBS.electron.app, aiToolManager);
menu.createMenu();

const toolNames = Object.values(aiToolManager.AI_TOOLS).map((t) => t.name);
const lastToolMenu = () => applied[applied.length - 1].find((root) => toolNames.includes(root.label));

test('a switch from the renderer selector rebuilds the menu with the new tool (#34)', async () => {
  assert.equal(lastToolMenu().label, 'Claude Code');
  const before = applied.length;

  const ok = await handlers.get(IPC.SET_AI_TOOL)({}, 'codex');

  assert.equal(ok, true);
  assert.equal(applied.length, before + 1, 'exactly one rebuild, even after a second init');
  const toolMenu = lastToolMenu();
  assert.equal(toolMenu.label, 'Codex CLI');
  const labels = toolMenu.submenu.map((item) => item.label).filter(Boolean);
  assert.ok(labels.some((l) => l.includes('/review')), `Codex commands listed: ${labels.join(', ')}`);
  assert.ok(!labels.some((l) => l.includes('/review-pr')), 'no Claude command left behind');
  assert.deepEqual(sent.at(-1), { channel: IPC.AI_TOOL_CHANGED, payload: aiToolManager.getActiveTool() }, 'the renderer is still told');
});

test("the menu's own switcher still rebuilds once", () => {
  const before = applied.length;
  const switcher = lastToolMenu().submenu.find((item) => item.label === 'Switch AI Tool');
  switcher.submenu.find((item) => item.label === 'Claude Code').click();
  assert.equal(applied.length, before + 1);
  assert.equal(lastToolMenu().label, 'Claude Code');
});

test('an unknown tool changes nothing and rebuilds nothing', async () => {
  const before = applied.length;
  assert.equal(await handlers.get(IPC.SET_AI_TOOL)({}, 'no-such-tool'), false);
  assert.equal(applied.length, before);
});
