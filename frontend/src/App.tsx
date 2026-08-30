import { useEffect, useState } from 'react';
import type { Floor, Project } from '@houseplan/shared';
import { api, type ProjectSummary } from './api';
import { PlanView } from './PlanView';

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
        shell: { contour: { points: [], thicknesses: {}, locks: [] }, openings: [] },
        rooms: [],
      });
      setActiveFloor(id);
    });
  }

  function addRoom(floor: Floor) {
    update((p) => {
      const f = p.floors.find((f) => f.id === floor.id)!;
      const id = (p.counters.room ?? 0) + 1;
      p.counters.room = id;
      const originX = 100 + f.rooms.length * 50;
      const originY = 100 + f.rooms.length * 50;
      const w = 400;
      const h = 300;
      const pts = [0, 1, 2, 3].map((k) => {
        const pid = (p.counters.point ?? 0) + 1;
        p.counters.point = pid;
        return {
          id: pid,
          x: originX + (k === 1 || k === 2 ? w : 0),
          y: originY + (k === 2 || k === 3 ? h : 0),
        };
      });
      const thicknesses: Record<number, number> = {};
      for (const pt of pts) thicknesses[pt.id] = 10;
      f.rooms.push({
        id,
        name: `Комната ${id}`,
        contour: { points: pts, thicknesses, locks: [] },
        openings: [],
        zones: [],
        placements: [],
      });
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
        <>
          <div className="row">
            <b>{floor.name}</b>
            <span className="muted">потолок: {floor.ceilingHeightCm} см</span>
            <button onClick={() => addRoom(floor)}>+ Помещение</button>
          </div>
          <PlanView floor={floor} />
          <ul>
            {floor.rooms.map((r) => (
              <li key={r.id}>
                {r.name} — {r.contour.points.length} углов, объектов: {r.placements.length}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>На этаже пусто. Добавьте этаж или помещение.</p>
      )}
    </div>
  );
}
