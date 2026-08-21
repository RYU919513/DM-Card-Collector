import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMhtBytes, MhtError, sha256Hex } from '../src/mht.js';
import {
  classifyPage,
  collectionProgress,
  compareMhtCandidate,
  enrichCandidate,
  PAGE_TYPES,
  parseCardDetail,
  parseQueryState,
  parseSearchResult,
  validateMhtCandidate
} from '../src/mht-pipeline.js';

const searchHtml = `
<div class="cardList">
  <a href="/card/detail/?id=dm26ex1-046">
    <span class="cardName">烈しき切札 ドギラゴン逆</span>
    <span class="cardNumber">DM26RP2 1/10</span>
    <img src="/wp-content/card/cardthumb/dm26ex1-046.jpg">
  </a>
  <a href="/card/detail/?id=dm-test-002">
    <span class="cardName">次元の皇帝</span>
    <span class="cardNumber">DM26RP2 2/10</span>
    <img data-src="https://dm.takaratomy.co.jp/wp-content/card/cardthumb/dm-test-002.jpg">
  </a>
  <a href="/card/detail/?id=dm26ex1-046">
    <span class="cardName">烈しき切札 ドギラゴン逆</span>
    <span class="cardNumber">DM26RP2 1/10</span>
    <img src="javascript:alert(1)">
  </a>
  <script>fetch('https://evil.test')</script>
</div>`;

const detailHtml = `<div class="cardDetail"><h1>烈しき切札 ドギラゴン逆</h1><dl><dt>カードID</dt><dd>dm26rp2-DM001</dd><dt>カード番号</dt><dd>DM26RP2 DM1/DM1</dd><dt>カード種類</dt><dd>ドリーム・クリーチャー</dd><dt>文明</dt><dd>光/自然</dd><dt>レアリティ</dt><dd>DMR</dd><dt>パワー</dt><dd>15000</dd><dt>コスト</dt><dd>8</dd><dt>マナ</dt><dd>1</dd><dt>種族</dt><dd>エクスドリーマー/<br>メガ・コマンド・ドラゴン/<br>革命軍/<br>ハムカツ団</dd><dt>イラストレーター</dt><dd>NAKAMURA8</dd><dt>特殊能力</dt><dd>能力一<br>能力二</dd><dt>フレーバー</dt><dd>公式本文</dd><dt>商品/収録</dt><dd>DM26RP2</dd></dl><img class="cardImage" src="/wp-content/card/cardimage/dm26rp2-DM001.jpg"></div>`;

function makeMht(html, url, encoding = 'quoted-printable', extraHeaders = '') {
  const body = encoding === 'base64'
    ? Buffer.from(html).toString('base64')
    : html.replaceAll('=', '=3D');
  return new TextEncoder().encode(
    `MIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n boundary="fixture"\r\n${extraHeaders}\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: ${encoding}\r\nContent-Location: ${url}\r\n\r\n${body}\r\n--fixture\r\nContent-Type: image/webp\r\nContent-Location: https://dm.takaratomy.co.jp/a.jpg\r\nContent-Transfer-Encoding: base64\r\n\r\nUklGRg==\r\n--fixture--\r\n`
  );
}

test('MIME reader decodes quoted-printable/base64 and inventories resources', () => {
  for (const encoding of ['quoted-printable', 'base64']) {
    const parsed = parseMhtBytes(makeMht(searchHtml, 'https://dm.takaratomy.co.jp/card/?v=%7B%22pagenum%22%3A8%7D', encoding));
    assert.match(parsed.html, /cardList/);
    assert.equal(parsed.sourceUrl.includes('pagenum'), true);
    assert.equal(parsed.resources.length, 2);
    assert.equal(parsed.parts[1].bytes[0], 82);
  }
});

test('MIME reader handles folded headers and content-location selection', () => {
  const parsed = parseMhtBytes(makeMht(searchHtml, 'https://dm.takaratomy.co.jp/card/?v=%7B%22pagenum%22%3A9%7D', 'quoted-printable', 'Content-Location: https://dm.takaratomy.co.jp/card/\r\n'));
  assert.match(parsed.sourceUrl, /dm\.takaratomy\.co\.jp/);
  assert.ok(parsed.parts.find(p => p.contentType === 'text/html'));
});

