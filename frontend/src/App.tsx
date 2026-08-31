import { useEffect, useRef, useState } from 'react';
import type { AssistantCard, Floor, Project, Room } from '@houseplan/shared';
import {
  allocateId,
  applySnapshot,
  createSnapshot,
  deleteObject,
  diffPlacements,
  largestRoom,
  locateObject,
  livePlacements,
  placeObject,
  rebaseCounters,
  roomCentroid,
} from '@houseplan/shared';
import { api, type ImportCard, type ProjectSummary } from './api';
import { FloorView } from './FloorView';
import { RoomEditor } from './editor/RoomEditor';
import { StockPanel } from './StockPanel';

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
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [activeFloor, setActiveFloor] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [editingShell, setEditingShell] = useState(false);
  const [snapName, setSnapName] = useState('');
  const [snapNote, setSnapNote] = useState('');
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [importCards, setImportCards] = useState<ImportCard[] | null>(null);
  const [notice, setNotice] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const historyRef = useRef<Project[]>([]);
  const redoRef = useRef<Project[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  function say(text: string) {
    setNotice(text);
  }

  useEffect(() => {
    api
      .readProject(name)
      .then((p) => {
        rebaseCounters(p);
        setProject(p);
        setActiveFloor(p.floors[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [name]);

  function pushHistory() {
    if (!project) return;
    historyRef.current.push(project);
    if (historyRef.current.length > 50) historyRef.current.shift();
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  function update(change: (p: Project) => void) {
    pushHistory();
    setDirty(true);
    setProject((current) => {
      if (!current) return current;
      const copy = structuredClone(current);
      change(copy);
      rebaseCounters(copy);
      return copy;
    });
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous || !project) return;
    redoRef.current.push(project);
    rebaseCounters(previous);
    setProject(previous);
    setDirty(true);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
    say('Действие отменено.');
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next || !project) return;
    historyRef.current.push(project);
    rebaseCounters(next);
    setProject(next);
    setDirty(true);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    say('Действие возвращено.');
  }

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



  function addFloor() {
    if (!project) return;
    update((p) => {
      const id = allocateId(p, 'floor');
      p.counters.floor = id;
      const neighbour = p.floors.find((floor) => floor.id === activeFloor) ?? p.floors[p.floors.length - 1];
      p.floors.push({
        id,
        name: `${p.floors.length + 1}-й этаж`,
        ceilingHeightCm: 260,
        shell: neighbour
          ? structuredClone(neighbour.shell)
          : { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
        rooms: [],
      });
      setActiveFloor(id);
    });
  }

  function startDrawingRoom(floor: Floor) {
    if (!project) return;
    // предсказываем идентификатор из текущих счётчиков — update() выделит ровно его
    const id = (project.counters.room ?? 0) + 1;
    update((p) => {
      const f = p.floors.find((f) => f.id === floor.id)!;
      const allocated = allocateId(p, 'room');
      p.counters.room = allocated;
      f.rooms.push({
        id: allocated,
        name: `Комната ${allocated}`,
        contour: { points: [], thicknesses: {}, locks: [], closed: false },
        openings: [],
        zones: [],
        placements: [],
      });
      setEditingRoomId(allocated);
    });
  }

  async function save() {
    if (!project) return;
    try {
      await api.saveProject(name, project);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function rememberSnapshot() {
    if (!project) return;
    const name = snapName.trim() || `Вариант ${(project.counters.snapshot ?? 0) + 1}`;
    const id = (project.counters.snapshot ?? 0) + 1;
    update((p) => {
      const snapshot = createSnapshot(p, id, name, snapNote.trim() || undefined);
      p.counters.snapshot = id;
      p.snapshots.push(snapshot);
    });
    setSnapName('');
    setSnapNote('');
    say(`Вариант «${name}» запомнен. Не забудьте сохранить изменения.`);
  }

  function restoreSnapshot(snapshotId: number) {
    if (!project) return;
    const snapshot = project.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return;
    if (!window.confirm(`Вернуть вариант «${snapshot.name}»? Текущая расстановка будет перезаписана.`)) return;
    pushHistory();
    const restored = applySnapshot(project, snapshot);
    rebaseCounters(restored);
    setProject(restored);
    setDirty(true);
    setActiveFloor((current) => (restored.floors.some((f) => f.id === current) ? current : restored.floors[0]?.id ?? null));
    setCompareWith(null);
    say(`Вариант «${snapshot.name}» возвращён в живой план.`);
  }

  function deleteSnapshot(snapshotId: number) {
    if (!project) return;
    update((p) => {
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
    update((p) => {
      p.floors = p.floors.filter((f) => f.id !== floor.id);
    });
    const remaining = project.floors.find((f) => f.id !== floor.id);
    setActiveFloor(remaining ? remaining.id : null);
    say(`Этаж «${floor.name}» удалён.`);
  }

  function deleteRoom(room: Room) {
    if (!project || !floor) return;
    const placed = room.placements.length;
    const message =
      `Удалить помещение «${room.name}»? Зоны и двери помещения удалятся.` +
      (placed > 0 ? ` Объектов в нём: ${placed} — они вернутся на склад.` : '');
    if (!window.confirm(message)) return;
    update((p) => {
      const f = p.floors.find((f) => f.id === floor.id);
      if (f) f.rooms = f.rooms.filter((r) => r.id !== room.id);
    });
    if (editingRoomId === room.id) setEditingRoomId(null);
    say(`Помещение «${room.name}» удалено.`);
  }

  async function renameProject() {
    const newName = newProjectName.trim();
    if (!newName || newName === name) {
      setRenaming(false);
      return;
    }
    try {
      const result = await api.renameProject(name, newName);
      rebaseCounters(result.project);
      setProject(result.project);
      setDirty(false);
      setRenaming(false);
      onRenamed(newName);
      say(`Проект переименован в «${newName}».`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function roomNameById(roomId: number): string {
    for (const f of project?.floors ?? []) {
      const room = f.rooms.find((r) => r.id === roomId);
      if (room) return `${f.name}: ${room.name}`;
    }
    return '?';
  }

  async function checkImport() {
    try {
      setImportCards(await api.listImport());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function acceptImport(file: string) {
    try {
      const result = await api.acceptImport(file, name);
      // сервер сохранил файл — клиент ставит ту же версию в историю отмены
      rebaseCounters(result.project);
      pushHistory();
      setProject(result.project);
      setDirty(false);
      setImportCards(await api.listImport());
      say(`Объект «${result.object.name}» принят на склад с пометкой «не подтверждено».`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function rejectImport(file: string) {
    try {
      await api.rejectImport(file);
      setImportCards(await api.listImport());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error && !project) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <button onClick={onExit}>К каталогу</button>
      </div>
    );
  }
  if (!project) return <p className="page">Загрузка…</p>;

  const floor = project.floors.find((f) => f.id === activeFloor) ?? null;
  const activeFloorIndex = floor ? project.floors.findIndex((f) => f.id === floor.id) : -1;
  const highlightIds = (() => {
    if (compareWith === null) return undefined;
    const snapshot = project.snapshots.find((s) => s.id === compareWith);
    if (!snapshot) return undefined;
    const diff = diffPlacements(snapshot.placements, livePlacements(project));
    return new Set([...diff.moved.map((m) => m.object.id), ...diff.added.map((p) => p.object.id)]);
  })();
  const projectedZones = floor
    ? project.floors.flatMap((sourceFloor, sourceIndex) =>
        sourceFloor.id === floor.id
          ? []
          : sourceFloor.rooms.flatMap((room) =>
              room.zones.filter((zone) => {
                if (!zone.spansFloors) return false;
                const from = project.floors.findIndex((f) => f.id === zone.spansFloors!.fromFloorId);
                const to = project.floors.findIndex((f) => f.id === zone.spansFloors!.toFloorId);
                if (from < 0 || to < 0) return false;
                return activeFloorIndex >= Math.min(from, to) && activeFloorIndex <= Math.max(from, to) && sourceIndex !== activeFloorIndex;
              }),
            ),
      )
    : [];

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
        <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">⟲ Отменить</button>
        <button onClick={redo} disabled={!canRedo} title="Ctrl+Y">⟳ Вернуть</button>
        <button onClick={save} disabled={!dirty}>
          {dirty ? 'Сохранить изменения' : 'Сохранено'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <div className="banner ok">{notice}</div>}
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
            {project.snapshots.map((s) => (
              <li key={s.id}>
                <span>
                  <b>{s.name}</b>
                  {s.note ? ` — ${s.note}` : ''}
                  <span className="muted"> · объектов: {s.placements.length}</span>
                </span>
                <span className="row">
                  <button onClick={() => restoreSnapshot(s.id)}>Вернуть</button>
                  <button onClick={() => setCompareWith(compareWith === s.id ? null : s.id)}>
                    {compareWith === s.id ? 'Скрыть сравнение' : 'Сравнить с планом'}
                  </button>
                  <button onClick={() => deleteSnapshot(s.id)}>Удалить</button>
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
                      .map((m) => `${m.object.name} (${roomNameById(m.from.roomId)} → ${roomNameById(m.to.roomId)})`)
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
              update((p) => {
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
                  update((p) => {
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
                  update((p) => {
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
                          update((p) => {
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
                projectedZones={projectedZones}
                highlight={highlightIds}
                onChangeFloors={(floors) =>
                  update((p) => {
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
                status={(objectId) => {
                  const located = locateObject(project, objectId);
                  return located ? `${located.floor.name}: ${located.room.name}` : 'на складе';
                }}
                onCreate={(object) =>
                  update((p) => {
                    const id = allocateId(p, 'object');
                    p.counters.object = id;
                    p.objects.push({ ...object, id });
                  })
                }
                onUpdate={(object) =>
                  update((p) => {
                    const idx = p.objects.findIndex((o) => o.id === object.id);
                    if (idx >= 0) p.objects[idx] = object;
                  })
                }
                onClone={(object) =>
                  update((p) => {
                    const id = allocateId(p, 'object');
                    p.counters.object = id;
                    p.objects.push({ ...structuredClone(object), id, name: object.name + ' (копия)' });
                  })
                }
                onDelete={(objectId) =>
                  update((p) => {
                    const cleaned = deleteObject(p, objectId);
                    p.objects = cleaned.objects;
                    p.floors = cleaned.floors;
                  })
                }
                onPlace={(objectId) =>
                  update((p) => {
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
