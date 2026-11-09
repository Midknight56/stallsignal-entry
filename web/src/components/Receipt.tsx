import type { Preorder } from '../../../src/shared/types';
import {
  methodLabel,
  money,
  receiptId,
  shortId,
  stateLabel,
  stateTone,
  time,
  type ReceiptCampaign,
  venueName,
} from '../format';
import { venues } from '../../../src/data/venues';
export default function Receipt({
  preorder: p,
  campaign,
}: {
  preorder: Preorder;
  campaign?: ReceiptCampaign;
}) {
  return (
    <article className="receipt">
      <div className="section-head">
        <h2>{stateLabel(p.state)}</h2>
        <span className={`chip ${stateTone(p.state)}`}>
          {p.source === 'recorded' ? 'Recorded run' : 'Live payment'}
        </span>
      </div>
      {p.state === 'failed' && <p role="status">PayPal could not be reached. Nothing was charged.</p>}
      <p className="amount">{money(p.amountCents)}</p>
      <dl className="receipt-details">
        <div>
          <dt>Venue</dt>
          <dd>{venueName(venues, p.venue)}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{methodLabel(p.method)}</dd>
        </div>
        <div>
          <dt>Preorder</dt>
          <dd title={p.id}>{shortId(p.id)}</dd>
        </div>
        <div>
          <dt>Order id</dt>
          <dd title={p.orderId ?? ''}>{receiptId(p, 'orderId', campaign)}</dd>
        </div>
        <div>
          <dt>Capture id</dt>
          <dd title={p.captureId ?? ''}>{receiptId(p, 'captureId', campaign)}</dd>
        </div>
        <div>
          <dt>Refund id</dt>
          <dd title={p.refundId ?? ''}>{receiptId(p, 'refundId', campaign)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{time(p.updatedAt)}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>
            <span className={`chip ${stateTone(p.state)}`}>{stateLabel(p.state)}</span>
          </dd>
        </div>
      </dl>
    </article>
  );
}
