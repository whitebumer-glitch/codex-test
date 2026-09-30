export const DOCUMENT_TYPES = ['ГУ-25', 'ГУ-2Б', 'ГУ-2В', 'ГУ-46', 'ГУ-45', 'ЖД накладная'];

export function createEmptyState() {
  return { documents: [], wagons: [], pending: null };
}

export function calculateStatistics(documents, wagons) {
  const complete = wagons.filter(wagon => DOCUMENT_TYPES.every(type =>
    documents.some(document => wagon.documentIds.includes(document.id) && document.type === type)
  )).length;
  return {
    wagons: wagons.length,
    documents: documents.length,
    inWork: wagons.filter(wagon => !DOCUMENT_TYPES.every(type =>
      documents.some(document => wagon.documentIds.includes(document.id) && document.type === type)
    )).length,
    archived: documents.length,
    usedBytes: documents.reduce((total, document) => total + (Number(document.fileSize) || 0), 0),
    complete,
    review: documents.filter(document => document.needsReview).length,
  };
}

export function isLegacyDemoRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const id = String(record.id || '').toLowerCase();
  return record.isDemo === true || record.source === 'demo' || /^(demo|mock|sample)[-_:]/.test(id);
}
export const DOCUMENT_TYPES = ['ГУ-2Б', 'ГУ-2В', 'ГУ-46', 'ГУ-45', 'ЖД накладная'];

export function isValidWagonNumber(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 7).reduce((total, digit, index) => {
    const product = digit * (index % 2 === 0 ? 2 : 1);
    return total + Math.floor(product / 10) + (product % 10);
  }, 0);
  return (10 - (sum % 10)) % 10 === digits[7];
}

export function extractWagonNumbers(text) {
  return [...new Set((text.match(/(?<!\d)\d{8}(?!\d)/g) || []))];
}

export function extractFields(text, filename = '') {
  const clean = text.replace(/\s+/g, ' ').trim();
  const upper = clean.toUpperCase();
  let type = '';
  if (/ГУ[\s–—-]*25/.test(upper)) type = 'ГУ-25';
  else if (/ГУ[\s–—-]*2[\s–—-]*Б/.test(upper)) type = 'ГУ-2Б';
  if (/ГУ[\s–—-]*2[\s–—-]*Б/.test(upper)) type = 'ГУ-2Б';
  else if (/ГУ[\s–—-]*2[\s–—-]*В/.test(upper)) type = 'ГУ-2В';
  else if (/ГУ[\s–—-]*46/.test(upper)) type = 'ГУ-46';
  else if (/ГУ[\s–—-]*45/.test(upper)) type = 'ГУ-45';
  else if (/НАКЛАДН(?:АЯ|ОЙ)|ДОСЫЛОЧНАЯ ВЕДОМОСТЬ/.test(upper)) type = 'ЖД накладная';
  if (!type) type = DOCUMENT_TYPES.find(t => filename.toUpperCase().replace(/[\s_–—-]/g, '').includes(t.replace(/[\s–—-]/g, ''))) || '';
  const invoice = clean.match(/(?:накладн(?:ая|ой)|№\s*накл)[^№\d]{0,20}(?:№\s*)?([А-ЯA-Z0-9-]{4,20})/i)?.[1] || '';
  const dateRaw = clean.match(/(?:дата|от)\s*[:№]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i)?.[1] || '';
  const operationDateRaw = clean.match(/(?:прибыт(?:ия|ие)|подач(?:и|а)|уборк(?:и|а))\s*[:№]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i)?.[1] || '';
  const stations = [...clean.matchAll(/станци(?:я|и)\s+(?:отправления|назначения)\s*[:—-]?\s*([А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z\s-]{2,40}?)(?=\s+(?:станци|дата|вагон|груз|прибыт|подач|уборк|$))/gi)].map(m => m[1].trim());
  const wagonNumbers = extractWagonNumbers(clean);
  const known = [type, invoice, dateRaw, stations[0], wagonNumbers.length].filter(Boolean).length;
  return { type, wagonNumbers, invoice, date: normalizeDate(dateRaw), origin: stations[0] || '', destination: stations[1] || '', operationDate: normalizeDate(operationDateRaw), extra: '', confidence: Math.min(95, Math.round((known / 5) * 100)), rawText: text };
}

function normalizeDate(value) {
  if (!value) return '';
  const parts = value.split(/[./-]/);
  let [day, month, year] = parts;
  if (year.length === 2) year = `20${year}`;
  const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : '';
}

export function mergeIntoWagons(wagons, document) {
  for (const number of document.wagonNumbers) {
    let wagon = wagons.find(item => item.number === number);
    if (!wagon) { wagon = { number, documentIds: [], shipmentDate: document.date || '', needsReview: !isValidWagonNumber(number) }; wagons.push(wagon); }
    if (!wagon.documentIds.includes(document.id)) wagon.documentIds.push(document.id);
    if (!wagon.shipmentDate && document.date) wagon.shipmentDate = document.date;
    wagon.needsReview ||= !isValidWagonNumber(number);
  }
  return wagons;
}
