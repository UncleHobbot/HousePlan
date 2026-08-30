import { lockLabel, type Contour, type SizeLock } from '@houseplan/shared';

export function LocksPanel({ contour, onRemove }: { contour: Contour; onRemove: (lock: SizeLock) => void }) {
  return (
    <div className="card grow">
      <h2>Замки</h2>
      {contour.locks.length === 0 ? (
        <p className="muted">Ни один размер не прибит.</p>
      ) : (
        <ul className="locks">
          {contour.locks.map((lock) => (
            <li key={`${lock.aId}-${lock.bId}`}>
              <span>{lockLabel(lock)}</span>
              <button onClick={() => onRemove(lock)}>снять</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
