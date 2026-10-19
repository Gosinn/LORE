// Live updates for the Android app (Capacitor Updater, self-hosted).
//
// The APK carries a copy of the web app. On each launch the app asks this server
// whether a newer build exists; if so it downloads the zipped web app from here and
// switches to it the next time it goes to the background. Only web code changes
// this way (allowed by Google Play: JavaScript in a WebView); anything native still
// needs a new APK. Nothing is sent to third parties.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.ts';
import { notFound } from '../lib/errors.ts';
import { createZip, type ZipEntry } from '../lib/zip.ts';

const APP_ID = 'com.gosinn.lore';

interface Bundle {
  build: string;
  zip: Buffer;
  sha256: string;
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

export async function appUpdateRoutes(app: FastifyInstance, { config }: AppContext) {
  const publicDir = path.resolve(config.publicDir);
  const buildFile = path.join(publicDir, 'build.json');
  const build: string | null = existsSync(buildFile)
    ? (JSON.parse(readFileSync(buildFile, 'utf8')) as { build?: string }).build ?? null
    : null;

  // Built once per server origin, then kept in memory (the web app is ~1 MB zipped).
  const bundles = new Map<string, Bundle>();
  const origin = (req: FastifyRequest) => `${req.protocol}://${req.host}`;

  function bundleFor(apiBase: string): Bundle {
    const cached = bundles.get(apiBase);
    if (cached) return cached;
    const entries: ZipEntry[] = listFiles(publicDir)
      .map((rel) => rel.split(path.sep).join('/'))
      .sort()
      .map((name) => {
        let data = readFileSync(path.join(publicDir, name));
        if (name === 'index.html') {
          // Tell the packaged app which server to talk to.
          data = Buffer.from(
            data.toString('utf8').replace('<meta name="lore-api-base" content="" />', `<meta name="lore-api-base" content="${apiBase}" />`),
          );
        }
        return { name, data };
      });
    const zip = createZip(entries);
    const bundle = { build: build!, zip, sha256: createHash('sha256').update(zip).digest('hex') };
    bundles.set(apiBase, bundle);
    return bundle;
  }

  /** The update check the plugin makes on launch (its self-hosted protocol). */
  app.post('/app/updates', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const body = (req.body ?? {}) as { app_id?: string; version_name?: string; platform?: string };
    if (!build || (body.app_id && body.app_id !== APP_ID)) {
      return { error: 'no_new_version_available', message: 'No new version available', kind: 'up_to_date' };
    }
    if (body.version_name === build) {
      return { error: 'no_new_version_available', message: 'No new version available', kind: 'up_to_date' };
    }
    const bundle = bundleFor(origin(req));
    return {
      version: build,
      url: `${origin(req)}/api/app/bundle/${build}.zip`,
      checksum: bundle.sha256,
    };
  });

  app.get('/app/bundle/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!build || file !== `${build}.zip`) throw notFound('That update');
    const bundle = bundleFor(origin(req));
    reply
      .header('content-type', 'application/zip')
      .header('content-length', bundle.zip.length)
      .header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(bundle.zip);
  });

  /** Which web build this server serves (also handy for checking a deploy). */
  app.get('/app/version', async () => ({ build }));
}
