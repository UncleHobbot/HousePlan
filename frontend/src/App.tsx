import { useEffect, useState } from 'react';
import type { Floor, Project } from '@houseplan/shared';
import { api, type ProjectSummary } from './api';
import { PlanView } from './PlanView';
import { RoomEditor } from './editor/RoomEditor';

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

  useEffect(() => {
    api
      .readProject(name)
      .then((p) => {
        setProject(p);
        setActiveFloor(p.floors[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [name]);

  function update(change: (p: Project) => void) {
    setProject((current) => {
      if (!current) return current;
      const copy = structuredClone(current);
      change(copy);
      setDirty(true);
      return copy;
    });
  }

  function addFloor() {
    if (!project) return;
    update((p) => {
      const id = (p.counters.floor ?? 0) + 1;
      p.counters.floor = id;
      p.floors.push({
        id,
        name: `${p.floors.length + 1}-й этаж`,
        ceilingHeightCm: 260,
        shell: { contour: { points: [], thicknesses: {}, locks: [], closed: false }, openings: [] },
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
        editingRoomId !== null && floor.rooms.some((r) => r.id === editingRoomId) ? (
          (() => {
            const room = floor.rooms.find((r) => r.id === editingRoomId)!;
            return (
              <RoomEditor
                roomName={room.name}
                contour={room.contour}
                zones={room.zones}
                floors={project.floors}
                floorId={floor.id}
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
                onDone={() => setEditingRoomId(null)}
              />
            );
          })()
        ) : (
          <>
            <div className="row">
              <b>{floor.name}</b>
              <span className="muted">потолок: {floor.ceilingHeightCm} см</span>
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
            <PlanView floor={floor} />
          </>
        )
      ) : (
        <p>Добавьте этаж — и рисуйте.</p>
      )}
    </div>
  );
}
