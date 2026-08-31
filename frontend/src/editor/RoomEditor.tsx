import { useEffect } from 'react';
import type { EditorIntent } from './editorSession';
import type { RoomEditorProps } from './editorTypes';
import { useEditorSession } from './useEditorSession';
import { RoomCanvas } from './roomCanvas/RoomCanvas';
import { DimensionPanel } from './panels/DimensionPanel';
import { LocksPanel } from './panels/LocksPanel';
import { OpeningsPanel } from './panels/OpeningsPanel';
import { ZonesPanel } from './panels/ZonesPanel';

/** React-раскладка глубокого editor-session: только отображение и browser-confirm. */
export function RoomEditor({ plan, revision, onCommit, onDone }: RoomEditorProps) {
  const session = useEditorSession({ plan, revision, onCommit });
  const state = session.snapshot;
  const contour = state.plan.contour;

  function dispatch(intent: EditorIntent) {
    const result = session.dispatch(intent);
    if (!result.ok && 'confirmation' in result && result.confirmation.kind === 'delete-point') {
      const data = result.confirmation.data;
      const extra = Number(data.lockCount) + Number(data.openingCount) > 0
        ? ` Вместе с ней удалятся замки: ${data.lockCount}, проёмы: ${data.openingCount}.`
        : '';
      if (window.confirm(`Удалить точку А${data.pointId}? Две соседние стены сольются в одну.${extra}`)) {
        return session.dispatch({ type: 'deleteConfirmed', pointId: Number(data.pointId) });
      }
    }
    return result;
  }

  function finish() {
    const result = session.dispatch({ type: 'exitRequested' });
    if (!result.ok && 'confirmation' in result) {
      if (!window.confirm('Отменить незавершённое действие и выйти из редактора?')) return;
      session.dispatch({ type: 'draftDiscarded' });
    }
    onDone();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      session.dispatch({ type: 'pointerCancelled' });
      session.dispatch({ type: 'toolCancelled' });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const hasDiagonals = contour.points.some((point, index) => {
    if (index === contour.points.length - 1) return false;
    const next = contour.points[index + 1];
    return point.x !== next.x && point.y !== next.y;
  });

  return (
    <div className="editor">
      <div className="row">
        <button onClick={finish}>← Готово</button>
        <b>{state.plan.name}</b>
        <label className="muted">
          <input type="checkbox" checked={state.canvas.snap} onChange={(event) => dispatch({ type: 'snapChanged', value: event.target.checked })} /> прилипание
        </label>
        <span className="spacer" />
        <span className="muted">
          точек: {contour.points.length} · контур: {contour.closed ? 'замкнут' : 'рисуется'}
          {state.canvas.crossedWalls.length > 0 && <b className="bad-text"> · пересекает сам себя!</b>}
          {hasDiagonals && <span> · есть диагональные стены</span>}
        </span>
      </div>
      <div className="row"><RoomCanvas snapshot={state} dispatch={dispatch} /></div>
      {session.banner && <div className={`banner ${session.banner.kind}`}>{session.banner.text}</div>}
      <div className="row">
        <DimensionPanel state={state.dimension} selection={state.canvas.selection} dispatch={dispatch} />
        <LocksPanel locks={contour.locks} dispatch={dispatch} />
        <OpeningsPanel state={state} dispatch={dispatch} />
        {state.plan.kind === 'room' && <ZonesPanel state={state} dispatch={dispatch} />}
      </div>
    </div>
  );
}
