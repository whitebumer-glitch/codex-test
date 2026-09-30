const initialDocuments = [
  { type: 'ГУ-45', wagon: '55674218', station: 'Томусинская', time: 'Сегодня, 10:42', size: '1,8 МБ' },
  { type: 'ГУ-2В', wagon: '62418307', station: 'Ерунаково', time: 'Сегодня, 09:18', size: '2,1 МБ' },
  { type: 'ГУ-46', wagon: '54892173', station: 'Томусинская', time: 'Вчера, 17:56', size: '980 КБ' },
  { type: 'ГУ-2Б', wagon: '60274815', station: 'Междуреченск', time: 'Вчера, 16:21', size: '1,4 МБ' },
];

const wagons = [
  { number: '55674218', docs: [1, 1, 1, 1] },
  { number: '62418307', docs: [1, 1, 1, 0] },
  { number: '54892173', docs: [1, 0, 1, 1] },
  { number: '60274815', docs: [1, 1, 0, 0] },
  { number: '58921406', docs: [1, 1, 1, 1] },
];

const rows = document.querySelector('#documentRows');
const wagonRows = document.querySelector('#wagonRows');
const toast = document.querySelector('#toast');
const dialog = document.querySelector('#uploadDialog');

function renderDocuments() {
  rows.innerHTML = initialDocuments.map((doc) => `<tr>
    <td><div class="doc-name"><span class="pdf-icon">PDF</span><div><strong>${doc.type} · ${doc.wagon}</strong><small>${doc.size}</small></div></div></td>
    <td><strong>${doc.wagon}</strong></td><td>${doc.station}</td><td>${doc.time}</td>
    <td><span class="status">✓ Распознан</span></td><td><button class="dots" aria-label="Действия">⋮</button></td></tr>`).join('');
}

function renderWagons() {
  wagonRows.innerHTML = wagons.map(({ number, docs }) => {
    const count = docs.filter(Boolean).length;
    const marks = docs.map((item) => `<td><span class="${item ? 'check' : 'missing'}">${item ? '✓' : '—'}</span></td>`).join('');
    return `<tr><td><strong>${number}</strong></td>${marks}<td><div class="progress"><span class="bar"><i style="width:${count * 25}%"></i></span><b>${count}/4</b></div></td></tr>`;
  }).join('');
}

function identifyType(name) {
  const normalized = name.toUpperCase().replace(/[\s_–—-]/g, '');
  const match = ['ГУ-2Б', 'ГУ-2В', 'ГУ-45', 'ГУ-46'].find((type) => normalized.includes(type.replace('-', '')));
  return match || 'ГУ-45';
}

function processFiles(fileList) {
  const files = [...fileList].filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  if (!files.length) return showToast('Выберите файлы в формате PDF');
  files.forEach((file) => {
    const wagon = file.name.match(/\d{8}/)?.[0] || String(65000000 + Math.floor(Math.random() * 999999));
    const documentType = identifyType(file.name);
    initialDocuments.unshift({ type: documentType, wagon, station: 'Определяется', time: 'Только что', size: `${(file.size / 1048576).toFixed(1)} МБ` });
    let record = wagons.find((item) => item.number === wagon);
    if (!record) { record = { number: wagon, docs: [0, 0, 0, 0] }; wagons.unshift(record); }
    const typeIndex = ['ГУ-2Б', 'ГУ-2В', 'ГУ-45', 'ГУ-46'].indexOf(documentType);
    record.docs[typeIndex] = 1;
  });
  renderDocuments(); renderWagons();
  document.querySelector('#navCount').textContent = 24 + files.length;
  dialog.close();
  showToast(`${files.length} ${files.length === 1 ? 'файл добавлен' : 'файла добавлено'} в архив`);
}

function showToast(message) {
  document.querySelector('#toastText').textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

document.querySelector('#openUpload').addEventListener('click', () => dialog.showModal());
dialog.querySelector('.close').addEventListener('click', () => dialog.close());
document.querySelector('#fileInput').addEventListener('change', (event) => processFiles(event.target.files));
document.querySelector('#dialogInput').addEventListener('change', (event) => processFiles(event.target.files));

const dropTargets = [document.querySelector('#dropZone'), dialog];
dropTargets.forEach((target) => {
  target.addEventListener('dragover', (event) => { event.preventDefault(); target.classList.add('drag'); });
  target.addEventListener('dragleave', () => target.classList.remove('drag'));
  target.addEventListener('drop', (event) => { event.preventDefault(); target.classList.remove('drag'); processFiles(event.dataTransfer.files); });
});

document.querySelector('#downloadArchive').addEventListener('click', () => {
  const registry = { createdAt: new Date().toISOString(), route: 'Кузбасс — ТЭЦ-4', wagons };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(registry, null, 2)], { type: 'application/json' }));
  link.download = 'reestr-vagonov.json'; link.click(); URL.revokeObjectURL(link.href);
  showToast('Реестр комплекта документов скачан');
});

renderDocuments();
renderWagons();
