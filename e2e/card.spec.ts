import { test, expect, type Page } from '@playwright/test';
import type { Preorder } from '../src/shared/types';
import { base, campaign, closeWith, fault, noHorizontalScroll, openMap } from './helpers';

// Real sandbox only. No buyer credentials or buyer login helper are used.
async function payByCard(page: Page, decline = false) {
  await openMap(page);
  await page.getByRole('button', { name: 'Preorder at this venue', exact: true }).click();
  await page.getByLabel('Venue', { exact: true }).selectOption('wharf');
  await expect(page.getByText('No login needed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay with PayPal', exact: true })).toBeVisible();
  await noHorizontalScroll(page);
  if (decline) await fault(page, 'decline_next_card');
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/preorders' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Pay by card', exact: true }).click();
  const created = await response;
  expect(created.ok()).toBe(true);
  expect(created.request().postDataJSON()).toEqual({
    venue: 'wharf',
    product: 'tin',
    qty: 1,
    method: 'card',
  });
  await expect(page).toHaveURL(/\/return\?p=/);
  const id = new URL(page.url()).searchParams.get('p');
  const preorder = (await campaign(page)).preorders.find((row) => row.id === id);
  expect(preorder).toBeDefined();
  expect(preorder!.method).toBe('card');
  await expect(page.locator('.receipt')).toContainText('Card');
  return preorder!;
}

test('test card pays at Shed 9 without login and is refunded when Millrace Hall wins', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).origin);
  });
  const p = await payByCard(page);
  expect(p.state).toBe('captured');
  expect(p.orderId).toBeTruthy();
  expect(p.captureId).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Paid', exact: true }).first()).toBeVisible();
  await expect(page.locator('.receipt')).toContainText(p.orderId!);
  await expect(page.locator('.receipt')).toContainText(p.captureId!);
  await closeWith(page, 'mill');
  const refunded = (await campaign(page)).preorders.find((row) => row.id === p.id)!;
  expect(['refunded', 'refund_pending']).toContain(refunded.state);
  expect(refunded.refundId).toBeTruthy();
  await expect(page.locator(`[data-preorder="${p.id}"]`)).toContainText(refunded.refundId!);
  await expect(page.locator(`[data-preorder="${p.id}"]`)).toContainText(/Refunded|Refund pending/);
  expect(navigations.every((origin) => origin === new URL(base).origin)).toBe(true);
  await noHorizontalScroll(page);
});

test('real sandbox card refusal shows Declined and counts no paid demand', async ({ page }) => {
  const p = await payByCard(page, true);
  expect(p.state).toBe('declined');
  await expect(page.getByRole('heading', { name: 'Declined', exact: true }).first()).toBeVisible();
  expect((await campaign(page)).venues.every((v) => v.paidUnits === 0)).toBe(true);
  await noHorizontalScroll(page);
});
