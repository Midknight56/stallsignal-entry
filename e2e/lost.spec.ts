import { test, expect } from './payment-test';
import { base, campaign, openMap, placePreorder, waitPayment } from './helpers';
test.use({ trace: 'off' }); // App-only traces are managed by payment-test.

test('lost capture blocks pay and close, then reconciles exactly one capture operation', async ({ page }) => {
  const p = await placePreorder(page, 'mill', { fault: 'lose_next_response' });
  await waitPayment(page, p.id, ['checking']);
  await expect(page.getByRole('heading', { name: 'Checking payment', exact: true }).first()).toBeVisible();
  const lost = (await campaign(page)).ops.filter(
    (o) => o.kind === 'capture' && o.requestId === `ss-capture-${p.id}`,
  );
  expect(lost).toHaveLength(1);
  expect(lost[0].status).toBe('lost');
  await openMap(page);
  await expect(page.getByRole('button', { name: 'Preorder at this venue', exact: true })).toBeDisabled();
  await page.goto(`${base}/campaign`);
  await expect(page.getByRole('button', { name: 'Close campaign', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Chosen venue')).toBeDisabled();
  await page.getByRole('button', { name: `Reconcile ${p.id}`, exact: true }).click();
  await waitPayment(page, p.id, ['captured']);
  await expect(page.getByRole('button', { name: 'Close campaign', exact: true })).toBeEnabled();
  const reconciled = await campaign(page);
  expect(reconciled.checking).toBe(false);
  expect(reconciled.venues.find((v) => v.id === 'mill')?.paidUnits).toBe(1);
  const ops = reconciled.ops.filter((o) => o.kind === 'capture');
  expect(ops).toHaveLength(1);
  expect(ops[0].requestId).toBe(lost[0].requestId);
  expect(ops[0].status).toBe('ok');
});
