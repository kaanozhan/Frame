// Supervisor profile reader (main) — Phase I.
//
// Surfaces the per-project profile so the supervisor view's Profile tab can
// render workdir / model / allowed tools / escalate categories / rules /
// budgets without the renderer having to read the filesystem or know which
// of the two profile shapes is canonical for a given project.
//
// Two backing sources, checked in this order:
//   1. <project_path>/.frame/profile.json — Frame-side JSON shape (preferred;
//      see Frame's profileService for the schema). Already a JSON document,
//      no parser dependency required.
//   2. <supervisorRoot>/profiles/<project_id>.yaml — supervisor-side YAML
//      shape. Parsed with js-yaml (already on disk via a transitive
//      dependency; we don't add a direct dep). When js-yaml isn't loadable
//      or parsing fails we still surface the raw text so the renderer can
//      at least show the file content instead of erroring.
//
// Read-only for v1 per the Phase I spec — SAVE_PROFILE is a follow-up.
// All inputs are validated with the same rigor as sibling handlers
// (taskSubmitter, readTaskAudit): typed args, regex-checked project_id,
// resolved-path containment to prevent escape from project_path /
// supervisorRoot.

const fs = require('fs');
const path = require('path');

// 256 KiB cap on either source. profile.json files in the wild are a few KiB;
// the cap mostly defends against an accidental loop or a wrong path pointed
// at a giant JSON blob.
const PROFILE_SIZE_CAP_BYTES = 256 * 1024;
// Project ids in supervisor land are filesystem-friendly slugs. Same shape as
// taskSubmitter's profile-id check — alphanumeric + ._- only.
const SAFE_PROJECT_ID = /^[A-Za-z0-9_.\-]{1,128}$/;

let _yaml = null;
let _yamlAttempted = false;
function loadYaml() {
  if (_yamlAttempted) return _yaml;
  _yamlAttempted = true;
  try { _yaml = require('js-yaml'); }
  catch (err) {
    console.warn('[supervisor-bridge] js-yaml not available; YAML profiles will surface as raw text:', err.message);
    _yaml = null;
  }
  return _yaml;
}

/**
 * Try to read <project_path>/.frame/profile.json. Returns a result object on
 * success or null if the file is absent; throws (caught upstream) on read
 * errors so the caller can decide whether to fall back to YAML.
 */
function readFrameJson(project_path) {
  if (!project_path) return null;
  const abs = path.resolve(project_path, '.frame', 'profile.json');
  // Containment check: resolve project_path too in case it carried '..'.
  const root = path.resolve(project_path);
  if (!abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);
  if (stat.size > PROFILE_SIZE_CAP_BYTES) {
    return {
      ok: false,
      source_path: abs,
      source_type: 'frame-json',
      error: `profile too large (${stat.size} bytes; cap ${PROFILE_SIZE_CAP_BYTES})`,
    };
  }
  const raw = fs.readFileSync(abs, 'utf8');
  let profile;
  try { profile = JSON.parse(raw); }
  catch (err) {
    return {
      ok: false,
      source_path: abs,
      source_type: 'frame-json',
      raw,
      error: `JSON parse failed: ${err.message}`,
    };
  }
  return {
    ok: true,
    source_path: abs,
    source_type: 'frame-json',
    profile,
    raw,
  };
}

/**
 * Try to read <supervisorRoot>/profiles/<project_id>.yaml (or .yml). Returns
 * a result object on success or null if the file is absent. YAML parse
 * failures still produce ok:true with raw text so the panel can render
 * something useful — the error field carries the parse message.
 */
