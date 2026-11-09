import { describe, expect, it } from 'vitest';
import { catalog, MEAN_COST_CENTS, MEAN_PRICE_CENTS } from '../src/data/catalog';
import { city, onLand } from '../src/data/city';
import { heat } from '../src/data/heat';
import portland from '../src/data/portland.json';
import { history, PREORDER_SHARE } from '../src/data/history';
import { venues } from '../src/data/venues';
import { recorded } from '../src/engine/campaign';
import { allocate } from '../src/domain/allocate';
import { decide } from '../src/domain/blend';
import { forecastUnits } from '../src/domain/forecast';
import { scorecard } from '../src/domain/scorecard';

describe('data and deterministic decisions', () => {
  it('the history table computes preorder share instead of a typed constant', () => {
    expect(history.reduce((n, h) => n + h.actualUnits, 0)).toBe(714);
    expect(history.reduce((n, h) => n + h.preorderUnits, 0)).toBe(86);
    expect(PREORDER_SHARE).toBeCloseTo(0.12, 3);
    expect(MEAN_PRICE_CENTS).toBe(2330);
    expect(MEAN_COST_CENTS).toBe(735);
    expect(catalog.map((p) => p.priceCents)).toEqual([1400, 2800, 3600]);
  });
  it('the forecast picks the wharf at the default budget', () => {
    expect(venues.map((v) => forecastUnits(v))).toEqual([117, 74, 46]);
    expect(decide().forecastPick).toBe('wharf');
    expect(decide().decided).toBe('wharf');
  });
  it('a 450 dollar budget picks the mill', () => {
    expect(decide([], 45000).forecastPick).toBe('mill');
  });
  it('the real recorded run gives mill 8, wharf 2 and linden 1 units and chooses mill without live preorders', () => {
    const receipts = recorded.preorders.map((p, i) => ({ ...p, captureId: `REC${i}` }));
    const result = decide([], 90000, receipts);
    expect(result.decided).toBe('mill');
    expect(result.overturned).toBe(true);
    expect(result.venues.map((v) => v.recordedUnits)).toEqual([2, 8, 1]);
    expect(result.venues.every((v) => v.paidUnits === 0)).toBe(true);
  });
  it('placeholder receipts and pending captures cannot invent paid demand', () => {
    const placeholders = recorded.preorders.map((p) => ({
      ...p,
      state: 'pending' as const,
      captureId: null,
    }));
    expect(
      decide(placeholders, 90000, placeholders).venues.every((v) => v.paidUnits + v.recordedUnits === 0),
    ).toBe(true);
    const pending = { ...recorded.preorders[0], source: 'live' as const, state: 'pending' as const };
    expect(decide([pending]).decided).toBe('wharf');
    expect(decide([pending]).venues.find((v) => v.id === 'mill')?.paidUnits).toBe(0);
    expect(
      decide([], 90000, [{ ...pending, source: 'recorded', captureId: 'REC_PENDING' }]).venues.every(
        (v) => v.recordedUnits === 0,
      ),
    ).toBe(true);
  });
  it('allocation never exceeds any slider budget or venue stock cap', () => {
    for (const v of venues)
      for (let budget = 15000; budget <= 150000; budget += 5000) {
        const rows = allocate(v, budget);
        expect(rows.reduce((sum, r) => sum + r.costCents, 0)).toBeLessThanOrEqual(budget);
        expect(rows.reduce((sum, r) => sum + r.units, 0)).toBeLessThanOrEqual(v.stockCap);
        expect(rows.every((r) => Number.isInteger(r.units) && r.units >= 0)).toBe(true);
      }
  });
  it('scorecard marks wharf autumn and winter as overestimated and mill as underestimated', () => {
    const rows = scorecard().history;
    expect(rows.find((r) => r.id === 'h2')?.errorPercent).toBeCloseTo(56.25);
    expect(rows.find((r) => r.id === 'h3')?.errorPercent).toBeCloseTo(75.6757);
    expect(rows.find((r) => r.id === 'h4')!.errorPercent).toBeLessThan(0);
    expect(rows.find((r) => r.id === 'h5')!.errorPercent).toBeLessThan(0);
  });
  it('uses JSON worker counts and heat cells wholly on land without generated values', () => {
    expect(heat).toEqual(portland.heat.map((cell) => ({ ...cell, label: 'Daytime workers, 2024' })));
    expect(
      heat.every(
        (c) => c.interest >= 0 && c.interest <= 1 && c.label === 'Daytime workers, 2024' && onLand(c.x, c.y),
      ),
    ).toBe(true);
    for (const cell of heat)
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        expect(onLand(cell.x + cell.radius! * Math.cos(angle), cell.y + cell.radius! * Math.sin(angle))).toBe(
          true,
        );
      }
    expect(city.name).toBe('Portland, Maine');
    expect(city.water).toEqual(portland.water);
    expect(city.roads).toEqual(portland.roads);
    expect(venues.every((v) => onLand(v.x, v.y))).toBe(true);
    expect(venues.map((v) => ({ id: v.id, x: v.x, y: v.y, street: v.district }))).toEqual(
      portland.venueSpots,
    );
  });
  it('treats water boundaries and out of frame points as outside land', () => {
    for (const p of [
      [-1, 100],
      [1001, 100],
      [100, -1],
      [100, 701],
      [390, 60],
      [10, 670],
    ]) {
      expect(onLand(...(p as [number, number]))).toBe(false);
    }
    for (const water of city.water)
      for (const ring of water.rings) {
        expect(onLand(ring[0][0], ring[0][1])).toBe(false);
      }
  });
});
