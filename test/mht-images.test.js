import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMhtBytes } from '../src/mht.js';
import { IMAGE_LIMITS, buildImageStoreRecords, extractEmbeddedImages } from '../src/mht-images.js';
import { PAGE_TYPES, parseCardDetail, parseSearchResult } from '../src/mht-pipeline.js';

const png1x1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQImWNgYGD4DwABBAEAffrW4QAAAABJRU5ErkJggg==','base64');
const jpegLarge=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xff,0xc0,0x00,0x11,0x08,0x06,0x90,0x04,0xb0,0x03,0x01,0x22,0x00,0x02,0x11,0x01,0x03,0x11,0x01,0xff,0xd9]);
const webpLarge=Buffer.from([0x52,0x49,0x46,0x46,0x16,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x58,0x0a,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xaf,0x04,0x00,0x8f,0x06,0x00]);
const svgLarge=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1680"><rect width="1200" height="1680" fill="#123456"/></svg>');

function mhtFixture(html,parts){const body=[`MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Location: https://dm.takaratomy.co.jp/card/detail/?id=dm26rp2-DM001\r\n\r\n${html.replaceAll('=','=3D')}\r\n`];for(const part of parts){body.push(`--fixture\r\nContent-Type: ${part.contentType}\r\n${part.contentLocation?`Content-Location: ${part.contentLocation}\r\n`:''}${part.contentId?`Content-ID: <${part.contentId}>\r\n`:''}Content-Transfer-Encoding: ${part.encoding||'base64'}\r\n\r\n${part.body}\r\n`)}body.push('--fixture--\r\n');return new TextEncoder().encode(body.join(''))}
const b64=bytes=>Buffer.from(bytes).toString('base64');

test('embedded image extraction detects jpeg/png/webp and keeps metadata', async () => {
  const html='<div class="cardDetail"><img class="cardImage" src="https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp2-DM001.jpg"></div>';
  const parsed=parseMhtBytes(mhtFixture(html,[{contentType:'image/jpeg',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp2-DM001.jpg',body:b64(jpegLarge)},{contentType:'image/png',contentLocation:'https://dm.takaratomy.co.jp/assets/icon.png',body:b64(png1x1)},{contentType:'image/webp',contentLocation:'https://dm.takaratomy.co.jp/assets/card.webp',body:b64(webpLarge)}]));
  const base=parseCardDetail(parsed.html,{sourceUrl:parsed.sourceUrl});
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:base.officialId,cardNumber:base.cardNumber});
  assert.equal(extracted.diagnostics.totalImageParts,3);
  assert.ok(extracted.images.some(image=>image.mimeType==='image/jpeg'&&image.width===1200&&image.height===1680));
  assert.ok(extracted.images.some(image=>image.mimeType==='image/png'));
  assert.ok(extracted.images.some(image=>image.mimeType==='image/webp'));
});

test('base64 image decode failure is isolated as IMAGE_DECODE_FAILED', async () => {
  const parsed=parseMhtBytes(mhtFixture('<img src="https://dm.takaratomy.co.jp/wp-content/card/cardimage/fail.jpg">',[{contentType:'image/jpeg',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardimage/fail.jpg',body:'%%%not-base64%%%'}]));
  assert.equal(parsed.resources[1].decodeError,'IMAGE_DECODE_FAILED');
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:'dm-fail-001'});
  assert.equal(extracted.diagnostics.decodeFailureCount,1);
  assert.equal(extracted.images.length,0);
});

test('content-location and content-id references map embedded images back to HTML', async () => {
  const html='<div class="cardDetail"><img class="cardImage" src="cid:card-image-1"></div>';
  const parsed=parseMhtBytes(mhtFixture(html,[{contentType:'image/jpeg',contentId:'card-image-1',body:b64(jpegLarge)}]));
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:'dm26rp2-DM001'});
  assert.equal(extracted.images[0].linkedFromHtml,true);
  assert.equal(extracted.images[0].candidateType,'CARD_IMAGE');
});

test('search result associates multiple embedded images to the correct cards', async () => {
  const html=`<div class="cardList">
    <a href="/card/detail/?id=dm-test-001"><img src="https://dm.takaratomy.co.jp/wp-content/card/cardthumb/dm-test-001.jpg"></a>
    <a href="/card/detail/?id=dm-test-002"><img src="https://dm.takaratomy.co.jp/wp-content/card/cardthumb/dm-test-002.jpg"></a>
  </div>`;
  const parsed=parseMhtBytes(mhtFixture(html,[{contentType:'image/jpeg',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardthumb/dm-test-001.jpg',body:b64(jpegLarge)},{contentType:'image/webp',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardthumb/dm-test-002.jpg',body:b64(webpLarge)}]));
  const base=parseSearchResult(parsed.html,{sourceUrl:'https://dm.takaratomy.co.jp/card/?v=%7B%22pagenum%22%3A3%7D'});
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.SEARCH_RESULT,cards:base.cards});
  assert.equal(extracted.cards[0].associatedImageHashes.length,1);
  assert.equal(extracted.cards[1].associatedImageHashes.length,1);
  assert.notEqual(extracted.cards[0].associatedImageHashes[0],extracted.cards[1].associatedImageHashes[0]);
});

