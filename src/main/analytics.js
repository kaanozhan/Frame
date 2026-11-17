/**
 * Analytics
 *
 * Anonymous usage events, sent to both PostHog and Aptabase. Default opt-out: analytics runs
 * unless the user disables it from Settings, and fails closed when the
 * settings file is unreadable. Every event must be declared in the
 * registry in analyticsEvents.js — event names plus low-cardinality enum
 * props only. No file paths, no project names, no code, no free-form
 * strings, no personally identifying information. The full event list is
 * documented in PRIVACY.md; keep the two in sync.
 *
 * Events carry a stable install id (a random UUID, see resolveInstallId)
 * so the dashboard can count unique users, follow the activation funnel
 * and read retention cohorts. It identifies an install, never a person:
 * nothing here can be joined to a name, an email or a machine.
 *
 * Aptabase receives the same validated events without the install id, the
 * session id or the person properties — it only ever reports event counts.
 * Exception detail goes to PostHog only.
 *
 * The PostHog project API key and the Aptabase app key below are public
 * identifiers (not secrets). Both are write-only — they cannot read the
 * dashboard or delete data. Same model as Google Analytics tracking IDs.
 */

const { PostHog } = require('posthog-node');
const aptabase = require('@aptabase/electron/main');
const { randomUUID } = require('node:crypto');
const { app } = require('electron');
const userSettings = require('./userSettings');
const analyticsEvents = require('./analyticsEvents');
// While the analytics UI is hidden the notice is never due; sending is
// unchanged (src/shared/analyticsUi.js).
const { ANALYTICS_UI_HIDDEN } = require('../shared/analyticsUi');

// PostHog project token (Settings → Project token & ID, project 280352, EU
// Cloud). Write-only and safe in a public app — it can send events and
// nothing else: it cannot read the dashboard, change settings or delete
// data. The personal and project *secret* keys can do all three and must
// never appear here.
const POSTHOG_API_KEY = 'phc_w4KGHkLoGyutiNQVYoXnzXJmdUKXc7WhzvGXKKt2dzez';
// EU residency.
const POSTHOG_HOST = 'https://eu.i.posthog.com';
const APTABASE_APP_KEY = 'A-EU-5590504973';

// Bounds the quit path: a dead network must not be able to hold the app
// open, so the flush gets this long and the quit proceeds regardless.
const SHUTDOWN_TIMEOUT_MS = 2000;

const ENABLED_KEY = 'analyticsEnabled';
const INSTALL_ID_KEY = 'analyticsInstallId';
// Opt-IN, unlike ENABLED_KEY. PRIVACY.md committed, before this existed,
// that any ability to *send* crash detail would be a separate opt-in
// setting; absent means off, and only an explicit true turns it on.
const ERROR_REPORTING_KEY = 'errorReportingEnabled';
const NOTICE_VERSION_KEY = 'analyticsNoticeVersion';
// Superseded by NOTICE_VERSION_KEY; still read so an existing install is not
// mistaken for a fresh one. Never written again. It only ever existed under
// the old name — it was replaced before the rename.
const NOTICE_SHOWN_KEY = 'telemetryNoticeShown';

let client = null;
let aptabaseInitialized = false;
let installId = null;
let identified = false;
// One per launch. PostHog groups events into sessions by this; posthog-node
// forwards it but never invents one — it is a server-side SDK with no idea
// what a session is. For Frame a launch is the session.
const sessionId = randomUUID();
const activeTimer = analyticsEvents.createActiveTimer();
let activeTicker = null;

// Bounds what one run can spend of the analytics quota; see the limiter's
// note in analyticsEvents.js for why an app that only sends user-driven
// events still needs a ceiling.
const rateLimiter = analyticsEvents.createRateLimiter();

