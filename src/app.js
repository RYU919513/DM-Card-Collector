import { compareRecords, fingerprint, makeRaw, parseCapture, validate } from './core.js';
import { getAll, put, remove, saveMhtImport } from './db.js';
import { parseMht, sha256Hex } from './mht.js';
import { classifyPage, collectionProgress, compareMhtCandidate, enrichCandidate, PAGE_TYPES, parseCardDetail, parseSearchResult } from './mht-pipeline.js';
import { annotateWithComparisons, buildStats, deriveStatus, filterByStatus, isDeleteEligible, searchRecords } from './status.js';

const $ = selector => document.querySelector(selector);
let installPrompt;
let currentFilter = 'ALL';
let currentSearch = '';

// ---- capture pipeline ----

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
  const record = {
    ...parsed,
    id,
    rawId: raw.id,
    provenance: raw.provenance,
    capturedAt: raw.capturedAt,
    duplicateCount: (existing?.duplicateCount || 0) + (existing ? 1 : 0)
  };
  const saved = existing
    ? { ...existing, ...record, provenanceHistory: [...(existing.provenanceHistory || [existing.provenance]), raw.provenance] }
    : record;
  await put('staging', saved);
  await remove('raw', raw.id);
  return { ok: true, record: saved };
}

async function capture(payload, method = 'paste') {
  const raw = makeRaw(payload, { method, url: payload?.url || location.href });
  await put('raw', raw);
  const result = await processRaw(raw);
  $('#status').textContent = result.ok
    ? `保存しました: ${result.record.fields.name || result.record.fields.number}`
    : `FAILED: ${result.errors.join(' / ')}`;
  await render();
}

// ---- render helpers ----

