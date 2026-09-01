import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, fileFailureMessage } from './api.ts';

test('файловые ошибки переводятся для интерфейса без показа внутренних кодов', () => {
  assert.equal(fileFailureMessage({ code: 'invalid-json' }), 'Файл содержит повреждённый JSON.');
  assert.equal(fileFailureMessage({ code: 'invalid-card' }), 'Карточка импорта не соответствует формату.');
  assert.equal(fileFailureMessage({ code: 'future-code' }), 'Файл нельзя прочитать или обработать.');
});

test('неизвестный код HTTP-ошибки не попадает в пользовательское сообщение', () => {
  const error = new ApiError(500, 'database-password-leaked');

  assert.equal(error.message, 'Сервер не смог выполнить запрос.');
  assert.equal(error.code, 'database-password-leaked');
});
