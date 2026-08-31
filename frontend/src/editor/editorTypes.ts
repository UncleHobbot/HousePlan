import type { Point, ZoneKind } from '@houseplan/shared';
import type { EditorCommitRequest, EditorCommitResult, EditorPlan } from './editorSession';

export type EditablePlan = EditorPlan;

export interface RoomEditorProps {
  plan: EditablePlan;
  revision: number;
  onCommit: (request: EditorCommitRequest) => EditorCommitResult;
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
