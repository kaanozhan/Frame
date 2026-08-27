---
keywords: home, dashboard, widgets, widget contract, lane board, agents card, last sessions, claude sessions, resume, ai tool selector, top bar, launcher, grid layout, card registry, home data layer
related: terminals-home-agents, lane-orchestrator, sessions-from-transcripts, agent-dispatch, status-bar, resize-storm-watchdog, decisions-view
---

# Home becomes a widget board

> **What we're building:** Home stops being a fixed two-group card board built
> around Terminals and becomes a **flat dashboard of independent widgets**. The
> Terminals card is removed; two new widgets take the space — **Agents** (start
> one, see the ones running) and **Last Sessions** (resume where you stopped).
> Underneath, the board is refactored into a **widget contract plus a single
> data layer**, so that later a user can choose which widgets to show and a new
> widget costs one file instead of a change to the board.

## User's request (original, Turkish)

The opening ask, after reviewing a card catalogue drafted for this branch:

> "asıl ilk aşamada yapmamız gereken Terminal lane'ini kaldırmak, daha bir
> dashboard görünümüne kavuşturmak ve yeni şeyler eklemek ama şu an No Project
> State'iyle ilgilenmeyeceğiz ve Fixed şeyler olacak ilk aşamada"

On layout and architecture:

> "Work Project planning vs gibi başlıklar olmasına gerek yok sade güzel
> dashboard item'lar olarak bağımsız durabilir. Bir de bunları tasarlarken ya da
> refactor ederken olanları bunları component component yapmak önemli ki ilerde
> belki dashboard üzerinden kullanıcının hangilerini görmek istediğini şeyaparız
> ya da yeni widget'lar ekleriz."

The final scope call:

> "Bu aşamada şunu yapalım O composer'ı koymayalım. Şu an için şu 4'ü olsun
> 1. Agents => Yeni agent başlatmayı ve var olan agentların durumunu görmeyi
> sağlar. 2. Last Sessions => claude üzerinde son 3 session'ı başlığı varsa
> spec'i vs bilgiler gösterir. Geri kalanlar aynı olarak devam eder. İlk aşama
> bu olsun."

On the Agents widget:

> "Burada önemli olan sadece çalışan agent'ları göstermek ama tıklayınca lane
> navigation yapacağız. Burda da önem sırasına göre sıralamak önemli"

On the launcher:

> "Topbar'da Start kalması değer katar ama yanında agent seçili olması çok yer
> kaplıyor belki onu start basınca default olanı başlatmak olarak ayarlarız ama
> bu sefer ajan seçimi için yer kalmıyor belki agent seçimini de status bar'da
> session'ın yanına koyabiliriz bilemiyorum."

On the session chip:

> "Last sessions o zaman şimdilik bir chip göstermesin evet claude'a özel
> olduğunu biliyorum onu notes'a ekleriz Codex için de yapılacak şeklinde"

---

## 1. Where Home is today

`src/renderer/laneBoard.js` (775 lines) is a singleton that owns everything
about the board at once:

- **Data.** A one-time `_dataListenersBound` guard installs every subscription:
  `GIT_STATUS_DATA`, `SPEC_DATA`, `TASKS_DATA`, `laneStatus.onChange`, and
  `agentDispatch.onSpecLaneActivity` / `onTaskLaneActivity`.
- **DOM.** A private `_card()` factory builds one card shell (header / body /
  footer action), and `_buildTerminalsCard` / `_buildSpecsCard` /
  `_buildTasksCard` name the three.
- **Rendering.** `_updateTerminalsCard` / `_updateSpecsCard` / `_updateTasksCard`
  patch each body in place.

Layout is two named groups (`Work`, `Project planning`) in
`src/renderer/styles/components/lane-board.css`: `.home-group` is
`flex: 1 1 0` with a `min-height: 232px` floor, `.home-cards` is a hard
`repeat(2, 1fr)`, `.home-cards-solo` exists solely because the Work group holds
one card, and a `@container (max-width: 699px)` block collapses to one column
and doubles the floor.

Every new card today means editing that class and that stylesheet.

### The constraint that shapes all of this

The `mount()` / `update()` split is not style — it is the fix from the IPC
storm measured **2026-08-20** (~100 round-trips/sec, 163% CPU). `mount()`
builds DOM once per visit; `update()` patches text and small list bodies in
place. Anything that rebuilds a card's DOM on every state change reintroduces
that storm. The same reasoning produced the `_dataListenersBound` guard: a
second construction must not stack a second set of listeners.

