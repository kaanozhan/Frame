---
keywords: home, terminals, overview, breadcrumb chips, tabs, other terminals rail, status bar, navigation, view modes, lane board, top bar, dashboard, cross-project attention, presence, sidebar nav groups
related: lane-orchestrator, decisions-view, agent-dispatch, agent-orchestration, sidebar-project-section, status-bar, sidebar-nav-groups
---

# Home, Terminals and Agents — three surfaces folded into one model

> **What we're building:** Frame's centre is split across three surfaces onto
> the same object — Home (a card board), Terminals (a live pane grid) and a
> nameless third `detail` view. This spec folds them into one model: **Home**
> becomes a project dashboard, **Terminals** becomes a single section with two
> bodies (the grid, and one terminal enlarged) whose navigation lives in the
> top bar, the `detail` view mode retires entirely, and agent visibility is
> spread across four surfaces instead of living in one right-hand panel.

> **Revised 2026-08-27, mid-implementation.** The first pass landed T01–T10 and
> the definition then changed in conversation — see
> [§0 Revision](#0-revision--what-changed-after-the-first-pass). §2 and §4 below
> describe the **current** model; what they replaced is recorded in §0.

## User's request (original, Turkish)

The opening observation:

> "Terminals ve Home görünümü ayrı viewlar olması güzel olmuş ama bence bir
> inconsistency yaratıyor. Kim nasıl kullanmak istiyorsa öyle kullanabilir ama
> sanki bir inconsistency var bir bakmanı istiyorum."

The decisions the user made over the course of the conversation:

> "Toolbar'a Home yanına Terminals gelsin ve sol menu'den terminals kalksın."

> "İlk satırda layoutlar vs cartlar curtlar var ya onlar olmayacak, orada
> Overview tab'ı açık olacak. Overview altında bu layout seçimleri drag drop vs
> şu an mevcut olan olacak. Şu anki expand iconu da büyüteç'e dönüşebilir,
> kullanıcı tıkladığında ona Overview yanında yeni bir tab açılarak o Terminal
> gelecek."

> "Home'u gerçekten bir takip layout'una dönüştürebiliriz. Bir card gibi çalışan
> … Orchestration ayrı bir kart, terminals ayrı bir kart, specs ve tasks ayrı
> kartlar olabilir. Hiçbir proje seçili değilse yine proje seçme
> önceliklendirilir, bu view değil."

> "Büyüteç'in kalması iyi olur gibi — otomatik açabilir yine terminal'i ama
> kullanıcı isterse kapar, kaparsa açar, açmaz ise overview'da kalır."

> "Terminals Work altına gelmiş ve orada yaşayan bir şey haline gelmiş. Şöyle
> bir şey yapılabilir: terminals de kapanabilir bir şey olur, böylelikle
> kapalıyken Work kısmından erişilebilir." … "Amaç tam olarak kapatmak olmuyor
> zaten, sadece yukarıdaki toolbar'dan kaldırılıyor; Terminals içinde yaşamaya
> devam ediyor."

> "Overview'da zaten her terminal'in yanında ismi vs'si gözüküyor, bunu hiç
> dahil etmeyelim; statuları daha okunur şekilde terminal'in tepesine yazalım,
> görülür olsun ünlem işaretleriyle vs. Tekli terminal görünümünde ise Other
> Terminals gibi bir sağda section olsa."

> "Other Terminals sadece tekli görünümde olsun ve default kapalı olsun. Orada
> bir hover buton olsun, kullanıcı isterse açabilsin… Kapalı halindeyken de
> eğer bir agent approval bekliyorsa, kapalı halinde de tık diye o listede
> kırmızı ünlem agent'lı vs bir görünümle o da gözüksün."

> "Status bar => burada other agents ile ilgili bir alan… yoksa orada bir
> bilgilendirme olabilir: seçili proje dışındaki agentların takibi vs şeklinde.
> Olduğunda da agent sayısı ve durumları, approval vs bekleyen varsa o da daha
> kapsamlı gösterilebilir." … "Ya da hover olsun, session kısmıyla tutarlı
> olsun."

## 0. Revision — what changed after the first pass

T01–T10 shipped (commits `b339507`..`f2c7ee5`) and the branch stayed local. In
the conversation that followed, three of this spec's own decisions were
overturned. They are recorded here rather than quietly edited away, because a
future session reading §2 needs to know the tab strip was **tried and removed**,
not merely never built.

**R1 — the tab strip became a breadcrumb in the top bar.** §2 specified a tab
strip as the Terminals section's first row: `[Overview] [Terminal N] …`. It
shipped (T02), and the result put two rows of tabs directly above each other —
the top bar is itself a strip of surfaces, and the section's own strip sat
immediately under it, answering a different question with the same shape.
*Now:* every live terminal of the project is a chip in the top bar beside
Terminals itself, and the section has no navigation of its own. Prefs moved
from `openTabs`/`activeTab` to `shownTerminal` + `hiddenFromBar` — what is *out*
of the bar rather than what is in it, so a terminal created later appears by
default. Commit `f1cb8a3`.

**R2 — the magnifier went back to being ⤢.** §2 turned `⤢` into `🔍` meaning
"open in its own tab". With no tabs left, the gesture is once again "enlarge
this terminal to fill the section", so the mark returns to `⤢`. `maximizedId`
stays retired — enlarging is a body of the section, not a pane state. Commit
`f1cb8a3`.

**R3 — Home is a dashboard, and the fourth card left.** §4 specified four cards,
Orchestration among them. Orchestration is a surface you open, not a state you
read, so it moved to the sidebar's Work group; Home gained a header (project
name + branch) and two groups — Work, and Project planning — that split the
window evenly. Commit `8829c5a`.

