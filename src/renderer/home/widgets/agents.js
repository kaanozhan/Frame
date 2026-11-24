/**
 * Agents widget — the prompt composer.
 *
 * The top half of Home is one thing: say what you want done, pick the
 * agent, press Start. Frame opens a new terminal, starts the agent there and
 * hands it the prompt — the same `agentDispatch.dispatch({ createNew })` door
 * task runs go through, so the pre-flight, the agent-ready wait and every
 * error toast come with it. An empty prompt still starts the agent, just
 * without anything to say to it.
 *
 * Home no longer lists terminals: the sidebar and the Terminals section are
 * where running work lives, and a composer sharing the half with a slot board
 * would be squeezed into a footnote.
 *
 * None of this touches `ipcRenderer` (D3, S6) — `homeData` owns the tool
 * write, `agentDispatch` owns the launch.
 */

const { Terminal } = require('lucide');
const { escapeHtml } = require('./../../htmlUtils');
const notify = require('./../../notify');
const homeData = require('./../homeData');

const PLACEHOLDER = 'Give your prompt, e.g. Add a dark mode toggle';

// What is in the composer, kept outside the widget: Home rebuilds its widgets
// on every visit, so a textarea alone lost the prompt whenever Start failed
// and the user came back to retype it from memory (#222). Cleared only once
// the prompt reached the agent.
let draft = '';

module.exports = {
  id: 'agents',
  title: 'New agent',
  icon: Terminal,
  sources: ['aiTool'],
  defaultSpan: 1,
  defaultEnabled: true,

  isAvailable: () => true,

  mount(el, ctx) {
    this.ctx = ctx;
    this._starting = false;

    this.el = document.createElement('div');
    this.el.className = 'home-composer';
    // The picker is the shared .ai-tool-picker (the terminal header's): the
    // <label> is the visible box, the native <select> underneath stays the
    // interactive element, so clicking anywhere on the box opens it.
    // The greeting sits over the box; the agent picker and Start share the
    // box's bottom row, picker left, Start right.
    this.el.innerHTML = `
      <div class="home-composer-stack">
        <h1 class="home-composer-title">Welcome to Frame!</h1>
        <div class="home-composer-box">
          <textarea class="home-composer-input" rows="5" spellcheck="false"
                    aria-label="Prompt for the agent" placeholder="${escapeHtml(PLACEHOLDER)}"></textarea>
          <div class="home-composer-controls">
            <label class="ai-tool-picker" title="Agent — Start launches this one">
              <span class="ai-tool-picker-label">Agent</span>
              <select class="ai-tool-select home-agent-tool" aria-label="Agent"></select>
              <svg class="ai-tool-picker-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </label>
            <button type="button" class="primary-btn home-agent-start" title="Start the agent in a new terminal">Start</button>
          </div>
        </div>
      </div>
    `;

    this.inputEl = this.el.querySelector('.home-composer-input');
    this.toolEl = this.el.querySelector('.home-agent-tool');
    this.startEl = this.el.querySelector('.home-agent-start');
    this.inputEl.value = draft;
    this.inputEl.addEventListener('input', () => { draft = this.inputEl.value; });

    this.toolEl.addEventListener('change', () => this._setTool(this.toolEl.value));
    this.startEl.addEventListener('click', () => this._start());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this._start();
      }
    });
    // The same right-click affordance the launcher always had: pick the
    // shell for a plain terminal.
    this.startEl.addEventListener('contextmenu', (e) => {
      if (!ctx.showShellMenu) return;
      e.preventDefault();
      ctx.showShellMenu(e.clientX, e.clientY);
    });

    el.appendChild(this.el);
  },

  update({ aiTool }) {
    if (!this.el) return;
    this._renderTool(aiTool);
  },

  _start() {
    if (this._starting) return;
    // dispatch() types the prompt into the agent's input and presses Enter
    // once; a line break inside it would reach the TUI as its own keypress
    // and could send half the prompt. One line keeps it one message.
    const prompt = this.inputEl.value.replace(/\s*\n\s*/g, ' ').trim();
    const agentDispatch = require('./../../agentDispatch');

    if (!prompt) {
      // Nothing to say yet — start the agent the way the launcher always did.
      Promise.resolve()
        .then(() => agentDispatch.startDefaultAgent())
        .catch(err => notify.error(`Could not start the agent: ${err.message || 'launch failed'}`));
      return;
    }

    this._setStarting(true);
    // dispatch() moves the view into the new terminal at once and toasts its
    // own failures; the prompt is only cleared once it actually got there.
    agentDispatch.dispatch({ createNew: true, toolId: this.toolEl.value || null, prompt })
      .then((result) => {
        if (result && result.success) {
          draft = '';
          if (this.inputEl) this.inputEl.value = '';
        } else {
          notify.info('Your prompt is still on Home — open Home to send it again.');
        }
      })
      .catch(err => notify.error(`Could not start the agent: ${err.message || 'launch failed'}`))
      .finally(() => this._setStarting(false));
  },

  _setStarting(on) {
    this._starting = on;
    if (this.startEl) this.startEl.disabled = on;
  },

  /** The options and the selection, from homeData's `aiTool` source. */
  _renderTool(aiTool) {
    const available = (aiTool && aiTool.available) || {};
    const current = aiTool && aiTool.current;
    const ids = Object.keys(available);

    // Rebuilding the options on every tick would fight the open dropdown.
    if (ids.join(',') !== this._toolIds) {
      this._toolIds = ids.join(',');
      this.toolEl.innerHTML = ids.map(id => {
        const name = String(available[id].name || id).replace(' Code', '').replace(' CLI', '');
        return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
      }).join('');
    }

    if (current && this.toolEl.value !== current.id) this.toolEl.value = current.id;
    this._toolId = current ? current.id : null;
  },

  _setTool(toolId) {
    homeData.setAiTool(toolId)
      .then((ok) => {
        if (ok !== false) return;
        // Nothing changed, so the select must not claim otherwise.
        if (this._toolId) this.toolEl.value = this._toolId;
        notify.error('Could not switch the default agent');
      })
      .catch((err) => {
        if (this._toolId) this.toolEl.value = this._toolId;
        notify.error(`Could not switch the default agent: ${err.message || 'the change was rejected'}`);
      });
  },

  dispose() {
    this.el = null;
    this.inputEl = null;
    this.toolEl = null;
    this.startEl = null;
    this._toolIds = null;
    this.ctx = null;
  }
};