**Any widget architecture must make both properties structural rather than
conventional** — a widget author must not be able to reintroduce the storm by
writing the obvious code.

---

## 2. What ships

Four widgets, fixed order, no group headings.

### 2.1 Agents *(new)*

Start an agent, and see the ones that are running.

- **Rows are agent lanes only.** `laneStatus` distinguishes five statuses; three
  are agent statuses (`agent-working`, `agent-approval`, `agent-input`) and two
  are not (`idle`, `running`). The widget lists the first three and never shows
  a shell terminal. In practice that is 0–3 rows, not the retired Terminals
  card's 3×2 tile grid.
- **Ordered by how much they want you:** `agent-approval` → `agent-input` →
  `agent-working`. This is the order `ATTENTION_MARKS` already implies — the
  first two carry a mark, the third does not.
- **A row navigates to its lane** (the existing `onEnterLane`).
- **Empty state is the launcher.** With nothing running, the widget is a Start
  button and the tool choice, not an empty box.
- **The tool selector lives here** (see §4.2), as Start's secondary control.

### 2.2 Last Sessions *(new)*

The last three Claude sessions, resumable in one click.

- Fields shown: **title, relative time, message count, branch** — exactly what
  `LOAD_CLAUDE_SESSIONS` returns after the `sessions-from-transcripts` spec.
- Clicking resumes through the existing `resumeClaudeSession(sessionId)`, which
  already validates the id as a UUID and opens its own terminal.
- **No spec/task chip in this pass** — see §5.3.
- **Claude-only.** The channel reads Claude transcripts. Under another default
  tool the widget does not render (see §3, `isAvailable`).

### 2.3 Active Specs · 2.4 Active Tasks *(carried over)*

Unchanged in content and behaviour. They move onto the new contract and lose
their group heading; `SPEC_DATA` / `TASKS_DATA` keep the `!malformed` filter
they travel with.

### Removed

The **Terminals card** and its tile grid (`_buildTerminalsCard`,
`_updateTerminalsCard`, `_wireTerminalTiles`, the `home-tile*` styles,
`MAX_TILES`). Terminals stays reachable from the sidebar's Work group; Home
simply stops pointing at it.

---

## 3. The widget contract

One widget, one file, under `src/renderer/home/widgets/`:

```js
module.exports = {
  id: 'agents',                 // stable; never derived from the title
  title: 'Agents',
  icon: Bot,
  sources: ['lanes', 'aiTool'], // what it needs; the board subscribes, not the widget
  defaultSpan: 1,
  defaultEnabled: true,

  isAvailable(ctx),             // "not applicable here" — distinct from "empty"
  mount(el, ctx),               // build DOM once
  update(data, ctx),            // patch in place; the only per-tick entry point
  dispose()
};
```

A `registry.js` holds the ordered list. The board reads a **layout** (enabled
ids, in order) and mounts them into one grid. In this pass the layout *is* the
registry order and nothing is persisted.

Three properties exist now purely so the tenth widget does not force a rewrite:

- **`id` is stable.** Titles change; a layout keyed on a title breaks silently.
- **`isAvailable()` is not an empty state.** Last Sessions under Codex must not
  render an empty card — it must not render. Retrofitting this distinction
  later means touching every widget.
- **`span`** so a future full-width widget (the composer, when it comes) does
  not need a second layout mechanism.

`update()` being the only per-tick entry is part of the contract, not a comment,
because the third widget's author will otherwise write `innerHTML =` and no one
will notice until the CPU graph does.

---

## 4. Supporting changes

### 4.1 The data layer

A new `homeData` module owns **every** subscription once and exposes
`subscribe(source, cb)` / `get(source)`. Widgets never touch `ipcRenderer`.

Sources in this pass: `lanes` (terminals + `laneStatus`), `specs`, `tasks`,
`git`, `sessions` *(new — `LOAD_CLAUDE_SESSIONS`)*, `aiTool`.

This is what makes a future widget cheap: it either uses an existing source, or
adds one — in one place, behind one guard. A widget cannot open its own channel,
so it cannot recreate the 2026-08-20 storm.

### 4.2 The launcher moves

Today `terminalTabBar.js` carries `#ai-tool-selector` (line 145) and
`#sidebar-agent-launch` (line 149).

- **Top bar keeps a bare Start** that launches the default tool. Losing it would
  mean going Home before starting anything.
- **The tool selector moves to the Agents widget.** It is a once-per-project
  decision — `welcomeOverlay.js:168` already sets it during onboarding — so
  permanent chrome for it is the actual waste, not its width.
