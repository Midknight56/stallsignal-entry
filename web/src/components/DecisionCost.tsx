import type { CampaignView, Venue } from '../../../src/shared/types';
import { DEFAULT_STOCK_BUDGET_CENTS } from '../../../src/caps';
import { PREORDER_SHARE } from '../../../src/data/history';
import { expectedMargin } from '../../../src/domain/forecast';
import { MAX_SCENARIO_ORDERS, whatChanges, type ScenarioOptions } from '../../../src/domain/scenarios';
import { panelDecision } from '../decision';
import { venueName } from '../format';

export default function DecisionCost({
  campaign,
  venues,
  budget = DEFAULT_STOCK_BUDGET_CENTS,
  scenario,
}: {
  campaign: CampaignView;
  venues: Venue[];
  budget?: number;
  scenario?: ScenarioOptions;
}) {
  const s: ScenarioOptions = scenario ?? {
    includeRecorded: true,
    share: PREORDER_SHARE,
    product: 'tin',
    qtyPerOrder: 1,
    budget,
  };
  const view = panelDecision(campaign, s);
  if (view.forecastPick === view.decided) return null;
  const decidedRow = view.venues.find((v) => v.id === view.decided);
  const forecastRow = view.venues.find((v) => v.id === view.forecastPick);
  if (!decidedRow || !forecastRow) return null;
  const cost =
    expectedMargin(view.decided, decidedRow.blendedUnits, s.budget) -
    expectedMargin(view.forecastPick, forecastRow.blendedUnits, s.budget);
  if (cost <= 0) return null;
  const row = whatChanges(campaign, { ...s, qtyPerOrder: 1 }).find((r) => r.venue === view.forecastPick);
  const forecast = view.forecastPick === 'wharf' ? 'Shed 9' : venueName(venues, view.forecastPick);
  const paid = venueName(venues, view.decided);
  return (
    <div className="decision-cost">
      <p>
        Booking {forecast} on the forecast gives an estimated margin about{' '}
        {new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        }).format(cost / 100)}{' '}
        lower on today's evidence. This is an estimate, not money saved.
      </p>
      <p>
        {!row || row.orders === null
          ? `${paid} stays the pick even with ${MAX_SCENARIO_ORDERS} more paid units at ${forecast}.`
          : `${paid} stays the pick until ${forecast} gets ${row.units} more paid units.`}
      </p>
      <p className="small">Estimates exclude unsold stock, your time, travel and payment fees.</p>
    </div>
  );
}
