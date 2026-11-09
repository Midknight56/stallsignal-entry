import { catalog, MEAN_COST_CENTS } from '../data/catalog';
import { venues } from '../data/venues';
import type { Venue, VenueId } from '../shared/types';

export function getVenue(venue: Venue | VenueId): Venue {
  return typeof venue === 'string' ? venues.find((v) => v.id === venue)! : venue;
}
export function stockUnits(budget: number, venue: Venue | VenueId): number {
  return Math.max(0, Math.min(getVenue(venue).stockCap, Math.floor(budget / MEAN_COST_CENTS)));
}
export function allocate(venue: Venue | VenueId, stockBudgetCents: number) {
  const target = stockUnits(stockBudgetCents, venue);
  const rows = catalog.map((p) => ({
    product: p.id,
    units: Math.floor(target * p.defaultMix),
    costCents: 0,
  }));
  let spent = rows.reduce((sum, row, i) => sum + row.units * catalog[i].unitCostCents, 0);
  let count = rows.reduce((sum, row) => sum + row.units, 0);
  while (count < target) {
    const next = catalog
      .map((p, i) => ({ i, deficit: target * p.defaultMix - rows[i].units }))
      .filter(({ i }) => spent + catalog[i].unitCostCents <= stockBudgetCents)
      .sort((a, b) => b.deficit - a.deficit)[0];
    if (!next) break;
    rows[next.i].units++;
    spent += catalog[next.i].unitCostCents;
    count++;
  }
  return rows.map((row, i) => ({ ...row, costCents: row.units * catalog[i].unitCostCents }));
}
