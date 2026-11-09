import type { CampaignView, Venue } from '../../src/shared/types';
import { DEFAULT_STOCK_BUDGET_CENTS } from '../../src/caps';
import { expectedMargin } from '../../src/domain/forecast';
import { money, venueName } from './format';

export function comparisonPick(campaign: CampaignView, split: number) {
  return split < 50 ? campaign.forecastPick : campaign.decided;
}
export function comparisonLine(
  campaign: CampaignView,
  venues: Venue[],
  split: number,
  budget = DEFAULT_STOCK_BUDGET_CENTS,
) {
  const pick = comparisonPick(campaign, split);
  const row = campaign.venues.find((v) => v.id === pick)!;
  const forecast = split < 50;
  const margin = expectedMargin(pick, forecast ? row.forecastUnits : row.blendedUnits, budget);
  const name = pick === 'wharf' ? 'Shed 9' : venueName(venues, pick);
  return `${forecast ? 'Forecast picks' : 'Preorders pick'} ${name}: ${money(margin)} margin ${forecast ? 'on the forecast alone' : "on today's evidence"}.`;
}
