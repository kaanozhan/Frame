<!-- FRAME AUTO-GENERATED FILE -->
<!-- Purpose: Quick onboarding guide for developers and AI assistants -->
<!-- For Claude: Read this FIRST to quickly understand how to work with this project. Contains setup instructions, common commands, and key files to know. -->
<!-- Last Updated: 2026-07-02 -->

# Frame - Quick Start Guide

## Setup

```bash
# Clone and install
git clone https://github.com/kaanozhan/Frame.git
cd Frame
npm install
```

## Common Commands

```bash
# Development
npm run dev

# Build
npm run build

# Start
npm start

# Build for distribution
npm run dist
```

## Key Files

| File | Purpose |
|------|---------|
| `STRUCTURE.json` | Module map and architecture |
| `PROJECT_NOTES.md` | Decisions and context |
| `tasks.json` | Task tracking |
| `AGENTS.md` | Instructions for AI assistants |
| `CLAUDE.md` | Symlink to AGENTS.md (Claude Code compatibility) |
| `QUICKSTART.md` | This file |

## Project Structure

```
Frame/
├── .frame/           # Frame configuration
├── src/
│   ├── main/         # Electron main process
│   ├── renderer/     # Electron renderer (UI)
│   └── shared/       # Shared modules
├── dist/             # Built renderer bundle
├── release/          # Packaged app (after npm run dist)
└── ...
```

## For AI Assistants (Claude)

1. **First**: Read `STRUCTURE.json` for architecture overview
2. **Then**: Check `PROJECT_NOTES.md` for current context and decisions
3. **Check**: `tasks.json` for pending tasks
4. **Follow**: Existing code patterns and conventions
5. **Update**: These files as you make changes

## Quick Context

Frame is a platform for agentic development, built on Claude Code. Its core idea:
spec-driven development produces durable markdown (spec → plan → tasks → outcome)
that becomes **structural context for future agents** — so an agent months later
arrives knowing *what* was done, *why*, and *what resulted*, instead of scanning
code and guessing. Everything happens in one place (no Jira, no separate spec
tool):
- Spec-driven development (spec → plan → tasks → outcome) as the core workflow
- Agent orchestration — parallel specs in isolated git worktrees, human-approved
- Persistent, structural context across sessions (AGENTS.md, STRUCTURE.json,
  PROJECT_NOTES.md, tasks.json)
- Multi-AI support (Claude Code, Codex, Gemini), with Claude Code as the foundation
- Multi-terminal workbench, task management, GitHub & git panels, file editor
