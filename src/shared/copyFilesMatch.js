/**
 * copyFilesMatch — which gitignored files a new workspace copies from the
 * main checkout (workspaces spec, `settings.workspaces.copyFiles`).
 *
 * A worktree starts with tracked files only, so `.env`, local config and
 * certificates have to be copied in. Patterns follow the shape people know
 * from .gitignore, without adding a glob dependency:
 *
 *   - a pattern with no `/` matches a file or directory name at any depth
 *     (`.env*` matches `.env`, `.env.local`, `apps/web/.env`)
 *   - a pattern containing `/` is anchored at the repo root
 *     (`config/local.json`, `certs/**`)
 *   - `*` matches within one path segment, `?` one character,
 *     `**` any number of segments (including none)
 *   - blank lines and lines starting with `#` are ignored
 *
 * Paths inside `node_modules/` or `.git/` never match, whatever the pattern
 * says — copying dependencies or git internals into a worktree is never what
 * a user meant.
 *
 * Pure by design: paths in, booleans out.
 */

const DEFAULT_COPY_FILES = Object.freeze(['.env*']);

const NEVER = new Set(['node_modules', '.git']);

function normalize(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function escapeRegex(ch) {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/** Translate one glob (already split of its anchor) into a regex source. */
function globToRegexSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` → zero or more whole segments; a trailing `**` → anything.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeRegex(ch);
    }
  }
  return out;
}

/** Compile one pattern line into a tester, or null for blank/comment lines. */
function compilePattern(line) {
  let glob = String(line || '').trim();
  if (!glob || glob.startsWith('#')) return null;
  glob = glob.replace(/\\/g, '/').replace(/\/+$/, '');
  const anchored = glob.includes('/');
  glob = glob.replace(/^\//, '');
  if (!glob) return null;
  // `dir/**` also selects `dir` itself: git lists a fully ignored folder
  // collapsed (`certs/`), with no files under it (workspace-hardening L10).
  if (glob.endsWith('/**')) {
    const dirSource = globToRegexSource(glob.slice(0, -3));
    const whole = new RegExp(`^${dirSource}$`);
    const inner = compilePattern(glob.slice(0, -3) + '/**/*');
    return (relPath) => whole.test(relPath) || inner(relPath);
  }
  const source = globToRegexSource(glob);
  // Anchored: the whole relative path (or a parent directory of it) matches.
  // Unanchored: any single path segment — or, for a directory match, the
  // path up to that segment — matches.
  const re = anchored
    ? new RegExp(`^${source}(?:/.*)?$`)
    : new RegExp(`(?:^|/)${source}(?:/.*)?$`);
  return (relPath) => re.test(relPath);
}

/**
 * Compile a list of pattern lines (or one newline-separated string) into a
 * matcher `(relPath) => boolean`. Falls back to DEFAULT_COPY_FILES when the
 * input is undefined/null; an explicit empty list matches nothing.
 */
function compile(patterns) {
  const lines = patterns == null
    ? DEFAULT_COPY_FILES
    : (typeof patterns === 'string' ? patterns.split(/\r?\n/) : patterns);
  const testers = lines.map(compilePattern).filter(Boolean);
  return (relPath) => {
    const p = normalize(relPath);
    if (!p) return false;
    if (p.split('/').some((seg) => NEVER.has(seg))) return false;
    return testers.some((t) => t(p));
  };
}

/** Filter candidate relative paths down to the ones the patterns select. */
function selectFiles(candidates, patterns) {
  const match = compile(patterns);
  return (candidates || []).filter((c) => match(c));
}

/**
 * Collapsed ignored folders (`secrets/`) that an anchored pattern reaches
 * into (`secrets/*.key`) without selecting the folder whole: the caller lists
 * the files inside them and filters those again (workspace-hardening L10).
 * Unanchored patterns never expand a folder — that would walk every ignored
 * directory for a `.env*`.
 */
function dirsToExpand(candidates, patterns) {
  const lines = patterns == null ? DEFAULT_COPY_FILES : (typeof patterns === 'string' ? patterns.split(/\r?\n/) : patterns);
  const match = compile(patterns);
  const prefixes = lines
    .map((l) => String(l || '').trim().replace(/\\/g, '/'))
    .filter((l) => l && !l.startsWith('#') && l.replace(/\/+$/, '').includes('/'))
    .map((l) => l.replace(/^\//, ''))
    .map((l) => l.slice(0, l.search(/[*?]|$/)));
  return (candidates || []).filter((c) => {
    if (!String(c).endsWith('/')) return false;
    const dir = normalize(c);
    if (!dir || dir.split('/').some((seg) => NEVER.has(seg)) || match(dir)) return false;
    return prefixes.some((p) => p.startsWith(`${dir}/`) || (p && `${dir}/`.startsWith(p)));
  });
}

module.exports = { DEFAULT_COPY_FILES, compile, selectFiles, dirsToExpand, normalize };
