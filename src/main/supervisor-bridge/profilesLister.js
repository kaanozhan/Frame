// Supervisor profiles lister (main) — Phase D.
//
// Scans <supervisorRoot>/profiles/*.yaml and returns the list of profiles that
// can be passed as the `profile` field of POST /api/queue/tasks. The server
// validates this value as a path under ROOT (see server.py create_task_file),
// so we return both the human label and the project-relative path the server
// will accept verbatim.
//
// Cached for 60s to keep the dropdown snappy without re-scanning per open;
// `{force: true}` busts the cache when the user explicitly refreshes.

const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // key = supervisorRoot, value = {at, items}

function humanise(stem) {
  return stem
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function scan(supervisorRoot) {
  const dir = path.join(supervisorRoot, 'profiles');
  if (!fs.existsSync(dir)) return [];
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const stem = name.replace(/\.ya?ml$/i, '');
    out.push({
      id: stem,
      label: humanise(stem),
      // Project-relative path the supervisor's monitor accepts as `profile`.
      path: `profiles/${name}`,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function list({ supervisorRoot, force } = {}) {
  if (!supervisorRoot) return [];
  const hit = cache.get(supervisorRoot);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.items;
  }
  const items = scan(supervisorRoot);
  cache.set(supervisorRoot, { at: Date.now(), items });
  return items;
}

module.exports = { list };
