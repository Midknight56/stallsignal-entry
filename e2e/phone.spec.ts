import { test, expect } from '@playwright/test';
import { base, phoneLayout } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });
for (const route of ['/', '/campaign', '/scorecard', '/receipts', '/proof', '/studio', '/about']) {
  test(`phone button spacing and overflow on ${route}`, async ({ page }, info) => {
    await page.goto(`${base}${route}${process.env.SS_LAYOUT_MOCK === '1' ? '?mock=1' : ''}`);
    await expect(page.locator('main')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`phone-${route === '/' ? 'map' : route.slice(1)}.png`) });
    if (route === '/studio') {
      await expect(page.getByRole('heading', { name: /studio/i })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Select Millrace Hall on map', exact: true }),
      ).toBeVisible();
    } else if (route === '/') {
      await expect(page.getByRole('button', { name: 'Preorder at this venue', exact: true })).toBeVisible();
    } else await expect(page.locator('h1')).toBeVisible();
    const failures = new Set<string>();
    // Walk the full document and each independently scrolling panel/grid, including off-screen buttons.
    const heights = await page.evaluate(() => ({
      page: document.documentElement.scrollHeight,
      panels: Array.from(document.querySelectorAll<HTMLElement>('.panel-scroll, .ag-body-viewport')).map(
        (el) => el.scrollHeight,
      ),
    }));
    for (let y = 0; y < heights.page; y += 500) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      for (const failure of await phoneLayout(page)) failures.add(failure);
    }
    const panels = page.locator('.panel-scroll, .ag-body-viewport');
    for (let i = 0; i < heights.panels.length; i++) {
      for (let y = 0; y < heights.panels[i]; y += 400) {
        await panels.nth(i).evaluate((el, y) => {
          el.scrollTop = y;
        }, y);
        for (const failure of await phoneLayout(page)) failures.add(failure);
      }
    }
    expect([...failures], `Phone layout on ${route}`).toEqual([]);
  });
}
