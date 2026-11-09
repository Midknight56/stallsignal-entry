import { afterEach, describe, expect, it, vi } from 'vitest';
import { PayPal } from '../src/paypal/client';

describe('PayPal default fetch binding', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the global fetch without binding it as a method', async () => {
    const fetchMock = vi.fn(function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      expect(String(input)).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
      expect(init?.method).toBe('POST');
      return Promise.resolve(Response.json({ access_token: 'test-token', expires_in: 3600 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const pp = new PayPal({
      PAYPAL_CLIENT_ID: crypto.randomUUID(),
      PAYPAL_SECRET: 'test-secret',
      PAYPAL_WEBHOOK_ID: 'test-webhook',
    });
    await expect(pp.getOrder('ORDER')).rejects.toThrow('Payment read unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
