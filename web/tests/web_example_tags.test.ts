import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Receipt from '../src/components/Receipt';
import Receipts from '../src/pages/Receipts';
import Campaign from '../src/pages/Campaign';
import { ClosedCampaignCard } from '../src/pages/Scorecard';
import { world, freshCampaign } from '../src/mock/fixtures';
import { closedCampaign } from '../../src/domain/scorecard';

const count = (html: string) => html.split('Example venue').length - 1;
const paid = world.recorded!.preorders.find((p) => p.state === 'captured')!;

it('a receipt names its venue with one example tag', () => {
  const html = renderToStaticMarkup(createElement(Receipt, { preorder: paid }));
  expect(count(html)).toBe(1);
  expect(html).toContain('Venue');
});

it('the Receipts page says it is the recorded run and points to Campaign', () => {
  const html = renderToStaticMarkup(createElement(Receipts, { world, href: (p: string) => p }));
  expect(html).toContain('<h1>Recorded sandbox run</h1>');
  expect(html).toContain('Your own payments and refunds are on Campaign.');
  expect(html).toContain('href="/campaign"');
});

it('each Campaign venue card carries one example tag', () => {
  const html = renderToStaticMarkup(
    createElement(Campaign, { world, campaign: freshCampaign(), onChange: () => {} }),
  );
  expect(count(html)).toBeGreaterThanOrEqual(world.venues.length);
});

it('a closed campaign card carries an example tag', () => {
  const row = closedCampaign('c32b2189b7ba4d3b88622cba8644ff16', [], 'mill', null);
  const html = renderToStaticMarkup(createElement(ClosedCampaignCard, { campaign: row, venues: world.venues }));
  expect(count(html)).toBe(1);
});
