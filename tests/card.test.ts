import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PayPal, SANDBOX, WriteNotSent } from '../src/paypal/client';
import { deferred, world } from './helpers/world';

describe('test card preorders', () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
    w.env.PAYPAL_BASE = SANDBOX;
  });
  afterEach(() => w.db.close());

  it.each([
    ['COMPLETED', 'captured', 1, 0],
    ['PENDING', 'pending', 0, 1],
    ['DECLINED', 'declined', 0, 0],
  ])(
    'maps a card capture %s to %s without a capture call',
    async (status, state, paidUnits, pendingUnits) => {
      w.pp.captureStatus = status as string;
      const v = w.visitor();
      const p = await v.create('wharf', 1, { method: 'card' });
      expect(p).toMatchObject({ method: 'card', state, orderId: 'ORDER1', captureId: 'CAPTURE1' });
      expect((await v.campaign()).venues.find((r) => r.id === 'wharf')).toMatchObject({
        paidUnits,
        pendingUnits,
      });
      await v.api(`/api/preorders/${p.id}/return`, {});
      expect(w.pp.count('capture')).toBe(0);
      expect((await w.store.preorder(p.id))?.approveUrl).toBeNull();
    },
  );

  it('treats an HTTP 422 refusal and an incomplete order as declined', async () => {
    const v = w.visitor();
    w.pp.cardDeclineHttp = true;
    const p = await v.create('wharf', 1, { method: 'card' });
    expect(p).toMatchObject({ state: 'declined', captureId: null });
    expect(await w.store.op('create', p.id)).toMatchObject({ status: 'failed', http: 422 });
    w.pp.cardDeclineHttp = false;
    w.pp.cardOrderStatus = 'PAYER_ACTION_REQUIRED';
    expect((await v.create('wharf', 1, { method: 'card' })).state).toBe('declined');
    expect((await v.campaign()).venues.every((r) => r.paidUnits === 0)).toBe(true);
    await v.api('/api/campaign/close', { venue: 'mill' });
    expect(w.pp.count('refund')).toBe(0);
  });

  it('saves the body and key before sending, and resends a lost create once to settle one capture', async () => {
    w.pp.lose = 'create';
    w.pp.beforeWrite = async (_kind, key) => {
      const op = (await w.store.first<{ body: string }>('SELECT body FROM ops WHERE requestId=?', key))!;
      expect(Boolean(op.body)).toBe(true);
    };
    const v = w.visitor();
    const p = await v.create('wharf', 1, { method: 'card' });
    expect(p.state).toBe('checking');
    expect(p.orderId).toBeNull();
    const original = w.pp.requests.find((r) => r.path === '/v2/checkout/orders')!;
    expect((await w.store.op('create', p.id))?.body === JSON.stringify(original.body)).toBe(true);
    w.advance(1000);
    await Promise.all([
      v.api(`/api/preorders/${p.id}/reconcile`, {}),
      v.api(`/api/preorders/${p.id}/reconcile`, {}),
    ]);
    expect(await w.store.preorder(p.id)).toMatchObject({
      state: 'captured',
      orderId: 'ORDER1',
      captureId: 'CAPTURE1',
    });
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    const requests = w.pp.requests.filter((r) => r.path === '/v2/checkout/orders');
    expect(requests).toHaveLength(2);
    expect(requests[1].requestId).toBe(original.requestId);
    expect(JSON.stringify(requests[1].body) === JSON.stringify(original.body)).toBe(true);
    expect(await w.store.op('create', p.id)).toMatchObject({ retryCount: 1, status: 'ok' });
    expect(w.pp.orders.size).toBe(1);
    expect(w.pp.captures.size).toBe(1);
    expect(w.pp.count('capture')).toBe(0);
  });

  it('keeps a second lost create uncertain and never sends a third create', async () => {
    const v = w.visitor();
    w.pp.lose = 'create';
    const p = await v.create('wharf', 1, { method: 'card' });
    w.pp.beforeWrite = async () => {
      throw new TypeError('Connection lost');
    };
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    await v.api(`/api/preorders/${p.id}/reconcile`, {});
    expect((await w.store.preorder(p.id))?.state).toBe('checking');
    expect(w.pp.count('create')).toBe(2);
    expect(w.pp.orders.size).toBe(1);
  });

  it('retains both receipt ids when a capture webhook settles a lost card create', async () => {
    const v = w.visitor();
    w.pp.lose = 'create';
    const p = await v.create('wharf', 1, { method: 'card' });
    const capture = [...w.pp.captures.values()][0];
    expect(
      (
        await w.webhook({
          id: 'CARD-LOST-CREATE',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: capture,
        })
      ).status,
    ).toBe(200);
    expect(await w.store.preorder(p.id)).toMatchObject({
      state: 'captured',
      orderId: 'ORDER1',
      captureId: 'CAPTURE1',
    });
    expect(await w.store.op('create', p.id)).toMatchObject({ status: 'ok', paypalId: 'ORDER1' });
    expect(w.pp.count('create')).toBe(1);
    expect(w.pp.count('capture')).toBe(0);
  });

  it.each([undefined, '', 'https://api-m.paypal.com', `${SANDBOX}/`])(
    'refuses card payments without the exact sandbox base (%s)',
    async (base) => {
      w.env.PAYPAL_BASE = base;
      expect(
        (await w.visitor().api('/api/preorders', { venue: 'wharf', product: 'tin', qty: 1, method: 'card' }))
          .status,
      ).toBe(503);
      expect(w.pp.requests).toHaveLength(0);
      expect(w.pp.tokenCalls).toBe(0);
      expect(await w.store.all('SELECT id FROM preorders')).toHaveLength(0);
    },
  );

  it('also guards direct card creates and replay before network I/O', async () => {
    const pp = new PayPal({ PAYPAL_CLIENT_ID: '', PAYPAL_SECRET: '', PAYPAL_WEBHOOK_ID: '' });
    await expect(pp.testCardSource()).rejects.toBeInstanceOf(WriteNotSent);
    expect(() => pp.createOrder({ payment_source: { card: {} } }, 'key')).toThrow(WriteNotSent);
  });

  it('ignores every client card field and sends only the fixed server test card', async () => {
    const v = w.visitor();
    const p = await v.create('wharf', 1, {
      method: 'card',
      number: 'client-number',
      expiry: '1900-01',
      security_code: 'client-code',
      name: 'client-name',
      card: { number: 'client-number' },
      payment_source: { card: { number: 'client-number', name: 'client-name' } },
    });
    const body = w.pp.orders.get(p.orderId!)!.createBody;
    const card = (body.payment_source as { card: Record<string, unknown> }).card;
    expect(JSON.stringify(body).includes('client-')).toBe(false);
    expect(body.intent).toBe('CAPTURE');
    expect(card.expiry).toBe('2028-11');
    expect(card.name).toBe('Test Buyer');
    expect(typeof card.number === 'string' && card.number.length === 16).toBe(true);
    expect(card.billing_address).toEqual({
      address_line_1: '1 Harbour St',
      admin_area_2: 'Portland',
      admin_area_1: 'ME',
      postal_code: '04101',
      country_code: 'US',
    });
    expect(JSON.stringify(p).includes('payment_source')).toBe(false);
    expect(JSON.stringify(await v.campaign()).includes('security_code')).toBe(false);
  });

  it('defaults old clients and migrated rows to PayPal and rejects unknown methods', async () => {
    const v = w.visitor();
    expect((await v.create()).method).toBe('paypal');
    expect(
      (await v.api('/api/preorders', { venue: 'wharf', product: 'tin', qty: 1, method: 'other' })).status,
    ).toBe(400);
    expect(w.pp.count('create')).toBe(1);
  });

  it('refunds a card at a losing venue on close', async () => {
    const v = w.visitor();
    const p = await v.create('wharf', 1, { method: 'card' });
    await v.api('/api/campaign/close', { venue: 'mill' });
    expect(await w.store.preorder(p.id)).toMatchObject({
      method: 'card',
      state: 'refunded',
      refundId: 'REFUND1',
    });
    expect(w.pp.count('refund')).toBe(1);
  });

  it('refunds a capture that arrives after its venue loses during create', async () => {
    const entered = deferred(),
      release = deferred();
    w.pp.createGate = async () => {
      entered.resolve();
      await release.promise;
    };
    const v = w.visitor();
    await v.campaign();
    const creating = v.create('wharf', 1, { method: 'card' });
    await entered.promise;
    await v.api('/api/campaign/close', { venue: 'mill' });
    release.resolve();
    const p = await creating;
    expect(p).toMatchObject({
      state: 'refunded',
      orderId: 'ORDER1',
      captureId: 'CAPTURE1',
      refundId: 'REFUND1',
    });
    expect(w.pp.count('refund')).toBe(1);
  });

  it('uses the real refusal name only for the next card with dev routes enabled', async () => {
    const v = w.visitor();
    expect((await v.api('/api/dev/fault', { kind: 'decline_next_card' })).status).toBe(404);
    w.env.DEV_ROUTES = '1';
    await v.api('/api/dev/fault', { kind: 'decline_next_card' });
    await v.create('mill'); // PayPal approval must not consume the card fault.
    const p = await v.create('wharf', 1, { method: 'card' });
    expect(p.state).toBe('declined');
    const creates = w.pp.requests.filter((r) => r.path === '/v2/checkout/orders');
    expect((creates[1].body.payment_source as { card: { name: string } }).card.name).toBe('CCREJECT-REFUSED');
    expect((await v.campaign()).venues.every((r) => r.paidUnits === 0)).toBe(true);
    expect((await v.create('wharf', 1, { method: 'card' })).state).toBe('captured');
  });

  it('a pending card capture uses the existing webhook handler and never moves a refund backwards', async () => {
    w.pp.captureStatus = 'PENDING';
    const v = w.visitor();
    const p = await v.create('wharf', 1, { method: 'card' });
    const capture = w.pp.captures.get(p.captureId!)!;
    capture.status = 'COMPLETED';
    const event = { id: 'CARD-EVENT', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: capture };
    expect((await w.webhook(event)).status).toBe(200);
    expect((await w.store.preorder(p.id))?.state).toBe('captured');
    await v.api('/api/campaign/close', { venue: 'mill' });
    await w.webhook({ ...event, id: 'CARD-LATE-EVENT' });
    expect((await w.store.preorder(p.id))?.state).toBe('refunded');
    expect(w.pp.count('refund')).toBe(1);
  });
});
