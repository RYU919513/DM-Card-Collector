import { compareRecords, fingerprint, makeRaw, parseCapture, validate } from './core.js';
import { getAll, put, remove } from './db.js';
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
      <div class="badge">${esc(record.source || 'generic')}</div>
      <span class="status-badge ${statusClass(status)}">${esc(status)}</span>
      ${eligible ? '<span class="badge-eligible">削除可能</span>' : ''}
    </div>
    <h3>${esc(f.name || '名称未取得')}</h3>
    <p class="card-number">${esc(f.number || '番号未取得')}</p>
    ${f.officialId ? `<p class="muted small">officialId: ${esc(f.officialId)}</p>` : ''}
    <small class="muted">回収: ${esc(ts)} · 信頼度 ${Math.round((record.confidence || 0) * 100)}% · 画像候補 ${(f.imageUrls || []).length} · 重複 ${record.duplicateCount || 0}</small>
    ${record._hasConflict ? '<p class="warn">⚠ 競合あり</p>' : ''}
  </article>`;
}

function historyItemHtml(record) {
  const status = deriveStatus(record);
  const eligible = isDeleteEligible(record);
  const ts = record.capturedAt ? new Date(record.capturedAt).toLocaleString('ja-JP') : '–';
  const f = record.fields || {};
  return `<div class="history-item">
    <span class="status-dot ${statusClass(status)}"></span>
    <span class="history-name">${esc(f.name || f.number || '(不明)')}</span>
    <span class="history-meta muted">${esc(ts)}</span>
    ${eligible ? '<span class="badge-eligible small">削除可能</span>' : ''}
  </div>`;
}

// ---- main render ----

// Module-level cache so export handler can use annotated data
let _lastAnnotated = [];
let _lastComparisons = [];

async function render() {
  const [rawStore, stagingStore, failedStore] = await Promise.all(
    ['raw', 'staging', 'failed'].map(getAll)
  );

  const comparisons = compareRecords(stagingStore);
  const annotated = annotateWithComparisons(stagingStore, comparisons);
  _lastAnnotated = annotated;
  _lastComparisons = comparisons;

  // For DELETE_ELIGIBLE filter we treat all stores
  const allRecords = [
    ...annotated,
    ...failedStore.map(r => ({ ...r, status: 'failed' }))
  ];

  // Stats — raw queue shown separately as STAGING, not conflated with NEEDS_REVIEW
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
  visible = [...visible].sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || '')).slice(0, 200);

  $('#list-count').textContent = `${visible.length} 件`;
  $('#records').innerHTML = visible.length
    ? visible.map(cardHtml).join('')
    : '<div class="empty">該当するカードはありません。</div>';

  // History (most recent 20 from annotated staging)
  const recent = [...annotated]
    .sort((a, b) => (b.capturedAt || '').localeCompare(a.capturedAt || ''))
    .slice(0, 20);
  $('#history-list').innerHTML = recent.length
    ? recent.map(historyItemHtml).join('')
    : '<div class="empty">まだ回収履歴はありません。</div>';
}

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