/**
 * Initialize Aptabase and build the PostHog client.
 *
 * MUST be called before app.whenReady(): the Aptabase SDK uses
 * protocol.registerSchemesAsPrivileged internally. posthog-node has no such
 * constraint. Each is set up independently, so one failing (or PostHog's key
 * being unset) leaves the other sending.
 *
 * We always build (regardless of opt-out state) because construction has no
 * network side-effects — events only go out when capture runs, and that path
 * is gated by isEnabled(). Building eagerly avoids the chicken-and-egg with
 * userSettings, which loads after app.whenReady.
 */
function init() {
  initAptabase();
  if (client) return;
  if (!POSTHOG_API_KEY.startsWith('phc_') || POSTHOG_API_KEY.includes('REPLACE')) {
    console.warn('Analytics: no PostHog project API key configured — nothing will be sent');
    return;
  }
  try {
    // Geo lookup ON: PostHog resolves the request IP to country/region and
    // discards the IP itself. See PRIVACY.md for what is derived.
    //
    // `false` is load-bearing and must not be "cleaned up" to an omitted
    // option. posthog-node is a *server-side* SDK, where the request IP is
    // usually the server's, so its core defaults `disableGeoip` to TRUE
    // (@posthog/core posthog-core-stateless.js: `options.disableGeoip ?? true`)
    // and stamps `$geoip_disable: true` on every event. Frame is the
    // exception the default does not expect: it runs on the user's machine,
    // so the request IP is the user's and the lookup is meaningful.
    client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST, disableGeoip: false });
  } catch (err) {
    console.error('Analytics: PostHog init failed', err);
  }
}

function initAptabase() {
  if (aptabaseInitialized) return;
  try {
    aptabase.initialize(APTABASE_APP_KEY);
    aptabaseInitialized = true;
  } catch (err) {
    console.error('Analytics: Aptabase init failed', err);
  }
}

/**
 * This install's distinct id, resolved on first use and cached for the run.
 *
 * Lazy because userSettings loads after init(): asking earlier would read an
 * empty cache and mint an id for a user who had opted out. Returns null when
 * analytics is off, which is also the caller's signal to send nothing.
 */
function distinctId() {
  if (installId) return installId;
  const { id, write } = analyticsEvents.resolveInstallId({
    stored: userSettings.get(INSTALL_ID_KEY),
    enabled: isEnabled()
  });
  if (write === 'set') userSettings.set(INSTALL_ID_KEY, id);
  else if (write === 'delete') userSettings.set(INSTALL_ID_KEY, null);
  installId = id;
  return id;
}

/**
 * Person properties, sent once per run alongside the first event.
 *
 * Operating system and app version only — exactly the two fields Aptabase
 * attached automatically and that PRIVACY.md already discloses, so the
 * disclosure surface does not grow with the move.
 */
function personProperties() {
  if (identified) return undefined;
  identified = true;
  return { $set: { $os: process.platform, $app_version: app.getVersion() } };
}

/**
 * Send a registered anonymous event. No-op if disabled or not initialized.
 * The (name, props) pair is validated against the registry in
 * analyticsEvents.js — unregistered events are dropped entirely, unknown
 * props and out-of-enum values are stripped — so no call site (main or
 * renderer via IPC) can ship content past the allowlist.
 */
function track(name, props) {
  if (!isEnabled() || (!client && !aptabaseInitialized)) return;
  const validated = analyticsEvents.validateEvent(name, props);
  if (validated === null) return;
  const gate = rateLimiter.check(Date.now());
  if (gate.notice) console.warn('Analytics:', gate.notice);
  if (!gate.allowed) return;
  if (aptabaseInitialized) {
    try {
      aptabase.trackEvent(name, Object.keys(validated).length ? validated : undefined);
    } catch (err) {
      console.error('Analytics: Aptabase trackEvent failed', err);
    }
  }
  if (!client) return;
  const id = distinctId();
  if (!id) return;
  try {
    client.capture({
      distinctId: id,
      event: name,
      properties: Object.assign({ $session_id: sessionId }, validated, personProperties())
    });
  } catch (err) {
    console.error('Analytics: PostHog capture failed', err);
  }
}

