import { describe, expect, it } from 'vitest';
import type { CampaignView, Preorder, VenueId } from '../src/shared/types';
import { blendedUnits, decide } from '../src/domain/blend';
import { breakEven, breakEvenOrders } from '../src/domain/consequences';
import { currentDecision, whatChanges, type ScenarioOptions } from '../src/domain/scenarios';
import { forecastUnits } from '../src/domain/forecast';
import { PREORDER_SHARE } from '../src/data/history';
import { recordedEvidence } from '../src/engine/campaign';
import { world } from './helpers/world';

const order = (venue: VenueId, qty: number, state: Preorder['state'] = 'captured'): Preorder =>
  ({ source: 'live', state, venue, qty, captureId: 'CAP', amountCents: 1400 * qty }) as Preorder;

// A view with the same fields the server sends.
function viewOf(preorders: Preorder[], recorded: Preorder[] = recordedEvidence()): CampaignView {
  const d = decide(preorders, 90000, recorded);
  const live = preorders.filter((p) => p.source === 'live' && p.state === 'captured');
  return {
    ...d,
    id: 'c',
    state: 'open',
    chosen: null,
    preorders,
    liabilityCents: 0,
    checking: false,
    ops: [],
    shareToken: null,
    paidOrders: live.length,
    recordedOrders: recorded.filter((p) => p.captureId && p.captureId !== 'PENDING_RECORD').length,
    capturedCents: live.reduce((n, p) => n + p.amountCents, 0),
  };
}
const opts = (o: Partial<ScenarioOptions> = {}): ScenarioOptions => ({
  includeRecorded: true,
  product: 'tin',
  qtyPerOrder: 1,
  share: PREORDER_SHARE,
  budget: 90000,
  ...o,
});
// The same view after n more captured orders of q units at one venue.
const plus = (view: CampaignView, venue: VenueId, n: number, q: number): CampaignView => ({
  ...view,
  paidOrders: view.paidOrders + n,
  venues: view.venues.map((v) => (v.id === venue ? { ...v, paidUnits: v.paidUnits + n * q } : v)),
});

describe('what changes the choice', () => {
  it('one order of 3 units moves the blend less than three orders of 1 unit', () => {
    const one = blendedUnits('mill', 3, 1);
    const three = blendedUnits('mill', 3, 3);
    const f = forecastUnits('mill');
    expect(one).toBeCloseTo(f * 0.9 + (3 / PREORDER_SHARE) * 0.1, 9);
    expect(three).toBeCloseTo(f * 0.7 + (3 / PREORDER_SHARE) * 0.3, 9);
    expect(one).not.toBeCloseTo(three, 3);
  });

  it('pending preorders never change the decision or the thresholds', () => {
    const base = viewOf([order('linden', 2)], []);
    const pending = viewOf([order('linden', 2), order('mill', 3, 'pending'), order('mill', 3, 'checking')], []);
    for (const includeRecorded of [true, false]) {
      expect(currentDecision(pending, opts({ includeRecorded }))).toEqual(currentDecision(base, opts({ includeRecorded })));
      expect(whatChanges(pending, opts({ includeRecorded, qtyPerOrder: 3 }))).toEqual(
        whatChanges(base, opts({ includeRecorded, qtyPerOrder: 3 })),
      );
    }
  });

  it('each threshold holds on both sides: n minus 1 orders keep the pick, n orders change it', () => {
    let checked = 0;
    for (const includeRecorded of [true, false])
      for (const qtyPerOrder of [1, 2, 3] as const) {
        const view = viewOf([order('wharf', 1), order('linden', 1)]);
        const o = opts({ includeRecorded, qtyPerOrder });
        const now = currentDecision(view, o).decided;
        for (const row of whatChanges(view, o)) {
          if (row.current) {
            expect(row.venue).toBe(now);
            expect(row.orders).toBe(0);
            continue;
          }
          if (row.orders === null) continue;
          expect(row.units).toBe(row.orders * qtyPerOrder);
          expect(row.resultPick).toBe(row.venue);
          expect(currentDecision(plus(view, row.venue, row.orders - 1, qtyPerOrder), o).decided).not.toBe(row.venue);
          expect(currentDecision(plus(view, row.venue, row.orders, qtyPerOrder), o).decided).toBe(row.venue);
          checked += 1;
        }
      }
    expect(checked).toBeGreaterThan(4);
  });

  it('this campaign only uses no recorded units: no live payments shows the forecast pick', () => {
    const view = viewOf([]);
    expect(view.paidOrders).toBe(0);
    expect(view.recordedOrders).toBeGreaterThan(0);
    const only = currentDecision(view, opts({ includeRecorded: false }));
    expect(only.decided).toBe(only.forecastPick);
    expect(only.venues.every((v) => v.recordedUnits === 0)).toBe(true);
    expect(currentDecision(view, opts()).decided).toBe(view.decided);
  });

  it('a smaller preorder share makes paid units count for more', () => {
    const view = viewOf([]);
    const at = (share: number) =>
      whatChanges(view, opts({ includeRecorded: false, share })).find((r) => r.venue === 'mill')!.orders!;
    expect(at(0.1)).toBeLessThan(at(0.3));
    expect(at(0.1)).toBeLessThanOrEqual(at(0.2));
  });

  it('the decision can differ by budget, so the panel decides at the selected budget', () => {
    const view = viewOf([]);
    const low = currentDecision(view, opts({ includeRecorded: false, budget: 15000 }));
    const high = currentDecision(view, opts({ includeRecorded: false, budget: 90000 }));
    expect(low.decided).toBe('linden');
    expect(high.decided).toBe('wharf');
  });

  it('break even counts orders and units apart', () => {
    const view = viewOf([]);
    const units1 = breakEven(view, 90000);
    const orders3 = breakEvenOrders(view, 90000, 3);
    expect(breakEvenOrders(view, 90000, 1)).toBe(units1);
    expect(orders3).not.toBeNull();
    expect(breakEven(view, 90000, 3)).toBe(orders3! * 3);
  });
});

describe('the campaign view counts orders and captured money', () => {
  it('paidOrders, recordedOrders and capturedCents follow the decision filters', async () => {
    const w = world();
    try {
      const v = w.visitor();
      await v.paid();
      await v.paid('mill');
      const view = await v.campaign();
      expect(view.paidOrders).toBe(2);
      expect(view.recordedOrders).toBe(recordedEvidence().filter((p) => p.captureId && p.captureId !== 'PENDING_RECORD').length);
      expect(view.capturedCents).toBe(view.preorders.filter((p) => p.state === 'captured').reduce((n, p) => n + p.amountCents, 0));
      expect(view.capturedCents).toBeGreaterThan(0);
      const closed = (await (await v.api('/api/campaign/close', { venue: 'mill' })).json()) as CampaignView;
      expect(closed.capturedCents).toBeLessThan(view.capturedCents);
    } finally {
      w.db.close();
    }
  });
});
