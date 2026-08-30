import type { AssistantCard, Project, SceneObject } from '@houseplan/shared';

export interface ProjectSummary {
  name: string;
  floors: number;
  objects: number;
}

export interface ImportCard {
  file: string;
  card: AssistantCard;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `ошибка ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  createProject: (name: string) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  readProject: (name: string) => request<Project>(`/api/projects/${encodeURIComponent(name)}`),
  saveProject: (name: string, project: Project) =>
    request<{ ok: true }>(`/api/projects/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    }),
  renameProject: (name: string, newName: string) =>
    request<{ ok: true; name: string; project: Project }>(`/api/projects/${encodeURIComponent(name)}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name: newName }),
    }),
  listImport: () => request<ImportCard[]>('/api/import'),
  acceptImport: (file: string, projectName: string) =>
    request<{ project: Project; object: SceneObject }>('/api/import/accept', {
      method: 'POST',
      body: JSON.stringify({ file, project: projectName }),
    }),
  rejectImport: (file: string) =>
    request<{ ok: true }>('/api/import/reject', { method: 'POST', body: JSON.stringify({ file }) }),
};
