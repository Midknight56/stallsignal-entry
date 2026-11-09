import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/engine/store';
import { PayPal } from '../src/paypal/client';
import type { Preorder } from '../src/shared/types';
import { deferred, world } from './helpers/world';

describe('preorder failures', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    w.db.close();
  });
  it('missing credentials fail create with HTTP 200 and allow a fresh preorder', async () => {
    const v = w.visitor();
    w.env.PAYPAL_SECRET = '';
    const response = await v.api('/api/preorders', { venue: 'mill', product: 'tin', qty: 2 });
    expect(response.status).toBe(200);
    const { preorder, approveUrl } = (await response.json()) as { preorder: Preorder; approveUrl: null };
    expect(preorder.state).toBe('failed');
    expect(approveUrl).toBeNull();
    expect(await w.store.op('create', preorder.id)).toMatchObject({ status: 'failed', http: null });
    expect(w.pp.count('create')).toBe(0);
    expect((await v.campaign()).venues.every((r) => r.paidUnits === 0 && r.pendingUnits === 0)).toBe(true);
    await v.api(`/api/preorders/${preorder.id}/reconcile`, {});
    w.env.PAYPAL_SECRET = 'test-secret';
    expect((await v.create()).id).not.toBe(preorder.id);
    await v.api('/api/campaign/close', { venue: 'wharf' });
    expect((await w.store.preorder(preorder.id))?.state).toBe('failed');
    expect(w.pp.count('refund')).toBe(0);
  });
  it('missing capture credentials send no payment and are never refunded', async () => {
    const v = w.visitor();
    const p = await v.create('mill');
    w.pp.approve(p.orderId!);
    vi.spyOn(PayPal.prototype, 'getOrder').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { status: 'APPROVED' },
      debugId: null,
    });
    w.env.PAYPAL_SECRET = '';
    const response = await v.api(`/api/preorders/${p.id}/return`, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preorder: { state: 'failed', captureId: null } });
    expect(await w.store.op('capture', p.id)).toMatchObject({ status: 'failed', http: null });
    expect(w.pp.count('capture')).toBe(0);
    expect((await v.campaign()).venues.every((r) => r.paidUnits === 0 && r.pendingUnits === 0)).toBe(true);
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    await v.api('/api/campaign/close', { venue: 'wharf' });
    expect((await w.store.preorder(p.id))?.state).toBe('failed');
    expect(w.pp.count('refund')).toBe(0);
  });
  it('successful payment saves catalog amount and receipt ids', async () => {
    const v = w.visitor();
    const p = await v.paid('mill', 3);
    expect(p.state).toBe('captured');
    expect(p.amountCents).toBe(4200);
    expect(p.orderId).toBeTruthy();
    expect(p.captureId).toBeTruthy();
    expect(p.debugId).toBe('debug-test');
    expect((await v.campaign()).venues.find((row) => row.id === 'mill')?.paidUnits).toBe(3);
  });
  it('client sent amount and price are ignored at the PayPal boundary', async () => {
    const p = await w.visitor().create('wharf', 2, { amount: 1, price: 1, amountCents: 1, product: 'jar' });
    expect(p.amountCents).toBe(5600);
    const unit = (
      w.pp.orders.get(p.orderId!)!.createBody.purchase_units as { amount: unknown; items: unknown[] }[]
    )[0];
    expect(unit.amount).toEqual({
      currency_code: 'USD',
      value: '56.00',
      breakdown: { item_total: { currency_code: 'USD', value: '56.00' } },
    });
    expect(unit.items[0]).toMatchObject({ sku: 'jar', quantity: '2', unit_amount: { value: '28.00' } });
  });
  it('the op row exists before every payment write leaves the client', async () => {
    const seen: string[] = [];
    w.pp.beforeWrite = async (kind, id) => {
      const op = await w.store.first<{ requestId: string; status: string }>(
        'SELECT requestId,status FROM ops WHERE requestId=?',
        id,
      );
      if (op?.status === 'sending') seen.push(kind);
    };
    const v = w.visitor();
    await v.paid();
    await v.api('/api/campaign/close', { venue: 'mill' });
    expect(seen).toEqual(['create', 'capture', 'refund']);
  });
  it('declined capture keeps the draft and never counts paid demand', async () => {
    w.pp.captureStatus = 'DECLINED';
    const v = w.visitor();
    const p = await v.paid();
    expect(p.state).toBe('declined');
    expect((await v.campaign()).venues.every((r) => r.paidUnits === 0)).toBe(true);
    expect((await v.create()).orderId).not.toBe(p.orderId);
  });
  it('keeps a failure after capture was sent uncertain until reconciliation', async () => {
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    vi.spyOn(Store.prototype, 'finishOp').mockRejectedValueOnce(new Error('Temporary storage failure'));
    const response = await v.api(`/api/preorders/${p.id}/return`, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preorder: { state: 'checking' } });
    expect(w.pp.count('capture')).toBe(1);
    expect(await (await v.api(`/api/preorders/${p.id}/reconcile`, {})).json()).toMatchObject({
      preorder: { state: 'captured' },
    });
    expect(w.pp.count('capture')).toBe(1);
  });
  it('canceled approval never calls capture', async () => {
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    const response = await v.api(`/api/preorders/${p.id}/return`, { cancel: true });
    expect(await response.json()).toMatchObject({ preorder: { state: 'canceled' } });
    expect(w.pp.count('capture')).toBe(0);
  });
  it('campaign closed before return cancels approval without a PayPal capture', async () => {
    const v = w.visitor();
    const p = await v.create('mill');
    w.pp.approve(p.orderId!);
    await v.api('/api/campaign/close', { venue: 'mill' });
    expect(await (await v.api(`/api/preorders/${p.id}/return`, {})).json()).toMatchObject({
      preorder: { state: 'canceled' },
    });
    expect(w.pp.count('capture')).toBe(0);
  });
  it('lost create answer replays the identical body and key, leaving only one order', async () => {
    w.pp.lose = 'create';
    const v = w.visitor();
    const p = await v.create();
    expect(p.state).toBe('checking');
    expect(p.orderId).toBeNull();
    expect((await v.api('/api/preorders', { venue: 'mill', product: 'tin', qty: 1 })).status).toBe(409);
    const original = w.pp.requests.find((r) => r.path === '/v2/checkout/orders')!;
    expect(JSON.parse((await w.store.op('create', p.id))!.body!)).toEqual(original.body);
    const response = await v.api(`/api/preorders/${p.id}/reconcile`, {});
    const order = [...w.pp.orders.values()][0];
    expect(await response.json()).toMatchObject({ preorder: { state: 'created', orderId: order.id } });
    const requests = w.pp.requests.filter((r) => r.path === '/v2/checkout/orders');
    expect(requests).toHaveLength(2);
    expect(requests[1].requestId).toBe(original.requestId);
    expect(JSON.stringify(requests[1].body)).toBe(JSON.stringify(original.body));
    expect(w.pp.orders.size).toBe(1);
    expect((await w.store.op('create', p.id))?.retryCount).toBe(1);
    expect(await w.store.op('create', p.id)).toMatchObject({ status: 'ok', http: null, paypalId: order.id });
    expect(await w.store.all('SELECT * FROM ops WHERE preorderId=? AND kind=?', p.id, 'create')).toHaveLength(1);
    w.pp.approve(order.id!);
    expect(await (await v.api(`/api/preorders/${p.id}/return`, {})).json()).toMatchObject({
      preorder: { state: 'captured' },
    });
  });
  it('lost create retry is claimed once across concurrent reconciles', async () => {
    w.pp.lose = 'create';
    const v = w.visitor();
    const p = await v.create();
    await Promise.all([
      v.api(`/api/preorders/${p.id}/reconcile`, {}),
      v.api(`/api/preorders/${p.id}/reconcile`, {}),
    ]);
    expect(w.pp.count('create')).toBe(2);
    expect(w.pp.orders.size).toBe(1);
  });
  it('lost create retry stops after a second lost answer', async () => {
    w.pp.lose = 'create';
    const v = w.visitor();
    const p = await v.create();
    w.pp.beforeWrite = async (kind) => {
      if (kind === 'create') throw new TypeError('Connection lost');
    };
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect(w.pp.count('create')).toBe(2);
    expect(w.pp.orders.size).toBe(1);
    expect((await w.store.preorder(p.id))?.state).toBe('checking');
  });
  it('lost create does not retry beyond the window or without a saved body', async () => {
    w.pp.lose = 'create';
    const v = w.visitor();
    const p = await v.create();
    w.advance(3600001);
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect(w.pp.count('create')).toBe(1);
    expect((await w.store.preorder(p.id))?.state).toBe('checking');
    const other = w.visitor();
    w.pp.lose = 'create';
    const q = await other.create();
    await w.store.run('UPDATE ops SET body=NULL WHERE preorderId=?', q.id);
    await other.api(`/api/preorders/${q.id}/reconcile`, {});
    expect(w.pp.count('create')).toBe(2);
    expect((await w.store.preorder(q.id))?.state).toBe('checking');
  });
  it('lost capture answer after PayPal acted reconciles with only one capture', async () => {
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    w.pp.lose = 'capture';
    expect(await (await v.api(`/api/preorders/${p.id}/return`, {})).json()).toMatchObject({
      preorder: { state: 'checking' },
    });
    expect((await w.store.op('capture', p.id))?.status).toBe('lost');
    expect(await (await v.api(`/api/preorders/${p.id}/reconcile`, {})).json()).toMatchObject({
      preorder: { state: 'captured' },
    });
    expect(w.pp.count('capture')).toBe(1);
    const captureId = (await w.store.preorder(p.id))?.captureId;
    expect(await w.store.op('capture', p.id)).toMatchObject({ status: 'ok', http: null, paypalId: captureId });
    expect(await w.store.all('SELECT * FROM ops WHERE preorderId=? AND kind=?', p.id, 'capture')).toHaveLength(1);
  });
  it('lost capture before PayPal acted retries once with the same request id', async () => {
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    let broken = false;
    w.pp.beforeWrite = async (kind) => {
      if (kind === 'capture' && !broken) {
        broken = true;
        throw new TypeError('Connection lost');
      }
    };
    await v.api(`/api/preorders/${p.id}/return`, {});
    expect(await (await v.api(`/api/preorders/${p.id}/reconcile`, {})).json()).toMatchObject({
      preorder: { state: 'captured' },
    });
    expect((await w.store.op('capture', p.id))?.retryCount).toBe(1);
    expect(
      new Set(w.pp.requests.filter((r) => r.path.endsWith('/capture')).map((r) => r.requestId)).size,
    ).toBe(1);
  });
  it('capture retry stops after one attempt and after the one hour window', async () => {
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    w.pp.beforeWrite = async (kind) => {
      if (kind === 'capture') throw new TypeError('Connection lost');
    };
    await v.api(`/api/preorders/${p.id}/return`, {});
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect(w.pp.count('capture')).toBe(2);
    expect((await w.store.preorder(p.id))?.state).toBe('checking');
    const other = w.visitor();
    const q = await other.create();
    w.pp.approve(q.orderId!);
    await other.api(`/api/preorders/${q.id}/return`, {});
    w.advance(3600001);
    await other.api(`/api/preorders/${q.id}/reconcile`, {});
    expect(w.pp.count('capture')).toBe(3);
  });
  it('an unresolved lost payment blocks capture of a different approved order', async () => {
    const v = w.visitor();
    const first = await v.create();
    const second = await v.create('mill');
    w.pp.approve(first.orderId!);
    w.pp.approve(second.orderId!);
    w.pp.beforeWrite = async (kind) => {
      if (kind === 'capture') throw new TypeError('Connection lost');
    };
    await v.api(`/api/preorders/${first.id}/return`, {});
    const response = await v.api(`/api/preorders/${second.id}/return`, {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'CHECKING_PAYMENT' });
    expect((await w.store.preorder(second.id))?.state).toBe('created');
  });
  it('duplicate return presses capture only once while the first response is in flight', async () => {
    const v = w.visitor();
    const p = await v.create();
    w.pp.approve(p.orderId!);
    const entered = deferred();
    const release = deferred();
    w.pp.captureGate = async () => {
      entered.resolve();
      await release.promise;
    };
    const first = v.api(`/api/preorders/${p.id}/return`, {});
    await entered.promise;
    const second = await v.api(`/api/preorders/${p.id}/return`, {});
    expect(((await second.json()) as { preorder: Preorder }).preorder.state).toBe('capturing');
    release.resolve();
    expect((await first).status).toBe(200);
    expect(w.pp.count('capture')).toBe(1);
  });
  it('pending capture does not count as paid demand', async () => {
    w.pp.captureStatus = 'PENDING';
    const v = w.visitor();
    const p = await v.paid();
    expect(p.state).toBe('pending');
    const view = await v.campaign();
    expect(view.venues.find((r) => r.id === 'wharf')).toMatchObject({ paidUnits: 0, pendingUnits: 1 });
  });
  it('invalid product venue or quantity never reaches PayPal', async () => {
    const v = w.visitor();
    for (const extra of [
      { qty: 0 },
      { qty: 4 },
      { qty: 1.1 },
      { qty: '2' },
      { venue: 'other' },
      { product: 'other' },
    ])
      expect(
        (await v.api('/api/preorders', { venue: 'wharf', product: 'tin', qty: 1, ...extra })).status,
      ).toBe(400);
    expect(w.pp.count('create')).toBe(0);
  });
});
