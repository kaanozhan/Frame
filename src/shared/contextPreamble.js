/**
 * contextPreamble — the short text Frame injects when it launches an AI tool.
 *
 * Frame no longer plants a `CLAUDE.md` symlink at the project root, so a tool
 * can no longer stumble onto Frame's conventions by itself. Instead the
 * conventions are handed over at launch, as **pointers**:
 *
 *   Frame global   — userData/frame-global/AGENTS.md   (Frame, every project)
 *   Frame project  — .frame/AGENTS.md, when present    (Frame, this project)
 *   Repo native    — the repo's own CLAUDE.md / AGENTS.md / …  (the repo)
 *
 * ── Pointers, never content ──
 * Nothing is copied out of any file. The preamble names paths and lets the
 * agent read them, so nothing can go stale, no context is duplicated into the
 * command line, and the day these layers stop being files in the working tree
 * only the path changes — not this composition.
 *
 * ── Precedence is by domain, not by order ──
 * The repo's instruction file stays authoritative for code conventions;
 * Frame's layers are authoritative for the Frame meta-workflow. Layer order
 * decides nothing, which is why the preamble states the split outright instead
 * of leaving an agent to infer it from what came first.
 *
 * ── Per tool ──
 * A tool that reads the repo's file natively (Claude Code, Gemini CLI) is left
 * to do so and is only pointed at the Frame layers. A tool with no such
 * convention is told to read the repo's file too. Which tools are which is
 * `aiToolManager`'s business; this module only takes `toolId` and asks.
 *
 * Pure: no fs, no Electron, no process. Give it the same input twice and get
 * the same string.
 */

// Tools that find the repo's own instruction file without being told.
const NATIVE_READERS = {
  claude: 'CLAUDE.md',
  gemini: 'GEMINI.md'
};

/**
 * The domain split, spelled out.
 *
 * The enumeration of Frame's side is conditional for one reason: with
 * spec-driven off, naming "the spec workflow" as part of Frame's domain is
 * still telling an agent that specs are a thing here. A project with the
 * feature off gets no mention of specs anywhere — not an instruction against
 * them, simply nothing.
 */
function precedenceSentence(specDriven) {
  const domain = specDriven === true
    ? 'recognizing a task, capturing a note, the spec workflow, keeping the structure map current'
    : 'recognizing a task, capturing a note, keeping the structure map current';
  return `Where these disagree: the repository owns its code conventions, Frame owns the meta-workflow (${domain}).`;
}

function bullet(label, target) {
  return `- ${label}: \`${target}\``;
}

/**
 * Compose the preamble.
 *
 * @param {object} input
 * @param {string} input.globalPath        - userData/frame-global/AGENTS.md
 * @param {string} [input.projectLayerPath]- .frame/AGENTS.md, when it exists
 * @param {Array}  [input.nativeFiles]     - [{ path, kind }] from instructionDiscovery
 * @param {string} [input.toolId]          - 'claude' | 'codex' | 'gemini' | …
 * @param {boolean}[input.specDriven]      - features.specDriven for this project
 * @returns {string} the preamble, or '' when there is nothing to say
 */
function compose(input) {
  const opts = input || {};
  const globalPath = opts.globalPath || '';
  const projectLayerPath = opts.projectLayerPath || '';
  const nativeFiles = Array.isArray(opts.nativeFiles) ? opts.nativeFiles : [];
  const toolId = opts.toolId || '';
  const specDriven = opts.specDriven === true;

  // Without the global layer there is no Frame context to point at, and a
  // preamble that only says "read your own files" is worse than silence.
  if (!globalPath) return '';

  const lines = [];
  lines.push(
    'Frame context for this session. These files are not loaded for you — read them before you start:'
  );
  lines.push('');
  lines.push(bullet("Frame's conventions (all projects)", globalPath));
  if (projectLayerPath) {
    lines.push(bullet("This project's Frame context", projectLayerPath));
  }

  const nativeReader = NATIVE_READERS[toolId];
  const selfRead = nativeFiles.filter((f) => f && f.path && endsWith(f.path, nativeReader));
  const toRead = nativeFiles.filter((f) => f && f.path && !endsWith(f.path, nativeReader));

  for (const file of toRead) {
    lines.push(bullet("This repository's own instructions", file.path));
  }

  if (selfRead.length) {
    lines.push('');
    lines.push(
      `This repository's \`${nativeReader}\` is yours to read as usual — Frame has not modified it.`
    );
  }

  lines.push('');
  lines.push(precedenceSentence(specDriven));

  if (specDriven) {
    lines.push('');
    lines.push(
      'Spec-driven development is active in this project: significant work goes through a spec ' +
      '(spec.md → plan.md → tasks.md) before code — trivial changes just get done, small tracked ' +
      'work becomes a task, a sizable feature or multi-file change becomes a spec. Offer it once, ' +
      'never force it. The full protocol is in the "Spec-Driven Development" section of the Frame ' +
      'reference beside the file above.'
    );
  }

  lines.push('');
  lines.push('Frame writes only inside `.frame/`. Never edit files outside it on Frame\'s behalf.');

  return lines.join('\n');
}

function endsWith(filePath, name) {
  if (!name) return false;
  const normalized = String(filePath).replace(/\\/g, '/');
  return normalized === name || normalized.endsWith(`/${name}`);
}

module.exports = { compose, precedenceSentence, NATIVE_READERS };
