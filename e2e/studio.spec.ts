import { test, expect, type Page } from '@playwright/test';
import { browserErrors, noHorizontalScroll } from './helpers';

const studioBase = process.env.SS_BASE || 'http://127.0.0.1:5186';

async function expectEvidenceRowsFit(page: Page) {
  const rows = page.locator('.studio-evidence-grid .ag-row');
  await expect(rows.first()).toBeVisible();
  const failures = await rows.evaluateAll((rows) => {
    const failures: string[] = [];
    const ordered = [...rows].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    ordered.forEach((row, i) => {
      const box = row.getBoundingClientRect();
      if (i && box.top < ordered[i - 1].getBoundingClientRect().bottom - 0.5) failures.push('Rows overlap');
      for (const cell of row.querySelectorAll('.ag-cell')) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const text = range.getBoundingClientRect();
        if (text.top < box.top || text.bottom > box.bottom)
          failures.push(`Text outside row: ${cell.textContent}`);
      }
    });
    return failures;
  });
  expect(failures).toEqual([]);
}

test.describe('AG Studio custom widgets', () => {
  test('adds chart widget, preserves on clear filters, removes on remove added (desktop)', async ({
    page,
  }, info) => {
    const errors = browserErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${studioBase}/studio?mock=1`);

    await expect(page.getByRole('heading', { name: 'Evidence Studio' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Venue map', exact: true })).toBeVisible();

    await expectEvidenceRowsFit(page);

    // Select Millrace Hall first so a filter is active and Clear filters is enabled
    await page.getByRole('button', { name: 'Select Millrace Hall on map' }).click();
    await expect(page.locator('.studio-selection')).toContainText('Selected: Millrace Hall');

    const chartPrompt = page.getByRole('button', { name: 'Chart refunds by venue', exact: true });
    await expect(chartPrompt).toBeVisible();
    await chartPrompt.click();

    await expect(page.locator('.studio-answer')).toContainText('Added a chart of refunds by venue.');
    await expect(page.locator('.studio-answer')).toContainText('Matched without AI');

    const widgetTitle = page.locator('.ag-studio-layout-widget-title', { hasText: 'Refunds by venue' });
    await expect(widgetTitle).toBeVisible();
    await page.screenshot({ path: info.outputPath('studio-added-desktop.png') });

    // Clear filters preserves added widgets
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.locator('.studio-selection')).toContainText('All venues');
    await expect(widgetTitle).toBeVisible();

    // Remove added clears the added widget
    await page.getByRole('button', { name: 'Remove added', exact: true }).click();
    await expect(widgetTitle).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('adds widget and renders full width without horizontal scroll (phone 390x844)', async ({
    page,
  }, info) => {
    const errors = browserErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${studioBase}/studio?mock=1`);

    await expect(page.getByRole('heading', { name: 'Evidence Studio' })).toBeVisible();

    await expectEvidenceRowsFit(page);
    const chartPrompt = page.getByRole('button', { name: 'Chart refunds by venue', exact: true });
    await expect(chartPrompt).toBeVisible();
    await chartPrompt.click();

    await expect(page.locator('.studio-answer')).toContainText('Added a chart of refunds by venue.');
    const widgetTitle = page.locator('.ag-studio-layout-widget-title', { hasText: 'Refunds by venue' });
    await expect(widgetTitle).toBeVisible();

    await noHorizontalScroll(page);
    await page.screenshot({ path: info.outputPath('studio-added-phone.png') });

    expect(errors).toEqual([]);
  });
});
