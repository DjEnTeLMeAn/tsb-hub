const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/food-ai-client.js'), 'utf8');
const KEY = 'gemini-test-key-123';
const result = { name: 'Soup', ingredients: ['water'], portionGrams: 300, volumeMl: null, calories: 120, protein: 5, fat: 3, carbs: 15, comment: 'approximate', confidence: 0.7 };

function setup(bitmap, blobSize = 100, pending = false) {
  let request, draw, quality, closed = 0, timerDelay, timerCallback, cleared = 0;
  class Reader { readAsDataURL() { this.result = 'data:image/jpeg;base64,YWJj'; this.onload(); } }
  const image = { ...bitmap, close() { closed++; } };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => { draw = [canvas.width, canvas.height]; } }),
    toBlob: (callback, type, q) => { quality = [type, q]; callback(new Blob([Buffer.alloc(blobSize)], { type: 'image/jpeg' })); }
  };
  const responseText = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
  const world = {
    Blob, FileReader: Reader, TextDecoder, AbortController,
    setTimeout: (callback, delay) => { timerCallback = callback; timerDelay = delay; return 1; },
    clearTimeout: () => { cleared++; },
    createImageBitmap: async () => image,
    document: { createElement: () => canvas },
    fetch: async (url, options) => { request = { url, options }; if (pending) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { const error = new Error(); error.name = 'AbortError'; reject(error); })); return { ok: true, status: 200, headers: { get: key => key === 'content-type' ? 'application/json' : key === 'content-length' ? String(Buffer.byteLength(responseText)) : '' }, body: null, text: async () => responseText }; }
  };
  vm.runInNewContext(source, { window: world, Blob, FileReader: Reader, TextDecoder, AbortController });
  return { client: world.TSBFoodAIClient, stats: () => ({ draw, quality, closed, timerDelay, timerCallback, cleared, request }) };
}

const file = () => new Blob(['x'], { type: 'image/jpeg' });

test('Gemini image profile scales portrait, landscape, and never enlarges small images', async () => {
  for (const [bitmap, expected] of [[[2000, 1000], [1280, 640]], [[1000, 2000], [640, 1280]], [[800, 600], [800, 600]]]) {
    const x = setup({ width: bitmap[0], height: bitmap[1] });
    await x.client.analyzeFoodPhoto({ file: file(), apiKey: KEY });
    assert.deepEqual(x.stats().draw, expected);
    assert.deepEqual(x.stats().quality, ['image/jpeg', 0.78]);
    assert.equal(x.stats().closed, 1);
  }
});

test('Gemini prepared output is hard-limited to 3 MiB', async () => {
  const x = setup({ width: 100, height: 100 }, 3 * 1024 * 1024 + 1);
  await assert.rejects(() => x.client.analyzeFoodPhoto({ file: file(), apiKey: KEY }), error => error.code === 'IMAGE_TOO_LARGE');
});

test('Gemini timeout uses 20000ms fake timer and cleans abort resources', async () => {
  const x = setup({ width: 100, height: 100 }, 100, true);
  const pending = x.client.analyzeFoodPhoto({ file: file(), apiKey: KEY });
  while (!x.stats().timerCallback) await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.stats().timerDelay, 20000);
  x.stats().timerCallback();
  await assert.rejects(pending, error => error.code === 'TIMEOUT');
  assert.equal(x.stats().cleared, 1);
  assert.equal(x.stats().request.options.headers['x-goog-api-key'], KEY);
  assert.equal(x.stats().request.options.headers.Authorization, undefined);
});
