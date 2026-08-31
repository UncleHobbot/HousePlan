import { Fragment } from 'react';
import { canSlide, lockedWalls, openingSegment, type Contour, type Opening, type Point, type Zone } from '@houseplan/shared';
import { Circle, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { GRID_CM } from '../editorConstants';
import { contourCentroid, wallThicknessBands, withAlpha, zoneStyle, openingStyle } from '../../planScene';
import type { CanvasPointerEvent, DimensionSelection, ZoneDraft } from '../editorTypes';
import { createViewport, type CanvasPoint } from './viewport';

const WIDTH = 960;
const HEIGHT = 560;

export interface RoomCanvasProps {
  contour: Contour;
  zones: Zone[];
  openings: Opening[];
  draft: ZoneDraft | null;
  pointer: { x: number; y: number } | null;
  selection: DimensionSelection;
  snap: boolean;
  invalid: boolean;
  cursor: string;
  crossedWalls: ReadonlySet<number>;
  onPointerMove: (position: { x: number; y: number }) => void;
  onPointerLeave: () => void;
  onClick: (event: CanvasPointerEvent) => void;
  onPointerDown: (event: CanvasPointerEvent) => void;
  onContextMenu: (event: CanvasPointerEvent) => void;
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
  const { contour, zones, openings, draft, pointer, selection } = props;
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
      className={props.invalid ? 'plan bad' : 'plan'}
      style={{ cursor: props.cursor, overflow: 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Stage
        width={WIDTH}
        height={HEIGHT}
        onMouseMove={(event) => props.onPointerMove(pointerPosition(event.target.getStage()!))}
        onMouseLeave={props.onPointerLeave}
        onClick={(event) => {
          if (event.target === event.target.getStage()) {
            props.onClick({ position: pointerPosition(event.target.getStage()!), target: { kind: 'canvas' } });
          }
        }}
        onContextMenu={(event) => {
          if (event.target === event.target.getStage()) {
            props.onContextMenu({ position: pointerPosition(event.target.getStage()!), target: { kind: 'canvas' } });
          }
        }}
        onMouseDown={(event) => {
          if (event.target === event.target.getStage()) {
            props.onPointerDown({ position: pointerPosition(event.target.getStage()!), target: { kind: 'canvas' } });
          }
        }}
      >
        <Layer>
          <Rect width={WIDTH} height={HEIGHT} fill="#fff" listening={false} />
          {props.snap && verticalGrid}
          {props.snap && horizontalGrid}

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
                      onMouseDown={semanticHandler({ kind: 'zoneVertex', zoneId: zone.id, pointId: point.id }, props.onPointerDown)}
                      onClick={semanticHandler({ kind: 'zoneVertex', zoneId: zone.id, pointId: point.id }, props.onClick)}
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
                stroke={props.crossedWalls.has(index) ? '#dc2626' : locked ? '#134e4a' : diagonal ? '#d97706' : '#64748b'}
                strokeWidth={locked ? 5 : 3}
                lineCap="round"
                dash={diagonal ? [8, 6] : undefined}
                hitStrokeWidth={20}
                onClick={semanticHandler({ kind: 'wall', wallIndex: index }, props.onClick)}
                onContextMenu={semanticHandler({ kind: 'wall', wallIndex: index }, props.onContextMenu)}
                onMouseDown={semanticHandler({ kind: 'wall', wallIndex: index }, props.onPointerDown)}
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
                  onMouseDown={semanticHandler({ kind: 'point', pointId: point.id }, props.onPointerDown)}
                  onClick={semanticHandler({ kind: 'point', pointId: point.id }, props.onClick)}
                  onContextMenu={semanticHandler({ kind: 'point', pointId: point.id }, props.onContextMenu)}
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
