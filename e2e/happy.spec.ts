import { test, expect } from './payment-test';
import { shortCampaignId } from '../web/src/format';
import {
  base,
  browserErrors,
  campaign,
  closeWith,
  noHorizontalScroll,
  openMap,
  placePreorder,
  waitPayment,
} from './helpers';
test.use({ trace: 'off' }); // App-only traces are managed by payment-test.

test('paid preorders, losing-venue refund and public scorecard', async ({ page }) => {
  const errors = browserErrors(page);
  await openMap(page);
  await noHorizontalScroll(page);
  const split = page.getByRole('slider', { name: 'Forecast and preorders comparison' });
  const before = Number(await split.getAttribute('aria-valuenow'));
  await split.focus();
  await page.keyboard.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', String(before + 2));
  await page.keyboard.press('ArrowLeft');
  await expect(split).toHaveAttribute('aria-valuenow', String(before));
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  await expect(page.locator('.agent-panel .source')).toHaveText(
    /Live AI|Code pick|Recorded run|Saved from a live answer/,
  );
  await expect(page.getByText('Stock allocation', { exact: true })).toBeVisible();

  const mill = await placePreorder(page, 'mill');
  const paid = await waitPayment(page, mill.id, ['captured']);
  await expect(page.getByRole('heading', { name: 'Paid', exact: true }).first()).toBeVisible();
  expect(paid.orderId).toBeTruthy();
  expect(paid.captureId).toBeTruthy();
  await expect(page.locator('.receipt')).toContainText(paid.orderId!);
  await expect(page.locator('.receipt')).toContainText(paid.captureId!);
  await noHorizontalScroll(page);
  await page.goto(`${base}/campaign`);
  const current = await campaign(page);
  expect(current.venues.find((v) => v.id === 'mill')?.paidUnits).toBe(1);
  await expect(page.getByRole('region', { name: 'Your preorders' })).toContainText('Paid');

  const wharf = await placePreorder(page, 'wharf');
  await waitPayment(page, wharf.id, ['captured']);
  await closeWith(page, 'mill');
  const refunded = await waitPayment(page, wharf.id, ['refunded', 'refund_pending']);
  expect(refunded.refundId).toBeTruthy();
  await page.reload();
  await expect(page.getByText(new RegExp(refunded.refundId!)).first()).toBeVisible();
  const closed = await campaign(page);
  expect(closed.chosen).toBe('mill');
  expect(closed.liabilityCents).toBe(refunded.state === 'refunded' ? 0 : refunded.amountCents);
  if (refunded.state === 'refunded')
    await expect(page.getByText('$0.00 outstanding liability')).toBeVisible();
  await noHorizontalScroll(page);
  await page.goto(`${base}/scorecard`);
  await expect(
    page.getByRole('heading', { name: `Campaign ${shortCampaignId(closed.id)}`, exact: true }),
  ).toBeVisible();
  await noHorizontalScroll(page);
  expect(errors).toEqual([]);
});
