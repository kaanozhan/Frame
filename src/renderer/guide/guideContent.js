/**
 * How to Use Frame — the guide's content (how-to-use-frame-guide spec).
 *
 * Pure data plus the helpers that read it: no electron, no DOM, no lucide at
 * require time, so `npm test` loads it in CI without `npm ci` (the Testing
 * record's convention — test the pure module, not its DOM host). The modal
 * (guideModal.js) renders it; the illustrations (guide/guideSketches.js)
 * draw each page's `sketch`.
 *
 * Shape:
 *   CHAPTERS → [{ id, title, pages }]
 *   page     → { id, title, sketch: { kind, focus? }, claudeOnly?, blocks, actions? }
 *   block    → exactly one of { p } | { list: [..] } | { code } | { note }
 *   action   → { id, label, stay? }
 *
 * Text is plain — never HTML. Two inline tokens are expanded by the host
 * after escaping:
 *   {kbd:<commandId>}  the command's current shortcut, read from the command
 *                      registry and formatted for the platform, so a page can
 *                      never quote a shortcut the app no longer has
 *   `code`             a path, a file name or a literal command
 *
 * Every command a page cites — as an action or a {kbd:} token — must be in
 * ACTION_IDS; `stay` (run without closing the guide) only on STAY_IDS, the
 * commands whose effect is visible in the guide itself. validate() checks
 * all of it and the test pins it.
 */

/** The sketch kinds guideSketches.render() draws. */
const SKETCH_KINDS = Object.freeze([
  'agents', 'shell', 'fileTree', 'gitSharing', 'settings', 'terminalGrid',
  'laneStates', 'home', 'specFlow', 'implementModes', 'boards', 'orchestrator',
  'sessions', 'dockTabs', 'multiProject', 'plugins', 'themes', 'zoom', 'keys',
  'feedback'
]);

/** Theme and zoom commands change what the guide itself looks like, so their
 *  links apply in place instead of closing the guide (plan D7). */
const STAY_IDS = Object.freeze([
  'theme.dark', 'theme.light', 'theme.darkPlus', 'theme.lightPlus',
  'view.zoomIn', 'view.zoomOut', 'view.zoomReset'
]);

/** Every command-registry id the guide may cite. */
const ACTION_IDS = Object.freeze([
  // Projects
  'project.add', 'project.create', 'project.initializeFrame',
  'project.next', 'project.prev',
  // Settings and help
  'settings.open', 'settings.openProject', 'help.shortcuts', 'help.welcome',
  'help.guide', 'feedback.open', 'plugins.open',
  // Layout and views
  'panel.toggleSidebar', 'sidebar.github', 'lane.home',
  'panel.toggleSpecsDashboard', 'panel.toggleTasksDashboard',
  'panel.toggleSessions', 'orchestrator.open',
  'dock.toggle', 'dock.decisions', 'dock.prompts', 'dock.activity',
  // Terminals and agents
  'terminal.new', 'terminal.close', 'terminal.next', 'ai.startSession',
  // Palette
  'palette.toggle', 'palette.open',
  // Look
  ...STAY_IDS
]);

const BLOCK_KEYS = Object.freeze(['p', 'list', 'code', 'note']);

