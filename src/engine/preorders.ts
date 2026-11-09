import { catalog } from '../data/catalog';
import { venues } from '../data/venues';
import {
  CAPTURE_RETRY_WINDOW_MS,
  MAX_CAPTURE_RETRIES,
  MAX_PREORDERS_PER_DAY,
  MAX_PREORDERS_PER_SESSION_PER_DAY,
} from '../caps';
import { HttpError } from '../errors';
import { LostResponse, WriteNotSent, orderCapture, PayPal, SANDBOX, type Resource } from '../paypal/client';
import { Store, type CampaignRow, type PreorderRow } from './store';

const captureSources = ['creating', 'created', 'approved', 'capturing', 'checking', 'pending'];
export class Preorders {
  onCaptured: (id: string) => Promise<void> = async () => {};
  constructor(
    readonly store: Store,
    readonly pp: PayPal,
  ) {}
  async create(
    campaign: CampaignRow,
    input: { venue?: unknown; product?: unknown; qty?: unknown; method?: unknown },
    origin: string,
    buyerSessionId?: string,
  ) {
    const venue = venues.find((v) => v.id === input.venue);
    const product = catalog.find((p) => p.id === input.product);
    if (!venue || !product || !Number.isInteger(input.qty) || Number(input.qty) < 1 || Number(input.qty) > 3)
      throw new HttpError(400, 'INVALID_PREORDER', 'Choose a venue, product and quantity from 1 to 3.');
    const method = input.method === undefined ? 'paypal' : input.method;
    if (method !== 'card' && method !== 'paypal')
      throw new HttpError(400, 'INVALID_METHOD', 'Choose test card or PayPal.');
    if (method === 'card' && this.pp.env.PAYPAL_BASE !== SANDBOX)
      throw new HttpError(503, 'SANDBOX_REQUIRED', 'Test card requires the PayPal sandbox endpoint.');
    if (campaign.state !== 'open')
      throw new HttpError(409, 'CAMPAIGN_CLOSED', 'This campaign is no longer open.');
    if (
      await this.store.first(
        "SELECT id FROM preorders WHERE campaignId=? AND state IN ('checking','capturing','creating')",
        campaign.id,
      )
    )
      throw new HttpError(409, 'CHECKING_PAYMENT', 'Reconcile the outstanding payment first.');
    const id = crypto.randomUUID().replaceAll('-', '');
    const now = this.store.now();
    const day = now.slice(0, 10);
    const sessionCapClause = buyerSessionId
      ? '(SELECT COUNT(*) FROM preorders WHERE buyerSessionId=? AND createdAt>=?) < ?'
      : '(SELECT COUNT(*) FROM preorders p JOIN campaigns c ON c.id=p.campaignId WHERE c.sessionId=? AND p.createdAt>=?) < ?';
    const sessionCapArg = buyerSessionId ?? campaign.sessionId;
    const inserted = await this.store.run(
      `INSERT INTO preorders(id,campaignId,venue,product,qty,amountCents,method,state,createdAt,updatedAt,buyerSessionId)
       SELECT ?,?,?,?,?,?,?,'creating',?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE id=? AND state='open')
       AND ${sessionCapClause}
       AND (SELECT COUNT(*) FROM preorders WHERE createdAt>=?) < ?
       AND NOT EXISTS(SELECT 1 FROM preorders WHERE campaignId=? AND state IN ('checking','capturing','creating'))`,
      id,
      campaign.id,
      venue.id,
      product.id,
      input.qty,
      product.priceCents * Number(input.qty),
      method,
      now,
      now,
      buyerSessionId ?? null,
      campaign.id,
      sessionCapArg,
      day,
      MAX_PREORDERS_PER_SESSION_PER_DAY,
      day,
      MAX_PREORDERS_PER_DAY,
      campaign.id,
    );
    if (!inserted) {
      const current = await this.store.campaign(campaign.id);
      if (current?.state !== 'open')
        throw new HttpError(409, 'CAMPAIGN_CLOSED', 'This campaign is no longer open.');
      throw new HttpError(
        409,
        'PREORDER_LIMIT',
        'The campaign is busy, closed or has reached its daily preorder limit.',
      );
    }
    const cardSource = method === 'card' ? await this.pp.testCardSource() : null;
    const money = (cents: number) => ({ currency_code: 'USD', value: (cents / 100).toFixed(2) });
    const amount = money(product.priceCents * Number(input.qty));
    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: `ss-${campaign.id}-${id}`,
          invoice_id: `ss-${id}`,
          items: [
            {
              name: product.name,
              sku: product.id,
              quantity: String(input.qty),
              unit_amount: money(product.priceCents),
            },
          ],
          amount: { ...amount, breakdown: { item_total: amount } },
        },
      ],
      payment_source: cardSource ?? {
        paypal: {
          experience_context: {
            return_url: `${origin}/return?p=${id}`,
            cancel_url: `${origin}/return?p=${id}&cancel=1`,
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            brand_name: 'StallSignal demo',
          },
        },
      },
    };
    const requestId = await this.store.beginOp('create', id, body);
    await this.sendCreate(id, campaign.id, body, requestId);
    const preorder = (await this.store.preorder(id))!;
    return { preorder, approveUrl: preorder.state === 'created' ? preorder.approveUrl : null };
  }
  private async sendCreate(
    id: string,
    campaignId: string,
    body: object,
    requestId: string,
    uncertain = false,
  ) {
    let answered = false;
    try {
      const result = await this.pp.createOrder(body, requestId);
      answered = true;
      const approveUrl =
        result.body.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;
      if (uncertain && result.ok && result.body.id)
        await this.store.resolveLostOp('create', id, result.body.id);
      else
        await this.store.finishOp(
          requestId,
          result.ok ? 'ok' : 'failed',
          result.status,
          result.body.id ?? null,
        );
      if (result.ok && !result.body.id) throw new LostResponse();
      const row = (await this.store.preorder(id))!;
      if (row.method === 'card') {
        // A webhook may already have advanced the state while create was in flight.
        await this.store.run(
          'UPDATE preorders SET orderId=COALESCE(orderId,?),debugId=COALESCE(?,debugId),updatedAt=? WHERE id=?',
          result.body.id ?? null,
          result.debugId,
          this.store.now(),
          id,
        );
        if (!result.ok || result.body.status !== 'COMPLETED') {
          await this.store.transition(id, ['creating', 'checking'], 'declined');
        } else {
          const capture = orderCapture(result.body);
          if (!capture?.id || !capture.status) throw new LostResponse();
          await this.applyCapture(id, capture, result.debugId);
        }
        return;
      }
      await this.store.transition(id, ['creating', 'checking'], result.ok ? 'created' : 'declined', {
        orderId: result.body.id ?? null,
        approveUrl,
        debugId: result.debugId,
      });
      const current = await this.store.campaign(campaignId);
      if (current?.state !== 'open') await this.store.transition(id, ['created'], 'canceled');
    } catch (error) {
      await this.writeError(
        id,
        'create',
        requestId,
        (uncertain || answered) && !(error instanceof LostResponse) ? new LostResponse() : error,
      );
    }
  }
  async writeError(id: string, kind: string, requestId: string, error: unknown) {
    const lost = error instanceof LostResponse || (kind !== 'refund' && !(error instanceof WriteNotSent));
    if (error instanceof LostResponse && error.simulated)
      await this.store.run('UPDATE preorders SET simulated=1 WHERE id=?', id);
    await this.store.finishOp(requestId, lost ? 'lost' : 'failed', null, null);
    await this.store.transition(
      id,
      kind === 'refund' ? ['refunding'] : [kind === 'create' ? 'creating' : 'capturing'],
      lost ? 'checking' : kind === 'refund' ? 'refund_failed' : 'failed',
    );
  }
  async returned(id: string, cancel = false): Promise<PreorderRow> {
    let row = (await this.store.preorder(id))!;
    if (cancel) {
      await this.store.transition(id, ['created', 'approved'], 'canceled');
      return (await this.store.preorder(id))!;
    }
    if (row.method === 'card' || !['created', 'approved'].includes(row.state)) return row;
    const campaign = (await this.store.campaign(row.campaignId))!;
    if (campaign.state !== 'open') {
      await this.store.transition(id, ['created', 'approved'], 'canceled');
      return (await this.store.preorder(id))!;
    }
    const outstanding = await this.store.all<PreorderRow>(
      "SELECT * FROM preorders WHERE campaignId=? AND id<>? AND state='checking'",
      row.campaignId,
      id,
    );
    for (const payment of outstanding) await this.reconcile(payment.id);
    if (
      await this.store.first(
        "SELECT id FROM preorders WHERE campaignId=? AND id<>? AND state='checking'",
        row.campaignId,
        id,
      )
    )
      throw new HttpError(409, 'CHECKING_PAYMENT', 'Reconcile the outstanding payment first.');
    if (!row.orderId) return row;
    const order = await this.pp.getOrder(row.orderId);
    if (!order.ok)
      throw new HttpError(502, 'PAYMENT_UNAVAILABLE', 'Payment status is unavailable. Try again.');
    if (order.body.status === 'COMPLETED') {
      await this.applyCapture(id, orderCapture(order.body), order.debugId);
      return (await this.store.preorder(id))!;
    }
    if (order.body.status !== 'APPROVED') return row;
    await this.store.transition(id, ['created'], 'approved');
    const claimed = await this.store.run(
      "UPDATE preorders SET state='capturing',updatedAt=? WHERE id=? AND state='approved' AND EXISTS(SELECT 1 FROM campaigns WHERE id=preorders.campaignId AND state='open')",
      this.store.now(),
      id,
    );
    if (!claimed) {
      if ((await this.store.campaign(row.campaignId))?.state !== 'open')
        await this.store.transition(id, ['created', 'approved'], 'canceled');
      return (await this.store.preorder(id))!;
    }
    row = (await this.store.preorder(id))!;
    await this.capture(row);
    return (await this.store.preorder(id))!;
  }
  async capture(row: PreorderRow, uncertain = false) {
    const requestId = uncertain ? `ss-capture-${row.id}` : await this.store.beginOp('capture', row.id);
    let answered = false;
    try {
      const result = await this.pp.captureOrder(row.orderId!, requestId);
      answered = true;
      if (!(uncertain && result.ok))
        await this.store.finishOp(
          requestId,
          result.ok ? 'ok' : 'failed',
          result.status,
          result.body.id ?? null,
        );
      if (result.body.simulated) await this.store.run('UPDATE preorders SET simulated=1 WHERE id=?', row.id);
      if (result.ok) {
        const resource = orderCapture(result.body);
        if (!resource?.id || !resource.status) throw new LostResponse();
        await this.applyCapture(row.id, resource, result.debugId);
      } else await this.store.transition(row.id, ['capturing'], 'declined', { debugId: result.debugId });
    } catch (error) {
      await this.writeError(
        row.id,
        'capture',
        requestId,
        (uncertain || answered) && !(error instanceof LostResponse) ? new LostResponse() : error,
      );
    }
  }
  async applyCapture(id: string, capture: Resource | undefined, debugId: string | null = null) {
    if (!capture?.id) return;
    const state =
      capture.status === 'COMPLETED'
        ? 'captured'
        : capture.status === 'PENDING'
          ? 'pending'
          : capture.status === 'DECLINED' || capture.status === 'DENIED'
            ? 'declined'
            : null;
    if (!state) return;
    const orderId = capture.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      // A verified capture webhook can beat the create response, including a lost one.
      await this.store.run('UPDATE preorders SET orderId=? WHERE id=? AND orderId IS NULL', orderId, id);
      if ((await this.store.preorder(id))?.method === 'card')
        await this.store.resolveLostOp('create', id, orderId);
    }
    await this.store.resolveLostOp('capture', id, capture.id);
    await this.store.transition(id, captureSources, state, { captureId: capture.id, debugId });
    if (state === 'captured') await this.onCaptured(id);
  }
  async reconcile(id: string): Promise<PreorderRow> {
    let row = (await this.store.preorder(id))!;
    if (['refunded', 'canceled', 'declined', 'failed'].includes(row.state)) return row;
    const refundOp = await this.store.op('refund', id);
    if (row.refundId && ['checking', 'refund_pending', 'refunding', 'refund_failed'].includes(row.state)) {
      try {
        const result = await this.pp.getRefund(row.refundId);
        if (result.ok) await this.applyRefund(id, result.body, result.debugId);
      } catch {
        /* PayPal read failed (network error or 5xx): leave row in current state. */
      }
    } else if (row.state === 'checking' && refundOp?.status === 'lost') {
      // A lost refund without an id is recovered by replaying the same idempotent write, never by a new payment.
      if (await this.claimRetry(refundOp.requestId, refundOp.at, refundOp.retryCount)) {
        await this.store.transition(id, ['checking'], 'refund_queued');
        await this.onCaptured(id);
      }
    } else if (row.state === 'checking' && (await this.store.op('create', id))?.status === 'lost') {
      const op = await this.store.op('create', id);
      if (op?.status === 'lost' && op.body && (await this.claimRetry(op.requestId, op.at, op.retryCount))) {
        // Replay the stored payload and key. A lost create must never mint a second key.
        await this.sendCreate(id, row.campaignId, JSON.parse(op.body), op.requestId, true);
      }
    } else if (
      row.orderId &&
      ['checking', 'capturing', 'pending', 'creating', 'created', 'approved'].includes(row.state)
    ) {
      const result = await this.pp.getOrder(row.orderId);
      if (!result.ok) return row;
      const createOp = await this.store.op('create', id);
      if (createOp?.status === 'lost' && result.body.id === row.orderId)
        await this.store.resolveLostOp('create', id, row.orderId);
      const capture = orderCapture(result.body);
      if (capture) await this.applyCapture(id, capture, result.debugId);
      else if (row.method !== 'card' && result.body.status === 'APPROVED' && row.state === 'checking') {
        const op = await this.store.op('capture', id);
        if (op?.status === 'lost' && (await this.claimRetry(op.requestId, op.at, op.retryCount))) {
          if (await this.store.transition(id, ['checking'], 'capturing')) await this.capture(row, true);
        } else if (!op) await this.store.transition(id, ['checking'], 'approved');
      }
    }
    row = (await this.store.preorder(id))!;
    return row;
  }
  private async claimRetry(requestId: string, at: string, count: number) {
    if (count >= MAX_CAPTURE_RETRIES || this.store.clock() - Date.parse(at) > CAPTURE_RETRY_WINDOW_MS)
      return false;
    return !!(await this.store.run(
      'UPDATE ops SET retryCount=retryCount+1 WHERE requestId=? AND retryCount=?',
      requestId,
      count,
    ));
  }
  async applyRefund(id: string, resource: Resource, debugId: string | null = null) {
    const state =
      resource.status === 'COMPLETED'
        ? 'refunded'
        : resource.status === 'PENDING'
          ? 'refund_pending'
          : ['FAILED', 'CANCELLED', 'DENIED'].includes(resource.status ?? '')
            ? 'refund_failed'
            : null;
    if (state) {
      if (resource.id) await this.store.resolveLostOp('refund', id, resource.id);
      await this.store.transition(
        id,
        ['captured', 'refund_queued', 'refunding', 'refund_pending', 'refund_failed', 'checking'],
        state,
        { refundId: resource.id ?? null, debugId },
      );
    }
  }
}
