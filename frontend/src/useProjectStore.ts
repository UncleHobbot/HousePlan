import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, ApiError, type ProjectDocument } from './api';
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
  const [token, setToken] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  function errorMessage(reason: unknown): string {
    if (!(reason instanceof ApiError)) return reason instanceof Error ? reason.message : String(reason);
    const paths = reason.issues?.slice(0, 3).map((issue) => issue.path).join(', ');
    return paths ? `${reason.message} Проверить: ${paths}.` : reason.message;
  }

  function reportError(reason: unknown) {
    if (reason instanceof ApiError && reason.code === 'stale-project') setConflict(true);
    setError(errorMessage(reason));
  }

  useEffect(() => {
    let cancelled = false;
    setError('');
    api
      .readProject(name)
      .then((document) => {
        if (!cancelled) {
          setToken(document.token);
          session.dispatch({ type: 'projectLoaded', project: document.project });
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
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

  async function save(force = false) {
    const request = session.getSnapshot();
    if (!request.project || request.gestureActive || !token || saving) return;
    setSaving(true);
    try {
      const document = await api.saveProject(name, request.project, token, force);
      setToken(document.token);
      session.dispatch({ type: 'saveAcknowledged', revision: request.revision });
      setError('');
      setConflict(false);
    } catch (reason) {
      session.dispatch({ type: 'saveRejected', revision: request.revision });
      reportError(reason);
    } finally {
      setSaving(false);
    }
  }

  async function reloadFromDisk() {
    try {
      const document = await api.readProject(name);
      setToken(document.token);
      session.dispatch({ type: 'projectLoaded', project: document.project });
      setConflict(false);
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function adoptServerDocument(document: ProjectDocument, type: 'projectRenamed' | 'importAccepted') {
    setToken(document.token);
    setConflict(false);
    session.dispatch({ type, project: document.project });
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
    token,
    conflict,
    saving,
    say: setNotice,
    dispatch,
    undo,
    redo,
    save,
    reloadFromDisk,
    adoptServerDocument,
    reportError,
  };
}
