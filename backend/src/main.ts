import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT_VERSION } from '@houseplan/shared';
import { createProjectFiles, type ProjectFileFailure } from './projectFiles.js';

const modulePath = fileURLToPath(import.meta.url);
const moduleDirectory = path.dirname(modulePath);
const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? path.join(moduleDirectory, '..', '..', 'data');
const FRONTEND_DIST = path.join(moduleDirectory, '..', '..', 'frontend', 'dist');

type Handler = (req: express.Request, res: express.Response) => Promise<void>;

function asyncHandler(handler: Handler): express.RequestHandler {
  return (req, res) => {
    handler(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : 'внутренняя ошибка';
      if (!res.headersSent) res.status(500).json({ error: { code: 'internal-error', message } });
    });
  };
}

function errorStatus(error: ProjectFileFailure): number {
  if (error.code === 'project-not-found' || error.code === 'import-not-found') return 404;
  if (error.code === 'project-exists' || error.code === 'stale-project' || error.code.endsWith('-conflict')) return 409;
  return 400;
}

function sendFailure(res: express.Response, error: ProjectFileFailure): void {
  res.status(errorStatus(error)).json({ error });
}

export function createApp(dataDirectory = DATA_DIR): express.Express {
  const app = express();
  const projectFiles = createProjectFiles(dataDirectory);
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/version', (_req, res) => {
    res.json({ formatVersion: FORMAT_VERSION });
  });

  app.get('/api/projects', asyncHandler(async (_req, res) => {
    const result = await projectFiles.list();
    if (!result.ok) return sendFailure(res, result.error);
    res.json(result.value);
  }));

  app.post('/api/projects', asyncHandler(async (req, res) => {
    const result = await projectFiles.create(String(req.body?.name ?? ''));
    if (!result.ok) return sendFailure(res, result.error);
    res.status(201).json(result.value);
  }));

  app.get('/api/projects/:name', asyncHandler(async (req, res) => {
    const result = await projectFiles.read(req.params.name);
    if (!result.ok) return sendFailure(res, result.error);
    res.json(result.value);
  }));

  app.put('/api/projects/:name', asyncHandler(async (req, res) => {
    const result = await projectFiles.save(req.params.name, req.body?.project, {
      expectedToken: String(req.body?.expectedToken ?? ''),
      force: req.body?.force === true,
    });
    if (!result.ok) return sendFailure(res, result.error);
    res.json(result.value);
  }));

  app.post('/api/projects/:name/rename', asyncHandler(async (req, res) => {
    const result = await projectFiles.rename(req.params.name, String(req.body?.name ?? ''), {
      expectedToken: String(req.body?.expectedToken ?? ''),
    });
    if (!result.ok) return sendFailure(res, result.error);
    res.json(result.value);
  }));

  app.get('/api/import', asyncHandler(async (_req, res) => {
    const result = await projectFiles.listImports();
    if (!result.ok) return sendFailure(res, result.error);
    res.json(result.value);
  }));

  app.post('/api/import/accept', asyncHandler(async (req, res) => {
    const result = await projectFiles.acceptImport(
      String(req.body?.file ?? ''),
      String(req.body?.project ?? ''),
      { expectedToken: String(req.body?.expectedToken ?? '') },
    );
    if (!result.ok) return sendFailure(res, result.error);
    res.json(result.value);
  }));

  app.post('/api/import/reject', asyncHandler(async (req, res) => {
    const result = await projectFiles.rejectImport(String(req.body?.file ?? ''));
    if (!result.ok) return sendFailure(res, result.error);
    res.json({ ok: true });
  }));

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const parserError = error as { status?: number; type?: string };
    if (parserError.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid-json' } });
      return;
    }
    if (parserError.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'request-too-large' } });
      return;
    }
    next(error);
  });

  app.use(express.static(FRONTEND_DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(modulePath)) {
  createApp().listen(PORT, () => {
    console.log(`HousePlan: http://localhost:${PORT} (данные: ${DATA_DIR})`);
  });
}
