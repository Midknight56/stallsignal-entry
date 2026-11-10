import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { world } from './helpers/world';
import { MemoryDatabase } from './helpers/database';
import { vi } from 'vitest';
import { SANDBOX } from '../src/paypal/client';

describe('routing and session failures', () => {
  it('does not run the Worker first for Studio paths', () => {
    const config = JSON.parse(
      readFileSync(new NodeURL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
    );
    expect(config.assets.run_worker_first).toEqual(['/api/*', '/webhooks/*', '/health']);
    expect(config.assets.not_found_handling).toBe('single-page-application');
  });
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });
  afterEach(() => {
    w.db.close();
  });
  it('reports model readiness from the current ledger without a model call', async () => {
    const ledger = new MemoryDatabase();
    ledger.sqlite.exec(
      'CREATE TABLE ai_calls(id INTEGER PRIMARY KEY,app TEXT,day TEXT,neurons REAL,at TEXT)',
    );
    const model = { run: vi.fn() };
    const read = async (env: Parameters<typeof w.worker.fetch>[1]) => {
      const response = await w.worker.fetch(new Request('https://stallsignal.test/api/world'), env);
      return (await response.json()) as { agent: { available: boolean } };
    };
    try {
      expect((await read(w.env)).agent.available).toBe(false);
      expect((await read({ ...w.env, AI: model as never })).agent.available).toBe(false);
      const env = { ...w.env, LEDGER: ledger as never, AI: model as never };
      expect((await read(env)).agent.available).toBe(true);
      ledger.sqlite
        .prepare('INSERT INTO ai_calls(app,day,neurons,at) VALUES(?,?,?,?)')
        .run('stallsignal', '2026-11-06', 885, '2026-11-06T12:00:00Z');
      expect((await read(env)).agent.available).toBe(true);
      ledger.sqlite
        .prepare('INSERT INTO ai_calls(app,day,neurons,at) VALUES(?,?,?,?)')
        .run('stallsignal', '2026-11-06', 1, '2026-11-06T12:00:00Z');
      expect((await read(env)).agent.available).toBe(false);
      expect(
        (
          await read({
            ...env,
            LEDGER: {
              prepare() {
                throw new Error('offline');
              },
            } as never,
          })
        ).agent.available,
      ).toBe(false);
      expect(model.run).not.toHaveBeenCalled();
    } finally {
      ledger.close();
    }
  });
  it('world labels synthetic data and the uncaptured recorded run without needing storage', async () => {
    const response = await w.worker.fetch(new Request('https://stallsignal.test/api/world'), {
      ASSETS: w.env.ASSETS,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      city: { label: string };
      history: { label: string }[];
      heat: { label: string }[];
      modes: string[];
      recorded: {
        recordedAt: string;
        label: string;
        preorders: { payerName?: string; payerEmail?: string; address?: string }[];
      };
    };
    expect(body.city.label).toBe('Real streets');
    expect(body.modes).toContain('Example venues');
    expect(body.history.every((h) => h.label === 'Forecast history')).toBe(true);
    expect(body.heat.every((h) => h.label === 'Daytime workers, 2024')).toBe(true);
    expect(body.recorded.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.recorded.label).toBe('Recorded run');
    expect(body.recorded.preorders).toHaveLength(9);
    expect(
      body.recorded.preorders.every((p) => !('payerName' in p) && !('payerEmail' in p) && !('address' in p)),
    ).toBe(true);
  });
  it('session cookie is a random 128 bit HttpOnly Lax cookie and persists one campaign', async () => {
    const first = await w.worker.fetch(new Request('https://stallsignal.test/api/campaign'), w.env);
    const cookie = first.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^ss_sid=[a-f0-9]{32}; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    const second = await w.worker.fetch(
      new Request('https://stallsignal.test/api/campaign', { headers: { cookie: cookie.split(';')[0] } }),
      w.env,
    );
    expect(await second.json()).toEqual(await first.json());
    expect(second.headers.has('set-cookie')).toBe(false);
  });
  it('an unknown or malformed session cookie is replaced rather than trusted', async () => {
    for (const cookie of ['ss_sid=bad', 'ss_sid=' + 'a'.repeat(32)]) {
      const response = await w.worker.fetch(
        new Request('https://stallsignal.test/api/campaign', { headers: { cookie } }),
        w.env,
      );
      expect(response.headers.has('set-cookie')).toBe(true);
    }
  });
  it('cross session preorder return reconcile and retry all return 403', async () => {
    const owner = w.visitor();
    const p = await owner.paid();
    const other = w.visitor();
    for (const route of [
      `/api/preorders/${p.id}/return`,
      `/api/preorders/${p.id}/reconcile`,
      `/api/campaign/refunds/${p.id}/retry`,
    ]) {
      const response = await other.api(route, {});
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'NOT_YOUR_CAMPAIGN' });
    }
    expect(w.pp.count('refund')).toBe(0);
  });
  it('cross session campaign identifiers cannot be closed reset or used to create', async () => {
    const owner = w.visitor();
    const c = await owner.campaign();
    const other = w.visitor();
    for (const path of ['/api/campaign/close', '/api/campaign/reset', '/api/preorders']) {
      const response = await other.api(path, { campaignId: c.id, venue: 'mill', product: 'tin', qty: 1 });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'NOT_YOUR_CAMPAIGN' });
    }
  });
  it('passes Studio paths and other asset requests to ASSETS unchanged', async () => {
    const requested: Request[] = [];
    const env = {
      ASSETS: {
        fetch: async (request: Request) => {
          requested.push(request);
          return new Response('Asset response');
        },
      },
    };
    for (const path of ['/studio?mock=1', '/studio/?mock=1']) {
      const response = await w.worker.fetch(
        new Request(`https://stallsignal.test${path}`, { headers: { 'accept-language': 'en' } }),
        env,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Asset response');
      expect(requested.at(-1)).toBeInstanceOf(Request);
      expect(requested.at(-1)?.url).toBe(`https://stallsignal.test${path}`);
      expect(requested.at(-1)?.headers.get('accept-language')).toBe('en');
    }
    for (const path of ['/', '/about', '/campaign', '/studio-other', '/assets/app.js']) {
      const request = new Request(`https://stallsignal.test${path}`);
      expect(await (await w.worker.fetch(request, env)).text()).toBe('Asset response');
      expect(requested.at(-1)).toBe(request);
    }
  });
  it('static requests use the asset binding while unknown API routes return JSON', async () => {
    expect(await (await w.visitor().api('/about')).text()).toBe('static asset');
    const response = await w.visitor().api('/api/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'NOT_FOUND', message: 'Route not found.' });
  });
  it('agent routes answer with offline fallbacks without model or storage bindings', async () => {
    for (const path of ['/api/agent', '/api/ask']) {
      const response = await w.worker.fetch(
        new Request(`https://stallsignal.test${path}`, {
          method: 'POST',
          body: JSON.stringify(path === '/api/ask' ? { q: 'refunds' } : { budget: 90000 }),
        }),
        { ASSETS: w.env.ASSETS },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ source: path === '/api/ask' ? 'matched' : 'code' });
    }
    expect(w.pp.requests).toEqual([]);
  });
  it('production dev routes return 404 and cannot set a fault', async () => {
    const response = await w.visitor().api('/api/dev/fault', { kind: 'lose_next_response' });
    expect(response.status).toBe(404);
    expect(await w.store.all('SELECT * FROM caps')).toEqual([]);
  });
  it('dev lost response sends the write and then shows checking payment', async () => {
    w.env.DEV_ROUTES = '1';
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    await v.api('/api/dev/fault', { kind: 'lose_next_response' });
    expect(await (await v.api(`/api/preorders/${p.id}/return`, {})).json()).toMatchObject({
      preorder: { state: 'checking', label: 'Simulated failure (dev route)' },
    });
    expect(w.pp.captures.size).toBe(1);
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect((await w.store.preorder(p.id))?.state).toBe('captured');
  });
  it('dev pending decline and refund failures label simulated receipts', async () => {
    w.env.DEV_ROUTES = '1';
    for (const [kind, state] of [
      ['capture_pending', 'pending'],
      ['decline_next_capture', 'declined'],
    ]) {
      const v = w.visitor();
      const p = await v.create();
      w.pp.approve(p.orderId!);
      await v.api('/api/dev/fault', { kind });
      expect(await (await v.api(`/api/preorders/${p.id}/return`, {})).json()).toMatchObject({
        preorder: { state, label: 'Simulated failure (dev route)' },
      });
    }
    for (const [kind, state] of [
      ['refund_pending', 'refund_pending'],
      ['refund_fails', 'refund_failed'],
    ]) {
      const v = w.visitor();
      await v.paid();
      await v.api('/api/dev/fault', { kind });
      expect(await (await v.api('/api/campaign/close', { venue: 'mill' })).json()).toMatchObject({
        preorders: [{ state, label: 'Simulated failure (dev route)' }],
      });
    }
  });
  it('dev faults remain isolated to the session that set them', async () => {
    w.env.DEV_ROUTES = '1';
    const one = w.visitor();
    const two = w.visitor();
    await one.api('/api/dev/fault', { kind: 'decline_next_capture' });
    expect((await two.paid()).state).toBe('captured');
    expect((await one.paid()).state).toBe('declined');
  });
  it('cross site writes fail before any payment call', async () => {
    const response = await w.worker.fetch(
      new Request('https://stallsignal.test/api/preorders', {
        method: 'POST',
        headers: { origin: 'https://other.test' },
        body: '{}',
      }),
      w.env,
    );
    expect(response.status).toBe(403);
    expect(w.pp.requests).toEqual([]);
  });
  it('malformed oversized or invalid JSON returns bounded JSON errors', async () => {
    for (const [body, status] of [
      ['{', 400],
      ['[]', 400],
      ['x'.repeat(17000), 413],
    ] as const) {
      const response = await w.worker.fetch(
        new Request('https://stallsignal.test/api/preorders', { method: 'POST', body }),
        w.env,
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toHaveProperty('error');
    }
  });
  it('secrets and upstream messages never appear in API errors', async () => {
    w.pp.beforeWrite = async () => {
      throw new Error(w.env.PAYPAL_SECRET);
    };
    const response = await w.visitor().api('/api/preorders', { venue: 'mill', product: 'tin', qty: 1 });
    expect(await response.text()).not.toContain(w.env.PAYPAL_SECRET);
  });
  it('GET /api/scorecard for a closed campaign with no preorders returns that row with verdict no_evidence', async () => {
    const v = w.visitor();
    const c = await v.campaign();
    await v.api('/api/campaign/close', { venue: 'mill' });
    const response = await w.worker.fetch(new Request('https://stallsignal.test/api/scorecard'), w.env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { campaigns: Array<{ id: string; verdict?: string }> };
    const row = body.campaigns.find((r) => r.id === c.id);
    expect(row).toBeDefined();
    expect(row?.verdict).toBe('no_evidence');
  });
  it('GET /api/agent/recorded returns the recorded answer with budget 90000 and capturedAt without session or database', async () => {
    const response = await w.worker.fetch(
      new Request('https://stallsignal.test/api/agent/recorded', { method: 'GET' }),
      { ASSETS: w.env.ASSETS },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { source: string; budgetCents: number; capturedAt: string };
    expect(body.source).toBe('recorded');
    expect(body.budgetCents).toBe(90000);
    expect(body.capturedAt).toBeTruthy();
  });
  it.each([15000, 45000, 90000])('POST /api/agent returns stockCostCents <= budgetCents and budgetCents === budget for %i without DB', async (budget) => {
    const response = await w.worker.fetch(
      new Request('https://stallsignal.test/api/agent', {
        method: 'POST',
        body: JSON.stringify({ budget }),
      }),
      { ASSETS: w.env.ASSETS },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { stockCostCents: number; budgetCents: number; source: string; fallback: string };
    expect(body.stockCostCents).toBeLessThanOrEqual(body.budgetCents);
    expect(body.budgetCents).toBe(budget);
    expect(body.source).toBe('code');
    expect(body.fallback).toBe('model_off');
  });
  it('buyer pays into shared campaign, appears on maker campaign, and is refunded on close with another venue', async () => {
    w.env.PAYPAL_BASE = SANDBOX;
    const maker = w.visitor();
    const shareRes = await maker.api('/api/campaign/share', {});
    expect(shareRes.status).toBe(200);
    const { shareToken } = (await shareRes.json()) as { shareToken: string };
    expect(shareToken).toMatch(/^[a-f0-9]{32}$/);

    const buyer = w.visitor();
    const sharedViewRes = await buyer.api(`/api/shared/${shareToken}`);
    expect(sharedViewRes.status).toBe(200);
    const sharedView = (await sharedViewRes.json()) as {
      campaignState: string;
      chosen: string | null;
      venues: { id: string; forecastUnits: number; paidUnits: number }[];
      catalog: unknown[];
      mine: unknown[];
    };
    expect(sharedView.campaignState).toBe('open');
    expect(sharedView.mine).toEqual([]);

    const payRes = await buyer.api(`/api/shared/${shareToken}/preorders`, {
      venue: 'mill',
      product: 'tin',
      qty: 1,
      method: 'card',
    });
    expect(payRes.status).toBe(200);
    const { preorder: buyerPreorder } = (await payRes.json()) as { preorder: { id: string; state: string } };
    expect(buyerPreorder.state).toBe('captured');

    const makerCampaign = await maker.campaign();
    expect(makerCampaign.venues.find((v) => v.id === 'mill')?.paidUnits).toBe(1);
    const preorderOnMaker = makerCampaign.preorders.find((p) => p.id === buyerPreorder.id);
    expect(preorderOnMaker).toBeDefined();
    expect((preorderOnMaker as { from?: string }).from).toBe('buyer');

    const closeRes = await maker.api('/api/campaign/close', { venue: 'wharf' });
    expect(closeRes.status).toBe(200);

    const buyerAfterCloseRes = await buyer.api(`/api/shared/${shareToken}`);
    expect(buyerAfterCloseRes.status).toBe(200);
    const buyerAfterClose = (await buyerAfterCloseRes.json()) as {
      campaignState: string;
      chosen: string | null;
      mine: { id: string; state: string }[];
    };
    expect(buyerAfterClose.campaignState).toBe('closed');
    expect(buyerAfterClose.chosen).toBe('wharf');
    expect(buyerAfterClose.mine.find((p) => p.id === buyerPreorder.id)?.state).toBe('refunded');
  });
  it('buyer gets 403 on maker close, reset, retry, and reconcile for non-owned preorder', async () => {
    w.env.PAYPAL_BASE = SANDBOX;
    const maker = w.visitor();
    const shareRes = await maker.api('/api/campaign/share', {});
    const { shareToken } = (await shareRes.json()) as { shareToken: string };
    const makerPreorder = await maker.paid('wharf');
    const makerCamp = await maker.campaign();

    const buyer = w.visitor();
    const closeRes = await buyer.api('/api/campaign/close', { campaignId: makerCamp.id, venue: 'mill' });
    expect(closeRes.status).toBe(403);
    expect(await closeRes.json()).toMatchObject({ error: 'NOT_YOUR_CAMPAIGN' });

    const resetRes = await buyer.api('/api/campaign/reset', { campaignId: makerCamp.id });
    expect(resetRes.status).toBe(403);
    expect(await resetRes.json()).toMatchObject({ error: 'NOT_YOUR_CAMPAIGN' });

    const retryRes = await buyer.api(`/api/campaign/refunds/${makerPreorder.id}/retry`, {});
    expect(retryRes.status).toBe(403);
    expect(await retryRes.json()).toMatchObject({ error: 'NOT_YOUR_CAMPAIGN' });

    const reconcileRes = await buyer.api(`/api/preorders/${makerPreorder.id}/reconcile`, {});
    expect(reconcileRes.status).toBe(403);
    expect(await reconcileRes.json()).toMatchObject({ error: 'NOT_YOUR_CAMPAIGN' });

    const ownPayRes = await buyer.api(`/api/shared/${shareToken}/preorders`, {
      venue: 'mill',
      product: 'tin',
      qty: 1,
      method: 'card',
    });
    expect(ownPayRes.status).toBe(200);
    const { preorder: ownPreorder } = (await ownPayRes.json()) as { preorder: { id: string } };
    const buyerReconcile = await buyer.api(`/api/preorders/${ownPreorder.id}/reconcile`, {});
    expect(buyerReconcile.status).toBe(200);
  });
  it('revoked token returns 404 for shared endpoints', async () => {
    const maker = w.visitor();
    const shareRes = await maker.api('/api/campaign/share', {});
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    const revokeRes = await maker.api('/api/campaign/share/revoke', {});
    expect(revokeRes.status).toBe(200);
    expect(await revokeRes.json()).toEqual({ ok: true });

    const buyer = w.visitor();
    const getRes = await buyer.api(`/api/shared/${shareToken}`);
    expect(getRes.status).toBe(404);
    expect(await getRes.json()).toMatchObject({ error: 'NOT_FOUND' });

    const postRes = await buyer.api(`/api/shared/${shareToken}/preorders`, {
      venue: 'mill',
      product: 'tin',
      qty: 1,
      method: 'card',
    });
    expect(postRes.status).toBe(404);
    expect(await postRes.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
  it('buyer daily cap counts the buyers own preorders', async () => {
    w.env.PAYPAL_BASE = SANDBOX;
    const maker = w.visitor();
    const shareRes = await maker.api('/api/campaign/share', {});
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    const buyer = w.visitor();
    for (let i = 0; i < 10; i++) {
      const res = await buyer.api(`/api/shared/${shareToken}/preorders`, {
        venue: 'mill',
        product: 'tin',
        qty: 1,
        method: 'card',
      });
      expect(res.status).toBe(200);
    }
    const eleventh = await buyer.api(`/api/shared/${shareToken}/preorders`, {
      venue: 'mill',
      product: 'tin',
      qty: 1,
      method: 'card',
    });
    expect(eleventh.status).toBe(409);
    expect(await eleventh.json()).toMatchObject({ error: 'PREORDER_LIMIT' });
  });
});
