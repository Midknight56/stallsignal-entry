import { useEffect, useState } from 'react';
import type { CampaignView, Preorder } from '../../../src/shared/types';
import { approvalHref, createPreorder, isMock, reconcilePreorder } from '../api';
import { errorText, stateLabel } from '../format';
import { returnOnce } from '../returnOnce';
import Receipt from '../components/Receipt';
export default function Return({
  href,
  onUpdate,
  campaign,
}: {
  href: (path: string) => string;
  onUpdate: () => Promise<void>;
  campaign: CampaignView;
}) {
  const params = new URLSearchParams(location.search),
    id = params.get('p'),
    cancel = params.get('cancel') === '1';
  const [preorder, setPreorder] = useState<Preorder | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true);
  let buyerToken: string | null = null;
  try {
    buyerToken = sessionStorage.getItem('ss-buyer-token');
  } catch {
    /* Storage unavailable */
  }
  useEffect(() => {
    let active = true;
    if (!id) {
      setError('This return link is missing its payment id.');
      setBusy(false);
      return;
    }
    returnOnce(id, cancel)
      .then((r) => {
        if (active) setPreorder(r.preorder);
        void onUpdate().catch(() => {});
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [id, cancel, onUpdate]);
  async function reconcile() {
    const paymentId = preorder?.id ?? id;
    if (!paymentId) return;
    setBusy(true);
    setError('');
    try {
      setPreorder((await reconcilePreorder(paymentId)).preorder);
      await onUpdate();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!preorder) return;
    setBusy(true);
    setError('');
    try {
      const result = await createPreorder(preorder.venue, preorder.product, preorder.qty, preorder.method);
      setPreorder(result.preorder);
      await onUpdate();
      if (result.preorder.state === 'failed') return;
      if (result.preorder.method === 'card') {
        location.assign(`/return?p=${encodeURIComponent(result.preorder.id)}${isMock() ? '&mock=1' : ''}`);
        return;
      }
      location.assign(approvalHref(result.approveUrl));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const needsCheck =
    preorder &&
    ['checking', 'pending', 'capturing', 'creating', 'approved', 'created', 'refund_pending'].includes(
      preorder.state,
    );
  return (
    <main className="page narrow">
      <p className="eyebrow">Your payment receipt</p>
      <h1>
        {busy && !preorder
          ? cancel
            ? 'Canceling'
            : 'Capturing'
          : preorder
            ? stateLabel(preorder.state)
            : 'Check your payment'}
      </h1>
      {busy && <p role="status">Please wait while we check the payment.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preorder && <Receipt preorder={preorder} campaign={campaign} />}
      <div className="actions">
        {(needsCheck || (error && id)) && (
          <button disabled={busy} onClick={reconcile}>
            Reconcile
          </button>
        )}
        {preorder?.state === 'failed' && (
          <button className="primary" disabled={busy} onClick={retry}>
            Try again
          </button>
        )}
        {preorder?.state === 'declined' && (
          <a className="button primary" href={href(buyerToken ? `/c/${buyerToken}` : '/')}>
            Try again
          </a>
        )}
        {preorder?.state === 'canceled' && (
          <a className="button" href={href(buyerToken ? `/c/${buyerToken}` : '/')}>
            Choose a venue
          </a>
        )}
        <a className="button" href={href(buyerToken ? `/c/${buyerToken}` : '/campaign')}>
          View campaign
        </a>
      </div>
      {preorder?.state === 'pending' && <p>Payment is pending. Reconcile to check its latest state.</p>}
      {preorder?.state === 'declined' && <p>No payment was captured. Try again with a new order.</p>}
    </main>
  );
}
