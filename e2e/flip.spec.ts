import { test, expect } from '@playwright/test';
import { freshCampaign, mockAgent, world } from '../web/src/mock/fixtures';

const sliderName = 'Forecast and preorders comparison';
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width} comparison`, () => {
    test.use({ viewport });
    test('keyboard and pointer switch the decision and badge', async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/?mock=1&nosweep=1');
      const slider = page.getByRole('slider', { name: sliderName });
      await slider.focus();
      await slider.press('Home');
      await expect(slider).toHaveAttribute('aria-valuenow', '5');
      await expect(page.locator('.home-panel .decision')).toContainText('Forecast picks Shed 9:');
      await expect(page.locator('.venue-card').filter({ hasText: 'Current pick' })).toContainText('Shed 9');
      await page.screenshot({ path: testInfo.outputPath('forecast.png') });
      await slider.press('End');
      await expect(slider).toHaveAttribute('aria-valuenow', '95');
      await expect(page.locator('.home-panel .decision')).toContainText('Preorders pick Millrace Hall:');
      await expect(page.locator('.venue-card').filter({ hasText: 'Current pick' })).toContainText(
        'Millrace Hall',
      );
      await page.screenshot({ path: testInfo.outputPath('paid.png') });
      // The line may be below the phone sheet at 95. Keyboard scrolling brings it into view.
      await slider.press('Home');
      const handle = await slider.boundingBox();
      const map = await page.locator('.city-map').boundingBox();
      if (!handle || !map) throw new Error('Missing comparison geometry');
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(map.x + map.width * 0.7, handle.y + handle.height / 2);
      await page.mouse.up();
      expect(Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
    test('sweeps to paid within four seconds and only once per session', async ({ page }) => {
      await page.goto('/?mock=1');
      const slider = page.getByRole('slider', { name: sliderName });
      await expect
        .poll(async () => Number(await slider.getAttribute('aria-valuenow')), { timeout: 4000 })
        .toBeGreaterThanOrEqual(95);
      await page.reload();
      await expect(slider).toHaveAttribute('aria-valuenow', '50');
      await page.waitForTimeout(2200);
      await expect(slider).toHaveAttribute('aria-valuenow', '50');
    });
  });
}
test('reduced motion skips the sweep', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?mock=1');
  const slider = page.getByRole('slider', { name: sliderName });
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  await page.waitForTimeout(2200);
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
});
test('touching the slider stops the sweep', async ({ page }) => {
  await page.goto('/?mock=1');
  const slider = page.getByRole('slider', { name: sliderName });
  await slider.press('Home');
  await page.waitForTimeout(2200);
  await expect(slider).toHaveAttribute('aria-valuenow', '5');
});
test('answer source is beside the answer and the header shows no mode badge', async ({ page }) => {
  let source: 'ai' | 'cache' | 'recorded' | 'code' = 'ai';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === '/api/world'
        ? { ...world, agent: { available: true } }
        : path === '/api/campaign'
          ? freshCampaign()
          : { ...mockAgent(90000, freshCampaign()), source };
    await route.fulfill({ json: body });
  });
  await page.goto('/?nosweep=1');
  await expect(page.locator('.modes')).toHaveCount(0);
  for (const [answerSource, label] of [
    ['ai', 'Live AI'],
    ['cache', 'Saved from a live answer'],
    ['recorded', 'Recorded run'],
    ['code', 'Code pick (model answer failed a check)'],
  ] as const) {
    source = answerSource;
    await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
    await expect(page.locator('.agent-panel .source')).toContainText(label);
    await expect(page.locator('.modes')).toHaveCount(0);
  }
  await page.getByRole('link', { name: 'Campaign', exact: true }).click();
  await expect(page.locator('.modes')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.modes')).toHaveCount(0);
});
