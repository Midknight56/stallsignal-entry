import type { CampaignView } from '../shared/types';
import { PREORDER_SHARE } from '../data/history';
import { decideDemand } from './blend';

type DecisionView = Pick<CampaignView, 'forecastPick' | 'decided' | 'venues'>;

export function costOfForecast(view: DecisionView): number | null {
  if (view.forecastPick === view.decided) return null;
  return (
    view.venues.find((v) => v.id === view.decided)!.marginCents -
    view.venues.find((v) => v.id === view.forecastPick)!.marginCents
  );
}

// Recover the blend weight from the view so this works with either recorded or live evidence.
// Once the weight reaches one, the exact order count no longer changes the blend.
// Returns extra UNITS at the forecast pick: one order adds qtyPerOrder units and one to the order count.
export function breakEven(view: DecisionView, budget: number, qtyPerOrder = 1): number | null {
  const orders = breakEvenOrders(view, budget, qtyPerOrder);
  return orders === null ? null : orders * qtyPerOrder;
}

export function breakEvenOrders(view: DecisionView, budget: number, qtyPerOrder = 1): number | null {
  if (view.forecastPick === view.decided) return null;
  const row = view.venues.find(
    (v) => Math.abs((v.paidUnits + v.recordedUnits) / PREORDER_SHARE - v.forecastUnits) > 1e-9,
  );
  if (!row) return null;
  const weight =
    (row.blendedUnits - row.forecastUnits) /
    ((row.paidUnits + row.recordedUnits) / PREORDER_SHARE - row.forecastUnits);
  const count = Math.round(Math.max(0, Math.min(1, weight)) * 10);
  for (let n = 1; n <= 500; n++) {
    const demand = Object.fromEntries(
      view.venues.map((v) => [
        v.id,
        {
          recordedUnits: v.recordedUnits,
          pendingUnits: v.pendingUnits,
          paidUnits: v.paidUnits + (v.id === view.forecastPick ? n * qtyPerOrder : 0),
        },
      ]),
    ) as Parameters<typeof decideDemand>[0];
    if (decideDemand(demand, count + n, budget).decided === view.forecastPick) return n;
  }
  return null;
}
