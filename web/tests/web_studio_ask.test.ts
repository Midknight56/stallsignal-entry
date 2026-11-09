import { describe, expect, it } from 'vitest';
import type { AgReportState } from 'ag-studio';
import { askToChange, answerSource, changeEvents } from '../src/studio/runner';
import { applySelection, filterTables } from '../src/studio/filter';
import { createInitialLayout } from '../src/studio/layout';
import { shapeTables } from '../src/studio/data';
import { freshCampaign, scorecard, world } from '../src/mock/fixtures';

describe('checked Ask changes', () => {
  it.each(['overestimated', 'underestimated', 'by_venue', 'refunds_open', 'paid_vs_forecast'] as const)(
    'maps %s to a real Studio change',
    (view) => {
      const checked = askToChange({ view, venue: 'mill', source: 'matched' })!;
      expect(checked).toEqual({ view, venue: 'mill', source: 'matched' });
      const state = applySelection(createInitialLayout(false) as unknown as AgReportState, checked);
      expect(state.pages[0].filter?.page?.[0].model).toEqual({ operator: 'equals', value: 'mill' });
      const chart = state.pages[0].widgets?.errors;
      expect(chart?.dataMapping).toMatchObject({
        categoryKey: [{ id: view === 'paid_vs_forecast' ? 'venues.venue' : 'history.label' }],
      });
      if (view === 'refunds_open')
        expect(state.pages[0].filter?.widget?.refunds[0].model).toEqual({ operator: 'isTrue' });
      expect(changeEvents(checked, 'run').map((e) => e.type)).toEqual([
        'TOOL_CALL_START',
        'TOOL_CALL_ARGS',
        'TOOL_CALL_END',
      ]);
    },
  );
  it.each([
    null,
    {},
    { view: 'delete', venue: null, source: 'ai' },
    { view: 'by_venue', venue: 'other', source: 'ai' },
    { view: 'by_venue', venue: null, source: 'invented' },
    { view: 'by_venue', source: 'ai' },
  ])('rejects malformed or unsupported answers', (value) => {
    expect(askToChange(value)).toBeNull();
  });
  it('labels sources exactly', () => {
    expect(
      ['ai', 'matched', 'recorded'].map((s) => answerSource(s as 'ai' | 'matched' | 'recorded')),
    ).toEqual(['AI', 'Matched without AI', 'Recorded']);
  });
  it('shows only outstanding refunds in the open refunds view', () => {
    const campaign = freshCampaign();
    const base = {
      venue: 'mill' as const,
      product: 'tin' as const,
      qty: 1,
      amountCents: 1400,
      source: 'live' as const,
      orderId: null,
      captureId: null,
      refundId: null,
      debugId: null,
      updatedAt: '',
    };
    campaign.preorders = [
      { ...base, id: 'pending', state: 'refund_pending' },
      { ...base, id: 'done', state: 'refunded' },
    ];
    expect(
      filterTables(shapeTables(world, campaign, scorecard()), {
        view: 'refunds_open',
        venue: null,
      }).preorders.map((p) => p.id),
    ).toEqual(['pending']);
  });
});
