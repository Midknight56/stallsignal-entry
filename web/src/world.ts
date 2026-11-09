import type { World } from '../../src/shared/types';

export type MapWorld = World & {
  recordedAt?: string | null;
  recorded:
    | (NonNullable<World['recorded']> &
        import('./format').ReceiptCampaign & { ops?: import('../../src/shared/types').Op[] })
    | null;
};
export const recordingTime = (world: MapWorld) => world.recordedAt ?? world.recorded?.recordedAt ?? null;
