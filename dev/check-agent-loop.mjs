import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Local fixtures only. Run Vite on this port before starting this check.
const base = 'http://127.0.0.1:5194';
const output = 'docs/j34';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
try {
  await mkdir(output, { recursive: true });
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    try {
      const page = await context.newPage();
      const errors = [];
      const calls = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/api/**', async (route) => {
        calls.push(route.request().url());
        await route.abort();
      });
      await page.goto(`${base}/?mock=1&nosweep=1`);
      await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
      const steps = page.getByRole('list', { name: 'Agent steps' });
      await expect(steps.locator('li')).toHaveText([
        'Read Millrace Hall evidence',
        'Compared the three venues',
        'Allocated $900 at Millrace Hall',
      ]);
      await steps.scrollIntoViewIfNeeded();
      await expect(steps).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${output}/agent-live-${viewport.width}.png` });
      expect(calls).toEqual([]);

      // The same panel with a recorded answer carrying stale steps must hide them.
      const fixtures = await page.evaluate(async () => {
        const { world, freshCampaign, mockAgent } = await import('/src/mock/fixtures.ts');
        const campaign = freshCampaign();
        return { world, campaign, answer: { ...mockAgent(90000, campaign), source: 'recorded' } };
      });
      await page.unroute('**/api/**');
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const body =
          path === '/api/world'
            ? fixtures.world
            : path === '/api/campaign'
              ? fixtures.campaign
              : path === '/api/agent'
                ? fixtures.answer
                : null;
        if (!body) throw new Error(`Unexpected local request: ${path}`);
        await route.fulfill({ json: body });
      });
      await page.goto(`${base}/?nosweep=1`);
      await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
      await expect(page.locator('.agent-panel .source')).toContainText('Recorded run');
      await expect(page.getByRole('list', { name: 'Agent steps' })).toHaveCount(0);
      await page.locator('.agent-panel .source').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/agent-recorded-${viewport.width}.png` });
      expect(errors).toEqual([]);
      results.push({
        ...viewport,
        mockSteps: 3,
        recordedSteps: 0,
        mockApiRequests: calls.length,
        pageErrors: errors,
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(`${output}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
