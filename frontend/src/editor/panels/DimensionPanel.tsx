import type { EditorIntent, EditorSessionSnapshot } from '../editorSession';

function description(state: EditorSessionSnapshot['dimension']): string {
  const data = state.description.data ?? {};
  switch (state.description.code) {
    case 'dimension-selected':
      return `Участок А${data.aId} → А${data.bId}: сейчас ${data.length} см. Точка А${data.aId} останется на месте.`;
    case 'dimension-first-point-selected':
      return `Точка А выбрана: А${data.aId}. Теперь выберите точку Б.`;
    case 'dimension-selection-invalid':
      return String(data.reason ?? 'Этот участок нельзя прибить.');
    default:
      return 'Выберите две точки контура: сначала ту, что останется на месте, затем вторую.';
  }
}

export function DimensionPanel({
  state,
  selection,
  dispatch,
}: {
  state: EditorSessionSnapshot['dimension'];
  selection: EditorSessionSnapshot['canvas']['selection'];
  dispatch: (intent: EditorIntent) => unknown;
}) {
  return (
    <div className="card grow">
      <h2>Прибить размер</h2>
      <p className="muted">{description(state)}</p>
      <div className="row">
        <input
          type="number"
          value={state.value}
          onChange={(event) => dispatch({ type: 'dimensionValueChanged', value: event.target.value })}
          disabled={!state.canPin || state.solver === 'loading'}
          className={state.invalid ? 'bad' : ''}
        />
        см
        <button className="primary" onClick={() => dispatch({ type: 'dimensionPinRequested' })} disabled={!state.canPin || state.solver === 'loading'}>
          {state.solver === 'loading' ? 'Загрузка…' : 'Прибить'}
        </button>
        <button onClick={() => dispatch({ type: 'selectionReset' })} disabled={selection.aId === null} title="Сбросить выбор">✕</button>
      </div>
    </div>
  );
}
