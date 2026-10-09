# T01 — SessionStart hook ground, measured

Claude Code **2.1.295** and Codex CLI **0.160.0**, macOS, run from inside a
Frame terminal. Each CLI was started under `script -q /dev/null` (its own pty,
so it is that tty's foreground job, as in a real Frame lane) with a probe
`SessionStart` hook that dumped `$PPID`, its process ancestry with pgid/tpgid,
the `FRAME_*` env and its stdin. Claude got the hook through `--settings`;
Codex through a scratch `CODEX_HOME/hooks.json` with
`--dangerously-bypass-hook-trust`, so the user's own `~/.codex/` was untouched.

## 1 · The hook inherits the terminal's env

`FRAME_TERMINAL_ID=term-probe`, set in the shell before the CLI started, was
visible inside the hook for both CLIs. `CLAUDECODE=1` is also set in the hook,
for a top-level session too — it cannot tell nested from top-level.

## 2 · Payload

Claude, first start:

```json
{"session_id":"a89de792-…","transcript_path":"/Users/…/.claude/projects/<enc-cwd>/a89de792-….jsonl",
 "cwd":"…","hook_event_name":"SessionStart","source":"startup"}
```

Claude, `--resume a89de792-…`: same `session_id`, `"source":"resume"` (plus
cache/usage fields Frame does not read). The hook re-fires on resume.

Codex, `exec`:

```json
{"session_id":"01a120aa-8786-7e52-ac45-768dd283efac",
 "transcript_path":"<CODEX_HOME>/sessions/2026/10/09/rollout-…-01a120aa-….jsonl",
 "cwd":"…","hook_event_name":"SessionStart","model":"…","permission_mode":"…","source":"startup"}
```

Both send a UUID `session_id` and an absolute `transcript_path` that exists on
disk. Codex ids are UUIDv7-shaped — the 36-char hex-and-dash check in
`resumeClaudeSession` accepts them.

## 3 · `$PPID` is the CLI, and the CLI is the foreground group

```
pid    ppid   pgid   tpgid comm
16549  16536  16549      0 /bin/sh       ← the hook (own group, no tty)
16536  16534  16536  16536 claude        ← $PPID; pgid == tty's tpgid
16534  16533  16533      0 script
16533  14341  16533      0 /bin/zsh      ← this agent's Bash tool
14341  13979  14341  14341 claude        ← the Frame lane's own claude
13979  70331  13979  14341 /bin/zsh      ← the Frame PTY shell
```

Codex: identical shape — `$PPID` is `codex`, whose pgid equals its tty's
tpgid.

The same trace shows the nested case the plan worried about: a CLI started
from a session's Bash tool (`16533` → `script` → `claude`) sits in a different
process group from the Frame PTY's foreground job (`14341`). So the rule
**accept a report only when `pgid($PPID)` equals `tpgid` of the terminal's
shell** keeps the lane's own session and rejects nested ones. `$PPID` is the
right pid — no ancestor walk needed.

## 4 · Not measured

- `/clear` and compaction re-fire: interactive-only; Claude Code documents
  `source` values `startup | resume | clear | compact`. The design does not
  depend on them beyond keeping the mapping current.
- Codex `resume` re-fire: not needed — a restored terminal is registered by
  its claim before the CLI starts.

## Consequence for the plan

The command template stands as planned (`$PPID` in the report filename).
Validation in main: UUID `session_id`, absolute `transcript_path`, live
terminal id, and `pgid($PPID) === tpgid(shellPid)`.
