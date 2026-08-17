const OFFICIAL_HOST = 'dm.takaratomy.co.jp';
const COLLECTOR_LABELS = /^(?:LOCAL-FIRST PWA|DM Card Collector|DM Card\s*Collector|回収して検証|このページの表示DOM)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

function safeHttpUrl(value, base = '') {
  try {
    const raw = String(value || '').trim();
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return null;
    const url = new URL(raw, base || undefined);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function isOfficialUrl(value = '') {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
    return host === OFFICIAL_HOST || host.endsWith(`.${OFFICIAL_HOST}`);
  } catch { return false; }
}

export function detectSource(url = '') {
  const normalized = safeHttpUrl(url);
  if (normalized && isOfficialUrl(normalized)) return 'official';
  let host = '';
  try { host = new URL(normalized || url).hostname.toLowerCase(); } catch {}
  if (host === 'dmwiki.net' || host.endsWith('.dmwiki.net')) return 'dmwiki';
  if (/(?:^|\.)(?:tcg-portal|tcgportal)(?:\.|$)/.test(host)) return 'tcg_portal';
  if (/(?:^|\.)picodoromeda(?:\.|$)/.test(host)) return 'picodoromeda';
  return 'generic';
}

function urlsIn(value = '') {
  return String(value).match(URL_PATTERN)?.map(url => url.replace(/[),.;、。]+$/, '')) || [];
}

export function selectSourceUrl(payload = {}, fallback = '') {
  const discovered = [payload.url, ...urlsIn(payload.title), ...urlsIn(payload.text)].filter(Boolean);
  return discovered.find(isOfficialUrl) || discovered.map(value => safeHttpUrl(value)).find(Boolean) || safeHttpUrl(fallback) || null;
}

export function imageCandidates(values = [], base = '') {
  const candidates = [];
  const add = value => {
    for (const found of urlsIn(value)) {
      const normalized = safeHttpUrl(found, base);
      if (normalized) candidates.push(normalized);
    }
    for (const part of String(value || '').split(',')) {
      const raw = part.trim().split(/\s+/)[0];
      if (!raw) continue;
      const looksLikeUrl = /^(?:https?:\/\/|\/|\.\/|\.\.\/)/i.test(raw);
      const direct = looksLikeUrl && (!/\s/.test(part.trim()) || /\.(?:avif|webp|png|jpe?g)(?:[?#]|$)/i.test(raw)) ? safeHttpUrl(raw, base) : null;
      if (direct) candidates.push(direct);
      for (const found of urlsIn(raw)) {
        const normalized = safeHttpUrl(found, base);
        if (normalized) candidates.push(normalized);
      }
    }
  };
  for (const value of values.flat(Infinity)) {
    if (typeof value === 'string') add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(add);
  }
  return [...new Set(candidates)].slice(0, 100);
}

function cleanName(value, number) {
  let name = String(value || '').trim();
  if (number) name = name.replace(new RegExp(`\\s*[（(]\\s*${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[)）]\\s*$`, 'i'), '').trim();
  name = name.replace(/\s*[|｜]\s*デュエル・マスターズ.*$/i, '').trim();
  return !name || COLLECTOR_LABELS.test(name) || /LOCAL-FIRST PWA/i.test(name) ? null : name;
}

export function parseCapture(input, context = {}) {
  const payload = typeof input === 'object' && input ? input : { text: String(input || '') };
  const title = String(payload.title || '').replace(/\r/g, '').trim().slice(0, 500);
  const text = String(payload.text || '').replace(/\r/g, '').trim().slice(0, 50000);
  const combined = [title, text].filter(Boolean).join('\n');
  const sourceUrl = selectSourceUrl(payload, context.url);
  const number = combined.match(/\bDM[A-Z0-9-]+\s+\d{1,3}\/\d{1,3}\b/i)?.[0] || combined.match(/\b(?:P|S|EX|RP)\d{1,3}[A-Z]?\/\w+\b/i)?.[0] || null;
  const formatted = combined.match(/([^\n()（）]{2,100}?)\s*[（(]\s*(DM[A-Z0-9-]+\s+\d{1,3}\/\d{1,3})\s*[)）]/i);
  const labelled = combined.match(/(?:カード名|name)\s*[:：]\s*([^\n]+)/i)?.[1];
  const lines = combined.split('\n').map(line => line.trim()).filter(line => line && !/^https?:/i.test(line));
  const name = cleanName(formatted?.[1] || labelled || lines.find(line => line !== number && !COLLECTOR_LABELS.test(line)), number);
  const images = imageCandidates([payload.images || [], text], sourceUrl || context.url);
  const fields = { name, number, text: text || null, sourceUrl, imageUrls: images };
  const present = [name, number, sourceUrl, images.length].filter(Boolean).length;
  return { fields, source: detectSource(sourceUrl), confidence: Math.min(0.98, 0.25 + present * 0.17), parser: 'capture-v2', captureMethod: context.method || null };
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
  const collectorText = `${parsed.fields.name || ''}\n${parsed.fields.text || ''}`;
  if (parsed.captureMethod === 'visible-dom' && /LOCAL-FIRST PWA|DM Card\s*Collector/i.test(collectorText)) errors.push('Collector自身の画面はカードとして回収できません');
  if (parsed.fields.name && COLLECTOR_LABELS.test(parsed.fields.name)) errors.push('Collectorの固定UIはカード名にできません');
  if (!parsed.fields.name && !parsed.fields.number) errors.push('カード名またはカード番号が必要です');
  if (parsed.fields.sourceUrl && !safeHttpUrl(parsed.fields.sourceUrl)) errors.push('URLが不正です');
  return { valid: errors.length === 0, errors };
}

export function createBookmarklet(collectorUrl) {
  const target = new URL(collectorUrl); target.search = ''; target.hash = '';
  const code = `(function(){var a=['currentSrc','src','srcset','data-src','data-lazy-src','data-original'],i=[];document.querySelectorAll('img,source').forEach(function(e){a.forEach(function(k){var v=k==='currentSrc'?e.currentSrc:e.getAttribute(k);if(v)i.push(v)})});var p={url:location.href,title:document.title,text:document.body.innerText,images:i};location.href=${JSON.stringify(target.href)}+'?capture='+encodeURIComponent(JSON.stringify(p))})()`;
  return `javascript:${code}`;
}

export function compareRecords(records) {
  const groups = new Map();
  for (const record of records) { const key = record.fields.number?.toLowerCase() || record.fields.name?.normalize('NFKC').toLowerCase(); if (key) groups.set(key, [...(groups.get(key) || []), record]); }
  return [...groups.entries()].map(([key, matches]) => { const values = field => [...new Set(matches.map(r => r.fields[field]).filter(Boolean))]; const conflicts = ['name', 'number', 'text'].filter(field => values(field).length > 1); const canonical = [...matches].sort((a, b) => b.confidence - a.confidence || (a.source === 'official' ? -1 : 1))[0]; return { key, sources: [...new Set(matches.map(r => r.source))], conflicts, canonicalId: canonical.id || fingerprint(canonical) }; });
}

export function makeRaw(input, context = {}) {
  const payload = typeof input === 'object' && input ? input : { text: String(input || '') };
  return { id: crypto.randomUUID(), capturedAt: new Date().toISOString(), status: 'pending', attempts: 0, payload: { url: String(payload.url || '').slice(0, 2048), title: String(payload.title || '').slice(0, 500), text: String(payload.text || '').slice(0, 50000), images: imageCandidates(payload.images || [], payload.url || context.url) }, provenance: { method: context.method || 'paste', pageUrl: context.url || payload.url || null, capturedAt: new Date().toISOString() } };
}