test('MIME reader reports empty, non-MHT, malformed, missing HTML and unsupported encoding', () => {
  const cases = [
    [new Uint8Array(), 'EMPTY_FILE'],
    [new TextEncoder().encode('hello'), 'MALFORMED_MIME'],
    [new TextEncoder().encode('Content-Type: text/plain\r\n\r\nx'), 'NOT_MHT'],
    [new TextEncoder().encode('Content-Type: multipart/related\r\n\r\nx'), 'MALFORMED_MULTIPART'],
    [new TextEncoder().encode('Content-Type: multipart/related; boundary=x\r\n\r\n--x\r\nContent-Type: image/png\r\n\r\na\r\n--x--\r\n'), 'HTML_PART_MISSING'],
    [makeMht('x', 'https://x', 'rot13'), 'UNSUPPORTED_ENCODING']
  ];
  for (const [bytes, code] of cases) {
    assert.throws(() => parseMhtBytes(bytes), e => e instanceof MhtError && e.code === code);
  }
});

test('search pages parse card name/number/detail URL and duplicate occurrences', () => {
  for (const page of [8, 9]) {
    const sourceUrl = `https://dm.takaratomy.co.jp/card/?v=${encodeURIComponent(JSON.stringify({ pagenum: page }))}`;
    const parsed = parseSearchResult(searchHtml, { sourceUrl });
    assert.equal(classifyPage({ html: searchHtml, sourceUrl }).pageType, PAGE_TYPES.SEARCH_RESULT);
    assert.equal(parsed.pageNumber, page);
    assert.deepEqual(parsed.cards.map(x => x.officialId), ['dm26ex1-046', 'dm-test-002', 'dm26ex1-046']);
    assert.equal(parsed.cards[0].cardName, '烈しき切札 ドギラゴン逆');
    assert.equal(parsed.cards[1].cardNumber, 'DM26RP2 2/10');
    assert.equal(parsed.cards[0].thumbnailUrl.endsWith('.jpg'), true);
    assert.equal(parsed.cards[2].thumbnailUrl, null);
    assert.equal(parsed.duplicateCount, 1);
    assert.equal(validateMhtCandidate(parsed).valid, true);
  }
});

test('50 candidate search result is preserved as 50 cards', () => {
  const cards = Array.from({ length: 50 }, (_, i) => `<a href="/card/detail/?id=dm-test-${String(i + 1).padStart(3, '0')}"><span>カード${i + 1}</span><span>DM${i + 1}/50</span><img src="/wp-content/card/cardthumb/${i + 1}.jpg"></a>`).join('');
  const html = `<div class="cardList">${cards}</div>`;
  const parsed = parseSearchResult(html, { sourceUrl: 'https://dm.takaratomy.co.jp/card/?v=%7B%22pagenum%22%3A9%7D' });
  assert.equal(parsed.occurrenceCount, 50);
  assert.equal(parsed.cards.length, 50);
  assert.equal(parsed.uniqueCardCount, 50);
});

test('query failures never assume page one', () => {
  assert.equal(parseQueryState('https://x/?v=pagenum%3Dno').pageNumber, null);
  assert.equal(parseQueryState('not a url').error, 'INVALID_SOURCE_URL');
  assert.equal(parseQueryState('https://x/').error, 'QUERY_STATE_MISSING');
});

