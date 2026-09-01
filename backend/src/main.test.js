import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './main.ts';

const temporaryDirectories = [];
const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function startApi() {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'houseplan-api-'));
  temporaryDirectories.push(dataDirectory);
  const server = await new Promise((resolve) => {
    const listening = createApp(dataDirectory).listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  const address = server.address();
  return { dataDirectory, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('HTTP использует документ с токеном и возвращает структурированный stale-конфликт', async () => {
  const { baseUrl } = await startApi();
  const createdResponse = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Дом' }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.project.name, 'Дом');
  assert.match(created.token, /^[a-f0-9]{64}$/);

  const savedResponse = await fetch(`${baseUrl}/api/projects/%D0%94%D0%BE%D0%BC`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: created.project, expectedToken: created.token }),
  });
  assert.equal(savedResponse.status, 200);
  const staleResponse = await fetch(`${baseUrl}/api/projects/%D0%94%D0%BE%D0%BC`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: created.project, expectedToken: '0'.repeat(64) }),
  });
  assert.equal(staleResponse.status, 409);
  assert.deepEqual(await staleResponse.json(), { error: { code: 'stale-project' } });
});

test('HTTP-каталог не скрывает повреждённый проект', async () => {
  const { baseUrl, dataDirectory } = await startApi();
  const directory = path.join(dataDirectory, 'проекты', 'Сломан');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'план.json'), '{', 'utf8');

  const response = await fetch(`${baseUrl}/api/projects`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{
    name: 'Сломан',
    status: 'invalid',
    error: { code: 'invalid-json', issues: [{ code: 'invalid-json', path: '/' }] },
  }]);
});

test('HTTP возвращает структурированную ошибку для синтаксически неверного JSON', async () => {
  const { baseUrl } = await startApi();

  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: 'invalid-json' } });
});
