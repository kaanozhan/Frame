/**
 * Which Claude sessions Home offers to resume, and how they are labelled.
 *
 * Pure by contract, same rule as `agentRows`: no `electron`, no `lucide`, no
 * `laneStatus` (C8). That includes the relative time — `laneStatus`'s
 * formatter takes epoch millis and the panel's takes a date string, and
 * neither is reachable from here, so this module carries its own, taking
 * `now` so a test can pin it.
 *
 * The card is a teaser: three rows, the most recent first. The full list is
 * the sessions panel's job, and always was.
 */

/** Three is the card's whole budget — the user asked for the last three. */
const MAX_SESSIONS = 3;

/**
 * The panel's fallback chain, moved verbatim so Home and the panel never
 * call the same session two different things: an AI-written summary if there
 * is one, else the first prompt, else an honest placeholder.
 */
function sessionTitle(session) {
  return session.summary || session.firstPrompt || 'Untitled session';
}

/**
 * Relative time, in the panel's own words. Kept here rather than imported
 * because importing it would mean requiring a renderer module (C8).
 *
 * @param {string} dateString - ISO timestamp
 * @param {number} [now]      - epoch millis; injectable so a test can pin it
 */
function relativeTime(dateString, now = Date.now()) {
  if (!dateString) return '';

  const then = new Date(dateString).getTime();
  if (Number.isNaN(then)) return '';

  const sec = Math.floor((now - then) / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);

  if (sec < 60) return 'just now';
  if (min < 60) return `${min} minute${min !== 1 ? 's' : ''} ago`;
  if (hour < 24) return `${hour} hour${hour !== 1 ? 's' : ''} ago`;
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  if (day < 30) {
    const weeks = Math.floor(day / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  }
  return new Date(dateString).toLocaleDateString();
}

/**
 * @param {Array<Object>} sessions - as claudeSessionsManager returns them
 * @param {number} [now]           - epoch millis, for the relative times
 * @returns {Array<{id, title, at, relative, messageCount, branch}>}
 */
function sessionRows(sessions, now = Date.now()) {
  return (sessions || [])
    .filter(s => s && s.sessionId)
    .slice()
    // `modified` is the last record's timestamp, which is the true end of the
    // conversation; `created` is the fallback for a transcript carrying none.
    .sort((a, b) => _at(b) - _at(a))
    .slice(0, MAX_SESSIONS)
    .map(s => ({
      id: s.sessionId,
      title: sessionTitle(s),
      at: s.modified || s.created || null,
      relative: relativeTime(s.modified || s.created, now),
      messageCount: s.messageCount || 0,
      branch: s.gitBranch || null
    }));
}

function _at(s) {
  return new Date(s.modified || s.created || 0).getTime() || 0;
}

module.exports = { sessionRows, sessionTitle, relativeTime, MAX_SESSIONS };
