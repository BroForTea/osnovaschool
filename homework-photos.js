(() => {
  let dbPromise, pending = [], activeInput = null, image = null, rotation = 0;
  const $ = selector => document.querySelector(selector);
  function openDb() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('osnova-grade5-photos', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'id' });
          store.createIndex('taskId', 'taskId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function records(taskId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction('photos').objectStore('photos').index('taskId').getAll(taskId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function ensureEditor() {
    if ($('#photoEditor')) return;
    const modal = document.createElement('div');
    modal.id = 'photoEditor';
    modal.className = 'photo-editor';
    modal.innerHTML = `<div class="photo-editor-backdrop" data-photo-cancel></div><section class="photo-editor-card" role="dialog" aria-modal="true" aria-labelledby="photoEditorTitle"><button class="photo-editor-close" type="button" data-photo-cancel aria-label="Закрити">×</button><h2 id="photoEditorTitle">Підготуй фото зошита</h2><p>Перевір, чи весь запис видно. Поверни фото або налаштуй кадр і яскравість.</p><div class="photo-canvas-wrap"><canvas id="photoCanvas"></canvas></div><div class="photo-tools"><button type="button" id="photoRotate">Повернути на 90°</button><label>Кадрування / масштаб <input id="photoZoom" type="range" min="100" max="200" value="100"></label><label>Яскравість <input id="photoBrightness" type="range" min="70" max="150" value="100"></label></div><div class="photo-editor-actions"><button type="button" data-photo-cancel>Скасувати</button><button type="button" id="photoSave">Зберегти фото</button></div></section>`;
    document.body.append(modal);
    modal.addEventListener('click', e => { if (e.target.closest('[data-photo-cancel]')) closeEditor(); });
    $('#photoRotate').addEventListener('click', () => { rotation = (rotation + 90) % 360; drawPreview(); });
    $('#photoZoom').addEventListener('input', drawPreview);
    $('#photoBrightness').addEventListener('input', drawPreview);
    $('#photoSave').addEventListener('click', savePending);
  }
  function drawPreview() {
    if (!image) return;
    const canvas = $('#photoCanvas'), ctx = canvas.getContext('2d');
    canvas.width = Math.max(320, Math.floor(canvas.parentElement.clientWidth * 2));
    canvas.height = Math.max(260, Math.floor(Math.min(innerHeight * .42, 480) * 2));
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(rotation * Math.PI / 180);
    const zoom = Number($('#photoZoom').value) / 100, rotated = rotation % 180 !== 0;
    const boxWidth = rotated ? canvas.height : canvas.width, boxHeight = rotated ? canvas.width : canvas.height;
    const scale = Math.max(boxWidth / image.width, boxHeight / image.height) * zoom;
    ctx.filter = `brightness(${$('#photoBrightness').value}%)`;
    ctx.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
    ctx.restore();
  }
  function closeEditor() {
    $('#photoEditor')?.classList.remove('open');
    pending = []; activeInput = null;
    image?.close?.(); image = null;
  }
  async function savePending() {
    if (!activeInput || !pending.length) return;
    const canvas = $('#photoCanvas'), taskId = activeInput.dataset.photo, db = await openDb(), file = pending.shift();
    try {
      const processed = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .92));
      if (processed) await new Promise((resolve, reject) => {
        const req = db.transaction('photos', 'readwrite').objectStore('photos').add({ id: crypto.randomUUID(), taskId, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', file: processed });
        req.onsuccess = resolve; req.onerror = () => reject(req.error);
      });
      if (pending.length) {
        image?.close?.(); image = await createImageBitmap(pending[0]); drawPreview();
        document.dispatchEvent(new CustomEvent('osnova-toast', { detail: `Фото збережено · залишилося ${pending.length}` }));
      } else {
        closeEditor(); await redraw();
        document.dispatchEvent(new CustomEvent('osnova-toast', { detail: 'Фото зошита збережено' }));
      }
    } catch { document.dispatchEvent(new CustomEvent('osnova-toast', { detail: 'Не вдалося зберегти фото на цьому пристрої' })); }
  }
  async function redraw() {
    for (const box of document.querySelectorAll('[data-photo-list]')) {
      try {
        const rows = await records(box.dataset.photoList);
        box.innerHTML = rows.map(row => {
          const url = URL.createObjectURL(row.file);
          const name = row.name.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
          return `<figure><a class="photo-fullsize" href="${url}" target="_blank" rel="noopener" title="Відкрити фото у повному розмірі"><img src="${url}" alt="Відкрити фото виконаної роботи у повному розмірі"></a><figcaption>${name} <button type="button" data-delete-photo="${row.id}">Видалити</button></figcaption></figure>`;
        }).join('');
      } catch {}
    }
  }
  document.addEventListener('change', async e => {
    const input = e.target.closest('[data-photo]'); if (!input) return;
    const files = [...input.files].filter(file => file.type.startsWith('image/')); if (!files.length) return;
    ensureEditor(); activeInput = input; pending = files; rotation = 0;
    $('#photoZoom').value = 100; $('#photoBrightness').value = 100;
    image = await createImageBitmap(pending[0]); $('#photoEditor').classList.add('open');
    requestAnimationFrame(drawPreview); input.value = '';
  });
  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-delete-photo]'); if (!button) return;
    const db = await openDb(), req = db.transaction('photos', 'readwrite').objectStore('photos').delete(button.dataset.deletePhoto);
    req.onsuccess = redraw;
  });

  async function exportForStudent(ownerId) {
    const db=await openDb();
    const rows=await new Promise((resolve,reject)=>{const req=db.transaction('photos').objectStore('photos').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    const prefix=`${ownerId}::`;
    return Promise.all(rows.filter(row=>row.taskId.startsWith(prefix)).map(row=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({lessonId:row.taskId.slice(prefix.length),name:row.name,dataUrl:reader.result});reader.onerror=()=>reject(reader.error);reader.readAsDataURL(row.file)})));
  }
  window.osnovaPhotoStore={exportForStudent};
  new MutationObserver(redraw).observe(document.querySelector('#taskList'), { childList: true });
  redraw();
})();
