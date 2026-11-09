import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AgentPanel from '../src/panel/AgentPanel';
import { world } from '../src/mock/fixtures';
import type { AgentView } from '../../src/shared/types';

const answer = (pick: AgentView['pick'], codePick: AgentView['codePick']): AgentView => ({
  pick,
  codePick,
  source: 'ai',
  budgetCents: 15000,
  stockCostCents: 14700,
  facts: [{ id: 'F1', text: 'Some fact' }],
  risk: 'medium',
  allocation: [{ product: 'tin', units: 3, costCents: 14700 }],
  offer: { venue: pick, lines: ['line 1'], terms: 'terms' },
  neurons: { reserved: 0, used: 0, appLeft: 0 },
});
const render = (a: AgentView) =>
  renderToStaticMarkup(createElement(AgentPanel, { world, budget: 15000, initialResult: a })).replace(/&#x27;/g, "'");

describe('the agent says when it chose differently from the numbers', () => {
  it('names the numbers pick when the agent picked another venue', () => {
    expect(render(answer('mill', 'linden'))).toContain(
      "The panel's numbers pick Linden Corner Shop. The agent chose differently from the same facts.",
    );
  });
  it('says nothing extra when they agree', () => {
    expect(render(answer('linden', 'linden'))).not.toContain('chose differently');
  });
});