test('duplicate image hashes deduplicate while preserving provenance', async () => {
  const parsed=parseMhtBytes(mhtFixture('<div class="cardDetail"></div>',[{contentType:'image/jpeg',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardimage/a.jpg',body:b64(jpegLarge)},{contentType:'image/jpeg',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardimage/b.jpg',body:b64(jpegLarge)}]));
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:'dm-dup-001'});
  assert.equal(extracted.images.length,1);
  assert.equal(extracted.images[0].contentLocations.length,2);
});

test('tiny icons are penalized and large card-like images are promoted', async () => {
  const html='<style>.logo{background:url(https://dm.takaratomy.co.jp/assets/logo.png)}</style><img class="cardImage" src="https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp2-DM001.svg">';
  const parsed=parseMhtBytes(mhtFixture(html,[{contentType:'image/png',contentLocation:'https://dm.takaratomy.co.jp/assets/logo.png',body:b64(png1x1)},{contentType:'image/svg+xml',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp2-DM001.svg',body:b64(svgLarge)}]));
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:'dm26rp2-DM001'});
  const tiny=extracted.images.find(image=>image.mimeType==='image/png');
  const cardLike=extracted.images.find(image=>image.mimeType==='image/svg+xml');
  assert.equal(tiny.candidateType,'NON_CARD_ASSET');
  assert.equal(cardLike.candidateType,'CARD_IMAGE');
  assert.ok(cardLike.confidence>tiny.confidence);
});

test('unknown and unassigned image candidates are kept separately', async () => {
  const html='<img src="https://dm.takaratomy.co.jp/wp-content/card/cardimage/unassigned.svg">';
  const parsed=parseMhtBytes(mhtFixture(html,[{contentType:'image/svg+xml',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardimage/unassigned.svg',body:b64(svgLarge)}]));
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:''});
  assert.equal(extracted.unassignedImageHashes.length,1);
});

test('oversized and too-many image candidates are rejected safely', async () => {
  const oversized={html:'',sourceUrl:'https://dm.takaratomy.co.jp/card/detail/?id=dm-limit',parts:[{contentType:'image/png',contentLocation:'https://dm.takaratomy.co.jp/assets/huge.png',contentId:'',contentDisposition:'',transferEncoding:'base64',byteLength:IMAGE_LIMITS.MAX_IMAGE_BYTES+1,bytes:new Uint8Array(IMAGE_LIMITS.MAX_IMAGE_BYTES+1),decodeError:null}]};
  const rejected=await extractEmbeddedImages(oversized,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:'dm-limit'});
  assert.equal(rejected.diagnostics.rejectedBySize,1);
  const tooMany={html:'',sourceUrl:'https://dm.takaratomy.co.jp/card/detail/?id=dm-count',parts:Array.from({length:IMAGE_LIMITS.MAX_IMAGE_COUNT+2},(_,i)=>({contentType:'image/svg+xml',contentLocation:`https://dm.takaratomy.co.jp/assets/${i}.svg`,contentId:'',contentDisposition:'',transferEncoding:'base64',byteLength:svgLarge.length+i,bytes:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${200+i}" height="280"><rect width="1" height="1"/></svg>`),decodeError:null}))};
  const limited=await extractEmbeddedImages(tooMany,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:'dm-count'});
  assert.ok(limited.diagnostics.rejectedByCount>0);
});

test('buildImageStoreRecords stores blobs independently from the source MHT', async () => {
  const parsed=parseMhtBytes(mhtFixture('<img src="https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp2-DM001.jpg">',[{contentType:'image/jpeg',contentLocation:'https://dm.takaratomy.co.jp/wp-content/card/cardimage/dm26rp2-DM001.jpg',body:b64(jpegLarge)}]));
  const extracted=await extractEmbeddedImages(parsed,{pageType:PAGE_TYPES.CARD_DETAIL,officialId:'dm26rp2-DM001'});
  const records=buildImageStoreRecords(extracted.images,extracted.imageBytesByHash,{sourceFileHash:'source-hash',mhtImportId:'import-1',importedAt:'2026-08-21T00:00:00.000Z'});
  assert.equal(records[0].blob instanceof Blob,true);
  assert.equal(records[0].sourceFileHash,'source-hash');
  assert.equal(records[0].provenance[0].imageHash,records[0].hash);
});
