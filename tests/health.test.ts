import { describe, expect, it } from 'vitest';
import worker from '../src/index';

describe('GET /health', () => {
  it('returns a healthy response without reading assets', async () => {
    const response = await worker.fetch(new Request('https://stallsignal.test/health'), {
      ASSETS: {
        fetch: async () => {
          throw new Error('assets should not be called');
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
