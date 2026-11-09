import { test, expect } from './payment-test';
import { base, campaign, placePreorder, waitPayment } from './helpers';
test.use({ trace: 'off' }); // App-only traces are managed by payment-test.

test('declined capture counts no paid units and Try again creates a fresh order', async ({ page }) => {
  const declined = await placePreorder(page, 'mill', { fault: 'decline_next_capture' });
  await waitPayment(page, declined.id, ['declined']);
  await expect(page.getByRole('heading', { name: 'Declined', exact: true }).first()).toBeVisible();
  expect((await campaign(page)).venues.every((v) => v.paidUnits === 0)).toBe(true);
  await page.getByRole('link', { name: 'Try again', exact: true }).click();
  await expect(page).toHaveURL(`${base}/`);
  const retried = await placePreorder(page, 'mill');
  expect(retried.id).not.toBe(declined.id);
  expect(retried.orderId).not.toBe(declined.orderId);
  const paid = await waitPayment(page, retried.id, ['captured']);
  expect(paid.captureId).toBeTruthy();
  expect((await campaign(page)).venues.find((v) => v.id === 'mill')?.paidUnits).toBe(1);
});
