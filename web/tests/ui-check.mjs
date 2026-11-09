import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { world, freshCampaign } from '../src/mock/fixtures.ts';

const base = 'http://127.0.0.1:5182';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const apiCalls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url());
  });
  await page.goto(`${base}/?mock=1&nosweep=1`);
  await expect(page.getByRole('heading', { name: 'Where should we set up?' })).toBeVisible();
  const split = page.getByRole('slider', { name: 'Forecast and preorders comparison' });
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await split.focus();
  await page.keyboard.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', '52');
  const handle = await split.boundingBox();
  await page.mouse.move(handle.x + 23, handle.y + 23);
  await page.mouse.down();
  await page.mouse.move(300, handle.y + 23);
  await page.mouse.up();
  expect(Number(await split.getAttribute('aria-valuenow'))).toBeLessThan(50);
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  await expect(page.getByText('Stock allocation', { exact: true })).toBeVisible();
  await mkdir('web/docs/verification', { recursive: true });
  await page.screenshot({ path: 'web/docs/verification/desktop-map.png' });
  results.push('Desktop map, keyboard and pointer comparison, agent allocation');
  await page.getByRole('button', { name: 'Preorder at this venue' }).click();
  await page.getByLabel('Venue', { exact: true }).selectOption('mill');
  await page.getByRole('button', { name: 'Pay with PayPal' }).click();
  await expect(page.getByRole('heading', { name: 'Paid', exact: true }).first()).toBeVisible();
  await expect(page.getByText(/MOCK-CAPTURE/)).toBeVisible();
  await page.getByRole('link', { name: 'View campaign' }).click();
  await page.getByLabel('Chosen venue').selectOption('wharf');
  await page.getByRole('button', { name: 'Close campaign', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm close', exact: true }).click();
  await expect(page.getByText('$0.00 outstanding liability')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Each payment’s refund' })).toBeVisible();
  await expect(page.getByText(/MOCK-REFUND/).first()).toBeVisible();
  results.push('Mock preorder, return capture, campaign confirmation, per payment refund and zero liability');
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ['/', '/campaign', '/scorecard', '/receipts', '/about']) {
      await page.goto(`${base}${path}?mock=1`);
      await expect(page.locator('h1')).toBeVisible();
      if (path === '/scorecard')
        await expect(
          page.getByRole('region', { name: 'Synthetic history, forecast and actual table' }),
        ).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow, `${path} overflow at ${viewport.width}`).toBe(false);
      await page.screenshot({
        path: `web/docs/verification/${viewport.width}-${path === '/' ? 'map' : path.slice(1)}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/?mock=1`);
  const sheet = page.getByRole('button', { name: /Panel height/ });
  await sheet.click();
  await expect(sheet).toHaveAccessibleName(/high/);
  await sheet.focus();
  await page.keyboard.press('ArrowDown');
  await expect(sheet).toHaveAccessibleName(/middle/);
  await page.keyboard.press('ArrowDown');
  await expect(sheet).toHaveAccessibleName(/low/);
  await page.keyboard.press('ArrowUp');
  await expect(sheet).toHaveAccessibleName(/middle/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'web/docs/verification/phone-dark.png' });
  results.push(
    'All five screens at 390 × 844 and 1280 × 800, no horizontal page overflow; three sheet heights and dark mode',
  );
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
  results.push('No /api network requests in mock mode; no browser exceptions');
  await context.close();
  // Contract fixtures exercise server responses without reaching the Worker or PayPal.
  const statusContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const statusPage = await statusContext.newPage();
  let state = 'checking',
    returns = 0,
    lostCreate = false,
    recordedWorld = false;
  const payment = () => ({
    id: 'status-test',
    venue: 'mill',
    product: 'tin',
    qty: 1,
    amountCents: 1400,
    state,
    orderId: 'TEST-ORDER',
    captureId: state === 'captured' ? 'TEST-CAPTURE' : null,
    refundId: null,
    debugId: null,
    source: 'live',
    updatedAt: '2026-11-06T12:00:00Z',
  });
  const campaign = () => ({
    ...freshCampaign(),
    checking: state === 'checking',
    preorders: [payment()],
    liabilityCents: state === 'refund_failed' ? 1400 : 0,
  });
  await statusContext.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/preorders' && lostCreate) {
      state = 'checking';
      await route.fulfill({ status: 503, json: { error: 'CHECKING_PAYMENT' } });
      return;
    }
    let data =
      path === '/api/world'
        ? recordedWorld
          ? {
              ...world,
              recordedAt: '2026-11-06T12:00:00Z',
              recorded: {
                id: 'recorded-test',
                label: 'Recorded run',
                preorders: [
                  {
                    ...payment(),
                    source: 'recorded',
                    state: 'refunded',
                    orderId: 'TEST-ORDER',
                    captureId: 'TEST-CAPTURE',
                    refundId: 'TEST-REFUND',
                  },
                ],
                ops: [
                  {
                    kind: 'refund',
                    requestId: 'TEST-REQUEST',
                    status: 'ok',
                    http: 201,
                    paypalId: 'TEST-REFUND',
                    at: '2026-11-06T12:00:00Z',
                  },
                ],
              },
            }
          : world
        : path === '/api/campaign'
          ? campaign()
          : { preorder: payment() };
    if (path.endsWith('/return')) returns++;
    if (path.endsWith('/retry')) {
      state = 'refunded';
      data = campaign();
    }
    await route.fulfill({ json: data });
  });
  for (const [value, title, button] of [
    ['captured', 'Paid', null],
    ['checking', 'Checking payment', 'Reconcile'],
    ['declined', 'Declined', 'Try again'],
    ['pending', 'Pending', 'Reconcile'],
    ['canceled', 'Canceled', 'Choose a venue'],
  ]) {
    state = value;
    returns = 0;
    await statusPage.goto(`${base}/return?p=status-test${value === 'canceled' ? '&cancel=1' : ''}`);
    await expect(statusPage.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    if (button)
      await expect(
        statusPage.getByRole(value === 'declined' || value === 'canceled' ? 'link' : 'button', {
          name: button,
          exact: true,
        }),
      ).toBeVisible();
    expect(returns, `${value} return call count in StrictMode`).toBe(1);
  }
  state = 'checking';
  await statusPage.goto(`${base}/campaign`);
  await expect(statusPage.getByRole('button', { name: 'Close campaign', exact: true })).toBeDisabled();
  await statusPage.goto(base);
  await statusPage.getByRole('button', { name: /Panel height/ }).click();
  await expect(statusPage.getByRole('button', { name: 'Preorder at this venue' })).toBeDisabled();
  state = 'refund_failed';
  await statusPage.goto(`${base}/campaign`);
  await expect(statusPage.getByText('$14.00 outstanding liability')).toBeVisible();
  await statusPage.getByRole('button', { name: 'Retry refund', exact: true }).click();
  await expect(statusPage.getByText('$0.00 outstanding liability')).toBeVisible();
  results.push(
    'StrictMode returns once for paid, checking, declined, pending and canceled; correct next actions; checking blocks pay and close; failed refund retry clears liability',
  );
  await statusPage.goto(`${base}/?mock=1`);
  const touch = await statusContext.newCDPSession(statusPage);
  const touchSplit = statusPage.getByRole('slider', { name: 'Forecast and preorders comparison' });
  const b = await touchSplit.boundingBox();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: b.x + 23, y: b.y + 23 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: b.x + 80, y: b.y + 23 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(Number(await touchSplit.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
  const touchSheet = statusPage.getByRole('button', { name: /Panel height/ });
  const sb = await touchSheet.boundingBox();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 195, y: sb.y + 22 }],
  });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 195, y: sb.y - 65 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(touchSheet).toHaveAccessibleName(/high/);
  await touch.detach();
  results.push('Real touch input moves the comparison and drags the phone sheet to its high position');
  lostCreate = true;
  state = 'created';
  await statusPage.goto(base);
  await statusPage.getByRole('button', { name: /Panel height/ }).click();
  await statusPage.getByRole('button', { name: 'Preorder at this venue' }).click();
  await statusPage.getByRole('button', { name: 'Pay with PayPal' }).click();
  await expect(statusPage.getByRole('button', { name: 'Pay with PayPal' })).toBeDisabled();
  await expect(statusPage.getByText('Checking payment', { exact: true }).first()).toBeVisible();
  recordedWorld = true;
  await statusPage.goto(`${base}/receipts`);
  await expect(statusPage.getByText('TEST-CAPTURE', { exact: true })).toBeVisible();
  await expect(statusPage.getByRole('heading', { name: 'Recorded payment operations' })).toBeVisible();
  expect(await statusPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  results.push(
    'A lost create response refreshes campaign state and disables pay; dated recorded receipts show capture, refund and operation evidence',
  );
  await statusContext.close();
  await writeFile(
    'web/docs/verification/ui-results.json',
    JSON.stringify({ at: new Date().toISOString(), results, errors, apiCalls }, null, 2),
  );
  console.log(results.join('\n'));
} finally {
  await browser.close();
}
