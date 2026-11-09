import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import DecisionCost from '../src/components/DecisionCost';
import AgentPanel from '../src/panel/AgentPanel';
import { freshCampaign, world } from '../src/mock/fixtures';
import type { AgentView } from '../../src/shared/types';

describe('DecisionCost and AgentPanel budget features', () => {
  it('contains no 90000 literal in DecisionCost.tsx or comparison.ts', () => {
    const decisionCostSrc = readFileSync('web/src/components/DecisionCost.tsx', 'utf8');
    const comparisonSrc = readFileSync('web/src/comparison.ts', 'utf8');
    expect(decisionCostSrc).not.toContain('90000');
    expect(comparisonSrc).not.toContain('90000');
  });

  it('DecisionCost uses the given budget', () => {
    const campaign = freshCampaign();
    const html90 = renderToStaticMarkup(
      createElement(DecisionCost as any, { campaign, venues: world.venues, budget: 90000 }),
    );
    const html45 = renderToStaticMarkup(
      createElement(DecisionCost as any, { campaign, venues: world.venues, budget: 45000 }),
    );
    expect(html45).not.toBe(html90);
  });

  it('AgentPanel shows Within your $150.00 budget for a code answer at 15000', async () => {
    const mockCodeAnswer: AgentView = {
      pick: 'mill',
      codePick: 'mill',
      source: 'code',
      fallback: 'model_off',
      budgetCents: 15000,
      stockCostCents: 14700,
      facts: [{ id: 'F1', text: 'Some fact' }],
      risk: 'medium',
      allocation: [{ product: 'tin', units: 3, costCents: 14700 }],
      offer: { venue: 'mill', lines: ['line 1'], terms: 'terms' },
      neurons: { reserved: 0, used: 0, appLeft: 0 },
    };

    // We test that AgentPanel displays the budget check
    const html = renderToStaticMarkup(
      createElement(AgentPanel as any, {
        world,
        budget: 15000,
        onBudget: () => {},
        onAnswer: () => {},
        initialResult: mockCodeAnswer,
      }),
    );
    expect(html).toContain('Within your $150.00 budget');
  });
});
