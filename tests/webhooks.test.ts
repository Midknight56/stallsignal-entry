import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { world } from './helpers/world';

describe('webhook failures', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });
  afterEach(() => {
    w.db.close();
  });
  it('invalid webhook signature returns 400 and stores nothing', async () => {
    const response = await w.webhook(
      { id: 'bad', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'c', custom_id: 'ss-test' } },
      false,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'INVALID_SIGNATURE' });
    expect(await w.store.all('SELECT * FROM events')).toEqual([]);
  });
  it('duplicate event id does no repeated reads or transitions', async () => {
    const v = w.visitor();
    const p = await v.paid();
    const campaign = await v.campaign();
    const event = {
      id: 'repeat',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: p.captureId, custom_id: `ss-${campaign.id}-${p.id}` },
    };
    expect((await w.webhook(event)).status).toBe(200);
    const reads = w.pp.requests.filter((r) => r.path.includes(`/captures/${p.captureId}`)).length;
    expect((await w.webhook(event)).status).toBe(200);
    expect(w.pp.requests.filter((r) => r.path.includes(`/captures/${p.captureId}`))).toHaveLength(reads);
    expect(await w.store.all('SELECT * FROM events')).toHaveLength(1);
  });
  it('late completed capture webhook never moves a refunded preorder backwards', async () => {
    const v = w.visitor();
    const p = await v.paid();
    const campaign = await v.campaign();
    await v.api('/api/campaign/close', { venue: 'mill' });
    await w.webhook({
      id: 'late',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: p.captureId, custom_id: `ss-${campaign.id}-${p.id}` },
    });
    expect((await w.store.preorder(p.id))?.state).toBe('refunded');
    expect(w.pp.count('refund')).toBe(1);
  });
  it('other apps events are stored ignored and do not read or change any payment', async () => {
    const v = w.visitor();
    const p = await v.paid();
    const before = w.pp.requests.length;
    await w.webhook({
      id: 'other-app',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: p.captureId, custom_id: 'another-app' },
    });
    expect(
      (await w.store.first<{ status: string }>('SELECT status FROM events WHERE event_id=?', 'other-app'))
        ?.status,
    ).toBe('ignored');
    expect(w.pp.requests.length - before).toBe(1);
    expect((await w.store.preorder(p.id))?.state).toBe('captured');
  });
  it('missing custom id is ignored even when the capture id matches a local receipt', async () => {
    const v = w.visitor();
    const p = await v.paid();
    await w.webhook({
      id: 'no-custom',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: p.captureId },
    });
    expect(
      (await w.store.first<{ status: string }>('SELECT status FROM events WHERE event_id=?', 'no-custom'))
        ?.status,
    ).toBe('ignored');
  });
  it('a capture read failure leaves an event received and the next reconcile replays it', async () => {
    w.pp.captureStatus = 'PENDING';
    const v = w.visitor();
    const p = await v.paid();
    const c = await v.campaign();
    w.pp.captures.get(p.captureId!)!.status = 'COMPLETED';
    w.pp.readFailure = true;
    await w.webhook({
      id: 'deferred',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: p.captureId, custom_id: `ss-${c.id}-${p.id}` },
    });
    expect(
      (await w.store.first<{ status: string }>('SELECT status FROM events WHERE event_id=?', 'deferred'))
        ?.status,
    ).toBe('received');
    expect((await w.store.preorder(p.id))?.state).toBe('pending');
    w.pp.readFailure = false;
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect((await w.store.preorder(p.id))?.state).toBe('captured');
    expect(
      (await w.store.first<{ status: string }>('SELECT status FROM events WHERE event_id=?', 'deferred'))
        ?.status,
    ).toBe('done');
  });
  it('close replays unfinished capture events before refunding', async () => {
    w.pp.captureStatus = 'PENDING';
    const v = w.visitor();
    const p = await v.paid();
    const c = await v.campaign();
    w.pp.captures.get(p.captureId!)!.status = 'COMPLETED';
    w.pp.readFailure = true;
    await w.webhook({
      id: 'close-replay',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: p.captureId, custom_id: `ss-${c.id}-${p.id}` },
    });
    w.pp.readFailure = false;
    await v.api('/api/campaign/close', { venue: 'mill' });
    expect((await w.store.preorder(p.id))?.state).toBe('refunded');
  });
  it('a pending refund becomes refunded only after a verified resource read', async () => {
    const v = w.visitor();
    const p = await v.paid();
    const c = await v.campaign();
    w.pp.refundStatuses = ['PENDING'];
    await v.api('/api/campaign/close', { venue: 'mill' });
    const row = (await w.store.preorder(p.id))!;
    w.pp.refunds.get(row.refundId!)!.status = 'COMPLETED';
    await w.webhook({
      id: 'refund-complete',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: { id: row.refundId, custom_id: `ss-${c.id}-${p.id}-r` },
    });
    expect((await w.store.preorder(p.id))?.state).toBe('refunded');
    expect((await v.campaign()).liabilityCents).toBe(0);
  });
  it('a webhook body claiming completed cannot override a pending PayPal resource', async () => {
    w.pp.captureStatus = 'PENDING';
    const v = w.visitor();
    const p = await v.paid();
    const c = await v.campaign();
    await w.webhook({
      id: 'claimed',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: p.captureId, custom_id: `ss-${c.id}-${p.id}`, status: 'COMPLETED' },
    });
    expect((await w.store.preorder(p.id))?.state).toBe('pending');
  });
  it('the verification request includes all five headers and the parsed event', async () => {
    const event = { id: 'headers', event_type: 'OTHER', resource: { id: 'other', custom_id: 'other' } };
    await w.webhook(event);
    expect(w.pp.requests.find((r) => r.path.endsWith('verify-webhook-signature'))?.body).toEqual({
      webhook_id: 'test-webhook',
      auth_algo: 'SHA256withRSA',
      cert_url: 'https://api.sandbox.paypal.com/cert/test',
      transmission_id: 'transmission-test',
      transmission_sig: 'test-signature',
      transmission_time: '2026-11-06T12:00:00.000Z',
      webhook_event: event,
    });
  });
  it('an order created webhook recovers a lost create id without issuing another create', async () => {
    w.pp.lose = 'create';
    const v = w.visitor();
    const p = await v.create();
    const order = [...w.pp.orders.values()][0];
    await w.webhook({
      id: 'created-recovery',
      event_type: 'CHECKOUT.ORDER.CREATED',
      resource: { id: order.id, custom_id: order.custom_id },
    });
    expect((await w.store.preorder(p.id))?.state).toBe('created');
    expect((await w.store.preorder(p.id))?.orderId).toBe(order.id);
    expect(await w.store.op('create', p.id)).toMatchObject({ status: 'ok', http: null, paypalId: order.id });
    expect(await w.store.all('SELECT * FROM ops WHERE preorderId=? AND kind=?', p.id, 'create')).toHaveLength(1);
    expect(w.pp.count('create')).toBe(1);
  });
  it('a verified refund webhook resolves the original lost refund operation', async () => {
    const v = w.visitor();
    const p = await v.paid();
    const campaign = await v.campaign();
    w.pp.lose = 'refund';
    await v.api('/api/campaign/close', { venue: 'mill' });
    const refund = [...w.pp.refunds.values()][0];
    expect((await w.store.op('refund', p.id))?.status).toBe('lost');
    await w.webhook({
      id: 'lost-refund-resolved',
      event_type: 'PAYMENT.REFUND.COMPLETED',
      resource: { id: refund.id, custom_id: `ss-${campaign.id}-${p.id}-r` },
    });
    expect((await w.store.preorder(p.id))?.state).toBe('refunded');
    expect(await w.store.op('refund', p.id)).toMatchObject({ status: 'ok', http: null, paypalId: refund.id });
    expect(await w.store.all('SELECT * FROM ops WHERE preorderId=? AND kind=?', p.id, 'refund')).toHaveLength(1);
  });
  it('a mismatched resource custom id cannot attach an unrelated order', async () => {
    w.pp.lose = 'create';
    const v = w.visitor();
    const p = await v.create();
    const c = await v.campaign();
    const order = [...w.pp.orders.values()][0];
    order.custom_id = 'other-app';
    await w.webhook({
      id: 'mismatched-order',
      event_type: 'CHECKOUT.ORDER.CREATED',
      resource: { id: order.id, custom_id: `ss-${c.id}-${p.id}` },
    });
    expect((await w.store.preorder(p.id))?.orderId).toBeNull();
    expect((await w.store.preorder(p.id))?.state).toBe('checking');
  });
});
