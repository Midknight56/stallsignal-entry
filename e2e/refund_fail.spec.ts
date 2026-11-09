import { test, expect } from './payment-test';
import { campaign, closeWith, fault, placePreorder, waitPayment } from './helpers';
test.use({ trace: 'off' }); // App-only traces are managed by payment-test.

test('failed losing-venue refund stays a liability and Retry settles it', async ({ page }) => {
  const p = await placePreorder(page, 'wharf');
  await waitPayment(page, p.id, ['captured']);
  await fault(page, 'refund_fails');
  await closeWith(page, 'mill');
  await waitPayment(page, p.id, ['refund_failed']);
  await expect(page.locator(`.refund-row[data-preorder="${p.id}"]`)).toContainText('Refund failed');
  expect((await campaign(page)).liabilityCents).toBe(p.amountCents);
  await expect(page.getByText('$14.00 outstanding liability')).toBeVisible();
  await page.getByRole('button', { name: 'Retry refund', exact: true }).click();
  const done = await waitPayment(page, p.id, ['refunded']);
  expect(done.refundId).toBeTruthy();
  await expect.poll(async () => (await campaign(page)).liabilityCents).toBe(0);
  await expect(page.getByText('$0.00 outstanding liability')).toBeVisible();
});
