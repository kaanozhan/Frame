/**
 * Graph Worker
 *
 * Parsing half of the code-graph pipeline: loads web-tree-sitter + the
 * vendored grammar wasm and turns every collected source file into symbol
 * nodes and import edges, then hands assembly/writing to graphBuilder.
 *
 * Runs as an Electron utilityProcess (forked by graphManager) OR as a plain
 * Node child process (the test suite) — it never requires 'electron'.
 * Inputs come via argv/env, progress goes out via whichever port exists:
 *
 *   node graphWorker.js <projectRoot> <wasmDir>
 *   env fallbacks: FRAME_PROJECT_ROOT, GRAPH_WASM_DIR
 *
 * Messages posted: { type: 'progress', parsed, total }
 *                  { type: 'done', meta }
 *                  { type: 'error', message }
 */

const fs = require('fs');
const path = require('path');
const builder = require('./graphBuilder');

/* ------------------------- messaging (port-agnostic) ------------------------ */

function post(msg) {
  if (process.parentPort) {
    // Electron utilityProcess
    process.parentPort.postMessage(msg);
  } else if (process.send) {
    // node child_process.fork
    process.send(msg);
  } else {
    // plain `node graphWorker.js` — still observable
    console.log(JSON.stringify(msg));
  }
}

/* ------------------------------ symbol queries ------------------------------ */

// Capture name = symbol kind. Captures starting with "_" are query-internal.
const JS_SYMBOLS = `
(function_declaration name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)
(class_declaration name: (identifier) @class)
(method_definition name: (property_identifier) @method)
(variable_declarator name: (identifier) @function value: [(arrow_function) (function_expression)])
(program (lexical_declaration (variable_declarator name: (identifier) @const)))
(program (export_statement (lexical_declaration (variable_declarator name: (identifier) @const))))
`;

const TS_SYMBOLS = JS_SYMBOLS + `
(interface_declaration name: (type_identifier) @interface)
(type_alias_declaration name: (type_identifier) @type)
(enum_declaration name: (identifier) @enum)
(abstract_class_declaration name: (type_identifier) @class)
`;

const SYMBOL_QUERIES = {
  javascript: JS_SYMBOLS,
  typescript: TS_SYMBOLS,
  tsx: TS_SYMBOLS,
  python: `
(function_definition name: (identifier) @function)
(class_definition name: (identifier) @class)
`,
  go: `
(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @method)
(type_declaration (type_spec name: (type_identifier) @type))
`,
  rust: `
(function_item name: (identifier) @function)
(struct_item name: (type_identifier) @struct)
(enum_item name: (type_identifier) @enum)
(trait_item name: (type_identifier) @trait)
(mod_item name: (identifier) @module)
`
};

/* ------------------------------ import queries ------------------------------ */

const JS_IMPORTS = `
(import_statement source: (string (string_fragment) @import))
(export_statement source: (string (string_fragment) @import))
(call_expression function: (identifier) @_fn arguments: (arguments (string (string_fragment) @import)) (#eq? @_fn "require"))
(call_expression function: (import) arguments: (arguments (string (string_fragment) @import)))
`;

const IMPORT_QUERIES = {
  javascript: JS_IMPORTS,
  typescript: JS_IMPORTS,
  tsx: JS_IMPORTS,
  python: `
(import_statement name: (dotted_name) @import)
(import_statement name: (aliased_import name: (dotted_name) @import))
(import_from_statement module_name: (dotted_name) @import)
(import_from_statement module_name: (relative_import) @import)
`,
  go: `
(import_spec path: (interpreted_string_literal) @import)
`,
  rust: `
(use_declaration argument: (_) @import)
`
};

/** Go import paths keep their quotes in the CST — strip them. */
function cleanImportText(grammar, text) {
  if (grammar === 'go') return text.replace(/^"|"$/g, '');
  return text;
}

/* --------------------------------- main ----------------------------------- */

