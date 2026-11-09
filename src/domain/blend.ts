import { venues } from '../data/venues';
import { PREORDER_SHARE } from '../data/history';
import { expectedMargin, forecastUnits } from './forecast';
import type { Preorder, Venue, VenueId } from '../shared/types';

// The blend weight counts orders, not units: one order of 3 units moves it less than three orders of 1 unit.
export function blendedUnits(
  venue: Venue | VenueId,
  paidUnits: number,
  paidOrdersTotal: number,
  share = PREORDER_SHARE,
): number {
  const w = Math.min(1, paidOrdersTotal / 10);
  return forecastUnits(venue) * (1 - w) + (paidUnits / share) * w;
}
// The payments that count as evidence: live captured ones, and recorded ones with a real capture.
export function evidenceRows(preorders: Preorder[] = [], recorded: Preorder[] = []) {
  const live = preorders.filter((p) => p.source === 'live' && p.state === 'captured');
  const evidence = recorded.filter(
    (p) =>
      p.source === 'recorded' &&
      p.captureId &&
      p.captureId !== 'PENDING_RECORD' &&
      ['captured', 'refund_queued', 'refunding', 'refunded', 'refund_pending', 'refund_failed'].includes(
        p.state,
      ),
  );
  return { live, evidence };
}
// Order counts and captured money for the campaign view, from the same filters the decision uses.
export function evidenceCounts(preorders: Preorder[] = [], recorded: Preorder[] = []) {
  const { live, evidence } = evidenceRows(preorders, recorded);
  return {
    paidOrders: live.length,
    recordedOrders: evidence.length,
    capturedCents: live.reduce((sum, p) => sum + p.amountCents, 0),
  };
}
export function decide(
  preorders: Preorder[] = [],
  budget = 90000,
  recorded: Preorder[] = [],
  share = PREORDER_SHARE,
) {
  const { live, evidence } = evidenceRows(preorders, recorded);
  const count = live.length + evidence.length;
  return decideDemand(
    Object.fromEntries(
      venues.map((v) => [
        v.id,
        {
          paidUnits: live.filter((p) => p.venue === v.id).reduce((n, p) => n + p.qty, 0),
          recordedUnits: evidence.filter((p) => p.venue === v.id).reduce((n, p) => n + p.qty, 0),
          pendingUnits: preorders
            .filter((p) => p.venue === v.id && ['pending', 'capturing', 'checking'].includes(p.state))
            .reduce((n, p) => n + p.qty, 0),
        },
      ]),
    ) as Record<VenueId, Demand>,
    count,
    budget,
    share,
  );
}

export type Demand = { paidUnits: number; recordedUnits: number; pendingUnits: number };

export function decideDemand(
  demand: Record<VenueId, Demand>,
  count: number,
  budget: number,
  share = PREORDER_SHARE,
) {
  const rows = venues.map((v) => {
    const { paidUnits, recordedUnits, pendingUnits } = demand[v.id];
    const units = blendedUnits(v, paidUnits + recordedUnits, count, share);
    return {
      id: v.id,
      forecastUnits: forecastUnits(v),
      recordedUnits,
      paidUnits,
      pendingUnits,
      blendedUnits: units,
      marginCents: expectedMargin(v, units, budget),
    };
  });
  const forecastPick = [...venues].sort(
    (a, b) => expectedMargin(b, forecastUnits(b), budget) - expectedMargin(a, forecastUnits(a), budget),
  )[0].id;
  const decided = [...rows].sort((a, b) => b.marginCents - a.marginCents)[0].id;
  return { forecastPick, decided, overturned: forecastPick !== decided, venues: rows };
}
