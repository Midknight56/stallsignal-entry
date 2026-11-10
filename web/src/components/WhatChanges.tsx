import { useState } from 'react';
import type { CampaignView, Product, ProductId, Venue, VenueId } from '../../../src/shared/types';
import { MAX_SCENARIO_ORDERS, whatChanges } from '../../../src/domain/scenarios';
import { venueName } from '../format';

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

export default function WhatChanges({
  campaign,
  venues,
  catalog,
  budget,
  includeRecorded,
  onIncludeRecorded,
  sharePercent,
  share = sharePercent / 100,
  onSharePercent,
  historySharePercent,
}: {
  campaign: CampaignView;
  venues: Venue[];
  catalog: Product[];
  budget: number;
  includeRecorded: boolean;
  onIncludeRecorded: (v: boolean) => void;
  sharePercent: number;
  share?: number;
  onSharePercent: (v: number) => void;
  historySharePercent: number;
}) {
  const [product, setProduct] = useState<ProductId>('tin');
  const [qtyPerOrder, setQty] = useState<1 | 2 | 3>(1);
  const name = (id: VenueId) => (id === 'wharf' ? 'Shed 9' : venueName(venues, id));
  const productName = catalog.find((p) => p.id === product)?.name ?? product;
  const rows = whatChanges(campaign, { includeRecorded, product, qtyPerOrder, share, budget });
  const shares = [...new Set([historySharePercent, 10, 20, 30])].sort((a, z) => a - z);
  const counted = campaign.paidOrders + (includeRecorded ? campaign.recordedOrders : 0);
  return (
    <section className="what-changes" aria-label="What changes the choice?">
      <h3>What changes the choice?</h3>
      <fieldset className="evidence-toggle">
        <legend>Evidence</legend>
        <label>
          <input type="radio" name="evidence" value="campaign" checked={!includeRecorded} onChange={() => onIncludeRecorded(false)} />
          This campaign only
        </label>
        <label>
          <input type="radio" name="evidence" value="recorded" checked={includeRecorded} onChange={() => onIncludeRecorded(true)} />
          Include recorded run
        </label>
      </fieldset>
      <div className="what-changes-controls">
        <select aria-label="Scenario product" value={product} onChange={(e) => setProduct(e.target.value as ProductId)}>
          {catalog.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Quantity per order"
          value={String(qtyPerOrder)}
          onChange={(e) => setQty(Number(e.target.value) as 1 | 2 | 3)}
        >
          {[1, 2, 3].map((q) => (
            <option key={q} value={String(q)}>
              {q} per order
            </option>
          ))}
        </select>
      </div>
      <label className="share-label" htmlFor="preorder-share">
        Preorders are this share of event sales (assumption)
      </label>
      <select
        id="preorder-share"
        aria-label="Preorders are this share of event sales (assumption)"
        value={String(sharePercent)}
        onChange={(e) => onSharePercent(Number(e.target.value))}
      >
        {shares.map((s) => (
          <option key={s} value={String(s)}>
            {s === historySharePercent ? `${s}% (default)` : `${s}%`}
          </option>
        ))}
      </select>
      <ul>
        {rows.map((row) => (
          <li key={row.venue} className={row.current ? 'current' : undefined}>
            {row.current
              ? `${name(row.venue)} is the pick now.`
              : row.orders === null
                ? `${name(row.venue)} does not become the pick within ${MAX_SCENARIO_ORDERS} orders.`
                : `${name(row.venue)} becomes the pick after ${row.orders} more ${row.orders === 1 ? 'order' : 'orders'} of ${qtyPerOrder} ${productName} (${plural(row.units!, 'unit')}).`}
          </li>
        ))}
      </ul>
      <p className="small">Paid orders counted: {counted}.</p>
    </section>
  );
}
