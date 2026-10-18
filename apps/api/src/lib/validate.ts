import type { z } from 'zod';
import { badRequest } from './errors.ts';

/** Parse untrusted input; turns validation failures into a 400 with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  const first = Object.values(fields)[0] ?? 'Invalid input';
  throw badRequest(first, fields);
}