function readSupervisorYaml(supervisorRoot, project_id) {
  if (!supervisorRoot || !project_id) return null;
  const root = path.resolve(supervisorRoot);
  const profilesDir = path.resolve(root, 'profiles');
  // Defensive containment — same idea as the audit handler's check. With a
  // regex-validated project_id this is belt-and-braces but consistency
  // matters across the bridge.
  if (!profilesDir.startsWith(root + path.sep)) return null;
  // Phase N: belt-and-braces. The renderer (profilePanel.js) is supposed to
  // pass a canonical slug, but if any caller hands us a raw display name
  // ("kitli kids") or mixed case ("Localized") we'd rather match the YAML
  // than fail. Try the original, the lowercased form, and the slugified form
  // in order; first file found wins.
  const variants = [];
  const pushVariant = (v) => { if (v && !variants.includes(v)) variants.push(v); };
  pushVariant(project_id);
  pushVariant(project_id.toLowerCase());
  pushVariant(project_id.replace(/\s+/g, '-').toLowerCase());
  pushVariant(
    project_id
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '')
  );
  let abs = null;
  outer: for (const v of variants) {
    for (const ext of ['.yaml', '.yml']) {
      const cand = path.resolve(profilesDir, `${v}${ext}`);
      if (!cand.startsWith(profilesDir + path.sep)) continue;
      try {
        if (fs.existsSync(cand)) { abs = cand; break outer; }
      } catch { /* ignore */ }
    }
  }
  if (!abs) return null;
  const stat = fs.statSync(abs);
  if (stat.size > PROFILE_SIZE_CAP_BYTES) {
    return {
      ok: false,
      source_path: abs,
      source_type: 'supervisor-yaml',
      error: `profile too large (${stat.size} bytes; cap ${PROFILE_SIZE_CAP_BYTES})`,
    };
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const yaml = loadYaml();
  if (!yaml) {
    // No parser available — return raw so the renderer can show the YAML
    // text verbatim instead of erroring.
    return {
      ok: true,
      source_path: abs,
      source_type: 'supervisor-yaml',
      profile: null,
      raw,
      warning: 'js-yaml unavailable; raw text only',
    };
  }
  try {
    const profile = yaml.load(raw);
    return {
      ok: true,
      source_path: abs,
      source_type: 'supervisor-yaml',
      profile,
      raw,
    };
  } catch (err) {
    return {
      ok: true,
      source_path: abs,
      source_type: 'supervisor-yaml',
      profile: null,
      raw,
      warning: `YAML parse failed: ${err.message}`,
    };
  }
}

/**
 * Resolve a profile for the given project, preferring the Frame JSON shape
 * over the supervisor YAML. Returns {ok, source_path, source_type, profile,
 * raw?, error?, warning?}. When neither source is present we return
 * {ok: false, error: 'no profile found'} so the renderer can show an empty
 * state without blowing up.
 */
function read({ project_id, project_path, supervisorRoot } = {}) {
  // Input validation — typed, bounded, regex-checked. Same rigor as the
  // siblings in index.js (readTaskAudit, writeInlineBrief). Phase N: also
  // accept whitespace inside project_id so a caller that hands us a raw
  // display name ("kitli kids") still flows into readSupervisorYaml's
  // variant matcher instead of erroring at the boundary. Path-traversal
  // characters (/, \, NUL) remain forbidden.
  if (project_id != null) {
    if (typeof project_id !== 'string'
      || project_id.length === 0
      || project_id.length > 128
      || /[\/\\\0]/.test(project_id)
      || project_id.includes('..')) {
      return { ok: false, error: 'invalid project_id' };
    }
  }
  if (project_path != null && (typeof project_path !== 'string' || !path.isAbsolute(project_path))) {
    return { ok: false, error: 'project_path must be an absolute path' };
  }
  if (supervisorRoot != null && (typeof supervisorRoot !== 'string' || !path.isAbsolute(supervisorRoot))) {
    return { ok: false, error: 'supervisorRoot must be an absolute path' };
  }
  if (!project_path && !(project_id && supervisorRoot)) {
    return { ok: false, error: 'either project_path or (project_id + supervisorRoot) required' };
  }

  // Prefer the Frame-side .frame/profile.json — it's the canonical per-repo
  // shape and includes the project block (memoryId, name) that the YAML
  // doesn't.
  try {
    const frame = readFrameJson(project_path);
    if (frame) return frame;
  } catch (err) {
    // Read errors are unusual once existsSync passed; surface them so the
    // renderer can flag them rather than silently falling through.
    return {
      ok: false,
      source_type: 'frame-json',
      error: `frame profile read failed: ${err.message}`,
    };
  }

  try {
    const sup = readSupervisorYaml(supervisorRoot, project_id);
    if (sup) return sup;
  } catch (err) {
    return {
      ok: false,
      source_type: 'supervisor-yaml',
      error: `supervisor profile read failed: ${err.message}`,
    };
  }

  return { ok: false, error: 'no profile found' };
}

module.exports = { read, readFrameJson, readSupervisorYaml };
