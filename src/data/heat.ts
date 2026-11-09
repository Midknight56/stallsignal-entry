import portland from './portland.json' with { type: 'json' };
import type { HeatCell } from '../shared/types';

export const heat: HeatCell[] = portland.heat.map((cell) => ({ ...cell, label: portland.heatLabel }));
