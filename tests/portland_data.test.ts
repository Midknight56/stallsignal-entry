import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import city from '../src/data/portland.json';

type Point = readonly number[];
const path = fileURLToPath(new URL('../src/data/portland.json', import.meta.url).href);
const rings = city.water.flatMap((feature) => feature.rings);
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const point = (p: { x: number; y: number }) => [p.x, p.y];

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t =
    dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return distance(p, [a[0] + t * dx, a[1] + t * dy]);
}

function inside(p: Point, ring: Point[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (segmentDistance(p, a, b) < 1e-7) return true;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      result = !result;
  }
  return result;
}

function expectLand(p: Point) {
  expect(p[0]).toBeGreaterThanOrEqual(0);
  expect(p[0]).toBeLessThanOrEqual(1000);
  expect(p[1]).toBeGreaterThanOrEqual(0);
  expect(p[1]).toBeLessThanOrEqual(700);
  expect(rings.some((ring) => inside(p, ring))).toBe(false);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('Portland Census map data', () => {
  it('exists below 300 KB and matches its canonical SHA256 checksum', () => {
    expect(statSync(path).size).toBeLessThan(300_000);
    const digest = createHash('sha256')
      .update(canonical({ ...city, checksum: '' }))
      .digest('hex');
    expect(city.checksum).toBe(digest);
    expect(readFileSync(path, 'utf8')).toBe(canonical(city));
    expect(city.name).toBe('Portland, Maine');
    expect(city.viewBox).toBe('0 0 1000 700');
  });

  it('uses the specified projected frame and Census vintages', () => {
    expect((city.frame.west + city.frame.east) / 2).toBeCloseTo(-70.262, 9);
    expect((city.frame.south + city.frame.north) / 2).toBeCloseTo(43.658, 9);
    const metresPerDegree = (Math.PI / 180) * 6371008.8;
    expect((city.frame.north - city.frame.south) * metresPerDegree).toBeCloseTo(2520, 5);
    expect(
      (city.frame.east - city.frame.west) * metresPerDegree * Math.cos((43.658 * Math.PI) / 180),
    ).toBeCloseTo(3600, 5);
    expect(city.sources.tiger).toBe('TIGER/Line 2025');
    expect(city.sources.lodes).toBe('LODES 8.5, me_wac_S000_JT00_2024');
    expect(city.heatLabel).toBe('Daytime workers, 2024');
  });

  it('keeps heat centres and all six flat top corners on land inside the frame', () => {
    expect(city.heat.length).toBeGreaterThanOrEqual(40);
    for (const cell of city.heat) {
      expect(cell.radius).toBe(22);
      expectLand(point(cell));
      for (let i = 0; i < 6; i++) {
        expectLand([
          cell.x + cell.radius * Math.cos((i * Math.PI) / 3),
          cell.y + cell.radius * Math.sin((i * Math.PI) / 3),
        ]);
      }
    }
    expect(new Set(city.heat.map((cell) => `${cell.x},${cell.y}`)).size).toBe(city.heat.length);
  });

  it('normalizes real job counts with the specified monotonic logarithm', () => {
    const maximum = Math.max(...city.heat.map((cell) => cell.jobs));
    expect(maximum).toBeGreaterThan(0);
    const sorted = [...city.heat].sort((a, b) => a.jobs - b.jobs);
    for (const [index, cell] of sorted.entries()) {
      expect(Number.isInteger(cell.jobs)).toBe(true);
      expect(cell.jobs).toBeGreaterThanOrEqual(0);
      expect(cell.interest).toBeGreaterThanOrEqual(0);
      expect(cell.interest).toBeLessThanOrEqual(1);
      expect(cell.interest).toBe(Number((Math.log1p(cell.jobs) / Math.log1p(maximum)).toFixed(3)));
      if (index) expect(cell.interest).toBeGreaterThanOrEqual(sorted[index - 1].interest);
    }
    expect(sorted.at(-1)?.interest).toBe(1);
    expect(sorted[0].interest).toBeLessThan(sorted.at(-1)!.interest);
  });

  it('places three venues on named streets, clear of water and edges, at least 300 units apart', () => {
    expect(city.venueSpots.map((spot) => spot.id)).toEqual(['wharf', 'mill', 'linden']);
    for (const [index, spot] of city.venueSpots.entries()) {
      const p = point(spot);
      expectLand(p);
      expect(Math.min(spot.x, spot.y, 1000 - spot.x, 700 - spot.y)).toBeGreaterThanOrEqual(25);
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          expect(segmentDistance(p, ring[i], ring[(i + 1) % ring.length])).toBeGreaterThanOrEqual(25);
        }
      }
      const matching = city.roads.filter((road) => road.name === spot.street);
      expect(matching.length).toBeGreaterThan(0);
      const onStreet = matching.some((road) =>
        road.points.slice(1).some((b, i) => segmentDistance(p, road.points[i], b) <= 0.08),
      );
      expect(onStreet).toBe(true);
      for (const other of city.venueSpots.slice(index + 1)) {
        expect(distance(p, point(other))).toBeGreaterThanOrEqual(300);
      }
    }
    expect(city.venueSpots.map((spot) => spot.street)).toEqual(['Commercial St', 'Atlantic St', 'A St']);
    expect(city.roads.some((road) => road.name === city.venueSpots[2].street && road.class === 'local')).toBe(
      true,
    );
    const jobsAt = (p: Point) =>
      city.heat.find((cell) => {
        const vertices = Array.from({ length: 6 }, (_, i) => [
          cell.x + 22 * Math.cos((i * Math.PI) / 3),
          cell.y + 22 * Math.sin((i * Math.PI) / 3),
        ]);
        return inside(p, vertices);
      })?.jobs;
    const jobs = city.venueSpots.map((spot) => jobsAt(point(spot)));
    expect(jobs.every((value) => value !== undefined)).toBe(true);
    expect(jobs[0]!).toBeGreaterThan(jobs[1]!);
    expect(jobs[1]!).toBeGreaterThan(jobs[2]!);
    const millInterest = Number(
      (Math.log1p(jobs[1]!) / Math.log1p(Math.max(...city.heat.map((c) => c.jobs)))).toFixed(3),
    );
    expect(millInterest).toBeGreaterThanOrEqual(0.1 * Math.max(...city.heat.map((cell) => cell.interest)));
  });

  it('has real water names and nonempty labels placed in their water bodies', () => {
    expect(city.water.some((feature) => ['Casco Bay', 'Fore River'].includes(feature.name))).toBe(true);
    expect(city.labels.length).toBeGreaterThan(0);
    for (const label of city.labels) {
      expect(label.text.trim().length).toBeGreaterThan(0);
      if (label.kind === 'water') {
        expect(
          city.water.some(
            (feature) =>
              feature.name === label.text && feature.rings.some((ring) => inside(point(label), ring)),
          ),
        ).toBe(true);
        const body = city.water
          .filter((feature) => feature.name === label.text)
          .flatMap((feature) => feature.rings);
        for (const ring of body) {
          for (let i = 0; i < ring.length; i++) {
            expect(
              segmentDistance(point(label), ring[i], ring[(i + 1) % ring.length]),
              label.text,
            ).toBeGreaterThanOrEqual(8);
          }
        }
      } else {
        expect(city.roads.some((road) => road.name === label.text)).toBe(true);
        expect(label.text).not.toMatch(/^(US Hwy|State Rte|I-)/);
        expect(Math.abs(label.angle)).toBeLessThanOrEqual(90);
      }
    }
    expect(city.labels.filter((label) => label.kind === 'street').length).toBeLessThanOrEqual(8);
  });

  it('keeps valid clipped roads and water rings, with no short local segments', () => {
    expect(city.roads.length).toBeGreaterThan(0);
    for (const road of city.roads) {
      expect(['major', 'local']).toContain(road.class);
      expect(road.points.length).toBeGreaterThanOrEqual(2);
      let length = 0;
      for (const [i, p] of road.points.entries()) {
        expect(p[0]).toBeGreaterThanOrEqual(0);
        expect(p[0]).toBeLessThanOrEqual(1000);
        expect(p[1]).toBeGreaterThanOrEqual(0);
        expect(p[1]).toBeLessThanOrEqual(700);
        if (i) length += distance(road.points[i - 1], p);
      }
      if (road.class === 'local') expect(length).toBeGreaterThanOrEqual(15);
    }
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring.at(-1));
    }
  });

  it('contains no random or seed key anywhere', () => {
    function check(value: unknown) {
      if (value === null || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        expect(key).not.toBe('random');
        expect(key).not.toBe('seed');
        check(item);
      }
    }
    check(city);
  });
});
