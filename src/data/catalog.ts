import type { Product } from '../shared/types';

export const catalog: Product[] = [
  { id: 'tin', name: 'Travel tin candle', priceCents: 1400, unitCostCents: 400, defaultMix: 0.45 },
  { id: 'jar', name: 'Harbour jar candle', priceCents: 2800, unitCostCents: 900, defaultMix: 0.35 },
  { id: 'trio', name: 'Gift trio', priceCents: 3600, unitCostCents: 1200, defaultMix: 0.2 },
];
export const MEAN_PRICE_CENTS = Math.round(catalog.reduce((sum, p) => sum + p.priceCents * p.defaultMix, 0));
export const MEAN_COST_CENTS = Math.round(
  catalog.reduce((sum, p) => sum + p.unitCostCents * p.defaultMix, 0),
);
