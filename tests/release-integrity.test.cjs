const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));
const version = JSON.parse(read('version.json'));
const manifest = JSON.parse(read('manifest.json'));
const release = version.release;
const index = read('index.html');
const app = read('js/app.js');
const bootstrap = read('js/bootstrap.js');
const serviceWorker = read('service-worker.js');
const readme = read('README.md');

const requiredFiles = [
  'index.html', 'manifest.json', 'version.json', 'service-worker.js',
  'css/style.css', 'css/mobile-first-cleanup.css', 'css/mobile-dashboard.css',
  'css/mobile-finance.css', 'css/confirm-dialog.css',
  'js/update-manager.js', 'js/finance-core.js', 'js/app.js',
  'js/bootstrap.js',
  'js/mobile-first-cleanup.js', 'js/mobile-dashboard.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

test('release metadata is valid and propagated through the PWA shell', () => {
  assert.match(release, /^0\.\d+\.\d+-[a-z0-9-]+-\d{8}$/);
  assert.equal(version.cache, `tsb-hub-${release}`);
  assert.equal(manifest.version, release);
  assert.equal(manifest.start_url, `./index.html?v=${release}`);
  assert.equal(manifest.icons.length, 2);
  assert.ok(index.includes(`data-release="${release}"`));
  assert.ok(index.includes(`name="tsb-release" content="${release}"`));
  assert.ok(bootstrap.includes(`window.TSB_RELEASE='${release}'`));
  assert.ok(index.includes(`js/bootstrap.js?v=${release}`));
  assert.ok(index.includes(`<title>TSB Hub v${release.split('-')[0]}</title>`));
  assert.ok(serviceWorker.includes(`const RELEASE='${release}'`));
  assert.ok(serviceWorker.includes(`const CACHE_NAME=\`tsb-hub-\${RELEASE}\``));
  assert.equal(app.includes('navigator.serviceWorker.register'), false);
  assert.ok(read('js/update-manager.js').includes(`const RELEASE='${release}'`));
  const updateManager = read('js/update-manager.js');
  assert.ok(updateManager.includes('service-worker.js?v=') && updateManager.includes("nativeRegister(swUrl("));
});

test('all PWA shell files exist and are covered by the service worker', () => {
  for (const file of requiredFiles) assert.ok(exists(file), `missing required file: ${file}`);
  const shellEntries = [...serviceWorker.matchAll(/`\.\/([^?`]+)\?v=\${RELEASE}`/g)].map(match => match[1]);
  // The active Service Worker is fetched by update-manager and must not
  // precache itself; requiring it here would make updates harder to reason about.
  for (const file of requiredFiles.filter(file => file !== 'version.json' && file !== 'service-worker.js')) {
    assert.ok(shellEntries.includes(file), `PWA shell does not cache ${file}`);
  }
  assert.ok(index.includes('rel="manifest"'));
  assert.ok(read('js/update-manager.js').includes('service-worker.js'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.icons[0].src, `icons/icon-192.png?v=${release}`);
  assert.equal(manifest.icons[1].src, `icons/icon-512.png?v=${release}`);
});

test('full backup and import keep their JSON contracts', () => {
  assert.ok(app.includes('function exportData()'));
  assert.ok(app.includes('normalizeData(JSON.parse(JSON.stringify(app)))'), 'backup must export normalized app data');
  assert.ok(app.includes('application/json;charset=utf-8'), 'backup must be JSON');
  assert.ok(app.includes('tsb_data_${toISODate(new Date())}.json'), 'backup filename contract missing');
  assert.ok(app.includes('function importData(file)'));
  assert.ok(app.includes('new FileReader()'), 'import must read a selected file');
  assert.ok(app.includes('JSON.parse(String(reader.result || \'{}\'))'), 'import must parse JSON');
  assert.ok(app.includes('const normalized = normalizeData(parsed)'), 'import must normalize parsed data');
  assert.ok(app.includes('applyImportedData(normalized)'), 'import must use the normalized object');
  assert.ok(app.includes('accept="application/json,.json"'), 'import input must restrict to JSON files');
  assert.ok(app.includes('importedModified < currentModified'), 'older backup confirmation guard missing');
  assert.ok(app.includes('function buildFinanceExportObject()'));
  assert.ok(app.includes('financeSchemaVersion:finance.schemaVersion'));
  assert.ok(app.includes('function financeTransactionsCsv'));
  assert.ok(app.includes('Полный backup TSB Hub'));
});

test('documentation describes the current release and data/PWA safeguards', () => {
  assert.ok(readme.includes(`TSB Hub v${release}`));
  assert.ok(readme.includes(`Release: \`${release}\``));
  assert.ok(readme.includes('Backup и импорт'));
  assert.ok(readme.includes('PWA shell и обязательные файлы'));
  // SELF_CHECK_*.md are historical reports; README is the current release document.
  assert.equal(readme.includes('0.8.21-dev'), false);
});

test('existing financial regression suites remain part of the test infrastructure', () => {
  const financeSuites = [
    'tests/finance-core.test.cjs',
    'tests/finance-part2-regression.test.cjs',
    'tests/finance-part3-regression.test.cjs'
  ];
  for (const file of financeSuites) assert.ok(exists(file), `missing finance suite: ${file}`);
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(packageJson.scripts['test:integrity'], 'node --test tests/release-integrity.test.cjs');
});
