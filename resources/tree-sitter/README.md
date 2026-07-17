# Vendored tree-sitter wasm binaries

Prebuilt WebAssembly artifacts for Frame's code-graph builder
(`src/main/graphWorker.js`). All permissively licensed (MIT) — copyright
notices and license text ship alongside in `LICENSES.md` (required for
redistribution). Bundled with the app via `extraResources` so they live
outside the asar.

## Contents & provenance

| File | Source | Version | License |
| --- | --- | --- | --- |
| `web-tree-sitter.wasm` | npm `web-tree-sitter` (copied from `node_modules/web-tree-sitter/web-tree-sitter.wasm`) | 0.26.11 | MIT |
| `tree-sitter-javascript.wasm` | github.com/tree-sitter/tree-sitter-javascript releases | v0.25.0 | MIT |
| `tree-sitter-typescript.wasm` | github.com/tree-sitter/tree-sitter-typescript releases | v0.23.2 | MIT |
| `tree-sitter-tsx.wasm` | github.com/tree-sitter/tree-sitter-typescript releases | v0.23.2 | MIT |
| `tree-sitter-python.wasm` | github.com/tree-sitter/tree-sitter-python releases | v0.25.0 | MIT |
| `tree-sitter-go.wasm` | github.com/tree-sitter/tree-sitter-go releases | v0.25.0 | MIT |
| `tree-sitter-rust.wasm` | github.com/tree-sitter/tree-sitter-rust releases | v0.24.2 | MIT |

Grammar binaries are the official `.wasm` artifacts attached to each
repository's GitHub release (built by tree-sitter's own CI), e.g.:

```
curl -L -o tree-sitter-javascript.wasm \
  https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.25.0/tree-sitter-javascript.wasm
```

## Rebuilding from source (alternative)

With the tree-sitter CLI (and emscripten or docker) installed:

```
git clone https://github.com/tree-sitter/tree-sitter-javascript
cd tree-sitter-javascript && git checkout v0.25.0
tree-sitter build --wasm   # emits tree-sitter-javascript.wasm
```

## Compatibility

Grammar wasm must be loadable by the pinned `web-tree-sitter` runtime
(language ABI 13–15 for 0.26.x). **Do not** take binaries from the
`tree-sitter-wasms` npm package (0.1.x) — they are built with
tree-sitter-cli 0.20 and fail `web-tree-sitter` ≥ 0.25's dynamic-link
loader. When bumping `web-tree-sitter`, re-run the loader smoke test
(`test/codeGraph.test.js`) against every file here.
