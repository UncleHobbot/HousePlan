import { useEffect, useRef, useState } from 'react';
import type { Project } from '@houseplan/shared';
import { rebaseCounters } from '@houseplan/shared';
import { api } from './api';

const HISTORY_LIMIT = 50;

/**
 * Хранилище проекта: состояние, история отмены/возврата, сохранение.
 * Страница проекта остаётся раскладкой; правила — здесь и в shared.
 */
export function useProjectStore(name: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef<Project[]>([]);
  const redoRef = useRef<Project[]>([]);
  const projectRef = useRef<Project | null>(null);

  projectRef.current = project;

  function say(text: string) {
    setNotice(text);
  }

  // Загрузка проекта при открытии страницы
  useEffect(() => {
    let cancelled = false;
    setError('');
    api
      .readProject(name)
      .then((loaded) => {
        if (cancelled) return;
        rebaseCounters(loaded);
        setProject(loaded);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  function pushHistory(current: Project) {
    historyRef.current.push(current);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  /** Изменить живой план (пишется в историю отмены). */
  function update(change: (p: Project) => void) {
    const current = projectRef.current;
    if (!current) return;
    pushHistory(current);
    const copy = structuredClone(current);
    change(copy);
    rebaseCounters(copy);
    setProject(copy);
    setDirty(true);
  }

  function undo() {
    const previous = historyRef.current.pop();
    const current = projectRef.current;
    if (!previous || !current) return;
    redoRef.current.push(current);
    rebaseCounters(previous);
    setProject(previous);
    setDirty(true);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    say('Действие отменено.');
  }

  function redo() {
    const next = redoRef.current.pop();
    const current = projectRef.current;
    if (!next || !current) return;
    historyRef.current.push(current);
    rebaseCounters(next);
    setProject(next);
    setDirty(true);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    say('Действие возвращено.');
  }

  async function save() {
    const current = projectRef.current;
    if (!current) return;
    try {
      await api.saveProject(name, current);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Установить проект целиком — для состояний, приходящих извне
   * (возврат варианта, приём импорта, переименование).
   * history: записать ли прежнее состояние в историю отмены.
   */
  function install(next: Project, options: { history?: boolean; dirty?: boolean } = {}) {
    const { history = true, dirty = true } = options;
    const current = projectRef.current;
    if (history && current) pushHistory(current);
    rebaseCounters(next);
    setProject(next);
    setDirty(dirty);
  }

  // Отмена и возврат — Ctrl+Z / Ctrl+Y
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return {
    project,
    error,
    setError,
    notice,
    say,
    dirty,
    canUndo,
    canRedo,
    update,
    undo,
    redo,
    save,
    install,
  };
}
