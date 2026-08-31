# Plan — agentlar için roller tanımlamayı düşünüyorum. aklımdaki fikir şöyle. mesela release için bir rol tanımlayacağım. onun ayrı bir klasörü olacak. md dosyaları olacak. bir kere süreci gerçekleştirdiğimizde ne yaptığını md dosylalarına yazacak. bir daha relase aldığımızda ben direkt o role gideceğim. yapacağı adımları artık biliyor olacak. mesela marketing için bir rol oluşturacağım. ilk yaptığımda yine öğrenecek ve localdeki md dosyalarına yazacak. bir dahaki sefere ne yapacağını bilecek. aslında yaptığımız şey bir yerde klasör yaratmak ve roller için md dosyaları yaratmak olacak ve ben yeni sessionı o dizinde açacağım. temel olarak aklımdaki şey böyle

## Architecture

Roles are pure file artifacts. Nothing in the Electron app, no IPC, no manager module — additive to Frame, parallel to (and independent of) `.frame/specs/` and `tasks.json`.

**Layout (per project that adopts roles):**

```
roles/
  <role-name>/
    AGENTS.md         # entry point, AI reads this first on session start
    CLAUDE.md         # symlink → AGENTS.md (Claude Code compat, mirrors root convention)
    playbook.md       # optional, populated after first run with concrete steps/commands
```

**Role `AGENTS.md` template** (sections, in order): `Purpose`, `Steps`, `Commands`, `Notes`. Empty role files mean "first run — capture as we go". Populated files mean "follow these; only ask about deltas". This binary state (empty vs. populated) drives the agent's behavior — no flags, no metadata file.

**Behavior protocol** (lives in role `AGENTS.md` itself, so it works from any AI tool without Frame runtime):
1. Session start → AI reads `AGENTS.md` (and any other md in the folder).
2. If `Steps`/`Commands` are empty → first-run mode: walk the user through, capture decisions.
3. If populated → follow them; ask only about new inputs/changed values.
4. End of run → AI proposes updates to the role's md files; only writes after explicit user approval (mirrors the existing `PROJECT_NOTES.md` capture pattern).

**Role creation** is just `mkdir roles/<name> && cp template files`. Provide a tiny Node script for ergonomics, but the AI can also do it directly with the project's existing tools — the script is convenience, not a requirement.

**Project-level teaching**: a short "Roles" section is added to the project root `AGENTS.md` (already the canonical agent doc, with `CLAUDE.md` symlink) so that when the user says "create a release role" from the repo root, the assistant knows the convention. Inside a role folder, the role's own `AGENTS.md` takes over.

## Files

- **New** `src/templates/roles/AGENTS.md` — starter template for a role's entry-point file. Sections: Purpose, Steps, Commands, Notes. Includes the inline behavior protocol so a role folder is self-contained even for an AI that's never seen Frame.
- **New** `scripts/create-role.js` — small Node CLI: `node scripts/create-role.js <name>`. Validates name (kebab-case, reuses the slug rules from `specManager.generateSlug`-style normalization), creates `roles/<name>/`, copies `src/templates/roles/AGENTS.md`, creates `CLAUDE.md` symlink → `AGENTS.md`. Refuses if folder already exists.
- **Modified** `package.json` — add `"role:new": "node scripts/create-role.js"` to `scripts`. No new deps.
- **Modified** `AGENTS.md` (project root, the canonical doc; `CLAUDE.md` is its symlink) — add a "Roles" section: explain the `roles/<name>/` convention, when to create one (recurring multi-step process the user wants memory of), the create command, the protocol summary, and the "ask before writing" capture rule. Cross-reference: roles are for procedural memory; specs/tasks remain for product work.
- **Modified** `STRUCTURE.json` — auto-updated by `npm run structure` after the script lands; intentIndex picks up "role" → `scripts/create-role.js` and `src/templates/roles/AGENTS.md`. Not edited by hand.

No changes to `src/main/`, `src/renderer/`, IPC channels, or `specManager.js`.

## Dependencies

None. Uses Node `fs`/`path` already available.

## Sequencing

1. **Add the role starter template.** Create `src/templates/roles/AGENTS.md` with Purpose / Steps / Commands / Notes sections plus the inline behavior protocol. Verify it reads as self-sufficient when opened in isolation.
2. **Add the create-role CLI.** Create `scripts/create-role.js` (name validation, mkdir, copy template, symlink `CLAUDE.md` → `AGENTS.md`, refuse on conflict). Wire `"role:new"` into `package.json` scripts. Manually run `npm run role:new test-role` to confirm `roles/test-role/AGENTS.md` and `roles/test-role/CLAUDE.md` symlink land correctly, then delete `roles/test-role/`.
3. **Document the convention at the project root.** Add a "Roles" section to `AGENTS.md` covering: when to create a role, the create command, the per-role protocol, and the "capture only with approval" rule.
4. **Refresh STRUCTURE.json.** Run `npm run structure` so the new files are indexed.
