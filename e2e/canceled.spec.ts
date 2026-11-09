import { test, expect } from './payment-test';
import { base, campaign, startPreorder, waitPayment } from './helpers';
import { resumeAfterBuyer } from './payment-test';
test.use({ trace: 'off' }); // App-only traces are managed by payment-test.

test('buyer cancels approval and returns without a capture', async ({ page }) => {
  const { preorder, approveUrl } = await startPreorder(page, 'mill');
  // Open the actual approval page, then exercise the configured cancel callback without logging in.
  await page.goto(approveUrl, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/https:\/\/(?:[^/]+\.)?sandbox\.paypal\.com\//);
  await page.goto(`${base}/return?p=${encodeURIComponent(preorder.id)}&cancel=1`);
  await resumeAfterBuyer(page.context());
  await waitPayment(page, preorder.id, ['canceled']);
  await expect(page.getByRole('heading', { name: 'Canceled', exact: true }).first()).toBeVisible();
  const current = await campaign(page);
  expect(current.venues.every((v) => v.paidUnits === 0)).toBe(true);
  expect(current.preorders[0].captureId).toBeNull();
  expect(current.ops.filter((o) => o.kind === 'capture')).toHaveLength(0);
});
