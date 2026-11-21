/**
 * cloudConnectionCopy — the words Frame says about a device's Frame Cloud
 * connection (frame-cloud-teammate-connection).
 *
 * Connected is this device's: each member connects on each of their devices,
 * once. A project's identity — the `projectId` its folder commits — is never
 * a state on screen; it only lets Frame recognise a clone, which then reads
 * Ready to connect. A project no folder has claimed reads Not claimed, with a
 * line saying what claiming is.
 *
 * Every sentence the Cloud projects tab, On this device and Project Settings
 * say about connecting lives here. Pure: no DOM, no Electron, so `node --test`
 * covers it.
 */

const { ROLE_FORBIDDEN } = require('./cloudRoles');

/** The Cloud projects tab's chip for each project row `state` (cloudProjects.matchFolders). */
const STATUS_CHIPS = Object.freeze({
  connected: Object.freeze({ label: 'Connected', className: 'cloud-chip-connected' }),
  ready: Object.freeze({ label: 'Ready to connect', className: 'cloud-chip-ready' }),
  notConnected: Object.freeze({ label: 'Not connected', className: '' }),
  notClaimed: Object.freeze({ label: 'Not claimed', className: '' }),
});

/** A row state → its chip; an unknown state reads Not connected. */
function statusChip(state) {
  return Object.prototype.hasOwnProperty.call(STATUS_CHIPS, state) ? STATUS_CHIPS[state] : STATUS_CHIPS.notConnected;
}

/** Under a Not claimed chip: what claiming is. */
const CLAIM_LINE =
  "Claiming picks the folder that is this project. After that, every member's clone of its " +
  'repository is recognised and connects with one click.';

/** Button labels that name a connection. */
const ACTIONS = Object.freeze({
  connect: 'Connect',
  connectFolder: 'Connect a folder…',
  disconnect: 'Disconnect…',
  confirmDisconnect: 'Disconnect',
  keep: 'Keep',
});

const NOT_HERE_NOTES = Object.freeze({
  // Claimed, nothing here carries it: a clone of the repository is recognised.
  notConnected:
    'No folder for this project is on this computer. Add a clone of its repository with ' +
    '"Add a project…" in the project switcher, then click Connect.',
  // This device is connected, but the folder moved or went.
  connected:
    'This device is connected, but no folder for this project is on this computer. Add a clone ' +
    'of its repository with "Add a project…" and it opens connected — or disconnect this device.',
  // Nobody has claimed it: its folder has to be chosen.
  notClaimed:
    'No folder on this computer looks like this project. Open or clone its folder with ' +
    '"Add a project…", then choose it with Connect a folder….',
});

/** The info mark beside "Not on this device", for a row in `state`. */
function notHereNote(state) {
  return Object.prototype.hasOwnProperty.call(NOT_HERE_NOTES, state) ? NOT_HERE_NOTES[state] : NOT_HERE_NOTES.notConnected;
}

function projectLabel(project) {
  return (project && (project.name || project.slug)) || 'this project';
}

/**
 * What a connection is, under a connected folder in On this device and in
 * Project Settings. The same words on every machine, because they are true on
 * every machine.
 */
const CONNECTED_EXPLANATION =
  'Connected on this device. Each member connects on each of their own devices. ' +
  'Briefs and their progress go through Frame Cloud; code, specs and tasks move with git.';

/** A Ready folder's detail: it is the project's clone, and connecting changes no one else's. */
function readyLead(project) {
  return `This folder is ${projectLabel(project)}'s repository. Connect this device to see its briefs here; ` +
    "nobody else's connection changes.";
}

/**
 * Connecting a folder whose identity differs from the project's replaces the
 * identity (a take-over): every device's connection to the project goes.
 */
const TAKEOVER_QUESTION =
  'This project belongs to a Frame folder with a different identity — that happens with local sharing ' +
  'mode, or when .frame/ was recreated. Connect this folder instead? Every device connected to the ' +
  "project, teammates' included, will be disconnected.";

/** A candidate project another folder identity has claimed: choosing it is a take-over. */
const CLAIMED_ELSEWHERE = Object.freeze({
  chip: 'Claimed',
  note: 'Another folder identity has claimed it. Connecting this one takes it over and disconnects every device of the project.',
});

/**
 * Before this device's connection goes. Says what changes (Briefs leave this
 * device) and what does not (teammates, the user's other devices, the folder).
 */
function disconnectQuestion(project, { folderHere = true } = {}) {
  const keeps = folderHere
    ? 'Your teammates and your other devices stay connected, and the folder stays as it is.'
    : 'Your teammates and your other devices stay connected.';
  return `Disconnect this device from ${projectLabel(project)}? Briefs stop showing here. ${keeps}`;
}

function workspaceLabel(workspace) {
  return (workspace && (workspace.name || workspace.slug)) || 'Frame Cloud';
}

/**
 * Project Settings' Frame Cloud row for the open folder → `{ label, description }`.
 *   connected         — this device is connected: the workspace and what a connection is
 *   confirmDisconnect — the Disconnect question in place of the description
 *   ready             — a clone of a claimed project, one Connect away
 *   notConnected      — nothing carries this folder's identity yet
 */
function settingsRow(state, project, workspace) {
  const name = projectLabel(project);
  switch (state) {
    case 'connected':
      return { label: `Connected to ${name}`, description: `In ${workspaceLabel(workspace)}. ${CONNECTED_EXPLANATION}` };
    case 'confirmDisconnect':
      return { label: `Connected to ${name}`, description: disconnectQuestion(project) };
    case 'ready':
      return { label: STATUS_CHIPS.ready.label, description: `In ${workspaceLabel(workspace)}. ${readyLead(project)}` };
    default:
      return {
        label: STATUS_CHIPS.notConnected.label,
        description: 'Connect this project to a Frame Cloud project, or create one for it.',
      };
  }
}

const REFUSALS = Object.freeze({
  unlinked: 'This project is no longer claimed — the list was refreshed.',
  identityChanged: 'This project now belongs to another folder — the list was refreshed.',
  notFound: 'That project no longer exists — the list was refreshed.',
  network: "Frame Cloud couldn't be reached.",
  noWorkspace: 'Create a workspace on the web first.',
  roleForbidden: ROLE_FORBIDDEN,
});

/** A refused Connect → the line under it. `unauthorized` says nothing: the window is back on sign-in. */
function connectRefusal(reason) {
  if (reason === 'unauthorized') return null;
  return REFUSALS[reason] || "Couldn't connect this device. Try again.";
}

/** A refused Disconnect → the line under it. */
function disconnectRefusal(reason) {
  if (reason === 'unauthorized') return null;
  return REFUSALS[reason] || "Couldn't disconnect this device. Try again.";
}

module.exports = {
  STATUS_CHIPS,
  statusChip,
  CLAIM_LINE,
  ACTIONS,
  notHereNote,
  CONNECTED_EXPLANATION,
  readyLead,
  TAKEOVER_QUESTION,
  CLAIMED_ELSEWHERE,
  disconnectQuestion,
  settingsRow,
  connectRefusal,
  disconnectRefusal,
};
