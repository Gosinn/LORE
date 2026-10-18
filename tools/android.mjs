// Builds the Android app. Run after `. tools/env.ps1` (sets JAVA_HOME, ANDROID_HOME).
//
//   node tools/android.mjs dev [--host 192.168.1.20]
//       An app that loads LORE live from this computer's dev server over Wi-Fi.
//       Start the servers with `npm run dev -- --lan` and keep the phone on the same Wi-Fi.
//
//   node tools/android.mjs release --api https://lore-yourname.duckdns.org [--version 0.1.0]
//       The real app: the web app is bundled inside and talks to the server at --api.
//       Signed with a release key kept outside the repo (D:\LORE-devenv\keystore by
//       default, or LORE_KEYSTORE_DIR). Back that folder up: updates must be signed
//       with the same key.
//
// The APK lands in dist-android/.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const androidDir = path.join(root, 'apps', 'android');
const outDir = path.join(root, 'dist-android');
const logFile = path.join(process.env.TEMP ?? root, 'lore-android-build.log');

const [mode, ...rest] = process.argv.slice(2);
const arg = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

function run(cmd, args, opts = {}) {
  const shown = `${cmd} ${args.join(' ')}`;
  console.log(`> ${shown}`);
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(logFile, `${result.stdout ?? ''}${result.stderr ?? ''}`, { flag: 'a' });
  if (result.status !== 0) {
    console.error(`Failed: ${shown}\nFull log: ${logFile}`);
    console.error(String(result.stderr ?? '').split('\n').slice(-25).join('\n'));
    process.exit(result.status ?? 1);
  }
}

const node = (script, args, env) => run(process.execPath, [path.join(root, script), ...args], { env });
const viteBuild = (env = {}) => node('node_modules/vite/bin/vite.js', ['build', '--config', 'apps/web/vite.config.ts'], env);
const capSync = () => node('node_modules/@capacitor/cli/bin/capacitor', ['sync', 'android']);
// Run from inside apps/android so the repo path (which contains a space) is never
// passed through cmd.exe.
const gradle = (task, env = {}, props = []) =>
  run('cmd.exe', ['/d', '/c', '.\\gradlew.bat', task, '--no-daemon', '--console=plain', ...props], { cwd: androidDir, env });

function lanAddress() {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  return candidates.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) ?? candidates[0];
}

function ensureKeystore() {
  const dir = process.env.LORE_KEYSTORE_DIR ?? 'D:\\LORE-devenv\\keystore';
  const store = path.join(dir, 'lore-release.jks');
  const secrets = path.join(dir, 'keystore.json');
  if (!existsSync(store)) {
    mkdirSync(dir, { recursive: true });
    const password = randomBytes(18).toString('base64url');
    run(path.join(process.env.JAVA_HOME ?? '', 'bin', 'keytool.exe'), [
      '-genkeypair', '-keystore', store, '-storetype', 'PKCS12', '-alias', 'lore',
      '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000',
      '-storepass', password, '-keypass', password, '-dname', 'CN=LORE, O=LORE',
    ]);
    writeFileSync(secrets, JSON.stringify({ alias: 'lore', password }, null, 2));
    console.log(`Created the release signing key in ${dir}. Back this folder up.`);
  }
  const { alias, password } = JSON.parse(readFileSync(secrets, 'utf8'));
  return { LORE_KEYSTORE: store, LORE_KEY_ALIAS: alias, LORE_KEYSTORE_PASSWORD: password };
}

mkdirSync(outDir, { recursive: true });
writeFileSync(logFile, '');

if (mode === 'dev') {
  const host = arg('host') ?? lanAddress();
  if (!host) throw new Error('Could not find this computer’s Wi-Fi address; pass --host.');
  if (!existsSync(path.join(root, 'apps/web/dist/index.html'))) viteBuild();
  capSync();
  // Point the app at the dev server instead of the bundled files.
  const assetConfig = path.join(androidDir, 'app/src/main/assets/capacitor.config.json');
  const config = JSON.parse(readFileSync(assetConfig, 'utf8'));
  config.server = { url: `http://${host}:5173`, cleartext: true };
  writeFileSync(assetConfig, JSON.stringify(config, null, 2));
  gradle('assembleDebug');
  const apk = path.join(outDir, 'LORE-dev.apk');
  copyFileSync(path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk'), apk);
  console.log(`\nBuilt ${apk}\nIt loads http://${host}:5173. Start the servers with: npm run dev -- --lan`);
} else if (mode === 'release') {
  const api = arg('api');
  if (!api || !api.startsWith('https://')) throw new Error('Pass the server address: --api https://…');
  const version = arg('version') ?? JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  const versionCode = major * 10000 + minor * 100 + patch;
  viteBuild({ VITE_API_URL: api });
  capSync();
  const signing = ensureKeystore();
  const props = [`-PloreVersionName=${version}`, `-PloreVersionCode=${versionCode}`];
  gradle('assembleRelease', signing, props);
  gradle('bundleRelease', signing, props);
  const apk = path.join(outDir, `LORE-${version}.apk`);
  copyFileSync(path.join(androidDir, 'app/build/outputs/apk/release/app-release.apk'), apk);
  copyFileSync(path.join(androidDir, 'app/build/outputs/bundle/release/app-release.aab'), path.join(outDir, `LORE-${version}.aab`));
  // Leave the web build as a normal same-origin build again.
  viteBuild();
  console.log(`\nBuilt ${apk} (and an .aab for Google Play) for ${api}`);
} else {
  console.log('Usage: node tools/android.mjs dev [--host IP] | release --api https://… [--version x.y.z]');
  process.exit(1);
}
