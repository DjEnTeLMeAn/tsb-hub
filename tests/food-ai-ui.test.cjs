const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

test('Food AI UI exposes camera and gallery inputs', () => {
  assert.match(app, /data-food-ai-input="camera"[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"[^>]*capture="environment"/);
  assert.match(app, /data-food-ai-input="gallery"[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(app, /data-food-ai-camera/); assert.match(app, /data-food-ai-gallery/);
});
test('uses vault immediately before Gemini client call without persistence', () => {
  assert.match(app, /TSBApiKeyVault\.readKey\('gemini'\)/); assert.match(app, /TSBFoodAIClient\.analyzeFoodPhoto/);
  assert.match(app, /model:foodGeminiModel\(model\)/); assert.doesNotMatch(app, /analyzeFoodPhoto\(\{[^}]*model,signal/);
  assert.doesNotMatch(app, /localStorage[\s\S]{0,300}apiKey/); assert.doesNotMatch(app, /Добавлено через AI demo/);
  assert.match(app, /finally\s*\{[\s\S]*input\.value='';/);
});
test('supports cancellation, stale completion and editable confirmed save', () => {
  assert.match(app, /AbortController/); assert.match(app, /requestId/); assert.match(app, /ai\.controller\?\.abort/);
  for (const field of ['name','ingredients','comment','portionGrams','volumeMl','calories','protein','fat','carbs']) assert.match(app, new RegExp(`['"]${field}['"]`));
  assert.match(app, /Array\.isArray\(value\)[\s\S]*join\(['"]\\n/); assert.match(app, /portionGrams.*г/); assert.match(app, /volumeMl.*мл/);
  assert.match(app, /status\s*===\s*['"]result['"]/); assert.match(app, /saveData\(app,true\)/); assert.match(app, /createdAt:new Date\(\)\.toISOString\(\)/);
  assert.match(css, /min-height:\s*44px/);
  const foodSave = app.slice(app.indexOf("$('[data-food-ai-save]'"), app.indexOf("$('[data-food-ai-save]'" ) + 2400);
  assert.doesNotMatch(foodSave, />100000/); assert.match(foodSave, />20000/); assert.match(foodSave, />5000/); assert.match(foodSave, /length>160/); assert.match(foodSave, /length>3600/); assert.match(foodSave, /length>1000/);
});
test('maps provider and service errors to human-readable messages', () => {
  for (const code of ['NO_KEY','AUTH','QUOTA','NETWORK','TIMEOUT','INVALID_RESPONSE','INVALID_IMAGE','IMAGE_TOO_LARGE','API','ABORTED']) assert.match(app, new RegExp(code));
  assert.match(app, /Выбранный провайдер пока не поддерживается/);
});
