/**
 * cloudEntry — what the app header's Frame Cloud entry shows for a session
 * (frame-cloud-header-entry spec).
 *
 * The entry sits right of the Frame mark and follows the session the
 * renderer already receives: nothing without a server address, the waitlist
 * call while the server is invite-only and this machine has neither joined nor
 * ever signed in, a Sign in tag on a machine that has, the workspace once
 * signed in with one. This module is the rule only;
 * `appHeader.bindCloudEntry` paints it.
 *
 * Words stay with their owners: early access in `cloudEarlyAccess`, "No
 * workspace" in `cloudNoWorkspace`, the role in `cloudRoles`. The role is in
 * the tooltip only, never on the entry.
 * Pure: no DOM, no Electron, so `node --test` covers it.
 */

const early = require('./cloudEarlyAccess');
const noWorkspace = require('./cloudNoWorkspace');
const cloudRoles = require('./cloudRoles');

const NAME = 'Frame Cloud';
const SEP = ' · ';

/** The name's first character, upper-cased, read by code point ("élan" → "É"). */
function initialOf(name) {
  const first = Array.from(String(name || '').trim())[0];
  return first ? first.toUpperCase() : '';
}

function cloud(label, tag, tooltipParts, call) {
  return {
    kind: 'cloud',
    label,
    tag,
    initial: '',
    tooltip: [NAME, ...tooltipParts].join(SEP),
    call,
  };
}

/**
 * The header entry for a session → `null` when there is no server address
 * (`unavailable`, or no session at all), otherwise
 * `{ kind: 'cloud' | 'workspace', label, tag, initial, tooltip, call }`.
 *
 * Every state but `signedIn` reads as signed out: `inviteOnly`,
 * `waitlistEmail` and `signedInBefore` reach the renderer through the sign-in
 * steps too. A machine that has signed in before is past the waitlist: it
 * reads "Frame Cloud" with a Sign in tag, whatever the server says of invites.
 */
function entryFor(session) {
  const s = session || {};
  if (!s.state || s.state === 'unavailable') return null;

  if (s.state !== 'signedIn') {
    if (s.signedInBefore === true) return cloud(NAME, early.COPY.entrySignIn, [early.COPY.entrySignIn], false);
    if (s.inviteOnly !== true) return cloud(NAME, null, [], false);
    if (!s.waitlistEmail) {
      return cloud(early.COPY.entryCall, early.COPY.entryEarly, [early.COPY.entryEarly, early.COPY.join], true);
    }
    return cloud(NAME, early.COPY.entryJoined, [early.COPY.entryEarly, early.COPY.joinedTitle], false);
  }

  const workspace = s.workspace;
  if (!workspace || !workspace.slug) {
    const none = noWorkspace.workspaceRow(null).value;
    return cloud(NAME, none, [none], false);
  }

  // The name is the Workspace row's own value; the tooltip's "Acme · Admin"
  // is the account header's line, the name alone without a known role.
  const name = noWorkspace.workspaceRow(workspace).value;
  return {
    kind: 'workspace',
    label: name,
    tag: null,
    initial: initialOf(name),
    tooltip: [NAME, cloudRoles.workspaceLine(workspace) || name].join(SEP),
    call: false,
  };
}

module.exports = { NAME, entryFor };
