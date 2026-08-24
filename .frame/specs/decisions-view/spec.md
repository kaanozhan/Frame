# Decisions gets its own center view; Overview retires

> **What we're building:** The Overview screen goes away. The one thing on
> it worth keeping — the Decisions list parsed from PROJECT_NOTES.md — moves
> into the sidebar as its own destination and opens in the center view, the
> same way Tasks and Specs do. The interactive structure map, which was only
> reachable through Overview's Structure card, becomes its own sidebar item.

## User's request (original, Turkish)

> bu overview ekranından da kurtulabiliriz, sadece ordaki decisions ı sol
> panele menüye almak istiyorum ve tıkladığımda bütün lsteyi merkez ekranda
> görmek istiyorum, yani nasıl tasks a tıklayıp taskları görebiliyorsak,
> decisionları da bu şekilde görebilelim.

Two follow-up choices the user made:
- Structure map: **its own sidebar item** (not palette-only, not dropped).
- Decisions layout: **collapsible list + search** (date + title rows, body
  expands in place), not a two-pane detail view and not one long page.

## Why

Overview was a four-card summary — Structure, Progress, Decisions, Stats.
Progress and Stats now duplicate what the Tasks board and the repo itself
show; Structure was a launcher for the map. Decisions was the only card
holding data with no other home, and it was truncated to five rows of
title + date, which is the least useful part of a decision record.

## Goal / Acceptance

- No Overview view anywhere: no sidebar item, no palette entry, no center
  mode, no `overviewPanel` module.
- Sidebar nav has **Decisions** (opens the center list) and **Structure**
  (opens the existing map overlay) where Overview used to sit.
- The Decisions view lists **every** `### [YYYY-MM-DD] Title` entry from
  PROJECT_NOTES.md, newest first, with a count — not a top-N slice.
- A row expands in place to show that decision's full body, rendered as
  markdown; a second click collapses it.
- A search box filters rows by date, title and body text.
- No project selected → the view says so instead of erroring.
- Main process: `LOAD_DECISIONS` (invoke) returns the full list with
  bodies. `LOAD_OVERVIEW` and the already-unused `OVERVIEW_DATA` are
  removed with the screen they served; `GET_FILE_GIT_HISTORY` (used by the
  structure map) is untouched, as is every other channel.
