import { compareRecords, createBookmarklet, fingerprint, makeRaw, parseCapture, validate } from './core.js';
import { getAll, put, remove } from './db.js';

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
    return `<article class="card"><div class="badge">${escapeHtml(record.source)}</div><h3>${escapeHtml(record.fields.name || '名称未取得')}</h3><p>${escapeHtml(record.fields.number || '番号未取得')}</p><small>信頼度 ${Math.round(record.confidence * 100)}% · 画像候補 ${record.fields.imageUrls.length} · 重複 ${record.duplicateCount}</small>${comparison?.conflicts.length ? `<p class="warn">競合: ${comparison.conflicts.join(', ')}</p>` : ''}<button class="delete ghost" data-id="${escapeHtml(record.id)}">削除</button></article>`;
  }).join('') || '<div class="empty">まだカードはありません。上の欄から回収してください。</div>';
  document.querySelectorAll('.delete').forEach(button => { button.onclick = async () => { await remove('staging', button.dataset.id); await render(); $('#status').textContent = 'レコードを削除しました。'; }; });
}

const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

$('#capture').onclick = () => capture({ text: $('#capture-input').value }, 'paste');
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
$('#copy-bookmarklet').onclick = async () => {
  try { await navigator.clipboard.writeText(createBookmarklet(location.href)); $('#status').textContent = 'ブックマークレットをコピーしました。'; }
  catch { $('#status').textContent = 'コピーできませんでした。HTTPSで開き、クリップボード権限を許可してください。'; }
};

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