const CHAPTERS = [
  {
    id: 'start',
    title: 'Start here',
    pages: [
      {
        id: 'start.what',
        title: 'What Frame is',
        sketch: { kind: 'agents' },
        blocks: [
          { p: 'Frame is a terminal-first IDE for working with AI coding agents. The agent is a command-line tool you already use — Claude Code or Codex CLI — and Frame runs it in real terminals, next to your project.' },
          { p: 'You bring your own agent. Sign in to the CLI with your own subscription or API key, the way you would in any terminal. Frame never calls a model itself and never sees your credentials.' },
          { p: 'What Frame adds around the agent:' },
          { list: [
            'Project context that survives sessions — decisions, tasks and a spec archive the agent reads at the start of every session.',
            'A spec-driven workflow: describe the work, plan it, break it into tasks, implement it.',
            'Visibility across every terminal and every project — which agent is working, which one is waiting for you.'
          ] },
          { note: 'This guide walks through Frame step by step. Use the index on the left to jump, or Next to read it in order.' }
        ]
      },
      {
        id: 'start.agent',
        title: 'Pick your agent',
        sketch: { kind: 'shell', focus: 'header-agent' },
        blocks: [
          { p: 'Frame works with two agent CLIs: Claude Code and Codex CLI. Install the one you use and sign in to it once in a terminal before starting it from Frame.' },
          { p: 'On first run Frame picks the first of them it finds installed. Change it any time with the Agent picker in the header — Start launches whichever agent is selected there. The agent\'s own menu in the menu bar has the same switch under Switch AI Tool.' },
          { note: 'A few features are built on Claude Code\'s own data and work only with it: Sessions, Plugins and the usage meters in the status bar.' }
        ]
      },
      {
        id: 'start.open',
        title: 'Open a project',
        sketch: { kind: 'shell', focus: 'sidebar-switcher' },
        blocks: [
          { p: 'Everything in Frame happens inside a project. There are four ways in:' },
          { list: [
            'Open a folder already on your machine — any language, any layout.',
            'Create a new, empty project.',
            'Clone a repository from GitHub by its URL.',
            'Try the sample project — a small fictional codebase with specs, tasks and notes already filled in.'
          ] },
          { p: 'The project switcher at the top of the sidebar shows the current project; its menu lists your other projects and ends with “+ Add a project…”. The Welcome screen that greets you when Frame starts has all four too.' }
        ],
        actions: [
          { id: 'project.add', label: 'Add a project' },
          { id: 'project.create', label: 'Create a new project' }
        ]
      }
    ]
  },
  {
    id: 'projects',
    title: 'Projects',
    pages: [
      {
        id: 'projects.init',
        title: 'Initialize a project',
        sketch: { kind: 'fileTree', focus: 'frame,pointer' },
        blocks: [
          { p: 'When you open a folder Frame has not set up yet, it offers to initialize it. Initializing writes Frame\'s context files so every agent session starts oriented — and everything Frame writes lives in one folder, `.frame/`:' },
          { list: [
            '`AGENTS.md` — the project\'s always-on rules for agents, with the details in `docs/REFERENCE.md`.',
            '`PROJECT_NOTES.md` — decisions and the context behind them.',
            '`tasks.json` and `specs/` — tracked work and the spec archive.',
            '`bin/` — the small scripts the hooks run.'
          ] },
          { p: 'Outside `.frame/` there is one pointer, `.claude/rules/frame.md`, a copy of `AGENTS.md` that Claude Code loads by itself. For Claude Code, Frame also adds hook entries to `.claude/settings.json` (or `settings.local.json`), and a git pre-commit hook if the project has none.' },
          { note: 'Nothing is added to the project root, and no existing file is read, moved or replaced — your own CLAUDE.md or AGENTS.md stays yours. Project Settings can remove Frame again.' }
        ],
        actions: [
          { id: 'project.initializeFrame', label: 'Initialize this project' }
        ]
      },
      {
        id: 'projects.git',
        title: 'Git sharing',
        sketch: { kind: 'gitSharing' },
        blocks: [
          { p: 'Initialize asks how Frame\'s files relate to git:' },
          { list: [
            'Share with the repo — commit `.frame/` so teammates get the same context. Machine-local files are ignored by `.frame/.gitignore`.',
            'Keep it local to me — Frame excludes its files through `.git/info/exclude`, so `git status` shows nothing Frame made.'
          ] },
          { p: 'Either way Frame never edits your tracked `.gitignore`. You can change the choice later under Project Settings › Workflow › Git sharing.' }
        ],
        actions: [
          { id: 'settings.openProject', label: 'Open Project Settings' }
        ]
      },
      {
        id: 'projects.sidebar',
        title: 'The sidebar',
        sketch: { kind: 'shell', focus: 'rail-views,sidebar-nav' },
        blocks: [
          { p: 'The thin rail on the far left switches the sidebar between Projects, Files, Changes and GitHub {kbd:sidebar.github}.' },
          { p: 'Projects is the project\'s own navigation, in two groups:' },
          { list: [
            'Work — Terminals.',
            'Context — Specs and Tasks with their counts, and Sessions.'
          ] },
          { p: 'Project Settings sits at the foot of that list. {kbd:panel.toggleSidebar} collapses the sidebar to the rail when you want the room back.' }
        ],
        actions: [
          { id: 'panel.toggleSidebar', label: 'Toggle the sidebar' }
        ]
      },
      {
        id: 'projects.settings',
        title: 'Two kinds of settings',
        sketch: { kind: 'settings', focus: 'project,frame' },
        blocks: [
          { p: 'Settings are split by what they belong to.' },
          { list: [
            'Project Settings — this project only: spec-driven development on or off, git sharing, open this project on launch, how many finished tasks and specs the boards show, and removing Frame from the project. Open it from the foot of the sidebar\'s project navigation.',
            'Frame Settings {kbd:settings.open} — Frame itself, on this machine: interface size, privacy choices, updates and logs. Open it from the gear at the foot of the rail.'
          ] }
        ],
        actions: [
          { id: 'settings.openProject', label: 'Open Project Settings' },
          { id: 'settings.open', label: 'Open Frame Settings' }
        ]
      }
    ]
  },
  {
    id: 'terminals',
    title: 'Terminals & agents',
    pages: [
      {
        id: 'terminals.open',
        title: 'Open terminals',
        sketch: { kind: 'terminalGrid', focus: 'ghost,columns' },
        blocks: [
          { p: 'Terminals are where the work happens — your shell, and the agents. Open one with {kbd:terminal.new}, or click the empty cell in the Terminals view.' },
          { list: [
            'The view shows every terminal of the project in a grid of one, two or three columns. Drag a pane\'s header to reorder it; enlarge one pane to work in it alone.',
            'A project holds up to nine terminals. Terminals keep running when you switch views or projects.',
            'Each terminal also gets a chip in the bar across the top. The × on a chip closes that terminal — Frame asks before it does.'
          ] }
        ],
        actions: [
          { id: 'terminal.new', label: 'Open a terminal' }
        ]
      },
      {
        id: 'terminals.start',
        title: 'Start the agent',
        sketch: { kind: 'shell', focus: 'header-agent,header-start' },
        blocks: [
          { p: 'Start in the header launches the selected agent. If you are looking at an idle terminal it starts there; otherwise Frame opens a new terminal for it. If the terminal you are in is busy, Frame asks whether to open a new terminal or restart that one.' },
          { p: 'Home has the same launcher — Start an agent — next to the list of what is already running.' },
          { note: 'The agent runs exactly as it would in any terminal, with its own sign-in and permissions. Frame only types the command that starts it.' }
        ],
        actions: [
          { id: 'lane.home', label: 'Go to Home' }
        ]
      },
      {
        id: 'terminals.talk',
        title: 'Talk to the agent',
        sketch: { kind: 'terminalGrid', focus: 'prompt' },
        blocks: [
          { p: 'Click into the terminal and type — prompts, answers, approvals — as you would anywhere else. Frame does not sit between you and the agent.' },
          { p: 'The menu named after your agent (Claude Code or Codex CLI) lists its common slash commands and types them into the active terminal.' },
          { p: 'Some of Frame\'s own buttons talk to the agent for you. Write the Spec, Generate Plan and the other spec actions open or reuse a terminal, start the agent if needed, and type the prompt — you watch it work and answer its questions there.' }
        ],
        actions: [
          { id: 'terminal.next', label: 'Next terminal' }
        ]
      },
      {
        id: 'terminals.states',
        title: 'Agent states',
        sketch: { kind: 'laneStates' },
        blocks: [
          { p: 'Frame watches every terminal. An agent terminal is in one of three states:' },
          { list: [
            'Agent working — leave it be.',
            'Needs approval — it is blocked on a permission prompt. This is the most urgent.',
            'Awaiting input — its turn finished and it is waiting for you.'
          ] },
          { p: 'Plain terminals are Idle or Running. The two waiting states are marked wherever the terminal shows up — its chip, Home, and the status bar for other projects. When a terminal is enlarged, the Other Terminals rail beside it lists the rest, waiting ones first.' }
        ]
      },
      {
        id: 'terminals.home',
        title: 'Home',
        sketch: { kind: 'home', focus: 'launcher,terminals' },
        blocks: [
          { p: 'Home {kbd:lane.home} is the project at a glance, and the permanent first chip in the top bar:' },
          { list: [
            'Terminals — the Start an agent launcher and every running terminal, the ones waiting on you first.',
            'Last Sessions — your three most recent Claude Code sessions, one click to resume.',
            'Active Specs and Active Tasks — the work in progress.'
          ] }
        ],
        actions: [
          { id: 'lane.home', label: 'Go to Home' }
        ]
      }
    ]
  },
  {
    id: 'specs',
    title: 'Specs',
    pages: [
      {
        id: 'specs.why',
        title: 'Why specs',
        sketch: { kind: 'specFlow' },
        blocks: [
          { p: 'An agent works best when it knows exactly what to build, how, and in what order — and when the next session can still read why. That is what a spec is: a short folder of documents that carries a piece of work from idea to done.' },
          { p: 'Spec-driven development is on for new projects. When you describe sizable work in a session, the agent offers to start a spec instead of diving into code; it never insists, and small fixes just get done.' },
          { note: 'You can switch spec-driven development off per project in Project Settings › Workflow; existing specs stay on disk.' }
        ]
      },
      {
        id: 'specs.flow',
        title: 'The flow',
        sketch: { kind: 'specFlow', focus: 'spec,plan,tasks,implement,done' },
        blocks: [
          { p: 'Every spec moves through the same steps, and each step leaves a file in `.frame/specs/<name>/`:' },
          { list: [
            'Spec — `spec.md`: the problem, the goal, constraints and success criteria.',
            'Plan — `plan.md`: the architecture, the files it touches and the order of work.',
            'Tasks — `tasks.md`: small tasks, each roughly one commit.',
            'Implement — the agent works through the tasks; the spec is done when none remain.'
          ] },
          { p: 'A spec always shows its next step as one button — Write the Spec, Generate Plan, Break into Tasks, Implement Tasks… — so you never have to remember where it stands.' }
        ]
      },
      {
        id: 'specs.new',
        title: 'Start a spec',
        sketch: { kind: 'specFlow', focus: 'spec' },
        blocks: [
          { p: 'Open Specs from the sidebar and press New Spec. Describe the work in your own words — no template to fill in.' },
          { p: 'Frame opens a terminal named Spec Creator, starts your agent and hands it the description. The agent picks a title, checks the existing specs for related decisions, asks you a question if the description is too thin, and writes `spec.md`.' },
          { p: 'You can also just ask the agent in any session — "let\'s write a spec for this" — and it runs the same flow.' }
        ],
        actions: [
          { id: 'panel.toggleSpecsDashboard', label: 'Open the Specs Dashboard' }
        ]
      },
      {
        id: 'specs.plan',
        title: 'Plan and tasks',
        sketch: { kind: 'specFlow', focus: 'plan,tasks' },
        blocks: [
          { p: 'Generate Plan sends the agent back to the code: it checks every claim the spec makes, asks you the decisions that are genuinely yours, and writes `plan.md` together with a visual plan report you can open from the spec\'s page.' },
          { p: 'Break into Tasks turns the plan into `tasks.md`. Frame imports those tasks by itself and the spec\'s page tracks them as the agent completes them; the Tasks Dashboard keeps them hidden until you tick its Include spec tasks box, which lists them with your own tasks, each labelled with its spec.' }
        ],
        actions: [
          { id: 'panel.toggleTasksDashboard', label: 'Open the Tasks Dashboard' }
        ]
      },
      {
        id: 'specs.implement',
        title: 'Implement',
        sketch: { kind: 'implementModes' },
        blocks: [
          { p: 'Implement Tasks… asks how the agent should run:' },
          { list: [
            'Step by step — one task, a report of what changed and why, then it waits for your go-ahead to commit and continue.',
            'Guided run — every task in order without check-ins; the CLI\'s own permission prompts pace it, and a live implementation report builds as it goes.',
            'Autonomous + report — every task unattended, one commit each. It needs a fresh terminal launched with the autonomous permission flags, which Frame starts for you.',
            'Describe your own — tell the agent how to run it: commit cadence, verification, reporting.'
          ] },
          { note: 'Whatever the mode, each finished task gets a short outcome entry in the spec folder, so the next session knows what actually shipped and where it differed from the plan.' }
        ]
      },
      {
        id: 'specs.where',
        title: 'Specs & tasks boards',
        sketch: { kind: 'boards' },
        blocks: [
          { list: [
            'Specs Dashboard {kbd:panel.toggleSpecsDashboard} — every spec as a card, filtered by phase. Open one to read its spec, plan, tasks and outcome, and to press its next step.',
            'A spec can also open as its own tab in the top bar, with the project\'s other specs in a rail beside it.',
            'Reports — View Plan Report and View Implementation Report open the generated reports inside Frame.',
            'Tasks Dashboard {kbd:panel.toggleTasksDashboard} — your tasks by status, with Play on each pending one. Spec-generated tasks stay hidden until you reveal them.'
          ] },
          { p: 'Finished specs and tasks drop off the boards after a while; Project Settings › Boards sets how long.' }
        ],
        actions: [
          { id: 'panel.toggleSpecsDashboard', label: 'Specs Dashboard' },
          { id: 'panel.toggleTasksDashboard', label: 'Tasks Dashboard' }
        ]
      }
    ]
  },
  {
    id: 'sessions',
    title: 'Sessions',
    pages: [
      {
        id: 'sessions.list',
        title: 'Resume a session',
        sketch: { kind: 'sessions' },
        claudeOnly: true,
        blocks: [
          { p: 'Sessions {kbd:panel.toggleSessions} lists this project\'s past Claude Code conversations, newest first, read from Claude Code\'s own transcripts. Open it from Context › Sessions in the sidebar.' },
          { p: 'Resume opens a new terminal and continues that conversation with `claude --resume`, so the agent comes back with its whole history. Home\'s Last Sessions card shows the three most recent, one click each.' },
          { note: 'Sessions are read from Claude Code\'s transcripts, so they cover Claude Code conversations only, and Home shows the Last Sessions card only while Claude Code is your agent.' }
        ],
        actions: [
          { id: 'panel.toggleSessions', label: 'Open Sessions' }
        ]
      }
    ]
  },
  {
    id: 'context',
    title: 'Context that survives',
    pages: [
      {
        id: 'context.files',
        title: 'Context files',
        sketch: { kind: 'fileTree', focus: 'context' },
        blocks: [
          { p: 'An agent session starts from zero. Frame\'s answer is a set of plain files in `.frame/` that every session reads, so the project\'s memory lives in the project rather than in any one conversation:' },
          { list: [
            '`AGENTS.md` — how to work in this project. Claude Code loads it at every session start through `.claude/rules/frame.md`.',
            '`PROJECT_NOTES.md` — decisions and why they were made.',
            '`tasks.json` and `specs/` — what is planned, in progress and done, and what earlier specs decided.'
          ] },
          { p: 'For Claude Code, hooks go a step further: before the agent edits a file, it is shown which earlier specs changed that file and why.' }
        ]
      },
      {
        id: 'context.dock',
        title: 'The panel',
        sketch: { kind: 'shell', focus: 'dock' },
        blocks: [
          { p: 'The panel {kbd:dock.toggle} holds the project\'s readable history — Project Notes, Prompts and Activity — one tab at a time, without replacing what is on screen.' },
          { p: 'It opens at the bottom; move it to the right from its header or the View menu. Drag its edge to resize and its tabs to reorder. The status bar has an icon per tab, too.' }
        ],
        actions: [
          { id: 'dock.toggle', label: 'Toggle the panel' }
        ]
      },
      {
        id: 'context.decisions',
        title: 'Project Notes',
        sketch: { kind: 'dockTabs', focus: 'decisions' },
        blocks: [
          { p: 'Project Notes {kbd:dock.decisions} lists every dated entry in `PROJECT_NOTES.md` — the decisions you and your agents recorded, with the reasoning behind them. Click one to read it; search filters by date, title or text.' },
          { p: 'It is the fastest way to answer "why is it like this?" before asking an agent to change it.' }
        ],
        actions: [
          { id: 'dock.decisions', label: 'Show Project Notes' }
        ]
      },
      {
        id: 'context.prompts',
        title: 'Prompts',
        sketch: { kind: 'dockTabs', focus: 'prompts' },
        blocks: [
          { p: 'Prompts {kbd:dock.prompts} is the history of what was typed into this project\'s terminals, searchable, so a prompt that worked last week is one search away.' },
          { note: 'Lines are redacted before they are saved, so API keys and tokens typed into a terminal are not kept in the history.' }
        ],
        actions: [
          { id: 'dock.prompts', label: 'Show Prompts' }
        ]
      },
      {
        id: 'context.activity',
        title: 'Activity',
        sketch: { kind: 'dockTabs', focus: 'activity' },
        blocks: [
          { p: 'Activity {kbd:dock.activity} shows the work Frame does on its own: file watchers syncing tasks and specs, hooks handing context to the agent, recoveries from a damaged file.' },
          { p: 'Work a guard deliberately skipped is listed too, drawn muted — so when something did not happen, you can see that Frame decided not to.' }
        ],
        actions: [
          { id: 'dock.activity', label: 'Show Activity' }
        ]
      }
    ]
  },
  {
    id: 'multi',
    title: 'Multiple projects',
    pages: [
      {
        id: 'multi.switch',
        title: 'Switch projects',
        sketch: { kind: 'multiProject', focus: 'switcher' },
        blocks: [
          { p: 'Frame keeps all your projects in one window. The project switcher in the middle of the header lists them; {kbd:project.next} and {kbd:project.prev} step through them, and the Command Palette {kbd:palette.toggle} jumps straight to a project, a terminal or a spec by name.' },
          { p: 'Switching never stops anything. Each project keeps its own terminals, and the agents in the projects you are not looking at keep working.' }
        ],
        actions: [
          { id: 'palette.toggle', label: 'Open the Command Palette' }
        ]
      },
      {
        id: 'multi.watch',
        title: "Other projects' agents",
        sketch: { kind: 'multiProject', focus: 'others' },
        blocks: [
          { p: 'The left of the status bar shows the agents running in your other projects — only the other ones, since this project\'s agents are already on screen.' },
          { list: [
            'A calm count means they are all working.',
            'A coloured pill means one of them is waiting on you — it needs approval or its turn is finished.'
          ] },
          { p: 'Click it to see them grouped by project, and pick one to go straight to that project and terminal.' }
        ]
      }
    ]
  },
  {
    id: 'plugins',
    title: 'Plugins',
    pages: [
      {
        id: 'plugins.install',
        title: 'Plugins and skills',
        sketch: { kind: 'plugins' },
        claudeOnly: true,
        blocks: [
          { p: 'Plugins extend Claude Code with skills, commands and agents. The Plugins button at the foot of the rail lists the ones in Claude Code\'s official marketplace, with filters for All, Installed and Enabled.' },
          { list: [
            'Install hands off to the agent: Frame types `/plugin install <name>` into the active terminal, so the install runs — and asks anything it needs to — where you can see it.',
            'Once installed, the switch on a plugin enables or disables it, so a skill you only need sometimes can stay installed and off.'
          ] },
          { note: 'Plugins belong to Claude Code: they install through it and only Claude Code sessions use them.' }
        ],
        actions: [
          { id: 'plugins.open', label: 'Open Plugins' }
        ]
      }
    ]
  },
  {
    id: 'look',
    title: 'Look & keys',
    pages: [
      {
        id: 'look.themes',
        title: 'Four themes',
        sketch: { kind: 'themes' },
        blocks: [
          { p: 'Frame comes in four themes: Dark and Light, Frame\'s own warm palette, and Dark+ and Light+, closer to VS Code\'s defaults. Terminals follow the theme too.' },
          { p: 'Pick one from the theme button in the header or View › Theme — or try them right here; the guide changes with them.' }
        ],
        actions: [
          { id: 'theme.dark', label: 'Dark', stay: true },
          { id: 'theme.light', label: 'Light', stay: true },
          { id: 'theme.darkPlus', label: 'Dark+', stay: true },
          { id: 'theme.lightPlus', label: 'Light+', stay: true }
        ]
      },
      {
        id: 'look.zoom',
        title: 'Zoom in and out',
        sketch: { kind: 'zoom' },
        blocks: [
          { p: 'The whole interface — text, terminals, panels — scales in five steps, from 85% to 120%.' },
          { list: [
            'Zoom in {kbd:view.zoomIn}, zoom out {kbd:view.zoomOut}, back to default {kbd:view.zoomReset}. The View menu has the same three.',
            'Frame Settings › Appearance › Interface size sets it from a list.',
            'Away from 100% the status bar shows the current size; click it to reset.'
          ] },
          { p: 'The size is remembered across launches.' }
        ],
        actions: [
          { id: 'view.zoomOut', label: 'Zoom out', stay: true },
          { id: 'view.zoomReset', label: 'Reset', stay: true },
          { id: 'view.zoomIn', label: 'Zoom in', stay: true }
        ]
      },
      {
        id: 'look.keys',
        title: 'Commands & shortcuts',
        sketch: { kind: 'keys' },
        blocks: [
          { p: 'Everything in Frame is a command, and every command is in the Command Palette {kbd:palette.toggle}. Type a few letters of what you want — a view, a setting, a project, a terminal, a spec — and press Enter.' },
          { p: 'Keyboard Shortcuts {kbd:help.shortcuts} lists every shortcut, grouped and searchable.' }
        ],
        actions: [
          { id: 'palette.toggle', label: 'Open the Command Palette' },
          { id: 'help.shortcuts', label: 'Show Keyboard Shortcuts' }
        ]
      }
    ]
  },
  {
    id: 'frame',
    title: 'Settings & help',
    pages: [
      {
        id: 'frame.settings',
        title: 'Frame Settings',
        sketch: { kind: 'settings', focus: 'frame' },
        blocks: [
          { p: 'Frame Settings {kbd:settings.open} — the gear at the foot of the rail — holds what belongs to Frame on this machine rather than to a project:' },
          { list: [
            'Appearance — the interface size.',
            'Privacy & Analytics — anonymous usage stats (app version and OS only, never code, paths or prompts) and local crash dumps, each with its own switch.',
            'About — your version, Check for Updates, and Open Logs Folder for bug reports.'
          ] }
        ],
        actions: [
          { id: 'settings.open', label: 'Open Frame Settings' }
        ]
      },
      {
        id: 'frame.feedback',
        title: 'Send feedback',
        sketch: { kind: 'feedback' },
        blocks: [
          { p: 'Found a bug or want something changed? Send Feedback — the speech-bubble button at the foot of the rail, or Help › Send Feedback… — offers three kinds:' },
          { list: [
            'Bug — a GitHub issue draft, with your Frame version and OS filled in.',
            'Feature idea — a GitHub discussion draft under Ideas.',
            'Reach us — an email draft to the people who build Frame.'
          ] },
          { p: 'Each one opens a draft you read and send yourself. Frame never posts anything on your behalf.' }
        ],
        actions: [
          { id: 'feedback.open', label: 'Send feedback' }
        ]
      },
      {
        id: 'frame.guide',
        title: 'Open this guide',
        sketch: { kind: 'shell', focus: 'rail-guide' },
        blocks: [
          { p: 'This guide is always one click away: the question-mark button at the very bottom of the rail, Help › How to Use Frame, or "How to Use Frame" in the Command Palette.' },
          { p: 'The start screen with its project shortcuts — the one Frame opens on when you have no projects yet — is under Help › Start with a Project.' }
        ],
        actions: [
          { id: 'help.welcome', label: 'Show the start screen' }
        ]
      }
    ]
  }
];

