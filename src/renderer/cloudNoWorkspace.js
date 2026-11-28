/**
 * cloudNoWorkspace — the words Frame Cloud says to a signed-in user who has
 * no workspace yet.
 *
 * Signing in is free and a workspace is a choice made on the web, so the
 * Frame Cloud window shows the way on instead of an error: the Workspace row
 * of the account header, the panel that takes the tabs' place, and the Frame
 * Cloud row of Project Settings. No trial, plan or price is named here.
 * Pure: no DOM, no Electron, so `node --test` covers it.
 */

/** Title of the disabled "Create a workspace" button when no web origin is stored. */
const NO_WEB_ORIGIN = 'Sign in again to open Frame Cloud on the web';

/**
 * The account header's Workspace row → `{ value, link }`: the workspace and
 * "Open in browser" with one, "No workspace" and "Create a workspace" without.
 */
function workspaceRow(workspace) {
  if (!workspace || !workspace.slug) return { value: 'No workspace', link: 'Create a workspace' };
  return { value: workspace.name || workspace.slug || '—', link: 'Open in browser' };
}

/** The body line, counting this device's Frame projects. */
function panelBody(folderCount) {
  const n = Math.max(0, Math.floor(Number(folderCount) || 0));
  if (n === 0) {
    return 'This device has no Frame projects yet. With a workspace you can add your projects to Frame Cloud and see their briefs from the web.';
  }
  if (n === 1) {
    return 'This device has 1 Frame project. With a workspace you can add it to Frame Cloud and see its briefs from the web.';
  }
  return `This device has ${n} Frame projects. With a workspace you can add them to Frame Cloud and see their briefs from the web.`;
}

/** The panel in place of the tabs → `{ title, body, button, local }`. */
function panel(folderCount) {
  return {
    title: 'A workspace for your own projects',
    body: panelBody(folderCount),
    button: 'Create a workspace',
    local: 'Frame on this machine needs no account. Everything here works as it does without Frame Cloud.',
  };
}

/** Project Settings' Frame Cloud row without a workspace → `{ label, description, action }`. */
function settingsRow() {
  return {
    label: 'No workspace',
    description: 'Create a workspace on the web to connect this project to Frame Cloud.',
    action: 'Open Frame Cloud',
  };
}

module.exports = {
  NO_WEB_ORIGIN,
  workspaceRow,
  panel,
  settingsRow,
};
