import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
import { DOCUMENT_TYPES, extractFields, isValidWagonNumber, mergeIntoWagons } from './core.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const DB_NAME = 'vagondoc';
const DB_VERSION = 1;
const state = { documents: [], wagons: [], pending: null };
const $ = selector => document.querySelector(selector);
const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbRequest(store, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = operation(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function loadData() {
  state.documents = await dbRequest('documents', 'readonly', store => store.getAll());
  rebuildWagons();
  render();
}

function rebuildWagons() {
  state.wagons = [];
  state.documents.forEach(document => mergeIntoWagons(state.wagons, document));
}

async function extractPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    setProgress(0, `Извлечение текста: страница ${pageNumber} из ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return { text: pages.join('\n'), pdf };
}

async function runOcr(pdf) {
  const consent = window.confirm('В PDF нет текстового слоя. Запустить OCR локально? Библиотека и языковые данные будут загружены из CDN, но содержимое документа никуда не отправляется.');
  if (!consent) return '';
  setProgress(1, 'Загрузка локального OCR…');
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  const results = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    setProgress(1, `OCR: страница ${pageNumber} из ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const result = await window.Tesseract.recognize(canvas, 'rus+eng', { logger: message => message.progress && setProgress(1, `OCR: ${Math.round(message.progress * 100)}%`) });
    results.push(result.data.text);
  }
  return results.join('\n');
}

function loadScript(src) {
  return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.append(script); });
}

async function processFile(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return notify(`${file.name}: нужен файл PDF`);
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (state.documents.some(document => document.fingerprint === fingerprint)) return notify(`${file.name}: этот файл уже сохранён`);
  $('#progressDialog').showModal(); $('#progressFile').textContent = file.name;
  try {
    setProgress(0, 'Чтение PDF…');
    const extracted = await extractPdfText(file);
    let text = extracted.text.trim();
    if (text.length < 20) text = await runOcr(extracted.pdf);
    setProgress(1, text ? 'Поиск реквизитов…' : 'Текст не получен');
    const fields = extractFields(text, file.name);
    setProgress(2, 'Подготовка результата для проверки…');
    state.pending = { file, fields, fingerprint };
    $('#progressDialog').close();
    showReview();
  } catch (error) {
    $('#progressDialog').close();
    notify(`Не удалось прочитать ${file.name}`);
    console.error(error);
  }
}

function setProgress(index, message) {
  [...document.querySelectorAll('.steps li')].forEach((item, i) => { item.className = i < index ? 'done' : i === index ? 'active' : ''; });
  $('#progressMessage').textContent = message;
}

function showReview() {
  const { file, fields } = state.pending;
  $('#reviewFilename').textContent = file.name;
  $('#documentType').value = fields.type; $('#invoiceNumber').value = fields.invoice;
  $('#wagonNumbers').value = fields.wagonNumbers.join('\n'); $('#documentDate').value = fields.date;
  $('#operationDate').value = fields.operationDate; $('#originStation').value = fields.origin;
  $('#destinationStation').value = fields.destination; $('#extraDetails').value = fields.extra;
  $('#rawText').textContent = fields.rawText || 'Текст не извлечён';
  $('#confidenceValue').textContent = fields.rawText ? `${fields.confidence}%` : 'Не распознано';
  const warning = $('#recognitionWarning');
  warning.textContent = fields.rawText ? 'Сверьте найденные данные с оригиналом PDF. Сохранение возможно только после вашего подтверждения.' : 'Автоматическое распознавание не выполнено. Заполните известные поля вручную или не сохраняйте документ.';
  warning.classList.add('visible'); validateWagons(); $('#reviewDialog').showModal();
}

function parsedWagons() { return [...new Set($('#wagonNumbers').value.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean))]; }
function validateWagons() {
  const values = parsedWagons(); const invalidFormat = values.filter(v => !/^\d{8}$/.test(v)); const invalidCheck = values.filter(v => /^\d{8}$/.test(v) && !isValidWagonNumber(v));
  const messages = [];
  if (!values.length) messages.push('Номер вагона не распознан. Документ сохранится без привязки к вагону.');
  if (invalidFormat.length) messages.push(`Неверный формат: ${invalidFormat.join(', ')}. Нужны ровно 8 цифр.`);
  if (invalidCheck.length) messages.push(`Требуется проверка номера вагона: ${invalidCheck.join(', ')}.`);
  $('#wagonValidation').className = messages.length ? 'invalid-list' : 'invalid-list validation-ok';
  $('#wagonValidation').textContent = messages.join(' ');
  return { values: values.filter(v => /^\d{8}$/.test(v)), needsReview: messages.length > 0 };
}

async function savePending(event) {
  event.preventDefault();
  const validation = validateWagons();
  const document = { id: crypto.randomUUID(), fingerprint: state.pending.fingerprint, filename: state.pending.file.name, type: $('#documentType').value, wagonNumbers: validation.values, invoice: $('#invoiceNumber').value.trim(), date: $('#documentDate').value, operationDate: $('#operationDate').value, origin: $('#originStation').value.trim(), destination: $('#destinationStation').value.trim(), extra: $('#extraDetails').value.trim(), confidence: state.pending.fields.confidence, needsReview: validation.needsReview || !$('#documentType').value || !state.pending.fields.rawText, savedAt: new Date().toISOString() };
  await dbRequest('documents', 'readwrite', store => store.put(document));
  await dbRequest('files', 'readwrite', store => store.put({ id: document.id, blob: state.pending.file }));
  state.documents.push(document); rebuildWagons(); state.pending = null; $('#reviewDialog').close(); render(); notify('Документ сохранён локально');
}

