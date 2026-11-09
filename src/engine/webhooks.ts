import { HttpError } from '../errors';
import { PayPal } from '../paypal/client';
import { Preorders } from './preorders';
import { Store, type EventRow, type PreorderRow } from './store';

export class Webhooks {
  constructor(
    readonly store: Store,
    readonly pp: PayPal,
    readonly preorders: Preorders,
  ) {}
  async receive(headers: Headers, raw: string) {
    if (!(await this.pp.verifyWebhook(headers, raw)))
      throw new HttpError(400, 'INVALID_SIGNATURE', 'The webhook signature could not be verified.');
    const event = JSON.parse(raw) as {
      id?: unknown;
      event_type?: unknown;
      resource?: { id?: unknown; custom_id?: unknown };
    };
    if (
      !event ||
      typeof event.id !== 'string' ||
      !event.id ||
      typeof event.event_type !== 'string' ||
      typeof event.resource?.id !== 'string'
    )
      throw new HttpError(400, 'INVALID_EVENT', 'The webhook event is incomplete.');
    const customId = typeof event.resource.custom_id === 'string' ? event.resource.custom_id : '';
    // Match the whole stored custom id rather than splitting ids that may themselves contain hyphens.
    const row = customId.startsWith('ss-')
      ? await this.store.first<PreorderRow>(
          "SELECT * FROM preorders WHERE ?='ss-' || campaignId || '-' || id OR ?='ss-' || campaignId || '-' || id || '-r'",
          customId,
          customId,
        )
      : null;
    const inserted = await this.store.run(
      'INSERT OR IGNORE INTO events(event_id,type,resourceId,customId,campaignId,status,at) VALUES(?,?,?,?,?,?,?)',
      event.id,
      event.event_type,
      event.resource.id,
      customId,
      row?.campaignId ?? null,
      row ? 'received' : 'ignored',
      this.store.now(),
    );
    if (inserted && row)
      await this.process({
        event_id: event.id,
        type: event.event_type,
        resourceId: event.resource.id,
        customId,
        campaignId: row.campaignId,
        status: 'received',
        at: this.store.now(),
      });
  }
  async replay(campaignId: string) {
    for (const event of await this.store.all<EventRow>(
      "SELECT * FROM events WHERE status='received' AND campaignId=? ORDER BY at",
      campaignId,
    ))
      await this.process(event);
  }
  async process(event: EventRow) {
    const row = await this.store.first<PreorderRow>(
      "SELECT * FROM preorders WHERE ?='ss-' || campaignId || '-' || id OR ?='ss-' || campaignId || '-' || id || '-r'",
      event.customId,
      event.customId,
    );
    if (!row) return;
    try {
      if (event.type.startsWith('PAYMENT.CAPTURE.') && event.type !== 'PAYMENT.CAPTURE.REFUNDED') {
        if (row.captureId && row.captureId !== event.resourceId) {
          await this.done(event, 'ignored');
          return;
        }
        const result = await this.pp.getCapture(event.resourceId);
        if (!result.ok) return;
        const custom = `ss-${row.campaignId}-${row.id}`;
        if (
          result.body.custom_id !== custom ||
          (row.orderId &&
            result.body.supplementary_data?.related_ids?.order_id &&
            result.body.supplementary_data.related_ids.order_id !== row.orderId)
        ) {
          await this.done(event, 'ignored');
          return;
        }
        await this.preorders.applyCapture(row.id, result.body, result.debugId);
      } else if (event.type.startsWith('PAYMENT.REFUND.') || event.type === 'PAYMENT.CAPTURE.REFUNDED') {
        if (row.refundId && row.refundId !== event.resourceId) {
          await this.done(event, 'ignored');
          return;
        }
        const result = await this.pp.getRefund(event.resourceId);
        if (!result.ok) return;
        if (result.body.custom_id !== `ss-${row.campaignId}-${row.id}-r`) {
          await this.done(event, 'ignored');
          return;
        }
        await this.preorders.applyRefund(row.id, result.body, result.debugId);
      } else if (event.type.startsWith('CHECKOUT.ORDER.')) {
        if (row.orderId && row.orderId !== event.resourceId) {
          await this.done(event, 'ignored');
          return;
        }
        const result = await this.pp.getOrder(event.resourceId);
        if (!result.ok) return;
        const custom = result.body.purchase_units?.[0]?.custom_id ?? result.body.custom_id;
        if (custom !== `ss-${row.campaignId}-${row.id}`) {
          await this.done(event, 'ignored');
          return;
        }
        if (!row.orderId)
          await this.store.run(
            'UPDATE preorders SET orderId=? WHERE id=? AND orderId IS NULL',
            event.resourceId,
            row.id,
          );
        if (result.body.status === 'CREATED')
          await this.store.transition(row.id, ['creating', 'checking'], 'created');
        await this.preorders.reconcile(row.id);
      } else {
        await this.done(event, 'ignored');
        return;
      }
      await this.done(event, 'done');
    } catch {
      /* Leave received events durable for close or reconciliation to replay. */
    }
  }
  private done(event: EventRow, status: string) {
    return this.store.run('UPDATE events SET status=? WHERE event_id=?', status, event.event_id);
  }
}
