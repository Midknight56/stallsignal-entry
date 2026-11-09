import { useState } from 'react';
import type { PaymentMethod, Preorder, ProductId, VenueId, World } from '../../../src/shared/types';
import { approvalHref, createPreorder, isMock } from '../api';
import { errorText, money } from '../format';

export type CreatePreorderFn = (
  venue: VenueId,
  product: ProductId,
  qty: number,
  method?: PaymentMethod,
) => Promise<{ preorder: Preorder; approveUrl: string | null }>;

export default function PreorderSheet({
  world,
  campaign,
  venue,
  onClose,
  onRefresh,
  create,
}: {
  world: { venues: World['venues']; catalog: World['catalog'] };
  campaign: { state: string; checking?: boolean };
  venue: VenueId;
  onClose?: () => void;
  onRefresh?: () => Promise<void>;
  create?: CreatePreorderFn;
}) {
  const [site, setSite] = useState(venue),
    [product, setProduct] = useState<ProductId>('tin'),
    [qty, setQty] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [failed, setFailed] = useState(false);
  async function pay(method: PaymentMethod) {
    setBusy(true);
    setError('');
    try {
      const result = create
        ? await create(site, product, qty, method)
        : await createPreorder(site, product, qty, method);
      if (method === 'card') {
        location.assign(`/return?p=${encodeURIComponent(result.preorder.id)}${isMock() ? '&mock=1' : ''}`);
        return;
      }
      if (result.preorder.state === 'failed') {
        setFailed(true);
        setError('PayPal could not be reached. Nothing was charged.');
        await onRefresh?.().catch(() => {});
        setBusy(false);
        return;
      }
      location.assign(approvalHref(result.approveUrl));
    } catch (e) {
      setError(errorText(e));
      await onRefresh?.().catch(() => {});
      setBusy(false);
    }
  }
  return (
    <section className="preorder-sheet" aria-labelledby="preorder-title">
      <div className="section-head">
        <h2 id="preorder-title">Reserve your candles</h2>
        {onClose && (
          <button aria-label="Close preorder sheet" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <p className="chip">{isMock() ? 'Mock preview, no payment' : 'Live sandbox'}</p>
      <label>
        Venue
        <select aria-label="Venue" value={site} onChange={(e) => setSite(e.target.value as VenueId)}>
          {world.venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Product
        <select
          aria-label="Product"
          value={product}
          onChange={(e) => setProduct(e.target.value as ProductId)}
        >
          {world.catalog.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}, {money(p.priceCents)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantity
        <select aria-label="Quantity" value={qty} onChange={(e) => setQty(Number(e.target.value))}>
          {[1, 2, 3].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <p className="amount">{money(world.catalog.find((p) => p.id === product)!.priceCents * qty)}</p>
      <p>Fully refunded if this venue is not chosen. Pickup Sat 19 Dec.</p>
      <p className="small">Tallow and Tide. Sandbox only. No real money moves.</p>
      {campaign.checking && (
        <p role="status" className="banner">
          Checking payment
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="payment-choices">
        <div>
          <button
            className="primary"
            disabled={busy || campaign.checking || campaign.state !== 'open'}
            onClick={() => pay('card')}
          >
            Pay with test card
          </button>
          <p className="small">Sandbox test card. No login. Test money.</p>
        </div>
        <button
          disabled={busy || campaign.checking || campaign.state !== 'open'}
          onClick={() => pay('paypal')}
        >
          {failed ? 'Try again' : 'Pay with PayPal sandbox'}
        </button>
      </div>
      {busy && <p role="status">Checking payment…</p>}
    </section>
  );
}