**Still true from the first pass:** the `viewMode` model, the retirement of
`detail` and `terminalGrid.js`, `×` meaning *drop from this strip* at every
level, the single status vocabulary in `laneStatus`, and agent visibility across
four surfaces (§5). None of those were touched.

**Scope taken on during the revision.** The navigation model reaches the sidebar,
so three sidebar decisions belong to this spec rather than to a separate record:
the collapsed rail reads as an edge instead of a broken sidebar (`226e3bc`), the
Add Project CTA belongs to the empty sidebar only (`ca6ffdd`), and the status bar
says "in other projects" rather than "elsewhere" (`027ed3b`). Landing on Home
when a project has no running terminals (`4256757`) is §4's own rule, applied.

**Deliberately not in this spec**, though it landed on the same branch: splitting
Settings by scope (`320f572`) has its own record, and the inline-panel cleanup
(`5760ab6`, `f46aebb`) is a PROJECT_NOTES entry — the `retire-rail-and-panels`
spec it belongs to has no folder in the archive.

## Problem

The same terminal list is rendered in four places today, in four different
vocabularies: the top bar's tabs, Home's cards, the Terminals panes, and the
detail rail. The concrete breaks:

1. **Clicking a Home card skips the default view.** `enterLane()` calls
   `setViewMode('detail')` (`multiTerminalUI.js:234`), dropping the user onto a
   surface no menu can reach.
2. **Two grid systems do the same job.** Terminals has 1/2/3 columns with its
   own localStorage; `detail` has a 1x1–3x3 cell-assignment layout in the
   terminalManager session. `detail` auto-fills empty cells with open
   terminals, so a 2x2 detail is a 2-column Terminals view by another name.
3. **Two navigation systems that don't know about each other.** Home lives only
   in the top bar; Terminals lives only in the sidebar.
4. **The sidebar's active state lies.** Neither `board` nor `detail` appears in
   any row's `surfaces` list, so nothing is highlighted while you are on Home
   or inside a terminal — though Specs and Tasks do highlight.
5. **Home is a one-way island.** Closing Specs, Tasks or a panel, and closing
   the last terminal, all return to `showTerminals()`. There is no way back to
   Home.
6. **Every shortcut is bound to `detail`.** `Ctrl+Tab`, `Cmd+1-9` and
   `Cmd+Shift+T` all route through `enterLane` into the detail view. The
   default view has no shortcut at all.
7. **The vocabulary is in three pieces.** The palette still says "New Frame",
   "Close Frame", "Switch to Frame N" and "Back to Mainframe"
   (`index.js:672-739`); a Home card reads "New Frame" (`laneBoard.js:234`)
   while its own tooltip reads "New Terminal" (`:229`); Terminals says "New
   terminal".
8. **Two label dictionaries for one status.** `laneBoard` says "Agent working",
   `laneDetailRail` says "Working", and the Terminals pane says nothing at all
   beyond a coloured dot.
9. **The right-hand rail is a different thing on every surface.** Home shows
   Specs/Tasks, `detail` shows a terminal list, Terminals shows nothing.
