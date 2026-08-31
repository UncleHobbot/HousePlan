import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { createProjectSession, type ProjectIntent } from './projectSession';

/**
 * Тонкий React-адаптер browser-сессии. Сеть и русские сообщения принадлежат UI;
 * проект, история, ревизии и правила переходов принадлежат projectSession.
 */
export function useProjectStore(name: string) {
  const session = useMemo(() => createProjectSession(), [name]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setError('');
    api
      .readProject(name)
      .then((project) => {
        if (!cancelled) session.dispatch({ type: 'projectLoaded', project });
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [name, session]);

  function undo() {
    const result = session.dispatch({ type: 'undo' });
    if (result.ok) setNotice('Действие отменено.');
  }

  function redo() {
    const result = session.dispatch({ type: 'redo' });
    if (result.ok) setNotice('Действие возвращено.');
  }

  async function save() {
    const request = session.getSnapshot();
    if (!request.project || request.gestureActive) return;
    try {
      await api.saveProject(name, request.project);
      session.dispatch({ type: 'saveAcknowledged', revision: request.revision });
      setError('');
    } catch (reason) {
      session.dispatch({ type: 'saveRejected', revision: request.revision });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        const result = session.dispatch({ type: 'undo' });
        if (result.ok) setNotice('Действие отменено.');
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        const result = session.dispatch({ type: 'redo' });
        if (result.ok) setNotice('Действие возвращено.');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  function dispatch(intent: ProjectIntent) {
    return session.dispatch(intent);
  }

  return {
    ...state,
    error,
    setError,
    notice,
    say: setNotice,
    dispatch,
    undo,
    redo,
    save,
  };
}