function docsFor(wagon) { return state.documents.filter(doc => wagon.documentIds.includes(doc.id)); }
function hasType(wagon, type) { return docsFor(wagon).some(doc => doc.type === type); }
function filteredWagons() {
  const search = $('#searchFilter').value.trim(), year = $('#yearFilter').value, month = $('#monthFilter').value, type = $('#typeFilter').value, presence = $('#presenceFilter').value;
  return state.wagons.filter(wagon => {
    const date = wagon.shipmentDate ? new Date(`${wagon.shipmentDate}T00:00:00`) : null;
    const complete = DOCUMENT_TYPES.every(t => hasType(wagon, t));
    return (!search || wagon.number.includes(search)) && (!year || String(date?.getFullYear()) === year) && (!month || String((date?.getMonth() ?? -1) + 1) === month) && (!type || hasType(wagon, type)) && (!presence || (presence === 'complete') === complete);
  });
}

function render() {
  const complete = state.wagons.filter(w => DOCUMENT_TYPES.every(t => hasType(w, t))).length;
  $('#statWagons').textContent = state.wagons.length; $('#statDocuments').textContent = state.documents.length; $('#statComplete').textContent = complete; $('#statReview').textContent = state.documents.filter(d => d.needsReview).length;
  const wagons = filteredWagons();
  $('#wagonRows').innerHTML = wagons.map(wagon => { const date = wagon.shipmentDate ? new Date(`${wagon.shipmentDate}T00:00:00`) : null; return `<tr><td><button class="wagon-link" data-wagon="${wagon.number}">${wagon.number}${wagon.needsReview ? ' ⚠' : ''}</button></td><td>${date ? monthNames[date.getMonth()] : 'Не распознано'}</td><td>${date ? date.getFullYear() : 'Не распознано'}</td>${DOCUMENT_TYPES.map(type => `<td>${hasType(wagon,type) ? '<span class="check">✓</span>' : ''}</td>`).join('')}<td><button class="wagon-link" data-wagon="${wagon.number}">Открыть</button></td></tr>`; }).join('');
  $('#emptyState').classList.toggle('visible', state.wagons.length === 0);
  $('#documentList').innerHTML = state.documents.length ? state.documents.map(doc => `<div class="doc-row"><span class="pdf">PDF</span><div><strong>${escapeHtml(doc.filename)}</strong><small>${doc.type || 'Тип не распознан'}</small></div><div><strong>${doc.wagonNumbers.join(', ') || 'Не распознано'}</strong><small>Вагон</small></div><div><strong>${doc.date || 'Не распознано'}</strong><small>Дата документа</small></div><button data-file="${doc.id}">Открыть PDF</button></div>`).join('') : '<div class="empty visible"><p>Сохранённых документов нет.</p></div>';
  updateFilterOptions();
}

function updateFilterOptions() {
  const selected = $('#yearFilter').value; const years = [...new Set(state.wagons.map(w => w.shipmentDate?.slice(0,4)).filter(Boolean))].sort().reverse();
  $('#yearFilter').innerHTML = '<option value="">Все годы</option>' + years.map(y => `<option ${y===selected?'selected':''}>${y}</option>`).join('');
  const monthSelected = $('#monthFilter').value; $('#monthFilter').innerHTML = '<option value="">Все месяцы</option>' + monthNames.map((m,i) => `<option value="${i+1}" ${String(i+1)===monthSelected?'selected':''}>${m}</option>`).join('');
}

async function openFile(id) { const item = await dbRequest('files','readonly',store => store.get(id)); if (!item) return notify('Исходный файл не найден'); window.open(URL.createObjectURL(item.blob), '_blank', 'noopener'); }
function showWagon(number) { const wagon = state.wagons.find(w => w.number === number); $('#wagonDetails').innerHTML = `<h2>Вагон ${number}</h2>${wagon.needsReview?'<p class="validation-bad">⚠ Требуется проверка номера вагона</p>':''}<p>Документы, связанные с карточкой:</p>${docsFor(wagon).map(doc=>`<div class="file-card"><div><b>${doc.type || 'Тип не распознан'}</b><small>${escapeHtml(doc.filename)}</small></div><button data-file="${doc.id}">Открыть PDF</button></div>`).join('')}`; $('#wagonDialog').showModal(); }
function escapeHtml(value) { const element = document.createElement('div'); element.textContent = value; return element.innerHTML; }
function notify(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); setTimeout(() => $('#toast').classList.remove('visible'), 3500); }

$('#uploadButton').onclick = () => $('#fileInput').click(); $('#emptyState button').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = async event => { for (const file of event.target.files) await processFile(file); event.target.value=''; };
$('#wagonNumbers').oninput = validateWagons; $('#reviewForm').onsubmit = savePending;
$('#discardButton').onclick = () => { state.pending=null; $('#reviewDialog').close(); notify('Документ не сохранён'); };
document.addEventListener('click', event => { const file = event.target.closest('[data-file]'); const wagon = event.target.closest('[data-wagon]'); if(file) openFile(file.dataset.file); if(wagon) showWagon(wagon.dataset.wagon); });
['#searchFilter','#yearFilter','#monthFilter','#typeFilter','#presenceFilter'].forEach(selector => $(selector).addEventListener('input', render));
$('#exportButton').onclick = () => { const data = filteredWagons().map(w => ({ wagonNumber:w.number, shipmentDate:w.shipmentDate||'', documents:Object.fromEntries(DOCUMENT_TYPES.map(t=>[t,hasType(w,t)])) })); const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); const link=document.createElement('a');link.href=url;link.download='reestr-vagonov.json';link.click();URL.revokeObjectURL(url); };

loadData().catch(error => { console.error(error); notify('Локальное хранилище недоступно'); });
