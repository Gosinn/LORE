// Prepares the iPhone app (apps/ios) for a build. Runs on Windows or a Mac; the build
// itself needs Xcode, so it happens on a Mac or in the cloud
// (.github/workflows/ios.yml, see deploy/ios/README.md).
//
//   node tools/ios.mjs prepare --api https://lore-g8co.onrender.com
//       Builds the web app for that server, copies it into the iOS project and turns
//       on live updates from that server (same as the Android release build).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const iosApp = path.join(root, 'apps', 'ios', 'App', 'App');

const [mode, ...rest] = process.argv.slice(2);
const arg = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

function node(script, args, env = {}) {
  console.log(`> ${script} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'prepare') {
  const api = arg('api');
  if (!api || !api.startsWith('https://')) throw new Error('Pass the server address: --api https://…');
  node('node_modules/vite/bin/vite.js', ['build', '--config', 'apps/web/vite.config.ts'], { VITE_API_URL: api });
  node('node_modules/@capacitor/cli/bin/capacitor', ['sync', 'ios']);
  // Live updates come from our own server only (D23).
  const configFile = path.join(iosApp, 'capacitor.config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.plugins.CapacitorUpdater = {
    ...config.plugins.CapacitorUpdater,
    autoUpdate: 'atBackground',
    updateUrl: `${api.replace(/\/$/, '')}/api/app/updates`,
    statsUrl: '',
    channelUrl: '',
  };
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log(`\niOS project ready in apps/ios (talks to ${api}). Build it with Xcode or the "iOS build" workflow.`);
} else {
  console.log('Usage: node tools/ios.mjs prepare --api https://…');
  process.exit(1);
}
