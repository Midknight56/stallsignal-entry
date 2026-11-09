import { test, expect, type Locator, type Page } from '@playwright/test';
import { base } from './helpers';

const mock = process.env.SS_LAYOUT_MOCK === '1' ? '&mock=1' : '';

async function inView(page: Page, locator: Locator, name: string) {
  await expect(locator, name).toBeVisible();
  const box = await locator.boundingBox();
  const size = page.viewportSize()!;
  expect(box, name).not.toBeNull();
  expect(box!.y, `${name} top`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${name} bottom`).toBeLessThanOrEqual(size.height);
  expect(box!.x, `${name} left`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name} right`).toBeLessThanOrEqual(size.width);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`${viewport.width} decision within reach`, () => {
    test.use({ viewport });
    test('the decision, the selected venue and the next action show with no scroll', async ({ page }, info) => {
      await page.goto(`${base}/?nosweep=1${mock}`);
      const block = page.locator('.decision-block');
      await expect(block).toBeVisible();
      const scrolled = await page.evaluate(() => ({
        page: window.scrollY,
        panel: document.querySelector('.panel-scroll')?.scrollTop ?? 0,
      }));
      expect(scrolled).toEqual({ page: 0, panel: 0 });
      await inView(page, block.locator('.selected-venue'), 'selected venue');
      await inView(page, block.locator('.decision'), 'recommendation');
      await inView(page, block.getByRole('button', { name: 'Preorder at this venue', exact: true }), 'next action');
      await page.screenshot({ path: info.outputPath(`reach-${viewport.width}.png`) });
      const cards = page.locator('.venue-card');
      await expect(cards).toHaveCount(3);
      for (let i = 0; i < 3; i += 1) {
        await expect(cards.nth(i).getByText('Recorded units', { exact: true })).toBeVisible();
        await expect(cards.nth(i).getByText('Your campaign units', { exact: true })).toBeVisible();
        await expect(cards.nth(i).getByText('Blended units', { exact: true })).toBeHidden();
      }
    });
  });
}
