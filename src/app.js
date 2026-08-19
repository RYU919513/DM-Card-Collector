import { compareRecords, fingerprint, makeRaw, parseCapture, validate } from './core.js';
import { getAll, put, remove, saveMhtImport } from './db.js';
import { parseMht, sha256Hex } from './mht.js';
import { classifyPage, collectionProgress, compareMhtCandidate, enrichCandidate, PAGE_TYPES, parseCardDetail, parseSearchResult } from './mht-pipeline.js';

const $ = selector => document.querySelector(selector);
let installPrompt;

async function processRaw(raw) {
  raw.attempts += 1;
  const parsed = parseCapture(raw.payload, { url: raw.payload.url, method: raw.provenance.method });
  const check = validate(parsed);
  if (!check.valid) {
    await put('failed', { ...raw, status: 'failed', errors: check.errors });
    await remove('raw', raw.id);
    return { ok: false, errors: check.errors };
  }
  const id = fingerprint(parsed);
  const existing = (await getAll('staging')).find(record => record.id === id);
  const record = { ...parsed, id, rawId: raw.id, provenance: raw.provenance, capturedAt: raw.capturedAt, duplicateCount: (existing?.duplicateCount || 0) + (existing ? 1 : 0) };
  await put('staging', existing ? { ...existing, ...record, provenanceHistory: [...(existing.provenanceHistory || [existing.provenance]), raw.provenance] } : record);
  await remove('raw', raw.id);
  return { ok: true, record };
}

async function capture(payload, method = 'paste') {
  const raw = makeRaw(payload, { method, url: payload?.url || location.href });
  await put('raw', raw);
  const result = await processRaw(raw);
  $('#status').textContent = result.ok ? `保存しました: ${result.record.fields.name || result.record.fields.number}` : `FAILED: ${result.errors.join(' / ')}`;
  await render();
}

async function render() {
  const [raw, staging, failed] = await Promise.all(['raw', 'staging', 'failed'].map(getAll));
  $('#raw-count').textContent = raw.length; $('#staging-count').textContent = staging.length; $('#failed-count').textContent = failed.length;
  const comparisons = compareRecords(staging);
  $('#records').innerHTML = staging.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 100).map(record => {
    const comparison = comparisons.find(item => item.canonicalId === record.id || item.key === record.fields.number?.toLowerCase());
    return `<article class="card"><div class="badge">${escapeHtml(record.source)}</div><h3>${escapeHtml(record.fields.name || '名称未取得')}</h3><p>${escapeHtml(record.fields.number || '番号未取得')}</p><small>信頼度 ${Math.round(record.confidence * 100)}% · 画像候補 ${record.fields.imageUrls.length} · 重複 ${record.duplicateCount}</small>${comparison?.conflicts.length ? `<p class="warn">競合: ${comparison.conflicts.join(', ')}</p>` : ''}</article>`;
  }).join('') || '<div class="empty">まだカードはありません。上の欄から回収してください。</div>';
}

const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);


