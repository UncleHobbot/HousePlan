import { useEffect, useRef, useState } from 'react';
import type { Contour, Floor, Project } from '@houseplan/shared';
import { api, type ProjectSummary } from './api';
import { FloorView } from './FloorView';
import { RoomEditor } from './editor/RoomEditor';
import { StockPanel } from './StockPanel';

function bboxArea(c: Contour): number {
  const xs = c.points.map((p) => p.x);
  const ys = c.points.map((p) => p.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

type ProjectIdKind = keyof Project['counters'];

function synchroniseCounters(project: Project): void {
  const ids: Record<ProjectIdKind, number[]> = {
    floor: [], room: [], point: [], opening: [], zone: [], object: [], snapshot: [],
  };
  for (const floor of project.floors) {
    ids.floor.push(floor.id);
    ids.point.push(...floor.shell.contour.points.map((point) => point.id));
    ids.opening.push(...floor.shell.openings.map((opening) => opening.id));
    for (const room of floor.rooms) {
      ids.room.push(room.id);
      ids.point.push(...room.contour.points.map((point) => point.id));
      ids.opening.push(...room.openings.map((opening) => opening.id));
      ids.zone.push(...room.zones.map((zone) => zone.id));
      ids.point.push(...room.zones.flatMap((zone) => zone.points.map((point) => point.id)));
    }
  }
  ids.object.push(...project.objects.map((object) => object.id));
  ids.snapshot.push(...project.snapshots.map((snapshot) => snapshot.id));
  for (const kind of Object.keys(ids) as ProjectIdKind[]) {
    project.counters[kind] = Math.max(project.counters[kind] ?? 0, 0, ...ids[kind]);
  }
}

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

function ProjectPage({ name, onExit }: { name: string; onExit: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [activeFloor, setActiveFloor] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<number | null>(null);
  const [editingShell, setEditingShell] = useState(false);
  const idCounters = useRef<Project['counters']>({});

  useEffect(() => {
    api
      .readProject(name)
      .then((p) => {
        synchroniseCounters(p);
        idCounters.current = { ...p.counters };
        setProject(p);
        setActiveFloor(p.floors[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [name]);

  function update(change: (p: Project) => void) {
    setDirty(true);
    setProject((current) => {
      if (!current) return current;
      const copy = structuredClone(current);
      change(copy);
      for (const kind of ['point', 'opening', 'zone'] as const) {
        copy.counters[kind] = Math.max(copy.counters[kind] ?? 0, idCounters.current[kind] ?? 0);
      }
      return copy;
    });
  }

  function allocateId(kind: ProjectIdKind): number {
    const id = (idCounters.current[kind] ?? 0) + 1;
    idCounters.current[kind] = id;
    return id;
  }

  function addFloor() {
    if (!project) return;
    update((p) => {
      const id = (p.counters.floor ?? 0) + 1;
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
    const id = (project.counters.room ?? 0) + 1;
    update((p) => {
      const f = p.floors.find((f) => f.id === floor.id)!;
      p.counters.room = id;
      f.rooms.push({
        id,
        name: `Комната ${id}`,
        contour: { points: [], thicknesses: {}, locks: [], closed: false },
        openings: [],
        zones: [],
        placements: [],
      });
    });
    setEditingRoomId(id);
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
        <span className="spacer" />
        <button onClick={save} disabled={!dirty}>
          {dirty ? 'Сохранить изменения' : 'Сохранено'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
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
            roomName="Оболочка этажа"
            contour={floor.shell.contour}
            zones={[]}
            openings={floor.shell.openings}
            floors={project.floors}
            floorId={floor.id}
            shellMode
            openingKinds={['window', 'entryDoor']}
            allocateId={allocateId}
            onChangeContour={(c) =>
              update((p) => {
                p.floors.find((f) => f.id === floor.id)!.shell.contour = c;
              })
            }
            onChangeZones={() => {}}
            onChangeOpenings={(o) =>
              update((p) => {
                p.floors.find((f) => f.id === floor.id)!.shell.openings = o;
              })
            }
            onDone={() => setEditingShell(false)}
          />
        ) : editingRoomId !== null && floor.rooms.some((r) => r.id === editingRoomId) ? (
          (() => {
            const room = floor.rooms.find((r) => r.id === editingRoomId)!;
            return (
              <RoomEditor
                roomName={room.name}
                contour={room.contour}
                zones={room.zones}
                openings={room.openings}
                floors={project.floors}
                floorId={floor.id}
                shellMode={false}
                openingKinds={['innerDoor']}
                allocateId={allocateId}
                onChangeContour={(c) =>
                  update((p) => {
                    const f = p.floors.find((f) => f.id === floor.id)!;
                    const r = f.rooms.find((r) => r.id === editingRoomId)!;
                    r.contour = c;
                  })
                }
                onChangeZones={(z) =>
                  update((p) => {
                    const f = p.floors.find((f) => f.id === floor.id)!;
                    const r = f.rooms.find((r) => r.id === editingRoomId)!;
                    r.zones = z;
                  })
                }
                onChangeOpenings={(o) =>
                  update((p) => {
                    const f = p.floors.find((f) => f.id === floor.id)!;
                    const r = f.rooms.find((r) => r.id === editingRoomId)!;
                    r.openings = o;
                  })
                }
                onDone={() => setEditingRoomId(null)}
              />
            );
          })()
        ) : (
          <>
            <div className="row">
              <b>{floor.name}</b>
              <span className="muted">потолок: {floor.ceilingHeightCm} см</span>
              <button onClick={() => setEditingShell(true)}>
                {floor.shell.contour.closed ? 'Редактировать оболочку' : 'Нарисовать оболочку'}
              </button>
              <button onClick={() => startDrawingRoom(floor)}>+ Нарисовать помещение</button>
            </div>
            {floor.rooms.length === 0 ? (
              <p className="muted">На этаже пока нет помещений. Нажмите «Нарисовать помещение».</p>
            ) : (
              <ul>
                {floor.rooms.map((r) => (
                  <li key={r.id}>
                    <span className="row">
                      {r.name} — {r.contour.closed ? `${r.contour.points.length} углов` : 'недорисовано'}
                      {', объектов: '}
                      {r.placements.length}
                      <button onClick={() => setEditingRoomId(r.id)}>
                        {r.contour.closed ? 'Редактировать' : 'Продолжить рисование'}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="floor-grid">
              <FloorView
                floor={floor}
                objects={project.objects}
                projectedZones={projectedZones}
                onChangeFloor={(f) =>
                  update((p) => {
                    const placedHere = new Set(f.rooms.flatMap((room) => room.placements.map((placement) => placement.objectId)));
                    for (const projectFloor of p.floors) {
                      if (projectFloor.id === floor.id) {
                        projectFloor.rooms = f.rooms;
                      } else {
                        for (const room of projectFloor.rooms) {
                          room.placements = room.placements.filter((placement) => !placedHere.has(placement.objectId));
                        }
                      }
                    }
                  })
                }
              />
              <StockPanel
                objects={project.objects}
                status={(objectId) => {
                  for (const f of project.floors) {
                    for (const r of f.rooms) {
                      if (r.placements.some((pl) => pl.objectId === objectId)) return `${f.name}: ${r.name}`;
                    }
                  }
                  return 'на складе';
                }}
                onCreate={(object) =>
                  update((p) => {
                    const id = (p.counters.object ?? 0) + 1;
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
                    const id = (p.counters.object ?? 0) + 1;
                    p.counters.object = id;
                    p.objects.push({ ...structuredClone(object), id, name: object.name + ' (копия)' });
                  })
                }
                onDelete={(objectId) =>
                  update((p) => {
                    p.objects = p.objects.filter((o) => o.id !== objectId);
                    for (const f of p.floors) {
                      for (const r of f.rooms) {
                        r.placements = r.placements.filter((pl) => pl.objectId !== objectId);
                      }
                    }
                  })
                }
                onPlace={(objectId) =>
                  update((p) => {
                    const f = p.floors.find((f2) => f2.id === floor.id)!;
                    const room = [...f.rooms].filter((r) => r.contour.closed).sort((a, b) => bboxArea(b.contour) - bboxArea(a.contour))[0];
                    if (!room) return;
                    const cx = Math.round(room.contour.points.reduce((a, pt) => a + pt.x, 0) / room.contour.points.length);
                    const cy = Math.round(room.contour.points.reduce((a, pt) => a + pt.y, 0) / room.contour.points.length);
                    for (const projectFloor of p.floors) {
                      for (const projectRoom of projectFloor.rooms) {
                        projectRoom.placements = projectRoom.placements.filter((pl) => pl.objectId !== objectId);
                      }
                    }
                    room.placements.push({ objectId, roomId: room.id, x: cx, y: cy, rotationDeg: 0 });
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
