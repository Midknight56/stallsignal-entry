import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { freshCampaign, world } from '../src/mock/fixtures';
import { panelDecision } from '../src/decision';
import WhatChanges from '../src/components/WhatChanges';
import DecisionCost from '../src/components/DecisionCost';
import Panel from '../src/panel';
import { whatChanges, type ScenarioOptions } from '../../src/domain/scenarios';
import { PREORDER_SHARE } from '../../src/data/history';

const scenario = (o: Partial<ScenarioOptions> = {}): ScenarioOptions => ({
  includeRecorded: true,
  product: 'tin',
  qtyPerOrder: 1,
  share: PREORDER_SHARE,
  budget: 90000,
  ...o,
});
const name = (id: string) => (id === 'wharf' ? 'Shed 9' : world.venues.find((v) => v.id === id)!.name);
const history = Math.round(PREORDER_SHARE * 100);
const changes = (includeRecorded: boolean) =>
  renderToStaticMarkup(
    createElement(WhatChanges, {
      campaign: freshCampaign(),
      venues: world.venues,
      catalog: world.catalog,
      budget: 90000,
      includeRecorded,
      onIncludeRecorded: () => {},
      sharePercent: history,
      share: PREORDER_SHARE,
      onSharePercent: () => {},
      historySharePercent: history,
    }),
  ).replace(/&#x27;/g, "'");

describe('one decision for the map panel', () => {
  it('this campaign only with no live payments shows the forecast pick, and the budget can change it', () => {
    const only = panelDecision(freshCampaign(), scenario({ includeRecorded: false }));
    expect(only.decided).toBe(only.forecastPick);
    expect(panelDecision(freshCampaign(), scenario({ includeRecorded: false, budget: 15000 })).decided).toBe('linden');
    expect(panelDecision(freshCampaign(), scenario({ includeRecorded: false, budget: 90000 })).decided).toBe('wharf');
  });
  it('including the recorded example at $900 matches the server decision', () => {
    const c = freshCampaign();
    const view = panelDecision(c, scenario());
    expect(view.decided).toBe(c.decided);
    expect(view.venues.map((v) => v.recordedUnits)).toEqual(c.venues.map((v) => v.recordedUnits));
  });
});

describe('What changes the choice?', () => {
  it('lists the current pick and the exact orders each other venue needs', () => {
    const html = changes(false);
    const rows = whatChanges(freshCampaign(), scenario({ includeRecorded: false }));
    for (const row of rows) {
      if (row.current) expect(html).toContain(`${name(row.venue)} is the pick now.`);
      else if (row.orders === null) expect(html).toContain(`${name(row.venue)} does not become the pick within 200 orders.`);
      else
        expect(html).toContain(
          `${name(row.venue)} becomes the pick after ${row.orders} more ${row.orders === 1 ? 'order' : 'orders'} of 1 Travel tin candle (${row.units} ${row.units === 1 ? 'unit' : 'units'}).`,
        );
    }
    expect(html).toContain('Paid orders counted: 0.');
  });
  it('has its labelled controls and whole number share values', () => {
    const html = changes(true);
    expect(html).toContain('aria-label="What changes the choice?"');
    expect(html).toContain('This campaign only');
    expect(html).toContain('Include recorded example');
    expect(html).toContain('Preorders are this share of event sales (assumption)');
    // The order sheet owns the names Product and Quantity: the browser tests find it by those names.
    expect(html).not.toContain('aria-label="Product"');
    expect(html).not.toContain('aria-label="Quantity"');
    const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    for (const v of ['10', '20', '30', String(history)]) expect(values).toContain(v);
    expect(values.some((v) => v.includes('.'))).toBe(false);
  });
});

describe('no paid orders counted', () => {
  it('the panel says the forecast picks, even on the paid side of the line', () => {
    const empty = {
      ...freshCampaign(),
      recordedOrders: 0,
      venues: freshCampaign().venues.map((v) => ({ ...v, recordedUnits: 0 })),
    };
    const html = renderToStaticMarkup(
      createElement(Panel, {
        world: world as never,
        campaign: empty,
        selected: 'mill',
        onSelect: () => {},
        onRefresh: async () => {},
        split: 95,
        onAgentAnswer: () => {},
        budget: 90000,
        onBudget: () => {},
      }),
    );
    expect(html).toContain('Forecast picks Shed 9');
    expect(html).not.toContain('Preorders pick');
  });
});

describe('money words', () => {
  it('the decision cost is an estimated margin, not money saved', () => {
    const html = renderToStaticMarkup(
      createElement(DecisionCost, { campaign: freshCampaign(), venues: world.venues, budget: 90000 }),
    ).replace(/&#x27;/g, "'");
    expect(html).toContain('gives an estimated margin about $');
    expect(html).toContain('This is an estimate, not money saved.');
    expect(html).toContain('Estimates exclude unsold stock, your time, travel and payment fees.');
    expect(html).not.toContain('would give up');
  });
  it('the panel shows captured money and estimated margins apart', () => {
    const html = renderToStaticMarkup(
      createElement(Panel, {
        world: world as never,
        campaign: freshCampaign(),
        selected: 'mill',
        onSelect: () => {},
        onRefresh: async () => {},
        split: 95,
        onAgentAnswer: () => {},
        budget: 90000,
        onBudget: () => {},
      }),
    ).replace(/&#x27;/g, "'");
    expect(html).toContain('Captured in this campaign: $0.00 (sandbox, not refunded)');
    expect(html).toContain('Estimated margin');
    expect(html).not.toContain('Margin on today');
    // The default share is the exact history share, so the panel matches the server decision to the cent.
    expect(html).toContain(renderToStaticMarkup(
      createElement(DecisionCost, { campaign: freshCampaign(), venues: world.venues, budget: 90000 }),
    ).replace(/&#x27;/g, "'"));
  });
});
