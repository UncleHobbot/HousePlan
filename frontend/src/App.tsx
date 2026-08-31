import { useEffect, useState } from 'react';
import type { Floor, Project, Room } from '@houseplan/shared';
import {
  allocateId,
  addFloor as addFloorToProject,
  applySnapshot,
  createSnapshot,
  deleteObject,
  diffPlacements,
  largestRoom,
  locateObject,
  livePlacements,
  objectLocation,
  placeObject,
  projectedZonesForFloor,
  roomCentroid,
  roomLabel,
} from '@houseplan/shared';
import { api, type ImportCard, type ProjectSummary } from './api';
import { FloorView } from './FloorView';
import { RoomEditor } from './editor/RoomEditor';
import { StockPanel } from './StockPanel';
import { useProjectStore } from './useProjectStore';

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [openName, setOpenName] = useState<string | null>(null);

  async function refresh() {
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.createProject(name);
      setNewName('');
      await refresh();
      setOpenName(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (openName !== null) {
    return (
      <ProjectPage
        name={openName}
        onRenamed={(newName) => setOpenName(newName)}
        onExit={() => {
          setOpenName(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="page">
      <h1>HousePlan — каталог проектов</h1>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <input
          placeholder="Название нового проекта"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button onClick={create}>Создать проект</button>
      </div>
      {projects === null ? (
        <p>Загрузка…</p>
      ) : projects.length === 0 ? (
        <p>Проектов пока нет — создайте первый.</p>
      ) : (
        <ul className="cards">
          {projects.map((p) => (
            <li key={p.name}>
              <button className="card" onClick={() => setOpenName(p.name)}>
                <b>{p.name}</b>
                <span className="muted">
                  этажей: {p.floors} · объектов: {p.objects}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectPage({ name, onExit, onRenamed }: { name: string; onExit: () => void; onRenamed: (newName: string) => void }) {
  const store = useProjectStore(name);
  const { project, error, notice, dirty, canUndo, canRedo } = store;
  const [activeFloor, setActiveFloor] = useState<number | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [editingShell, setEditingShell] = useState(false);
  const [snapName, setSnapName] = useState('');
  const [snapNote, setSnapNote] = useState('');
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [importCards, setImportCards] = useState<ImportCard[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // активный этаж: при загрузке и после исчезновения выбранного
  useEffect(() => {
    if (!project) return;
    if (!project.floors.some((f) => f.id === activeFloor)) {
      setActiveFloor(project.floors[0]?.id ?? null);
    }
  }, [project, activeFloor]);

  async function checkImport() {
    try {
      setImportCards(await api.listImport());
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function acceptImport(file: string) {
    try {
      const result = await api.acceptImport(file, name);
      // сервер уже сохранил проект; состояние участвует в отмене
      store.install(result.project, { history: true, dirty: false });
      setImportCards(await api.listImport());
      store.say(`Объект «${result.object.name}» принят на склад с пометкой «не подтверждено».`);
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function rejectImport(file: string) {
    try {
      await api.rejectImport(file);
      setImportCards(await api.listImport());
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function renameProject() {
    const newName = newProjectName.trim();
    if (!newName || newName === name) {
      setRenaming(false);
      return;
    }
    try {
      const result = await api.renameProject(name, newName);
      store.install(result.project, { history: false, dirty: false });
      setRenaming(false);
      onRenamed(newName);
      store.say(`Проект переименован в «${newName}».`);
    } catch (e) {
      store.setError(e instanceof Error ? e.message : String(e));
    }
  }

  function rememberSnapshot() {
    if (!project) return;
    const variantName = snapName.trim() || `Вариант ${(project.counters.snapshot ?? 0) + 1}`;
    store.update((p) => {
      const id = allocateId(p, 'snapshot');
      const snapshot = createSnapshot(p, id, variantName, snapNote.trim() || undefined);
      p.counters.snapshot = id;
      p.snapshots.push(snapshot);
    });
    setSnapName('');
    setSnapNote('');
    store.say(`Вариант «${variantName}» запомнен. Не забудьте сохранить изменения.`);
  }

  function restoreSnapshot(snapshotId: number) {
    if (!project) return;
    const snapshot = project.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return;
    if (!window.confirm(`Вернуть вариант «${snapshot.name}»? Текущая расстановка будет перезаписана.`)) return;
    store.install(applySnapshot(project, snapshot), { dirty: true });
    setCompareWith(null);
    store.say(`Вариант «${snapshot.name}» возвращён в живой план.`);
  }

  function deleteSnapshot(snapshotId: number) {
    if (!project) return;
    store.update((p) => {
      p.snapshots = p.snapshots.filter((s) => s.id !== snapshotId);
    });
    if (compareWith === snapshotId) setCompareWith(null);
  }

  function deleteFloor() {
    if (!project || !floor) return;
    const placed = floor.rooms.reduce((sum, r) => sum + r.placements.length, 0);
    const message =
      `Удалить этаж «${floor.name}»? Помещений: ${floor.rooms.length}.` +
      (placed > 0 ? ` Объектов на этаже: ${placed} — они вернутся на склад.` : '');
    if (!window.confirm(message)) return;
    store.update((p) => {
      p.floors = p.floors.filter((f) => f.id !== floor.id);
    });
    const remaining = project.floors.find((f) => f.id !== floor.id);
    setActiveFloor(remaining ? remaining.id : null);
    store.say(`Этаж «${floor.name}» удалён.`);
  }

  function deleteRoom(room: Room) {
    if (!project || !floor) return;
    const placed = room.placements.length;
    const message =
      `Удалить помещение «${room.name}»? Зоны и двери помещения удалятся.` +
      (placed > 0 ? ` Объектов в нём: ${placed} — они вернутся на склад.` : '');
    if (!window.confirm(message)) return;
    store.update((p) => {
      const f = p.floors.find((f) => f.id === floor.id);
      if (f) f.rooms = f.rooms.filter((r) => r.id !== room.id);
    });
    if (editingRoomId === room.id) setEditingRoomId(null);
    store.say(`Помещение «${room.name}» удалено.`);
  }

  function addFloor() {
    if (!project) return;
    store.update((p) => {
      const floor = addFloorToProject(p, activeFloor ?? undefined);
      setActiveFloor(floor.id);
    });
  }

  function startDrawingRoom(target: Floor) {
    if (!project) return;
    const id = (project.counters.room ?? 0) + 1;
    store.update((p) => {
      const f = p.floors.find((f) => f.id === target.id)!;
      const allocated = allocateId(p, 'room');
      f.rooms.push({
        id: allocated,
        name: `Помещение ${allocated}`,
        contour: { points: [], thicknesses: {}, locks: [], closed: false },
        openings: [],
        zones: [],
        placements: [],
      });
      setEditingRoomId(allocated);
    });
  }

  if (store.error && !project) {
    return (
      <div className="page">
        <p className="error">{store.error}</p>
        <button onClick={onExit}>К каталогу</button>
      </div>
    );
  }
  if (!project) return <p className="page">Загрузка…</p>;

  const floor = project.floors.find((f) => f.id === activeFloor) ?? null;
  const highlightIds = (() => {
    if (compareWith === null) return undefined;
    const snapshot = project.snapshots.find((s) => s.id === compareWith);
    if (!snapshot) return undefined;
    const diff = diffPlacements(snapshot.placements, livePlacements(project));
    return new Set([...diff.moved.map((m) => m.object.id), ...diff.added.map((p) => p.object.id)]);
  })();
  const projected = floor ? projectedZonesForFloor(project, floor.id) : [];

  return (
    <div className="page">
      <div className="row">
        <button onClick={onExit}>← Каталог</button>
        <h1>{project.name}</h1>
        <button onClick={() => { setNewProjectName(project.name); setRenaming(true); }}>Переименовать</button>
        {renaming && (
          <>
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              style={{ minWidth: 160 }}
            />
            <button className="primary" onClick={renameProject}>ОК</button>
            <button onClick={() => setRenaming(false)}>✕</button>
          </>
        )}
        <span className="spacer" />
        <button onClick={store.undo} disabled={!store.canUndo} title="Ctrl+Z">⟲ Отменить</button>
        <button onClick={store.redo} disabled={!store.canRedo} title="Ctrl+Y">⟳ Вернуть</button>
        <button onClick={store.save} disabled={!store.dirty}>
          {store.dirty ? 'Сохранить изменения' : 'Сохранено'}
        </button>
      </div>
      {store.error && <p className="error">{store.error}</p>}
      {store.notice && <div className="banner ok">{store.notice}</div>}
      <div className="card">
        <h2>Варианты расстановки</h2>
        <div className="row">
          <input
            placeholder="Название варианта"
            value={snapName}
            onChange={(e) => setSnapName(e.target.value)}
            style={{ minWidth: 180 }}
          />
          <input
            placeholder="Заметка (необязательно)"
            value={snapNote}
            onChange={(e) => setSnapNote(e.target.value)}
            style={{ minWidth: 200 }}
          />
          <button className="primary" onClick={rememberSnapshot}>Запомнить вариант</button>
        </div>
        {project.snapshots.length > 0 && (
          <ul className="locks">
            {project.snapshots.map((sn) => (
              <li key={sn.id}>
                <span>
                  <b>{sn.name}</b>
                  {sn.note ? ` — ${sn.note}` : ''}
                  <span className="muted"> · объектов: {sn.placements.length}</span>
                </span>
                <span className="row">
                  <button onClick={() => restoreSnapshot(sn.id)}>Вернуть</button>
                  <button onClick={() => setCompareWith(compareWith === sn.id ? null : sn.id)}>
                    {compareWith === sn.id ? 'Скрыть сравнение' : 'Сравнить с планом'}
                  </button>
                  <button onClick={() => deleteSnapshot(sn.id)}>Удалить</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {compareWith !== null &&
          (() => {
            const snapshot = project.snapshots.find((s) => s.id === compareWith);
            if (!snapshot) return null;
            const diff = diffPlacements(snapshot.placements, livePlacements(project));
            return (
              <div>
                <p className="muted">Сравнение: «{snapshot.name}» → текущий план</p>
                {diff.moved.length > 0 && (
                  <p>
                    <b>Переехало:</b>{' '}
                    {diff.moved
                      .map((m) => `${m.object.name} (${roomLabel(project, m.from.roomId)} → ${roomLabel(project, m.to.roomId)})`)
                      .join('; ')}
                  </p>
                )}
                {diff.added.length > 0 && (
                  <p><b>Добавлено на план:</b> {diff.added.map((p) => p.object.name).join(', ')}</p>
                )}
                {diff.removed.length > 0 && (
                  <p><b>Убрано с плана:</b> {diff.removed.map((p) => p.object.name).join(', ')}</p>
                )}
                {diff.moved.length + diff.added.length + diff.removed.length === 0 && (
                  <p className="muted">Различий нет.</p>
                )}
              </div>
            );
          })()}
      </div>
      <div className="row">
        {project.floors.map((f) => (
          <button
            key={f.id}
            className={f.id === activeFloor ? 'tab active' : 'tab'}
            onClick={() => setActiveFloor(f.id)}
          >
            {f.name}
          </button>
        ))}
        <button onClick={addFloor}>+ Этаж</button>
      </div>
      {floor ? (
        editingShell ? (
          <RoomEditor
            plan={{
              kind: 'shell',
              name: 'Оболочка этажа',
              contour: floor.shell.contour,
              openings: floor.shell.openings,
              openingKinds: ['window', 'entryDoor'],
              counters: project.counters,
            }}
            onChange={(next) =>
              store.update((p) => {
                const shell = p.floors.find((f) => f.id === floor.id)!.shell;
                shell.contour = next.contour;
                shell.openings = next.openings;
              })
            }
            onDone={() => setEditingShell(false)}
          />
        ) : editingRoomId !== null && floor.rooms.some((r) => r.id === editingRoomId) ? (
          (() => {
            const room = floor.rooms.find((r) => r.id === editingRoomId)!;
            return (
              <RoomEditor
                plan={{
                  kind: 'room',
                  name: room.name,
                  contour: room.contour,
                  openings: room.openings,
                  openingKinds: ['innerDoor'],
                  counters: project.counters,
                  zones: room.zones,
                  floors: project.floors,
                  floorId: floor.id,
                }}
                onChange={(next) =>
                  store.update((p) => {
                    const f = p.floors.find((f) => f.id === floor.id)!;
                    const r = f.rooms.find((r) => r.id === editingRoomId)!;
                    r.contour = next.contour;
                    r.openings = next.openings;
                    if (next.kind === 'room') r.zones = next.zones;
                  })
                }
                onDone={() => setEditingRoomId(null)}
              />
            );
          })()
        ) : (
          <>
            <div className="row">
              <input
                value={floor.name}
                title="Имя этажа"
                style={{ width: 160, fontWeight: 700 }}
                onChange={(e) =>
                  store.update((p) => {
                    p.floors.find((f) => f.id === floor.id)!.name = e.target.value;
                  })
                }
              />
              <span className="muted">потолок: {floor.ceilingHeightCm} см</span>
              <button onClick={() => setEditingShell(true)}>
                {floor.shell.contour.closed ? 'Редактировать оболочку' : 'Нарисовать оболочку'}
              </button>
              <button onClick={() => startDrawingRoom(floor)}>+ Нарисовать помещение</button>
              <button onClick={deleteFloor}>Удалить этаж</button>
            </div>
            {floor.rooms.length === 0 ? (
              <p className="muted">На этаже пока нет помещений. Нажмите «Нарисовать помещение».</p>
            ) : (
              <ul>
                {floor.rooms.map((r) => (
                  <li key={r.id}>
                    <span className="row">
                      <input
                        value={r.name}
                        title="Имя помещения"
                        style={{ width: 140 }}
                        onChange={(e) =>
                          store.update((p) => {
                            const f = p.floors.find((f2) => f2.id === floor.id)!;
                            const target = f.rooms.find((r2) => r2.id === r.id)!;
                            target.name = e.target.value;
                          })
                        }
                      />
                      — {r.contour.closed ? `${r.contour.points.length} углов` : 'недорисовано'}
                      {', объектов: '}
                      {r.placements.length}
                      <button onClick={() => setEditingRoomId(r.id)}>
                        {r.contour.closed ? 'Редактировать' : 'Продолжить рисование'}
                      </button>
                      <button onClick={() => deleteRoom(r)}>Удалить</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="floor-grid">
              <FloorView
                project={project}
                floorId={floor.id}
                objects={project.objects}
                projectedZones={projected}
                highlight={highlightIds}
                onChangeFloors={(floors) =>
                  store.update((p) => {
                    p.floors = floors;
                  })
                }
              />
              <StockPanel
                objects={project.objects}
                importCards={importCards}
                onCheckImport={checkImport}
                onAcceptImport={acceptImport}
                onRejectImport={rejectImport}
                status={(objectId) => objectLocation(project, objectId)}
                onCreate={(object) =>
                  store.update((p) => {
                    const id = allocateId(p, 'object');
                    p.counters.object = id;
                    p.objects.push({ ...object, id });
                  })
                }
                onUpdate={(object) =>
                  store.update((p) => {
                    const idx = p.objects.findIndex((o) => o.id === object.id);
                    if (idx >= 0) p.objects[idx] = object;
                  })
                }
                onClone={(object) =>
                  store.update((p) => {
                    const id = allocateId(p, 'object');
                    p.counters.object = id;
                    p.objects.push({ ...structuredClone(object), id, name: object.name + ' (копия)' });
                  })
                }
                onDelete={(objectId) =>
                  store.update((p) => {
                    const cleaned = deleteObject(p, objectId);
                    p.objects = cleaned.objects;
                    p.floors = cleaned.floors;
                  })
                }
                onPlace={(objectId) =>
                  store.update((p) => {
                    const target = p.floors.find((f2) => f2.id === floor.id)!;
                    const room = largestRoom(target);
                    if (!room) return;
                    const next = placeObject(p, objectId, target.id, roomCentroid(room), room.id);
                    if (next) p.floors = next.floors;
                  })
                }
              />
            </div>
          </>
        )
      ) : (
        <p>Добавьте этаж — и рисуйте.</p>
      )}
    </div>
  );
}
