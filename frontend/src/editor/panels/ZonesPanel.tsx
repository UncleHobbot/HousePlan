import { ZONE_KIND_LABELS, type ZoneKind } from '@houseplan/shared';
import type { EditorIntent, EditorSessionSnapshot } from '../editorSession';

export function ZonesPanel({ state, dispatch }: { state: EditorSessionSnapshot; dispatch: (intent: EditorIntent) => unknown }) {
  if (state.plan.kind !== 'room') return null;
  const roomPlan = state.plan;
  const drawing = state.tool.kind === 'polygonZone' || state.tool.kind === 'partition';
  const draftCount = drawing ? state.tool.draft?.points.length ?? null : null;
  return (
    <div className="card grow">
      <h2>Служебные зоны</h2>
      {roomPlan.zones.length === 0 && !drawing && <p className="muted">Зон нет. Выберите тип и нарисуйте.</p>}
      <ul className="locks">
        {roomPlan.zones.map((zone) => (
          <li key={zone.id}>
            <span>{zone.name} ({ZONE_KIND_LABELS[zone.kind]})</span>
            <button onClick={() => dispatch({ type: 'zoneDeleted', zoneId: zone.id })}>удалить</button>
          </li>
        ))}
      </ul>
      {!drawing ? (
        <div className="row">
          <select value={state.preferences.zoneKind} onChange={(event) => dispatch({ type: 'zoneKindSelected', kind: event.target.value as ZoneKind })}>
            {Object.entries(ZONE_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select>
          <button onClick={() => dispatch({ type: 'toolSelected', tool: { kind: 'polygonZone', zoneKind: state.preferences.zoneKind, zoneName: ZONE_KIND_LABELS[state.preferences.zoneKind] } })}>+ Зона</button>
          <button onClick={() => {
            const kind = state.preferences.zoneKind === 'decorativeWall' ? 'decorativeWall' : 'partition';
            dispatch({ type: 'toolSelected', tool: { kind: 'partition', zoneKind: kind, zoneName: ZONE_KIND_LABELS[kind] } });
          }}>+ Простенок</button>
        </div>
      ) : (
        <div className="row">
          {state.tool.kind === 'polygonZone' && <button className="primary" onClick={() => dispatch({ type: 'zoneFinished' })} disabled={(draftCount ?? 0) < 3}>Замкнуть</button>}
          <button onClick={() => dispatch({ type: 'toolCancelled' })}>Отмена</button>
        </div>
      )}
      {roomPlan.zones.filter((zone) => zone.kind === 'stairs').map((zone) => (
        <div className="row" key={zone.id}>
          <span className="muted">{zone.name}: сквозная</span>
          <select value={zone.spansFloors?.fromFloorId ?? ''} onChange={(event) => {
            if (event.target.value === '') dispatch({ type: 'zoneChanged', zone: { ...zone, spansFloors: undefined } });
            else {
              const fromFloorId = Number(event.target.value);
              dispatch({ type: 'zoneChanged', zone: { ...zone, spansFloors: { fromFloorId, toFloorId: zone.spansFloors?.toFloorId ?? fromFloorId } } });
            }
          }}>
            <option value="">— нет —</option>
            {roomPlan.floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
          </select>
          …
          <select value={zone.spansFloors?.toFloorId ?? ''} disabled={!zone.spansFloors} onChange={(event) => {
            const toFloorId = Number(event.target.value);
            dispatch({ type: 'zoneChanged', zone: { ...zone, spansFloors: { fromFloorId: zone.spansFloors?.fromFloorId ?? toFloorId, toFloorId } } });
          }}>
            {roomPlan.floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
