/**
 * Cloud Briefs Form
 *
 * The New brief form (frame-cloud-briefs-create spec), drawn into the Briefs
 * drawer by cloudBriefsPanel.js. A port of the web's `new-brief-dialog.tsx`:
 * kind, title, description, priority for Work, and AI conversations & links.
 *
 * The draft's rules live in cloudBriefsDraft.js and its words in
 * cloudBriefsCopy.js; this module only draws them and wires the events. The
 * form is drawn once per opening and then patched in place, so typing never
 * loses focus to a re-render. It sends the open folder's path and the
 * request — main resolves the project, creates the brief and attaches the
 * links in one call, and the renderer never holds a brief id.
 */

const { ipcRenderer } = require('electron');
const { IPC } = require('../shared/ipcChannels');
const state = require('./state');
const { escapeHtml } = require('./htmlUtils');
const copy = require('./cloudBriefsCopy');
const draftCore = require('./cloudBriefsDraft');

const BODY_MAX = 10000;
const KINDS = ['work', 'proposal'];
const PRIORITIES = ['high', 'medium', 'low'];

let containerElement = null;
let formElement = null;
let draft = null;
let onCreated = null;
// Every opening takes a number; a create that answers after its form was
// closed (Back, a folder change, hide()) lands nowhere.
let openSeq = 0;

/** The form's elements by `data-ref`. */
function ref(name) {
  return formElement ? formElement.querySelector(`[data-ref="${name}"]`) : null;
}

/** Draw a fresh form into `container` and focus the title. `onCreated({ number, attachmentError })` runs after a create. */
function open(container, options = {}) {
  close();
  if (!container) return;
  openSeq += 1;
  draft = draftCore.emptyDraft();
  onCreated = typeof options.onCreated === 'function' ? options.onCreated : null;
  const id = `cloud-brief-new-${openSeq}`;
  containerElement = container;
  container.innerHTML = renderForm(id);
  formElement = container.querySelector('form');
  formElement.addEventListener('submit', onSubmit);
  formElement.addEventListener('input', onInput);
  formElement.addEventListener('change', onChange);
  formElement.addEventListener('click', onClick);
  formElement.addEventListener('keydown', onKeydown);
  formElement.addEventListener('paste', onPaste);
  const title = ref('title');
  if (title) title.focus();
}

/** Drop the form. A create still in flight is forgotten, not cancelled. */
function close() {
  openSeq += 1;
  if (containerElement && formElement && containerElement.contains(formElement)) containerElement.innerHTML = '';
  containerElement = null;
  formElement = null;
  draft = null;
  onCreated = null;
}

/** True while a create is running: the drawer keeps the form open. */
function isPending() {
  return Boolean(draft && draft.pending);
}

// ─── Rendering ────────────────────────────────────────────────

