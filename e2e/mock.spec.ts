import { test, expect } from '@playwright/test';
import { base, browserErrors, noHorizontalScroll, openMap } from './helpers';

test('mock walks every screen and the payment flow without any API request', async ({ page }, info) => {
  const apiCalls: string[] = [];
  const errors = browserErrors(page);
  await page.context().route('**/api/**', async (route) => {
    apiCalls.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
  await openMap(page, true);
  const split = page.getByRole('slider', { name: 'Forecast and preorders comparison' });
  await split.focus();
  await page.keyboard.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', '52');
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  await expect(page.locator('.agent-panel .source')).toHaveText(
    /Live AI|Code pick|Recorded run|Saved from a live answer/,
  );
  await page.screenshot({ path: info.outputPath('mock-map-agent.png') });
  await page.getByRole('button', { name: 'Preorder at this venue', exact: true }).click();
  await page.getByLabel('Venue', { exact: true }).selectOption('wharf');
  await page.getByRole('button', { name: 'Pay with PayPal sandbox', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paid', exact: true }).first()).toBeVisible();
  await expect(page.locator('.receipt')).toContainText('MOCK-CAPTURE');
  await page.screenshot({ path: info.outputPath('mock-paid-receipt.png') });
  await noHorizontalScroll(page);
  await page.getByRole('link', { name: 'View campaign', exact: true }).click();
  await page.getByLabel('Chosen venue').selectOption('mill');
  await page.getByRole('button', { name: 'Close campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm close', exact: true }).click();
  await expect(page.getByText('$0.00 outstanding liability')).toBeVisible();
  await expect(page.locator('.refund-row')).toContainText('MOCK-REFUND');
  await page.screenshot({ path: info.outputPath('mock-campaign-refund.png') });
  for (const route of ['/campaign', '/scorecard', '/receipts', '/proof', '/about', '/']) {
    await page.goto(`${base}${route}?mock=1`);
    await expect(page.locator('main')).toBeVisible();
    if (route !== '/') await expect(page.locator('h1')).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: info.outputPath(`mock-${route === '/' ? 'map' : route.slice(1)}.png`) });
  }
  // Keep this last so the missing Studio cannot hide coverage of the other screens.
  await page.goto(`${base}/studio?mock=1`);
  await expect(page.locator('main')).toBeVisible();
  await page.screenshot({ path: info.outputPath('mock-studio.png') });
  await expect
    .soft(page.getByRole('heading', { name: /studio/i }), 'SPEC requires the Studio dashboard at /studio')
    .toBeVisible();
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});