/**
 * Every page in tree order — the order Back / Next walk and the "n / N"
 * counter counts. Collapsing a chapter in the tree never changes it.
 * @returns {{ chapterId: string, page: object, index: number }[]}
 */
function flattenPages(chapters = CHAPTERS) {
  const out = [];
  for (const chapter of chapters) {
    for (const page of chapter.pages || []) {
      out.push({ chapterId: chapter.id, page, index: out.length });
    }
  }
  return out;
}

/**
 * Split a text into plain, {kbd:id} and `code` segments. The host escapes
 * each value and wraps kbd / code segments; nothing here produces markup.
 * @returns {{ type: 'text'|'kbd'|'code', value: string }[]}
 */
function parseInline(text) {
  const segments = [];
  const re = /\{kbd:([A-Za-z0-9_.-]+)\}|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) segments.push({ type: 'kbd', value: m[1] });
    else segments.push({ type: 'code', value: m[2] });
    last = re.lastIndex;
  }
  if (last < String(text).length) segments.push({ type: 'text', value: String(text).slice(last) });
  return segments;
}

/** Every string of a block, for token scanning. */
function blockTexts(block) {
  if (Array.isArray(block.list)) return block.list;
  const key = BLOCK_KEYS.find((k) => k in block);
  return key && typeof block[key] === 'string' ? [block[key]] : [];
}

