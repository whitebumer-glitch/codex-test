import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateStatistics, createEmptyState, extractFields, extractWagonNumbers, isLegacyDemoRecord, isValidWagonNumber, mergeIntoWagons } from '../core.js';

test('новое приложение запускается с пустой базой и нулевой статистикой', async () => {
  const state = createEmptyState();
  assert.deepEqual(state.documents, []);
  assert.deepEqual(state.wagons, []);
  assert.deepEqual(calculateStatistics(state.documents, state.wagons), { wagons: 0, documents: 0, inWork: 0, archived: 0, usedBytes: 0, complete: 0, review: 0 });

  const sources = await Promise.all(['../index.html', '../app.js', '../core.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.doesNotMatch(source, /initialDocuments|1 248|98,7%|32,4 ГБ|55674218|62418307/);
  }
});

test('страница содержит один рабочий интерфейс и корректную загрузку PDF', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.equal((html.match(/<main\b/g) || []).length, 1);
  assert.doesNotMatch(html, /Добрый день|Алексей|1 248|1 232|98,7|32,4 ГБ/);
  assert.match(html, /id="fileInput"[^>]+accept="application\/pdf,\.pdf"[^>]+multiple/);
  assert.match(html, /id="uploadDropZone"/);
  assert.match(app, /fileInput'\)\.addEventListener\('change'/);
  assert.match(app, /uploadDropZone'\)\.addEventListener\('drop'/);
  assert.match(app, /for \(const file of files\) await processFile\(file\)/);
  assert.doesNotMatch(app, /^import .*pdf\.min\.mjs/m);
});

test('миграция отличает встроенные записи от пользовательских документов', () => {
  assert.equal(isLegacyDemoRecord({ id: 'demo:legacy', isDemo: true }), true);
  assert.equal(isLegacyDemoRecord({ id: 'mock-old' }), true);
  assert.equal(isLegacyDemoRecord({ id: 'user-document', filename: 'document.pdf' }), false);
});

test('данные появляются только после обработки извлечённого текста документа', () => {
  const state = createEmptyState();
  const fields = extractFields('Форма ГУ-25 вагон 24547705 дата 03.09.2026 станция отправления Омск станция назначения Томск груз уголь');
  const document = { id: 'pdf-1', ...fields, needsReview: false };
  state.documents.push(document);
  mergeIntoWagons(state.wagons, document);
  assert.equal(state.documents.length, 1);
  assert.equal(state.wagons.length, 1);
  assert.equal(state.wagons[0].number, '24547705');
  assert.equal(document.type, 'ГУ-25');
});
import { extractFields, extractWagonNumbers, isValidWagonNumber, mergeIntoWagons } from '../core.js';

test('пустой текст не создаёт вымышленные данные', () => {
  assert.deepEqual(extractFields('', 'scan.pdf').wagonNumbers, []);
  assert.equal(extractFields('', 'scan.pdf').type, '');
});

test('извлекает несколько уникальных вагонов из текста', () => {
  assert.deepEqual(extractWagonNumbers('Вагоны 24547705, 52506615 и повтор 24547705.'), ['24547705', '52506615']);
});

test('проверяет контрольную цифру и формат номера', () => {
  assert.equal(isValidWagonNumber('24547705'), true);
  assert.equal(isValidWagonNumber('24547706'), false);
  assert.equal(isValidWagonNumber('123'), false);
});

test('извлекает поля из содержимого, а не только имени', () => {
  const result = extractFields('Форма ГУ-45 Вагон 24547705 дата 03.09.2026 станция отправления Томусинская станция назначения Омск прибытие 08.09.2026 груз уголь', 'unknown.pdf');
  assert.equal(result.type, 'ГУ-45');
  assert.deepEqual(result.wagonNumbers, ['24547705']);
  assert.equal(result.date, '2026-09-03');
  assert.equal(result.origin, 'Томусинская');
  assert.equal(result.destination, 'Омск');
  assert.equal(result.operationDate, '2026-09-08');
});

test('несколько документов одного вагона формируют одну карточку', () => {
  const wagons = [];
  mergeIntoWagons(wagons, { id: 'a', wagonNumbers: ['24547705'], date: '2026-09-03' });
  mergeIntoWagons(wagons, { id: 'b', wagonNumbers: ['24547705'], date: '' });
  assert.equal(wagons.length, 1);
  assert.deepEqual(wagons[0].documentIds, ['a', 'b']);
});

test('один документ связывается с несколькими карточками вагонов', () => {
  const wagons = [];
  mergeIntoWagons(wagons, { id: 'a', wagonNumbers: ['24547705', '52506615'], date: '' });
  assert.equal(wagons.length, 2);
  assert.ok(wagons.every(wagon => wagon.documentIds[0] === 'a'));
});
