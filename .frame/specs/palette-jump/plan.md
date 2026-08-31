# Plan — palette-jump

## Approach

commandRegistry gains providers: `registerProvider(fn)` where fn returns
ephemeral command-shaped items; getAll() merges them (normalized) and
refreshes a transientById map so runById can execute items that aren't in
the static registry (recents only ever store static ids). A new
paletteSources.js registers four providers — projects (projectListUI data),
terminals (manager.getTerminalStates(true) + laneStatus agent label, focus
via the presence flow), specs (cache subscribed to SPEC_DATA + one warm
LIST_SPECS at init and on project change), and the nine "Go to" view
entries (multiTerminalUI entry points). index.js wires paletteSources after
the palette.

## Footprint

- src/renderer/commandRegistry.js
- src/renderer/paletteSources.js
- src/renderer/index.js
