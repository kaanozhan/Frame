/**
 * How to Use Frame — page illustrations (how-to-use-frame-guide spec).
 *
 * Sketches, not screenshots (plan D1): each page's illustration is a small
 * wireframe of the relevant part of Frame, drawn with HTML and the app's own
 * design tokens and lucide icons, so it follows all four themes and every
 * zoom step and weighs nothing. The user chose to try sketches and replace
 * them if they do not land — everything visual about them lives in this file
 * and the `.gs-*` rules in guide.css, behind one entry point.
 *
 * render(kind, focus) → HTML string, or null for a kind this file does not
 * draw (the host logs it once). A handful of kinds serve all pages through
 * `focus` (plan D10): the named region is drawn in the accent colour and the
 * rest of the sketch recedes. `focus` may be one region name or several
 * separated by commas.
 *
 * Every label drawn here is a literal UI string or a short caption; nothing
 * interpolated comes from the user or the filesystem, but text still goes
 * through escapeHtml so a future caption cannot break the markup.
 */

const {
  Package, Files, FilePlus2, Github, Plug, MessageSquarePlus, Settings, CircleHelp,
  Play, Sun, GitBranch, Bot, KeyRound, ChevronDown, SquareTerminal, Folder, File,
  Users, Lock, Plus, Maximize2, History, ListChecks, FileText, Check, GitMerge,
  Workflow, Search, RotateCcw, PanelRight, X, Bug, Lightbulb, Mail, Command, Keyboard,
  ZoomIn, ZoomOut
} = require('lucide');
const { lucideIcon } = require('../dock');
const { escapeHtml } = require('../htmlUtils');
const themes = require('../themes');
const uiZoom = require('../../shared/uiZoom');
const commandRegistry = require('../commandRegistry');
const { formatShortcut } = require('../platform');

// ─── Primitives ───────────────────────────────────────────

const icon = (data, size = 12) => lucideIcon(data, size);

/** Parse `focus` ("a" | "a,b" | ["a","b"]) into a Set of region names. */
function focusSet(focus) {
  if (!focus) return new Set();
  const list = Array.isArray(focus) ? focus : String(focus).split(',');
  return new Set(list.map((s) => s.trim()).filter(Boolean));
}

/**
 * A focusable region. Regions named in `focus` get .gs-focus; when the
 * sketch has any focus the others recede (CSS on .gs-has-focus).
 */
function region(name, focused, cls, inner) {
  const on = focused.has(name);
  return `<div class="gs-region ${cls || ''}${on ? ' gs-focus' : ''}" data-region="${escapeHtml(name)}">${inner}</div>`;
}

/** Placeholder text: a rounded bar of a given width (percent). */
const bar = (w, cls = '') => `<span class="gs-bar ${cls}" style="width:${w}%"></span>`;

/** A short literal label. */
const label = (text, cls = '') => `<span class="gs-label ${cls}">${escapeHtml(text)}</span>`;

/** A small bordered pill, optionally with a status dot ('ok'|'warn'|'err'|'accent'). */
function chip(text, { dot, cls = '' } = {}) {
  const d = dot ? `<span class="gs-dot gs-dot-${dot}"></span>` : '';
  return `<span class="gs-chip ${cls}">${d}${escapeHtml(text)}</span>`;
}

/** A fake terminal body: a prompt line plus a few output bars. */
function terminalLines(prompt, widths = [72, 54, 63]) {
  return `<div class="gs-term-lines">
      ${prompt ? `<div class="gs-term-prompt"><span class="gs-term-caret">$</span>${escapeHtml(prompt)}</div>` : ''}
      ${widths.map((w) => `<div>${bar(w)}</div>`).join('')}
    </div>`;
}

/** A settings-style toggle, on or off. */
const toggle = (on) => `<span class="gs-toggle${on ? ' gs-toggle-on' : ''}"><span></span></span>`;

/** A settings row: label left, control right. */
const settingRow = (text, control) => `<div class="gs-set-row">${label(text)}${control}</div>`;

/** A mini select. */
const select = (text) => `<span class="gs-select">${escapeHtml(text)}${icon(ChevronDown, 9)}</span>`;

/** The sketch's outer frame. */
function frame(kind, focused, inner, cls = '') {
  return `<div class="gs gs-${kind}${focused.size ? ' gs-has-focus' : ''} ${cls}">${inner}</div>`;
}

// ─── Kinds ────────────────────────────────────────────────

