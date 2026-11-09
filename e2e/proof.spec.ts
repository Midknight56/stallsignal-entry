import { test, expect } from '@playwright/test';
import { base, browserErrors, noHorizontalScroll } from './helpers';

test('proof opens /proof, waits, and reads six Held rows with no api request and no console error', async ({
  page,
}, info) => {
  const apiCalls: string[] = [];
  const errors = browserErrors(page);
  await page.context().route('**/api/**', async (route) => {
    apiCalls.push(new URL(route.request().url()).pathname);
    await route.abort();
  });

  await page.goto(`${base}/proof?mock=1`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.proof-banner')).toHaveText(
    'These checks run the real payment code in your browser.',
  );

  const heldChips = page.locator('.proof-row .chip.held');
  await expect(heldChips).toHaveCount(6, { timeout: 30_000 });
  for (let i = 0; i < 6; i++) {
    await expect(heldChips.nth(i)).toHaveText('Held');
  }
  await expect(page.locator('.proof-row .chip.failed')).toHaveCount(0);
  await expect(page.locator('.proof-summary').nth(0)).toHaveText(
    'The answer to the capture was lost. The app read the order back from PayPal and recorded one capture.',
  );
  await expect(page.locator('.proof-summary').nth(3)).toHaveText(
    'The app ignored the amount sent by the browser and used the catalog price of $56.00.',
  );
  for (const summary of await page.locator('.proof-summary').allTextContents()) {
    expect(summary).not.toMatch(/ss-|ORDER-|REFUND-|CAPTURE-|cents|venue wharf/);
  }

  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('proof-1280.png') });

  // Test Run again button
  await page.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect(heldChips).toHaveCount(6, { timeout: 30_000 });
  for (let i = 0; i < 6; i++) {
    await expect(heldChips.nth(i)).toHaveText('Held');
  }

  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('proof displays correctly at phone viewport 390x844', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = browserErrors(page);
  await page.goto(`${base}/proof?mock=1`);
  await expect(page.locator('h1')).toBeVisible();
  const heldChips = page.locator('.proof-row .chip.held');
  await expect(heldChips).toHaveCount(6, { timeout: 30_000 });
  await noHorizontalScroll(page);
  await page.screenshot({ path: info.outputPath('proof-390.png') });
  expect(errors).toEqual([]);
});
