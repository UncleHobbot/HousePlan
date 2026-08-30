import type { Contour, Floor, Opening, OpeningKind, Point, Zone, ZoneKind } from '@houseplan/shared';

export type EditablePlan =
  | {
      kind: 'shell';
      name: string;
      contour: Contour;
      openings: Opening[];
      openingKinds: Extract<OpeningKind, 'window' | 'entryDoor'>[];
    }
  | {
      kind: 'room';
      name: string;
      contour: Contour;
      openings: Opening[];
      openingKinds: Extract<OpeningKind, 'innerDoor'>[];
      zones: Zone[];
      floors: Floor[];
      floorId: number;
    };

export interface RoomEditorProps {
  plan: EditablePlan;
  allocateId: (kind: 'point' | 'opening' | 'zone') => number;
  onChange: (plan: EditablePlan) => void;
  onDone: () => void;
}

export interface Banner {
  kind: 'info' | 'ok' | 'bad';
  text: string;
}

export interface ZoneDraft {
  kind: ZoneKind;
  anchorId: number;
  points: Point[];
  wallDir: { x: number; y: number } | null;
}

export interface DimensionSelection {
  aId: number | null;
  bId: number | null;
}

export type CanvasTarget =
  | { kind: 'canvas' }
  | { kind: 'point'; pointId: number }
  | { kind: 'wall'; wallIndex: number }
  | { kind: 'zoneVertex'; zoneId: number; pointId: number };

export interface CanvasPointerEvent {
  position: { x: number; y: number };
  target: CanvasTarget;
}