const KINDS = {
  /** Three agent CLIs, your own sign-in, running inside Frame's terminals. */
  agents(focused) {
    const cli = (name, cmd) => `
      <div class="gs-agent-card">
        <div class="gs-agent-name">${icon(SquareTerminal, 13)}${escapeHtml(name)}</div>
        <div class="gs-agent-cmd">${escapeHtml(cmd)}</div>
      </div>`;
    return frame('agents', focused, `
      <div class="gs-agents-col">
        ${region('clis', focused, 'gs-agents-clis', cli('Claude Code', 'claude') + cli('Codex CLI', 'codex'))}
        ${region('key', focused, 'gs-agents-key', `${icon(KeyRound, 12)}${label('your own sign-in')}`)}
      </div>
      <div class="gs-agents-arrow" aria-hidden="true"><span></span></div>
      ${region('frame', focused, 'gs-agents-frame', `
        <div class="gs-window-bar"><span class="gs-mark"></span>${label('Frame', 'gs-strong')}</div>
        <div class="gs-agents-panes">
          <div class="gs-pane">${terminalLines('claude', [70, 48])}${chip('working', { dot: 'accent' })}</div>
          <div class="gs-pane">${terminalLines('codex', [58, 66])}${chip('waiting for input', { dot: 'warn' })}</div>
        </div>
        <div class="gs-agents-context">
          ${chip('AGENTS.md')}${chip('PROJECT_NOTES.md')}${chip('tasks.json')}${chip('specs/')}
        </div>`)}
    `);
  },

  /**
   * The whole window. Regions: sidebar-switcher, header-agent, header-start,
   * header-theme, rail-views, rail-foot, rail-guide, sidebar-nav, center,
   * dock, statusbar-left, statusbar-right.
   */
  shell(focused) {
    const railBtn = (data, name) => region(name, focused, 'gs-rail-btn', icon(data, 12));
    const navRow = (text, extra = '') => `<div class="gs-nav-row">${bar(0, 'gs-nav-icon')}${label(text)}${extra}</div>`;

    const header = `
      <div class="gs-shell-header">
        <span class="gs-mark"></span>
        <div class="gs-header-right">
          ${region('header-agent', focused, 'gs-agent-picker', `${label('Agent', 'gs-dim')}${label('Claude Code')}${icon(ChevronDown, 10)}`)}
          ${region('header-start', focused, 'gs-start', `${icon(Play, 10)}${label('Start')}`)}
          ${region('header-theme', focused, 'gs-icon-btn', icon(Sun, 12))}
        </div>
      </div>`;

    const rail = `
      <div class="gs-rail">
        ${region('rail-views', focused, 'gs-rail-group', `
          <span class="gs-rail-icon gs-rail-active">${icon(Package, 12)}</span>
          <span class="gs-rail-icon">${icon(Files, 12)}</span>
          <span class="gs-rail-icon">${icon(FilePlus2, 12)}</span>
          <span class="gs-rail-icon">${icon(Github, 12)}</span>`)}
        <div class="gs-rail-spacer"></div>
        ${region('rail-foot', focused, 'gs-rail-group', `
          ${railBtn(Plug, 'rail-plugins')}
          ${railBtn(MessageSquarePlus, 'rail-feedback')}
          ${railBtn(Settings, 'rail-settings')}
          ${railBtn(CircleHelp, 'rail-guide')}`)}
      </div>`;

    const sidebar = region('sidebar-nav', focused, 'gs-sidebar', `
      ${region('sidebar-switcher', focused, 'gs-switcher', `${label('my-project')}${icon(ChevronDown, 10)}`)}
      <div class="gs-nav-group">${label('WORK', 'gs-eyebrow')}</div>
      ${navRow('Terminals')}
      <div class="gs-nav-group">${label('CONTEXT', 'gs-eyebrow')}</div>
      ${navRow('Specs')}
      ${navRow('Tasks')}
      ${navRow('Sessions')}
      <div class="gs-nav-foot">${navRow('Project Settings')}</div>`);

    const center = region('center', focused, 'gs-center', `
      <div class="gs-grid gs-grid-2">
        <div class="gs-pane">${terminalLines('claude', [66, 44, 58])}</div>
        <div class="gs-pane">${terminalLines('npm test', [52, 70])}</div>
      </div>`);

    const dock = region('dock', focused, 'gs-dock', `
      <div class="gs-dock-tabs">${label('Project Notes', 'gs-tab gs-tab-active')}${label('Prompts', 'gs-tab')}${label('Activity', 'gs-tab')}</div>
      <div class="gs-dock-body">${bar(64)}${bar(48)}</div>`);

    const status = `
      <div class="gs-status">
        ${region('statusbar-left', focused, 'gs-status-left', `${icon(GitBranch, 10)}${label('main')}<span class="gs-status-sep"></span>${icon(Bot, 10)}${chip('1 waiting', { dot: 'warn', cls: 'gs-chip-tiny' })}`)}
        ${region('statusbar-right', focused, 'gs-status-right', `${label('Session', 'gs-dim')}<span class="gs-meter"><span style="width:38%"></span></span>${label('Weekly', 'gs-dim')}<span class="gs-meter"><span style="width:61%"></span></span>`)}
      </div>`;

    return frame('shell', focused, `
      ${header}
      <div class="gs-shell-body">
        ${rail}
        ${sidebar}
        <div class="gs-shell-main">${center}${dock}</div>
      </div>
      ${status}`);
  },

  /**
   * What Initialize writes. Rows carry tags; a row is focused when any of its
   * tags is. Tags: frame (everything under .frame/), context (the files an
   * agent reads), pointer (.claude/rules/frame.md), hooks, yours (files Frame
   * never touches).
   */
  fileTree(focused) {
    const rows = [
      { depth: 0, dir: true, name: 'my-project/', tags: [] },
      { depth: 1, dir: true, name: '.frame/', tags: ['frame'], note: 'everything Frame writes' },
      { depth: 2, name: 'AGENTS.md', tags: ['frame', 'context'], note: 'rules for agents' },
      { depth: 2, name: 'PROJECT_NOTES.md', tags: ['frame', 'context'], note: 'decisions' },
      { depth: 2, name: 'tasks.json', tags: ['frame', 'context'], note: 'tasks' },
      { depth: 2, dir: true, name: 'specs/', tags: ['frame', 'context'], note: 'spec archive' },
      { depth: 2, dir: true, name: 'docs/ · bin/', tags: ['frame'] },
      { depth: 1, dir: true, name: '.claude/', tags: [] },
      { depth: 2, name: 'rules/frame.md', tags: ['pointer'], note: 'copy of AGENTS.md' },
      { depth: 2, name: 'settings.json', tags: ['hooks'], note: 'hook entries' },
      { depth: 1, name: 'CLAUDE.md', tags: ['yours'], note: 'yours — untouched' },
      { depth: 1, dir: true, name: 'src/', tags: ['yours'] }
    ];
    const body = rows.map((r) => {
      const on = r.tags.some((t) => focused.has(t));
      const inner = `<span class="gs-tree-indent" style="width:${r.depth * 14}px"></span>${icon(r.dir ? Folder : File, 11)}${label(r.name)}${r.note ? label(r.note, 'gs-tree-note') : ''}`;
      return `<div class="gs-region gs-tree-row${on ? ' gs-focus' : ''}">${inner}</div>`;
    }).join('');
    return frame('fileTree', focused, `<div class="gs-tree">${body}</div>`);
  },

  /** The git-sharing choice at Initialize. Regions: repo, local. */
  gitSharing(focused) {
    const card = (name, icn, title, lines, chosen) => region(name, focused, 'gs-choice', `
      <div class="gs-choice-head"><span class="gs-radio${chosen ? ' gs-radio-on' : ''}"></span>${icon(icn, 12)}${label(title, 'gs-strong')}</div>
      ${lines.map((l) => `<div class="gs-choice-line">${l}</div>`).join('')}`);
    return frame('gitSharing', focused, `
      <div class="gs-choice-q">${label('How should Frame’s files relate to git?')}</div>
      <div class="gs-grid gs-grid-2">
        ${card('repo', Users, 'Share with the repo', [
          `${chip('.frame/')} ${label('committed', 'gs-dim')}`,
          `${label('teammates get the same context', 'gs-dim')}`
        ], true)}
        ${card('local', Lock, 'Keep it local to me', [
          `${chip('.git/info/exclude')}`,
          `${label('git status shows nothing Frame made', 'gs-dim')}`
        ], false)}
      </div>`);
  },

  /** The two settings surfaces. Regions: project, frame. */
  settings(focused) {
    const panel = (name, title, sections) => region(name, focused, 'gs-set-panel', `
      <div class="gs-set-title">${label(title, 'gs-strong')}<span class="gs-x">×</span></div>
      ${sections.map(([heading, rows]) => `<div class="gs-set-section">${label(heading, 'gs-eyebrow')}${rows.join('')}</div>`).join('')}`);
    return frame('settings', focused, `
      <div class="gs-grid gs-grid-2">
        ${panel('project', 'Project Settings', [
          ['WORKFLOW', [
            settingRow('Spec-Driven Development', toggle(true)),
            settingRow('Git sharing', select('Share with the repo')),
            settingRow('Open this project on launch', chip('Make Default', { cls: 'gs-chip-tiny' })),
            settingRow('Remove Frame from this project', chip('Remove', { cls: 'gs-chip-tiny' }))
          ]],
          ['BOARDS', [settingRow('Completed tasks shown', select('Last 7 days'))]]
        ])}
        ${panel('frame', 'Frame Settings', [
          ['APPEARANCE', [settingRow('Interface size', select('100%'))]],
          ['PRIVACY & ANALYTICS', [
            settingRow('Send anonymous usage stats', toggle(true)),
            settingRow('Keep local crash dumps', toggle(true))
          ]],
          ['ABOUT', [settingRow('Frame', chip('Check for Updates', { cls: 'gs-chip-tiny' }))]]
        ])}
      </div>`);
  },

  /**
   * The Terminals view. Regions: chips (top bar), columns, panes, ghost,
   * prompt (the first pane, shown mid-conversation).
   */
  terminalGrid(focused) {
    const talking = focused.has('prompt');
    const pane = (name, prompt, widths, extra = '') => `
      <div class="gs-pane gs-tv-pane">
        <div class="gs-tv-pane-head">${label(name)}${icon(Maximize2, 9)}</div>
        ${terminalLines(prompt, widths)}${extra}
      </div>`;
    const first = talking
      ? region('prompt', focused, 'gs-pane gs-tv-pane', `
          <div class="gs-tv-pane-head">${label('Terminal 1 · Claude Code')}${icon(Maximize2, 9)}</div>
          <div class="gs-term-lines">
            <div class="gs-term-out">${bar(62)}</div>
            <div class="gs-term-prompt"><span class="gs-term-caret">&gt;</span>add a retry to the upload client<span class="gs-cursor"></span></div>
            <div>${chip('/review')} ${chip('/model')} ${chip('/help')}</div>
          </div>`)
      : pane('Terminal 1 · Claude Code', 'claude', [66, 40]);
    return frame('terminalGrid', focused, `
      <div class="gs-tv-bar">
        ${region('chips', focused, 'gs-tv-chips', `${label('Home', 'gs-tab')}${label('Terminals', 'gs-tab gs-tab-active')}${chip('Terminal 1')}${chip('Terminal 2')}`)}
        ${region('columns', focused, 'gs-tv-cols', `${label('1', 'gs-col-btn')}${label('2', 'gs-col-btn')}${label('3', 'gs-col-btn gs-col-on')}`)}
      </div>
      ${region('panes', focused, 'gs-grid gs-grid-3 gs-tv-grid', `
        ${first}
        ${pane('Terminal 2', 'npm run dev', [48, 70])}
        ${region('ghost', focused, 'gs-tv-ghost', `${icon(Plus, 14)}${label('New terminal')}`)}`)}`);
  },

  /** Lane states. Regions: working, approval, input, rail. */
  laneStates(focused) {
    const tile = (name, title, state, dot, mark) => region(name, focused, 'gs-lane', `
      <div class="gs-lane-head">${icon(Bot, 11)}${label(title, 'gs-strong')}${mark ? `<span class="gs-mark-badge gs-mark-${dot}">${mark}</span>` : ''}</div>
      ${terminalLines('', [70, 52])}
      ${chip(state, { dot })}`);
    return frame('laneStates', focused, `
      <div class="gs-lanes">
        ${tile('working', 'Terminal 1', 'Agent working', 'accent')}
        ${tile('approval', 'Terminal 2', 'Needs approval', 'err', '!')}
        ${tile('input', 'Terminal 3', 'Awaiting input', 'warn', '•')}
        ${region('rail', focused, 'gs-lane-rail', `
          ${label('OTHER TERMINALS', 'gs-eyebrow')}
          <div class="gs-rail-row">${chip('Terminal 2', { dot: 'err' })}</div>
          <div class="gs-rail-row">${chip('Terminal 3', { dot: 'warn' })}</div>
          <div class="gs-rail-row">${chip('Terminal 1', { dot: 'accent' })}</div>
          <div class="gs-rail-row">${chip('Terminal 4')}</div>`)}
      </div>`);
  },

  /** Home. Regions: launcher, terminals, sessions, specs, tasks. */
  home(focused) {
    const card = (name, icn, title, rows) => region(name, focused, 'gs-home-card', `
      <div class="gs-home-card-head">${icon(icn, 10)}${label(title, 'gs-strong')}</div>
      ${rows.map((r) => `<div class="gs-home-row">${r}</div>`).join('')}`);
    return frame('home', focused, `
      <div class="gs-home-title">${label('Welcome to Frame!', 'gs-strong')}${label('my-project · main', 'gs-dim')}</div>
      ${region('terminals', focused, 'gs-home-top', `
        <div class="gs-home-card-head">${icon(SquareTerminal, 10)}${label('Terminals', 'gs-strong')}</div>
        <div class="gs-home-top-body">
          ${region('launcher', focused, 'gs-home-launcher', `
            ${label('Start an agent', 'gs-strong')}
            <div class="gs-home-launch-row">${select('Claude Code')}<span class="gs-start">${icon(Play, 9)}${label('Start')}</span></div>`)}
          <div class="gs-home-tiles">
            <div class="gs-home-tile">${label('Terminal 2')}${chip('Needs approval', { dot: 'err', cls: 'gs-chip-tiny' })}</div>
            <div class="gs-home-tile">${label('Terminal 1')}${chip('Working', { dot: 'accent', cls: 'gs-chip-tiny' })}</div>
          </div>
        </div>`)}
      <div class="gs-grid gs-grid-3 gs-home-bottom">
        ${card('sessions', History, 'Last Sessions', [bar(70), bar(55), bar(62)])}
        ${card('specs', FileText, 'Active Specs', [`${bar(50)} ${chip('planned', { cls: 'gs-chip-tiny' })}`, `${bar(40)} ${chip('2/7', { cls: 'gs-chip-tiny' })}`])}
        ${card('tasks', ListChecks, 'Active Tasks', [bar(66), bar(48), bar(58)])}
      </div>`);
  },
  /**
   * The spec flow. Regions: spec, plan, tasks, implement, done; gate marks
   * the steps Orchestration can take a spec from.
   */
  specFlow(focused) {
    const steps = [
      ['spec', 'Spec', 'spec.md', 'Write the Spec'],
      ['plan', 'Plan', 'plan.md', 'Generate Plan'],
      ['tasks', 'Tasks', 'tasks.md', 'Break into Tasks'],
      ['implement', 'Implement', 'outcome.md', 'Implement Tasks…'],
      ['done', 'Done', 'digest.md', '']
    ];
    const nodes = steps.map(([name, title, file, action], i) => `
      ${i ? '<span class="gs-flow-arrow" aria-hidden="true"></span>' : ''}
      ${region(name, focused, 'gs-flow-step', `
        <div class="gs-flow-num">${i + 1}</div>
        ${label(title, 'gs-strong')}
        ${chip(file)}
        ${action ? `<span class="gs-flow-action">${escapeHtml(action)}</span>` : `<span class="gs-flow-action gs-flow-done">${icon(Check, 10)}</span>`}`)}`).join('');
    const gate = focused.has('gate')
      ? `<div class="gs-flow-gate">${region('gate', focused, 'gs-flow-gate-bar', `${icon(Workflow, 10)}${label('assignable to Orchestration')}`)}</div>`
      : '';
    return frame('specFlow', focused, `
      <div class="gs-flow">${nodes}</div>
      ${gate}
      <div class="gs-flow-folder">${icon(Folder, 10)}${label('.frame/specs/add-retry-to-uploads/', 'gs-dim')}</div>`);
  },

  /** The Implement Tasks… choice. Regions: step, guided, autonomous, custom. */
  implementModes(focused) {
    const mode = (name, title, line, chosen) => region(name, focused, 'gs-choice gs-mode', `
      <div class="gs-choice-head"><span class="gs-radio${chosen ? ' gs-radio-on' : ''}"></span>${label(title, 'gs-strong')}</div>
      <div class="gs-choice-line">${label(line, 'gs-dim')}</div>`);
    return frame('implementModes', focused, `
      <div class="gs-choice-q">${label('Implement Tasks…')}${chip('3 / 7 done', { cls: 'gs-chip-tiny' })}</div>
      <div class="gs-grid gs-grid-2 gs-modes">
        ${mode('step', 'Step by step', 'one task, then your go-ahead', true)}
        ${mode('guided', 'Guided run', 'every task, CLI prompts pace it')}
        ${mode('autonomous', 'Autonomous + report', 'unattended, one commit each')}
        ${mode('custom', 'Describe your own', 'your cadence, your rules')}
      </div>`);
  },

  /** Specs and Tasks dashboards. Regions: specs, tasks. */
  boards(focused) {
    const specCard = (phase, dot, n) => `
      <div class="gs-board-card">${bar(n)}<div>${chip(phase, { dot, cls: 'gs-chip-tiny' })}</div></div>`;
    const col = (title, cards) => `<div class="gs-board-col">${label(title, 'gs-eyebrow')}${cards.map((w) => `<div class="gs-board-card">${bar(w)}</div>`).join('')}</div>`;
    return frame('boards', focused, `
      <div class="gs-grid gs-grid-2">
        ${region('specs', focused, 'gs-board', `
          <div class="gs-board-head">${icon(FileText, 10)}${label('Specs Dashboard', 'gs-strong')}${icon(Search, 10)}</div>
          <div class="gs-board-filters">${label('All', 'gs-tab gs-tab-active')}${label('Specified', 'gs-tab')}${label('Planned', 'gs-tab')}${label('Implementing', 'gs-tab')}</div>
          <div class="gs-grid gs-grid-2">
            ${specCard('specified', 'warn', 62)}${specCard('planned', 'accent', 48)}
            ${specCard('implementing', 'ok', 70)}${specCard('done', '', 54)}
          </div>`)}
        ${region('tasks', focused, 'gs-board', `
          <div class="gs-board-head">${icon(ListChecks, 10)}${label('Tasks Dashboard', 'gs-strong')}</div>
          <div class="gs-grid gs-grid-3">
            ${col('PENDING', [60, 44, 52])}${col('IN PROGRESS', [56])}${col('DONE', [48, 62])}
          </div>`)}
      </div>`);
  },

  /**
   * The orchestrator. Regions: conductor, workers, specs, pipeline, main.
   */
  orchestrator(focused) {
    const STAGES = ['Queued', 'Running', 'Done', 'Approved'];
    const worker = (slug, stage) => `
      <div class="gs-worker">
        <div class="gs-worker-head">${icon(Bot, 10)}${label(slug)}</div>
        <div class="gs-worker-branch">${icon(GitBranch, 9)}${label(`frame/${slug}/work`, 'gs-dim')}</div>
        ${region('pipeline', focused, 'gs-pipeline', STAGES.map((st, k) => `<span class="gs-pipe-step${st === stage ? ' gs-pipe-on' : ''}${k < STAGES.indexOf(stage) ? ' gs-pipe-past' : ''}">${escapeHtml(st)}</span>`).join(''))}
      </div>`;
    const specRow = (title, assigned) => `<div class="gs-orch-spec">${label(title)}${chip(assigned ? 'Assigned' : 'Assign', { cls: `gs-chip-tiny${assigned ? '' : ' gs-chip-cta'}` })}</div>`;
    return frame('orchestrator', focused, `
      <div class="gs-orch">
        <div class="gs-orch-left">
          ${region('conductor', focused, 'gs-orch-conductor', `
            <div class="gs-tv-pane-head">${label('Conductor')}${chip('Beta', { cls: 'gs-chip-tiny' })}</div>
            ${terminalLines('reads CONDUCTOR.md', [60, 44])}`)}
          ${region('workers', focused, 'gs-orch-workers', `
            ${worker('add-retry', 'Running')}
            ${worker('dark-mode', 'Done')}`)}
        </div>
        <div class="gs-orch-right">
          ${region('specs', focused, 'gs-orch-specs', `
            ${label('SPECS', 'gs-eyebrow')}
            ${specRow('add-retry', true)}
            ${specRow('dark-mode', true)}
            ${specRow('export-csv', false)}`)}
          ${region('main', focused, 'gs-orch-main', `${icon(Lock, 10)}${label('main — never touched', 'gs-dim')}`)}
        </div>
      </div>`);
  },
  /** The Sessions list. Regions: list, resume. */
  sessions(focused) {
    const row = (title, when, first) => `
      <div class="gs-session">
        <div class="gs-session-text">${label(title)}${label(when, 'gs-dim')}</div>
        ${first ? region('resume', focused, 'gs-session-resume', `${icon(RotateCcw, 9)}${label('Resume')}`) : `<span class="gs-session-resume gs-session-resume-quiet">${icon(RotateCcw, 9)}${label('Resume')}</span>`}
      </div>`;
    return frame('sessions', focused, `
      <div class="gs-grid gs-sessions-grid">
        ${region('list', focused, 'gs-sessions-list', `
          <div class="gs-board-head">${icon(History, 10)}${label('Sessions', 'gs-strong')}${chip('24', { cls: 'gs-chip-tiny' })}</div>
          ${row('add a retry to the upload client', '12 min ago', true)}
          ${row('why does the export test flake?', 'yesterday')}
          ${row('plan the dark mode spec', '2 days ago')}
          ${row('rename the session helper', 'last week')}`)}
        <div class="gs-sessions-term gs-pane">
          <div class="gs-tv-pane-head">${label('New terminal')}</div>
          ${terminalLines('claude --resume 3f9c…', [66, 50, 58])}
        </div>
      </div>`);
  },

  /** The dock. Regions: decisions, prompts, activity (a tab each, with its body). */
  dockTabs(focused) {
    const active = ['decisions', 'prompts', 'activity'].find((t) => focused.has(t)) || 'decisions';
    const tab = (name, title) => `<span class="gs-dock-tab${name === active ? ' gs-dock-tab-on' : ''}">${escapeHtml(title)}</span>`;
    const bodies = {
      decisions: `
        <div class="gs-dock-search">${icon(Search, 9)}${label('Search decisions', 'gs-dim')}</div>
        <div class="gs-dock-row">${label('2026-09-14', 'gs-dim')}${label('Uploads retry with backoff, not a queue')}</div>
        <div class="gs-dock-row gs-dock-row-open">${label('2026-09-10', 'gs-dim')}${label('Settings split by scope')}<div class="gs-dock-row-body">${bar(88)}${bar(72)}</div></div>
        <div class="gs-dock-row">${label('2026-09-02', 'gs-dim')}${label('Tasks keep their status across re-imports')}</div>`,
      prompts: `
        <div class="gs-dock-search">${icon(Search, 9)}${label('Search prompts', 'gs-dim')}</div>
        <div class="gs-dock-row">${label('14:02', 'gs-dim')}${label('add a retry to the upload client')}</div>
        <div class="gs-dock-row">${label('13:40', 'gs-dim')}${label('run the tests and fix what fails')}</div>
        <div class="gs-dock-row">${label('11:15', 'gs-dim')}${label('explain how sessions are loaded')}</div>`,
      activity: `
        <div class="gs-dock-row">${chip('tasks', { cls: 'gs-chip-tiny' })}${label('tasks.json synced from specs/add-retry')}</div>
        <div class="gs-dock-row">${chip('hooks', { cls: 'gs-chip-tiny' })}${label('spec history shown before an edit')}</div>
        <div class="gs-dock-row gs-dock-row-muted">${chip('watchers', { cls: 'gs-chip-tiny' })}${label('skipped: Frame’s own write')}</div>`
    };
    return frame('dockTabs', focused, `
      ${region(active, focused, 'gs-dock-panel', `
        <div class="gs-dock-head">
          <div class="gs-dock-tabrow">${tab('decisions', 'Project Notes')}${tab('prompts', 'Prompts')}${tab('activity', 'Activity')}</div>
          <div class="gs-dock-tools">${icon(PanelRight, 10)}${icon(X, 10)}</div>
        </div>
        <div class="gs-dock-list">${bodies[active]}</div>`)}`);
  },

  /** Several projects. Regions: switcher (sidebar + its menu), others (status bar popover). */
  multiProject(focused) {
    const proj = (name, badge, current) => `<div class="gs-proj-row${current ? ' gs-proj-current' : ''}">${icon(Folder, 10)}${label(name)}${badge || ''}</div>`;
    const agentRow = (name, state, dot) => `<div class="gs-proj-row">${icon(Bot, 10)}${label(name)}${chip(state, { dot, cls: 'gs-chip-tiny' })}</div>`;
    return frame('multiProject', focused, `
      <div class="gs-multi">
        ${region('switcher', focused, 'gs-multi-switcher', `
          <div class="gs-switcher gs-switcher-open">${label('web-app')}${icon(ChevronDown, 10)}</div>
          <div class="gs-proj-menu">
            ${proj('web-app', '', true)}
            ${proj('api-server', chip('needs approval', { dot: 'err', cls: 'gs-chip-tiny' }))}
            ${proj('docs-site')}
            <div class="gs-proj-row gs-dim">${label('+ Add a project…')}</div>
          </div>`)}
        <div class="gs-multi-bottom">
          ${region('others', focused, 'gs-multi-others', `
            <div class="gs-proj-pop">
              ${label('AGENTS IN OTHER PROJECTS', 'gs-eyebrow')}
              ${label('api-server', 'gs-dim')}
              ${agentRow('Terminal 2', 'needs approval', 'err')}
              ${label('docs-site', 'gs-dim')}
              ${agentRow('Terminal 1', 'working', 'accent')}
            </div>
            <div class="gs-status gs-multi-status">${icon(GitBranch, 10)}${label('main')}<span class="gs-status-sep"></span>${icon(Bot, 10)}${chip('1 waiting', { dot: 'err', cls: 'gs-chip-tiny' })}</div>`)}
        </div>
      </div>`);
  },
  /** The Plugins modal. Regions: filters, install, toggle. */
  plugins(focused) {
    const row = (name, desc, status, control) => `
      <div class="gs-plugin">
        <span class="gs-plugin-icon">${icon(Plug, 11)}</span>
        <div class="gs-plugin-text">
          <div class="gs-plugin-name">${label(name, 'gs-strong')}${chip(status, { cls: 'gs-chip-tiny' })}</div>
          ${label(desc, 'gs-dim')}
        </div>
        ${control}
      </div>`;
    return frame('plugins', focused, `
      <div class="gs-set-panel gs-plugins-panel">
        <div class="gs-set-title">${label('Plugins', 'gs-strong')}<span class="gs-x">×</span></div>
        ${region('filters', focused, 'gs-board-filters', `${label('All', 'gs-tab gs-tab-active')}${label('Installed', 'gs-tab')}${label('Enabled', 'gs-tab')}`)}
        ${row('frontend-design', 'skill · distinctive UI work', 'Enabled', region('toggle', focused, 'gs-plugin-ctl', toggle(true)))}
        ${row('code-review', 'commands · review a diff', 'Installed', region('toggle', focused, 'gs-plugin-ctl', toggle(false)))}
        ${row('pr-helper', 'agent · draft pull requests', 'Available', region('install', focused, 'gs-plugin-ctl', chip('Install', { cls: 'gs-chip-cta' })))}
      </div>
      <div class="gs-agents-arrow gs-plugins-arrow" aria-hidden="true"><span></span></div>
      <div class="gs-pane gs-plugins-term">
        <div class="gs-tv-pane-head">${label('Terminal 1 · Claude Code')}</div>
        <div class="gs-term-prompt"><span class="gs-term-caret">&gt;</span>/plugin install pr-helper</div>
        ${terminalLines('', [58, 40])}
      </div>`);
  },

  /**
   * The four themes as swatches. Tokens cannot draw them — they only hold the
   * current theme — so each swatch takes its terminal colours from the theme
   * registry, and its accent from the scheme (Frame keeps its green in both
   * families; the values mirror variables.css).
   */
  themes(focused) {
    const ACCENT = { dark: '#8ff0ae', light: '#38946e' };
    const current = document.documentElement.getAttribute('data-theme');
    const swatch = (id) => {
      const t = themes.THEMES[id];
      const bg = t.terminal.background;
      const fg = t.terminal.foreground;
      const accent = ACCENT[t.scheme];
      const on = themes.normalize(current) === id;
      return region(id, focused, `gs-swatch${on ? ' gs-swatch-on' : ''}`, `
        <div class="gs-swatch-screen" style="background:${bg};color:${fg};border-color:${t.scheme === 'dark' ? '#3a342b' : 'rgba(0,0,0,0.12)'}">
          <div class="gs-swatch-line"><span style="color:${accent}">$</span> claude</div>
          <span class="gs-swatch-bar" style="background:${fg};width:70%"></span>
          <span class="gs-swatch-bar" style="background:${fg};width:48%"></span>
          <span class="gs-swatch-btn" style="background:${accent}"></span>
        </div>
        <div class="gs-swatch-label">${label(t.label, 'gs-strong')}${on ? label('current', 'gs-dim') : ''}</div>`);
    };
    return frame('themes', focused, `<div class="gs-grid gs-swatches">${themes.THEME_IDS.map(swatch).join('')}</div>`);
  },

  /** The five interface sizes. Regions: ladder, settings, readout. */
  zoom(focused) {
    const steps = uiZoom.STEPS.map((step) => {
      const pct = uiZoom.percentFor(step);
      const on = step === uiZoom.DEFAULT_STEP;
      return `<div class="gs-zoom-step${on ? ' gs-zoom-on' : ''}">
          <span class="gs-zoom-a" style="font-size:${Math.round(9 * uiZoom.factorFor(step) * 1.25)}px">Aa</span>
          ${label(`${pct}%`)}
          ${label(uiZoom.labelFor(step), 'gs-dim')}
        </div>`;
    }).join('');
    return frame('zoom', focused, `
      ${region('ladder', focused, 'gs-zoom-ladder', `${icon(ZoomOut, 12)}${steps}${icon(ZoomIn, 12)}`)}
      <div class="gs-grid gs-grid-2 gs-zoom-bottom">
        ${region('settings', focused, 'gs-set-panel', `
          ${label('APPEARANCE', 'gs-eyebrow')}
          ${settingRow('Interface size', select('Default'))}`)}
        ${region('readout', focused, 'gs-status gs-zoom-status', `${label('Session', 'gs-dim')}<span class="gs-meter"><span style="width:38%"></span></span><span class="gs-status-sep"></span>${chip('110%', { cls: 'gs-chip-tiny' })}`)}
      </div>`);
  },

  /** The Command Palette. Regions: palette, shortcuts. Shortcuts come from the registry. */
  keys(focused) {
    const kbd = (id) => {
      const cmd = commandRegistry.getById(id);
      return cmd && cmd.shortcut ? `<span class="gs-kbd">${escapeHtml(formatShortcut(cmd.shortcut))}</span>` : '';
    };
    const row = (title, category, id, on) => `<div class="gs-pal-row${on ? ' gs-pal-on' : ''}">${label(title)}${label(category, 'gs-dim')}${kbd(id)}</div>`;
    return frame('keys', focused, `
      <div class="gs-grid gs-keys-grid">
        ${region('palette', focused, 'gs-palette', `
          <div class="gs-pal-input">${icon(Command, 10)}${label('panel')}<span class="gs-cursor"></span></div>
          ${row('Toggle Panel', 'View', 'dock.toggle', true)}
          ${row('Toggle Sidebar (Projects & Files)', 'Panel', 'panel.toggleSidebar')}
          ${row('Toggle Specs Dashboard', 'Panel', 'panel.toggleSpecsDashboard')}
          ${row('Move Panel Right', 'View', 'dock.moveRight')}`)}
        ${region('shortcuts', focused, 'gs-set-panel gs-shortcuts', `
          <div class="gs-board-head">${icon(Keyboard, 10)}${label('Keyboard Shortcuts', 'gs-strong')}</div>
          ${label('TERMINALS', 'gs-eyebrow')}
          <div class="gs-set-row">${label('New Terminal')}${kbd('terminal.new')}</div>
          <div class="gs-set-row">${label('Go to Home')}${kbd('lane.home')}</div>
          ${label('VIEW', 'gs-eyebrow')}
          <div class="gs-set-row">${label('Toggle Project Notes')}${kbd('dock.decisions')}</div>`)}
      </div>`);
  },

  /** Send Feedback's three kinds. Regions: bug, idea, reach. */
  feedback(focused) {
    const card = (name, icn, title, line, where) => region(name, focused, 'gs-choice gs-feedback', `
      <div class="gs-choice-head">${icon(icn, 13)}${label(title, 'gs-strong')}</div>
      <div class="gs-feedback-line">${label(line, 'gs-dim')}</div>
      ${chip(where, { cls: 'gs-chip-tiny' })}`);
    return frame('feedback', focused, `
      <div class="gs-grid gs-grid-3">
        ${card('bug', Bug, 'Bug', 'something broke', 'GitHub issue draft')}
        ${card('idea', Lightbulb, 'Feature idea', 'something to add', 'GitHub discussion draft')}
        ${card('reach', Mail, 'Reach us', 'a question, a thought', 'email draft')}
      </div>
      <div class="gs-feedback-note">${label('You read every draft and send it yourself.', 'gs-dim')}</div>`);
  }
};

/**
 * @param {string} kind — one of guideContent.SKETCH_KINDS
 * @param {string|string[]} [focus]
 * @returns {string|null} HTML, or null when this file does not draw `kind`
 */
function render(kind, focus) {
  const draw = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  if (!draw) return null;
  return draw(focusSet(focus));
}

/** The kinds drawn here — the host compares against guideContent.SKETCH_KINDS. */
const DRAWN_KINDS = Object.freeze(Object.keys(KINDS));

module.exports = { render, DRAWN_KINDS };