- **The status bar is not touched.** Its own definition is *"ambient state you
  glance at, as opposed to the top bar's controls you click"*; a dropdown that
  changes what launches is a control. The first exception is how a 26px bar
  becomes a second top bar.
- The widget should use `aiToolSelector`'s `getCurrentTool()` /
  `getAvailableTools()` plus `SET_AI_TOOL` rather than relocate the module —
  `aiToolSelector.js` is a singleton bound to the `#ai-tool-selector` id, and
  moving it is more risk than the feature is worth.

### 4.3 Layout

`.home-group`, `.home-group-title`, `.home-cards`, `.home-cards-solo` and the
`@container` override give way to one grid:

```css
.home-grid { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
```

Four widgets read as 2×2 on a wide board and one column on a narrow one, with
no special case for either. The `min-height` floor moves from the group to the
widget.

**Named consequence:** today the board fits the window exactly and never
scrolls (that is what `flex: 1 1 0` buys). A flat grid whose contents the user
will eventually choose means **Home becomes scrollable**. The default four still
fit one screen; it scrolls when someone adds a fifth. This is a deliberate
trade, not a regression.

### 4.4 Naming

The module is `laneBoard.js` and a recorded convention (terminals-view spec,
2026-08-20) says *code says "lane", user-facing vocabulary says "Terminal" and
"Home"*. With terminals gone from Home, "lane" in this module's name no longer
describes anything it contains.

Renaming to `homeBoard.js` + `home/widgets/` is proposed. It narrows a recorded
decision rather than reversing it — the convention governs *terminal* naming,
and a board that holds no terminals falls outside it. **Because it touches a
recorded decision it must be written up in `PROJECT_NOTES.md`, not done
silently.** `laneStatus.js` and the lane vocabulary elsewhere are untouched.

---

## 5. Decisions

### 5.1 Independent widgets, not named groups

**Chosen:** a flat grid of equals.
**Rejected:** keeping `Work` / `Project planning`. The groups existed to give a
board of three cards a reading order. Their real effect now is a fixed 2+1 shape
that a user-configurable dashboard cannot honour — you cannot let someone reorder
widgets and also insist two of them are "planning".

### 5.2 Agents lists rows, not just counts

**Chosen:** rows, filtered to agent lanes.
**Rejected:** counts only. That was the right call while the Terminals card
existed — a row list of lanes would have duplicated it. With Terminals removed
the duplication argument dies, and the agent-status filter is what keeps this
from becoming Terminals under a new name.

### 5.3 No spec chip on sessions in this pass

**Chosen:** title, time, message count, branch. No chip.
**Why:** `agentDispatch.js:401` states plainly that the lane→spec assignment is
*"Session-scoped — persistence across restarts is out of scope."* A session
record carries no spec field either. The only chip derivable today comes from a
`frame/<slug>/work` branch, which is true for orchestration workers and nothing
else — a chip that appears on a minority of rows for reasons the user cannot see
is worse than no chip.
**Deferred, not dropped:** a persisted `{sessionId → assignment}` map. The hard
part is that the session id does not exist at dispatch time, so it has to be
resolved afterwards by cwd and start time.

### 5.4 Tool selector to the widget, not the status bar

Recorded in §4.2. The rejected option was the user's own first instinct
(status bar, beside the session slot); it was rejected on the status bar's
stated purpose, not on space.

### 5.5 Codex sessions are out of scope

`LOAD_CLAUDE_SESSIONS` is Claude-only and stays that way here. The user
confirmed this is known and being handled separately, so no task is filed from
this spec.

---

## 6. Out of scope

- **The composer** ("what do you want to create") — cut from this pass by the
  user. `span: 'full'` exists in the contract so it lands without a layout
  change.
- **The no-project state** — explicitly deferred; `_renderNoProjectState` stays
  as it is.
- **Persisted widget layout / a settings surface for it.** The contract makes it
  possible; this pass ships nothing user-configurable.
- **Widgets that need new plumbing:** Needs you, Context freshness, Since you
  were away, Branch & working tree, GitHub issues. Parked with reasons in the
  Home card catalogue drafted for this branch.

---

## 7. Success

- Home shows four widgets in one grid, no group headings, no Terminals card.
- Agents lists only agent lanes, ordered approval → input → working, and a row
  enters that lane. With none running it is a working launcher.
- Last Sessions lists three Claude sessions and one click resumes one.
- Specs and Tasks behave exactly as before.
- A fifth widget would be one new file plus one registry line — provable by the
  fact that Agents and Last Sessions were.
- No new IPC channel beyond the `sessions` source, and no widget touching
  `ipcRenderer` directly.
