import type { OpeningKind, ZoneKind } from '@houseplan/shared';

export const GRID_CM = 25;
export const PARTITION_THICKNESS_CM = 15;

export const OPENING_LABELS: Record<OpeningKind, string> = {
  window: 'Окно',
  entryDoor: 'Входная дверь',
  innerDoor: 'Дверь',
};

export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; sill?: number; top?: number; height?: number }> = {
  window: { width: 120, sill: 90, top: 220 },
  entryDoor: { width: 100, height: 200 },
  innerDoor: { width: 90, height: 200 },
};

export const OPENING_COLORS: Record<OpeningKind, string> = {
  window: '#2563eb',
  entryDoor: '#b45309',
  innerDoor: '#b45309',
};

export const ZONE_COLORS: Record<ZoneKind, string> = {
  stairs: '#7c3aed',
  builtInWardrobe: '#0d9488',
  fireplace: '#ea580c',
  decorativeWall: '#db2777',
  partition: '#dc2626',
  other: '#ca8a04',
};
