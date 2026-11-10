import { evidenceColumns } from '../src/studio/evidence';
import { describe, expect, it } from 'vitest';
import { shapeTables, studioData } from '../src/studio/data';
import { world, freshCampaign, scorecard } from '../src/mock/fixtures';
import type { Preorder, PreorderState } from '../../src/shared/types';

export function payment(
  id: string,
  state: PreorderState,
  venue: Preorder['venue'] = 'mill',
  amountCents = 1400,
): Preorder {
  return {
    id,
    state,
    venue,
    amountCents,
    source: 'live',
    qty: 1,
    product: 'tin',
    orderId: null,
    captureId: null,
    refundId: null,
    debugId: null,
    updatedAt: '2026-11-06T12:00:00Z',
  };
}
describe('Studio table shaping', () => {
  it('uses scorecard values and labels every synthetic history fact', () => {
    const tables = shapeTables(world, freshCampaign(), scorecard());
    expect(tables.venues).toHaveLength(3);
    expect(tables.history).toHaveLength(8);
    expect(tables.history.every((r) => r.source === 'Forecast history')).toBe(true);
    const wharf = tables.history.find((r) => r.id === 'h2')!;
    expect(wharf.errorPercent).toBeCloseTo((54 / 96) * 100);
    expect(wharf.over).toBeCloseTo(wharf.errorPercent);
    expect(wharf.under).toBeNull();
    expect(tables.history.find((r) => r.id === 'h4')?.direction).toBe('Under');
    expect(tables.evidence.filter((r) => r.kind === 'forecast')).toHaveLength(3);
    expect(tables.evidence.filter((r) => r.kind === 'history')).toHaveLength(8);
    expect(studioData(tables).sources.map((s) => s.id)).toEqual([
      'venues',
      'evidence',
      'history',
      'preorders',
    ]);
    expect(studioData(tables).relationships).toHaveLength(3);
  });
  it('shapes over in percentage points, never 5625', () => {
    const customScorecard: ScorecardView = {
      history: [
        {
          id: 'h2',
          venue: 'wharf',
          season: 'autumn',
          footfall: 1000,
          forecastUnits: 150,
          actualUnits: 96,
          preorderUnits: 10,
          errorPercent: 56.25,
        },
      ],
      campaigns: [],
      perVenue: [{ venue: 'wharf', meanAbsoluteError: 56.25 }],
    };
    const tables = shapeTables(world, freshCampaign(), customScorecard);
    const wharf = tables.history.find((r) => r.id === 'h2')!;
    expect(wharf.over).toBeCloseTo(56.25);
    expect(wharf.over).not.toBe(5625);
  });
  it('combines recorded and session receipts once and keeps refunded demand separate', () => {
    const recorded = { ...payment('recorded', 'refunded', 'wharf'), source: 'recorded' as const };
    const campaign = freshCampaign();
    campaign.preorders = [payment('live', 'captured'), { ...recorded, state: 'captured' }];
    const tables = shapeTables(
      {
        ...world,
        recordedAt: '2026-11-06',
        recorded: { id: 'rec-1', label: 'Recorded run', preorders: [recorded] },
      },
      campaign,
      scorecard(),
    );
    expect(tables.preorders).toHaveLength(2);
    expect(tables.preorders.find((p) => p.id === 'recorded')).toMatchObject({
      state: 'refunded',
      liabilityCents: 0,
      source: 'Recorded run, 2026-11-06',
    });
    expect(tables.evidence.find((r) => r.id === 'payment:live')?.source).toBe('Live payment');
    expect(tables.evidence.find((r) => r.id === 'payment:recorded')?.kind).toBe('recorded');
    expect(tables.venues.find((v) => v.venueId === 'wharf')?.paid).toBe(0);
  });
  it('counts only the four outstanding refund states in integer cents', () => {
    const campaign = freshCampaign();
    const states: PreorderState[] = [
      'refund_queued',
      'refunding',
      'refund_pending',
      'refund_failed',
      'refunded',
      'captured',
      'checking',
      'pending',
      'declined',
      'canceled',
    ];
    campaign.preorders = states.map((s, i) => payment(`p${i}`, s));
    const tables = shapeTables(world, campaign, scorecard());
    expect(tables.preorders.reduce((sum, p) => sum + p.liabilityCents, 0)).toBe(5600);
    expect(tables.preorders.filter((p) => p.outstanding).map((p) => p.state)).toEqual(states.slice(0, 4));
  });
});

it('feeds every mock evidence row through the real grid column definitions without ERR', () => {
  const { evidence } = shapeTables(world, freshCampaign(), scorecard());
  expect(evidenceColumns.map((c) => c.field)).toEqual(['venue', 'kind', 'label', 'value', 'source']);
  for (const row of evidence) {
    for (const column of evidenceColumns) {
      const key = column.field as keyof typeof row;
      expect(row[key]).toBeDefined();
      expect(typeof column.valueFormatter).toBe('function');
      if (typeof column.valueFormatter !== 'function') throw new Error('Missing formatter');
      const rendered = column.valueFormatter({ value: row[key], data: row } as Parameters<
        typeof column.valueFormatter
      >[0]);
      expect(rendered).not.toBe('ERR');
      expect(rendered).toBe(String(row[key]));
    }
  }
});
it('uses eight short forecast error labels', () => {
  const { history } = shapeTables(world, freshCampaign(), scorecard());
  expect(history).toHaveLength(8);
  expect(history.map((r) => r.label)).toContain('Wharf winter');
  expect(history.every((r) => /^(Wharf|Millrace|Linden) (summer|autumn|winter)$/.test(r.label))).toBe(true);
});
