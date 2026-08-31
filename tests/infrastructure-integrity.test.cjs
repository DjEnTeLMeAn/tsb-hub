const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));
const vm = require('node:vm');

const app = read('js/app.js');
const storage = read('js/storage.js');
const index = read('index.html');
const updateManager = read('js/update-manager.js');
const serviceWorker = read('service-worker.js');
const style = read('css/style.css');
const mobileCleanup = read('css/mobile-first-cleanup.css');
const mobileDashboard = read('css/mobile-dashboard.css');
const mobileFinance = read('css/mobile-finance.css');

const requiredFiles = [
  'index.html', 'manifest.json', 'version.json', 'service-worker.js',
  'css/style.css', 'css/mobile-first-cleanup.css', 'css/mobile-dashboard.css',
  'css/mobile-finance.css', 'css/confirm-dialog.css',
  'js/update-manager.js', 'js/finance-core.js', 'js/app.js',
  'js/mobile-first-cleanup.js', 'js/mobile-dashboard.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

test('required application files are present and package test script covers every suite', () => {
  for (const file of requiredFiles) {
    assert.ok(exists(file), `required application file is missing: ${file}`);
  }

  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.cjs');
  assert.match(packageJson.scripts.test, /tests\/\*\.test\.cjs$/);
});

test('release metadata is structurally valid and consistent across the PWA shell', () => {
  const version = JSON.parse(read('version.json'));
  const manifest = JSON.parse(read('manifest.json'));
  const release = version.release;

  assert.match(release, /^0\.\d+\.\d+-[a-z0-9-]+-\d{8}$/);
  assert.equal(version.cache, `tsb-hub-${release}`);
  assert.equal(manifest.version, release);
  assert.equal(manifest.start_url, `./index.html?v=${release}`);
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(index.includes(`data-release="${release}"`));
  assert.ok(index.includes(`name="tsb-release" content="${release}"`));
  assert.ok(index.includes(`window.TSB_RELEASE='${release}'`));
  assert.ok(updateManager.includes(`const RELEASE='${release}'`));
  assert.ok(serviceWorker.includes(`const RELEASE='${release}'`));
  assert.ok(serviceWorker.includes('const CACHE_NAME=`tsb-hub-${RELEASE}`'));
});

test('full and Finance exports declare their backup type and format version', () => {
  assert.match(app, /const FULL_BACKUP_TYPE\s*=\s*['"]full['"]/);
  assert.match(app, /const FINANCE_BACKUP_TYPE\s*=\s*['"]finance['"]/);
  assert.match(app, /const BACKUP_FORMAT_VERSION\s*=\s*1/);

  assert.match(app, /function buildFinanceExportObject[\s\S]*?backupType:FINANCE_BACKUP_TYPE,formatVersion:BACKUP_FORMAT_VERSION/);
  assert.match(app, /function buildFullBackupObject[\s\S]*?exportObject\.backupType\s*=\s*FULL_BACKUP_TYPE/);
  assert.match(app, /function buildFullBackupObject[\s\S]*?exportObject\.formatVersion\s*=\s*BACKUP_FORMAT_VERSION/);
  assert.match(app, /parsed\?\.backupType !== FULL_BACKUP_TYPE \|\| parsed\?\.formatVersion !== BACKUP_FORMAT_VERSION/);
  assert.match(app, /parsed\?\.backupType === FINANCE_BACKUP_TYPE/);
});

test('storage uses a valid recovery backup when the primary data payload is unusable', () => {
  const values = new Map([
    ['tsb_hub_data_v1', '{broken'],
    ['tsb_hub_data_v1_recovery', JSON.stringify({ meta: { marker: 'recovery' } })]
  ]);
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const context = { window: { localStorage } };
  vm.runInNewContext(storage, context);

  assert.equal(context.window.TSBStorage.get('tsb_hub_data_v1'), values.get('tsb_hub_data_v1_recovery'));
  values.delete('tsb_hub_data_v1');
  assert.equal(context.window.TSBStorage.get('tsb_hub_data_v1'), values.get('tsb_hub_data_v1_recovery'));
  assert.equal(context.window.TSBStorage.get('tsb_hub_data_v1_recovery'), values.get('tsb_hub_data_v1_recovery'));
});

test('Service Worker registration has one owner: update-manager, never app.js', () => {
  assert.doesNotMatch(app, /navigator\.serviceWorker\.register\s*\(/);
  assert.doesNotMatch(app, /serviceWorker\.register\s*\(/);

  assert.match(updateManager, /const nativeRegister=['"]serviceWorker['"] in navigator\?/);
  assert.match(updateManager, /function registerRelease\(/);
  assert.match(updateManager, /nativeRegister\(swUrl\(safeRelease\),\{scope:'\.\/',updateViaCache:'none'\}\)/);
  assert.match(updateManager, /registerRelease\(RELEASE\)\.catch/);
  assert.match(updateManager, /service-worker\.js\?v=/);
});

test('mobile CSS keeps touch targets usable and prevents viewport overflow', () => {
  assert.match(style, /body\s*\{[^}]*min-height:\s*100dvh/);
  assert.match(style, /html, body\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(style, /@media\s*\(max-width:\s*900px\)/);
  assert.match(style, /env\(safe-area-inset-bottom\)/);
  assert.match(style, /\.tabs[^}]*overflow-x:\s*auto/);
  assert.match(style, /\.tab-button[^}]*flex:\s*0 0 auto/);
  assert.match(mobileCleanup, /@media\s*\(max-width:\s*900px\)/);
  assert.match(mobileCleanup, /body input,body select,body textarea\{[^}]*min-height:44px/);
  assert.match(mobileCleanup, /body \.primary-button,body \.ghost-button,body \.danger-button\{[^}]*min-height:44px/);
  assert.match(style, /touch-action:\s*manipulation/);
  assert.match(mobileDashboard, /@media\(max-width:900px\)/);
  assert.match(mobileFinance, /#tab-finance\{width:100%;max-width:100%;min-width:0;overflow-x:clip\}/);
  assert.match(mobileFinance, /@media\(max-width:600px\)/);
});

test('existing finance regression suites remain present and discoverable', () => {
  const financeSuites = [
    'tests/finance-core.test.cjs',
    'tests/finance-part2-regression.test.cjs',
    'tests/finance-part3-regression.test.cjs'
  ];
  for (const file of financeSuites) assert.ok(exists(file), `finance suite was removed: ${file}`);

  const discovered = fs.readdirSync(path.join(root, 'tests'))
    .filter(file => file.endsWith('.test.cjs'));
  for (const file of financeSuites.map(file => path.basename(file))) {
    assert.ok(discovered.includes(file), `finance suite is not discoverable: ${file}`);
  }
  assert.ok(discovered.includes('app-static.test.cjs'));
  assert.ok(discovered.includes('release-integrity.test.cjs'));
});
