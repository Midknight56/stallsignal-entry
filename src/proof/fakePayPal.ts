import type { Fetch, Resource } from '../paypal/client';
import type { Store } from '../engine/store';

type Order = Resource & { createBody: Record<string, unknown>; custom_id: string };

export class FakePayPal {
  orders = new Map<string, Order>();
  captures = new Map<string, Resource>();
  refunds = new Map<string, Resource>();
  requests: { method: string; path: string; requestId: string | null; body: Record<string, unknown> }[] = [];
  writes = new Map<string, Resource>();
  signature = true;
  captureStatus = 'COMPLETED';
  cardOrderStatus = 'COMPLETED';
  cardDeclineHttp = false;
  createGate?: () => Promise<void>;
  refundStatuses: string[] = [];
  lose: 'create' | 'capture' | 'refund' | null = null;
  captureGate?: () => Promise<void>;
  readFailure = false;
  readNetworkFailure = false;
  tokenCalls = 0;
  beforeWrite?: (kind: string, requestId: string) => Promise<void>;

  constructor(readonly store: Store) {}

  count(kind: string) {
    return this.requests.filter(
      (r) =>
        r.method === 'POST' &&
        (kind === 'create' ? r.path === '/v2/checkout/orders' : r.path.endsWith(`/${kind}`)),
    ).length;
  }

  approve(id: string) {
    const order = this.orders.get(id);
    if (order) order.status = 'APPROVED';
  }

  fetch: Fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v1/oauth2/token') {
      this.tokenCalls++;
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    this.requests.push({ method, path, requestId: headers.get('PayPal-Request-Id'), body });
    if (path === '/v1/notifications/verify-webhook-signature')
      return Response.json({ verification_status: this.signature ? 'SUCCESS' : 'FAILURE' });
    if (method === 'GET') {
      if (this.readNetworkFailure) throw new TypeError('Network connection failed');
      if (this.readFailure) return Response.json({ name: 'TEMPORARY_FAILURE' }, { status: 503 });
      const id = path.split('/').at(-1)!;
      const resource = path.includes('/checkout/')
        ? this.orders.get(id)
        : path.includes('/refunds/')
          ? this.refunds.get(id)
          : this.captures.get(id);
      return Response.json(resource ?? {}, { status: resource ? 200 : 404 });
    }
    const kind = path.endsWith('/capture') ? 'capture' : path.endsWith('/refund') ? 'refund' : 'create';
    const requestId = headers.get('PayPal-Request-Id');
    if (!requestId) throw new Error('Missing PayPal-Request-Id header');
    const op = await this.store.first<{ status: string }>(
      'SELECT status FROM ops WHERE requestId=?',
      requestId,
    );
    if (!op || !['sending', 'lost'].includes(op.status))
      throw new Error(`Expected op status sending or lost, got ${op?.status}`);
    await this.beforeWrite?.(kind, requestId);
    const prior = this.writes.get(requestId);
    if (prior) {
      const original = this.requests.find((r) => r.requestId === requestId)!;
      if (JSON.stringify(body) !== JSON.stringify(original.body))
        throw new Error('Retry body does not match original request body');
      return Response.json(prior, { status: 201, headers: { 'paypal-debug-id': 'debug-test' } });
    }
    if (kind === 'capture') await this.captureGate?.();
    let resource: Resource;
    if (kind === 'create') {
      await this.createGate?.();
      const card = (body.payment_source as { card?: { name: string } })?.card;
      if (card && (this.cardDeclineHttp || card.name === 'CCREJECT-REFUSED'))
        return Response.json({ details: [{ issue: 'DO_NOT_HONOR' }] }, { status: 422 });
      const id = `ORDER${this.orders.size + 1}`;
      const customId = (body.purchase_units as { custom_id: string }[])[0].custom_id;
      const order: Order = {
        id,
        status: 'CREATED',
        custom_id: customId,
        createBody: body,
        links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
      };
      this.orders.set(id, order);
      if (card) {
        const capture: Resource = {
          id: `CAPTURE${this.captures.size + 1}`,
          status: this.captureStatus,
          custom_id: customId,
          supplementary_data: { related_ids: { order_id: id } },
        };
        this.captures.set(capture.id!, capture);
        order.status = this.cardOrderStatus;
        order.links = [];
        order.purchase_units = [{ custom_id: customId, payments: { captures: [capture] } }];
      }
      resource = order;
    } else if (kind === 'capture') {
      const id = path.split('/').at(-2)!;
      const order = this.orders.get(id)!;
      if (this.captureStatus === 'DECLINED')
        return Response.json({ details: [{ issue: 'INSTRUMENT_DECLINED' }] }, { status: 422 });
      const capture: Resource = {
        id: `CAPTURE${this.captures.size + 1}`,
        status: this.captureStatus,
        custom_id: order.custom_id,
        supplementary_data: { related_ids: { order_id: id } },
      };
      this.captures.set(capture.id!, capture);
      order.status = 'COMPLETED';
      order.purchase_units = [{ custom_id: order.custom_id, payments: { captures: [capture] } }];
      resource = order;
    } else {
      const captureId = path.split('/').at(-2)!;
      const status = this.refundStatuses.shift() ?? 'COMPLETED';
      if (status === 'ERROR') return Response.json({ name: 'REFUND_FAILED' }, { status: 422 });
      const refund: Resource = {
        id: `REFUND${this.refunds.size + 1}`,
        status,
        custom_id: body.custom_id as string,
        supplementary_data: { related_ids: { capture_id: captureId } },
      };
      this.refunds.set(refund.id!, refund);
      resource = refund;
    }
    this.writes.set(requestId, resource);
    if (this.lose === kind) {
      this.lose = null;
      throw new TypeError('Connection lost after write');
    }
    return Response.json(resource, { status: 201, headers: { 'paypal-debug-id': 'debug-test' } });
  };
}
