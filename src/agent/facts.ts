import { MAX_FACTS } from '../caps';
import { venues } from '../data/venues';
import { expectedMargin } from '../domain/forecast';
import { decide } from '../domain/blend';
import { scorecard } from '../domain/scorecard';
import type { Preorder, VenueId } from '../shared/types';

export interface Evidence {
  budget: number;
  preorders: Preorder[];
  recorded: Preorder[];
  // The assumed preorder share of event sales. Missing means the history share.
  share?: number;
}
export interface Fact {
  id: string;
  venue: VenueId | null;
  text: string;
}
export function makeFacts(input: Evidence): Fact[] {
  const decision = decide(input.preorders, input.budget, input.recorded, input.share);
  const facts: Omit<Fact, 'id'>[] = [];
  for (const venue of venues) {
    const row = decision.venues.find((r) => r.id === venue.id)!;
    const add = (text: string) => facts.push({ venue: venue.id, text: `${venue.name}: ${text}` });
    const money = (cents: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
    add(
      `forecast ${row.forecastUnits} units, expected margin ${money(expectedMargin(venue, row.forecastUnits, input.budget))} at this stock budget (synthetic history).`,
    );
    const history = scorecard().history.filter((h) => h.venue === venue.id && h.season !== 'summer');
    add(
      'past forecasts were ' +
        history
          .map(
            (h) =>
              `${Math.abs(Math.round(h.errorPercent))}% too ${h.errorPercent > 0 ? 'high' : 'low'} in ${h.season}`,
          )
          .join(' and ') +
        ' (synthetic history).',
    );
    add(`${row.recordedUnits} paid preorder units so far (recorded sandbox run).`);
    if (row.paidUnits) add(`${row.paidUnits} paid preorder units so far (live sandbox).`);
    add(
      `with preorders counted, about ${Math.round(row.blendedUnits)} units and ${money(row.marginCents)} expected margin.`,
    );
  }
  return facts.slice(0, MAX_FACTS).map((f, i) => ({ id: `F${i + 1}`, ...f }));
}
