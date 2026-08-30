import type { OpeningKind } from '@houseplan/shared';

export const GRID_CM = 25;
export const PARTITION_THICKNESS_CM = 15;

export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; sill?: number; top?: number; height?: number }> = {
  window: { width: 120, sill: 90, top: 220 },
  entryDoor: { width: 100, height: 200 },
  innerDoor: { width: 90, height: 200 },
};
