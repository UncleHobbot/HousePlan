import { Fragment, useRef } from 'react';
import type Konva from 'konva';
import { canSlide, lockedWalls, openingSegment } from '@houseplan/shared';
import { Circle, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { GRID_CM } from '../editorConstants';
import { contourCentroid, wallThicknessBands, withAlpha, zoneStyle, openingStyle } from '../../planScene';
import type { CanvasPointerEvent } from '../editorTypes';
import type { EditorDispatchResult, EditorIntent, EditorSessionSnapshot } from '../editorSession';
import { createViewport, type CanvasPoint } from './viewport';

const WIDTH = 960;
const HEIGHT = 560;

export interface RoomCanvasProps {
  snapshot: EditorSessionSnapshot;
  dispatch: (intent: EditorIntent) => EditorDispatchResult;
}

function doorArc(
  hinge: CanvasPoint,
  other: CanvasPoint,
  centroid: CanvasPoint,
  width: number,
): CanvasPoint[] {
  let dx = other.x - hinge.x;
  let dy = other.y - hinge.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  let nx = -dy;
  let ny = dx;
  if (nx * (centroid.x - hinge.x) + ny * (centroid.y - hinge.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const start = Math.atan2(dy, dx);
  let end = Math.atan2(ny, nx);
  while (end - start > Math.PI) end -= Math.PI * 2;
  while (end - start < -Math.PI) end += Math.PI * 2;
  return Array.from({ length: 13 }, (_, index) => {
    const angle = start + ((end - start) * index) / 12;
    return { x: hinge.x + Math.cos(angle) * width, y: hinge.y + Math.sin(angle) * width };
  });
}

export function RoomCanvas(props: RoomCanvasProps) {
  const pendingDrag = useRef<{ pointerId: number; x: number; y: number; started: boolean } | null>(null);
  const suppressClick = useRef(false);
  const { plan, canvas, tool } = props.snapshot;
  const contour = plan.contour;
  const zones = plan.kind === 'room' ? plan.zones : [];
  const openings = plan.openings;
  const draft = tool.kind === 'polygonZone' || tool.kind === 'partition' ? tool.draft : null;
  const { pointer, selection } = canvas;
  const points = contour.points;
  const viewportPoints = [...points, ...zones.flatMap((zone) => zone.points), ...(draft?.points ?? [])];
  const viewport = createViewport(viewportPoints, {
    width: WIDTH,
    height: HEIGHT,
    padding: 60,
    worldBounds: { minX: 0, minY: 0, maxX: 600, maxY: 440 },
  });
  const busyWalls = lockedWalls(contour);
  const centroid = contourCentroid(points);

  function pointerPosition(stage: { getPointerPosition(): { x: number; y: number } | null }) {
    const position = stage.getPointerPosition();
    return viewport.toWorld(position ?? { x: 0, y: 0 });
  }

  function semanticHandler(
    target: CanvasPointerEvent['target'],
    handler: (event: CanvasPointerEvent) => void,
  ) {
    return (event: { target: { getStage(): { getPointerPosition(): { x: number; y: number } | null } | null }; cancelBubble: boolean }) => {
      const stage = event.target.getStage();
      if (!stage) return;
      event.cancelBubble = true;
      handler({ position: pointerPosition(stage), target });
    };
  }

  function dragHandler(target: Extract<CanvasPointerEvent['target'], { kind: 'point' | 'zoneVertex' }>) {
    return (event: Konva.KonvaEventObject<PointerEvent>) => {
      const stage = event.target.getStage();
      if (!stage) return;
      event.cancelBubble = true;
      const result = props.dispatch({
        type: 'pointerPressed',
        event: { position: pointerPosition(stage), target },
      });
      if (result.ok) {
        pendingDrag.current = { pointerId: event.evt.pointerId, x: event.evt.clientX, y: event.evt.clientY, started: false };
      }
    };
  }

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

  return (
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
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
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
          if (event.target === event.target.getStage()) {
            event.cancelBubble = true;
          }
        }}
      >
        <Layer>
          <Rect width={WIDTH} height={HEIGHT} fill="#fff" listening={false} />
          {canvas.snap && verticalGrid}
          {canvas.snap && horizontalGrid}

          {zones.map((zone) => {
            const color = zoneStyle(zone.kind).color;
            const center = contourCentroid(zone.points);
            const label = viewport.toCanvas(center);
            return (
              <Fragment key={zone.id}>
                <Line points={viewport.flatten(zone.points)} closed fill={color} opacity={0.3} stroke={color} strokeWidth={2} />
                <Text x={label.x + 4} y={label.y - 16} text={`${zone.name}${zone.spansFloors ? ' ⭥' : ''}`} fontSize={12} fill={color} fontStyle="bold" listening={false} />
                {zone.points.map((point) => {
                  const canvas = viewport.toCanvas(point);
                  return (
                    <Circle
                      key={point.id}
                      x={canvas.x}
                      y={canvas.y}
                      radius={4}
                      fill="#fff"
                      stroke={color}
                      strokeWidth={2}
                      onPointerDown={tool.kind === 'select'
                        ? dragHandler({ kind: 'zoneVertex', zoneId: zone.id, pointId: point.id })
                        : undefined}
                      onClick={semanticHandler({ kind: 'zoneVertex', zoneId: zone.id, pointId: point.id }, (event) => props.dispatch({ type: 'canvasClicked', event }))}
                    />
                  );
                })}
              </Fragment>
            );
          })}

          {draft && (
            <>
              {draft.points.length > 1 && <Line points={viewport.flatten(draft.points)} stroke="#0e7490" strokeWidth={2} />}
              {draft.points.map((point) => {
                const canvas = viewport.toCanvas(point);
                return <Circle key={point.id} x={canvas.x} y={canvas.y} radius={4} fill="#fff" stroke="#0e7490" strokeWidth={2} listening={false} />;
              })}
              {pointer && draft.points.length > 0 && (
                <Line points={viewport.flatten([draft.points.at(-1)!, pointer])} stroke="#0e7490" dash={[4, 5]} listening={false} />
              )}
            </>
          )}

          {wallThicknessBands(contour).map((band, index) => (
            <Line
              key={`thickness-${index}`}
              points={viewport.flatten(band)}
              closed fill="#94a3b8" opacity={0.34} listening={false}
            />
          ))}

          {points.map((point, index) => {
            if (!contour.closed && index === points.length - 1) return null;
            const next = points[(index + 1) % points.length];
            const diagonal = point.x !== next.x && point.y !== next.y;
            const locked = busyWalls.has(index);
            return (
              <Line
                key={`wall-${point.id}`}
                points={viewport.flatten([point, next])}
                stroke={canvas.crossedWalls.includes(index) ? '#dc2626' : locked ? '#134e4a' : diagonal ? '#d97706' : '#64748b'}
                strokeWidth={locked ? 5 : 3}
                lineCap="round"
                dash={diagonal ? [8, 6] : undefined}
                hitStrokeWidth={20}
                onClick={semanticHandler({ kind: 'wall', wallIndex: index }, (event) => props.dispatch({ type: 'canvasClicked', event }))}
                onContextMenu={semanticHandler({ kind: 'wall', wallIndex: index }, () => props.dispatch({ type: 'deleteRequested', pointId: point.id }))}
              />
            );
          })}

          {contour.closed && points.map((point, index) => {
            const next = points[(index + 1) % points.length];
            const position = viewport.toCanvas({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 });
            const locked = busyWalls.has(index);
            return (
              <Text key={`length-${point.id}`} x={position.x + 6} y={position.y - 19} text={`${Math.round(Math.hypot(next.x - point.x, next.y - point.y))}${locked ? ' 🔒' : ''}`} fontSize={13} fontStyle={locked ? 'bold' : 'normal'} fill={locked ? '#134e4a' : '#64748b'} listening={false} />
            );
          })}

          {contour.closed && openings.map((opening) => {
            const segment = openingSegment(points, opening.wallPointId, opening.offsetCm, opening.widthCm);
            if (!segment) return null;
            const color = openingStyle(opening.kind).color;
            const hinge = opening.opensTo === 'left' ? segment.start : segment.end;
            const other = opening.opensTo === 'left' ? segment.end : segment.start;
            const leafPoints = [hinge, other, ...doorArc(hinge, other, centroid, opening.widthCm)];
            return (
              <Fragment key={opening.id}>
                <Line points={viewport.flatten([segment.start, segment.end])} stroke={color} strokeWidth={7} />
                {opening.kind !== 'window' && <Line points={viewport.flatten(leafPoints)} stroke={color} strokeWidth={1.5} listening={false} />}
              </Fragment>
            );
          })}

          {!contour.closed && points.length > 0 && pointer && (
            <>
              <Line points={viewport.flatten([points.at(-1)!, pointer])} stroke="#94a3b8" dash={[4, 5]} listening={false} />
              {points.length >= 3 && (() => {
                const first = viewport.toCanvas(points[0]);
                const current = viewport.toCanvas(pointer);
                const near = Math.hypot(first.x - current.x, first.y - current.y) < 22;
                return <Circle x={first.x} y={first.y} radius={near ? 12 : 7} stroke={near ? '#0e7490' : '#94a3b8'} strokeWidth={2} listening={false} />;
              })()}
            </>
          )}

          {points.map((point) => {
            const canvas = viewport.toCanvas(point);
            const movable = canSlide(contour, point.id).ok;
            const fill = point.id === selection.aId ? '#16a34a' : point.id === selection.bId ? '#2563eb' : movable ? '#fff' : '#e2e8f0';
            return (
              <Fragment key={point.id}>
                <Circle
                  x={canvas.x}
                  y={canvas.y}
                  radius={7}
                  fill={fill}
                  stroke="#334155"
                  strokeWidth={2}
                  hitStrokeWidth={12}
                  onPointerDown={tool.kind === 'select' && movable
                    ? dragHandler({ kind: 'point', pointId: point.id })
                    : undefined}
                  onClick={semanticHandler({ kind: 'point', pointId: point.id }, (event) => props.dispatch({ type: 'canvasClicked', event }))}
                  onContextMenu={semanticHandler({ kind: 'point', pointId: point.id }, () => props.dispatch({ type: 'deleteRequested', pointId: point.id }))}
                />
                <Text x={canvas.x + 10} y={canvas.y - 22} text={`А${point.id}`} fontSize={13} fontStyle="bold" fill="#0f172a" listening={false} />
              </Fragment>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