/**
 * Whether exception detail may be sent.
 *
 * Two gates, both required: analytics must be on at all (so an analytics
 * opt-out silences this too, and a corrupt settings file fails closed here
 * as well), and this setting must be explicitly true. Anything else —
 * absent, null, a stray string — reads as off.
 */
function isErrorReportingEnabled() {
  return isEnabled() && userSettings.get(ERROR_REPORTING_KEY) === true;
}

/**
 * Send one exception, sanitized. No-op unless error reporting is explicitly on.
 *
 * Deliberately not an event: this never touches the registry, so
 * validateEvent stays mechanically enum-only and a reviewer does not have
 * to trust a call site. It does share the event rate limiter, because an
 * exception repeating inside a render loop is exactly the shape of bug that
 * would otherwise spend a month's quota in an afternoon.
 *
 * The raw error is never handed to the SDK — a reconstructed one carries
 * only the sanitized fields, so there is no path by which the original
 * message or stack could be read off it later.
 */
function captureException(err) {
  if (!isErrorReportingEnabled() || !client) return;
  const gate = rateLimiter.check(Date.now());
  if (gate.notice) console.warn('Analytics:', gate.notice);
  if (!gate.allowed) return;
  const id = distinctId();
  if (!id) return;
  const safe = analyticsEvents.sanitizeException(err);
  try {
    const scrubbed = new Error(safe.message);
    scrubbed.name = safe.name;
    scrubbed.stack = safe.stack;
    client.captureException(scrubbed, id);
  } catch (e) {
    console.error('Analytics: captureException failed', e);
  }
}

/**
 * Whether the disclosure notice is due, and the version to store when it is
 * acknowledged.
 *
 * Decided here rather than in the renderer: the policy lives in
 * analyticsEvents.js next to everything else analytics decides, and the
 * renderer reaches main for it the way it reaches main for every other
 * analytics call.
 */
function noticeState() {
  if (ANALYTICS_UI_HIDDEN) return { show: false, version: analyticsEvents.NOTICE_VERSION };
  return {
    show: analyticsEvents.shouldShowNotice({
      storedVersion: userSettings.get(NOTICE_VERSION_KEY),
      legacyShown: userSettings.get(NOTICE_SHOWN_KEY)
    }),
    version: analyticsEvents.NOTICE_VERSION
  };
}

/**
 * Start counting active time.
 *
 * Driven by a visibility-gated interval, so it advances only while a window
 * is actually on screen. Frame is a tool people leave open all day; counting
 * wall-clock time from launch to quit would report a working day for someone
 * who glanced at it twice.
 *
 * Called after the first window exists — gatedInterval judges visibility
 * from the open windows, and there are none before app.whenReady.
 */
function startActiveTimer() {
  if (activeTicker) return;
  // Lazy: pollGate is wired during early boot and its own header asks that
  // nothing drag it into a require order it did not choose.
  const pollGate = require('./pollGate');
  activeTicker = pollGate.gatedInterval(() => activeTimer.tick(), 60 * 1000, {
    refreshOnShow: false
  });
}

/**
 * Anonymous event marking this launch.
 */
function trackAppStarted() {
  track('app_started');
}

/**
 * The one event an opt-out sends: that it happened, and nothing else.
 *
 * Sent while analytics is still on, immediately before setEnabled flips it,
 * so it is the last thing this install sends. Deliberately not track(): the
 * install id is being deleted in the same breath, so it must not ride along,
 * and neither do the session id or the person properties. PostHog requires
 * a distinct id, so the event gets a fresh random one used exactly once and
 * creates no person; geo lookup is off for it. The result is a count of
 * opt-outs that cannot be joined to anything the install sent before.
 */
function trackOptOut() {
  const name = 'analytics_disabled';
  if (analyticsEvents.validateEvent(name) === null) return;
  const gate = rateLimiter.check(Date.now());
  if (gate.notice) console.warn('Analytics:', gate.notice);
  if (!gate.allowed) return;
  if (aptabaseInitialized) {
    try {
      aptabase.trackEvent(name);
    } catch (err) {
      console.error('Analytics: Aptabase trackEvent failed', err);
    }
  }
  if (!client) return;
  try {
    client.capture({
      distinctId: randomUUID(),
      event: name,
      properties: { $process_person_profile: false },
      disableGeoip: true
    });
  } catch (err) {
    console.error('Analytics: PostHog capture failed', err);
  }
}

