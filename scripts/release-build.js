#!/usr/bin/env node
/**
 * Release build — electron-builder with the Frame Cloud address baked in.
 *
 * The production address is never in the repository. A release passes it in
 * FRAME_CLOUD_RELEASE_URL, and this wrapper hands it to electron-builder as
 * `-c.extraMetadata.frameCloudUrl=<url>`, which lands in the packaged app's
 * package.json, where cloudSession reads its release default. The
 * repository's package.json is not touched.
 *
 * Only an https address off this machine is passed. A missing, empty,
 * unparsable, http or loopback value is left out with a one-line warning, and
 * the build still runs (Frame Cloud is then off in it), so forks can release
 * without a server of their own.
 *
 * Usage (the dist* npm scripts call it after `npm run build`):
 *   node scripts/release-build.js <electron-builder flags>
 *   const { releaseArgs } = require('./release-build');  # lib
 *
 * Node rather than `$VAR` in package.json: cmd.exe does not expand it.
 */

'use strict';

const { spawnSync } = require('child_process');
const { LOOPBACK_HOSTS } = require('../src/main/cloud/deviceFlow');

const ENV_NAME = 'FRAME_CLOUD_RELEASE_URL';

function refusal(value) {
  if (!value) return `${ENV_NAME} is not set`;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return `${ENV_NAME} is not a URL`;
  }
  if (parsed.protocol !== 'https:') return `${ENV_NAME} is not an https address`;
  if (LOOPBACK_HOSTS.has(parsed.hostname)) return `${ENV_NAME} points at this machine`;
  return null;
}

/**
 * The electron-builder arguments for this release, and the warning to print
 * when the address is left out. Pure. → `{ args, warning }`, warning null when
 * the address is passed.
 */
function releaseArgs(argv, env) {
  const raw = env && typeof env[ENV_NAME] === 'string' ? env[ENV_NAME] : '';
  const url = raw.trim().replace(/\/+$/, '');
  const reason = refusal(url);
  if (reason) {
    return {
      args: [...argv],
      warning: `⚠ ${reason} — Frame Cloud will be off in this build.`,
    };
  }
  return { args: [...argv, `-c.extraMetadata.frameCloudUrl=${url}`], warning: null };
}

if (require.main === module) {
  const { args, warning } = releaseArgs(process.argv.slice(2), process.env);
  if (warning) console.warn(warning);
  const cli = require.resolve('electron-builder/cli.js');
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error(`release-build: could not start electron-builder: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

module.exports = { releaseArgs };
