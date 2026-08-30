import { useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Layer, Line, Stage, Text } from 'react-konva';
import type { Floor, SceneObject, Zone } from '@houseplan/shared';
import {
  bodyPolygon,
  clearancePolygon,
  conflictObjectIds,
  openingSegment,
  roomAt,
} from '@houseplan/shared';
import { createViewport } from './editor/roomCanvas/viewport';

const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 560;
const STAGE_PADDING = 60;

const ZONE_COLORS: Record<string, string> = {
  stairs: '#7c3aed',
  builtInWardrobe: '#0d9488',
  fireplace: '#ea580c',
  decorativeWall: '#db2777',
  partition: '#dc2626',
  other: '#ca8a04',
};

function withAlpha(color: string, alpha: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return color;
  const [, red, green, blue] = match;
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${alpha})`;
}

/**
 * План этажа с расстановкой: объекты перетаскиваются мышью, при выборе —
 * поворот и возврат на склад. Допуски подсвечиваются при конфликте.
 */
export function FloorView({
  floor,
  objects,
  projectedZones,
  highlight,
  onChangeFloor,
}: {
  floor: Floor;
  objects: SceneObject[];
  projectedZones?: Zone[];
  /** объекты, помеченные сравнением вариантов (переехали или добавлены) */
  highlight?: Set<number>;
  onChangeFloor: (floor: Floor) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const dragRef = useRef<{ objectId: number; dx: number; dy: number } | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  const zones = [...floor.rooms.flatMap((room) => room.zones), ...(projectedZones ?? [])];
  const conflicts = conflictObjectIds(objects, floor, zones);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const placements = floor.rooms.flatMap((room) =>
    room.placements.map((placement) => ({ ...placement, roomName: room.name })),
  );
  const contourEntries = [
    { contour: floor.shell.contour, openings: floor.shell.openings, shell: true },
    ...floor.rooms.map((room) => ({
      contour: room.contour,
      openings: room.openings,
      shell: false,
    })),
  ].filter(({ contour }) => contour.closed && contour.points.length >= 3);
  const bodyPoints = floor.rooms.flatMap((room) =>
    room.placements.flatMap((placement) => {
      const object = byId.get(placement.objectId);
      return object ? bodyPolygon(object, placement) : [];
    }),
  );
  const planPoints = [
    ...contourEntries.flatMap(({ contour }) => contour.points),
    ...bodyPoints,
  ];

  if (planPoints.length === 0) return <p className="muted">Этаж пуст.</p>;

  const viewport = createViewport(planPoints, {
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    padding: STAGE_PADDING,
  });

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
    const targetRoom = roomAt(floor, x, y);
    const current = floor.rooms.find((room) =>
      room.placements.some((placement) => placement.objectId === objectId),
    );
    const roomId = targetRoom ?? current?.id;
    if (roomId === undefined) return;
    const rotation =
      current?.placements.find((placement) => placement.objectId === objectId)?.rotationDeg ?? 0;
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((room) => {
        const without = room.placements.filter((placement) => placement.objectId !== objectId);
        if (room.id === roomId) {
          return {
            ...room,
            placements: [
              ...without,
              {
                objectId,
                roomId,
                x: Math.round(x),
                y: Math.round(y),
                rotationDeg: rotation,
              },
            ],
          };
        }
        return { ...room, placements: without };
      }),
    });
  }

  function rotateSelected(delta: number) {
    if (selected === null) return;
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((room) => ({
        ...room,
        placements: room.placements.map((placement) =>
          placement.objectId === selected
            ? {
                ...placement,
                rotationDeg: ((placement.rotationDeg + delta) % 360 + 360) % 360,
              }
            : placement,
        ),
      })),
    });
  }

  function removeFromPlan() {
    if (selected === null) return;
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((room) => ({
        ...room,
        placements: room.placements.filter((placement) => placement.objectId !== selected),
      })),
    });
    setSelected(null);
  }

  function startObjectDrag(
    event: Konva.KonvaEventObject<MouseEvent>,
    objectId: number,
    x: number,
    y: number,
  ) {
    const point = pointerInPlan();
    if (!point) return;
    dragRef.current = { objectId, dx: point.x - x, dy: point.y - y };
    setSelected(objectId);
    event.cancelBubble = true;
  }

  function dropObject(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const objectId = Number(event.dataTransfer.getData('text/objectid'));
    if (!objectId) return;
    const point = clientPointInPlan(event);
    if (!point) return;
    const roomId = roomAt(floor, point.x, point.y);
    if (roomId === null) return;
    onChangeFloor({
      ...floor,
      rooms: floor.rooms.map((room) =>
        room.id === roomId
          ? {
              ...room,
              placements: [
                ...room.placements.filter((placement) => placement.objectId !== objectId),
                {
                  objectId,
                  roomId,
                  x: Math.round(point.x),
                  y: Math.round(point.y),
                  rotationDeg: 0,
                },
              ],
            }
          : {
              ...room,
              placements: room.placements.filter(
                (placement) => placement.objectId !== objectId,
              ),
            },
      ),
    });
  }

  return (
    <div style={{ flex: '1 1 600px', minWidth: 0 }}>
      {selected !== null ? (
        <div className="row">
          <span className="muted">
            Выбрано: <b>{byId.get(selected)?.name ?? '?'}</b>
            {conflicts.has(selected) ? (
              <b className="bad-text"> · допуск пересекает чужое тело или зону</b>
            ) : null}
          </span>
          <button onClick={() => rotateSelected(-15)}>⟲ −15°</button>
          <button onClick={() => rotateSelected(15)}>⟳ +15°</button>
          <button onClick={removeFromPlan}>Убрать на склад</button>
        </div>
      ) : null}
      <div
        style={{ maxWidth: '100%', overflow: 'auto' }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropObject}
      >
        <Stage
          ref={stageRef}
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          className="plan"
          onMouseMove={() => {
            const point = pointerInPlan();
            const drag = dragRef.current;
            if (point && drag) {
              movePlacement(drag.objectId, point.x - drag.dx, point.y - drag.dy);
            }
          }}
          onMouseUp={() => {
            dragRef.current = null;
          }}
          onMouseLeave={() => {
            dragRef.current = null;
          }}
          onClick={() => setSelected(null)}
        >
          <Layer>
            {zones.map((zone, zoneIndex) => {
              const color = ZONE_COLORS[zone.kind] ?? '#ca8a04';
              const center = {
                x: zone.points.reduce((sum, point) => sum + point.x, 0) / zone.points.length,
                y: zone.points.reduce((sum, point) => sum + point.y, 0) / zone.points.length,
              };
              const label = viewport.toCanvas(center);
              return (
                <Group key={`${zone.id}-${zoneIndex}`}>
                  <Line
                    points={viewport.flatten(zone.points)}
                    closed
                    fill={withAlpha(color, 0.3)}
                    stroke={color}
                    strokeWidth={2}
                  />
                  <Text
                    x={label.x + 4}
                    y={label.y - 16}
                    text={zone.name}
                    fontSize={12}
                    fill={color}
                    fontStyle="bold"
                  />
                </Group>
              );
            })}

            {contourEntries.flatMap(({ contour, openings }) =>
              openings.map((opening) => {
                const segment = openingSegment(
                  contour.points,
                  opening.wallPointId,
                  opening.offsetCm,
                  opening.widthCm,
                );
                if (!segment) return null;
                return (
                  <Line
                    key={opening.id}
                    points={viewport.flatten([segment.start, segment.end])}
                    stroke={opening.kind === 'window' ? '#2563eb' : '#b45309'}
                    strokeWidth={7}
                    lineCap="butt"
                  />
                );
              }),
            )}

            {contourEntries.map(({ contour, shell }, index) => (
              <Line
                key={`${shell ? 'shell' : 'room'}-${index}`}
                points={viewport.flatten(contour.points)}
                closed
                stroke={shell ? '#334155' : '#94a3b8'}
                strokeWidth={2}
              />
            ))}

            {placements.map((placement) => {
              const object = byId.get(placement.objectId);
              if (!object) return null;
              const body = bodyPolygon(object, placement);
              const clearance = clearancePolygon(object, placement);
              const conflict = conflicts.has(placement.objectId);
              const isSelected = selected === placement.objectId;
              const isHighlighted = highlight?.has(placement.objectId) ?? false;
              const label = viewport.toCanvas(placement);
              return (
                <Group
                  key={placement.objectId}
                  onMouseDown={(event) =>
                    startObjectDrag(
                      event,
                      placement.objectId,
                      placement.x,
                      placement.y,
                    )
                  }
                  onClick={(event) => {
                    event.cancelBubble = true;
                  }}
                  onMouseEnter={(event) => {
                    const stage = event.currentTarget.getStage();
                    if (stage) stage.container().style.cursor = 'move';
                  }}
                  onMouseLeave={(event) => {
                    const stage = event.currentTarget.getStage();
                    if (stage) stage.container().style.cursor = 'default';
                  }}
                >
                  <Line
                    points={viewport.flatten(clearance)}
                    closed
                    fill={withAlpha(conflict ? '#dc2626' : '#2563eb', 0.14)}
                    stroke={conflict ? '#dc2626' : '#93c5fd'}
                    strokeWidth={1}
                    dash={[4, 3]}
                  />
                  <Line
                    points={viewport.flatten(body)}
                    closed
                    fill={withAlpha(object.color || '#0e7490', 0.75)}
                    stroke={isSelected ? '#16a34a' : isHighlighted ? '#dc2626' : '#0f172a'}
                    strokeWidth={isSelected ? 2.5 : isHighlighted ? 2.5 : 1}
                    dash={isHighlighted ? [6, 4] : undefined}
                  />
                  <Line
                    points={viewport.flatten([body[2], body[3]])}
                    stroke="#ffffff"
                    strokeWidth={3}
                  />
                  <Text
                    x={label.x - 70}
                    y={label.y - 6}
                    width={140}
                    text={object.name}
                    align="center"
                    fontSize={11}
                    fill="#0f172a"
                    fontStyle="bold"
                  />
                </Group>
              );
            })}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
