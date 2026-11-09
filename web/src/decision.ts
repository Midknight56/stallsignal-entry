import type { CampaignView } from '../../src/shared/types';
import { currentDecision, type ScenarioOptions } from '../../src/domain/scenarios';
import { shareOf, type DecisionContext } from '../../src/domain/context';

// The scenario for the shared decision context: the panel, the map and the campaign page all use this one.
export const scenarioOf = (c: DecisionContext): ScenarioOptions => ({
  includeRecorded: c.includeRecorded,
  share: shareOf(c.sharePercent),
  product: 'tin',
  qtyPerOrder: 1,
  budget: c.budget,
});

// One decision for the whole map panel, at the selected budget, share and evidence. Units shown on the cards stay
// as the server counted them; the blend and the margin come from the same decision as the pick.
export function panelDecision(campaign: CampaignView, scenario: ScenarioOptions): CampaignView {
  const d = currentDecision(campaign, scenario);
  return {
    ...campaign,
    forecastPick: d.forecastPick,
    decided: d.decided,
    overturned: d.overturned,
    venues: campaign.venues.map((v) => {
      const row = d.venues.find((r) => r.id === v.id)!;
      return { ...v, blendedUnits: row.blendedUnits, marginCents: row.marginCents };
    }),
  };
}
