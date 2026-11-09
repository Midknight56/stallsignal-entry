import { HISTORY_SHARE_PERCENT, shareOf } from '../../../src/domain/context';
import type { AgentView, CampaignView, Preorder, ScorecardView, VenueId } from '../../../src/shared/types';
import { city } from '../../../src/data/city';
import { venues } from '../../../src/data/venues';
import { catalog } from '../../../src/data/catalog';
import { history, PREORDER_SHARE } from '../../../src/data/history';
import { heat } from '../../../src/data/heat';
import { decide, evidenceCounts } from '../../../src/domain/blend';
import type { MapWorld } from '../world';
import snapshot from '../../../src/data/recorded-agent.json' with { type: 'json' };

// UI fixtures only. These ids are mock values, never sandbox receipts.
const recordedPreorders: Preorder[] = venues.flatMap((v) =>
  (v.id === 'mill' ? [2, 2, 1, 1, 1, 1] : v.id === 'wharf' ? [1, 1] : [1]).map((qty, i) => ({
    id: `mock-recorded-${v.id}-${i}`,
    venue: v.id,
    product: 'tin' as const,
    qty,
    amountCents: qty * catalog[0].priceCents,
    state: v.id === 'mill' ? ('captured' as const) : ('refunded' as const),
    orderId: `MOCK-RECORDED-ORDER-${v.id}-${i}`,
    captureId: `MOCK-RECORDED-CAPTURE-${v.id}-${i}`,
    refundId: v.id === 'mill' ? null : `MOCK-RECORDED-REFUND-${v.id}-${i}`,
    debugId: null,
    updatedAt: '2026-11-06T12:00:00Z',
    source: 'recorded' as const,
  })),
);
export const world: MapWorld = {
  city,
  venues,
  catalog,
  history,
  heat,
  preorderShare: PREORDER_SHARE,
  recorded: {
    id: 'mock-rec-1',
    state: 'closed',
    chosen: 'mill',
    preorders: recordedPreorders,
    label: 'Recorded sandbox run (mock fixture)',
    recordedAt: '2026-11-06T12:00:00Z',
  },
  modes: ['Real streets', 'Example venues', 'Synthetic history', 'Recorded run', 'Sandbox'],
};
export function freshCampaign(): CampaignView {
  return {
    id: 'mock-campaign',
    state: 'open',
    chosen: null,
    checking: false,
    liabilityCents: 0,
    preorders: [],
    ops: [],
    shareToken: null,
    ...decide([], 90000, recordedPreorders),
    ...evidenceCounts([], recordedPreorders),
  };
}
export function mockAgent(
  budget: number,
  campaign: CampaignView,
  includeRecorded = true,
  sharePercent = HISTORY_SHARE_PERCENT,
): AgentView {
  const units = Math.floor(budget / 735);
  const pick: VenueId = decide(
    campaign.preorders,
    budget,
    includeRecorded ? recordedPreorders : [],
    shareOf(sharePercent),
  ).decided;
  let left = budget;
  const allocation = world.catalog.map((p) => {
    const count = Math.min(
      Math.floor(left / p.unitCostCents),
      Math.floor(Math.min(units, world.venues.find((v) => v.id === pick)!.stockCap) * p.defaultMix),
    );
    left -= count * p.unitCostCents;
    return { product: p.id, units: count, costCents: count * p.unitCostCents };
  });
  return {
    pick,
    codePick: pick,
    source: 'ai',
    steps: [
      {
        tool: 'read_location_evidence',
        venue: pick,
        label: `Read ${world.venues.find((v) => v.id === pick)!.name} evidence`,
      },
      { tool: 'compare_sites', label: 'Compared the three venues' },
      {
        tool: 'propose_stock_allocation',
        venue: pick,
        label: `Allocated ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(budget / 100)} at ${world.venues.find((v) => v.id === pick)!.name}`,
      },
    ],
    risk: 'medium',
    facts: [
      { id: 'F1', text: 'Synthetic history shows winter demand at the wharf fell short of its forecast.' },
      {
        id: 'F2',
        text: `${world.venues.find((v) => v.id === pick)!.name} has a positive expected margin at this stock budget.`,
      },
    ],
    allocation,
    stockCostCents: budget - left,
    budgetCents: budget,
    offer: {
      venue: pick,
      lines: ['Candles for the December weekend.'],
      terms: 'Fully refunded if this venue is not chosen. Pickup Sat 19 Dec.',
    },
    neurons: { reserved: 0, used: 0, appLeft: 900 },
  };
}
export function mockRecordedAgent(): AgentView {
  return { ...(snapshot as AgentView), source: 'recorded', budgetCents: 90000 };
}
export const scorecard = (): ScorecardView => {
  const rows = history.map((r) => ({
    ...r,
    errorPercent: ((r.forecastUnits - r.actualUnits) / r.actualUnits) * 100,
  }));
  return {
    history: rows,
    campaigns: [],
    perVenue: world.venues.map((v) => {
      const own = rows.filter((r) => r.venue === v.id);
      return {
        venue: v.id,
        meanAbsoluteError: own.reduce((s, r) => s + Math.abs(r.errorPercent), 0) / own.length,
      };
    }),
  };
};
