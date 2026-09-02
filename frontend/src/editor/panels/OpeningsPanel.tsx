import type { OpeningKind } from '@houseplan/shared';
import { CommitInput } from '../../CommitInput';
import type { EditorIntent, EditorSessionSnapshot } from '../editorSession';

const OPENING_LABELS: Record<OpeningKind, string> = {
  window: 'Окно',
  entryDoor: 'Входная дверь',
  innerDoor: 'Дверь',
};

export function OpeningsPanel({ state, dispatch }: { state: EditorSessionSnapshot; dispatch: (intent: EditorIntent) => unknown }) {
  const placing = state.tool.kind === 'opening';
  return (
    <div className="card grow">
      <h2>Проёмы</h2>
      {state.plan.openings.length === 0 && !placing && <p className="muted">Проёмов нет.</p>}
      <ul className="locks">
        {state.plan.openings.map((opening) => (
          <li key={opening.id}>
            <span className="row">
              {OPENING_LABELS[opening.kind]}
              <CommitInput type="number" style={{ width: 70, minWidth: 70 }} value={opening.offsetCm} title="сантиметры от угла" onCommit={(value) => dispatch({ type: 'openingChanged', opening: { ...opening, offsetCm: Number(value) } })} /> см
              <CommitInput type="number" style={{ width: 70, minWidth: 70 }} value={opening.widthCm} title="ширина проёма" onCommit={(value) => dispatch({ type: 'openingChanged', opening: { ...opening, widthCm: Number(value) } })} /> шир.
              {opening.kind !== 'window' && (
                <select value={opening.opensTo ?? 'left'} onChange={(event) => dispatch({ type: 'openingChanged', opening: { ...opening, opensTo: event.target.value as 'left' | 'right' } })}>
                  <option value="left">←</option><option value="right">→</option>
                </select>
              )}
            </span>
            <button onClick={() => dispatch({ type: 'openingDeleted', openingId: opening.id })}>удалить</button>
          </li>
        ))}
      </ul>
      {!placing ? (
        <div className="row">
          <select value={state.preferences.openingKind} onChange={(event) => dispatch({ type: 'openingKindSelected', kind: event.target.value as OpeningKind })}>
            {state.plan.openingKinds.map((kind) => <option key={kind} value={kind}>{OPENING_LABELS[kind]}</option>)}
          </select>
          <button onClick={() => dispatch({ type: 'toolSelected', tool: { kind: 'opening', openingKind: state.preferences.openingKind } })}>Поставить проём</button>
        </div>
      ) : <button onClick={() => dispatch({ type: 'toolCancelled' })}>Отмена</button>}
    </div>
  );
}
