import type { Opening, OpeningKind } from '@houseplan/shared';
import { OPENING_LABELS } from '../editorConstants';

export function OpeningsPanel({
  shell,
  openings,
  availableKinds,
  selectedKind,
  placingKind,
  onSelectedKindChange,
  onStartPlacing,
  onCancelPlacing,
  onChange,
  onDelete,
}: {
  shell: boolean;
  openings: Opening[];
  availableKinds: OpeningKind[];
  selectedKind: OpeningKind;
  placingKind: OpeningKind | null;
  onSelectedKindChange: (kind: OpeningKind) => void;
  onStartPlacing: () => void;
  onCancelPlacing: () => void;
  onChange: (opening: Opening) => void;
  onDelete: (openingId: number) => void;
}) {
  return (
    <div className="card grow">
      <h2>Проёмы</h2>
      {openings.length === 0 && placingKind === null && (
        <p className="muted">{shell ? 'Окон и входных дверей нет.' : 'Внутренних дверей нет.'}</p>
      )}
      <ul className="locks">
        {openings.map((opening) => (
          <li key={opening.id}>
            <span className="row">
              {OPENING_LABELS[opening.kind]}
              <input
                type="number"
                style={{ width: 70, minWidth: 70 }}
                value={opening.offsetCm}
                title="сантиметры от угла"
                onChange={(event) => onChange({ ...opening, offsetCm: Number(event.target.value) })}
              /> см
              <input
                type="number"
                style={{ width: 70, minWidth: 70 }}
                value={opening.widthCm}
                title="ширина проёма"
                onChange={(event) => onChange({ ...opening, widthCm: Number(event.target.value) })}
              /> шир.
              {opening.kind !== 'window' && (
                <select
                  value={opening.opensTo ?? 'left'}
                  title="сторона открывания"
                  onChange={(event) => onChange({ ...opening, opensTo: event.target.value as 'left' | 'right' })}
                >
                  <option value="left">←</option>
                  <option value="right">→</option>
                </select>
              )}
            </span>
            <button onClick={() => onDelete(opening.id)}>удалить</button>
          </li>
        ))}
      </ul>
      {placingKind === null && availableKinds.length > 0 ? (
        <div className="row">
          <select value={selectedKind} onChange={(event) => onSelectedKindChange(event.target.value as OpeningKind)}>
            {availableKinds.map((kind) => <option key={kind} value={kind}>{OPENING_LABELS[kind]}</option>)}
          </select>
          <button onClick={onStartPlacing}>Поставить проём</button>
        </div>
      ) : placingKind !== null ? (
        <button onClick={onCancelPlacing}>Отмена</button>
      ) : null}
    </div>
  );
}
