/**
 * cloudEarlyAccess — the words the Frame Cloud window says while the server
 * is invite-only.
 *
 * FrameCloud only creates an account through an invite link (its
 * `early-access` spec), so the signed-out window leads with the waitlist and
 * keeps sign-in for people who already have an invite. When the server is not
 * invite-only, or cannot say, the window is today's (`paneMode` → classic).
 * Pure: no DOM, no Electron, so `node --test` covers it.
 */

/** frame.cool's waitlist page, the same constant FrameCloud's web uses. */
const WAITLIST_URL = 'https://frame.cool/early-access';

const COPY = {
  title: 'Frame Cloud is in early access',
  lede: "Join the waitlist and we'll email you an invite link.",
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  join: 'Join the waitlist',
  alreadyInvited: 'Already invited?',
  signIn: 'Continue with GitHub',
  joinedTitle: "You're on the list",
  useAnother: 'Use another address',
  awaitingHint:
    "Browser says you're not in yet? Open the link in your invite email, then press Open browser again. No invite yet? Join the waitlist.",
  expired:
    'The code expired. Frame Cloud is invite-only for now: open your invite link first, or join the waitlist.',
  joinWaitlistAction: 'Join the waitlist',
  openCloud: 'Open Frame Cloud',
  settingsRowEarly: 'Frame Cloud is in early access.',
  fallbackLink: 'Join on frame.cool',
  // The header's Frame Cloud entry (cloudEntry.js): its call before this
  // machine has joined, and the tag beside the label before and after.
  entryCall: 'Join Frame Cloud waitlist',
  entryEarly: 'Early access',
  entryJoined: 'On the list',
};

/** The joined card's body: "We'll email ada@example.com when your invite is ready." */
function joinedBody(email) {
  return `We'll email ${email} when your invite is ready.`;
}

const FAILURES = {
  invalid: { message: 'Enter a full email address, like ada@example.com.', showFallback: false },
  rateLimited: { message: 'Too many tries. Wait a minute, or join on frame.cool.', showFallback: true },
  network: { message: "Couldn't reach Frame Cloud. You can join on frame.cool instead.", showFallback: true },
};

/**
 * Why a join failed, as one line, and whether to offer frame.cool instead.
 * `unavailable` (a server without the waitlist) reads like `network`.
 * → `{ message, showFallback }`.
 */
function joinFailure(reason) {
  return FAILURES[reason] || FAILURES.network;
}

/**
 * Which signed-out pane to show: today's (`classic`) unless the server said
 * it is invite-only; then the joined card once this machine has joined,
 * otherwise the form.
 */
function paneMode(state) {
  const s = state || {};
  if (s.inviteOnly !== true) return 'classic';
  return s.waitlistEmail ? 'joined' : 'form';
}

module.exports = {
  WAITLIST_URL,
  COPY,
  joinedBody,
  joinFailure,
  paneMode,
};
