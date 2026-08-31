import { lockLabel, type SizeLock } from '@houseplan/shared';
import type { EditorIntent } from '../editorSession';

export function LocksPanel({ locks, dispatch }: { locks: SizeLock[]; dispatch: (intent: EditorIntent) => unknown }) {
  return (
    <div className="card grow">
      <h2>Замки</h2>
      {locks.length === 0 ? <p className="muted">Ни один размер не прибит.</p> : (
        <ul className="locks">
          {locks.map((lock) => (
            <li key={`${lock.aId}-${lock.bId}`}>
              <span>{lockLabel(lock)}</span>
              <button onClick={() => dispatch({ type: 'lockRemoved', lock })}>снять</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
