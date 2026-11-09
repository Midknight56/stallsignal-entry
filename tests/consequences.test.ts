import { describe, expect, it } from 'vitest';
import recordedData from '../src/data/recorded.json';
import type { Preorder } from '../src/shared/types';
import { decide } from '../src/domain/blend';
import { costOfForecast, breakEven } from '../src/domain/consequences';
import { closedCampaign } from '../src/domain/scorecard';

const recorded = recordedData.preorders as Preorder[];
const extra = (n: number): Preorder[] =>
  Array.from({ length: n }, (_, i) => ({
    ...recorded[0],
    id: `extra-${i}`,
    venue: 'wharf',
    qty: 1,
    source: 'live',
    state: 'captured',
  }));
describe('forecast consequences', () => {
  it('computes cost and the first extra paid unit count that flips the real recorded decision', () => {
    const view = decide([], 90000, recorded);
    expect(view.venues.find((v) => v.id === 'mill')!.marginCents).toBe(81147);
    expect(view.venues.find((v) => v.id === 'wharf')!.marginCents).toBe(497);
    expect(costOfForecast(view)).toBe(80650);
    const n = breakEven(view, 90000)!;
    expect(n).toBe(8);
    expect(decide(extra(n), 90000, recorded).decided).toBe(view.forecastPick);
    for (let i = 0; i < n; i++) expect(decide(extra(i), 90000, recorded).decided).not.toBe(view.forecastPick);
  });
  it('returns null for both when picks agree, including recorded evidence at a low budget', () => {
    for (const view of [decide(), decide([], 45000, recorded)]) {
      expect(costOfForecast(view)).toBeNull();
      expect(breakEven(view, 45000)).toBeNull();
    }
  });
  it('returns null when the forecast venue cannot win within the stock budget', () => {
    expect(breakEven(decide([], 90000, recorded), 15000)).toBeNull();
  });
  it('records chosen and paid picks separately with real preorder and refund counts', () => {
    const row = closedCampaign(recordedData.id, recorded, 'linden', recordedData.recordedAt);
    expect(row).toMatchObject({
      paidPick: 'mill',
      decided: 'linden',
      forecastWrong: true,
      preorderCount: 9,
      refundCount: 3,
    });
    expect(closedCampaign('empty', [], 'mill', null).forecastWrong).toBe(false);
  });
  it('assigns verdict, paidOrders count and outcomeMeasured on closed campaigns', () => {
    const empty = closedCampaign('empty', [], 'mill', null);
    expect(empty).toMatchObject({
      verdict: 'no_evidence',
      paidOrders: 0,
      forecastWrong: false,
      outcomeMeasured: false,
    });
    const moved = closedCampaign(recordedData.id, recorded, 'mill', recordedData.recordedAt);
    expect(moved.verdict).toBe('changed');
    expect(moved.paidOrders).toBe(9);
    expect(moved.forecastWrong).toBe(true);
    expect(moved.outcomeMeasured).toBe(false);

    const kept = closedCampaign(
      'kept',
      [
        {
          ...recorded[0],
          id: 'k1',
          venue: 'wharf',
          qty: 5,
          source: 'live',
          state: 'captured',
          captureId: 'c1',
        },
      ],
      'wharf',
      null,
    );
    expect(kept.verdict).toBe('kept');
    expect(kept.paidOrders).toBe(1);
    expect(kept.forecastWrong).toBe(false);
    expect(kept.outcomeMeasured).toBe(false);
  });
});
