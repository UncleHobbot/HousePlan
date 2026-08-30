import type { DimensionSelection } from '../editorTypes';

export function DimensionPanel({
  selection,
  description,
  canPin,
  value,
  invalid,
  solving,
  onValueChange,
  onPin,
  onReset,
}: {
  selection: DimensionSelection;
  description: string;
  canPin: boolean;
  value: string;
  invalid: boolean;
  solving: boolean;
  onValueChange: (value: string) => void;
  onPin: () => void;
  onReset: () => void;
}) {
  return (
    <div className="card grow">
      <h2>Прибить размер</h2>
      <p className="muted">{description}</p>
      <div className="row">
        <input
          type="number"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          disabled={!canPin || solving}
          className={invalid ? 'bad' : ''}
        />
        см
        <button className="primary" onClick={onPin} disabled={!canPin || solving}>
          {solving ? 'Пересчёт…' : 'Прибить'}
        </button>
        <button onClick={onReset} disabled={selection.aId === null} title="Сбросить выбор">✕</button>
      </div>
    </div>
  );
}
