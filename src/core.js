export const LIMITS = Object.freeze({ text: 50000, title: 300, url: 2048, images: 100 });

const COLLECTOR_HOST = 'ryu919513.github.io';
const COLLECTOR_PATH = '/DM-Card-Collector';
const UI_NAMES = new Set(['LOCAL-FIRST PWA', 'DM Card Collector', 'NO CLOUD WRITES', 'NO CLOUD WRITES · INDEXEDDB ONLY']);

function httpUrl(value, base) {
  if (!value || String(value).length > LIMITS.url) return null;
  if (/^(?:data|blob|javascript):/i.test(String(value).trim())) return null;
  try {
    const parsed = base ? new URL(String(value).trim(), base) : new URL(String(value).trim());
    return /^(https?):$/.test(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}

export function isCollectorUrl(value) {
  const url = httpUrl(value);
  return Boolean(url && new URL(url).hostname.toLowerCase() === COLLECTOR_HOST &&
    (new URL(url).pathname === COLLECTOR_PATH || new URL(url).pathname.startsWith(`${COLLECTOR_PATH}/`)));
}

export function detectSource(value = '') {
  const url = httpUrl(value);
  if (!url) return 'generic';
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'dm.takaratomy.co.jp' || host.endsWith('.dm.takaratomy.co.jp')) return 'official';
  if (host === 'dmwiki.net' || host.endsWith('.dmwiki.net')) return 'dmwiki';
  if (host.includes('tcg-portal') || host.includes('tcgportal')) return 'tcg_portal';
  if (host.includes('picodoromeda')) return 'picodoromeda';
  return 'generic';
}

export function extractHttpUrls(...values) {
  const found = [];
  for (const value of values) {
    for (const match of String(value || '').match(/https?:\/\/[^\s<>'"\])}]+/gi) || []) {
      const url = httpUrl(match.replace(/[.,、。]+$/, ''));
      if (url && !found.includes(url)) found.push(url);
    }
  }
  return found;
}

export function resolveSourceUrl(payload = {}, fallback = '') {
  const explicit = httpUrl(payload.url);
  const shared = httpUrl(payload.sharedUrl);
  const embedded = extractHttpUrls(payload.title, payload.text);
  const candidates = [explicit, shared, ...embedded].filter(url => url && !isCollectorUrl(url));
  return candidates.find(url => detectSource(url) !== 'generic') || candidates[0] ||
    (!isCollectorUrl(fallback) ? httpUrl(fallback) : null);
}

function candidateStrings(value) {
  if (typeof value === 'string') {
    if (/^(?:data|blob|javascript):/i.test(value.trim())) return [];
    return value.split(',').map(part => part.trim().split(/\s+/)[0]);
  }
  if (!value || typeof value !== 'object') return [];
  return ['currentSrc', 'src', 'srcset', 'dataSrc', 'dataLazySrc', 'dataOriginal', 'content']
    .flatMap(key => candidateStrings(value[key]));
}

export function imageCandidates(values = [], base = '') {
  const urls = [];
  for (const value of values) {
    for (const candidate of candidateStrings(value)) {
      const url = httpUrl(candidate, base);
      if (url && !urls.includes(url)) urls.push(url);
      if (urls.length === LIMITS.images) return urls;
    }
  }
  return urls;
}

export function parseCapture(input, context = {}) {
  const payload = typeof input === 'object' && input ? input : { text: String(input || '') };
  const text = String(payload.text || '').replace(/\r/g, '').trim().slice(0, LIMITS.text);
  const title = String(payload.title || '').trim().slice(0, LIMITS.title);
  const url = resolveSourceUrl(payload, context.url);
  const combined = `${title}\n${text}`;
  const number = combined.match(/\bDM[A-Z0-9-]*\s+\d{1,3}\/\d{1,3}\b/i)?.[0] ||
    combined.match(/\b(?:P|S|EX|RP)\d{1,3}[A-Z]?\/\w+\b/i)?.[0] ||
    combined.match(/\b\d{1,3}\/\d{1,3}\b/)?.[0] || null;
  const titleMatch = title.match(/^(.+?)\s*[（(]\s*(DM[A-Z0-9-]*\s+\d{1,3}\/\d{1,3})\s*[)）]/i);
  const labelledName = combined.match(/(?:カード名|name)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim();
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const titleName = titleMatch?.[1]?.trim() || (title && !/^https?:/i.test(title) ? title : null);
  const name = labelledName || titleName || lines.find(line => line.length >= 2 && line.length <= 80 &&
    !/^https?:/i.test(line) && line !== number && !UI_NAMES.has(line)) || null;
  const images = imageCandidates([...(payload.images || []), ...extractHttpUrls(text).filter(candidate => /\.(?:avif|webp|png|jpe?g)(?:\?|$)/i.test(candidate))], url || payload.url || context.url);
  const fields = { name, number, text: text || null, sourceUrl: url, imageUrls: images };
  const source = detectSource(url);
  const selfCapture = isCollectorUrl(payload.url || context.url) &&
    (context.method === 'visible-dom' || UI_NAMES.has(name) || /LOCAL-FIRST PWA[\s\S]*DM Card Collector/i.test(text));
  const present = [name, number, url, images.length].filter(Boolean).length;
  return { fields, source, confidence: Math.min(0.98, 0.25 + present * 0.17 + (source === 'official' ? 0.08 : 0)), parser: source === 'official' ? 'official-visible-v1' : 'generic-v2', selfCapture };
}

export function fingerprint(record) {
  const f = record.fields || record;
  const normalized = `${f.number || ''}|${f.name || ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  let hash = 2166136261;
  for (const char of normalized) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `dm-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function validate(parsed) {
  const errors = [];
  if (parsed.selfCapture || isCollectorUrl(parsed.fields.sourceUrl)) errors.push('Collector自身のページは回収できません');
  if (parsed.fields.name && UI_NAMES.has(parsed.fields.name.trim())) errors.push('Collectorの固定UI文字列はカード名にできません');
  if (!parsed.fields.name && !parsed.fields.number) errors.push('カード名またはカード番号が必要です');
  if (parsed.fields.sourceUrl && !httpUrl(parsed.fields.sourceUrl)) errors.push('URLが不正です');
  return { valid: errors.length === 0, errors };
}

export function compareRecords(records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.fields.number?.toLowerCase() || record.fields.name?.normalize('NFKC').toLowerCase();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  return [...groups.entries()].map(([key, matches]) => {
    const values = field => [...new Set(matches.map(r => r.fields[field]).filter(Boolean))];
    const conflicts = ['name', 'number', 'text'].filter(field => values(field).length > 1);
    const canonical = [...matches].sort((a, b) => b.confidence - a.confidence || (a.source === 'official' ? -1 : 1))[0];
    return { key, sources: [...new Set(matches.map(r => r.source))], conflicts, canonicalId: canonical.id || fingerprint(canonical) };
  });
}

export function makeRaw(input, context = {}) {
  const payload = typeof input === 'object' && input ? input : { text: String(input || '') };
  const sourceUrl = resolveSourceUrl(payload, context.url);
  return { id: crypto.randomUUID(), capturedAt: new Date().toISOString(), status: 'pending', attempts: 0, payload: { url: String(payload.url || context.url || '').slice(0, LIMITS.url), title: String(payload.title || '').slice(0, LIMITS.title), text: String(payload.text || '').slice(0, LIMITS.text), images: imageCandidates(payload.images || [], sourceUrl || payload.url || context.url) }, provenance: { method: context.method || 'paste', pageUrl: sourceUrl || context.url || payload.url || null, capturedAt: new Date().toISOString() } };
}
