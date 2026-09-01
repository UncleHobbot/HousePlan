import type { AssistantCard, Project, SceneObject } from '@houseplan/shared';

export interface ProjectDocument {
  project: Project;
  token: string;
}

export interface FileIssue {
  code: string;
  path: string;
  details?: Record<string, unknown>;
}

export interface FileFailure {
  code: string;
  issues?: FileIssue[];
}

export type ProjectSummary =
  | { name: string; status: 'ready'; floors: number; objects: number }
  | { name: string; status: 'invalid'; error: FileFailure };

export type ImportCard =
  | { file: string; status: 'ready'; card: AssistantCard }
  | { file: string; status: 'invalid'; error: FileFailure };

const ERROR_MESSAGES: Record<string, string> = {
  'stale-project': 'На диске есть более новая версия проекта.',
  'invalid-project': 'Файл проекта не соответствует формату.',
  'unknown-field': 'Файл содержит неподдерживаемое поле.',
  'invalid-json': 'Файл содержит повреждённый JSON.',
  'invalid-project-name': 'Название проекта нельзя использовать как имя папки.',
  'project-name-mismatch': 'Имя внутри проекта не совпадает с именем папки.',
  'project-exists': 'Проект с таким названием уже существует.',
  'project-not-found': 'Проект не найден.',
  'invalid-card': 'Карточка импорта не соответствует формату.',
  'invalid-import-file': 'Имя файла импорта недопустимо.',
  'asset-missing': 'Не найден файл изображения из карточки импорта.',
  'asset-conflict': 'Изображение с таким именем уже существует и отличается по содержимому.',
  'import-conflict': 'Этот импорт уже был принят с другим содержимым.',
  'import-not-found': 'Карточка импорта не найдена.',
  'request-too-large': 'Отправленный файл или запрос слишком большой.',
  'transition-conflict': 'Незавершённую файловую операцию нельзя безопасно восстановить автоматически.',
  'internal-error': 'Сервер не смог выполнить запрос из-за внутренней ошибки.',
};

export function fileFailureMessage(failure: FileFailure): string {
  return ERROR_MESSAGES[failure.code] ?? 'Файл нельзя прочитать или обработать.';
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly issues?: FileIssue[],
  ) {
    super(ERROR_MESSAGES[code] ?? 'Сервер не смог выполнить запрос.');
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      error?: string | { code?: string; issues?: FileIssue[] };
    };
    const error = body.error;
    const code = typeof error === 'object' && error?.code
      ? error.code
      : typeof error === 'string' ? error : `http-${response.status}`;
    throw new ApiError(response.status, code, typeof error === 'object' ? error?.issues : undefined);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<ProjectSummary[]>('/api/projects'),
  createProject: (name: string) =>
    request<ProjectDocument>('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  readProject: (name: string) => request<ProjectDocument>(`/api/projects/${encodeURIComponent(name)}`),
  saveProject: (name: string, project: Project, expectedToken: string, force = false) =>
    request<ProjectDocument>(`/api/projects/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ project, expectedToken, force }),
    }),
  renameProject: (name: string, newName: string, expectedToken: string) =>
    request<ProjectDocument>(`/api/projects/${encodeURIComponent(name)}/rename`, {
      method: 'POST',
      body: JSON.stringify({ name: newName, expectedToken }),
    }),
  listImport: () => request<ImportCard[]>('/api/import'),
  acceptImport: (file: string, projectName: string, expectedToken: string) =>
    request<{ document: ProjectDocument; object: SceneObject }>('/api/import/accept', {
      method: 'POST',
      body: JSON.stringify({ file, project: projectName, expectedToken }),
    }),
  rejectImport: (file: string) =>
    request<{ ok: true }>('/api/import/reject', { method: 'POST', body: JSON.stringify({ file }) }),
};
