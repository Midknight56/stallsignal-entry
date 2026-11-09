import { useEffect, useState } from 'react';
import { venues } from '../../../src/data/venues';
import type { PaymentMethod, Preorder, ProductId, SharedCampaignView, VenueId } from '../../../src/shared/types';
import { createSharedPreorder, getShared } from '../api';
import { errorText, money, stateLabel, stateTone, venueName } from '../format';
import PreorderSheet from '../panel/PreorderSheet';
import ExampleTag from '../components/ExampleTag';

export default function BuyerCampaign({ token }: { token: string }) {
  const [shared, setShared] = useState<SharedCampaignView | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getShared(token)
      .then((data) => {
        if (active) {
          setShared(data);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!shared) return;
    const isFinal = (p: Preorder) =>
      ['refunded', 'canceled', 'declined', 'failed'].includes(p.state) ||
      (shared.campaignState === 'closed' && p.state === 'captured');
    const hasUnfinished = shared.mine.length > 0 && !shared.mine.every(isFinal);
    if (!hasUnfinished && shared.campaignState === 'closed') return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        getShared(token)
          .then(setShared)
          .catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [token, shared]);

  const onRefresh = async () => {
    const data = await getShared(token);
    setShared(data);
  };

  const create = async (site: VenueId, product: ProductId, qty: number, method?: PaymentMethod) => {
    try {
      sessionStorage.setItem('ss-buyer-token', token);
    } catch {
      /* Storage unavailable */
    }
    const res = await createSharedPreorder(token, site, product, qty, method);
    await onRefresh().catch(() => {});
    return res;
  };

  if (loading) {
    return (
      <main className="page" role="status">
        Loading preorder options…
      </main>
    );
  }

  if (error || !shared) {
    return (
      <main className="page">
        <h1>We could not load this campaign</h1>
        <p role="alert">{error || 'This link is not valid or has expired.'}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <p className="eyebrow">Pickup 19 + 20 Dec 2026</p>
      <h1>Preorder for the December popup</h1>
      <p>Example maker and example venues. Sandbox test money only.</p>
      <div className="totals">
        {shared.venues.map((v) => (
          <article className="card" key={v.id}>
            <h2>{venueName(venues, v.id)}</h2>
            <ExampleTag />
            <p className="forecast">{v.forecastUnits} forecast units</p>
            <p className="paid">{v.paidUnits} paid units</p>
          </article>
        ))}
      </div>
      <PreorderSheet
        world={{ venues, catalog: shared.catalog }}
        campaign={{
          state: shared.campaignState,
          checking: shared.mine.some((p) => ['checking', 'capturing', 'creating'].includes(p.state)),
        }}
        venue={shared.venues[0]?.id ?? 'wharf'}
        onRefresh={onRefresh}
        create={create}
      />
      <section>
        <h2>Your preorders</h2>
        {shared.mine.length === 0 ? (
          <p>No preorders yet.</p>
        ) : (
          <div className="buyer-preorders">
            {shared.mine.map((p) => (
              <article key={p.id} className="card preorder-card" data-preorder={p.id}>
                <div>
                  <strong>{venueName(venues, p.venue)}</strong>
                  <p>{money(p.amountCents)}</p>
                  {p.orderId && <p>Order id: <code>{p.orderId}</code></p>}
                  {p.captureId && <p>Capture id: <code>{p.captureId}</code></p>}
                  {p.refundId && <p>Refund id: <code>{p.refundId}</code></p>}
                </div>
                <span className={`chip ${stateTone(p.state)}`}>{stateLabel(p.state)}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
