import test from 'node:test';
import assert from 'node:assert/strict';
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
