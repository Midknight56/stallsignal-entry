import { createWorker, type Env } from '../../src/index';
import { Store } from '../../src/engine/store';
import type { CampaignView, Preorder } from '../../src/shared/types';
import { MemoryDatabase } from './database';
import { FakePayPal } from './fake-paypal';

export function world() {
  const db = new MemoryDatabase();
  let now = Date.parse('2026-11-06T12:00:00Z');
  const clock = () => now;
  const store = new Store(db, clock);
  const pp = new FakePayPal(store);
  const worker = createWorker({ fetcher: pp.fetch, clock });
  const env: Env = {
    DB: db,
    ASSETS: { fetch: async () => new Response('static asset') },
    PAYPAL_CLIENT_ID: crypto.randomUUID(),
    PAYPAL_SECRET: 'test-secret',
    PAYPAL_WEBHOOK_ID: 'test-webhook',
  };
  function visitor() {
    let cookie = '';
    const api = async (path: string, body?: object, method = body ? 'POST' : 'GET') => {
      const response = await worker.fetch(
        new Request(`https://stallsignal.test${path}`, {
          method,
          headers: { cookie, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        env,
      );
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
      return response;
    };
    return {
      api,
      async campaign(): Promise<CampaignView> {
        return (await (await api('/api/campaign')).json()) as CampaignView;
      },
      async create(venue = 'wharf', qty = 1, extra = {}): Promise<Preorder> {
        const res = await api('/api/preorders', { venue, product: 'tin', qty, ...extra });
        if (res.status !== 200) throw new Error(JSON.stringify(await res.json()));
        return ((await res.json()) as { preorder: Preorder }).preorder;
      },
      async paid(venue = 'wharf', qty = 1): Promise<Preorder> {
        const row = await this.create(venue, qty);
        pp.approve(row.orderId!);
        const res = await api(`/api/preorders/${row.id}/return`, {});
        if (res.status !== 200) throw new Error(JSON.stringify(await res.json()));
        return ((await res.json()) as { preorder: Preorder }).preorder;
      },
    };
  }
  const webhook = async (event: object, valid = true) => {
    pp.signature = valid;
    return worker.fetch(
      new Request('https://stallsignal.test/webhooks/paypal', {
        method: 'POST',
        headers: {
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api.sandbox.paypal.com/cert/test',
          'paypal-transmission-id': 'transmission-test',
          'paypal-transmission-sig': 'test-signature',
          'paypal-transmission-time': new Date(now).toISOString(),
        },
        body: JSON.stringify(event),
      }),
      env,
    );
  };
  return {
    db,
    store,
    pp,
    worker,
    env,
    visitor,
    webhook,
    advance(ms: number) {
      now += ms;
    },
  };
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
