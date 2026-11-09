import { describe, expect, it } from 'vitest';
import type { AgReportState } from 'ag-studio';
import { createInitialLayout } from '../src/studio/layout';
import {
  addWidgetTo,
  buildWidget,
  defaultTitleFor,
  getAddedWidgetIds,
  isBaseWidget,
  kindLabel,
  removeAddedWidgetsFrom,
  sanitizeTitle,
} from '../src/studio/addWidget';

function createFakeApi(initialState = createInitialLayout(false) as unknown as AgReportState) {
  let state = structuredClone(initialState);
  return {
    getState: () => state,
    setState: (next: AgReportState) => {
      state = next;
    },
  };
}

describe('Studio add and remove widgets', () => {
  it('places a new widget on the page below the others', () => {
    const api = createFakeApi();
    const ok = addWidgetTo(api, 'refunds_by_venue', 'Refund count by venue');
    expect(ok).toBe(true);

    const page = api.getState().pages[0];
    const addedIds = getAddedWidgetIds(page);
    expect(addedIds).toHaveLength(1);

    const widgetId = addedIds[0];
    const widget = page.widgets?.[widgetId] as { type: string; format?: { title?: { text?: string } } };
    expect(widget?.type).toBe('bar-chart-grouped');
    expect(widget?.format?.title?.text).toBe('Refund count by venue');

    const layout = page.widgetLayout?.[widgetId];
    expect(layout).toMatchObject({ xTrack: 0, xSpan: 12, ySpan: 44 });
    expect(layout?.yTrack).toBeGreaterThan(0);
  });

  it('caps at 4 added widgets and replaces the oldest on a fifth ask', () => {
    const api = createFakeApi();

    const ok1 = addWidgetTo(api, 'refunds_by_venue', 'Refunds 1');
    const ok2 = addWidgetTo(api, 'paid_by_venue', 'Paid 2');
    const ok3 = addWidgetTo(api, 'preorders_by_state', 'States 3');
    const ok4 = addWidgetTo(api, 'pending_payments', 'Pending 4');
    expect(ok1 && ok2 && ok3 && ok4).toBe(true);

    let page = api.getState().pages[0];
    let addedIds = getAddedWidgetIds(page);
    expect(addedIds).toHaveLength(4);

    const firstId = addedIds[0];
    const secondId = addedIds[1];
    const thirdId = addedIds[2];
    const fourthId = addedIds[3];

    // Fifth ask replaces the oldest added one
    const ok5 = addWidgetTo(api, 'refunds_by_venue', 'Refunds 5');
    expect(ok5).toBe(true);

    page = api.getState().pages[0];
    addedIds = getAddedWidgetIds(page);
    expect(addedIds).toHaveLength(4);

    // Oldest (firstId) is gone
    expect(addedIds).not.toContain(firstId);
    // 2nd, 3rd, 4th remain, and a new 5th is added
    expect(addedIds).toContain(secondId);
    expect(addedIds).toContain(thirdId);
    expect(addedIds).toContain(fourthId);

    const newestId = addedIds.find((id) => id !== secondId && id !== thirdId && id !== fourthId);
    expect(newestId).toBeDefined();
    const newestWidget = page.widgets?.[newestId!] as { format?: { title?: { text?: string } } };
    expect(newestWidget?.format?.title?.text).toBe('Refunds 5');
  });

  it('Remove added clears only added widgets and keeps base widgets', () => {
    const api = createFakeApi();
    addWidgetTo(api, 'refunds_by_venue', 'Refunds');
    addWidgetTo(api, 'paid_by_venue', 'Paid');

    let page = api.getState().pages[0];
    expect(getAddedWidgetIds(page)).toHaveLength(2);
    expect(Object.keys(page.widgets ?? {}).filter(isBaseWidget)).toHaveLength(4);

    const cleared = removeAddedWidgetsFrom(api);
    expect(cleared).toBe(true);

    page = api.getState().pages[0];
    expect(getAddedWidgetIds(page)).toHaveLength(0);
    expect(Object.keys(page.widgets ?? {}).filter(isBaseWidget)).toHaveLength(4);
    expect(page.widgets?.map).toBeDefined();
    expect(page.widgets?.evidence).toBeDefined();
    expect(page.widgets?.errors).toBeDefined();
    expect(page.widgets?.refunds).toBeDefined();
  });

  it('builds widgets for each fixed kind with expected types and mappings', () => {
    const refunds = buildWidget('refunds_by_venue', 'Refunds by venue');
    expect(refunds.widget.type).toBe('bar-chart-grouped');
    expect(refunds.filter).toBeDefined();

    const paid = buildWidget('paid_by_venue', 'Paid units');
    expect(paid.widget.type).toBe('bar-chart-grouped');

    const states = buildWidget('preorders_by_state', 'Preorders by state');
    expect(states.widget.type).toBe('pie-chart');

    const pending = buildWidget('pending_payments', 'Pending payments');
    expect(pending.widget.type).toBe('grid');
    expect(pending.filter).toBeDefined();
  });

  it('provides plain labels and default titles', () => {
    expect(defaultTitleFor('refunds_by_venue')).toBe('Refunds by venue');
    expect(defaultTitleFor('paid_by_venue')).toBe('Paid by venue');
    expect(defaultTitleFor('preorders_by_state')).toBe('Preorders by state');
    expect(defaultTitleFor('pending_payments')).toBe('Pending payments');

    expect(kindLabel('refunds_by_venue')).toBe('chart of refunds by venue');
    expect(kindLabel('paid_by_venue')).toBe('chart of paid units by venue');
    expect(kindLabel('preorders_by_state')).toBe('chart of preorders by state');
    expect(kindLabel('pending_payments')).toBe('table of pending payments');
  });

  it('sanitizes titles properly', () => {
    expect(sanitizeTitle('A'.repeat(60))).toBe('A'.repeat(60));
    expect(sanitizeTitle('A'.repeat(61))).toBe('Chart');
    expect(sanitizeTitle('Odd title @#$')).toBe('Chart');
    expect(sanitizeTitle(null)).toBe('Chart');
    expect(sanitizeTitle('')).toBe('Chart');
    expect(sanitizeTitle('   ')).toBe('Chart');
    expect(sanitizeTitle('Valid Title 123')).toBe('Valid Title 123');
  });
});
