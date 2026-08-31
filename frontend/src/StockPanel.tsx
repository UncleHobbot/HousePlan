import { useState } from 'react';
import type { AssistantCard, ObjectCategory, SceneObject } from '@houseplan/shared';
import { NO_CLEARANCE } from '@houseplan/shared';
import { CommitInput } from './CommitInput';

const CATEGORY_LABELS: Record<ObjectCategory, string> = {
  sofa: 'Диван',
  armchair: 'Кресло',
  table: 'Стол',
  chair: 'Стул',
  bed: 'Кровать',
  wardrobe: 'Шкаф',
  light: 'Свет',
  appliance: 'Прибор',
  other: 'Прочее',
};

/**
 * Склад проекта: список объектов, создание, копирование, удаление,
 * редактирование свойств и допусков. Отсюда объект тащат на план.
 */
export function StockPanel({
  objects,
  status,
  importCards,
  onCheckImport,
  onAcceptImport,
  onRejectImport,
  onCreate,
  onUpdate,
  onClone,
  onDelete,
  onPlace,
}: {
  objects: SceneObject[];
  /** где объект: текст статуса для списка */
  status: (objectId: number) => string;
  /** карточки в папке импорта (null — ещё не проверяли) */
  importCards: Array<{ file: string; card: AssistantCard }> | null;
  onCheckImport: () => void;
  onAcceptImport: (file: string) => void;
  onRejectImport: (file: string) => void;
  onCreate: (object: SceneObject) => void;
  onUpdate: (object: SceneObject) => void;
  onClone: (object: SceneObject) => void;
  onDelete: (objectId: number) => void;
  /** поставить в центр самого большого помещения */
  onPlace: (objectId: number) => void;
}) {
  const [form, setForm] = useState({ name: '', category: 'other' as ObjectCategory, w: 200, d: 90, h: 80, color: '#0e7490' });
  const [expanded, setExpanded] = useState<number | null>(null);

  function create() {
    const name = form.name.trim() || CATEGORY_LABELS[form.category];
    onCreate({
      id: 0, // присвоит родитель
      name,
      category: form.category,
      widthCm: form.w,
      depthCm: form.d,
      heightCm: form.h,
      color: form.color,
      clearances: { ...NO_CLEARANCE },
    });
    setForm({ ...form, name: '' });
  }

  return (
    <div className="stock">
      <h2>Объекты (склад)</h2>
      <div className="card">
        <h3>Импорт от ассистента</h3>
        <button onClick={onCheckImport}>Проверить импорт</button>
        {importCards !== null && importCards.length === 0 && (
          <p className="muted">Папка импорта пуста.</p>
        )}
        <ul className="locks">
          {(importCards ?? []).map(({ file, card }) => (
            <li key={file}>
              <span>
                <b>{card.name ?? file}</b>
                <span className="muted">
                  {' '}
                  {card.source?.vendor ? `· ${card.source.vendor}` : ''}
                  {card.source?.price_cad ? ` · ${card.source.price_cad} CAD` : ''}
                  {card.source?.confidence === 'estimated' ? ' · оценка по фото' : ''}
                </span>
              </span>
              <span className="row">
                <button className="primary" onClick={() => onAcceptImport(file)}>Принять</button>
                <button onClick={() => onRejectImport(file)}>Отклонить</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Новый объект</h3>
        <div className="row">
          <input placeholder="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ minWidth: 150 }} />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ObjectCategory })}>
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div className="row">
          Ш <input type="number" style={{ width: 70 }} value={form.w} onChange={(e) => setForm({ ...form, w: Number(e.target.value) })} />
          Г <input type="number" style={{ width: 70 }} value={form.d} onChange={(e) => setForm({ ...form, d: Number(e.target.value) })} />
          В <input type="number" style={{ width: 70 }} value={form.h} onChange={(e) => setForm({ ...form, h: Number(e.target.value) })} />
          <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ width: 40, padding: 0 }} />
          <button className="primary" onClick={create}>+ Добавить</button>
        </div>
      </div>
      <ul className="cards">
        {objects.map((o) => (
          <li key={o.id}>
            <div
              className="card"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/objectid', String(o.id));
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <div className="row">
                <b>{o.name}</b>
                <span className="muted">
                  {CATEGORY_LABELS[o.category]} · {o.widthCm}×{o.depthCm}×{o.heightCm} см
                </span>
                <span className="spacer" />
                <span className="muted">{status(o.id)}</span>
              </div>
              {o.unconfirmedImport && (
                <div className="row">
                  <span className="bad-text">из импорта — не подтверждено</span>
                  <button onClick={() => onUpdate({ ...o, unconfirmedImport: false })}>Подтвердить</button>
                </div>
              )}
              {(o.source?.vendor || o.source?.priceCad) && (
                <p className="muted">
                  источник: {o.source?.vendor}
                  {o.source?.priceCad ? ` · ${o.source.priceCad} CAD` : ''}
                  {o.source?.confidence === 'estimated' ? ' · размеры оценены по фото' : ''}
                </p>
              )}
              <div className="row">
                <button onClick={() => onPlace(o.id)}>На план</button>
                <button onClick={() => onClone(o)}>Копия</button>
                <button onClick={() => setExpanded(expanded === o.id ? null : o.id)}>Свойства</button>
                <button onClick={() => onDelete(o.id)}>Удалить</button>
              </div>
              {expanded === o.id && (
                <div>
                  <h3>Свойства</h3>
                  <div className="row">
                    <CommitInput value={o.name} onCommit={(value) => onUpdate({ ...o, name: String(value) })} style={{ minWidth: 150 }} />
                    <select value={o.category} onChange={(e) => onUpdate({ ...o, category: e.target.value as ObjectCategory })}>
                      {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>{label}</option>
                      ))}
                    </select>
                    <input type="color" value={o.color || '#0e7490'} onChange={(e) => onUpdate({ ...o, color: e.target.value })} style={{ width: 40, padding: 0 }} />
                  </div>
                  <div className="row">
                    Ш <CommitInput type="number" style={{ width: 70 }} value={o.widthCm} onCommit={(value) => onUpdate({ ...o, widthCm: Number(value) })} />
                    Г <CommitInput type="number" style={{ width: 70 }} value={o.depthCm} onCommit={(value) => onUpdate({ ...o, depthCm: Number(value) })} />
                    В <CommitInput type="number" style={{ width: 70 }} value={o.heightCm} onCommit={(value) => onUpdate({ ...o, heightCm: Number(value) })} />
                  </div>
                  <h3>Допуск (см)</h3>
                  <div className="row">
                    перед <CommitInput type="number" style={{ width: 60 }} value={o.clearances.front} onCommit={(value) => onUpdate({ ...o, clearances: { ...o.clearances, front: Number(value) } })} />
                    за <CommitInput type="number" style={{ width: 60 }} value={o.clearances.back} onCommit={(value) => onUpdate({ ...o, clearances: { ...o.clearances, back: Number(value) } })} />
                    слева <CommitInput type="number" style={{ width: 60 }} value={o.clearances.left} onCommit={(value) => onUpdate({ ...o, clearances: { ...o.clearances, left: Number(value) } })} />
                    справа <CommitInput type="number" style={{ width: 60 }} value={o.clearances.right} onCommit={(value) => onUpdate({ ...o, clearances: { ...o.clearances, right: Number(value) } })} />
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
