import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { approve } from '../tools/buyer.mjs';
import { api, base, launchOptions, root, waitCampaign } from '../tools/runtime.mjs';

// Real routes only. Requires the app, DEV_ROUTES=1, and the sandbox buyer credentials.
const browser = await chromium.launch(launchOptions);
const results = [];
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const out = path.join(root, 'shots', String(viewport.width));
    await mkdir(out, { recursive: true });
    async function shot(name) {
      if (new URL(page.url()).origin !== new URL(base).origin)
        throw new Error('Refusing to photograph an external page.');
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      results.push({ width: viewport.width, screen: name, status: 'saved' });
    }
    async function map() {
      await page.goto(base);
      await expect(page.locator('.venue-pin')).toHaveCount(3);
    }
    async function start(venue) {
      await map();
      await page.getByRole('button', { name: 'Preorder at this venue', exact: true }).click();
      await page.getByLabel('Venue', { exact: true }).selectOption(venue);
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/preorders' && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Pay with PayPal sandbox', exact: true }).click();
      const res = await response;
      if (!res.ok()) throw new Error(`Preorder failed: HTTP ${res.status()}`);
      await page.waitForURL(
        (url) =>
          url.protocol === 'https:' &&
          (url.hostname === 'sandbox.paypal.com' || url.hostname.endsWith('.sandbox.paypal.com')),
        { waitUntil: 'domcontentloaded', timeout: 45_000 },
      );
      const campaign = await api(context.request, '/api/campaign');
      const preorder = campaign.preorders.filter((p) => p.venue === venue).at(-1);
      if (!preorder) throw new Error(`No new preorder found for venue ${venue}.`);
      return { preorder, approveUrl: page.url() };
    }
    async function payment(venue, kind) {
      const created = await start(venue);
      if (kind) await api(context.request, '/api/dev/fault', { kind });
      await approve(page, created.approveUrl);
      return created.preorder;
    }
    try {
      await api(context.request, '/health');
      await map();
      await shot('01-map');
      await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
      await expect(page.locator('.agent-panel .source')).toBeVisible();
      await page.locator('.agent-panel .source').scrollIntoViewIfNeeded();
      await shot('02-agent');
      await page.getByRole('button', { name: 'Preorder at this venue', exact: true }).click();
      await page.getByLabel('Venue', { exact: true }).selectOption('mill');
      await page.locator('.preorder-sheet').scrollIntoViewIfNeeded();
      await shot('03-preorder');
      await page.getByRole('button', { name: 'Close preorder sheet', exact: true }).click();

      // Hold the real return request briefly to photograph the actual capturing screen.
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let finishHandler;
      const handlerFinished = new Promise((resolve) => {
        finishHandler = resolve;
      });
      await page.route('**/api/preorders/*/return', async (route) => {
        try {
          await gate;
          await route.continue().catch(() => {});
        } finally {
          finishHandler();
        }
      });
      let paid;
      try {
        paid = await payment('mill');
        await expect(page.getByRole('heading', { name: 'Capturing', exact: true })).toBeVisible();
        await shot('04-capturing');
      } finally {
        release();
        await handlerFinished;
        await page.unroute('**/api/preorders/*/return');
      }
      await waitCampaign(
        context.request,
        (c) => c.preorders.find((p) => p.id === paid.id)?.state === 'captured',
      );
      await expect(page.locator('.receipt')).toContainText('Paid');
      await shot('05-paid-receipt');

      const lost = await payment('wharf', 'lose_next_response');
      await expect(
        page.getByRole('heading', { name: 'Checking payment', exact: true }).first(),
      ).toBeVisible();
      await shot('06-checking-payment');
      await page.getByRole('button', { name: 'Reconcile', exact: true }).click();
      await waitCampaign(
        context.request,
        (c) => c.preorders.find((p) => p.id === lost.id)?.state === 'captured',
      );

      await payment('mill', 'decline_next_capture');
      await expect(page.getByRole('heading', { name: 'Declined', exact: true }).first()).toBeVisible();
      await shot('07-declined');

      const canceled = await start('linden');
      await page.goto(canceled.approveUrl, { waitUntil: 'domcontentloaded' });
      await page.goto(`${base}/return?p=${encodeURIComponent(canceled.preorder.id)}&cancel=1`);
      await expect(page.getByRole('heading', { name: 'Canceled', exact: true }).first()).toBeVisible();
      await shot('08-canceled');

      const pending = await payment('wharf', 'capture_pending');
      await expect(page.getByRole('heading', { name: 'Pending', exact: true }).first()).toBeVisible();
      await shot('09-pending');
      await page.getByRole('button', { name: 'Reconcile', exact: true }).click();
      await waitCampaign(
        context.request,
        (c) => c.preorders.find((p) => p.id === pending.id)?.state === 'captured',
      );
      await page.goto(`${base}/campaign`);
      await page.getByLabel('Chosen venue').selectOption('mill');
      await page.getByRole('button', { name: 'Close campaign', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm close', exact: true }).click();
      await waitCampaign(
        context.request,
        (c) =>
          c.state === 'closed' &&
          c.preorders
            .filter((p) => p.venue !== 'mill' && p.captureId)
            .every((p) => ['refunded', 'refund_pending'].includes(p.state) && p.refundId),
      );
      await page.reload();
      await expect(page.locator(`.refund-row[data-preorder="${lost.id}"]`)).toBeVisible();
      await page.locator(`.refund-row[data-preorder="${lost.id}"]`).scrollIntoViewIfNeeded();
      await shot('10-campaign-refunds');
      for (const [route, name] of [
        ['/scorecard', '11-scorecard'],
        ['/receipts', '12-receipts'],
        ['/about', '14-about'],
        ['/proof', '15-proof'],
      ]) {
        await page.goto(`${base}${route}`);
        await expect(page.locator('h1')).toBeVisible();
        if (route === '/scorecard')
          await expect(page.getByRole('heading', { name: 'Closed campaigns', exact: true })).toBeVisible();
        await shot(name);
      }
      await page.goto(`${base}/studio`);
      try {
        await expect(page.getByRole('heading', { name: /studio/i })).toBeVisible();
        const millPin = page
          .getByRole('region', { name: 'Venue map', exact: true })
          .getByRole('button', { name: 'Select Millrace Hall on map', exact: true });
        await expect(millPin).toHaveCount(1);
        await millPin.click();
        await expect(millPin).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        await expect
          .poll(
            async () => {
              const rows = page.locator('.studio-evidence-grid .ag-row');
              return rows.evaluateAll((elements) => {
                const venues = elements.map(
                  (row) => row.querySelector('[col-id]')?.textContent?.trim() ?? '',
                );
                return venues.length > 0 &&
                  venues.filter(Boolean).every((venue) => venue === 'Millrace Hall');
              });
            },
            { timeout: 10_000 },
          )
          .toBe(true);
        await shot('13-studio-mill-selected');
      } catch {
        await shot('13-studio-unavailable');
        results.push({
          width: viewport.width,
          screen: 'studio',
          status: 'failed',
          reason: 'Studio dashboard or venue selection is missing.',
        });
      }
    } catch (error) {
      results.push({
        width: viewport.width,
        status: 'failed',
        reason: String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 300),
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await mkdir(path.join(root, 'shots'), { recursive: true });
  await writeFile(
    path.join(root, 'shots/run.json'),
    `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`,
  );
}
for (const row of results)
  console.log(`${row.width}: ${row.screen || 'flow'} ${row.status}${row.reason ? `: ${row.reason}` : ''}`);
if (results.some((row) => row.status === 'failed')) process.exitCode = 1;
