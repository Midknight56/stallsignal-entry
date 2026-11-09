import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { base, noHorizontalScroll } from './helpers';
import { freshCampaign, world } from '../web/src/mock/fixtures';
import { decide, evidenceCounts } from '../src/domain/blend';

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`forecast cost and real campaign first at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url());
    });
    await page.goto(`${base}/?mock=1&nosweep=1`);
    const cost = page.locator('.decision-cost');
    await expect(cost).toContainText(
      "Booking Shed 9 on the forecast gives an estimated margin about $807 lower on today's evidence. This is an estimate, not money saved.",
    );
    await expect(cost).toContainText('Millrace Hall stays the pick until Shed 9 gets 8 more paid units.');
    const slider = page.getByRole('slider', { name: 'Forecast and preorders comparison' });
    for (const key of ['Home', 'End']) {
      await slider.focus();
      await page.keyboard.press(key);
      await expect(cost).toContainText('8 more paid units');
    }
    await mkdir('docs/verification/j30', { recursive: true });
    await page.screenshot({ path: `docs/verification/j30/map-${viewport.width}.png` });
    await noHorizontalScroll(page);
    await page.goto(`${base}/scorecard?mock=1`);
    await expect(
      page.getByRole('heading', { name: 'Synthetic history', exact: true }),
    ).toBeVisible();
    const sections = page.locator('main > section');
    await expect(sections.first()).toContainText('Recorded sandbox run');
    await expect(sections.first()).toContainText('6 Nov 2026');
    await expect(sections.first()).toContainText('9 preorders. 3 refunds.');
    await expect(sections.first()).toContainText('Paid demand changed the pick.');
    await expect(page.locator('.decision-cost')).toContainText('8 more paid units');
    await noHorizontalScroll(page);
    await page.screenshot({ path: `docs/verification/j30/scorecard-${viewport.width}.png`, fullPage: true });
    expect(apiCalls).toEqual([]);
  });
}

test('panel hides both cost sentences when picks agree', async ({ page }) => {
  const preorders = Array.from({ length: 8 }, (_, i) => ({
    ...world.recorded!.preorders[0],
    id: `extra-${i}`,
    venue: 'wharf' as const,
    source: 'live' as const,
    qty: 1,
    state: 'captured' as const,
  }));
  const campaign = {
    ...freshCampaign(),
    ...decide(preorders, 90000, world.recorded!.preorders),
    ...evidenceCounts(preorders, world.recorded!.preorders),
    preorders,
  };
  await page.addInitScript(
    (campaign) => sessionStorage.setItem('ss-mock-v2', JSON.stringify(campaign)),
    campaign,
  );
  await page.goto(`${base}/?mock=1&nosweep=1`);
  await expect(page.locator('.decision')).toBeVisible();
  await expect(page.locator('.decision-cost')).toHaveCount(0);
});
