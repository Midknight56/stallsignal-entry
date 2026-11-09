import { catalog } from '../data/catalog';
import { venues } from '../data/venues';
import { allocate } from '../domain/allocate';
import { decide } from '../domain/blend';
import type { AgentView, VenueId } from '../shared/types';
import { makeFacts, type Evidence } from './facts';

export function read_location_evidence(venue: VenueId, input: Evidence) {
  return makeFacts(input).filter((f) => f.venue === venue);
}
export function compare_sites(input: Evidence) {
  return decide(input.preorders, input.budget, input.recorded, input.share);
}
export function propose_stock_allocation(venue: VenueId, budget: number) {
  return allocate(venue, budget);
}
export function draft_preorder_campaign(venue: VenueId): AgentView['offer'] {
  return {
    venue,
    lines: [
      `Collect at ${venues.find((v) => v.id === venue)!.name}.`,
      ...catalog.map((p) => `${p.name}: $${(p.priceCents / 100).toFixed(2)}.`),
    ],
    terms: 'Fully refunded if this venue is not chosen. Pickup Sat 19 Dec.',
  };
}
