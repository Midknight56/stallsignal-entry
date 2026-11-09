import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = 'docs/verification/j36';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 800 },
      reducedMotion: 'reduce',
    });
    const errors = [],
      apiCalls = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/api/')) apiCalls.push(req.url());
    });
    for (const route of ['/', '/campaign', '/scorecard', '/receipts', '/studio', '/about', '/proof']) {
      await page.goto(`http://127.0.0.1:5189${route}?mock=1&nosweep=1`);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('h1')).toBeVisible();
      if (route === '/studio') {
        await expect(page.locator('.studio-evidence-grid .ag-row').first()).toBeVisible();
        await page.waitForTimeout(500);
        const failures = await page.locator('.studio-evidence-grid .ag-row').evaluateAll((rows) => {
          const errors = [];
          const ordered = [...rows].sort(
            (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
          );
          for (let i = 0; i < ordered.length; i++) {
            const row = ordered[i],
              box = row.getBoundingClientRect();
            if (i && box.top < ordered[i - 1].getBoundingClientRect().bottom - 0.5)
              errors.push('Rows overlap');
            for (const cell of row.querySelectorAll('.ag-cell')) {
              const range = document.createRange();
              range.selectNodeContents(cell);
              const text = range.getBoundingClientRect();
              if (text.top < box.top || text.bottom > box.bottom)
                errors.push(`Text outside row: ${cell.textContent}`);
            }
          }
          return errors;
        });
        expect(failures).toEqual([]);
      }
      if (route === '/proof') await expect(page.locator('.proof-row .held')).toHaveCount(6);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.modes')).toHaveText('Sandbox: test money · Preview data');
      if (route === '/' || route === '/studio') {
        if (width === 390) {
          await expect
            .poll(async () =>
              page
                .locator('.map-label:visible')
                .evaluateAll((labels) =>
                  labels.every(
                    (el) =>
                      parseFloat(getComputedStyle(el).fontSize) *
                        Math.hypot(el.getScreenCTM().a, el.getScreenCTM().b) >=
                      9.99,
                  ),
                ),
            )
            .toBe(true);
          const labels = await page.locator('.map-label:visible').evaluateAll((labels) =>
            labels.map((el) => ({
              kind: el.classList.contains('water-label') ? 'water' : 'street',
              size:
                parseFloat(getComputedStyle(el).fontSize) *
                Math.hypot(el.getScreenCTM().a, el.getScreenCTM().b),
            })),
          );
          expect(labels.filter((l) => l.kind === 'water')).toHaveLength(3);
          expect(labels.filter((l) => l.kind === 'street').length).toBeLessThanOrEqual(4);
          expect(labels.every((l) => l.size >= 9.99)).toBe(true);
        }
      }
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `${out}/${route === '/' ? 'map' : route.slice(1)}-${width}.png`,
        fullPage: route !== '/',
      });
      if (route === '/') {
        const cards = page.locator('.venue-card');
        await expect(cards.locator('dt', { hasText: /^Paid units$/ })).toHaveCount(3);
        await expect(cards.locator('dt', { hasText: /^Pending units$/ })).toHaveCount(0);
        await expect(cards.nth(0).locator('dd[title]')).toHaveAttribute(
          'title',
          '2 from our recorded run, 0 from you',
        );
        await expect(cards.nth(0).locator('dd[title]')).toHaveAccessibleDescription(
          '2 from our recorded run, 0 from you',
        );
        await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Steps it took' })).toBeVisible();
        await expect(page.locator('.agent-steps li')).toHaveCount(3);
        await page.locator('.agent-steps').screenshot({ path: `${out}/agent-steps-${width}.png` });
      }
      results.push(`${width} ${route}: no horizontal overflow; screenshot captured`);
    }
    expect(errors).toEqual([]);
    expect(apiCalls).toEqual([]);
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(`${out}/browser-results.json`, JSON.stringify(results, null, 2));
console.log(results.join('\n'));
