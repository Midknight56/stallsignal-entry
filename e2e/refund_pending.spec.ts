import { test, expect } from './payment-test';
import { campaign, closeWith, fault, placePreorder, waitPayment } from './helpers';
test.use({ trace: 'off' }); // App-only traces are managed by payment-test.

test('pending losing venue refund shows Check refund status and settles automatically', async ({ page }) => {
  const p = await placePreorder(page, 'wharf');
  await waitPayment(page, p.id, ['captured']);
  await fault(page, 'refund_pending');
  await closeWith(page, 'mill');
  await waitPayment(page, p.id, ['refund_pending']);
  const row = page.locator(`.refund-row[data-preorder="${p.id}"]`);
  await expect(row).toContainText('Refund pending');
  await expect(row.getByRole('button', { name: 'Check refund status', exact: true })).toBeVisible();
  expect((await campaign(page)).liabilityCents).toBe(p.amountCents);
  await expect(page.getByText('$14.00 outstanding liability')).toBeVisible();
  const done = await waitPayment(page, p.id, ['refunded']);
  expect(done.refundId).toBeTruthy();
  await expect.poll(async () => (await campaign(page)).liabilityCents, { timeout: 60_000 }).toBe(0);
  await expect(page.getByText('$0.00 outstanding liability')).toBeVisible();
});