test('detail sample extracts observed fields and preserves ability lines', () => {
  const sourceUrl = 'https://dm.takaratomy.co.jp/card/detail/?id=dm26rp2-DM001';
  const parsed = parseCardDetail(detailHtml, { sourceUrl });
  assert.equal(classifyPage({ html: detailHtml, sourceUrl }).pageType, PAGE_TYPES.CARD_DETAIL);
  assert.equal(parsed.officialId, 'dm26rp2-DM001');
  assert.equal(parsed.cardName, '烈しき切札 ドギラゴン逆');
  assert.equal(parsed.cardNumber, 'DM26RP2 DM1/DM1');
  assert.deepEqual(parsed.civilizations, ['光', '自然']);
  assert.equal(parsed.rarity, 'DMR');
  assert.equal(parsed.power, '15000');
  assert.equal(parsed.cost, '8');
  assert.equal(parsed.mana, '1');
  assert.equal(parsed.races.length, 4);
  assert.equal(parsed.illustrator, 'NAKAMURA8');
  assert.deepEqual(parsed.abilities, ['能力一', '能力二']);
  assert.match(parsed.imageUrl, /cardimage/);
  assert.equal(validateMhtCandidate(parsed).state, 'HUMAN_REVIEW_REQUIRED');
});

test('missing required CARD_DETAIL fields never become SUCCESS', () => {
  const parsed = parseCardDetail('<div class="cardDetail"><dl><dt>カードID</dt><dd>dm-x</dd></dl></div>', { sourceUrl: 'https://dm.takaratomy.co.jp/card/detail/?id=dm-x' });
  const validation = validateMhtCandidate(parsed);
  assert.equal(validation.state, 'VALIDATION_FAILED');
  assert.ok(validation.errors.includes('CARD_NAME_MISSING'));
  assert.ok(validation.errors.includes('CARD_NUMBER_MISSING'));
});

test('detail abnormal fields become validation/conflict diagnostics', () => {
  let parsed = parseCardDetail('<div class="cardDetail"><dl><dt>カードID</dt><dd>other-id</dd><dt>カード番号</dt><dd>1/1</dd></dl></div>', { sourceUrl: 'https://dm.takaratomy.co.jp/card/detail/?id=url-id' });
  let validation = validateMhtCandidate(parsed);
  assert.equal(validation.state, 'CONFLICT');
  assert.ok(validation.errors.includes('CARD_NAME_MISSING'));
  parsed = parseCardDetail(detailHtml.replace(/<dt>パワー[\s\S]*?<\/dd>/, '').replace(/<img[^>]+>/, ''), { sourceUrl: 'https://dm.takaratomy.co.jp/card/detail/?id=dm26rp2-DM001' });
  validation = validateMhtCandidate(parsed);
  assert.equal(parsed.power, null);
  assert.ok(validation.warnings.includes('IMAGE_URL_MISSING'));
});

test('unknown DOM and source missing fail closed with review', () => {
  const detected = classifyPage({ html: '<h1>unrelated</h1>', sourceUrl: null });
  assert.equal(detected.pageType, PAGE_TYPES.UNKNOWN);
  const candidate = enrichCandidate({ pageType: detected.pageType, sourceUrl: null }, { sourceType: 'OFFICIAL_MHT' });
  assert.equal(candidate.humanReviewRequired, true);
  assert.equal(candidate.state, 'VALIDATION_FAILED');
});

test('duplicate/conflict and configurable collection progress', () => {
  const base = {
    id: 'a',
    officialId: 'id-a',
    contentHash: 'same',
    pageType: PAGE_TYPES.SEARCH_RESULT,
    pageNumber: 1,
    cards: [{ officialId: 'id-a' }],
    provenance: { sourceFileHash: 'raw-a' }
  };
  assert.equal(compareMhtCandidate({ ...base, id: 'b' }, [base]).kind, 'DUPLICATE_RAW');
  assert.equal(compareMhtCandidate({ ...base, provenance: { sourceFileHash: 'raw-b' }, contentHash: 'changed' }, [base]).kind, 'CONFLICT');
  const progress = collectionProgress([base, { ...base, id: 'b', pageNumber: 1, cards: [{ officialId: 'id-a' }, { officialId: 'id-b' }] }, { pageType: PAGE_TYPES.UNKNOWN, state: 'FAILED' }], 276);
  assert.deepEqual(
    [progress.importedPages, progress.uniquePages, progress.duplicatePages, progress.discoveredCardIds, progress.uniqueCardIds, progress.duplicateCardIds, progress.nextSuggestedPage],
    [2, 1, 1, 3, 2, 1, 2]
  );
  assert.equal(progress.failedPages, 1);
});

test('SHA-256 provides stable raw identity', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
