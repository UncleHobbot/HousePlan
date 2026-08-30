import { useState } from 'react';
import type { ObjectCategory, SceneObject } from '@houseplan/shared';
import { NO_CLEARANCE } from '@houseplan/shared';

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
  onCreate,
  onUpdate,
  onClone,
  onDelete,
  onPlace,
}: {
  objects: SceneObject[];
  /** где объект: текст статуса для списка */
  status: (objectId: number) => string;
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
                    <input value={o.name} onChange={(e) => onUpdate({ ...o, name: e.target.value })} style={{ minWidth: 150 }} />
                    <select value={o.category} onChange={(e) => onUpdate({ ...o, category: e.target.value as ObjectCategory })}>
                      {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>{label}</option>
                      ))}
                    </select>
                    <input type="color" value={o.color || '#0e7490'} onChange={(e) => onUpdate({ ...o, color: e.target.value })} style={{ width: 40, padding: 0 }} />
                  </div>
                  <div className="row">
                    Ш <input type="number" style={{ width: 70 }} value={o.widthCm} onChange={(e) => onUpdate({ ...o, widthCm: Number(e.target.value) })} />
                    Г <input type="number" style={{ width: 70 }} value={o.depthCm} onChange={(e) => onUpdate({ ...o, depthCm: Number(e.target.value) })} />
                    В <input type="number" style={{ width: 70 }} value={o.heightCm} onChange={(e) => onUpdate({ ...o, heightCm: Number(e.target.value) })} />
                  </div>
                  <h3>Допуск (см)</h3>
                  <div className="row">
                    перед <input type="number" style={{ width: 60 }} value={o.clearances.front} onChange={(e) => onUpdate({ ...o, clearances: { ...o.clearances, front: Number(e.target.value) } })} />
                    за <input type="number" style={{ width: 60 }} value={o.clearances.back} onChange={(e) => onUpdate({ ...o, clearances: { ...o.clearances, back: Number(e.target.value) } })} />
                    слева <input type="number" style={{ width: 60 }} value={o.clearances.left} onChange={(e) => onUpdate({ ...o, clearances: { ...o.clearances, left: Number(e.target.value) } })} />
                    справа <input type="number" style={{ width: 60 }} value={o.clearances.right} onChange={(e) => onUpdate({ ...o, clearances: { ...o.clearances, right: Number(e.target.value) } })} />
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
