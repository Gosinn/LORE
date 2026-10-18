import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MediaRef } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { chapters, events, media } from '../db/schema.ts';
import {
  chapterPerson,
  chapterVisible,
  eventParticipant,
  eventVisible,
  idParam,
  isActiveCrewMember,
  isCrewAdmin,
  loadVisibleChapter,
  loadVisibleEvent,
} from '../lib/access.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { sniffImage } from '../lib/images.ts';
import { toMediaRef } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

const UploadScope = z
  .object({ chapterId: z.uuid().optional(), eventId: z.uuid().optional(), crewId: z.uuid().optional() })
  .refine((s) => [s.chapterId, s.eventId, s.crewId].filter(Boolean).length <= 1, 'Upload to one place at a time');

export async function mediaRoutes(app: FastifyInstance, { db, storage }: AppContext) {
  /**
   * Upload one image. Where it's uploaded to decides who may see it later:
   * a chapter (its readers), an event (its viewers), a crew (its members), or,
   * with no scope, a profile picture.
   */
  app.post('/media', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, reply): Promise<MediaRef> => {
    const me = requireUser(req);
    const scope = parse(UploadScope, req.query);

    if (scope.chapterId) {
      const chapter = await loadVisibleChapter(db, me, scope.chapterId);
      if (chapter.createdBy !== me && !(await chapterPerson(db, chapter.id, me))) {
        throw forbidden('Only people in this chapter can add photos to it.');
      }
    } else if (scope.eventId) {
      await loadVisibleEvent(db, me, scope.eventId);
      const p = await eventParticipant(db, scope.eventId, me);
      if (!p || p.rsvp === 'declined') throw forbidden('Join the event to add photos to it.');
    } else if (scope.crewId) {
      if (!(await isCrewAdmin(db, scope.crewId, me))) throw forbidden('Only crew admins can change crew pictures.');
    }

    const file = await req.file();
    if (!file) throw badRequest('Choose a file to upload.');
    const buffer = await file.toBuffer();
    const info = sniffImage(buffer);
    if (!info) throw badRequest('That file type isn’t supported. Use JPEG, PNG, WebP or GIF.');

    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${info.ext}`;
    const size = await storage.put(key, Readable.from(buffer));
    const [row] = await db
      .insert(media)
      .values({
        ownerId: me,
        storageKey: key,
        mimeType: info.mimeType,
        byteSize: size,
        width: info.width,
        height: info.height,
        chapterId: scope.chapterId ?? null,
        eventId: scope.eventId ?? null,
        crewId: scope.crewId ?? null,
      })
      .returning()
      .catch(async (err: unknown) => {
        await storage.delete(key);
        throw err;
      });
    reply.status(201);
    return toMediaRef(row!);
  });

  /** Files are never public URLs: every read re-checks who may see what it belongs to. */
  app.get('/media/:id', async (req, reply) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    const [m] = await db.select().from(media).where(eq(media.id, id)).limit(1);
    if (!m) throw notFound('That file');

    let allowed = true;
    if (m.chapterId) {
      const [c] = await db
        .select({ id: chapters.id })
        .from(chapters)
        .where(and(eq(chapters.id, m.chapterId), chapterVisible(me)))
        .limit(1);
      allowed = !!c;
    } else if (m.eventId) {
      const [e] = await db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.id, m.eventId), eventVisible(me)))
        .limit(1);
      allowed = !!e;
    } else if (m.crewId) {
      allowed = await isActiveCrewMember(db, m.crewId, me);
    }
    if (!allowed) throw notFound('That file');

    reply
      .header('content-type', m.mimeType)
      .header('content-length', m.byteSize)
      .header('cache-control', 'private, max-age=86400, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'");
    return reply.send(storage.get(m.storageKey));
  });

  app.delete('/media/:id', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    const [m] = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.ownerId, me)))
      .limit(1);
    if (!m) throw notFound('That file');
    await storage.delete(m.storageKey);
    await db.delete(media).where(eq(media.id, id));
    return { ok: true };
  });
}

