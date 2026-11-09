import { venues } from '../data/venues';
import type { AgentView, VenueId } from '../shared/types';
import type { Evidence, Fact } from './facts';
import {
  compare_sites,
  draft_preorder_campaign,
  propose_stock_allocation,
  read_location_evidence,
} from './tools';

export const pickSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pick', 'facts', 'risk'],
  properties: {
    pick: { type: 'string', enum: venues.map((v) => v.id) },
    facts: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: { type: 'string', enum: Array.from({ length: 16 }, (_, i) => `F${i + 1}`) },
    },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
};
export function codeAnswer(
  input: Evidence,
  pick?: VenueId,
  selected?: Fact[],
  risk: AgentView['risk'] = 'medium',
): AgentView {
  const facts = venues.flatMap((v) => read_location_evidence(v.id, input));
  const decision = compare_sites(input);
  const chosen = pick ?? decision.decided;
  const allocation = propose_stock_allocation(chosen, input.budget);
  const offer = draft_preorder_campaign(chosen);
  return {
    pick: chosen,
    codePick: decision.decided,
    source: 'code',
    facts: (selected ?? facts.filter((f) => f.venue === chosen).slice(0, 3)).map(({ id, text }) => ({
      id,
      text,
    })),
    risk,
    allocation,
    stockCostCents: allocation.reduce((n, r) => n + r.costCents, 0),
    budgetCents: input.budget,
    offer,
    label: 'Code pick (model answer failed a check)',
    neurons: { reserved: 0, used: 0, appLeft: 0 },
  };
}
