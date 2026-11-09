import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CampaignView } from '../src/shared/types';
import { deferred, world } from './helpers/world';

describe('campaign close and refund failures', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });
  afterEach(() => {
    w.db.close();
  });
  it('close refunds only losing captures and keeps winning payments', async () => {
    const v = w.visitor();
    const loser = await v.paid();
    const winner = await v.paid('mill');
    const res = await v.api('/api/campaign/close', { venue: 'mill' });
    const view = (await res.json()) as CampaignView;
    expect(view.state).toBe('closed');
    expect(view.liabilityCents).toBe(0);
    expect(view.preorders.find((p) => p.id === loser.id)?.state).toBe('refunded');
    expect(view.preorders.find((p) => p.id === winner.id)?.state).toBe('captured');
    expect(w.pp.count('refund')).toBe(1);
    expect(w.pp.requests.some((r) => r.method === 'GET' && r.path.includes('/refunds/'))).toBe(true);
  });
  it('refund pending remains an outstanding liability until reconciliation completes', async () => {
    const v = w.visitor();
    const p = await v.paid();
    w.pp.refundStatuses = ['PENDING'];
    const view = (await (await v.api('/api/campaign/close', { venue: 'mill' })).json()) as CampaignView;
    expect(view.preorders[0].state).toBe('refund_pending');
    expect(view.liabilityCents).toBe(1400);
    w.pp.refunds.get(view.preorders[0].refundId!)!.status = 'COMPLETED';
    const mid = await v.campaign();
    expect(mid.preorders[0].state).toBe('refund_pending');
    const res = await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect(res.status).toBe(200);
    const rec = (await res.json()) as { preorder: { state: string } };
    expect(rec.preorder.state).toBe('refunded');
    const settled = await v.campaign();
    expect(settled.preorders[0].state).toBe('refunded');
    expect(settled.liabilityCents).toBe(0);
  });
  it('refund pending reconcile with failing PayPal read leaves state and liability unchanged and makes no refund POST', async () => {
    const v = w.visitor();
    const p = await v.paid();
    w.pp.refundStatuses = ['PENDING'];
    const view = (await (await v.api('/api/campaign/close', { venue: 'mill' })).json()) as CampaignView;
    expect(view.preorders[0].state).toBe('refund_pending');
    expect(view.liabilityCents).toBe(1400);
    expect(w.pp.count('refund')).toBe(1);
    w.pp.readNetworkFailure = true;
    const response = await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect(response.status).toBe(200);
    const rec = (await response.json()) as { preorder: { state: string } };
    expect(rec.preorder.state).toBe('refund_pending');
    const current = await v.campaign();
    expect(current.preorders[0].state).toBe('refund_pending');
    expect(current.liabilityCents).toBe(1400);
    expect(w.pp.count('refund')).toBe(1);
    w.pp.readNetworkFailure = false;
    w.pp.readFailure = true;
    const response2 = await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect(response2.status).toBe(200);
    const rec2 = (await response2.json()) as { preorder: { state: string } };
    expect(rec2.preorder.state).toBe('refund_pending');
    expect((await v.campaign()).liabilityCents).toBe(1400);
    expect(w.pp.count('refund')).toBe(1);
  });
  it('refund failed then retry uses the same request id and clears liability', async () => {
    const v = w.visitor();
    const p = await v.paid();
    w.pp.refundStatuses = ['ERROR'];
    const first = (await (await v.api('/api/campaign/close', { venue: 'mill' })).json()) as CampaignView;
    expect(first.preorders[0].state).toBe('refund_failed');
    expect(first.liabilityCents).toBe(1400);
    const retry = await v.api(`/api/campaign/refunds/${p.id}/retry`, {});
    expect(await retry.json()).toMatchObject({ liabilityCents: 0, preorders: [{ state: 'refunded' }] });
    expect(
      new Set(w.pp.requests.filter((r) => r.path.endsWith('/refund')).map((r) => r.requestId)).size,
    ).toBe(1);
  });
  it('partial close preserves each payment outcome when one refund fails', async () => {
    const v = w.visitor();
    await v.paid();
    await v.paid('linden');
    await v.paid();
    w.pp.refundStatuses = ['COMPLETED', 'ERROR', 'COMPLETED'];
    const view = (await (await v.api('/api/campaign/close', { venue: 'mill' })).json()) as CampaignView;
    expect(view.state).toBe('closed');
    expect(view.preorders.filter((p) => p.state === 'refunded')).toHaveLength(2);
    expect(view.preorders.filter((p) => p.state === 'refund_failed')).toHaveLength(1);
    expect(view.liabilityCents).toBe(1400);
  });
  it('retry of a terminal failed refund with an id still sends the original refund request', async () => {
    const v = w.visitor();
    const p = await v.paid();
    w.pp.refundStatuses = ['FAILED'];
    await v.api('/api/campaign/close', { venue: 'mill' });
    expect((await w.store.preorder(p.id))?.state).toBe('refund_failed');
    await v.api(`/api/campaign/refunds/${p.id}/retry`, {});
    expect(w.pp.count('refund')).toBe(2);
    expect(w.pp.refunds.size).toBe(1);
    expect((await v.campaign()).liabilityCents).toBe(1400);
  });
  it('two closes at once run only one close and refund each capture once', async () => {
    const v = w.visitor();
    await v.paid();
    const replies = await Promise.all([
      v.api('/api/campaign/close', { venue: 'mill' }),
      v.api('/api/campaign/close', { venue: 'linden' }),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(w.pp.count('refund')).toBe(1);
    const rejected = replies.find((r) => r.status === 409)!;
    expect(await rejected.json()).toMatchObject({ error: 'ALREADY_CLOSING' });
  });
  it('a capture response arriving after close at a losing venue ends refunded', async () => {
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    const entered = deferred();
    const release = deferred();
    w.pp.captureGate = async () => {
      entered.resolve();
      await release.promise;
    };
    const capture = v.api(`/api/preorders/${p.id}/return`, {});
    await entered.promise;
    expect((await v.api('/api/campaign/close', { venue: 'mill' })).status).toBe(200);
    expect((await v.campaign()).state).toBe('closed');
    release.resolve();
    expect(await (await capture).json()).toMatchObject({ preorder: { state: 'refunded' } });
    expect(w.pp.count('capture')).toBe(1);
    expect(w.pp.count('refund')).toBe(1);
  });
  it('a pending capture completing after close is refunded on reconciliation', async () => {
    w.pp.captureStatus = 'PENDING';
    const v = w.visitor();
    const p = await v.paid();
    await v.api('/api/campaign/close', { venue: 'mill' });
    expect(w.pp.count('refund')).toBe(0);
    w.pp.captures.get(p.captureId!)!.status = 'COMPLETED';
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect((await w.store.preorder(p.id))?.state).toBe('refunded');
  });
  it('a lost refund answer remains liable and reconciles with the original request id', async () => {
    const v = w.visitor();
    const p = await v.paid();
    w.pp.lose = 'refund';
    const view = (await (await v.api('/api/campaign/close', { venue: 'mill' })).json()) as CampaignView;
    expect(view.preorders[0].state).toBe('checking');
    expect(view.liabilityCents).toBe(1400);
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect((await w.store.preorder(p.id))?.state).toBe('refunded');
    expect(w.pp.refunds.size).toBe(1);
  });
  it('reset refuses an open campaign and creates an empty campaign after close', async () => {
    const v = w.visitor();
    const old = await v.campaign();
    expect((await v.api('/api/campaign/reset', {})).status).toBe(409);
    await v.paid('mill');
    await v.api('/api/campaign/close', { venue: 'mill' });
    const fresh = (await (await v.api('/api/campaign/reset', {})).json()) as CampaignView;
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.state).toBe('open');
    expect(fresh.preorders).toEqual([]);
  });
  it('public scorecard retains paid demand after refund without exposing receipts or session ids', async () => {
    const v = w.visitor();
    await v.paid('wharf', 2);
    await v.api('/api/campaign/close', { venue: 'mill' });
    const score = (await (await v.api('/api/scorecard')).json()) as { campaigns: unknown[] };
    expect(score.campaigns).toEqual([
      {
        id: (await v.campaign()).id,
        forecastPick: 'wharf',
        decided: 'mill',
        paidUnits: { wharf: 2, mill: 0, linden: 0 },
        // Closed with no context sent: the default the map shows, recorded example included, so the saved paid
        // pick is the one the maker saw at close.
        forecastWrong: true,
        paidOrders: 1,
        verdict: 'changed',
        outcomeMeasured: false,
        paidPick: 'mill',
        closedAt: expect.any(String),
        preorderCount: 1,
        refundCount: 1,
        context: { budget: 90000, includeRecorded: true, sharePercent: 12 },
        contextSaved: true,
      },
    ]);
    expect(JSON.stringify(score)).not.toMatch(/sessionId|captureId|orderId/);
  });
  it('a buyer capture completing after close at a losing venue ends refunded', async () => {
    const maker = w.visitor();
    const shareRes = await maker.api('/api/campaign/share', {});
    const { shareToken } = (await shareRes.json()) as { shareToken: string };

    const buyer = w.visitor();
    const payRes = await buyer.api(`/api/shared/${shareToken}/preorders`, {
      venue: 'wharf',
      product: 'tin',
      qty: 1,
    });
    const { preorder } = (await payRes.json()) as { preorder: { id: string; orderId: string } };
    w.pp.approve(preorder.orderId);

    const entered = deferred();
    const release = deferred();
    w.pp.captureGate = async () => {
      entered.resolve();
      await release.promise;
    };
    const capture = buyer.api(`/api/preorders/${preorder.id}/return`, {});
    await entered.promise;
    expect((await maker.api('/api/campaign/close', { venue: 'mill' })).status).toBe(200);
    expect((await maker.campaign()).state).toBe('closed');
    release.resolve();
    expect(await (await capture).json()).toMatchObject({ preorder: { state: 'refunded' } });
    expect(w.pp.count('capture')).toBe(1);
    expect(w.pp.count('refund')).toBe(1);
  });
});
