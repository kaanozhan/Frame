# Codebase understanding & agent-readiness on onboarding (code graph)

> **Status:** Capture only. This spec records an idea the user wants to
> revisit and discuss before planning. It is not yet scoped for
> implementation — treat the sections below as a starting point for the
> `/spec` → `/spec.plan` conversation, not as final decisions.

## Why

When a user brings an **existing software project** into Frame, the
agent starts cold. Today Frame's only "understanding" layer is
`STRUCTURE.json` — an intent index built by `scripts/update-structure.js`,
which:

- only walks `src/`-based, CommonJS, single-package JS layouts
  (see the `structure-non-standard-layouts` spec), and
- captures a shallow module map (path, purpose, exports, depends) —
  not the deeper relationships an agent needs to reason about a
  large unfamiliar codebase (call graphs, who-imports-what,
  data flow, entry points, dead code, blast radius of a change).

The result: on a real existing project, the agent has to rediscover
the codebase from scratch every session via grep/glob. That is slow,
burns context, and produces shallow mental models.

The idea: at **onboarding time** (and refreshable on demand), build a
richer, **graph-based** understanding of the codebase using a
**graph / code-intelligence open-source solution**, and persist it in a
form the agent can query cheaply — so any agent (a Frame lane, a
conductor, a worker) starts "warm" with a real map of the project.

## Open question — which open-source engine?

The user mentioned "graphy tarzı" (a graph-style tool). To evaluate
during planning. Candidate categories to investigate:

- **Code-graph / index engines** — e.g. SCIP / LSIF indexers
  (Sourcegraph), `ctags`/`tree-sitter`-based symbol graphs,
  `ast-grep`, Stack Graphs (GitHub's precise code-nav).
- **Dependency / import graphs** — e.g. `madge`, `dependency-cruiser`
  (JS/TS), language-native tools for Python/Go/Rust.
- **Graph storage / query** — whether we need an actual graph DB
  (e.g. embedded SQLite-based, KuzuDB, Neo4j) or a flat JSON/SCIP
  artifact is enough for agent consumption.
- **"Graphy"-style / GraphRAG approaches** — building a knowledge
  graph over the repo and exposing it to the agent (possibly with
  embeddings for semantic lookup).

Decision driver: must work **language-agnostically enough** for the
projects Frame targets, run **locally** (no cloud dependency / no
sending the user's code out), and be **fast to (re)build incrementally**.

## Decision (2026-07-06) — tree-sitter, permissive-OSS, delegate the commodity layer

Two decisions from the Q3 review discussion (see `.frame/FINDINGS-*.md` and the
2026-07-02 vision note in `PROJECT_NOTES.md`):

**1. Reframe: the code map is a commodity, *derived* layer — delegate it.**
`STRUCTURE.json` today conflates two things: the **code map** (where/what — symbols,
files, imports; regenerable, *not* the moat) and the **intent/why** layer
(intentIndex, architectureNotes, and above all the spec → plan → outcome corpus —
the moat). The hand-rolled regex parser (`update-structure.js`) is
JS/`src/`/CommonJS-hardcoded (see `audit-q3-generic-any-project`) and is the wrong
place to spend effort — real OSS engines do multi-language code mapping far better.
So **delegate the code-map layer to a best-in-class OSS engine** and keep Frame's
scarce effort on the intent corpus. This also directly fixes the "only works on
Frame's own repo" genericity break.

**2. Engine: tree-sitter is the lead candidate, gated by a hard OSS/licensing
constraint.**
Selection criteria — hard constraints, not preferences:
- **Permissive OSS (MIT/Apache/BSD)** — must be license-compatible with Frame's
  Apache-2.0 app *and* a future proprietary Frame Server; bundleable/redistributable.
- **Local, embeddable, no cloud / no service dependency** — never send the user's
  code off-machine (Frame is a home for private code; privacy is a hard line).
- **Multi-language** — the whole point is *any* project, not JS.

Against those:
- **tree-sitter (MIT)** is the lead: permissive, embeddable (bindings, not a separate
  service), multi-language (grammars mostly MIT/Apache), ships bundled with zero user
  install. tree-sitter *alone* = **syntax level** (symbols, structure, "what's in this
  file"). Per decision #1 (the map is the commodity/orientation layer, not the moat),
  syntax-level is likely **sufficient to orient an agent — start here.**
- **Semantic graph** (cross-file refs / call graph), only if syntax-level proves
  insufficient: **stack-graphs** (GitHub, MIT/Apache, tree-sitter-based) or **SCIP**
  (Sourcegraph, Apache-2.0) — both permissive but heavier (SCIP needs per-language
  indexers → cuts against the one-place / zero-install goal). Defer until proven
  necessary.
- **universal-ctags is GPLv2** → flagged: invoking it as a separate binary is likely
  fine (mere aggregation), but bundling/redistribution carries GPL obligations and it
  cannot be statically linked into a proprietary server. Prefer tree-sitter to avoid
  the question entirely.
- Closed / SaaS code-intelligence APIs are **out** (lock-in, privacy, cost).

Net: **lead with tree-sitter (syntax-level map); permissive-OSS + local are hard
constraints; semantic graph (stack-graphs / SCIP) deferred until proven necessary.**
The engine feeds a *file* artifact — canonical files stay the source of truth; it is
not a service dependency for local use.

## What's (tentatively) in scope

- A codebase-analysis step triggered when a project is onboarded into
  Frame (and a manual "re-analyze" action).
- Building a code graph (symbols, files, imports/dependencies, and
  ideally call/reference edges) with a chosen OSS engine.
- Persisting the result as an artifact the agent can read/query
  cheaply — extending or complementing `STRUCTURE.json`, not
  duplicating it. Decide: enrich `STRUCTURE.json`, or new artifact
  (e.g. `.frame/graph/`)?
- A way for the agent to query the graph (a `scripts/` helper akin to
  `find-module.js`, or an MCP-style tool surface).
- Surfacing analysis progress/state in the Frame UI on first open.

## What's (tentatively) out of scope — confirm during planning

- Replacing `STRUCTURE.json` entirely.
- Real-time/continuous re-indexing on every file change (start with
  on-onboarding + manual refresh; incremental watch is a later step).
- Shipping our own language analyzers — we adapt an existing OSS
  engine, we don't build parsers.
- Cloud-hosted indexing or anything that sends the user's code to a
  third party.

## Success criteria (draft)

- Onboarding an existing project produces a queryable codebase graph
  locally, without sending code off-machine.
- An agent opened on a freshly-onboarded project can answer
  "where is X / what calls Y / what does changing Z affect" from the
  artifact instead of cold grep.
- Works on at least one real non-trivial existing project (not just
  Frame's own repo).

## Notes / to discuss

- Relationship to `structure-non-standard-layouts`: that spec fixes
  the *shallow* index for non-`src/` layouts; this spec is the
  *deeper* graph layer. They may share the language-detection /
  layout-discovery groundwork. Sequence them.
- Privacy/local-first is a hard constraint (Frame is a desktop home
  for the user's own code).
- Performance budget for large repos (10k+ files) needs a number.
