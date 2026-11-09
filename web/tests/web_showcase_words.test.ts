import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Receipt from '../src/components/Receipt';
import Campaign from '../src/pages/Campaign';
import BuyerCampaign from '../src/pages/BuyerCampaign';
import PreorderSheet from '../src/panel/PreorderSheet';
import { ClosedCampaignCard } from '../src/pages/Scorecard';
import Receipts from '../src/pages/Receipts';
import CityMap from '../src/map/CityMap';
import WhatChanges from '../src/components/WhatChanges';
import Proof from '../src/pages/Proof';
import { freshCampaign, world } from '../src/mock/fixtures';
import { closedCampaign } from '../../src/domain/scorecard';
import type { SharedCampaignView } from '../../src/shared/types';

const FORBIDDEN = /sandbox|test card|test money|example venue|example maker|pretend/i;
const paid = world.recorded!.preorders.find((p) => p.state === 'captured')!;

describe('showcase words: no sandbox, test or example badges on flow screens', () => {
  it('the receipt (card receipt and recorded PayPal receipt)', () => {
    const cardReceipt = renderToStaticMarkup(
      createElement(Receipt, { preorder: { ...paid, method: 'card' } }),
    );
    expect(cardReceipt).not.toMatch(FORBIDDEN);

    const paypalReceipt = renderToStaticMarkup(
      createElement(Receipt, { preorder: { ...paid, method: undefined, source: 'recorded' } }),
    );
    expect(paypalReceipt).not.toMatch(FORBIDDEN);
  });

  it('the Campaign page with an open campaign', () => {
    const campaignMarkup = renderToStaticMarkup(
      createElement(Campaign, { world, campaign: freshCampaign(), onChange: () => {} }),
    );
    expect(campaignMarkup).not.toMatch(FORBIDDEN);
    expect(campaignMarkup).not.toMatch(/example/i);
  });

  it('the buyer page', () => {
    const fixtureShared: SharedCampaignView = {
      token: 'tok-1',
      campaignState: 'open',
      venues: world.venues.map((v) => ({ id: v.id, forecastUnits: 10, paidUnits: 5 })),
      catalog: world.catalog,
      mine: [],
    };
    const buyerMarkup = renderToStaticMarkup(
      createElement(BuyerCampaign, { token: 'tok-1', initialShared: fixtureShared }),
    );
    expect(buyerMarkup).not.toMatch(FORBIDDEN);
  });

  it('the preorder sheet (not mock)', () => {
    const preorderMarkup = renderToStaticMarkup(
      createElement(PreorderSheet, { world, campaign: freshCampaign(), venue: 'wharf' }),
    );
    expect(preorderMarkup).not.toMatch(FORBIDDEN);
  });

  it('a closed campaign card and the recorded card on Scorecard', () => {
    const closedRow = {
      ...closedCampaign('c32b2189b7ba4d3b88622cba8644ff16', [], 'wharf', null),
      isRecorded: false,
    };
    const closedCardMarkup = renderToStaticMarkup(
      createElement(ClosedCampaignCard, { campaign: closedRow, venues: world.venues }),
    );
    expect(closedCardMarkup).not.toMatch(FORBIDDEN);

    const recordedRow = {
      ...closedCampaign('rec-1', [], 'mill', null),
      isRecorded: true,
    };
    const recordedCardMarkup = renderToStaticMarkup(
      createElement(ClosedCampaignCard, { campaign: recordedRow, venues: world.venues }),
    );
    expect(recordedCardMarkup).not.toMatch(FORBIDDEN);
  });

  it('the Receipts page', () => {
    const receiptsMarkup = renderToStaticMarkup(createElement(Receipts, { world }));
    expect(receiptsMarkup).not.toMatch(FORBIDDEN);
  });

  it('the Map legend (CityMap) with the recorded run included and with it left out', () => {
    const mapWithRecorded = renderToStaticMarkup(
      createElement(CityMap, {
        world,
        campaign: freshCampaign(),
        selected: 'wharf',
        onSelect: () => {},
        split: 50,
        onSplit: () => {},
        includeRecorded: true,
      }),
    );
    expect(mapWithRecorded).not.toMatch(FORBIDDEN);

    const mapWithoutRecorded = renderToStaticMarkup(
      createElement(CityMap, {
        world,
        campaign: freshCampaign(),
        selected: 'wharf',
        onSelect: () => {},
        split: 50,
        onSplit: () => {},
        includeRecorded: false,
      }),
    );
    expect(mapWithoutRecorded).not.toMatch(FORBIDDEN);
  });

  it('the What changes box', () => {
    const whatChangesMarkup = renderToStaticMarkup(
      createElement(WhatChanges, {
        campaign: freshCampaign(),
        venues: world.venues,
        catalog: world.catalog,
        budget: 90000,
        includeRecorded: true,
        onIncludeRecorded: () => {},
        sharePercent: 20,
        share: 0.2,
        onSharePercent: () => {},
        historySharePercent: 20,
      }),
    );
    expect(whatChangesMarkup).not.toMatch(FORBIDDEN);
    expect(whatChangesMarkup).not.toMatch(/recorded example/i);
  });

  it.skip('the agent panel recorded run block - skipped: recordedExample is internal state in AgentPanel populated only via getRecordedAgent() on button click, cannot be rendered with a fixture via renderToStaticMarkup', () => {});

  it('the Proof page banner', () => {
    const proofMarkup = renderToStaticMarkup(createElement(Proof));
    expect(proofMarkup).not.toMatch(FORBIDDEN);
    // No stand in wording on screen: the banner says only what runs.
    expect(proofMarkup).not.toMatch(/stand in|nothing is sent/i);
    expect(proofMarkup).toContain('<p class="proof-banner">These checks run the real payment code in your browser.</p>');
  });
});