const esc = value => String(value).replace(/[&<>'"]/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
// alias for PR#6 MHT code paths
const escapeHtml = esc;

const statusClass = s => ({
  SUCCESS: 'status-success',
  NEEDS_REVIEW: 'status-review',
  FAILED: 'status-failed',
  CONFLICT: 'status-conflict',
  DUPLICATE: 'status-duplicate',
}[s] || 'status-review');

function cardHtml(record) {
  const f = record.fields || {};
  const status = deriveStatus(record);
  const eligible = isDeleteEligible(record);
  const ts = record.capturedAt ? new Date(record.capturedAt).toLocaleString('ja-JP') : '–';
  return `<article class="card">
    <div class="card-header">
      <div class="badge">${esc(record.source || record.pageType || 'generic')}</div>
      <span class="status-badge ${statusClass(status)}">${esc(status)}</span>
      ${eligible ? '<span class="badge-eligible">削除可能</span>' : ''}
    </div>
    <h3>${esc(f.name || record.cardName || '名称未取得')}</h3>
    <p class="card-number">${esc(f.number || record.cardNumber || '番号未取得')}</p>
    ${(f.officialId || record.officialId) ? `<p class="muted small">officialId: ${esc(f.officialId || record.officialId)}</p>` : ''}
    <small class="muted">回収: ${esc(ts)} · 信頼度 ${Math.round((record.confidence || 0) * 100)}% · 画像候補 ${(f.imageUrls || []).length} · 重複 ${record.duplicateCount || 0}</small>
    ${record._hasConflict ? '<p class="warn">⚠ 競合あり</p>' : ''}
  </article>`;
}

function historyItemHtml(record) {
  const status = deriveStatus(record);
  const eligible = isDeleteEligible(record);
  const ts = record.capturedAt || record.lastAttempt ? new Date(record.capturedAt || record.lastAttempt).toLocaleString('ja-JP') : '–';
  const f = record.fields || {};
  return `<div class="history-item">
    <span class="status-dot ${statusClass(status)}"></span>
    <span class="history-name">${esc(f.name || f.number || record.cardName || record.cardNumber || '(不明)')}</span>
    <span class="history-meta muted">${esc(ts)}</span>
    ${eligible ? '<span class="badge-eligible small">削除可能</span>' : ''}
  </div>`;
}

// ---- main render ----

// Module-level cache so export handler can use annotated data
let _lastAnnotated = [];
let _lastComparisons = [];

async function render() {
  const [rawStore, stagingStore, failedStore, mhtImports] = await Promise.all(
    ['raw', 'staging', 'failed', 'mhtImports'].map(getAll)
  );

  const comparisons = compareRecords(stagingStore);
  const annotated = annotateWithComparisons(stagingStore, comparisons);
  _lastAnnotated = annotated;
  _lastComparisons = comparisons;

  // For DELETE_ELIGIBLE filter we treat all stores including mhtImports
  const allRecords = [
    ...annotated,
    ...failedStore.map(r => ({ ...r, status: 'failed' })),
    ...mhtImports
  ];

  // Stats — raw queue shown separately (not conflated with NEEDS_REVIEW)
  const stats = buildStats(allRecords);
  $('#stat-total').textContent = stats.total + rawStore.length;
  $('#stat-success').textContent = stats.SUCCESS || 0;
  $('#stat-review').textContent = stats.NEEDS_REVIEW || 0;
  $('#stat-failed').textContent = stats.FAILED || 0;
  $('#stat-eligible').textContent = stats.DELETE_ELIGIBLE || 0;

  $('#st-success').textContent = stats.SUCCESS || 0;
  $('#st-review').textContent = stats.NEEDS_REVIEW || 0;
  $('#st-failed').textContent = stats.FAILED || 0;
  $('#st-conflict').textContent = stats.CONFLICT || 0;
  $('#st-duplicate').textContent = stats.DUPLICATE || 0;
  $('#st-total').textContent = stats.total + rawStore.length;
  $('#st-eligible').textContent = stats.DELETE_ELIGIBLE || 0;

  // Card list with filter/search
  let visible = currentFilter === 'DELETE_ELIGIBLE'
    ? allRecords.filter(isDeleteEligible)
    : filterByStatus(allRecords, currentFilter);
  visible = searchRecords(visible, currentSearch);
  visible = [...visible].sort((a, b) => (b.capturedAt || b.lastAttempt || '').localeCompare(a.capturedAt || a.lastAttempt || '')).slice(0, 200);

  $('#list-count').textContent = `${visible.length} 件`;
  $('#records').innerHTML = visible.length
    ? visible.map(cardHtml).join('')
    : '<div class="empty">該当するカードはありません。</div>';

  // History (most recent 20 from staging + mhtImports)
  const recent = [...annotated, ...mhtImports]
    .sort((a, b) => (b.capturedAt || b.lastAttempt || '').localeCompare(a.capturedAt || a.lastAttempt || ''))
    .slice(0, 20);
  $('#history-list').innerHTML = recent.length
    ? recent.map(historyItemHtml).join('')
    : '<div class="empty">まだ回収履歴はありません。</div>';
}

// ---- MHT import (PR#6 foundation) ----

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
    await render();
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

// ---- event wiring ----

$('#capture').onclick = () => capture({ text: $('#capture-input').value, url: location.href }, 'paste');
$('#capture-page').onclick = () => capture(
  { url: location.href, title: document.title, text: document.body.innerText, images: [...document.images].map(i => i.currentSrc || i.src) },
  'visible-dom'
);
$('#resume').onclick = async () => {
  for (const raw of await getAll('raw')) await processRaw(raw);
  await render();
  $('#status').textContent = '保留中の回収を再検証しました。';
};
$('#export').onclick = async () => {
  const [raw, , failed] = await Promise.all(['raw', 'staging', 'failed'].map(getAll));
  const output = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    records: _lastAnnotated,
    raw,
    failed,
    comparisons: _lastComparisons
  };
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })),
    download: `dm-card-collector-${Date.now()}.json`
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  };
});

// Search input
$('#search-input').oninput = () => {
  currentSearch = $('#search-input').value;
  render();
};

// PWA install
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  $('#install').hidden = false;
});
$('#install').onclick = async () => {
  await installPrompt?.prompt();
  installPrompt = null;
  $('#install').hidden = true;
};

// Share target / bookmarklet
const params = new URLSearchParams(location.search);
if (params.has('capture') || params.has('share')) {
  try {
    const shared = params.has('share')
      ? { title: params.get('title') || '', text: params.get('capture') || '', url: params.get('url') || '' }
      : JSON.parse(params.get('capture'));
    await capture(shared, params.has('share') ? 'share-target' : 'bookmarklet');
    history.replaceState({}, '', location.pathname);
  } catch {
    $('#status').textContent = '共有データを読み取れませんでした。';
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
render();
