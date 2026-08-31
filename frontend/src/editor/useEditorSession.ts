import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createContourDimensionPinner } from './constraints/pinContourDimension';
import { PLANEGCS_WASM_URL } from './constraints/planegcsWasm';
import {
  createEditorSession,
  type EditorCommitRequest,
  type EditorCommitResult,
  type EditorIntent,
  type EditorPlan,
} from './editorSession';
import type { Banner } from './editorTypes';

const ERROR_TEXT: Record<string, string> = {
  'contour-self-intersection': 'Контур пересекает сам себя.',
  'point-cannot-slide': 'Двигать можно только промежуточную точку прямой стены.',
  'dimension-selection-incomplete': 'Сначала выберите две точки участка.',
  'dimension-value-invalid': 'Введите корректный размер в сантиметрах.',
  'dimension-conflict': 'Размер конфликтует с существующими замками или геометрией.',
  'solver-not-ready': 'Решатель размеров ещё загружается.',
  'partition-too-short': 'Простенок слишком короткий.',
  'partition-wall-required': 'Кликните по стене — простенок должен начинаться от неё.',
  'opening-wall-required': 'Кликните по стене — проём встанет в выбранное место.',
  'zone-anchor-required': 'Кликните по стене или точке контура, чтобы начать зону.',
  'point-cannot-be-deleted': 'Эту точку удалить нельзя.',
  'zone-needs-three-points': 'В зоне должно быть не меньше трёх вершин.',
  'stale-revision': 'План уже изменился. Редактор обновлён до актуального состояния.',
};

const SUCCESS_TEXT: Record<string, { kind: Banner['kind']; text: string }> = {
  'point-added': { kind: 'info', text: 'Точка поставлена. Клик в первую точку замыкает контур.' },
  'contour-closed': { kind: 'ok', text: 'Контур замкнут. Теперь можно выбирать точки и прибивать размеры.' },
  'wall-split': { kind: 'info', text: 'Стена разделена на две части.' },
  'point-deleted': { kind: 'info', text: 'Точка удалена, соседние стены соединены.' },
  'point-moved': { kind: 'ok', text: 'Положение точки сохранено.' },
  'dimension-pinned': { kind: 'ok', text: 'Размер прибит, геометрия пересчитана.' },
  'lock-removed': { kind: 'info', text: 'Замок размера снят.' },
  'opening-added': { kind: 'ok', text: 'Проём добавлен.' },
  'opening-changed': { kind: 'ok', text: 'Параметры проёма сохранены.' },
  'opening-deleted': { kind: 'info', text: 'Проём удалён.' },
  'zone-added': { kind: 'ok', text: 'Зона добавлена и привязана к плану.' },
  'zone-changed': { kind: 'ok', text: 'Параметры зоны сохранены.' },
  'zone-deleted': { kind: 'info', text: 'Зона удалена.' },
  'zone-vertex-moved': { kind: 'ok', text: 'Форма зоны сохранена.' },
  'opening-tool-selected': { kind: 'info', text: 'Кликните по стене — проём встанет в выбранное место.' },
  'zone-tool-selected': { kind: 'info', text: 'Кликните по стене или точке контура, затем задайте вершины зоны.' },
  'partition-tool-selected': { kind: 'info', text: 'Кликните по стене, затем укажите второй конец простенка.' },
  'tool-cancelled': { kind: 'info', text: 'Незавершённое действие отменено.' },
};

export function useEditorSession({
  plan,
  revision,
  onCommit,
}: {
  plan: EditorPlan;
  revision: number;
  onCommit: (request: EditorCommitRequest) => EditorCommitResult;
}) {
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const [banner, setBanner] = useState<Banner | null>({
    kind: 'info',
    text: 'Кликайте по полю — ставьте углы; клик в первую точку замыкает контур.',
  });
  const [session] = useState(() => createEditorSession({
    source: { plan, revision },
    commit: (request) => commitRef.current(request),
    loadSolver: async () => {
      const pinner = await createContourDimensionPinner(PLANEGCS_WASM_URL);
      return {
        pin: (contour, aId, bId, target) => pinner.pinContourDimension(contour, aId, bId, target),
        dispose: () => pinner.dispose(),
      };
    },
  }));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (snapshot.dimension.solver === 'failed') {
      setBanner({ kind: 'bad', text: 'Не удалось запустить решатель размеров.' });
    }
  }, [snapshot.dimension.solver]);
  useEffect(() => {
    const current = session.getSnapshot();
    if (current.revision === revision) return;
    session.dispatch({
      type: 'sourceChanged',
      plan,
      revision,
      origin: 'external',
    });
  }, [plan, revision, session]);

  function dispatch(intent: EditorIntent) {
    const result = session.dispatch(intent);
    if (!result.ok && 'code' in result) {
      if (result.code === 'dimension-conflict' && result.data) {
        const conflicts = Array.isArray(result.data.conflicts) && result.data.conflicts.length > 0
          ? ` Конфликты: ${result.data.conflicts.join('; ')}.`
          : '';
        const reason = typeof result.data.reason === 'string' ? result.data.reason : ERROR_TEXT[result.code];
        setBanner({ kind: 'bad', text: `${reason}${conflicts}` });
      } else {
        const reason = result.data && typeof result.data.reason === 'string' ? result.data.reason : null;
        setBanner({ kind: 'bad', text: reason ?? ERROR_TEXT[result.code] ?? 'Действие сейчас недоступно.' });
      }
    } else if (result.ok && result.code && result.code in SUCCESS_TEXT) {
      const message = SUCCESS_TEXT[result.code];
      if (message) setBanner(message);
    }
    return result;
  }

  return { snapshot, dispatch, banner };
}
