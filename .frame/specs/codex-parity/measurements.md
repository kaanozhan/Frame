# T01 — Codex hook environment, measured

Codex CLI **0.149.1**, macOS, against a scratch `CODEX_HOME` so nothing in the
user's own `~/.codex/` was touched. Every line below was produced by a real
Codex session, not read from documentation.

## 1 · `apply_patch` carries no `file_path`

```json
{ "tool_name": "apply_patch",
  "tool_input": { "command": "*** Begin Patch\n*** Add File: hello.txt\n+world\n*** End Patch" } }
```

The edit tool passes a **patch envelope**, not a path field. `docs-hint` and
`spec-hint` read `tool_input.file_path` today, so for Codex the path has to be
parsed out of `*** Add File:` / `*** Update File:` / `*** Delete File:` lines.

**Confirms** the plan's stated risk and its fallback: the vocabulary needs a
per-tool *path extractor*, not a per-tool field name.

## 2 · The shell tool is called `Bash` — as in Claude Code

```json
{ "tool_name": "Bash", "tool_input": { "command": "wc -l -w -c hello.txt && sed -n '1p' hello.txt" } }
```

Not `shell`, `exec_command` or `local_shell` — those strings exist in the
binary but are not what a hook receives.

**Contradicts the plan.** `module-hint`'s search path and `docs-hint`'s Bash
write-detection port to Codex **unchanged**; the vocabulary's only real job is
the edit role.

## 3 · `UserPromptSubmit` carries `prompt`, as in Claude Code

```json
{ "hook_event_name": "UserPromptSubmit", "prompt": "Create a file named hello.txt …" }
```

`spec-hint`'s prompt mode and `spec-command-hint` port unchanged.

Payloads also carry `turn_id`, `tool_use_id`, `model` and `permission_mode`,
which Claude Code does not send. Nothing Frame reads depends on them.

## 4 · The inline ceiling is at least 20 000 characters

A `SessionStart` hook emitted 2 000 numbered markers (20 000 characters). Asked
for the last marker it could see, the model answered `[MK-01999]` — the last
one generated. **Nothing was truncated and nothing spilled to a file.**

Claude Code's ceiling is exactly 2 000 characters, measured the same way.

**Consequence:** the per-section slicing in `docs-hint` is a Claude constraint,
not a universal one — REFERENCE.md (14.4 KB) fits whole for Codex. The cap
must therefore be **per tool**, and the size test asserts against the tool's
own value rather than one shared number.

## 5 · An `if` shell condition does not gate the hook

```json
{ "type": "command", "command": "…/marker.sh", "if": "test -d .frame" }
```

Run twice — once with `.frame/` present, once without. **The hook executed
both times.** The condition, in this form, is ignored.

**Settles D8 to its fallback:** the in-script early bail stands, and the
~40 ms of node startup per tool call in non-Frame projects is a real cost to
disclose rather than one to design away. A different `if` syntax may exist;
this records only that the natural form does not gate.

## 6 · Trust state is not readable from a plain file

After a run with untrusted hooks: nothing written to `config.toml` about
hooks, no `hooks.state` file, and `state_5.sqlite` carries no hook or trust
table. The hook simply did not run, and nothing on disk said so.

**Changes D4's approach.** Detecting the untrusted state by reading Codex's
internals would couple Frame to an undocumented schema that is not even
populated until the user acts in the TUI. The robust detection is
**behavioural**: the hook itself records a heartbeat, and Frame reports the
untrusted state when hooks are installed but no heartbeat has appeared. That
is schema-independent and already has a place to live — the activity log.

## What this changes for the plan

| Plan assumption | Measured | Effect |
| --- | --- | --- |
| Codex tools are `shell` / `exec_command` | shell tool is `Bash` | vocabulary shrinks to the edit role — T02/T03 get smaller |
| `apply_patch` may carry a path field | it carries a patch envelope | path extractor required, as the fallback anticipated |
| Codex's ceiling needs measuring | ≥ 20 000, no truncation | cap becomes per-tool; Codex needs no section slicing |
| `if` may gate cheaply (D8) | it does not | keep the in-script bail, disclose the cost |
| Trust state may be readable (D4) | it is not | detect behaviourally via a heartbeat, not by reading Codex state |

None of it invalidates a task. T02 and T03 get smaller, T05 changes technique,
and the per-tool cap is a detail T03 now carries.