function renderForm(id) {
  const kind = copy.KIND_COPY[draft.kind];
  return `<div class="cloud-briefs-detail-body">
    <form class="cloud-briefs-form" novalidate>
      <header class="cloud-briefs-form-header">
        <h2 class="cloud-briefs-detail-title">${escapeHtml(copy.NEW_BRIEF_TITLE)}</h2>
        <p class="cloud-briefs-muted">${escapeHtml(copy.NEW_BRIEF_DESCRIPTION)}</p>
      </header>

      <fieldset class="cloud-briefs-field">
        <legend class="cloud-briefs-label">Kind</legend>
        <div class="cloud-briefs-kind-switch" role="radiogroup" aria-describedby="${id}-kind-explanation">
          ${KINDS.map((k) => `<label class="cloud-briefs-kind-option">
            <input type="radio" name="kind" value="${k}"${k === draft.kind ? ' checked' : ''} />
            <span>${escapeHtml(copy.KIND_COPY[k].label)}</span>
          </label>`).join('')}
        </div>
        <p id="${id}-kind-explanation" class="cloud-briefs-field-hint" data-ref="kind-explanation">${escapeHtml(kind.explanation)}</p>
      </fieldset>

      <div class="cloud-briefs-field">
        <label class="cloud-briefs-label" for="${id}-title">Title</label>
        <input id="${id}-title" class="cloud-briefs-input" type="text" maxlength="${draftCore.TITLE_MAX}" autocomplete="off" spellcheck="true" data-ref="title" aria-describedby="${id}-title-error" />
        <p id="${id}-title-error" class="cloud-briefs-field-error" data-ref="title-error" hidden>${escapeHtml(copy.TITLE_REQUIRED)}</p>
      </div>

      <div class="cloud-briefs-field">
        <label class="cloud-briefs-label" for="${id}-body">Description <span class="cloud-briefs-optional">(optional)</span></label>
        <textarea id="${id}-body" class="cloud-briefs-input cloud-briefs-textarea" rows="4" maxlength="${BODY_MAX}" data-ref="body"></textarea>
      </div>

      <div class="cloud-briefs-field" data-ref="priority-field">
        <label class="cloud-briefs-label" for="${id}-priority">Priority</label>
        <select id="${id}-priority" class="cloud-briefs-input cloud-briefs-select" data-ref="priority">
          ${PRIORITIES.map((p) => `<option value="${p}"${p === draft.priority ? ' selected' : ''}>${escapeHtml(copy.priorityLabel(p))}</option>`).join('')}
        </select>
      </div>

      <fieldset class="cloud-briefs-field">
        <legend class="cloud-briefs-label">${escapeHtml(copy.AI_LINKS_TITLE)} <span class="cloud-briefs-optional">(optional)</span></legend>
        <p class="cloud-briefs-field-hint">${escapeHtml(copy.AI_LINKS_HINT)}</p>
        <div class="cloud-briefs-link-paste">
          <input id="${id}-link" class="cloud-briefs-input" type="url" placeholder="Paste a link…" aria-label="Paste a link" autocomplete="off" data-ref="link-input" aria-describedby="${id}-link-invalid" />
          <button type="button" class="cloud-briefs-web-btn" data-action="add-link" data-ref="add-link" disabled>Add</button>
        </div>
        <p id="${id}-link-invalid" class="cloud-briefs-field-error" data-ref="link-invalid" hidden>${escapeHtml(copy.INVALID_LINK)}</p>
        <ul class="cloud-briefs-link-rows" data-ref="links" hidden></ul>
        <p class="cloud-briefs-field-error" data-ref="links-error" hidden>${escapeHtml(copy.LINK_TITLE_REQUIRED)}</p>
      </fieldset>

      <p class="cloud-briefs-form-error" role="alert" data-ref="error" hidden></p>

      <div class="cloud-briefs-form-actions">
        <button type="submit" class="cloud-briefs-primary-btn" data-ref="submit">${escapeHtml(copy.submitLabel(draft.kind, false))}</button>
      </div>
    </form>
  </div>`;
}

function renderLinkRow(link) {
  return `<li class="cloud-briefs-link-row" data-key="${link.key}">
      <input class="cloud-briefs-input cloud-briefs-link-title" type="text" maxlength="200" autocomplete="off" value="${escapeHtml(link.title)}" aria-label="${escapeHtml(`Title for ${link.url}`)}" data-action="link-title" data-key="${link.key}" />
      <span class="cloud-briefs-link-host" title="${escapeHtml(link.url)}">${escapeHtml(link.service.host)}</span>
      <button type="button" class="cloud-briefs-icon-btn cloud-briefs-link-remove" aria-label="${escapeHtml(`Remove ${link.title || link.url}`)}" data-action="remove-link" data-key="${link.key}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </li>`;
}

/** The link rows, redrawn only when a row is added or removed. */
function renderLinks() {
  const list = ref('links');
  if (!list) return;
  list.innerHTML = draft.links.map(renderLinkRow).join('');
  list.hidden = draft.links.length === 0;
}

/** Kind-dependent parts: the explanation, the priority field, the submit label. */
function renderKind() {
  const explanation = ref('kind-explanation');
  if (explanation) explanation.textContent = copy.KIND_COPY[draft.kind].explanation;
  const priority = ref('priority-field');
  if (priority) priority.hidden = draft.kind !== 'work';
  renderSubmit();
}

function renderSubmit() {
  const submit = ref('submit');
  if (!submit) return;
  submit.textContent = copy.submitLabel(draft.kind, draft.pending);
  submit.disabled = draft.pending;
  formElement.setAttribute('aria-busy', String(draft.pending));
}

/** Field messages, shown once a submit was tried and kept current as the fields change. */
function renderErrors() {
  const result = draftCore.validateDraft(draft);
  const show = draft.showErrors;
  const titleError = ref('title-error');
  if (titleError) titleError.hidden = !(show && result.titleError);
  const title = ref('title');
  if (title) title.setAttribute('aria-invalid', String(show && result.titleError));
  const untitled = new Set(show ? result.untitledKeys : []);
  formElement.querySelectorAll('.cloud-briefs-link-title').forEach((input) => {
    input.setAttribute('aria-invalid', String(untitled.has(Number(input.dataset.key))));
  });
  const linksError = ref('links-error');
  if (linksError) linksError.hidden = untitled.size === 0;
  return result;
}