10. **The empty state is written twice**, with the same words and different
    calls to action (`laneBoard.js:293`, `terminalsView.js:229`).
11. **Dead code.** `enterFrames()`/`onEnterFrames` is never triggered, the
    `.btn-lane-frames` CSS is orphaned, and `restoreProjectSession`'s viewMode
    restore is overwritten two lines later (`terminalManager.js:132` vs `:227`).

## The decided UI model

This section is normative. The implementation must not drift from it.

```
┌─ TOP BAR ──────────────────────────────────────────────────┐
│ Home   [Terminals ×]  [spec: foo ×]           🌓 ⋯          │
├────────────────────────────────────────────────────────────┤
│ [Overview] [Terminal 1] [Terminal 3]                       │
├────────────────────────────────────────────────────────────┤
│  LAYOUT ▮1 ▮▮2 ▮▮▮3        drag header to reorder          │
│  ┌──────────────┐ ┌──────────────┐                         │
│  │ Terminal 1 🔍│ │ Terminal 3 🔍│                         │
│  └──────────────┘ └──────────────┘                         │
│  ┌ + New terminal ────────────────┐                        │
├────────────────────────────────────────────────────────────┤
│ ◆ 3 agents · 1 waiting        ▓▓▓░ 62%   ▓▓░ 40%           │
└────────────────────────────────────────────────────────────┘
```

### 1. Top bar

- One rule: **`Home` is permanent; everything else in the top bar is an open
  surface and can be dropped from the strip.**
- The strip holds `Home`, `Terminals`, and the open section chips (spec / task
  / diff / orchestrator).
- **`×` always means "drop from this strip", never "destroy".** The `×` on
  Terminals only removes it from the top bar: the section, its open terminal
  tabs, the Overview layout and every running agent keep living. **Work →
  Terminals** in the sidebar brings it back exactly as it was left.
- Terminals is present in the strip at launch (it remains the landing view).
  When it has been dropped, the user lands on Home.
- **A rule that must be written down or it erodes:** the top bar carries
  surfaces that have *live state*. Terminals has running processes and its own
  tab strip; the Specs grid does not. Specs, Tasks, Decisions and the panels
  open from the sidebar and stay out of the top bar — their behaviour today is
  preserved.
- **Removed:** the per-terminal tabs, the grid layout select, and the presence
  chips (`presenceBar.js` is deleted).
- **Kept:** the theme toggle (moved here by the status-bar spec), the "…" menu
  and the update notification. **The Claude usage meters have moved to the
  status bar and stay there** — they are not brought back.

### 2. The Terminals section — two bodies, navigated from the top bar

*Revised — see §0/R1. This replaces the tab strip the first pass shipped.*

The section has **two bodies and no navigation of its own**:

- **The grid** — today's Terminals view: 1/2/3 columns, drag a header to
  reorder, drag the bottom edge to resize, the `+ New terminal` ghost pane. All
  preserved.
- **One terminal enlarged** — that terminal filling the section, with the Other
  Terminals rail beside it (§5b).

Navigation lives one level up. Every live terminal of the project is a chip in
the top bar beside Terminals itself, **whether it has ever been enlarged or
not**: Terminals is the grid of all of them, a chip is that one enlarged.

- The pane header's `⤢` keeps its original meaning — **enlarge this terminal to
  fill the section** — and lands on the same body as that terminal's chip.
  `maximizedId` stays retired: enlarging is a body of the section, not a pane
  state.
- An enlarged pane carries **no shrink control**. Terminals never leaves the top
  bar and is the way back to the grid.
- Chips are drawn in the grid's own order, so dragging a pane moves its chip
  with it, and each carries the live status dot.

**Chip lifecycle (normative):**

