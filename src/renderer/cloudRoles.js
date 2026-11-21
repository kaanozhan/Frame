/**
 * cloudRoles — the words Frame says about a Frame Cloud workspace role.
 *
 * A workspace member is an admin, a developer or a viewer (FrameCloud
 * workspace-invites-and-roles). Frame offers only what the role can do; this
 * module holds every sentence that explains why something is not offered:
 * the role beside the workspace, the card a viewer gets in place of the
 * Frame Cloud tabs, a viewer's Project Settings row, the line a developer
 * reads where Create would be, and the one sentence for a refusal.
 *
 * Wording follows the web: role names as on its members page, "Viewers can
 * read everything in the workspace", "An admin … adds projects".
 * Pure: no DOM, no Electron, so `node --test` covers it.
 */

const { NO_WEB_ORIGIN } = require('./cloudNoWorkspace');

const ROLE_LABELS = Object.freeze({
  admin: 'Admin',
  developer: 'Developer',
  viewer: 'Viewer',
});

/** A call the role cannot make, wherever it was refused (main or the server). */
const ROLE_FORBIDDEN = "Your role in this workspace doesn't allow that. An admin can change your role.";

/** Where a developer would see Create: adding a project is an admin's. */
const CREATE_ADMIN_ONLY = 'An admin adds projects to Frame Cloud.';

/** `admin` → "Admin"; a role Frame does not know has no label. */
function roleLabel(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_LABELS, role) ? ROLE_LABELS[role] : '';
}

function workspaceName(workspace) {
  return (workspace && (workspace.name || workspace.slug)) || '';
}

/** The account header's workspace → "Acme · Developer", or the name alone without a known role. */
function workspaceLine(workspace) {
  const name = workspaceName(workspace);
  if (!name) return '';
  const label = roleLabel(workspace.role);
  return label ? `${name} · ${label}` : name;
}

/**
 * The card in place of the Frame Cloud tabs for a viewer →
 * `{ title, body, button, buttonTitle, local }`. Without a stored web origin
 * the button cannot open anything: `buttonTitle` says why, otherwise null.
 */
function viewerPanel({ workspace, canOpenWeb } = {}) {
  const name = workspaceName(workspace);
  return {
    title: 'Viewers follow the work on the web',
    body: `${name ? `You are a viewer in ${name}. ` : ''}Viewers can read everything in the workspace, and Frame Cloud on the web is where they read it. An admin can change your role.`,
    button: 'Open on web',
    buttonTitle: canOpenWeb ? null : NO_WEB_ORIGIN,
    local: 'Everything else in Frame on this machine works as it always does.',
  };
}

/** Project Settings' Frame Cloud row for a viewer → `{ label, description, action }`. */
function viewerSettingsRow(workspace) {
  const name = workspaceName(workspace);
  return {
    label: name ? `Viewer in ${name}` : 'Viewer',
    description: 'Viewers follow Frame Cloud on the web. An admin can change your role.',
    action: 'Open Frame Cloud',
  };
}

module.exports = {
  ROLE_LABELS,
  ROLE_FORBIDDEN,
  CREATE_ADMIN_ONLY,
  roleLabel,
  workspaceLine,
  viewerPanel,
  viewerSettingsRow,
};
