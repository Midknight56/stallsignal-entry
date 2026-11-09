import { describe, expect, it } from 'vitest';
import type { AgReportState } from 'ag-studio';
import { shapeTables } from '../src/studio/data';
import {
  applySelection,
  filterTables,
  initialSelection,
  toggleVenue,
  venueFromCrossFilter,
} from '../src/studio/filter';
import { createInitialLayout, widgetLayout } from '../src/studio/layout';
import { freshCampaign, scorecard, world } from '../src/mock/fixtures';

const tables = shapeTables(world, freshCampaign(), scorecard());
const state = () => createInitialLayout(false) as unknown as AgReportState;
describe('shared venue selection', () => {
  it('filters all four tables and toggles the same venue off', () => {
    const selected = toggleVenue(initialSelection, 'mill');
    const result = filterTables(tables, selected);
    for (const rows of Object.values(result)) expect(rows.every((row) => row.venueId === 'mill')).toBe(true);
    expect(result.history).toHaveLength(3);
    expect(toggleVenue(selected, 'mill')).toEqual(initialSelection);
    expect(toggleVenue(selected, 'linden').venue).toBe('linden');
  });
  it('sets a related venue page filter and keeps direction filtering on the chart', () => {
    const original = state();
    const next = applySelection(original, { venue: 'wharf', view: 'overestimated' });
    expect(next.pages[0].filter?.page?.[0]).toMatchObject({
      field: { id: 'venues.venueId' },
      model: { value: 'wharf' },
    });
    expect(next.pages[0].filter?.widget?.errors[0]).toMatchObject({
      field: { id: 'history.direction' },
      model: { value: 'Over' },
    });
    expect(original.pages[0].filter).toBeUndefined();
    expect(applySelection(next, initialSelection).pages[0].filter?.page).toEqual([]);
  });
  it('maps native grid and chart selections back to a venue', () => {
    const report = state();
    report.pages[0].crossFilter = {
      values: {
        evidence: [
          {
            group: 0,
            type: 'multiValue',
            values: [
              [
                { field: { id: 'evidence.venue' }, value: 'Millrace Hall' },
                { field: { id: 'evidence.kind' }, value: 'forecast' },
              ],
            ],
          },
        ],
      },
    };
    expect(venueFromCrossFilter(report, tables)).toBe('mill');
    report.pages[0].crossFilter = {
      values: {
        errors: [
          { group: 0, type: 'value', field: { id: 'history.label' }, values: [tables.history[0].label] },
        ],
      },
    };
    expect(venueFromCrossFilter(report, tables)).toBe('wharf');
    expect(venueFromCrossFilter(applySelection(report, initialSelection), tables)).toBeUndefined();
  });
  it('filters error signs without dropping venue evidence', () => {
    const over = filterTables(tables, { venue: 'mill', view: 'overestimated' });
    expect(over.history.map((r) => r.id)).toEqual(['h8']);
    expect(over.evidence.length).toBeGreaterThan(1);
    expect(filterTables(tables, { venue: 'mill', view: 'underestimated' }).history.map((r) => r.id)).toEqual([
      'h4',
      'h5',
    ]);
  });
  it('keeps the own filter of a widget the visitor added when the venue changes', () => {
    const report = state();
    const own = [{ field: { id: 'preorders.state' }, model: { operator: 'equals', value: 'refunded' } }];
    report.pages[0].widgets = { ...report.pages[0].widgets, 'added-1-1': { type: 'bar-chart-grouped' } } as never;
    report.pages[0].filter = { page: [], widget: { 'added-1-1': own } } as never;
    const next = applySelection(report, { venue: 'mill', view: 'by_venue' });
    expect(next.pages[0].filter?.widget?.['added-1-1']).toEqual(own);
    expect(applySelection(next, { venue: 'linden', view: 'refunds_open' }).pages[0].filter?.widget?.['added-1-1']).toEqual(own);
  });
  it('bounds the evidence and refund widgets however many rows there are', () => {
    for (const compact of [false, true]) {
      const big = widgetLayout(compact, 200, 50);
      expect(big.evidence.ySpan).toBeLessThanOrEqual(88);
      expect(big.refunds.ySpan).toBeLessThanOrEqual(88);
      const values = Object.values(big).sort((a, z) => a.yTrack - z.yTrack);
      if (compact)
        for (let i = 1; i < values.length; i++)
          expect(values[i].yTrack).toBeGreaterThanOrEqual(values[i - 1].yTrack + values[i - 1].ySpan);
    }
  });
  it('lays out a left map on desktop and a single column on phones', () => {
    expect(widgetLayout(false).map.xSpan).toBe(7);
    const phone = Object.values(widgetLayout(true));
    expect(phone.every((p) => p.xTrack === 0 && p.xSpan === 12)).toBe(true);
    for (let i = 1; i < phone.length; i++)
      expect(phone[i].yTrack).toBeGreaterThanOrEqual(phone[i - 1].yTrack + phone[i - 1].ySpan);
  });
});
