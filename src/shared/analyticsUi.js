/**
 * Analytics UI — one switch that hides the analytics UI for now, to be
 * brought back later. Sending is not affected: src/main/analytics.js sends
 * exactly as before, following the stored setting.
 *
 * While true:
 *   - the first-run notice is never due (analytics.noticeState), so it does
 *     not show and the guided tour does not wait for it;
 *   - Settings hides "Send anonymous usage stats" and "Send error reports"
 *     (frameSettingsModal.js).
 * Stored settings are left alone — set this to false and the notice and the
 * switches come back with the user's choices as they were.
 */

const ANALYTICS_UI_HIDDEN = true;

module.exports = { ANALYTICS_UI_HIDDEN };
