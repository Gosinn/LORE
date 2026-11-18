// Live text: the owner changes LORE's words in the app and publishes them (lib/copy.ts).
//
// GET /api/copy is public on purpose: Welcome, the Terms and Support are shown signed out, and the
// texts are code words and the owner's words, never anyone's data. Everything under /admin/copy is
// the owner's alone (404 for everyone else, as with moderation).
import type { FastifyInstance } from 'fastify';
import {
  CopyHistoryQuery,
  CopyPublishInput,
  CopyQuery,
  CopyUndoInput,
  type CopyAdminState,
  type CopyFetch,
  type CopyHistory,
  type CopyPublishResult,
  type CopyUndoResult,
} from '#shared';
import type { AppContext } from '../context.ts';
import { requireOwner } from '../lib/access.ts';
import { parse } from '../lib/validate.ts';

export async function copyRoutes(app: FastifyInstance, { db, config, liveCopy }: AppContext) {
  if (!liveCopy) throw new Error('copyRoutes needs the live copy (made by buildApp)');
  const live = liveCopy;
  const owner = (req: Parameters<typeof requireOwner>[0]) => requireOwner(req, { db, config });
  const writes = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  /** The published words. `?v=` with the version you have answers `{ unchanged: true }`. */
  app.get('/copy', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply): Promise<CopyFetch> => {
    const { v } = parse(CopyQuery, req.query);
    await live.refreshIfStale();
    reply.header('cache-control', 'no-cache');
    const state = live.publicState();
    if (v !== undefined && v === live.tag()) return { version: state.version, unchanged: true };
    return state;
  });

  /** Everything edited, with who and when, the last 20 publishes, and the build keys are checked against. */
  app.get('/admin/copy', async (req): Promise<CopyAdminState> => {
    await owner(req);
    return live.adminState();
  });

  /** One text's earlier words (newest first, at most 20). */
  app.get('/admin/copy/history', async (req): Promise<CopyHistory> => {
    await owner(req);
    const { key } = parse(CopyHistoryQuery, req.query);
    return live.history(key);
  });

  /** Publish: new words and texts back to the code's, in one revision. */
  app.put('/admin/copy', { bodyLimit: 2 * 1024 * 1024, ...writes }, async (req): Promise<CopyPublishResult> => {
    const me = await owner(req);
    const input = parse(CopyPublishInput, req.body);
    return live.publish(me, input);
  });

  /** Take a publish back, for the texts nobody changed again since. */
  app.post('/admin/copy/undo', writes, async (req): Promise<CopyUndoResult> => {
    const me = await owner(req);
    const input = parse(CopyUndoInput, req.body);
    return live.undo(me, input);
  });
}
