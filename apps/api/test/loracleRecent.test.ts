import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { describeFailure, forgetFailures, noteFailure, recentFailures } from '../src/lib/loracle/recent.ts';
import { townOf } from '../src/lib/loracle/prompts.ts';
import { MindError } from '../src/lib/loracle/types.ts';

describe('the Loracle’s last failures (owner only)', () => {
  afterEach(() => forgetFailures());

  it('reads the API’s own words through the mind’s MindError', () => {
    const message = 'tools.0: web search is not enabled for this organization';
    const api = new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message } }, message, new Headers({ 'request-id': 'req_123' }));
    const d = describeFailure(new MindError('error', { requestId: 'req_123', cause: api }));
    expect(d).toEqual({ status: 400, errorType: 'invalid_request_error', reason: message, where: null, requestId: 'req_123' });
  });

  it('says where in our code a non-API error was thrown', () => {
    let thrown: unknown;
    try {
      townOf(undefined as unknown as string);
    } catch (err) {
      thrown = err;
    }
    const d = describeFailure(new MindError('error', { cause: thrown }));
    expect(d.errorType).toBe('TypeError');
    expect(d.status).toBeNull();
    expect(d.where ?? '').toMatch(/^townOf src\/lib\/loracle\/prompts\.ts:\d+/);
  });

  it('keeps the newest 30, newest first', () => {
    for (let i = 0; i < 35; i++)
      noteFailure({ at: new Date(i * 1000).toISOString(), kind: 'road', failure: 'error', attempt: 1, ms: i, status: null, errorType: null, reason: null, where: null, requestId: null });
    const list = recentFailures();
    expect(list).toHaveLength(30);
    expect(list[0]!.ms).toBe(34);
  });
});
