import type Konva from 'konva';
import { Circle, Line, Text } from 'react-konva';
import type { ZoneKind } from '@houseplan/shared';
import type { Viewport } from '../editor/roomCanvas/viewport';
import type { PlanScene, SceneLabelMark, SceneMark, ScenePathMark, SceneTarget } from './index';

const ZONE_COLORS: Record<ZoneKind, string> = {
  stairs: '#7c3aed',
  builtInWardrobe: '#0d9488',
  fireplace: '#ea580c',
  decorativeWall: '#db2777',
  partition: '#dc2626',
  other: '#ca8a04',
};

type SceneEvent = Konva.KonvaEventObject<MouseEvent | PointerEvent>;

export interface PlanSceneEvents {
  onClick?: (event: SceneEvent, target: SceneTarget) => void;
  onMouseDown?: (event: SceneEvent, target: SceneTarget) => void;
  onPointerDown?: (event: SceneEvent, target: SceneTarget) => void;
  onContextMenu?: (event: SceneEvent, target: SceneTarget) => void;
  onMouseEnter?: (event: SceneEvent, target: SceneTarget) => void;
  onMouseLeave?: (event: SceneEvent, target: SceneTarget) => void;
}

export interface PlanSceneLayerProps {
  scene: PlanScene;
  viewport: Viewport;
  events?: PlanSceneEvents;
}

function withAlpha(color: string, alpha: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return color;
  const [, red, green, blue] = match;
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${alpha})`;
}

function targetEvents(mark: SceneMark, events: PlanSceneEvents | undefined) {
  if (!mark.target) return { listening: false as const };
  const dispatch = (handler: ((event: SceneEvent, target: SceneTarget) => void) | undefined) => (
    (event: SceneEvent) => {
      event.cancelBubble = true;
      handler?.(event, mark.target!);
    }
  );
  return {
    listening: true as const,
    onClick: dispatch(events?.onClick),
    onMouseDown: dispatch(events?.onMouseDown),
    onPointerDown: dispatch(events?.onPointerDown),
    onContextMenu: dispatch(events?.onContextMenu),
    onMouseEnter: dispatch(events?.onMouseEnter),
    onMouseLeave: dispatch(events?.onMouseLeave),
  };
}

function pathStyle(mark: ScenePathMark) {
  const selected = mark.states?.includes('selected') ?? false;
  const comparison = mark.states?.includes('comparison') ?? false;
  switch (mark.role) {
    case 'zone': {
      const color = ZONE_COLORS[mark.zoneKind ?? 'other'];
      return { fill: withAlpha(color, 0.3), stroke: color, strokeWidth: 2 };
    }
    case 'wall-thickness': return { fill: withAlpha('#94a3b8', 0.34) };
    case 'shell-wall': return { stroke: '#334155', strokeWidth: 2 };
    case 'room-wall': return { stroke: '#94a3b8', strokeWidth: 2 };
    case 'wall': return { stroke: '#64748b', strokeWidth: 3, lineCap: 'round' as const, hitStrokeWidth: 20 };
    case 'wall-locked': return { stroke: '#134e4a', strokeWidth: 5, lineCap: 'round' as const, hitStrokeWidth: 20 };
    case 'wall-crossed': return { stroke: '#dc2626', strokeWidth: 3, lineCap: 'round' as const, hitStrokeWidth: 20 };
    case 'wall-diagonal': return { stroke: '#d97706', strokeWidth: 3, lineCap: 'round' as const, hitStrokeWidth: 20, dash: [8, 6] };
    case 'window': return { stroke: '#2563eb', strokeWidth: 7, lineCap: 'butt' as const };
    case 'door': return { stroke: '#b45309', strokeWidth: 7, lineCap: 'butt' as const };
    case 'door-swing': return { stroke: '#b45309', strokeWidth: 1.5 };
    case 'clearance': return { fill: withAlpha('#2563eb', 0.14), stroke: '#93c5fd', strokeWidth: 1, dash: [4, 3] };
    case 'clearance-conflict': return { fill: withAlpha('#dc2626', 0.14), stroke: '#dc2626', strokeWidth: 1, dash: [4, 3] };
    case 'object': return {
      fill: withAlpha(mark.tint ?? '#0e7490', 0.75),
      stroke: selected ? '#16a34a' : comparison ? '#dc2626' : '#0f172a',
      strokeWidth: selected || comparison ? 2.5 : 1,
      dash: comparison ? [6, 4] : undefined,
    };
    case 'object-front': return { stroke: '#ffffff', strokeWidth: 3 };
    case 'draft': return { stroke: '#0e7490', strokeWidth: 2 };
    case 'draft-preview': return { stroke: '#0e7490', dash: [4, 5] };
    case 'contour-preview': return { stroke: '#94a3b8', dash: [4, 5] };
    default: return {};
  }
}

function labelStyle(mark: SceneLabelMark) {
  if (mark.role === 'zone-label') {
    return { xOffset: 4, yOffset: -16, fontSize: 12, fill: ZONE_COLORS[mark.zoneKind ?? 'other'], fontStyle: 'bold' };
  }
  if (mark.role === 'object-label') {
    return { xOffset: -70, yOffset: -6, width: 140, align: 'center' as const, fontSize: 11, fill: '#0f172a', fontStyle: 'bold' };
  }
  if (mark.role === 'wall-length') {
    const locked = mark.states?.includes('locked') ?? false;
    return { xOffset: 6, yOffset: -19, fontSize: 13, fill: locked ? '#134e4a' : '#64748b', fontStyle: locked ? 'bold' : 'normal' };
  }
  return { xOffset: 10, yOffset: -22, fontSize: 13, fill: '#0f172a', fontStyle: 'bold' };
}

export function PlanSceneLayer({ scene, viewport, events }: PlanSceneLayerProps) {
  return scene.marks.map((mark) => {
    const handlers = targetEvents(mark, events);
    if (mark.kind === 'path') {
      return (
        <Line
          key={mark.key}
          points={viewport.flatten(mark.points)}
          closed={mark.closed}
          {...pathStyle(mark)}
          {...handlers}
        />
      );
    }
    const canvas = viewport.toCanvas(mark.at);
    if (mark.kind === 'label') {
      const style = labelStyle(mark);
      return (
        <Text
          key={mark.key}
          x={canvas.x + style.xOffset}
          y={canvas.y + style.yOffset}
          width={style.width}
          align={style.align}
          text={mark.text}
          fontSize={style.fontSize}
          fill={style.fill}
          fontStyle={style.fontStyle}
          {...handlers}
        />
      );
    }
    const movable = mark.states?.includes('movable') ?? false;
    const fill = mark.role === 'zone-point'
      ? '#fff'
      : mark.states?.includes('selected-a')
        ? '#16a34a'
        : mark.states?.includes('selected-b')
          ? '#2563eb'
          : movable
            ? '#fff'
            : mark.role === 'draft-point'
              ? '#fff'
              : '#e2e8f0';
    const stroke = mark.role === 'zone-point'
      ? ZONE_COLORS[mark.zoneKind ?? 'other']
      : mark.role === 'draft-point' ? '#0e7490' : '#334155';
    return (
      <Circle
        key={mark.key}
        x={canvas.x}
        y={canvas.y}
        radius={mark.role === 'point' ? 7 : 4}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
        hitStrokeWidth={mark.role === 'point' ? 12 : undefined}
        {...handlers}
      />
    );
  });
}