async function importMht(file) {
  let bytes, sourceFileHash;
  const result = $('#mht-result'); result.className = 'import-result'; result.textContent = '解析中…';
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    [sourceFileHash] = await Promise.all([sha256Hex(bytes)]);
    const [parsed] = await Promise.all([parseMht({ name: file.name, type: file.type, arrayBuffer: async () => bytes.buffer })]);
    const detected = classifyPage(parsed);
    const base = detected.pageType === PAGE_TYPES.SEARCH_RESULT ? parseSearchResult(parsed.html, parsed) : detected.pageType === PAGE_TYPES.CARD_DETAIL ? parseCardDetail(parsed.html, parsed) : { pageType: PAGE_TYPES.UNKNOWN, sourceUrl: parsed.sourceUrl };
    const contentHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(base)));
    const importedAt = new Date().toISOString();
    let candidate = enrichCandidate({ ...base, contentHash }, { sourceType: 'OFFICIAL_MHT', sourceUrl: parsed.sourceUrl, sourceFileName: file.name.replace(/^.*[\\/]/, '').slice(0, 255), sourceFileHash, importedAt, capturedAt: null, rawSourceReference: sourceFileHash });
    const existing = await getAll('mhtImports'); const duplicate = compareMhtCandidate(candidate, existing);
    candidate = { ...candidate, id: crypto.randomUUID(), duplicate, retryCount: 0, lastAttempt: importedAt };
    if (duplicate.kind !== 'NEW') candidate = { ...candidate, state: duplicate.kind === 'DUPLICATE' || duplicate.kind === 'DUPLICATE_RAW' ? 'DUPLICATE' : 'CONFLICT', humanReviewRequired: true };
    await saveMhtImport({ id: sourceFileHash, sourceFileName: candidate.provenance.sourceFileName, sourceFileHash, importedAt, bytes: new Blob([bytes], { type: file.type || 'multipart/related' }), byteLength: bytes.length }, candidate);
    const progress = collectionProgress([...existing, candidate]);
    if (candidate.pageType === PAGE_TYPES.SEARCH_RESULT) result.innerHTML = `<h3>ページ ${candidate.pageNumber ?? '不明'} を認識しました</h3><p>${candidate.occurrenceCount}件検出 · 固有 ${candidate.uniqueCardCount} · 重複 ${candidate.duplicateCount}</p><p>状態: ${escapeHtml(candidate.state)} · 要確認</p><small>保存済み${progress.nextSuggestedPage ? ` · 次に推奨: ページ${progress.nextSuggestedPage}` : ''}</small>`;
    else if (candidate.pageType === PAGE_TYPES.CARD_DETAIL) result.innerHTML = `<h3>${escapeHtml(candidate.cardName || 'カード名未取得')}</h3><p>${escapeHtml(candidate.cardNumber || '番号未取得')} · ${escapeHtml(candidate.officialId || 'ID未取得')}</p><p>抽出 ${Object.values(candidate).filter(Boolean).length} field · ${escapeHtml(candidate.state)} · 要確認</p><small>raw保存済み</small>`;
    else { result.classList.add('error'); result.innerHTML = '<h3>ページ種別を判定できません</h3><p>rawは保存しました。再試行または人間レビューが必要です。</p>'; }
  } catch (error) {
    result.classList.add('error'); result.textContent = `FAILED [${error.code || 'IMPORT_ERROR'}]: ${error.message}`;
    if (bytes && sourceFileHash) try {
      const lastAttempt = new Date().toISOString(), id = crypto.randomUUID();
      await saveMhtImport({ id: sourceFileHash, sourceFileName: file.name.replace(/^.*[\\/]/, '').slice(0, 255), sourceFileHash, importedAt: lastAttempt, bytes: new Blob([bytes], { type: file.type || 'multipart/related' }), byteLength: bytes.length },
        { id, pageType: PAGE_TYPES.UNKNOWN, state: 'FAILED', humanReviewRequired: true, retryCount: 1, lastAttempt, failure: { code: error.code || 'IMPORT_ERROR', message: String(error.message).slice(0, 500) }, provenance: { sourceType: 'OFFICIAL_MHT', sourceFileName: file.name.replace(/^.*[\\/]/, '').slice(0, 255), sourceFileHash, importedAt: lastAttempt, rawSourceReference: sourceFileHash } });
    } catch { result.textContent += '（raw保存にも失敗しました。容量を確認してください）'; }
  }
}
const mhtInput = $('#mht-input'), drop = $('#mht-drop');
mhtInput.onchange = () => { if (mhtInput.files[0]) importMht(mhtInput.files[0]); mhtInput.value = ''; };
for (const event of ['dragenter', 'dragover']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('drag'); });
for (const event of ['dragleave', 'drop']) drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('drag'); });
drop.addEventListener('drop', event => { const file = event.dataTransfer.files[0]; if (file) importMht(file); });

$('#capture').onclick = () => capture({ text: $('#capture-input').value, url: location.href }, 'paste');
$('#capture-page').onclick = () => capture({ url: location.href, title: document.title, text: document.body.innerText, images: [...document.images].map(image => image.currentSrc || image.src) }, 'visible-dom');
$('#resume').onclick = async () => { for (const raw of await getAll('raw')) await processRaw(raw); await render(); $('#status').textContent = '保留中の回収を再検証しました。'; };
$('#export').onclick = async () => {
  const [raw, staging, failed] = await Promise.all(['raw', 'staging', 'failed'].map(getAll));
  const output = { schemaVersion: 1, exportedAt: new Date().toISOString(), records: staging, raw, failed, comparisons: compareRecords(staging) };
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })), download: `dm-card-collector-${Date.now()}.json` });
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('#install').hidden = false; });
$('#install').onclick = async () => { await installPrompt?.prompt(); installPrompt = null; $('#install').hidden = true; };

const params = new URLSearchParams(location.search);
if (params.has('capture') || params.has('share')) {
  try {
    const shared = params.has('share')
      ? { title: params.get('title') || '', text: params.get('capture') || '', url: params.get('url') || '' }
      : JSON.parse(params.get('capture'));
    await capture(shared, params.has('share') ? 'share-target' : 'bookmarklet');
    history.replaceState({}, '', location.pathname);
  } catch { $('#status').textContent = '共有データを読み取れませんでした。'; }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
render();
