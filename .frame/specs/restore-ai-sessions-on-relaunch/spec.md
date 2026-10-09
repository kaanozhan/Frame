---
keywords: session restore, relaunch, resume, terminal persistence, claude --resume, codex resume, startup, workspace
related: sessions-from-transcripts, lane-orchestrator, codex-parity
---

# Restore AI sessions on relaunch

## Problem

Quitting and reopening Frame starts from zero: every terminal that was running
an AI session is gone, and the user has to reopen terminals and find and resume
each session by hand. Frame already knows which terminals were open per project,
but `terminalManager.saveProjectSession` only persists the active terminal id
and custom names — not which AI session a terminal was running. Nothing ties a
terminal to a Claude session id today, so there is nothing to resume from.

User's request (original, Turkish):

> frame i kapatıp açtığımızda herşey sıfırdan başlıyor, açık olan terminal
> sessionlarının bilgisine sahibiz zaten, uygulama tekrar açıldığında
> terminalleri ve sessionları açarak başlayabiliriz bence. […] son açık olan
> proje açıldığında gelir ve terminaller ve sessionlar başlatılır. eğer diğer
> projelerde de bu durum varsa, kullanıcı o projeyi açtığında terminaller ve
> sessionlar başlatılır.

> eğer düz bir terminal açıksa, yani zsh bash gibi, ona yapacak bir şey yok.
> onu göz ardı edebiliriz

## Goal

On relaunch, Frame opens the project that was active when it quit and
automatically reopens one terminal per AI session that was running there, each
resuming its session. Other projects with saved sessions restore lazily, the
first time the user opens them in that app run.

- Each terminal records the AI session id running in it, captured reliably (not
  guessed from transcript timestamps) — e.g. via Frame's `SessionStart` hook
  plus a per-terminal identifier passed in the PTY environment.
- Per project, Frame persists the list of AI-session terminals: session id,
  tool, cwd, custom name, order, and which one was active. Persistence survives
  a crash, not only a clean quit.
- Restore is automatic — no confirmation prompt.
- Covers **Claude Code and Codex**: each restored terminal resumes with its
  own tool's resume command (`claude --resume <id>`, Codex's resume command).

## Constraints

- Plain shell terminals (zsh/bash with no AI session) are **not** restored —
  ignored entirely.
- Resume reuses `agentDispatch.resumeClaudeSession` semantics: always a **new**
  terminal, never typed into an existing one (decision from
  `sessions-from-transcripts`).
- Session existence is checked against the transcripts on disk, the source of
  truth established by `sessions-from-transcripts`; `sessions-index.json`
  stays ignored.
- Restoring a non-active project must not happen at launch — only on first open
  of that project in the current run, and only once per run.
- Codex's `SessionStart` hook loads only from `CODEX_HOME/hooks.json` and an
  untrusted hook does not run and says nothing (`codex-parity`). A Codex
  terminal whose session id was never captured is simply not restored — never
  guessed.
- No new runtime dependencies.

## Success Criteria

- When Frame quits with project A active and two Claude sessions running in A,
  then on relaunch A is opened and two terminals start with `claude --resume
  <id>` for those exact sessions, with their custom names and the previously
  active one focused.
- When a project had a plain zsh terminal and one Claude terminal open, then
  only the Claude terminal is restored.
- When project B also had sessions at quit time, then nothing for B starts at
  launch; when the user opens B, its sessions restore; switching away and back
  to B in the same run does not restore them a second time.
- When a saved session's transcript no longer exists, then that session is
  skipped (no dead `--resume`), and the rest still restore.
- When the user closes a terminal (or exits the AI session inside it) before
  quitting, then it is not restored on next launch.
- When Frame crashes instead of quitting cleanly, then the last persisted state
  is still restored on next launch.
- When two terminals run Claude in the same project, then each maps to its own
  session id (no cross-assignment).
- When a project had one Claude and one Codex terminal open, then both restore,
  each resuming its own session with its own CLI.

## Out of Scope

- Restoring plain shell terminals, their scrollback, or their cwd/history.
- Restoring editor tabs, panels, or other UI layout beyond terminals.
- A settings toggle to disable auto-restore.
- Changing the Claude sessions panel or Home's resume list.
- Gemini and OpenCode session restore.

## Open Questions

- **"Last active project" source:** today launch auto-selects `projects[0]` in
  `projectListUI.renderProjects`. Options: (a) persist the active project path
  explicitly at switch/quit; (b) use `workspace.lastOpenedAt`.
