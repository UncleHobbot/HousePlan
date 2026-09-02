import { useRef, useState } from 'react';
import type Konva from 'konva';
import { Layer, Stage } from 'react-konva';
import type { Project } from '@houseplan/shared';
import { locateObject, roomAt } from '@houseplan/shared';
import { createViewport } from './editor/roomCanvas/viewport';
import { buildFloorScene, type SceneTarget } from './planScene/index';
import { PlanSceneLayer, type PlanSceneEvents } from './planScene/PlanSceneLayer';
import type { ProjectIntent, ProjectSessionResult } from './projectSession';

const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 560;
const STAGE_PADDING = 60;

export function FloorView({ project, floorId, compareSnapshotId, onIntent }: {
  project: Project;
  floorId: number;
  compareSnapshotId?: number;
  onIntent: (intent: ProjectIntent) => ProjectSessionResult;
}) {
  const floor = project.floors.find((item) => item.id === floorId) ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  const dragRef = useRef<{ objectId: number; dx: number; dy: number } | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const scene = buildFloorScene({ project, floorId, selectedObjectId: selected, compareSnapshotId });

  if (!floor) return <p className="muted">Этаж не найден.</p>;
  if (scene.extent.length === 0) {
    return (
      <div>
        {scene.diagnostics.length > 0 ? <p className="bad-text">Часть плана не удалось показать.</p> : null}
        <p className="muted">Этаж пуст.</p>
      </div>
    );
  }

  const viewport = createViewport(scene.extent, { width: STAGE_WIDTH, height: STAGE_HEIGHT, padding: STAGE_PADDING });
  const selectedObject = project.objects.find((object) => object.id === selected);
  const selectedHasConflict = selected !== null && scene.marks.some(
    (mark) => mark.role === 'clearance-conflict' && mark.target?.kind === 'object' && mark.target.objectId === selected,
  );

  function pointerInPlan(): { x: number; y: number } | null {
    const pointer = stageRef.current?.getPointerPosition();
    return pointer ? viewport.toWorld(pointer) : null;
  }

  function clientPointInPlan(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.container().getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return viewport.toWorld({
      x: ((event.clientX - rect.left) / rect.width) * STAGE_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * STAGE_HEIGHT,
    });
  }

  function movePlacement(objectId: number, x: number, y: number) {
    const located = locateObject(project, objectId);
    const roomId = roomAt(floor!, x, y) ?? located?.room.id;
    if (roomId === undefined) return;
    onIntent({
      type: 'placementMovePreviewed', objectId, floorId, roomId, x, y,
      rotationDeg: located?.placement.rotationDeg ?? 0,
    });
  }

  function startObjectDrag(event: Parameters<NonNullable<PlanSceneEvents['onMouseDown']>>[0], target: SceneTarget) {
    if (target.kind !== 'object') return;
    const pointer = pointerInPlan();
    const located = locateObject(project, target.objectId);
    if (!pointer || !located) return;
    const started = onIntent({ type: 'placementMoveStarted', objectId: target.objectId });
    if (!started.ok) return;
    dragRef.current = {
      objectId: target.objectId,
      dx: pointer.x - located.placement.x,
      dy: pointer.y - located.placement.y,
    };
    setSelected(target.objectId);
    event.cancelBubble = true;
  }

  function dropObject(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const objectId = Number(event.dataTransfer.getData('text/objectid'));
    if (!objectId) return;
    const point = clientPointInPlan(event);
    if (!point) return;
    const roomId = roomAt(floor!, point.x, point.y);
    if (roomId === null) return;
    onIntent({ type: 'objectPlaced', objectId, floorId, roomId, x: point.x, y: point.y });
  }

  const sceneEvents: PlanSceneEvents = {
    onMouseDown: startObjectDrag,
    onMouseEnter(event, target) {
      if (target.kind !== 'object') return;
      const stage = event.currentTarget.getStage();
      if (stage) stage.container().style.cursor = 'move';
    },
    onMouseLeave(event, target) {
      if (target.kind !== 'object') return;
      const stage = event.currentTarget.getStage();
      if (stage) stage.container().style.cursor = 'default';
    },
  };

  return (
    <div style={{ flex: '1 1 600px', minWidth: 0 }}>
      {selected !== null ? (
        <div className="row">
          <span className="muted">
            Выбрано: <b>{selectedObject?.name ?? '?'}</b>
            {selectedHasConflict ? <b className="bad-text"> · допуск пересекает чужое тело или зону</b> : null}
          </span>
          <button onClick={() => onIntent({ type: 'objectRotated', objectId: selected, deltaDeg: -15 })}>⟲ −15°</button>
          <button onClick={() => onIntent({ type: 'objectRotated', objectId: selected, deltaDeg: 15 })}>⟳ +15°</button>
          <button onClick={() => {
            onIntent({ type: 'objectUnplaced', objectId: selected });
            setSelected(null);
          }}>Убрать на склад</button>
        </div>
      ) : null}
      {scene.diagnostics.length > 0 ? <p className="bad-text">Часть плана не удалось показать.</p> : null}
      <div style={{ maxWidth: '100%', overflow: 'auto' }} onDragOver={(event) => event.preventDefault()} onDrop={dropObject}>
        <Stage
          ref={stageRef}
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          className="plan"
          onMouseMove={() => {
            const point = pointerInPlan();
            const drag = dragRef.current;
            if (point && drag) movePlacement(drag.objectId, point.x - drag.dx, point.y - drag.dy);
          }}
          onMouseUp={() => {
            if (dragRef.current) onIntent({ type: 'gestureCommitted' });
            dragRef.current = null;
          }}
          onMouseLeave={() => {
            if (dragRef.current) onIntent({ type: 'gestureCancelled' });
            dragRef.current = null;
          }}
          onClick={() => setSelected(null)}
        >
          <Layer><PlanSceneLayer scene={scene} viewport={viewport} events={sceneEvents} /></Layer>
        </Stage>
      </div>
    </div>
  );
}
