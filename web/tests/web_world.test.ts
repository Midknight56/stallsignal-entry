import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { city } from '../../src/data/city';
import { venues } from '../../src/data/venues';
import { catalog } from '../../src/data/catalog';
import { history } from '../../src/data/history';
import { heat } from '../../src/data/heat';
import CityScene from '../src/map/CityScene';
import CityMap from '../src/map/CityMap';
import Panel from '../src/panel';
import { freshCampaign, world } from '../src/mock/fixtures';
import { decisionLine } from '../src/format';

it('shares the real city, venues, catalog, history and worker heat', () => {
  expect(world.city).toBe(city);
  expect(world.venues).toBe(venues);
  expect(world.catalog).toBe(catalog);
  expect(world.history).toBe(history);
  expect(world.heat).toBe(heat);
  const markup = renderToStaticMarkup(
    createElement(CityMap, {
      world,
      campaign: freshCampaign(),
      selected: 'mill',
      onSelect: () => {},
      split: 50,
      onSplit: () => {},
    }),
  );
  for (const label of city.labels) expect(markup).toContain(label.text);
  expect(markup).toContain('stroke-width="2"');
  expect(markup).toContain('stroke-width="0.7"');
  expect(markup).toContain('Portland, Maine');
  expect(markup).toContain('Real streets');
  expect(markup).not.toContain('Example venues');
  expect(markup).toContain('Heat: daytime workers, 2024');
  expect(markup).toContain('About 0 daytime workers here');
  expect(markup).toContain('Map data: U.S. Census Bureau (TIGER/Line 2025, LODES 8.5).');
  expect(markup.indexOf('data-layer="heat"')).toBeLessThan(markup.indexOf('data-layer="roads"'));
  expect(markup).not.toContain('City geometry is not available yet');
});
it('records the target mix as evidence while keeping live sales empty', () => {
  const campaign = freshCampaign();
  expect(world.recorded?.preorders.every((p) => p.source === 'recorded')).toBe(true);
  expect(campaign.venues.map((v) => [v.id, v.recordedUnits, v.paidUnits])).toEqual([
    ['wharf', 2, 0],
    ['mill', 8, 0],
    ['linden', 1, 0],
  ]);
  expect(world.recorded?.preorders.filter((p) => p.venue === 'mill')).toHaveLength(6);
  expect(campaign.preorders).toEqual([]);
  expect(decisionLine(campaign, world.venues)).toBe('Forecast picks Shed 9. Preorders pick Millrace Hall.');
});
it('shows missing recorded evidence on the live home panel', () => {
  const markup = renderToStaticMarkup(
    createElement(Panel, {
      world: { ...world, recorded: null },
      campaign: freshCampaign(),
      selected: 'mill',
      onSelect: () => {},
      onRefresh: async () => {},
    }),
  );
  expect(markup).toContain('Recorded run not captured yet');
});

it('hides recorded dots and rings until the world has a recording date', () => {
  const render = (recordedAt: string | null) =>
    renderToStaticMarkup(
      createElement(CityScene, {
        world: { ...world, recorded: { ...world.recorded!, recordedAt } },
        campaign: freshCampaign(),
        selected: 'mill',
        onSelect: () => {},
      }),
    );
  expect(render(null)).not.toContain('<title>Recorded preorder</title>');
  expect(render(null)).not.toContain('stroke-width="9"');
  expect(render('2026-11-06')).toContain('<title>Recorded preorder</title>');
  expect(render('2026-11-06')).toContain('stroke-width="9"');
  expect(render(null)).toContain('clip-rule="evenodd"');
  expect(render(null)).toContain('land-clip');
});
it('exposes the Studio map pins inside an interactive group', () => {
  const markup = renderToStaticMarkup(
    createElement(CityScene, {
      world,
      campaign: freshCampaign(),
      selected: 'mill',
      onSelect: () => {},
      interactivePins: true,
      pinLabelSuffix: ' on map',
    }),
  );
  expect(markup).toContain('role="group"');
  for (const venue of venues) {
    expect(markup).toContain(`aria-label="Select ${venue.name} on map"`);
  }
  expect(markup.match(/role="button" tabindex="0"/g)).toHaveLength(3);
  expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
});
it('keeps rotated map label boxes clear of each other, venue pins, names and demand rings', () => {
  const overlaps = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const boxes: number[][] = [];
  for (const item of city.labels) {
    const { x, y } = item;
    const width = item.text.length * 6.5 + 6;
    const left = x < 80 ? 0 : x > 920 ? -width : -width / 2;
    const angle = (item.angle * Math.PI) / 180;
    const corners = [
      [left, -15],
      [left + width, -15],
      [left, 5],
      [left + width, 5],
    ].map(([dx, dy]) => [
      x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y + dx * Math.sin(angle) + dy * Math.cos(angle),
    ]);
    const label = [
      Math.min(...corners.map((p) => p[0])),
      Math.min(...corners.map((p) => p[1])),
      Math.max(...corners.map((p) => p[0])),
      Math.max(...corners.map((p) => p[1])),
    ];
    for (const other of boxes) expect(overlaps(label, other), item.text).toBe(false);
    boxes.push(label);
    expect(label[0]).toBeGreaterThanOrEqual(4);
    expect(label[1]).toBeGreaterThanOrEqual(4);
    expect(label[2]).toBeLessThanOrEqual(996);
    expect(label[3]).toBeLessThanOrEqual(696);
    for (const venue of venues) {
      const row = freshCampaign().venues.find((r) => r.id === venue.id)!;
      const radius = Math.max(
        24,
        12 + Math.sqrt(row.forecastUnits) * 2 + 4,
        15 + Math.sqrt(row.recordedUnits + 30) * 5 + 5,
      );
      expect(
        overlaps(label, [venue.x - radius, venue.y - radius, venue.x + radius, venue.y + radius]),
        item.text + ' / ' + venue.name + ' ring',
      ).toBe(false);
      const name = venue.id === 'wharf' ? 'Shed 9' : venue.name;
      const pinLabelWidth = name.length * 9 + 10;
      expect(
        overlaps(label, [
          venue.x - pinLabelWidth / 2,
          venue.y - 68,
          venue.x + pinLabelWidth / 2,
          venue.y - 40,
        ]),
        item.text + ' / ' + venue.name + ' name',
      ).toBe(false);
    }
  }
});
