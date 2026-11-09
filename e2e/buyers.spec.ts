import { test, expect } from '@playwright/test';
import { base, campaign, noHorizontalScroll } from './helpers';

test('maker shares campaign, buyer pays at Millrace Hall, maker closes and buyer sees Refunded', async ({
  browser,
}) => {
  const makerContext = await browser.newContext();
  const buyerContext = await browser.newContext();
  const makerPage = await makerContext.newPage();
  const buyerPage = await buyerContext.newPage();

  try {
    await makerPage.setViewportSize({ width: 390, height: 844 });
    await buyerPage.setViewportSize({ width: 390, height: 844 });

    // 1. Maker opens campaign and creates buyer share link
    await makerPage.goto(`${base}/campaign`);
    await makerPage.getByRole('button', { name: 'Create buyer link', exact: true }).click();
    await expect(makerPage.getByRole('button', { name: 'Copy link', exact: true })).toBeVisible();

    const shareUrl = await makerPage.locator('.share-url code').textContent();
    expect(shareUrl).toMatch(/\/c\/[a-f0-9]{32}/);
    const tokenMatch = shareUrl!.match(/\/c\/([a-f0-9]{32})/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    // 2. Buyer opens shared link
    await buyerPage.goto(shareUrl!);
    await expect(
      buyerPage.getByRole('heading', { name: 'Preorder for the December popup', exact: true }),
    ).toBeVisible();
    await expect(
      buyerPage.getByText('Example maker and example venues. Sandbox test money only.', { exact: true }),
    ).toBeVisible();
    await noHorizontalScroll(buyerPage);

    // 3. Buyer pays with test card at Millrace Hall
    await buyerPage.getByLabel('Venue', { exact: true }).selectOption('mill');
    const responsePromise = buyerPage.waitForResponse(
      (r) => r.url().includes(`/api/shared/${token}/preorders`) && r.request().method() === 'POST',
    );
    await buyerPage.getByRole('button', { name: 'Pay with test card', exact: true }).click();
    const createdResponse = await responsePromise;
    expect(createdResponse.ok()).toBe(true);

    await expect(buyerPage).toHaveURL(/\/return\?p=/);
    await buyerPage.getByRole('link', { name: 'View campaign', exact: true }).click();
    await expect(buyerPage).toHaveURL(new RegExp(`/c/${token}`));
    await expect(buyerPage.locator('.chip').filter({ hasText: 'Paid' })).toBeVisible();

    // 4. Maker sees the buyer units and a Buyer row without reloading
    await expect(makerPage.getByText('1 your paid units', { exact: false })).toBeVisible();
    await expect(makerPage.locator('.ag-row').filter({ hasText: 'Buyer' }).first()).toBeVisible({ timeout: 20_000 });

    // 5. Maker closes with another venue (wharf)
    await makerPage.getByLabel('Chosen venue').selectOption('wharf');
    await makerPage.getByRole('button', { name: 'Close campaign', exact: true }).click();
    await makerPage.getByRole('button', { name: 'Confirm close', exact: true }).click();
    await expect.poll(async () => (await campaign(makerPage)).state, { timeout: 60_000 }).toBe('closed');

    // 6. Buyer page shows Refunded (allow up to 60 s)
    await expect(buyerPage.locator('.chip').filter({ hasText: 'Refunded' })).toBeVisible({ timeout: 60_000 });

    // 7. Buyer attempt to close maker campaign returns 403
    const makerCamp = await campaign(makerPage);
    const closeAttempt = await buyerPage.request.post(`${base}/api/campaign/close`, {
      data: { campaignId: makerCamp.id, venue: 'mill' },
    });
    expect(closeAttempt.status()).toBe(403);
  } finally {
    await makerContext.close();
    await buyerContext.close();
  }
});
