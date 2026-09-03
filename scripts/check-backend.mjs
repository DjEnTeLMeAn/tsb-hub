import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkedExtensions = new Set(['.js', '.mjs']);

function collect(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collect(fullPath));
    else if (entry.isFile() && checkedExtensions.has(extname(entry.name))) files.push(fullPath);
  }
  return files;
}

const backendFiles = collect(resolve(root, 'functions'));
const browserFiles = collect(resolve(root, 'js'));
const serviceWorker = resolve(root, 'service-worker.js');
const files = [...backendFiles, ...browserFiles, ...(statSync(serviceWorker).isFile() ? [serviceWorker] : [])]
  .sort((a, b) => {
    const left = relative(root, a);
    const right = relative(root, b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
const failures = [];

for (const file of files) {
  const displayPath = relative(root, file).replaceAll('\\', '/');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  process.stdout.write(`CHECK ${displayPath}\n`);
  if (result.error || result.status !== 0) {
    failures.push({ displayPath, result });
    if (result.error) process.stderr.write(`${result.error.message}\n`);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Syntax check failed: ${failures.length}/${files.length} files\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Syntax check passed: ${files.length} files\n`);
}
