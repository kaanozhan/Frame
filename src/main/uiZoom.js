/**
 * UI zoom — the main-process owner of the interface scale (ui-zoom-steps spec).
 *
 * Frame's five-step zoom is Chromium page zoom under Frame's control. This
 * module is the only place the factor is applied: it seeds the window
 * (`webPreferences.zoomFactor` via currentFactor()), re-applies on every load
 * so a per-origin level Chromium kept from the old native zoom roles never
 * wins, snaps pinch / Ctrl+wheel (`zoom-changed`) onto the ladder, persists
 * the step in user-settings.json and tells the renderer what happened.
 *
 * The renderer never calls webFrame; it asks for a step over UI_ZOOM_SET and
 * reacts to UI_ZOOM_CHANGED (terminals refit, status bar readout, Settings
 * select). Every entry point — menu, shortcut, palette, Settings, status bar,
 * trackpad — ends in setStep() here, so they cannot drift apart.
 *
 * The numbers live in src/shared/uiZoom.js, shared with the renderer.
 */

const { ipcMain } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const ladder = require('../shared/uiZoom');
const userSettings = require('./userSettings');

/** user-settings.json key. An integer −2…+2; absent means the default. */
const SETTING_KEY = 'uiZoomStep';

let mainWindow = null;
let step = ladder.DEFAULT_STEP;

/** Load the stored step. Runs after userSettings.init(), before createWindow(). */
function init() {
  step = ladder.parseStep(userSettings.get(SETTING_KEY));
}

function currentStep() {
  return step;
}

/** What createWindow passes as webPreferences.zoomFactor — the first paint is already at the step. */
function currentFactor() {
  return ladder.factorFor(step);
}

function state() {
  return { step, factor: ladder.factorFor(step) };
}

function applyToWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.setZoomFactor(ladder.factorFor(step));
}

/**
 * Apply, persist and broadcast a step. A step that does not change is a
 * no-op — no write, no broadcast — which is what makes ⌘= at +2 harmless.
 */
function setStep(next) {
  const clamped = ladder.clampStep(next);
  if (clamped === step) return state();
  step = clamped;
  applyToWindow();
  userSettings.set(SETTING_KEY, step);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.UI_ZOOM_CHANGED, state());
  }
  return state();
}

/**
 * Wire the window: the load-time re-apply, the trackpad / wheel snap, and
 * the renderer's two channels.
 */
function attachWindow(window) {
  mainWindow = window;

  // webPreferences.zoomFactor seeds the first paint, but Chromium persists
  // zoom per origin and a level left behind by the stock View-menu roles can
  // win over it. Re-applying once the page has loaded makes Frame's stored
  // step authoritative; the boot splash is still up, so nothing is seen.
  window.webContents.on('did-finish-load', applyToWindow);

  // Pinch and Ctrl+wheel arrive here with a direction. Treat the gesture as
  // one ladder step and re-apply the ladder factor, so Chromium's own
  // free-form value never stays on screen.
  window.webContents.on('zoom-changed', (event, direction) => {
    if (direction === 'in') setStep(step + 1);
    else if (direction === 'out') setStep(step - 1);
    // Same step at the end of the ladder: Chromium may already have moved
    // the factor, so put the ladder value back.
    applyToWindow();
  });

  // attachWindow runs again when macOS re-creates the window from the Dock
  // (app 'activate'). A second ipcMain.handle for the same channel throws,
  // which aborted createWindow half-way and left the new window without its
  // PTY, menu and module wiring — so replace the handler instead.
  ipcMain.removeHandler(IPC.UI_ZOOM_GET);
  ipcMain.handle(IPC.UI_ZOOM_GET, () => state());
  ipcMain.removeHandler(IPC.UI_ZOOM_SET);
  ipcMain.handle(IPC.UI_ZOOM_SET, (event, next) => setStep(next));
}

module.exports = { init, attachWindow, currentStep, currentFactor, setStep, SETTING_KEY };
