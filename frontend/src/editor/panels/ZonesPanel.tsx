import { ZONE_KIND_LABELS, type Floor, type Zone, type ZoneKind } from '@houseplan/shared';

export function ZonesPanel({
  zones,
  floors,
  mode,
  draftPointCount,
  selectedKind,
  onSelectedKindChange,
  onStartPolygon,
  onStartPartition,
  onCloseDraft,
  onCancelDraft,
  onDelete,
  onChange,
}: {
  zones: Zone[];
  floors: Floor[];
  mode: 'none' | 'polygon' | 'partition';
  draftPointCount: number | null;
  selectedKind: ZoneKind;
  onSelectedKindChange: (kind: ZoneKind) => void;
  onStartPolygon: () => void;
  onStartPartition: () => void;
  onCloseDraft: () => void;
  onCancelDraft: () => void;
  onDelete: (zoneId: number) => void;
  onChange: (zone: Zone) => void;
}) {
  return (
    <div className="card grow">
      <h2>Служебные зоны</h2>
      {zones.length === 0 && mode === 'none' && draftPointCount === null && (
        <p className="muted">Зон нет. Выберите тип и нарисуйте.</p>
      )}
      <ul className="locks">
        {zones.map((zone) => (
          <li key={zone.id}>
            <span>
              {zone.name} ({ZONE_KIND_LABELS[zone.kind]})
              {zone.spansFloors
                ? ` · сквозная: ${floors.find((floor) => floor.id === zone.spansFloors!.fromFloorId)?.name ?? '?'}…${floors.find((floor) => floor.id === zone.spansFloors!.toFloorId)?.name ?? '?'}`
                : ''}
            </span>
            <button onClick={() => onDelete(zone.id)}>удалить</button>
          </li>
        ))}
      </ul>
      {mode === 'none' && draftPointCount === null && (
        <div className="row">
          <select value={selectedKind} onChange={(event) => onSelectedKindChange(event.target.value as ZoneKind)}>
            {Object.entries(ZONE_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select>
          <button onClick={onStartPolygon}>+ Зона</button>
          <button onClick={onStartPartition}>+ Простенок</button>
        </div>
      )}
      {mode !== 'none' && draftPointCount !== null && (
        <div className="row">
          {mode === 'polygon' && (
            <button className="primary" onClick={onCloseDraft} disabled={draftPointCount < 3}>Замкнуть</button>
          )}
          <button onClick={onCancelDraft}>Отмена</button>
        </div>
      )}
      {zones.filter((zone) => zone.kind === 'stairs').map((zone) => (
        <div className="row" key={zone.id}>
          <span className="muted">{zone.name}: сквозная</span>
          <select
            value={zone.spansFloors?.fromFloorId ?? ''}
            onChange={(event) => {
              if (event.target.value === '') return onChange({ ...zone, spansFloors: undefined });
              const fromFloorId = Number(event.target.value);
              onChange({ ...zone, spansFloors: { fromFloorId, toFloorId: zone.spansFloors?.toFloorId ?? fromFloorId } });
            }}
          >
            <option value="">— нет —</option>
            {floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
          </select>
          …
          <select
            value={zone.spansFloors?.toFloorId ?? ''}
            onChange={(event) => {
              const toFloorId = Number(event.target.value);
              onChange({ ...zone, spansFloors: { fromFloorId: zone.spansFloors?.fromFloorId ?? toFloorId, toFloorId } });
            }}
            disabled={!zone.spansFloors}
          >
            {floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
