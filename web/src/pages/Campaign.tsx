import { useCallback, useEffect, useRef, useState } from 'react';
import type { CampaignView, Op, Preorder, VenueId, World } from '../../../src/shared/types';
import type { ColDef } from 'ag-grid-community';
import { closeCampaign, getCampaign, reconcilePreorder, resetCampaign, retryRefund, revokeShare, shareCampaign } from '../api';
import {
  decisionLine,
  errorText,
  methodLabel,
  money,
  shortId,
  stateLabel,
  stateTone,
  time,
  venueName,
} from '../format';
import Grid from '../components/Grid';
import { panelDecision, scenarioOf } from '../decision';
import { DEFAULT_CONTEXT, contextLabel, type DecisionContext } from '../../../src/domain/context';
import { isRefundRow, isUncertainCheckingRefund, nextCheckDelay, refundRowsToCheck } from '../refundChecks';
export default function Campaign({
  world,
  campaign,
  onChange,
  context = DEFAULT_CONTEXT,
}: {
  world: World;
  campaign: CampaignView;
  onChange: (c: CampaignView) => void;
  context?: DecisionContext;
}) {
  // The same decision as the map panel: the shared budget, evidence choice and share.
  const view = panelDecision(campaign, scenarioOf(context));
  const [venue, setVenue] = useState<VenueId>(view.decided),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [error, setError] = useState('');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const checkingRef = useRef(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const executeChecks = useCallback(async () => {
    if (checkingRef.current || document.visibilityState !== 'visible') return;
    const toCheck = refundRowsToCheck(campaignRef.current);
    if (toCheck.length === 0) {
      attemptRef.current = 0;
      clearTimer();
      return;
    }
    checkingRef.current = true;
    try {
      for (const row of toCheck) {
        if (document.visibilityState !== 'visible') break;
        setCheckingId(row.id);
        try {
          await reconcilePreorder(row.id);
          setRowErrors((prev) => {
            if (!prev[row.id]) return prev;
            const next = { ...prev };
            delete next[row.id];
            return next;
          });
          const updated = await getCampaign();
          onChangeRef.current(updated);
        } catch {
          setRowErrors((prev) => ({
            ...prev,
            [row.id]: 'Could not reach PayPal. The refund is still owed. Try again.',
          }));
        } finally {
          setCheckingId(null);
        }
      }
    } finally {
      checkingRef.current = false;
      setCheckingId(null);
      const remaining = refundRowsToCheck(campaignRef.current);
      if (remaining.length > 0 && document.visibilityState === 'visible') {
        const delay = nextCheckDelay(attemptRef.current);
        attemptRef.current += 1;
        clearTimer();
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          executeChecks().catch(() => {});
        }, delay);
      } else if (remaining.length === 0) {
        attemptRef.current = 0;
        clearTimer();
      }
    }
  }, []);

  useEffect(() => {
    const toCheck = refundRowsToCheck(campaign);
    if (toCheck.length === 0) {
      attemptRef.current = 0;
      clearTimer();
      return;
    }
    if (!checkingRef.current && timerRef.current === null && document.visibilityState === 'visible') {
      const delay = nextCheckDelay(attemptRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        executeChecks().catch(() => {});
      }, delay);
    }
  }, [campaign, executeChecks]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const toCheck = refundRowsToCheck(campaignRef.current);
        if (toCheck.length > 0 && !checkingRef.current && timerRef.current === null) {
          const delay = nextCheckDelay(attemptRef.current);
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            executeChecks().catch(() => {});
          }, delay);
        }
      } else {
        clearTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [executeChecks]);

  async function handleCheckStatus(id: string) {
    if (checkingRef.current) return;
    clearTimer();
    checkingRef.current = true;
    setCheckingId(id);
    try {
      await reconcilePreorder(id);
      setRowErrors((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const updated = await getCampaign();
      onChange(updated);
    } catch {
      setRowErrors((prev) => ({
        ...prev,
        [id]: 'Could not reach PayPal. The refund is still owed. Try again.',
      }));
    } finally {
      checkingRef.current = false;
      setCheckingId(null);
      const remaining = refundRowsToCheck(campaignRef.current);
      if (remaining.length > 0 && document.visibilityState === 'visible') {
        const delay = nextCheckDelay(attemptRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          executeChecks().catch(() => {});
        }, delay);
      }
    }
  }

  useEffect(() => {
    if (!confirm) setVenue(view.decided);
  }, [view.decided, confirm]);
  async function action(fn: () => Promise<CampaignView>) {
    setBusy(true);
    setError('');
    try {
      onChange(await fn());
      setConfirm(false);
    } catch (e) {
      setError(errorText(e));
      await getCampaign()
        .then(onChange)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const columns: ColDef<Preorder>[] = [
    { field: 'id', headerName: 'Preorder' },
    { field: 'from', headerName: 'From', minWidth: 90, valueFormatter: (p) => (p.value === 'buyer' ? 'Buyer' : 'You') },
    { field: 'method', headerName: 'Method', valueFormatter: (p) => methodLabel(p.value) },
    { field: 'venue', headerName: 'Venue', valueFormatter: (p) => venueName(world.venues, p.value) },
    { field: 'qty', headerName: 'Units', minWidth: 80 },
    { field: 'amountCents', headerName: 'Amount', valueFormatter: (p) => money(p.value) },
    {
      field: 'state',
      headerName: 'State',
      minWidth: 160,
      cellRenderer: (p: { value: string }) => (
        <span className={`chip ${stateTone(p.value)}`}>{stateLabel(p.value)}</span>
      ),
    },
  ];
  const ops: ColDef<Op>[] = [
    { field: 'kind', headerName: 'Kind' },
    { field: 'requestId', headerName: 'Request id', minWidth: 240 },
    { field: 'status', headerName: 'Status' },
    { field: 'http', headerName: 'HTTP' },
    { field: 'paypalId', headerName: 'PayPal id', minWidth: 200 },
    { field: 'at', headerName: 'Time', minWidth: 200, valueFormatter: (p) => time(p.value) },
  ];
  return (
    <main className="page">
      <p className="eyebrow">Your campaign</p>
      <h1>Your campaign</h1>
      <span className="chip">{campaign.state}</span>
      <p className="decision">{decisionLine(view, world.venues, context.includeRecorded)}</p>
      <p className="small">Worked out at {contextLabel(context)}. Change it on the Map.</p>
      {campaign.chosen && <p>Chosen venue: {venueName(world.venues, campaign.chosen)}</p>}
      {campaign.checking && (
        <div role="status" className="banner">
          <strong>Checking payment</strong>
          <p>Reconcile the payment before paying or closing.</p>
          {campaign.preorders
            .filter((p) => p.state === 'checking')
            .map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await reconcilePreorder(p.id);
                    return getCampaign();
                  })
                }
              >
                Reconcile {p.id}
              </button>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="totals">
        {campaign.venues.map((v) => (
          <article className="card" key={v.id}>
            <h2>{venueName(world.venues, v.id)}</h2>
            <p className="forecast">{v.forecastUnits} forecast units</p>
            <p className="paid">
              {v.recordedUnits} recorded units. {v.paidUnits} your paid units.
            </p>
            <p className="pending">{v.pendingUnits} pending units</p>
            <p>{Math.round(v.blendedUnits)} blended units</p>
            <strong>{money(v.marginCents)} expected margin</strong>
          </article>
        ))}
      </div>
      <section className="card">
        <h2>Share with buyers</h2>
        <p>Give buyers this link to collect preorders into your campaign.</p>
        {campaign.shareToken ? (
          <div className="share-box">
            <p className="share-url">
              <code>{location.origin + '/c/' + campaign.shareToken}</code>
            </p>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() => {
                  void navigator.clipboard?.writeText(location.origin + '/c/' + campaign.shareToken);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await revokeShare();
                    return getCampaign();
                  })
                }
              >
                Stop sharing
              </button>
            </div>
          </div>
        ) : (
          <button
            disabled={busy || campaign.state !== 'open'}
            onClick={() =>
              action(async () => {
                await shareCampaign();
                return getCampaign();
              })
            }
          >
            Create buyer link
          </button>
        )}
      </section>
      <section>
        <h2>Your preorders</h2>
        <Grid rows={campaign.preorders} columns={columns} label="Your preorders" />
      </section>
      <section className="card">
        <h2>Close this campaign</h2>
        <p>Choose one venue. Each paid order at another venue gets its own refund.</p>
        {campaign.state === 'open' && (
          <>
            <label>
              Chosen venue
              <select
                aria-label="Chosen venue"
                value={venue}
                disabled={busy || campaign.checking}
                onChange={(e) => {
                  setVenue(e.target.value as VenueId);
                  setConfirm(false);
                }}
              >
                {world.venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            {confirm ? (
              <div role="group" aria-label="Confirm campaign close">
                <p>Close with {venueName(world.venues, venue)}? Refunds at the other venues will start.</p>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || campaign.checking}
                    onClick={() => action(() => closeCampaign(venue, context))}
                  >
                    Confirm close
                  </button>
                  <button disabled={busy} onClick={() => setConfirm(false)}>
                    Keep open
                  </button>
                </div>
              </div>
            ) : (
              <button disabled={busy || campaign.checking} onClick={() => setConfirm(true)}>
                Close campaign
              </button>
            )}
          </>
        )}
        {campaign.state === 'closing' && <p role="status">Closing. Refund outcomes will update here.</p>}
        {campaign.state === 'closed' && (
          <button
            disabled={busy || campaign.checking || campaign.liabilityCents > 0}
            onClick={() => action(resetCampaign)}
          >
            Start a new campaign
          </button>
        )}
      </section>
      <section>
        <h2>Each payment’s refund</h2>
        <p>Each refund is checked with PayPal until it is final.</p>
        <p className="amount">{money(campaign.liabilityCents)} outstanding liability</p>
        {campaign.preorders
          .filter((p) => isRefundRow(p, campaign))
          .map((p) => {
            const canCheck =
              p.state === 'refund_pending' ||
              p.state === 'refunding' ||
              isUncertainCheckingRefund(p, campaign);
            return (
              <article key={p.id} className="refund-row" data-preorder={p.id}>
                <div>
                  <strong>{venueName(world.venues, p.venue)}</strong>
                  <p>
                    <span title={p.id}>{shortId(p.id)}</span> · {money(p.amountCents)}
                  </p>
                  <p>
                    Capture: {p.captureId ?? 'Not yet'}. Refund: {p.refundId ?? 'Not yet'}
                  </p>
                  <p>{time(p.updatedAt)}</p>
                </div>
                <span className={`chip ${stateTone(p.state)}`}>{stateLabel(p.state)}</span>
                {canCheck && (
                  <button disabled={busy || checkingId !== null} onClick={() => handleCheckStatus(p.id)}>
                    Check refund status
                  </button>
                )}
                {p.state === 'refund_failed' && (
                  <button
                    disabled={busy || campaign.checking}
                    onClick={() => action(() => retryRefund(p.id))}
                  >
                    Retry refund
                  </button>
                )}
                {rowErrors[p.id] && (
                  <span role="alert" className="error">
                    {rowErrors[p.id]}
                  </span>
                )}
              </article>
            );
          })}
        {!campaign.preorders.some((p) => isRefundRow(p, campaign)) && <p>No refunds yet.</p>}
      </section>
      <section>
        <h2>Payment operation log</h2>
        <Grid rows={campaign.ops} columns={ops} label="Payment operation log" />
      </section>
    </main>
  );
}