/**
 * Check the content against every rule the host relies on.
 * @returns {string[]} one line per problem; [] when the content is sound
 */
function validate(chapters = CHAPTERS) {
  const problems = [];
  const chapterIds = new Set();
  const pageIds = new Set();

  if (!Array.isArray(chapters) || chapters.length === 0) {
    return ['no chapters'];
  }

  for (const chapter of chapters) {
    const where = `chapter "${chapter.id}"`;
    if (!chapter.id) problems.push('chapter without an id');
    else if (chapterIds.has(chapter.id)) problems.push(`duplicate chapter id "${chapter.id}"`);
    chapterIds.add(chapter.id);
    if (!chapter.title) problems.push(`${where} has no title`);
    if (!Array.isArray(chapter.pages) || chapter.pages.length === 0) {
      problems.push(`${where} has no pages`);
      continue;
    }

    for (const page of chapter.pages) {
      const at = `page "${page.id}"`;
      if (!page.id) problems.push(`page without an id in ${where}`);
      else if (pageIds.has(page.id)) problems.push(`duplicate page id "${page.id}"`);
      pageIds.add(page.id);
      if (!page.title) problems.push(`${at} has no title`);

      if (!page.sketch || !SKETCH_KINDS.includes(page.sketch.kind)) {
        problems.push(`${at} has an unknown sketch kind "${page.sketch && page.sketch.kind}"`);
      }

      if (!Array.isArray(page.blocks) || page.blocks.length === 0) {
        problems.push(`${at} has no blocks`);
      } else {
        for (const block of page.blocks) {
          const keys = Object.keys(block || {});
          if (keys.length !== 1 || !BLOCK_KEYS.includes(keys[0])) {
            problems.push(`${at} has a block that is not exactly one of ${BLOCK_KEYS.join(' / ')}`);
            continue;
          }
          const texts = blockTexts(block);
          if (texts.length === 0 || texts.some((t) => typeof t !== 'string' || !t.trim())) {
            problems.push(`${at} has an empty ${keys[0]} block`);
            continue;
          }
          for (const t of texts) {
            for (const seg of parseInline(t)) {
              if (seg.type === 'kbd' && !ACTION_IDS.includes(seg.value)) {
                problems.push(`${at} cites {kbd:${seg.value}}, which is not in ACTION_IDS`);
              }
            }
          }
        }
      }

      for (const action of page.actions || []) {
        if (!ACTION_IDS.includes(action.id)) {
          problems.push(`${at} links "${action.id}", which is not in ACTION_IDS`);
        }
        if (!action.label) problems.push(`${at} has an action without a label`);
        if (action.stay && !STAY_IDS.includes(action.id)) {
          problems.push(`${at} marks "${action.id}" as stay, which only theme and zoom commands may be`);
        }
      }
    }
  }
  return problems;
}

module.exports = {
  CHAPTERS,
  SKETCH_KINDS,
  ACTION_IDS,
  STAY_IDS,
  flattenPages,
  parseInline,
  validate
};
