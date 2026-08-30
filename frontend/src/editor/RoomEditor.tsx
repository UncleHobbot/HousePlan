import type { RoomEditorProps } from './editorTypes';
import { useEditorSession } from './useEditorSession';
import { RoomCanvas } from './roomCanvas/RoomCanvas';
import { DimensionPanel } from './panels/DimensionPanel';
import { LocksPanel } from './panels/LocksPanel';
import { OpeningsPanel } from './panels/OpeningsPanel';
import { ZonesPanel } from './panels/ZonesPanel';

/**
 * Редактор помещения: рисование контура на глаз, прибивание размеров,
 * служебные зоны и простенки.
 *
 * Здесь только сборка экрана. Правила редактирования живут в
 * `useEditorSession`, рисование — в `RoomCanvas`, а боковые карточки —
 * в `panels/`.
 */
export function RoomEditor({ plan, allocateId, onChange, onDone }: RoomEditorProps) {
  const session = useEditorSession({ plan, allocateId, onChange });
  const contour = plan.contour;
  const zones = plan.kind === 'room' ? plan.zones : [];
  const floors = plan.kind === 'room' ? plan.floors : [];

  return (
    <div className="editor">
      <div className="row">
        <button onClick={onDone}>← Готово</button>
        <b>{plan.name}</b>
        <label className="muted">
          <input
            type="checkbox"
            checked={session.snap}
            onChange={(event) => session.setSnap(event.target.checked)}
          /> прилипание
        </label>
        <span className="spacer" />
        <span className="muted">
          точек: {contour.points.length} · контур: {contour.closed ? 'замкнут' : 'рисуется'}
          {session.crossingPairs.length > 0 && <b className="bad-text"> · пересекает сам себя!</b>}
          {session.hasDiagonals && <span> · есть диагональные стены</span>}
        </span>
      </div>
      <div className="row">
        <RoomCanvas
          contour={contour}
          zones={zones}
          openings={plan.openings}
          draft={session.zoneDraft}
          pointer={session.pointer}
          selection={session.selection}
          snap={session.snap}
          invalid={session.inputInvalid}
          cursor={session.zoneMode !== 'none' || session.openingMode !== null ? 'crosshair' : 'default'}
          crossedWalls={session.crossedWalls}
          onPointerMove={session.onPointerMove}
          onPointerLeave={session.onPointerLeave}
          onClick={session.onCanvasClick}
          onPointerDown={session.onCanvasPointerDown}
        />
      </div>
      {session.banner && <div className={`banner ${session.banner.kind}`}>{session.banner.text}</div>}
      <div className="row">
        <DimensionPanel
          selection={session.selection}
          description={session.selectionInfo.description}
          canPin={session.selectionInfo.canPin}
          value={session.inputValue}
          invalid={session.inputInvalid}
          solving={session.solving}
          onValueChange={session.setInputValue}
          onPin={session.pinDimension}
          onReset={session.resetSelection}
        />
        <LocksPanel contour={contour} onRemove={session.removeLock} />
        <OpeningsPanel
          shell={plan.kind === 'shell'}
          openings={plan.openings}
          availableKinds={plan.openingKinds}
          selectedKind={session.openingKind}
          placingKind={session.openingMode}
          onSelectedKindChange={session.setOpeningKind}
          onStartPlacing={session.startOpening}
          onCancelPlacing={session.cancelOpening}
          onChange={session.changeOpening}
          onDelete={session.deleteOpening}
        />
        {plan.kind === 'room' && (
          <ZonesPanel
            zones={zones}
            floors={floors}
            mode={session.zoneMode}
            draftPointCount={session.zoneDraft ? session.zoneDraft.points.length : null}
            selectedKind={session.zoneKind}
            onSelectedKindChange={session.setZoneKind}
            onStartPolygon={session.startPolygon}
            onStartPartition={session.startPartition}
            onCloseDraft={session.closeZoneDraft}
            onCancelDraft={session.cancelZoneDraft}
            onDelete={session.deleteZone}
            onChange={session.changeZone}
          />
        )}
      </div>
    </div>
  );
}
