import { history } from '../data/history';
import { MEAN_PRICE_CENTS, MEAN_COST_CENTS } from '../data/catalog';
import { getVenue, stockUnits } from './allocate';
import type { HistoryRow, Venue, VenueId } from '../shared/types';

const decemberFootfall = { wharf: 3000, mill: 1750, linden: 1050 };
export function forecastUnits(venue: Venue | VenueId, season: HistoryRow['season'] = 'winter'): number {
  const id = getVenue(venue).id;
  const rows = history.filter((h) => h.venue === id);
  const footfall =
    season === 'winter'
      ? decemberFootfall[id]
      : (rows.filter((h) => h.season === season)[0]?.footfall ?? decemberFootfall[id]);
  return Math.round(
    (footfall * rows.reduce((sum, h) => sum + h.forecastUnits / h.footfall, 0)) / rows.length,
  );
}
export function expectedMargin(venue: Venue | VenueId, units: number, stockBudget = 90000): number {
  return Math.round(
    Math.min(units, stockUnits(stockBudget, venue)) * (MEAN_PRICE_CENTS - MEAN_COST_CENTS) -
      getVenue(venue).rentCents,
  );
}
