import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const portland = JSON.parse(readFileSync('src/data/portland.json', 'utf8')) as {
  heat: { x: number; y: number; jobs: number }[];
  roads: unknown[];
  labels: { text: string; kind: 'water' | 'street' }[];
};

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  for (const route of ['/', '/studio']) {
    test(`Portland map and worker tooltips on ${route} at ${viewport.width}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${route}?mock=1&nosweep=1`);
      const map = page.getByRole(route === '/' ? 'img' : 'group', { name: 'Portland, Maine', exact: true });
      await expect(map).toBeVisible();
      await expect(map.locator('.venue-pin')).toHaveCount(3);
      await expect(map.locator('[data-layer="heat"] polygon')).toHaveCount(portland.heat.length);
      await expect(map.locator('[data-layer="roads"] polyline')).toHaveCount(portland.roads.length);
      const streetLabels = portland.labels.filter((label) => label.kind === 'street');
      for (const label of portland.labels) {
        const locator = map.locator('.map-label').filter({ hasText: label.text });
        if (viewport.width < 760 && label.kind === 'street' && streetLabels.indexOf(label) >= 4)
          await expect(locator).toBeHidden();
        else await expect(locator).toBeVisible();
      }
      if (viewport.width < 760) {
        await expect(map.locator('.water-label:visible')).toHaveCount(3);
        expect(await map.locator('.street-label:visible').count()).toBeLessThanOrEqual(4);
        await expect
          .poll(() =>
            map.locator('.map-label:visible').evaluateAll((labels) =>
              labels.every((el) => {
                const matrix = (el as SVGTextElement).getScreenCTM()!;
                return parseFloat(getComputedStyle(el).fontSize) * Math.hypot(matrix.a, matrix.b) >= 9.99;
              }),
            ),
          )
          .toBe(true);
      }
      const index = portland.heat.findIndex(
        (cell) => cell.x > 300 && cell.x < 500 && cell.y > 350 && cell.y < 450,
      );
      const cell = map.locator('[data-layer="heat"] polygon').nth(index);
      await cell.focus();
      const text = `About ${portland.heat[index].jobs.toLocaleString('en-US')} daytime workers here`;
      await expect(map.getByRole('tooltip')).toHaveText(text);
      await page.keyboard.press('Escape');
      await expect(map.getByRole('tooltip')).toHaveCount(0);
      await cell.hover();
      await expect(map.getByRole('tooltip')).toHaveText(text);
      await page.mouse.move(0, 0);
      await cell.blur();
      const mill = map.getByRole('button', {
        name: route === '/' ? 'Select Millrace Hall' : 'Select Millrace Hall on map',
        exact: true,
      });
      await mill.focus();
      await page.keyboard.press('Enter');
      await expect(mill).toHaveAttribute('aria-pressed', 'true');
      if (route === '/') {
        const slider = page.getByRole('slider', { name: 'Forecast and preorders comparison' });
        await slider.focus();
        await page.keyboard.press('Home');
        await expect(slider).toHaveAttribute('aria-valuenow', '5');
        await page.keyboard.press('End');
        await expect(slider).toHaveAttribute('aria-valuenow', '95');
        // Leave half the map showing worker heat in the review image.
        for (let i = 0; i < 23; i++) await page.keyboard.press('ArrowLeft');
      }
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.screenshot({
        path: `docs/j32-realmap/${route === '/' ? 'map' : 'studio'}-${viewport.width}.png`,
      });
      await page.screenshot({ path: info.outputPath('review.png') });
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