/**
 * Toggle analytics from Settings. Persists the new state, then re-resolves
 * the install id so the toggle takes effect on disk immediately.
 *
 * Turning analytics off deletes the stored id rather than parking it: an
 * opt-out that leaves a resumable identifier behind is not an opt-out.
 * Turning it back on therefore mints a new one, and the returning user is
 * deliberately a new user to the dashboard — continuity is the thing the
 * opt-out was asked to break.
 */
function setEnabled(enabled) {
  const value = enabled === true;
  if (!value && isEnabled()) trackOptOut();
  userSettings.set(ENABLED_KEY, value);
  installId = null;
  identified = false;
  distinctId();
  return value;
}

/**
 * Copy settings forward from the names this feature used when it was called
 * "telemetry". Runs once, right after userSettings loads and before anything
 * reads a setting.
 *
 * Skipped entirely when the settings file could not be read: a write would
 * clear userSettings' `failed` flag and take fail-closed down with it, so a
 * corrupt file would end up re-enabling analytics for someone who had opted
 * out — the precise bug this codebase already fixed once.
 */
function migrateLegacySettings() {
  if (userSettings.loadFailed()) return;
  const snapshot = {};
  for (const [current, legacy] of Object.entries(analyticsEvents.LEGACY_SETTING_KEYS)) {
    snapshot[current] = userSettings.get(current);
    snapshot[legacy] = userSettings.get(legacy);
  }
  for (const { key, value } of analyticsEvents.planLegacyMigration(snapshot)) {
    userSettings.set(key, value);
  }
}

/**
 * Make a failed settings load's fail-closed state stick. Called right after
 * userSettings loads.
 *
 * The in-memory flag alone does not hold: any later setting write (dismissing
 * the analytics notice, which reappears because its own flag was lost too)
 * rewrites the file from an empty cache and clears the flag, and the corrupt
 * file has already been moved aside, so the next launch reads "no file" as a
 * fresh install. Either way analytics came back on for someone who may have
 * opted out. Writing the opt-out persists the only safe assumption; the user
 * can turn it back on in Settings.
 */
function enforceFailClosed() {
  if (!userSettings.loadFailed()) return;
  userSettings.set(ENABLED_KEY, false);
}

/**
 * Effective enabled state. Default ON when the setting has never been
 * touched (opt-out semantics) — but fails CLOSED when the settings file
 * could not be loaded at all, so corruption can never silently re-enable
 * analytics for a user who opted out.
 */
function isEnabled() {
  return analyticsEvents.effectiveEnabled({
    value: userSettings.get(ENABLED_KEY),
    loadFailed: userSettings.loadFailed(),
  });
}

/**
 * Flush the batcher and close the client, for the quit path.
 *
 * posthog-node queues events and sends them on an interval, so a session's
 * last events would otherwise die with the process — the very events that
 * say what a user did just before leaving. Resolves either way: a flush
 * that cannot reach the network must not be able to hold the app open, so
 * the SDK's own timeout bounds it and a failure is logged, not thrown.
 */
async function shutdown() {
  // Last event of the session, sent before the flush that carries it. Zero
  // active seconds is a real answer — an app that was launched and never
  // looked at — so it is sent rather than skipped.
  track('app_session_ended', { active_seconds: activeTimer.seconds() });
  if (!client) return;
  try {
    await client.shutdown(SHUTDOWN_TIMEOUT_MS);
  } catch (err) {
    console.error('Analytics: shutdown failed', err);
  } finally {
    client = null;
  }
}

module.exports = {
  init,
  track,
  trackAppStarted,
  startActiveTimer,
  captureException,
  noticeState,
  setEnabled,
  isEnabled,
  isErrorReportingEnabled,
  migrateLegacySettings,
  enforceFailClosed,
  shutdown
};