function renderError() {
  const el = ref('error');
  if (!el) return;
  el.textContent = draft.error || '';
  el.hidden = !draft.error;
}

function setLinkInvalid(invalid) {
  const el = ref('link-invalid');
  if (el) el.hidden = !invalid;
  const input = ref('link-input');
  if (input) input.setAttribute('aria-invalid', String(invalid));
}

function syncAddButton() {
  const input = ref('link-input');
  const add = ref('add-link');
  if (input && add) add.disabled = input.value.trim() === '';
}

// ─── Links ────────────────────────────────────────────────────

/** Add `raw` as a row. A non-http(s) text is refused, said so, and left in the field. */
function addLink(raw) {
  const input = ref('link-input');
  const next = draftCore.addLink(draft, raw);
  if (!next) {
    setLinkInvalid(typeof raw === 'string' && raw.trim() !== '');
    return false;
  }
  draft = next;
  if (input) input.value = '';
  setLinkInvalid(false);
  syncAddButton();
  renderLinks();
  if (draft.showErrors) renderErrors();
  return true;
}

// ─── Events ───────────────────────────────────────────────────

function onInput(event) {
  const target = event.target;
  const refName = target.dataset.ref;
  if (refName === 'title') draft.title = target.value;
  else if (refName === 'body') draft.body = target.value;
  else if (refName === 'link-input') {
    setLinkInvalid(false);
    syncAddButton();
    return;
  } else if (target.dataset.action === 'link-title') {
    const key = Number(target.dataset.key);
    draft.links = draft.links.map((l) => (l.key === key ? { ...l, title: target.value } : l));
  } else {
    return;
  }
  if (draft.showErrors) renderErrors();
}

function onChange(event) {
  const target = event.target;
  if (target.name === 'kind' && target.checked) {
    draft.kind = target.value === 'proposal' ? 'proposal' : 'work';
    renderKind();
  } else if (target.dataset.ref === 'priority') {
    if (PRIORITIES.includes(target.value)) draft.priority = target.value;
  }
}

function onClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl || !formElement.contains(actionEl)) return;
  const action = actionEl.dataset.action;
  if (action === 'add-link') {
    const input = ref('link-input');
    if (input) addLink(input.value);
  } else if (action === 'remove-link') {
    const key = Number(actionEl.dataset.key);
    draft.links = draft.links.filter((l) => l.key !== key);
    renderLinks();
    if (draft.showErrors) renderErrors();
    const input = ref('link-input');
    if (input) input.focus();
  }
}

function onKeydown(event) {
  // Enter in the links field adds the link; it never submits the form.
  if (event.key === 'Enter' && event.target.dataset.ref === 'link-input') {
    event.preventDefault();
    addLink(event.target.value);
  }
}

function onPaste(event) {
  const input = event.target;
  if (input.dataset.ref !== 'link-input' || input.value.trim() !== '') return;
  const pasted = event.clipboardData ? event.clipboardData.getData('text') : '';
  if (!pasted.trim()) return;
  event.preventDefault();
  // A full link becomes a row at once; anything else stays in the field, flagged.
  if (!addLink(pasted)) {
    input.value = pasted.trim();
    syncAddButton();
  }
}

function onSubmit(event) {
  event.preventDefault();
  submit();
}

async function submit() {
  if (!draft || draft.pending) return;
  draft.error = null;
  draft.showErrors = true;
  renderError();
  const validity = renderErrors();
  if (!validity.ok) {
    const first = validity.titleError
      ? ref('title')
      : formElement.querySelector(`.cloud-briefs-link-title[data-key="${validity.untitledKeys[0]}"]`);
    if (first) first.focus();
    return;
  }
  const path = state.getProjectPath();
  if (!path) {
    draft.error = copy.createErrorMessage('notConnected');
    renderError();
    return;
  }

  const seq = openSeq;
  draft.pending = true;
  renderSubmit();
  let result;
  try {
    result = await ipcRenderer.invoke(IPC.CLOUD_BRIEF_CREATE, path, draftCore.toRequest(draft));
  } catch (err) {
    console.error('cloudBriefsForm: could not create the brief', err);
    result = { ok: false, reason: 'other' };
  }
  if (seq !== openSeq || !draft) return;
  draft.pending = false;
  if (result && result.ok) {
    const done = onCreated;
    if (done) done({ number: result.number, attachmentError: result.attachmentError || null });
    return;
  }
  renderSubmit();
  const reason = result && result.reason;
  // Signed out: the session push hides the panel; say nothing here.
  if (reason === 'unauthorized') return;
  draft.error = copy.createErrorMessage(reason);
  renderError();
}

module.exports = {
  open,
  close,
  isPending,
};
