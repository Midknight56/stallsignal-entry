import { decide } from './blend';
import { DEFAULT_CONTEXT, type DecisionContext } from './context';
import type { Preorder, VenueId } from '../shared/types';
import { history } from '../data/history';
import { venues } from '../data/venues';
import type { ScorecardCampaignRow, ScorecardView } from '../shared/types';

export function scorecard(campaigns: ScorecardCampaignRow[] = []): ScorecardView {
  const rows = history.map((h) => ({
    ...h,
    errorPercent: ((h.forecastUnits - h.actualUnits) / h.actualUnits) * 100,
  }));
  return {
    history: rows,
    campaigns,
    perVenue: venues.map((v) => {
      const own = rows.filter((h) => h.venue === v.id);
      return {
        venue: v.id,
        meanAbsoluteError: own.reduce((n, h) => n + Math.abs(h.errorPercent), 0) / own.length,
      };
    }),
  };
}

export function closedCampaign(
  id: string,
  preorders: Preorder[],
  chosen: VenueId,
  closedAt: string | null,
  baseline: Preorder[] = [],
  saved?: { context: DecisionContext; forecastPick: VenueId; paidPick: VenueId } | null,
): ScorecardCampaignRow {
  const evidence = preorders.filter(
    (p) =>
      p.captureId &&
      p.captureId !== 'PENDING_RECORD' &&
      [
        'captured',
        'refund_queued',
        'refunding',
        'refunded',
        'refund_pending',
        'refund_failed',
        'checking',
      ].includes(p.state),
  );
  // A campaign closed with a saved context keeps the picks the maker saw at close. Older rows are worked out at
  // the default context.
  const decision = saved
    ? { forecastPick: saved.forecastPick, decided: saved.paidPick }
    : decide([], DEFAULT_CONTEXT.budget, [
        ...baseline,
        ...evidence.map((p) => ({ ...p, source: 'recorded' as const, state: 'captured' as const })),
      ]);
  const paidOrders = evidence.length;
  const verdict =
    paidOrders === 0
      ? ('no_evidence' as const)
      : decision.forecastPick !== decision.decided
        ? ('changed' as const)
        : ('kept' as const);
  return {
    id,
    forecastPick: decision.forecastPick,
    decided: chosen,
    paidPick: decision.decided,
    forecastWrong: verdict === 'changed',
    paidOrders,
    verdict,
    outcomeMeasured: false as const,
    paidUnits: Object.fromEntries(
      venues.map((v) => [v.id, evidence.filter((p) => p.venue === v.id).reduce((n, p) => n + p.qty, 0)]),
    ) as Record<VenueId, number>,
    closedAt,
    preorderCount: preorders.length,
    refundCount: preorders.filter((p) => p.state === 'refunded').length,
    context: saved?.context ?? DEFAULT_CONTEXT,
    contextSaved: !!saved,
  };
}
