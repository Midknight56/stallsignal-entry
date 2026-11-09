import type { CampaignView, ProductId, VenueId } from '../shared/types';
import { decideDemand, type Demand } from './blend';

export interface ScenarioOptions {
  includeRecorded: boolean;
  product: ProductId;
  qtyPerOrder: 1 | 2 | 3;
  share: number;
  budget: number;
}
export interface ScenarioRow {
  venue: VenueId;
  orders: number | null;
  units: number | null;
  resultPick: VenueId;
  current: boolean;
}
type ScenarioView = Pick<CampaignView, 'venues' | 'paidOrders' | 'recordedOrders'>;

export const MAX_SCENARIO_ORDERS = 200;

// Captured units only. Pending units never count. Recorded units count only when the visitor includes them.
function demandOf(view: ScenarioView, o: ScenarioOptions, venue?: VenueId, extraUnits = 0) {
  return Object.fromEntries(
    view.venues.map((v) => [
      v.id,
      {
        paidUnits: v.paidUnits + (v.id === venue ? extraUnits : 0),
        recordedUnits: o.includeRecorded ? v.recordedUnits : 0,
        pendingUnits: 0,
      },
    ]),
  ) as Record<VenueId, Demand>;
}
const ordersOf = (view: ScenarioView, o: ScenarioOptions) =>
  view.paidOrders + (o.includeRecorded ? view.recordedOrders : 0);

export function currentDecision(view: ScenarioView, o: ScenarioOptions): ReturnType<typeof decideDemand> {
  return decideDemand(demandOf(view, o), ordersOf(view, o), o.budget, o.share);
}

export function whatChanges(view: ScenarioView, o: ScenarioOptions): ScenarioRow[] {
  const now = currentDecision(view, o).decided;
  const orders = ordersOf(view, o);
  return view.venues.map((v) => {
    if (v.id === now) return { venue: v.id, orders: 0, units: 0, resultPick: now, current: true };
    for (let n = 1; n <= MAX_SCENARIO_ORDERS; n++) {
      const pick = decideDemand(demandOf(view, o, v.id, n * o.qtyPerOrder), orders + n, o.budget, o.share).decided;
      if (pick === v.id) return { venue: v.id, orders: n, units: n * o.qtyPerOrder, resultPick: pick, current: false };
    }
    return { venue: v.id, orders: null, units: null, resultPick: now, current: false };
  });
}
