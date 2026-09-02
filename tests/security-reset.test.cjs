const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const app = fs.readFileSync('js/app.js', 'utf8');
const resetStart = app.indexOf("bindClick(root, '#resetDemoBtn'");
const resetEnd = app.indexOf('\n  });\n}', resetStart);
const resetHandler = app.slice(resetStart, resetEnd);

test('reset contract clears all storage before creating or saving fresh data', () => {
  assert.ok(resetStart >= 0, 'reset handler must be bound');
  assert.ok(resetHandler.includes('TSBStorage.clearAllData({ preserveDeviceId: false })'));
  assert.ok(resetHandler.includes('const freshData = createDefaultData()'));
  assert.ok(resetHandler.includes('saveData(freshData, false)'));

  const clearIndex = resetHandler.indexOf('TSBStorage.clearAllData');
  const createIndex = resetHandler.indexOf('createDefaultData');
  const saveIndex = resetHandler.indexOf('saveData(freshData, false)');
  assert.ok(clearIndex < createIndex, 'storage reset must precede fresh database creation');
  assert.ok(createIndex < saveIndex, 'fresh database creation must precede primary save');
});

test('reset failure stops before fresh data creation and reports failed keys', () => {
  assert.match(
    resetHandler,
    /if \(!resetResult\?\.ok\)[\s\S]*?failedKeys[\s\S]*?showToast\([\s\S]*?failedKeys\.length[\s\S]*?return;/
  );
  const failureBranchEnd = resetHandler.indexOf('\n\n    const freshData');
  const failureBranch = resetHandler.slice(0, failureBranchEnd);
  assert.equal(failureBranch.includes('createDefaultData'), false);
  assert.equal(failureBranch.includes('saveData(freshData, false)'), false);
});

test('reset confirmation names every data class and does not preserve device ID', () => {
  assert.match(resetHandler, /primary[^\n]*recovery[^\n]*legacy[^\n]*device ID/i);
  assert.ok(resetHandler.includes('preserveDeviceId: false'));
});

test('reset does not render or announce success when primary save fails', () => {
  const saveFailureIndex = resetHandler.indexOf("showToast('Очистка не завершена: не удалось сохранить новую базу')");
  assert.ok(saveFailureIndex >= 0, 'primary save failure must show a toast');
  const saveFailureEnd = resetHandler.indexOf('\n    }', saveFailureIndex);
  const saveFailureBranch = resetHandler.slice(saveFailureIndex, saveFailureEnd);
  assert.ok(saveFailureBranch.includes('return;'));
  assert.equal(saveFailureBranch.includes('renderAll'), false);
});
