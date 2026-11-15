/**
 * externalLink — which URLs Frame may hand to the system browser.
 *
 * Links clicked in a terminal (OSC 8 hyperlinks that agents print) and any
 * window.open() from the renderer must never open inside an Electron window:
 * the renderer runs with nodeIntegration, so a child window would load a
 * remote site with Node access — and it crashed the renderer. Instead they go
 * to shell.openExternal, and only for plain web links.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** True when `url` is a well-formed http(s) URL safe to open externally. */
function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

module.exports = { isSafeExternalUrl };
