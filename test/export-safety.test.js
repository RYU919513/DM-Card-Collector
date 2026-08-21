import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('JSON export keeps only image metadata and does not embed image base64', async () => {
  const source=await readFile('src/app.js','utf8');
  assert.match(source,/mhtImageMetadata:exportSafeImages\(mhtImages\)/);
  assert.match(source,/raw:exportSafeRaw\(raw\)/);
  assert.doesNotMatch(source,/toDataURL|readAsDataURL|base64,.*mhtImageMetadata/s);
});

test('preview build still blocks MHT and user data artefacts', async () => {
  const source=await readFile('scripts/build-preview.mjs','utf8');
  assert.match(source,/BLOCKED_EXTENSIONS = new Set\(\['\.mht', '\.mhtml'\]\)/);
  assert.match(source,/ALLOWED_DIRS = \[\s*'src',\s*'icons'/s);
});

test('embedded image extraction does not require or auto-upload to AI services', async () => {
  const source=(await Promise.all(['src/app.js','src/mht.js','src/mht-images.js'].map(file=>readFile(file,'utf8')))).join('\n').toLowerCase();
  assert.doesNotMatch(source,/openai|anthropic|chatgpt|gemini|upload/);
});
