import { test, expect } from '@playwright/test';
import { base } from './helpers';

test.use({ viewport: { width: 1280, height: 800 } });

test('an agent answer for an older budget is dropped when the budget changes during the request', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let sentBudget = 0;
  await page.route('**/api/agent', async (route) => {
    sentBudget = (route.request().postDataJSON() as { budget: number }).budget;
    await held;
    await route.continue();
  });
  await page.goto(`${base}/?nosweep=1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Ask the agent' }).click();
  await expect.poll(() => sentBudget).toBe(90000);
  await page.locator('#budget').fill('45000');
  const answered = page.waitForResponse('**/api/agent');
  release();
  await answered;
  await expect(page.getByText('The budget or evidence changed while the agent was working. Ask again.')).toBeVisible();
  await expect(page.getByText('Within your $900.00 budget')).toHaveCount(0);
  await expect(page.locator('.agent-panel table')).toHaveCount(0);
});

test('this campaign only reaches the map, the agent request and the campaign page with no reload', async ({ page }) => {
  await page.goto(`${base}/?nosweep=1`, { waitUntil: 'networkidle' });
  await page.getByLabel('This campaign only', { exact: true }).check();
  await expect(page.getByText('Paid demand: this campaign only.')).toBeVisible();
  // The agent request carries the same choice. It is stopped here, so no model call is made.
  let body: Record<string, unknown> = {};
  await page.route('**/api/agent', async (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.abort();
  });
  await page.locator('#budget').fill('15000');
  await page.getByRole('button', { name: 'Ask the agent' }).click();
  await expect.poll(() => body.includeRecorded).toBe(false);
  expect(body.budget).toBe(15000);
  await page.getByRole('link', { name: 'Campaign', exact: true }).click();
  await expect(page.getByText('Worked out at $150, this campaign only', { exact: false })).toBeVisible();
  await expect(page.locator('.decision').first()).toHaveText('Forecast picks Linden Corner Shop. No paid preorders yet.');
});
