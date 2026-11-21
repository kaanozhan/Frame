/**
 * cloudBriefsDraft — the New brief form's state, without the form.
 *
 * The draft a person fills in (kind, title, description, priority, links),
 * how a pasted link is named (a port of Frame Cloud's
 * `apps/web/src/lib/link-service.ts`), what stops a submit, and the request
 * `CLOUD_BRIEF_CREATE` receives. Pure: no DOM, no Electron, so `node --test`
 * covers it; cloudBriefsForm.js draws it. Main checks the request again and
 * does not trust anything here.
 */

/** The server's title limits (FrameCloud `BRIEF_TITLE_MAX`, `BRIEF_ATTACHMENT_TITLE_MAX`). */
const TITLE_MAX = 200;
const LINK_TITLE_MAX = 200;

/** The services a brief link is named after; anything else is a plain link titled by its host. */
const RULES = [
  {
    id: 'claude',
    hosts: ['claude.ai', 'claude.site'],
    title: (path) => (/(^|\/)artifacts?(\/|$)/.test(path) ? 'Claude artifact' : 'Claude chat'),
  },
  { id: 'chatgpt', hosts: ['chatgpt.com', 'chat.openai.com'], title: () => 'ChatGPT conversation' },
  { id: 'gemini', hosts: ['gemini.google.com'], title: () => 'Gemini conversation' },
  { id: 'gemini', hosts: ['g.co'], paths: ['/gemini'], title: () => 'Gemini conversation' },
  { id: 'figma', hosts: ['figma.com'], title: () => 'Figma file' },
  { id: 'github', hosts: ['github.com'], title: () => 'GitHub link' },
];

/**
 * The service behind `url` — `{ id, defaultTitle, host }` — or null when it is
 * not a full http(s) URL. The host is shown without `www.`.
 */
function linkService(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === '') return null;
  const rule = RULES.find(
    (r) =>
      r.hosts.some((h) => host === h || host.endsWith(`.${h}`)) &&
      (!r.paths || r.paths.some((p) => parsed.pathname.startsWith(p))),
  );
  return rule
    ? { id: rule.id, defaultTitle: rule.title(parsed.pathname), host }
    : { id: 'link', defaultTitle: host, host };
}

/** A fresh form: Work, Medium, nothing typed. Every opening starts here. */
function emptyDraft() {
  return {
    kind: 'work',
    title: '',
    body: '',
    priority: 'medium',
    links: [],
    nextKey: 1,
    showErrors: false,
    pending: false,
    error: null,
  };
}

/**
 * The draft with `raw` added as a link row titled after its service, or null
 * when `raw` is not a full http(s) URL (the caller keeps the text for fixing).
 */
function addLink(draft, raw) {
  const url = typeof raw === 'string' ? raw.trim() : '';
  const service = linkService(url);
  if (!service) return null;
  const key = draft.nextKey;
  return {
    ...draft,
    links: [...draft.links, { key, title: service.defaultTitle, url, service }],
    nextKey: key + 1,
  };
}

function titleOk(value, max) {
  const t = typeof value === 'string' ? value.trim() : '';
  return t.length > 0 && t.length <= max;
}

/** What stops a submit: `{ ok, titleError, untitledKeys }`. */
function validateDraft(draft) {
  const titleError = !titleOk(draft.title, TITLE_MAX);
  const untitledKeys = draft.links.filter((l) => !titleOk(l.title, LINK_TITLE_MAX)).map((l) => l.key);
  return { ok: !titleError && untitledKeys.length === 0, titleError, untitledKeys };
}

/** The `CLOUD_BRIEF_CREATE` request: priority only for Work, links in the order shown. */
function toRequest(draft) {
  const request = {
    kind: draft.kind,
    title: draft.title.trim(),
    body: draft.body,
    links: draft.links.map((l) => ({ title: l.title.trim(), url: l.url })),
  };
  if (draft.kind === 'work') request.priority = draft.priority;
  return request;
}

module.exports = {
  TITLE_MAX,
  linkService,
  emptyDraft,
  addLink,
  validateDraft,
  toRequest,
};
