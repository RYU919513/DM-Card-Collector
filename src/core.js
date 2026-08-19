const SOURCE_RULES = [
  ['official', /(?:dm\.takaratomy\.co\.jp|takaratomy\.co\.jp)/i],
  ['dmwiki', /(?:^|\.)dmwiki\.net/i],
  ['tcg_portal', /(?:tcg[-.]?portal|tcgportal)/i],
  ['picodoromeda', /picodoromeda/i]
];

export function detectSource(url = '') {
  let host = '';
  try { host = new URL(url).hostname; } catch { host = String(url); }
  return SOURCE_RULES.find(([, rule]) => rule.test(host))?.[0] || 'generic';
}

export function imageCandidates(values = [], base = '') {
  return [...new Set(values.flatMap(value => {
    const text = typeof value === 'string' ? value : value?.src || value?.content || '';
    const matches = text.match(/https?:\/\/[^\s"'<>]+?\.(?:avif|webp|png|jpe?g)(?:\?[^\s"'<>]*)?/gi) || [];
    if (/^(?:\/|\.\/)/.test(text) && base) try { matches.push(new URL(text, base).href); } catch {}
    return matches;
  }).filter(url => /^https?:\/\//i.test(url)))].slice(0, 100);
}

export function parseCapture(input, context = {}) {
  const payload = typeof input === 'object' && input ? input : { text: String(input || '') };
  const text = String(payload.text || '').replace(/\r/g, '').trim().slice(0, 50000);
  const url = String(payload.url || context.url || '').slice(0, 2048);
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const number = text.match(/\b(?:DM[A-Z0-9-]*\s*)?\d{1,3}\/\d{1,3}\b/i)?.[0] || text.match(/\b(?:P|S|EX|RP)\d{1,3}[A-Z]?\/\w+\b/i)?.[0] || null;
  const labelledName = text.match(/(?:カード名|name)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim();
  const name = labelledName || lines.find(line => line.length >= 2 && line.length <= 80 && !/^https?:/i.test(line) && line !== number) || null;
  const images = imageCandidates([...(payload.images || []), text], url);
  const fields = { name, number, text: text || null, sourceUrl: url || null, imageUrls: images };
  const present = [name, number, url, images.length].filter(Boolean).length;
  return { fields, source: detectSource(url), confidence: Math.min(0.98, 0.25 + present * 0.17), parser: 'generic-v1' };
}

export function fingerprint(record) {
  const f = record.fields || record;
  const normalized = `${f.number || ''}|${f.name || ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  let hash = 2166136261;
  for (const char of normalized) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `dm-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function contentHash(record) {
  const value = JSON.stringify(record?.fields || record, Object.keys(record?.fields || record || {}).sort());
  let first = 2166136261; let second = 2246822507;
  for (const char of value) {
    first = Math.imul(first ^ char.charCodeAt(0), 16777619);
    second = Math.imul(second ^ char.charCodeAt(0), 3266489909);
  }
  return `fnv64-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function validate(parsed) {
  const errors = [];
  if (!parsed.fields.name && !parsed.fields.number) errors.push('カード名またはカード番号が必要です');
  if (parsed.fields.sourceUrl && !/^https?:\/\//i.test(parsed.fields.sourceUrl)) errors.push('URLが不正です');
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
  const capturedAt = new Date().toISOString();
  return { id: crypto.randomUUID(), capturedAt, status: 'pending', attempts: 0, payload: { url: String(payload.url || context.url || '').slice(0, 2048), title: String(payload.title || '').slice(0, 300), text: String(payload.text || '').slice(0, 50000), images: imageCandidates(payload.images || [], payload.url || context.url).slice(0, 100) }, provenance: { method: context.method || 'paste', pageUrl: context.url || payload.url || null, sourceIdentifier: detectSource(payload.url || context.url), retrievedAt: capturedAt, capturedAt } };
}
