import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manifest is a standalone scoped PWA with GET share target', async () => {
  const manifest = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.share_target.method, 'GET');
  assert.equal(manifest.share_target.params.text, 'capture');
  assert.ok(manifest.icons.length);
});

test('service worker has install, activate, fetch, and offline shell', async () => {
  const sw = await readFile('sw.js', 'utf8');
  for (const event of ['install', 'activate', 'fetch']) assert.match(sw, new RegExp(`addEventListener\\('${event}'`));
  assert.match(sw, /caches\.open/);
  assert.match(sw, /index\.html/);
});

test('application contains no Firebase, Firestore, or remote database connection', async () => {
  const files = ['index.html', 'src/app.js', 'src/core.js', 'src/db.js', 'sw.js'];
  const source = (await Promise.all(files.map(file => readFile(file, 'utf8')))).join('\n').toLowerCase();
  assert.doesNotMatch(source, /firebase|firestore|fetch\([^)]*(?:api|database)/);
});
