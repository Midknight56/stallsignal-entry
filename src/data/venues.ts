import type { Venue } from '../shared/types';
import portland from './portland.json' with { type: 'json' };

function spot(id: Venue['id']) {
  const { x, y, street } = portland.venueSpots.find((spot) => spot.id === id)!;
  return { x, y, district: street };
}

export const venues: Venue[] = [
  {
    id: 'wharf',
    name: 'Shed 9 at the Wharf',
    rentCents: 42000,
    stockCap: 220,
    ...spot('wharf'),
  },
  {
    id: 'mill',
    name: 'Millrace Hall',
    rentCents: 26000,
    stockCap: 160,
    ...spot('mill'),
  },
  {
    id: 'linden',
    name: 'Linden Corner Shop',
    rentCents: 18000,
    stockCap: 110,
    ...spot('linden'),
  },
];
