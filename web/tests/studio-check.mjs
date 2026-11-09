import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { world, freshCampaign, scorecard } from '../src/mock/fixtures.ts';

await mkdir('web/docs/verification/studio', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
const logs = [];
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const mockCalls = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) mockCalls.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (['warning', 'error'].includes(m.type())) logs.push(m.text());
  });
  await page.goto('http://127.0.0.1:5186/studio?mock=1');
  await expect(page.getByRole('heading', { name: 'Evidence Studio' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Venue map', exact: true })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: 'Winter forecast', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Loading...', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await mkdir('web/docs/verification/studio', { recursive: true });
  await page.screenshot({ path: 'web/docs/verification/studio/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Select Millrace Hall on map' }).click();
  await expect(page.locator('.studio-selection')).toContainText('Selected: Millrace Hall');
  await expect(page.locator('.studio-refund-venue')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select Millrace Hall on map' }).click();
  await expect(page.locator('.studio-selection')).toContainText('All venues');
  await page.getByRole('gridcell', { name: 'Millrace Hall', exact: true }).first().click();
  await expect(page.locator('.studio-selection')).toContainText('Selected: Millrace Hall');
  await expect(page.locator('.studio-refund-venue')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page
    .getByRole('region', { name: 'Refund liability by venue' })
    .getByRole('button', { name: /Linden Corner Shop/ })
    .click();
  await expect(page.locator('.studio-selection')).toContainText('Selected: Linden Corner Shop');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.locator('.ag-charts-swapchain[aria-hidden=false]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.studio-selection')).toContainText('Selected: Millrace Hall');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: 'Chart refunds by venue', exact: true }).click();
  await expect(page.locator('.studio-answer')).toContainText('Added a chart of refunds by venue.');
  await expect(page.locator('.studio-answer')).toContainText('Matched without AI');
  const addedWidgetTitle = page.locator('.ag-studio-layout-widget-title', { hasText: 'Refunds by venue' });
  await expect(addedWidgetTitle).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(addedWidgetTitle).toBeVisible();
  await page.getByRole('button', { name: 'Remove added', exact: true }).click();
  await expect(addedWidgetTitle).toHaveCount(0);
  await page.getByRole('button', { name: 'Show forecasts that overestimated demand', exact: true }).click();
  await expect(page.locator('.studio-answer')).toContainText('overestimated demand');
  await page.getByRole('button', { name: 'Where are refunds still open?', exact: true }).click();
  await expect(page.locator('.studio-answer')).toContainText('open refunds');
  expect(mockCalls).toEqual([]);
  results.push(
    'Mock mode makes no API requests. Map, evidence grid, chart keyboard selection and refund venue selection filter the dashboard. Repeated map selection clears it. All three Ask chips use the harness.',
  );
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('region', { name: 'Venue map', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const boxes = await Promise.all(
      ['.studio-map-widget', '.ag-studio-grid-widget', '.ag-charts-wrapper', '.studio-refunds'].map((s) =>
        page.locator(s).boundingBox(),
      ),
    );
    await page.locator('.studio-canvas').evaluate((e) => {
      for (const node of e.querySelectorAll('*')) node.scrollTop = 0;
    });
    const canvasBox = await page.locator('.studio-canvas').boundingBox();
    const refundsBox = await page.locator('.studio-refunds').boundingBox();
    expect(refundsBox.y + refundsBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height);
    const mapBox = await page.locator('.studio-map-widget').boundingBox();
    expect(mapBox.width).toBeLessThan(viewport.width);
    await page.locator('#studio-question').blur();
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    if (viewport.width < 760) {
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThan(boxes[i - 1].y);
    }
    await expect(page.getByRole('gridcell', { name: 'ERR', exact: true })).toHaveCount(0);
    const rowBoxes = await page
      .locator('.studio-evidence-grid .ag-center-cols-container .ag-row')
      .evaluateAll((rows) =>
        rows.map((row) => {
          const box = row.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        }),
      );
    for (let i = 1; i < rowBoxes.length; i++)
      expect(rowBoxes[i].top).toBeGreaterThanOrEqual(rowBoxes[i - 1].bottom);
    for (const selector of ['.studio-refunds', '.studio-map-widget', '.studio-evidence-grid']) {
      const dimensions = await page
        .locator(selector)
        .evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight }));
      expect(dimensions.content, selector + ' content fits').toBeLessThanOrEqual(dimensions.height + 2);
    }
    await page.screenshot({
      path: `web/docs/verification/studio/${viewport.width}-light.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.getByRole('gridcell', { name: 'ERR', exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `web/docs/verification/studio/${viewport.width}-dark.png`,
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: 'light' });
  }
  results.push(
    'Desktop and phone layouts have no horizontal page overflow; phone widgets form one column; light and dark screenshots saved.',
  );
  await page.close();

  const live = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  live.on('pageerror', (e) => errors.push(e.message));
  let failLoad = false;
  const asks = [];
  const campaign = freshCampaign();
  const receipt = (id, state, venue, amountCents, source = 'live') => ({
    id,
    state,
    venue,
    amountCents,
    source,
    qty: 1,
    product: 'tin',
    orderId: null,
    captureId: null,
    refundId: null,
    debugId: null,
    updatedAt: '2026-11-06T12:00:00Z',
  });
  campaign.preorders = [
    receipt('q', 'refund_queued', 'mill', 1400),
    receipt('r', 'refunding', 'mill', 2800),
    receipt('p', 'refund_pending', 'wharf', 3600),
    receipt('f', 'refund_failed', 'linden', 1400),
    receipt('paid', 'captured', 'mill', 1400),
  ];
  const recordedWorld = {
    ...world,
    recordedAt: '2026-11-06',
    recorded: {
      id: 'rec-1',
      label: 'Recorded run',
      preorders: [receipt('recorded', 'refunded', 'wharf', 2800, 'recorded')],
    },
  };
  await live.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/ask') {
      const { q } = route.request().postDataJSON();
      asks.push(q);
      const view = {
        Over: 'overestimated',
        Under: 'underestimated',
        Venue: 'by_venue',
        Refunds: 'refunds_open',
        Paid: 'paid_vs_forecast',
      }[q];
      return route.fulfill({
        json:
          q === 'Bad'
            ? { view: 'delete', venue: 'other', source: 'ai' }
            : { view, venue: q === 'Venue' ? 'mill' : null, source: q === 'Under' ? 'recorded' : 'ai' },
      });
    }
    if (failLoad) return route.fulfill({ status: 503, json: { error: 'NETWORK' } });
    const json = { '/api/world': recordedWorld, '/api/campaign': campaign, '/api/scorecard': scorecard() }[
      path
    ];
    if (!json) throw new Error(`Unexpected route ${path}`);
    return route.fulfill({ json });
  });
  await live.goto('http://127.0.0.1:5186/studio');
  await expect(live.locator('.studio-refund-total')).toContainText('$92.00');
  const askFor = async (q) => {
    await live.getByLabel('Ask about this evidence', { exact: true }).fill(q);
    await live.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(live.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled();
  };
  for (const [q, text, source] of [
    ['Over', 'overestimated demand', 'AI'],
    ['Under', 'underestimated demand', 'Recorded'],
    ['Venue', 'Millrace Hall', 'AI'],
    ['Refunds', 'open refunds', 'AI'],
    ['Paid', 'Comparing live paid units', 'AI'],
  ]) {
    await askFor(q);
    await expect(live.locator('.studio-answer')).toContainText(text);
    await expect(live.locator('.studio-answer .source')).toHaveText(source);
    if (q === 'Refunds') {
      await expect(live.locator('.studio-refund-payment')).toHaveCount(4);
      await expect(live.locator('.studio-refunds')).not.toContainText('Recorded run');
    }
  }
  expect(asks).toEqual(['Over', 'Under', 'Venue', 'Refunds', 'Paid']);
  await askFor('Bad');
  await expect(live.getByRole('alert')).toContainText('did not match a supported view');
  await expect(live.locator('.studio-selection')).toContainText('Paid and forecast');
  results.push(
    'Intercepted contract responses exercise all five Ask views with exactly one POST per question, source labels, and rejection of a bad answer without changing the view.',
  );
  results.push(
    'Refund totals include all four outstanding states ($92.00) and exclude captured and refunded payments; recorded receipts remain separate.',
  );
  failLoad = true;
  await live.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(live.getByRole('alert').filter({ hasText: 'Not updated' })).toBeVisible();
  await expect(live.locator('.studio-refund-total')).toContainText('$92.00');
  failLoad = false;
  await live.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(live.getByRole('alert').filter({ hasText: 'Not updated' })).toHaveCount(0);
  results.push('A refresh failure keeps the last good evidence; retry recovers.');
  await live.close();
  expect(errors).toEqual([]);
  expect(logs.filter((log) => /fatal error|configuration.*errors/i.test(log))).toEqual([]);
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await writeFile(
    'web/docs/verification/studio/browser-log.json',
    JSON.stringify({ results, errors, logs }, null, 2),
  );
  await browser.close();
}
