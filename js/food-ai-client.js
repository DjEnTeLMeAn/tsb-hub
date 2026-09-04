(function (global) {
  'use strict';
  const ORIGIN = 'https://generativelanguage.googleapis.com';
  const DEFAULT_MODEL = 'gemini-3.8-flash';
  const MAX_SOURCE = 10 * 1024 * 1024;
  const MAX_IMAGE = 3 * 1024 * 1024;
  const MAX_REQUEST = 6 * 1024 * 1024;
  const MAX_DIMENSION = 1280;
  const JPEG_QUALITY = 0.78;
  const MAX_RESPONSE = 512 * 1024;
  const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const FIELDS = ['name','ingredients','portionGrams','volumeMl','calories','protein','fat','carbs','comment','confidence'];

  function fail(code, message) { const error = new Error(message); error.code = code; return error; }
  function text(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail('INVALID_RESPONSE', 'Некорректный текст.');
    return value.trim();
  }
  function number(value, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw fail('INVALID_RESPONSE', 'Некорректное число.');
    return value;
  }
  function closeBitmap(bitmap) { try { bitmap?.close?.(); } catch (error) { /* already closed */ } }

  function blobBase64(blob) {
    return new Promise((resolve, reject) => {
      if (typeof global.FileReader !== 'function') return reject(fail('INVALID_IMAGE', 'Чтение фото недоступно.'));
      const reader = new global.FileReader();
      reader.onerror = () => reject(fail('INVALID_IMAGE', 'Не удалось прочитать фото.'));
      reader.onload = () => {
        const value = String(reader.result || '');
        const prefix = 'data:image/jpeg;base64,';
        const encoded = value.startsWith(prefix) ? value.slice(prefix.length) : '';
        if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return reject(fail('INVALID_IMAGE', 'Некорректное изображение.'));
        if (Math.floor(encoded.length * 3 / 4) > MAX_IMAGE) return reject(fail('IMAGE_TOO_LARGE', 'Подготовленное фото слишком велико.'));
        resolve(encoded);
      };
      reader.readAsDataURL(blob);
    });
  }

  async function prepareImage(file) {
    if (typeof global.Blob !== 'function' || !(file instanceof global.Blob) || !TYPES.has(file.type)) throw fail('INVALID_IMAGE', 'Выберите JPEG, PNG или WebP.');
    if (!Number.isSafeInteger(file.size) || file.size <= 0) throw fail('INVALID_IMAGE', 'Некорректный размер фото.');
    if (file.size > MAX_SOURCE) throw fail('IMAGE_TOO_LARGE', 'Исходное фото слишком велико.');
    if (typeof global.createImageBitmap !== 'function' || !global.document?.createElement) throw fail('INVALID_IMAGE', 'Обработка фото недоступна.');
    let bitmap;
    try {
      bitmap = await global.createImageBitmap(file);
      if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) throw fail('INVALID_IMAGE', 'Некорректные размеры фото.');
      const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
      const canvas = global.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context || typeof canvas.toBlob !== 'function') throw fail('INVALID_IMAGE', 'Обработка фото недоступна.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const output = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob(blob => !blob ? reject(fail('INVALID_IMAGE', 'Не удалось подготовить фото.'))
            : blob.size > MAX_IMAGE ? reject(fail('IMAGE_TOO_LARGE', 'Подготовленное фото слишком велико.')) : resolve(blob), 'image/jpeg', JPEG_QUALITY);
        } catch (error) { reject(fail('INVALID_IMAGE', 'Не удалось подготовить фото.')); }
      });
      return { mimeType: 'image/jpeg', data: await blobBase64(output) };
    } catch (error) {
      if (error?.code) throw error;
      throw fail('INVALID_IMAGE', 'Не удалось декодировать фото.');
    } finally { closeBitmap(bitmap); }
  }

  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID_RESPONSE', 'Неверный ответ модели.');
    const keys = Object.keys(value);
    if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key)) || FIELDS.some(key => !Object.hasOwn(value, key))) throw fail('INVALID_RESPONSE', 'Ответ не соответствует схеме.');
    if (!Array.isArray(value.ingredients) || value.ingredients.length > 30) throw fail('INVALID_RESPONSE', 'Некорректные ингредиенты.');
    return {
      name: text(value.name, 160, true),
      ingredients: value.ingredients.map(item => text(item, 120, true)),
      portionGrams: value.portionGrams === null ? null : number(value.portionGrams, 20000),
      volumeMl: value.volumeMl === null ? null : number(value.volumeMl, 20000),
      calories: number(value.calories, 20000),
      protein: number(value.protein, 5000),
      fat: number(value.fat, 5000),
      carbs: number(value.carbs, 5000),
      comment: text(value.comment, 1000),
      confidence: value.confidence === null ? null : number(value.confidence, 1)
    };
  }

  async function readResponse(response) {
    const length = response.headers?.get?.('content-length');
    if (length !== null && length !== undefined && length !== '' && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE)) throw fail('INVALID_RESPONSE', 'Ответ слишком велик.');
    if (!response.body?.getReader) {
      if (!/^\d+$/.test(length || '')) throw fail('INVALID_RESPONSE', 'Размер ответа неизвестен.');
      const value = await response.text();
      if (new global.Blob([value]).size > MAX_RESPONSE) throw fail('INVALID_RESPONSE', 'Ответ слишком велик.');
      return value;
    }
    const reader = response.body.getReader();
    const decoder = new global.TextDecoder('utf-8', { fatal: true });
    let bytes = 0, value = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_RESPONSE) { try { await reader.cancel(); } catch (error) {} throw fail('INVALID_RESPONSE', 'Ответ слишком велик.'); }
        value += decoder.decode(chunk.value, { stream: true });
      }
      return value + decoder.decode();
    } catch (error) {
      if (error?.code) throw error;
      throw fail('INVALID_RESPONSE', 'Ответ повреждён.');
    } finally { try { reader.releaseLock?.(); } catch (error) {} }
  }

  function parseResponse(raw) {
    let envelope;
    try { envelope = JSON.parse(raw); } catch (error) { throw fail('INVALID_RESPONSE', 'Сервис вернул не JSON.'); }
    const candidates = envelope?.candidates;
    const parts = candidates?.[0]?.content?.parts;
    if (!Array.isArray(candidates) || candidates.length !== 1 || !Array.isArray(parts) || parts.length !== 1 || typeof parts[0]?.text !== 'string' || parts[0].text.length > MAX_RESPONSE) throw fail('INVALID_RESPONSE', 'Ответ пуст или неоднозначен.');
    let result;
    try { result = JSON.parse(parts[0].text); } catch (error) { throw fail('INVALID_RESPONSE', 'Модель вернула не JSON.'); }
    return normalize(result);
  }

  function requestBody(image) {
    const schema = { type:'OBJECT', properties:{
      name:{type:'STRING',description:'Название видимого блюда'}, ingredients:{type:'ARRAY',items:{type:'STRING'}},
      portionGrams:{type:'NUMBER',nullable:true}, volumeMl:{type:'NUMBER',nullable:true},
      calories:{type:'NUMBER'}, protein:{type:'NUMBER'}, fat:{type:'NUMBER'}, carbs:{type:'NUMBER'},
      comment:{type:'STRING'}, confidence:{type:'NUMBER',nullable:true}
    }, required:FIELDS };
    return { contents:[{parts:[
      {text:'Проанализируй только видимую еду. Не выдумывай скрытые продукты. Оцени всю порцию: название, ингредиенты, массу или объём, калории и БЖУ. Это приблизительная оценка, не медицинский совет; пользователь подтвердит значения. Верни только JSON по схеме.'},
      {inlineData:image}
    ]}], generationConfig:{responseMimeType:'application/json',responseSchema:schema} };
  }

  async function analyzeFoodPhoto(options = {}) {
    const apiKey = options.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(apiKey)) throw fail('NO_KEY', 'API-ключ не указан.');
    const model = options.model || DEFAULT_MODEL;
    if (!/^gemini-[A-Za-z0-9][A-Za-z0-9._-]{0,55}$/.test(model)) throw fail('API', 'Некорректная модель.');
    if (options.signal?.aborted) throw fail('ABORTED', 'Запрос отменён.');
    const image = await prepareImage(options.file);
    if (options.signal?.aborted) throw fail('ABORTED', 'Запрос отменён.');
    const body = JSON.stringify(requestBody(image));
    if (new global.Blob([body]).size > MAX_REQUEST) throw fail('IMAGE_TOO_LARGE', 'Запрос слишком велик.');
    if (typeof global.fetch !== 'function') throw fail('NETWORK', 'Сеть недоступна.');

    const controller = new global.AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = global.setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      const response = await global.fetch(`${ORIGIN}/v1beta/models/${model}:generateContent`, {
        method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        cache:'no-store', referrerPolicy:'no-referrer', body, signal:controller.signal
      });
      if (!response?.ok) throw fail(response?.status === 401 || response?.status === 403 ? 'AUTH' : response?.status === 429 ? 'QUOTA' : 'API', 'Ошибка сервиса анализа.');
      const contentType = response.headers?.get?.('content-type') || '';
      if (contentType.split(';')[0].trim().toLowerCase() !== 'application/json') throw fail('API', 'Неожиданный формат ответа.');
      return parseResponse(await readResponse(response));
    } catch (error) {
      if (error?.name === 'AbortError') throw fail(timedOut ? 'TIMEOUT' : 'ABORTED', timedOut ? 'Время ожидания истекло.' : 'Запрос отменён.');
      if (error?.code) throw error;
      throw fail('NETWORK', 'Не удалось связаться с сервисом.');
    } finally {
      global.clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  global.TSBFoodAIClient = Object.freeze({ analyzeFoodPhoto });
})(window);