| Action | Result |
|---|---|
| A terminal is created (Home, the grid's `+`, `Cmd+Shift+T`) | its chip appears **and that terminal is enlarged** |
| A chip's `×` is clicked | **the chip leaves the bar, the terminal lives on** — the grid still holds it |
| A pane's `⤢` is clicked in the grid | that terminal is enlarged; same destination as its chip |
| A pane is clicked in the grid | **focuses in place** — the grid's side-by-side purpose is preserved |
| A terminal is closed (pane `×`, `Cmd+Shift+W`, the process dying) | terminal and chip go together |
| Terminals' own `×` is clicked | offered **only while the project has no terminals** — with terminals in it the breadcrumb beside it would be orphaned |
| The project is switched | the dropped-chip set is per project and survives the switch |
| The app restarts | ids do not survive; the grid opens with every terminal back in the bar |

- Dropping a chip is explained by `terminalChipNotice` until the user opts out:
  an `×` beside a terminal's name reads as "close" until told otherwise.
- Going back to a terminal **puts its chip back** — you cannot be looking at a
  terminal the breadcrumb refuses to name.
- The bar scrolls rather than truncating; silent truncation is not acceptable.
- The enlarged header carries the spec or task the terminal is working on, as a
  chip. It belongs there and not in the grid: the grid's panes are narrow and
  already say what they are doing, while filling the screen with one terminal is
  exactly when "what is this for" stops being answerable from anything else on
  screen.

### 3. The `detail` view mode retires

- The `viewMode` set becomes `board | terminals | specs | tasks | panel`. There
  is no `detail`.
- The cell-assignment logic (`_ensureAssignments`, `_assignCell`,
  `_newLaneInCell`), `terminalGrid.js` and the `gridLayout` plumbing are all
  deleted.
- `enterLane(terminalId)` stays the single choke point with a new meaning:
  **"go to Terminals (restoring it to the strip if needed) and open or focus
  that terminal's tab."** The Home card, the rail, `agentDispatch` and the
  status bar menu all route through it.
- `isViewingFrame()` is redefined as *"I am in the Terminals section and a
  terminal is focused"*. Because it is bound to `viewMode === 'detail'` today,
  it returns **false on the default view every time**, which is why
  `agentDispatch` never uses the focused terminal (`agentDispatch.js:251`).
  That is a bug and it is fixed here.

### 4. Home — the project dashboard

*Revised — see §0/R3. Four cards became a header plus two groups.*

- Home is no longer a terminal list. The Specs/Tasks rail on its right
  (`laneRail.js`) is removed and its content moves into cards.
- A **header** carries the project name and its branch — no path, the sidebar
  already carries that.
- Two **groups** split the window evenly, because the cards answer two different
  questions and the split gives the board a reading order instead of a grid of
  equals:
  - **Work** — what is running right now.
  - **Project planning** — what the project has planned: **Specs** (a summary of
    the active specs) and **Tasks** (a summary of the pending ones, spec-owned
    work excluded — that work is the spec's business).
- **Orchestration is not a card.** It is a surface you open, not a state you
  read, so its entry is the sidebar's Work group and it opens as a top-bar
  section tab. The card was the only place a live conductor session announced
  itself, so the sidebar row carries a running badge instead.
- The rule: **a card is a summary and an entry point; the sidebar is the full
  surface.** Cards do not replace the dashboards, they lead to them.
- **When no project is selected, Home is not shown** — project selection takes
  priority (today's `_renderNoProjectState` behaviour moves into that role).
- **Home is the landing view when a project has no running terminals** — there
  is nothing to return to, so the board is the honest destination.

> **Open at revision time.** Terminals is leaving the Work group as well, which
> empties it. What fills it is being decided separately and is **not** part of
> this spec's acceptance.

### 5. Agent visibility — four surfaces

Agent visibility is not concentrated in a panel but spread across **four
surfaces**. The rule: *each surface shows what its own context cannot already
show.* No list is drawn twice.

**5a — Overview: the pane headers.** Overview is already this project's agent
board; a list beside it would be a repeat. Instead the status in the pane
header **becomes legible**: the status text and an attention marker (approval
being the strongest) read clearly in the header. There is **no rail** in
Overview.

**5b — The "Other Terminals" rail: the single-terminal body only.** Looking at
one terminal, you cannot see the others; this rail closes that gap.
- It lists **every terminal in the project except the one you are looking at** —
  tabbed or not. Agents are marked. (Listing only agents was rejected: quick
  switching is this rail's job too.)
- **It is closed by default.** A control that appears on hover at the edge
  opens it, and the open/closed state is remembered.
- **Closed, it is quiet but not blind:** when an agent is waiting on approval
  or input, a red exclamation and an agent marker appear in the slim strip.
  Running and idle terminals never show in the collapsed strip.
- The rule that keeps it distinct from the tab strip: **the strip is navigation
  among what I opened; the rail is the state of what I cannot see.**

**5c — The sidebar `◆` chip: this project, on every surface.** The `◆ N`
indicator on the Work → Terminals row that came with `sidebar-nav-groups` is
preserved and **gains an attention state**: today it is only a count of running
agents; from now on it changes colour while one waits on approval or input. It
is fed by the per-project approval/input tally `projectStatusBadges` already
computes — no new data. This closes the gap where an agent in this project
waits silently while you are on Specs, Tasks, Decisions or a panel.

**5d — The status bar slot: the other projects, on every surface.** The empty
left slot the `status-bar` spec deliberately declared (`statusBar.js:10`) is
filled. Its scope is **only agents outside the selected project**, and its
label says so plainly — otherwise "I have 5 agents, why does it say 2?" is the
obvious question. Three states:
- *None* — a quiet, self-explaining hint (it teaches what the slot is; kept
  short, with the longer explanation in the tooltip).
- *Some, none blocked* — a calm count.
- *Some waiting on approval or input* — prominent, coloured, and fuller.

**Hover opens the menu; a click acts** — this is the bar's own idiom: the usage
meters also reveal their detail on hover while a click refreshes
(`status-bar.css:38-39`). The menu is grouped by project, and clicking a row
switches project if needed and opens that terminal's tab. Because the bar sits
at the foot of the window the menu **opens upward**; a hover menu needs a small
open delay and a forgiving close area.

**One shared vocabulary.** All four surfaces use the same status words and the
same attention symbols (§7). The sidebar chip and the status bar slot say the
same thing at different scopes; using different colours or symbols would turn
the rule into a coincidence.

### 6. Sidebar

- **Terminals stays in the sidebar.** `sidebar-nav-groups` (2026-08-25) split
  the nav into Work / Context / Frame groups and made Terminals the first row
  of Work. That decision is **not reversed but built upon**: the sidebar's
  Work → Terminals is the *entry point*, the top bar's Terminals is *what is
  open*. Not a duplicate — two different jobs.
- The row's terminal count is preserved; its `◆` indicator gains the attention
  state from §5c.
- The groups and their collapse state are preserved as they are. `historyPanel`
  retired in the same merge; this spec does not bring it back.

### 7. Vocabulary

- The only word the user sees is **"terminal"**. "Frame", "Frames", "Mainframe"
  and "Lane" appear nowhere in the interface.
  - `index.js` palette: "New Frame" → "New Terminal", "Close Frame" → "Close
    Terminal", "Next/Previous Frame", "Switch to Frame N", "Back to Mainframe"
    → "Home", and the category "Frames" → "Terminals".
  - The "New Frame" strings in `laneBoard.js:234` and `terminalGrid.js:136`.
- **Status labels come from a single source.** `laneBoard.STATUS_LABELS`
  ("Agent working") and `laneDetailRail.STATUS_SHORT` ("Working") are defined
  separately today; they collapse into one table, and the Home card, the rail,
  the Overview pane header and the status bar slot all use the same words and
  the same attention symbols.
- Module and file names in the code keep saying `lane*` (the 2026-08-20 rule
  holds): the code says "lane", the interface says "terminal".

## Goal / Acceptance

- [ ] The top bar holds `Home`, `Terminals` and the open section chips; the
      per-terminal tabs, the grid layout select and the presence chips are not
      there. S1
- [ ] The Terminals section shows a tab strip with `Overview` leftmost and not
      closable. S2
- [ ] Overview preserves today's multi-pane behaviour: 1/2/3 columns, drag to
      reorder, drag to resize. S3
- [ ] The magnifier in the pane header opens that terminal in its own tab, and
      a second click switches to the existing tab rather than opening another.
      S4
- [ ] Each of the seven rows in the tab lifecycle table behaves as defined. S5
- [ ] `detail` view mode, `terminalGrid.js`, the cell-assignment logic and
      `gridLayout` are gone from the code. S6
- [ ] `enterLane` is the single entry point meaning "open or focus that
      terminal's tab". S7
- [ ] `isViewingFrame()` answers correctly in Overview and in a terminal tab;
      Start uses the focused idle terminal instead of opening a new one. S8
- [ ] Home is four cards (Terminals, Orchestration, Specs, Tasks) and
      `laneRail.js` is gone. S9
- [ ] Home's Terminals card creates a terminal whether it is empty or full, and
      opens that terminal's tab. S10
- [ ] With no project selected, project selection is shown instead of Home. S11
- [ ] The "Other Terminals" rail exists only in the single-terminal body, lists
      every terminal in the project except the one on screen with its state, and
      switches on click. S12
- [ ] The status bar's left slot covers **only agents outside the selected
      project**, and its label states that scope. S13
- [ ] `presenceBar.js` is deleted and the chip container is gone from the top
      bar. S14
- [ ] Terminals is the first row of the sidebar's Work group, with its count
      and `◆` indicator working. S15
- [ ] No user-facing string contains "Frame", "Frames", "Mainframe" or "Lane".
      S16
- [ ] Status words and attention symbols come from one source; the Overview
      pane header, the Other Terminals rail, the sidebar chip and the status bar
      slot all use the same vocabulary. S17
- [ ] Dead code is gone: `enterFrames()`/`onEnterFrames`, the
      `.btn-lane-frames` CSS, the overwritten viewMode restore. S18
- [ ] The empty state is defined in one place. S19
- [ ] The tests pass. S20
- [ ] The `×` on Terminals does not destroy the section: terminals, tabs and
      the Overview layout survive, and Work → Terminals restores the state that
      was left. S21
- [ ] The Overview pane header carries legible status text and an attention
      marker, and there is no rail in Overview. S22
- [ ] The Other Terminals rail is closed by default, opens from the hover
      control at its edge, and remembers its open/closed state. S23
- [ ] While closed, only agents waiting on approval or input appear in the slim
      strip; running and idle terminals stay silent. S24
- [ ] The sidebar `◆` chip enters an attention state while an agent waits, fed
      by the existing `projectStatusBadges` tally with no new IPC. S25
- [ ] The status bar slot shows all three states correctly (none → hint · some
      → calm count · waiting → prominent); hover opens the menu, a click goes to
      the most urgent agent; the menu opens upward and is grouped by project.
      S26
- [ ] Home's Specs card carries the `!malformed` filter. S27

## Constraints the implementation must respect

These were verified against the code during the conversation; they are
constraints, not design preferences.

1. **A terminal can only be live in one place at a time.** `mountTerminal` does
   not copy the terminal's DOM element, it **moves** it
   (`terminalManager.js:547`, `container.appendChild(instance.element)`). A tab
   and Overview share the same instance; the mount moves on every switch and
   the target always re-mounts. Without this rule the failure is silent: "I
   went to the tab, came back to Overview, the pane is empty." **This is the
   most likely source of error in this model.**

2. **A surface mounted inline in the centre that loads data on mount must be
   idempotent.** The lesson recorded on 2026-08-20: with a section chip open,
   every data push fed back through `_onStateChange`, and a surface that loaded
   data on mount climbed to ~100 IPC round-trips per second and 163% CPU. Home
   with four live data cards is exactly that shape, and `laneBoard.render()`
   today rebuilds everything on every state change (`laneBoard.js:135`).
   **Home's cards mount once and update in place** — the existing
   `_updateCardStatus` / `_updateBranchChips` idiom extends to every card. This
   must be measured before the spec is accepted: idle IPC counter and CPU.

3. **Switching projects does not kill terminals.** `terminals` is a single Map
   that is never pruned on a switch; `getTerminalStates()` only filters the view
   (`terminalManager.js:666-672`). PTYs, scrollback and running agents all
   survive. Tabs are therefore not discarded either, but stored per project.

4. **`saveProjectSession` returns early for a project with no terminals**
   (`terminalManager.js:163-165`). If tab state were written there, that branch
   would need revisiting; it is avoided instead.

5. **The recorded decisions of `audit-q3-performance-resources` are preserved.**
   The footprints overlap in four files. To keep: `_armQuietTimer` in
   `laneStatus` (one timer per activity burst instead of per chunk), the 20-entry
   MRU session pruning and the `clearProjectSession` wiring in `terminalManager`,
   and the **init-once listener guards** in `laneRail`, `laneBoard`, `laneStatus`
   and `terminalManager`. The rewritten `laneBoard` and the new rail carry the
   init-once idiom forward; deleting `laneRail` does not conflict with that
   spec's goal of fewer listeners.

6. **The decisions of the 2026-08-25 merge are preserved** (`sidebar-nav-groups`,
   `status-bar`, `spec-status-repair`).
   - The nav's Work / Context / Frame groups, their collapse state and the
     Terminals row's count are preserved; `historyPanel`'s retirement is not
     undone.
   - The Claude usage meters stay in the status bar and are not moved back to
     the top bar; the theme toggle stays in the top bar.
   - The `!malformed` filter in the spec lists (`laneRail.js:204`,
     `multiTerminalUI.js:520`) is preserved. **Home's Specs card must carry it
     over when it inherits `laneRail`'s subscriptions**, or the fix that just
     landed regresses.

## Out of scope

- **The rest of the cross-project architecture.** This spec brings the status
  bar slot and its hover menu; **acting without going to the project** (typing
  into another project's terminal from there) and an **OS notification layer**
  are left to a separate spec (`cross-project-attention`).
- **Moving the section chips into their own sections.** Once Terminals has its
  own tab strip, "why are spec chips still in the top bar?" is a fair question,
  but it widens the scope.
- **Selectively hiding panes in Overview.** `detail`'s cell-assignment ability
  is deliberately lost; drag-to-reorder and tabs are what replace it.
- **The status bar's right half.** The usage meters belong to the `status-bar`
  spec; this spec only fills the left slot it left empty.
- Memory / Team / the remaining steps of the prototype.

## Decisions explicitly reversed

- **`retire-rail-and-panels` (2026-08-20)** — *"One navigation system remains:
  sidebar workspace nav → center views."* The top bar now carries a fast path
  for live surfaces too. This is a soft reversal: the sidebar remains the
  **complete** navigation (Terminals included) and the top bar only shows what
  is open.
- **`topbar-presence` (2026-08-20)** — the presence chips are deleted with
  `presenceBar.js`. The cross-project attention they carried is not lost; it
  moves into the status bar slot (§5d) and the sidebar chip (§5c).
- **`lane-orchestrator` (2026-06)** — the board as landing view was already
  reversed by `terminals-view`; here Home's role is redefined (terminal board →
  project board) and the detail/grid surface retires completely.

- **This spec's own §2 and §4 (2026-08-26)** — the tab strip and the four-card
  board were built, then overturned mid-implementation. Recorded in §0 (R1–R3)
  rather than edited away: the tab strip was *tried and removed*, which is a
  different lesson from "never built".

**Explicitly not reversed** — built upon instead:

- **`sidebar-nav-groups` (2026-08-25)** — the Work/Context/Frame groups and
  Terminals' place in Work are **preserved**. This spec's first draft removed
  Terminals from the sidebar; that decision was withdrawn.
- **`status-bar` (2026-08-25)** — the deliberately empty left slot is filled;
  the bar's "hover reveals, click acts" idiom and the usage meters' new home
  are preserved.
- **`terminals-view` (2026-08-20)** — Terminals as the landing view and as a
  sidebar workspace nav entry are both **preserved**.

## Alternatives considered and rejected

- **A tab strip inside the Terminals section.** Built (T02), then rejected: it
  put two rows of tabs directly above each other, the top bar's and the
  section's, answering different questions with the same shape. Replaced by the
  top bar breadcrumb (§0/R1).
- **A "multi mode / single mode" pair.** Rejected in favour of the tab strip
  when the strip was still the model; the objection holds for the breadcrumb
  too — it builds the model without a hidden mode flag and allows several
  terminals to stay open at once.
- **Removing the magnifier entirely** (every terminal gets a permanent tab).
  Rejected: it made closing a tab either destructive or irreversible.
- **A pane click in Overview opening its tab.** Rejected: Overview exists so
  that several terminals can be watched while one is typed into.
- **Keeping the presence chips.** Rejected: the status bar slot and the sidebar
  chip do the same job legibly.
- **Removing Terminals from the sidebar.** Rejected: `sidebar-nav-groups` gave
  it a principled home in the Work group ("where you act"), and sidebar =
  entry point / top bar = what is open is not a duplicate.
- **A single "Agents" rail.** Rejected: it overlapped both Overview's pane
  headers and the status bar slot, and it disappeared entirely when Terminals
  was dropped from the strip — so it could never be the "independent of the
  terminal view" tracking it promised.
- **The rail listing only agents.** Rejected: it would have left no path to
  plain shells in the single-terminal view; the rail's job is quick switching
  as much as state.
- **The status bar slot covering every project.** Rejected: it would repeat
  what is already on screen in Overview, and this project's attention already
  lives in the sidebar chip.
- **Opening the status bar menu on click.** Rejected: the bar's own idiom is
  hover reveals / click acts (`status-bar.css:38-39`).