async function run(rootDir, wasmDir) {
  const started = Date.now();
  const info = builder.collectSourceFiles(rootDir);

  // Degradation: detection found no languages → meta only, honest status.
  if (info.status === 'no-languages') {
    const meta = builder.writeMetaOnly(rootDir, 'no-languages', info, {
      durationMs: Date.now() - started
    });
    post({ type: 'done', meta });
    return;
  }

  const { Parser, Language, Query } = require('web-tree-sitter');
  await Parser.init({ locateFile: (f) => path.join(wasmDir, f) });

  // Load only the grammars the walk actually needs. A grammar that fails to
  // load degrades to a skipped language, never a crashed build.
  const needed = [...new Set(info.files.map((f) => f.grammar))];
  const grammars = new Map(); // name -> { language, symbolQuery, importQuery }
  for (const name of needed) {
    try {
      const language = await Language.load(path.join(wasmDir, `tree-sitter-${name}.wasm`));
      grammars.set(name, {
        language,
        symbolQuery: new Query(language, SYMBOL_QUERIES[name]),
        importQuery: new Query(language, IMPORT_QUERIES[name])
      });
    } catch (err) {
      info.skippedLanguages.push(name);
      info.capsHit.push(`grammar ${name} failed to load (${err.message || 'unknown'}) — its files skipped`);
    }
  }

  const parser = new Parser();
  const parsed = [];
  let timedOut = false;

  const parseable = info.files.filter((f) => grammars.has(f.grammar));
  for (let i = 0; i < parseable.length; i++) {
    if (Date.now() - started > builder.TIME_BUDGET_MS) {
      info.capsHit.push(
        `time budget (${builder.TIME_BUDGET_MS / 1000} s) hit after ${i}/${parseable.length} files — remaining files skipped`
      );
      timedOut = true;
      break;
    }
    const file = parseable[i];
    const { language, symbolQuery, importQuery } = grammars.get(file.grammar);
    let content;
    try {
      content = fs.readFileSync(file.abs, 'utf-8');
    } catch (e) {
      continue;
    }

    parser.setLanguage(language);
    let tree;
    try {
      tree = parser.parse(content);
    } catch (e) {
      continue; // a single unparseable file never kills the build
    }

    const symbols = [];
    const seen = new Set();
    for (const { name, node } of symbolQuery.captures(tree.rootNode)) {
      if (name.startsWith('_')) continue;
      const line = node.startPosition.row + 1;
      const key = `${node.text}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ name: node.text, kind: name, line });
    }

    const imports = [];
    for (const { name, node } of importQuery.captures(tree.rootNode)) {
      if (name !== 'import') continue;
      const target = cleanImportText(file.grammar, node.text);
      if (target && !imports.includes(target)) imports.push(target);
    }

    tree.delete();
    parsed.push({ id: file.id, grammar: file.grammar, symbols, imports });

    if ((i + 1) % 25 === 0 || i + 1 === parseable.length) {
      post({ type: 'progress', parsed: i + 1, total: parseable.length });
    }
  }
  parser.delete();

  const meta = builder.writeGraph(rootDir, parsed, info, {
    status: timedOut ? 'partial' : 'built',
    durationMs: Date.now() - started
  });
  post({ type: 'done', meta });
}

const rootDir = process.argv[2] || process.env.FRAME_PROJECT_ROOT;
const wasmDir = process.argv[3] || process.env.GRAPH_WASM_DIR;

if (!rootDir || !wasmDir) {
  post({ type: 'error', message: 'usage: graphWorker.js <projectRoot> <wasmDir>' });
  process.exit(1);
}

run(rootDir, wasmDir).catch((err) => {
  // Crash → meta.json records the error so UI/query can say why (matrix).
  try {
    builder.writeMetaOnly(rootDir, 'error', null, { error: err.message || String(err) });
  } catch (e) { /* best effort */ }
  post({ type: 'error', message: err.message || String(err) });
  process.exit(1);
});
