import { describe, expect, it } from 'vitest';
import { LostResponse, WriteNotSent, PayPal, SANDBOX, type Fetch } from '../src/paypal/client';

function client(fetcher: Fetch, clock: () => number = Date.now) {
  return new PayPal(
    {
      PAYPAL_CLIENT_ID: crypto.randomUUID(),
      PAYPAL_SECRET: 'test-secret',
      PAYPAL_WEBHOOK_ID: 'test-webhook',
    },
    fetcher,
    clock,
  );
}
describe('payment client failures', () => {
  it('token cache refreshes sixty seconds before expiry', async () => {
    let now = 0;
    let tokens = 0;
    const pp = client(
      async (url) =>
        url.endsWith('/token')
          ? (tokens++, Response.json({ access_token: `token${tokens}`, expires_in: 3600 }))
          : Response.json({ id: 'ORDER', status: 'APPROVED' }),
      () => now,
    );
    await pp.getOrder('ORDER');
    await pp.getOrder('ORDER');
    expect(tokens).toBe(1);
    now = 3539000;
    await pp.getOrder('ORDER');
    expect(tokens).toBe(1);
    now = 3540000;
    await pp.getOrder('ORDER');
    expect(tokens).toBe(2);
  });
  it('request ids reach every write and debug ids survive error responses', async () => {
    const ids: (string | null)[] = [];
    const pp = client(async (url, init) => {
      if (url.endsWith('/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
      ids.push(new Headers(init?.headers).get('PayPal-Request-Id'));
      return Response.json(
        { name: 'INSTRUMENT_DECLINED', debug_id: 'body-debug' },
        { status: 422, headers: { 'paypal-debug-id': 'header-debug' } },
      );
    });
    const result = await pp.createOrder({}, 'create-id');
    await pp.captureOrder('ORDER', 'capture-id');
    await pp.refundCapture('CAPTURE', {}, 'refund-id');
    expect(ids).toEqual(['create-id', 'capture-id', 'refund-id']);
    expect(result).toMatchObject({ ok: false, status: 422, debugId: 'header-debug' });
  });
  it('network loss server errors and unreadable write answers all remain uncertain', async () => {
    for (const mode of ['network', 'server', 'body']) {
      const pp = client(async (url) => {
        if (url.endsWith('/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
        if (mode === 'network') throw new TypeError('Connection lost');
        return mode === 'server' ? Response.json({}, { status: 503 }) : new Response('not json');
      });
      await expect(pp.captureOrder('ORDER', 'capture-id')).rejects.toBeInstanceOf(LostResponse);
    }
  });
  it('authentication failure does not falsely claim a payment write was sent', async () => {
    let calls = 0;
    const pp = client(async () => {
      calls++;
      return Response.json({ error: 'invalid_client' }, { status: 401 });
    });
    await expect(pp.captureOrder('ORDER', 'capture-id')).rejects.not.toBeInstanceOf(LostResponse);
    expect(calls).toBe(1);
  });
  it('marks preflight token and serialization failures as unsent for both writes', async () => {
    for (const mode of ['credentials', 'token', 'serialize']) {
      let writes = 0;
      const pp = client(async (url) => {
        if (url.endsWith('/token'))
          return mode === 'token'
            ? Response.json({}, { status: 401 })
            : Response.json({ access_token: 'token', expires_in: 3600 });
        writes++;
        return Response.json({});
      });
      if (mode === 'credentials') pp.env.PAYPAL_SECRET = '';
      const body =
        mode === 'serialize'
          ? {
              toJSON() {
                throw new Error('Cannot serialize');
              },
            }
          : {};
      await expect(pp.createOrder(body, 'create-id')).rejects.toBeInstanceOf(WriteNotSent);
      if (mode !== 'serialize')
        await expect(pp.captureOrder('ORDER', 'capture-id')).rejects.toBeInstanceOf(WriteNotSent);
      expect(writes).toBe(0);
    }
  });
  it('production cannot point the payment client at a live or arbitrary endpoint', () => {
    expect(
      () =>
        new PayPal({
          PAYPAL_CLIENT_ID: 'id',
          PAYPAL_SECRET: 'secret',
          PAYPAL_WEBHOOK_ID: 'hook',
          PAYPAL_BASE: 'https://api-m.paypal.com',
        }),
    ).toThrow('Sandbox endpoint required');
    expect(SANDBOX).toBe('https://api-m.sandbox.paypal.com');
  });
  it('missing signature headers fail before requesting a token', async () => {
    const pp = client(async () => {
      throw new Error('Must not request a token');
    });
    expect(await pp.verifyWebhook(new Headers(), '{}')).toBe(false);
  });
});
