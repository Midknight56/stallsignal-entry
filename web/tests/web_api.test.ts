import { afterEach, expect, it, vi } from 'vitest';
import * as api from '../src/api';
import { HISTORY_SHARE_PERCENT } from '../../src/domain/context';
afterEach(() => vi.unstubAllGlobals());
it('walks every client route in mock mode without fetch, including payment and refunds', async () => {
  vi.stubGlobal('location', { search: '?mock=1' });
  const fetch = vi.fn(() => {
    throw new Error('network forbidden');
  });
  vi.stubGlobal('fetch', fetch);
  const w = await api.getWorld();
  expect(w.city.name).toBe('Portland, Maine');
  expect(w.recorded?.preorders).toHaveLength(9);
  const c = await api.getCampaign();
  expect(c.state).toBe('open');
  expect((await api.runAgent({ budget: 45000, includeRecorded: true, sharePercent: HISTORY_SHARE_PERCENT })).pick).toBe('mill');
  const rec = await api.getRecordedAgent();
  expect(rec.source).toBe('recorded');
  expect(rec.budgetCents).toBe(90000);
  expect(await api.ask('paid demand')).toMatchObject({ source: 'matched' });
  expect(await api.health()).toEqual({ ok: true });
  const first = await api.createPreorder('mill', 'jar', 2);
  expect(first.preorder.amountCents).toBe(5600);
  expect((await api.returnPreorder(first.preorder.id)).preorder.state).toBe('captured');
  expect((await api.reconcilePreorder(first.preorder.id)).preorder.state).toBe('captured');
  const second = await api.createPreorder('wharf', 'tin', 1);
  expect((await api.returnPreorder(second.preorder.id, true)).preorder.state).toBe('canceled');
  const closed = await api.closeCampaign('wharf');
  expect(closed.preorders[0].state).toBe('refunded');
  expect(closed.ops.some((o) => o.kind === 'refund')).toBe(true);
  expect((await api.retryRefund(first.preorder.id)).liabilityCents).toBe(0);
  expect((await api.getScorecard()).campaigns).toHaveLength(1);
  expect((await api.resetCampaign()).preorders).toHaveLength(0);
  const card = await api.createPreorder('wharf', 'tin', 1, 'card');
  expect(card.preorder).toMatchObject({ method: 'card', state: 'captured' });
  expect(card.preorder.captureId).toBeTruthy();
  expect(card.approveUrl).toBeNull();
  expect((await api.returnPreorder(card.preorder.id)).preorder.captureId).toBe(card.preorder.captureId);
  await expect(api.paypalWebhook({})).rejects.toThrow('INVALID_INPUT');
  expect(fetch).not.toHaveBeenCalled();
});
it('sends only product choices, never a client amount', async () => {
  vi.stubGlobal('location', { search: '' });
  const fetch = vi.fn(async () =>
    Response.json({ preorder: {}, approveUrl: 'https://www.sandbox.paypal.com' }),
  );
  vi.stubGlobal('fetch', fetch);
  await api.createPreorder('mill', 'tin', 1);
  expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
    venue: 'mill',
    product: 'tin',
    qty: 1,
  });
});
it('maps network and API failures into codes', async () => {
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'NOT_YOUR_CAMPAIGN' }, { status: 403 })),
  );
  await expect(api.getCampaign()).rejects.toThrow('NOT_YOUR_CAMPAIGN');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Error('socket');
    }),
  );
  await expect(api.getWorld()).rejects.toThrow('NETWORK');
});

it('sends the card method and product choices without card data', async () => {
  vi.stubGlobal('location', { search: '' });
  const fetch = vi.fn(async () => Response.json({ preorder: {}, approveUrl: null }));
  vi.stubGlobal('fetch', fetch);
  await api.createPreorder('wharf', 'tin', 1, 'card');
  const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(init.body as string)).toEqual({ venue: 'wharf', product: 'tin', qty: 1, method: 'card' });
});
