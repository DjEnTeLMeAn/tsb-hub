const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const app = fs.readFileSync('js/app.js', 'utf8');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  assert.fail(`${name} has no balanced function body`);
}

test('data management is owned by settings, not the removed sync tab', () => {
  assert.doesNotMatch(app, /#tab-sync|renderSync/);
  const settingsHTML = functionBody(app, 'buildSettingsHTML');
  const dataHTML = functionBody(app, 'renderDataManagementHTML');
  assert.match(settingsHTML, /renderDataManagementHTML\(\)/);
  for (const id of ['exportDataBtn', 'importDataInput', 'copyDataBtn', 'resetDemoBtn']) {
    assert.match(dataHTML, new RegExp(`id=["']${id}["']`), `${id} must be in settings data-management HTML`);
  }
});

test('settings binding delegates data management actions', () => {
  const settingsBinding = functionBody(app, 'bindSettingsActions');
  assert.match(settingsBinding, /bindDataManagementActions\(root\)/);
  const dataBinding = functionBody(app, 'bindDataManagementActions');
  assert.match(dataBinding, /importData\(file\)/);
  assert.match(dataBinding, /TSBStorage\.clearAllData\(\{ preserveDeviceId: false \}\)/);
  assert.match(dataBinding, /if \(!saveData\(freshData, false\)\)[\s\S]*?return;/);
});
