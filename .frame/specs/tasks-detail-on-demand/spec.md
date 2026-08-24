# Tasks board — the right aside opens only when it has something to say

> **What we're building:** The Tasks board's right-hand aside stops being
> permanent furniture. It appears only in the two cases that actually need
> it — a task is selected, or the New Task form is open — and closing either
> gives the three columns the full width of the center view.

## User's request (original, Turkish)

> tasks ekranındaki sağ panel biraz rahatsız edici, çok yer kaplıyor,
> taskları görmekte zorlanıyoruz. orası iki case de doluyor gibi, yeni task
> yaratırken ve tasklara tıkladığımızda detay görüntülerken, yeni task için
> zaten buton da var, acaba sadece gerektiği zaman mı açılsa orası, kapatınca
> taskları full görelim, ne dersin?

## Why

The aside occupies `clamp(220px, 26vw, 380px)` at all times — up to 380px of
a center view that is already sharing the window with the sidebar. When
nothing is selected it shows only an "Add a new task" card, which duplicates
the New Task button already sitting in the board header. So the default
state of the board pays its widest cost for its least useful content, and
the three Kanban columns — the reason the screen exists — are squeezed.

## Goal / Acceptance

- The aside is absent from layout (not merely blank) when no task is
  selected and the form is closed; the columns span the full body width.
- Clicking a card opens the aside with that task's detail. Closing it (× or
  Esc) collapses the aside again.
- New Task (header button, `#tasks-dashboard-add`) opens the aside in form
  mode. Cancel / close / submit collapses it — unless a task was selected
  underneath, in which case the detail returns, as today.
- Deleting the selected task, switching project, or a TASKS_DATA push that
  drops the selected task all collapse the aside rather than leaving a
  stranded panel.
- The empty state (`Add a new task` card + "Or click any card…" hint) is
  removed — it existed only to fill an aside that is now hidden. Its entry
  point survives as the header button.
- No main-process / IPC changes: presentation only.
