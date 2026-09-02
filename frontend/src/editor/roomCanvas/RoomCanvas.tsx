import { Fragment, useRef } from 'react';
import type Konva from 'konva';
import { Circle, Layer, Line, Rect, Stage } from 'react-konva';
import { GRID_CM } from '../editorConstants';
import type { CanvasPointerEvent } from '../editorTypes';
import type { EditorDispatchResult, EditorIntent, EditorSessionSnapshot } from '../editorSession';
import { buildEditableScene, type SceneTarget } from '../../planScene/index';
import { PlanSceneLayer, type PlanSceneEvents } from '../../planScene/PlanSceneLayer';
import { createViewport } from './viewport';

const WIDTH = 960;
const HEIGHT = 560;

export interface RoomCanvasProps {
  snapshot: EditorSessionSnapshot;
  dispatch: (intent: EditorIntent) => EditorDispatchResult;
}

export function RoomCanvas(props: RoomCanvasProps) {
  const pendingDrag = useRef<{ pointerId: number; x: number; y: number; started: boolean } | null>(null);
  const suppressClick = useRef(false);
  const { plan, canvas, tool } = props.snapshot;
  const scene = buildEditableScene(props.snapshot);
  const viewport = createViewport(scene.extent, {
    width: WIDTH,
    height: HEIGHT,
    padding: 60,
    worldBounds: { minX: 0, minY: 0, maxX: 600, maxY: 440 },
  });

  function pointerPosition(stage: { getPointerPosition(): { x: number; y: number } | null }) {
    return viewport.toWorld(stage.getPointerPosition() ?? { x: 0, y: 0 });
  }

  function canvasEvent(event: Parameters<NonNullable<PlanSceneEvents['onClick']>>[0], target: SceneTarget): CanvasPointerEvent | null {
    if (target.kind === 'object') return null;
    const stage = event.target.getStage();
    return stage ? { position: pointerPosition(stage), target } : null;
  }

  function startDrag(event: Parameters<NonNullable<PlanSceneEvents['onPointerDown']>>[0], target: SceneTarget) {
    if (tool.kind !== 'select' || (target.kind !== 'point' && target.kind !== 'zoneVertex')) return;
    const semantic = canvasEvent(event, target);
    if (!semantic) return;
    const result = props.dispatch({ type: 'pointerPressed', event: semantic });
    const pointerEvent = event.evt as PointerEvent;
    if (result.ok) {
      pendingDrag.current = {
        pointerId: pointerEvent.pointerId,
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        started: false,
      };
    }
  }

  const sceneEvents: PlanSceneEvents = {
    onClick(event, target) {
      const semantic = canvasEvent(event, target);
      if (semantic) props.dispatch({ type: 'canvasClicked', event: semantic });
    },
    onPointerDown: startDrag,
    onContextMenu(_event, target) {
      if (target.kind === 'point') props.dispatch({ type: 'deleteRequested', pointId: target.pointId });
      if (target.kind === 'wall') {
        const point = plan.contour.points[target.wallIndex];
        if (point) props.dispatch({ type: 'deleteRequested', pointId: point.id });
      }
    },
  };

  const origin = viewport.toCanvas({ x: 0, y: 0 });
  const gridStep = GRID_CM * viewport.scale;
  const verticalGrid = Array.from({ length: Math.ceil(WIDTH / gridStep) + 2 }, (_, index) => {
    const x = ((origin.x % gridStep) + gridStep) % gridStep + (index - 1) * gridStep;
    return <Line key={`vertical-${index}`} points={[x, 0, x, HEIGHT]} stroke="#eef2f7" listening={false} />;
  });
  const horizontalGrid = Array.from({ length: Math.ceil(HEIGHT / gridStep) + 2 }, (_, index) => {
    const y = ((origin.y % gridStep) + gridStep) % gridStep + (index - 1) * gridStep;
    return <Line key={`horizontal-${index}`} points={[0, y, WIDTH, y]} stroke="#eef2f7" listening={false} />;
  });
  const firstPoint = plan.contour.points[0];
  const closeIndicator = !plan.contour.closed && plan.contour.points.length >= 3 && firstPoint && canvas.pointer
    ? (() => {
      const first = viewport.toCanvas(firstPoint);
      const current = viewport.toCanvas(canvas.pointer!);
      const near = Math.hypot(first.x - current.x, first.y - current.y) < 22;
      return <Circle x={first.x} y={first.y} radius={near ? 12 : 7} stroke={near ? '#0e7490' : '#94a3b8'} strokeWidth={2} listening={false} />;
    })()
    : null;

  return (
    <Fragment>
      {scene.diagnostics.length > 0 ? <p className="bad-text">Часть плана не удалось показать.</p> : null}
      <div
      className={props.snapshot.dimension.invalid ? 'plan bad' : 'plan'}
      style={{ cursor: canvas.cursor, overflow: 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerMoveCapture={(event) => {
        const pending = pendingDrag.current;
        if (pending && pending.pointerId === event.pointerId) {
          if (!pending.started && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 3) return;
          if (!pending.started) {
            pending.started = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        props.dispatch({
          type: 'pointerMoved',
          position: viewport.toWorld({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }),
        });
      }}
      onPointerUpCapture={(event) => {
        if (pendingDrag.current?.started) {
          suppressClick.current = true;
          window.setTimeout(() => { suppressClick.current = false; }, 0);
        }
        props.dispatch({ type: 'pointerReleased' });
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        pendingDrag.current = null;
      }}
      onPointerCancel={() => {
        pendingDrag.current = null;
        props.dispatch({ type: 'pointerCancelled' });
      }}
      >
        <Stage
        width={WIDTH}
        height={HEIGHT}
        onMouseLeave={() => props.dispatch({ type: 'pointerLeft' })}
        onClick={(event) => {
          if (event.target === event.target.getStage()) {
            props.dispatch({ type: 'canvasClicked', event: { position: pointerPosition(event.target.getStage()!), target: { kind: 'canvas' } } });
          }
        }}
        onContextMenu={(event) => {
          if (event.target === event.target.getStage()) event.cancelBubble = true;
        }}
      >
        <Layer>
          <Rect width={WIDTH} height={HEIGHT} fill="#fff" listening={false} />
          {canvas.snap && verticalGrid}
          {canvas.snap && horizontalGrid}
          <PlanSceneLayer scene={scene} viewport={viewport} events={sceneEvents} />
          {closeIndicator}
        </Layer>
        </Stage>
      </div>
    </Fragment>
  );
}
