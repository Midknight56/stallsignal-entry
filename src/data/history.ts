import type { HistoryRow } from '../shared/types';

export const HISTORY_LABEL = 'Synthetic history';
export const history: (HistoryRow & { label: string })[] = [
  {
    id: 'h1',
    venue: 'wharf',
    season: 'summer',
    footfall: 5200,
    forecastUnits: 190,
    actualUnits: 171,
    preorderUnits: 17,
  },
  {
    id: 'h2',
    venue: 'wharf',
    season: 'autumn',
    footfall: 3900,
    forecastUnits: 150,
    actualUnits: 96,
    preorderUnits: 11,
  },
  {
    id: 'h3',
    venue: 'wharf',
    season: 'winter',
    footfall: 3100,
    forecastUnits: 130,
    actualUnits: 74,
    preorderUnits: 8,
  },
  {
    id: 'h4',
    venue: 'mill',
    season: 'autumn',
    footfall: 1900,
    forecastUnits: 80,
    actualUnits: 97,
    preorderUnits: 14,
  },
  {
    id: 'h5',
    venue: 'mill',
    season: 'winter',
    footfall: 1700,
    forecastUnits: 72,
    actualUnits: 91,
    preorderUnits: 12,
  },
  {
    id: 'h6',
    venue: 'linden',
    season: 'summer',
    footfall: 1300,
    forecastUnits: 55,
    actualUnits: 49,
    preorderUnits: 6,
  },
  {
    id: 'h7',
    venue: 'linden',
    season: 'winter',
    footfall: 1000,
    forecastUnits: 45,
    actualUnits: 52,
    preorderUnits: 7,
  },
  {
    id: 'h8',
    venue: 'mill',
    season: 'summer',
    footfall: 2100,
    forecastUnits: 88,
    actualUnits: 84,
    preorderUnits: 11,
  },
].map((row) => ({ ...row, label: HISTORY_LABEL })) as (HistoryRow & { label: string })[];
export const PREORDER_SHARE =
  history.reduce((sum, row) => sum + row.preorderUnits, 0) /
  history.reduce((sum, row) => sum + row.actualUnits, 0);
