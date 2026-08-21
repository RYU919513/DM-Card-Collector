import { compareRecords, fingerprint, makeRaw, parseCapture, validate } from './core.js';
import { get, getAll, getMany, put, remove, saveMhtImport } from './db.js';
import { parseMht, sha256Hex } from './mht.js';
import { buildImageStoreRecords, extensionForMime, extractEmbeddedImages, summarizeImageDiagnostics } from './mht-images.js';
import { classifyPage, collectionProgress, compareMhtCandidate, enrichCandidate, PAGE_TYPES, parseCardDetail, parseSearchResult } from './mht-pipeline.js';
import { annotateWithComparisons, buildStats, deriveStatus, filterByStatus, isDeleteEligible, searchRecords } from './status.js';
import { createObjectUrlPool } from './object-url-pool.js';

const $=selector=>document.querySelector(selector);
let installPrompt,currentFilter='ALL',currentSearch='';
const APP_VERSION='mht-images-2026-08-21-1',previewPool=createObjectUrlPool();
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const uniq=v=>[...new Set((v||[]).filter(Boolean))];
const sanitizeFilename=value=>String(value||'card-image').replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,80)||'card-image';
let _lastAnnotated=[],_lastComparisons=[],_lastMhtImports=[],_previewUrls=new Map;

function releasePreviews(){previewPool.revokeAll();_previewUrls=new Map}
window.addEventListener('beforeunload',releasePreviews);

async function processRaw(raw){raw.attempts+=1;const parsed=parseCapture(raw.payload,{url:raw.payload.url,method:raw.provenance.method}),check=validate(parsed);if(!check.valid){await put('failed',{...raw,status:'failed',errors:check.errors});await remove('raw',raw.id);return{ok:false,errors:check.errors}}const id=fingerprint(parsed),existing=(await getAll('staging')).find(record=>record.id===id),record={...parsed,id,rawId:raw.id,provenance:raw.provenance,capturedAt:raw.capturedAt,duplicateCount:(existing?.duplicateCount||0)+(existing?1:0)},saved=existing?{...existing,...record,provenanceHistory:[...(existing.provenanceHistory||[existing.provenance]),raw.provenance]}:record;await put('staging',saved);await remove('raw',raw.id);return{ok:true,record:saved}}
async function capture(payload,method='paste'){const raw=makeRaw(payload,{method,url:payload?.url||location.href});await put('raw',raw);const result=await processRaw(raw);$('#status').textContent=result.ok?`保存しました: ${result.record.fields.name||result.record.fields.number}`:`FAILED: ${result.errors.join(' / ')}`;await render()}

const statusClass=s=>({SUCCESS:'status-success',NEEDS_REVIEW:'status-review',FAILED:'status-failed',CONFLICT:'status-conflict',DUPLICATE:'status-duplicate'}[s]||'status-review');
const imageHashForRecord=record=>record.primaryImageHash||record.associatedImageHashes?.[0]||record.embeddedImages?.[0]?.hash||null;
const embeddedCountForRecord=record=>record.embeddedImages?.length||record.associatedImageHashes?.length||0;
const savedCountForRecord=record=>record.associatedImageHashes?.length||record.imagePersistenceStatus?.savedCount||0;
const fallbackUrlCount=record=>(record.fields?.imageUrls||[]).length||(record.imageUrlCandidates||[]).length||(record.thumbnailUrl?1:0)||(record.imageUrl?1:0);
const totalImageCountForRecord=record=>embeddedCountForRecord(record)||fallbackUrlCount(record);
const titleForRecord=record=>record.fields?.name||record.cardName||(record.officialId?`ID:${record.officialId}`:'名称未取得');
const numberForRecord=record=>record.fields?.number||record.cardNumber||'番号未取得';
const previewUrlForRecord=record=>{const hash=imageHashForRecord(record);return hash?_previewUrls.get(hash)||'':''};
const primaryImageMeta=record=>{const hash=imageHashForRecord(record);return hash?(record.embeddedImages||[]).find(image=>image.hash===hash)||null:null};
const humanTime=value=>value?new Date(value).toLocaleString('ja-JP'):'–';
function recordImageLabel(record){if(imageHashForRecord(record))return'MHT内蔵';if(fallbackUrlCount(record))return'公式URL候補';return'候補なし'}
function imageSummaryLine(record){const diag=record.imageDiagnostics||{};return`MHT内画像 ${diag.totalImageParts||0} · カード画像候補 ${diag.candidateCount||0} · 保存済み画像 ${savedCountForRecord(record)}`}

function cardHtml(record){const f=record.fields||{},status=deriveStatus(record),eligible=!record._viewOnly&&isDeleteEligible(record),ts=humanTime(record.capturedAt||record.lastAttempt||record.importedAt),confidence=typeof record.confidence==='number'?record.confidence:record.pageType===PAGE_TYPES.CARD_DETAIL?0.6:record.pageType===PAGE_TYPES.SEARCH_RESULT?0.45:0,title=titleForRecord(record),number=numberForRecord(record),previewUrl=previewUrlForRecord(record),image=primaryImageMeta(record),downloadHash=imageHashForRecord(record),downloadName=sanitizeFilename(record.officialId||record.cardNumber||record.cardName||'card-image'),imageBadge=recordImageLabel(record);return`<article class="card">
    <div class="card-header">
      <div class="badge">${esc(record.source||record.pageType||'generic')}</div>
      <span class="status-badge ${statusClass(status)}">${esc(status)}</span>
      ${eligible?'<span class="badge-eligible">削除可能</span>':''}
    </div>
    <div class="card-body">
      <div class="card-media">${previewUrl?`<img class="card-preview" src="${esc(previewUrl)}" alt="${esc(title)}">`:`<div class="card-preview placeholder">${esc(imageBadge)}</div>`}</div>
      <div class="card-copy">
        <h3>${esc(title)}</h3>
        <p class="card-number">${esc(number)}</p>
        ${(f.officialId||record.officialId)?`<p class="muted small">officialId: ${esc(f.officialId||record.officialId)}</p>`:''}
        <small class="muted">回収: ${esc(ts)} · 信頼度 ${Math.round(confidence*100)}% · 画像候補 ${totalImageCountForRecord(record)} · 重複 ${record.duplicateCount||0}</small>
        <p class="muted small">${esc(imageSummaryLine(record))}</p>
        ${image?`<p class="muted small">${esc(image.source)} · ${esc(image.mimeType)} · ${image.width&&image.height?`${image.width} × ${image.height}`:'寸法未取得'}${image.linkedFromHtml?' · HTML参照一致':''}</p>`:''}
        ${record.imageDiagnostics?.decodeFailureCount?`<p class="warn small">decode失敗 ${record.imageDiagnostics.decodeFailureCount} 件</p>`:''}
        ${record._hasConflict?'<p class="warn">⚠ 競合あり</p>':''}
        <div class="card-actions">
          ${downloadHash?`<button class="ghost small-btn" data-download-image="${esc(downloadHash)}" data-download-name="${esc(downloadName)}">画像を保存</button>`:''}
          ${!downloadHash&&fallbackUrlCount(record)?'<span class="badge-subtle">公式URL候補のみ</span>':''}
        </div>
      </div>
    </div>
  </article>`}

function historyItemHtml(record){const status=deriveStatus(record),eligible=!record._viewOnly&&isDeleteEligible(record),ts=humanTime(record.capturedAt||record.lastAttempt),label=recordImageLabel(record);return`<div class="history-item">
    <span class="status-dot ${statusClass(status)}"></span>
    <span class="history-name">${esc(titleForRecord(record))}</span>
    <span class="history-meta muted">${esc(ts)}</span>
    <span class="badge-subtle small">${esc(label)}</span>
    ${eligible?'<span class="badge-eligible small">削除可能</span>':''}
  </div>`}

function expandMhtImports(mhtImports=[]){return mhtImports.flatMap(record=>{if(record.pageType!==PAGE_TYPES.SEARCH_RESULT)return[{...record,primaryImageHash:imageHashForRecord(record)}];const cards=Array.isArray(record.cards)?record.cards:[];if(!cards.length)return[{...record,primaryImageHash:imageHashForRecord(record)}];return cards.map(card=>{const associatedImageHashes=uniq(card.associatedImageHashes||[]),embeddedImages=(record.embeddedImages||[]).filter(image=>associatedImageHashes.includes(image.hash));return{id:`${record.id}::${card.position}`,pageType:PAGE_TYPES.SEARCH_RESULT,source:'OFFICIAL_MHT',state:record.state,humanReviewRequired:true,confidence:embeddedImages.length?0.55:(card.cardName||card.cardNumber)?0.45:0.25,cardName:card.cardName||null,cardNumber:card.cardNumber||null,officialId:card.officialId||null,imageUrlCandidates:card.imageUrlCandidates||[],thumbnailUrl:card.thumbnailUrl||null,detailUrl:card.detailUrl||null,duplicateCount:card.duplicateInPage?1:0,capturedAt:record.capturedAt||null,importedAt:record.provenance?.importedAt||record.lastAttempt||null,lastAttempt:record.lastAttempt||null,validation:record.validation,_viewOnly:true,provenance:{...(record.provenance||{}),position:card.position,pageCard:true},associatedImageHashes,primaryImageHash:associatedImageHashes[0]||null,embeddedImages,imagePersistenceStatus:{...(record.imagePersistenceStatus||{}),savedCount:associatedImageHashes.length},imageDiagnostics:record.imageDiagnostics||{},imageCandidateCount:card.imageCandidateCount||associatedImageHashes.length}})})}

async function hydratePreviews(records){releasePreviews();const hashes=uniq(records.map(imageHashForRecord).filter(Boolean)).slice(0,24);if(!hashes.length)return;const images=await getMany('mhtImages',hashes);for(const image of images){if(!image?.previewable||!image?.blob)continue;_previewUrls.set(image.id,previewPool.create(image.blob))}}

function exportSafeRaw(raw=[]){return raw.map(({bytes,...record})=>({...record,blob:bytes?{type:bytes.type||null,size:bytes.size||0}:null}))}
function exportSafeImages(images=[]){return images.map(({blob,...image})=>({...image,blob:{type:blob?.type||null,size:blob?.size||0}}))}
function imageResultHtml(candidate){const diag=candidate.imageDiagnostics||{},persistence=candidate.imagePersistenceStatus||{},summary=summarizeImageDiagnostics(diag),saved=persistence.savedCount||0,fail=persistence.state==='FAILED'?` · 保存失敗 ${esc(persistence.code||'IMAGE_PERSISTENCE_FAILED')}`:'';return`<p>MHT内画像: ${diag.totalImageParts||0}件 · カード画像候補: ${diag.candidateCount||0}件 · 保存済み画像: ${saved}件</p><small>${esc(summary)}${diag.decodeFailureCount?` · decode失敗 ${diag.decodeFailureCount}件`:''}${fail}</small>`}

async function render(){const [rawStore,stagingStore,failedStore,mhtImports]=await Promise.all(['raw','staging','failed','mhtImports'].map(getAll));_lastMhtImports=mhtImports;const comparisons=compareRecords(stagingStore),annotated=annotateWithComparisons(stagingStore,comparisons);_lastAnnotated=annotated;_lastComparisons=comparisons;const persistedRecords=[...annotated,...failedStore.map(r=>({...r,status:'failed'})),...mhtImports],allRecords=[...annotated,...failedStore.map(r=>({...r,status:'failed'})),...expandMhtImports(mhtImports)],stats=buildStats(persistedRecords);$('#stat-total').textContent=stats.total+rawStore.length;$('#stat-success').textContent=stats.SUCCESS||0;$('#stat-review').textContent=stats.NEEDS_REVIEW||0;$('#stat-failed').textContent=stats.FAILED||0;$('#stat-eligible').textContent=stats.DELETE_ELIGIBLE||0;$('#st-success').textContent=stats.SUCCESS||0;$('#st-review').textContent=stats.NEEDS_REVIEW||0;$('#st-failed').textContent=stats.FAILED||0;$('#st-conflict').textContent=stats.CONFLICT||0;$('#st-duplicate').textContent=stats.DUPLICATE||0;$('#st-total').textContent=stats.total+rawStore.length;$('#st-eligible').textContent=stats.DELETE_ELIGIBLE||0;let visible=currentFilter==='DELETE_ELIGIBLE'?allRecords.filter(isDeleteEligible):filterByStatus(allRecords,currentFilter);visible=searchRecords(visible,currentSearch);visible=[...visible].sort((a,b)=>(b.capturedAt||b.lastAttempt||'').localeCompare(a.capturedAt||a.lastAttempt||'')).slice(0,200);await hydratePreviews(visible);$('#list-count').textContent=`${visible.length} 件`;$('#records').innerHTML=visible.length?visible.map(cardHtml).join(''):'<div class="empty">該当するカードはありません。</div>';const recent=[...annotated,...expandMhtImports(mhtImports)].sort((a,b)=>(b.capturedAt||b.lastAttempt||'').localeCompare(a.capturedAt||a.lastAttempt||'')).slice(0,20);$('#history-list').innerHTML=recent.length?recent.map(historyItemHtml).join(''):'<div class="empty">まだ回収履歴はありません。</div>'}

async function storageEstimate(){try{return await navigator.storage?.estimate?.()||null}catch{return null}}
function attachHtmlUrlCandidates(base){if(base.pageType===PAGE_TYPES.SEARCH_RESULT)return{...base,cards:(base.cards||[]).map(card=>({...card,imageCandidates:[...(card.associatedImageHashes||[]).map(hash=>({source:'MHT_EMBEDDED',hash})),...(card.imageUrlCandidates||[]).map(url=>({source:'HTML_URL',url}))]}))};return{...base,imageCandidates:[...((base.associatedImageHashes||[]).map(hash=>({source:'MHT_EMBEDDED',hash}))),...(base.imageUrl?[{source:'HTML_URL',url:base.imageUrl}]:[])]}}

async function importMht(file){let bytes,sourceFileHash;const result=$('#mht-result');result.className='import-result';result.textContent='解析中…';try{bytes=new Uint8Array(await file.arrayBuffer());[sourceFileHash]=await Promise.all([sha256Hex(bytes)]);const parsed=await parseMht({name:file.name,type:file.type,arrayBuffer:async()=>bytes.buffer}),detected=classifyPage(parsed),base=detected.pageType===PAGE_TYPES.SEARCH_RESULT?parseSearchResult(parsed.html,parsed):detected.pageType===PAGE_TYPES.CARD_DETAIL?parseCardDetail(parsed.html,parsed):{pageType:PAGE_TYPES.UNKNOWN,sourceUrl:parsed.sourceUrl},extracted=await extractEmbeddedImages(parsed,{pageType:base.pageType,officialId:base.officialId,cardNumber:base.cardNumber,cards:base.cards}),withImages=base.pageType===PAGE_TYPES.SEARCH_RESULT?{...base,cards:extracted.cards||base.cards,embeddedImages:extracted.images,unassignedImageHashes:extracted.unassignedImageHashes,imageDiagnostics:extracted.diagnostics}:{...base,embeddedImages:extracted.images,associatedImageHashes:extracted.associatedImageHashes||[],primaryImageHash:extracted.associatedImageHashes?.[0]||null,unassignedImageHashes:extracted.unassignedImageHashes,imageDiagnostics:extracted.diagnostics},enriched=attachHtmlUrlCandidates(withImages),contentHash=await sha256Hex(new TextEncoder().encode(JSON.stringify(enriched))),importedAt=new Date().toISOString(),diagnostics={appVersion:APP_VERSION,classifier:detected,mime:{partCount:parsed.parts?.length||0,resourceCount:parsed.resources?.length||0,selectedSourceUrl:parsed.sourceUrl||null,imagePartCount:extracted.diagnostics.totalImageParts||0,decodeFailureCount:extracted.diagnostics.decodeFailureCount||0},extraction:{pageType:enriched.pageType,candidateCount:enriched.cards?.length||0,embeddedImageCount:extracted.images.length,embeddedCandidateCount:extracted.diagnostics.candidateCount||0}},candidateId=crypto.randomUUID();let candidate=enrichCandidate({...enriched,id:candidateId,contentHash,diagnostics,imagePersistenceStatus:{state:'PENDING',requestedCount:extracted.images.length,savedCount:0,code:null}}, {sourceType:'OFFICIAL_MHT',sourceUrl:parsed.sourceUrl,sourceFileName:file.name.replace(/^.*[\\/]/,'').slice(0,255),sourceFileHash,importedAt,capturedAt:null,rawSourceReference:sourceFileHash});const existing=await getAll('mhtImports'),duplicate=compareMhtCandidate(candidate,existing),estimate=await storageEstimate();candidate={...candidate,duplicate,retryCount:0,lastAttempt:importedAt,storageQuotaEstimate:estimate?{quota:estimate.quota||null,usage:estimate.usage||null,requiredBytes:extracted.images.reduce((sum,image)=>sum+(image.byteLength||0),0)}:null};if(duplicate.kind!=='NEW')candidate={...candidate,state:duplicate.kind==='DUPLICATE'||duplicate.kind==='DUPLICATE_RAW'?'DUPLICATE':'CONFLICT',humanReviewRequired:true};const imageRecords=buildImageStoreRecords(candidate.embeddedImages||[],extracted.imageBytesByHash,{sourceFileHash,importedAt,mhtImportId:candidate.id});candidate={...candidate,embeddedImages:(candidate.embeddedImages||[]).map(image=>({...image,persisted:imageRecords.some(record=>record.id===image.hash)})),imagePersistenceStatus:{state:imageRecords.length?'PERSISTED':'NONE',requestedCount:imageRecords.length,savedCount:imageRecords.length,code:null},imageDiagnostics:{...(candidate.imageDiagnostics||{}),persistedCount:imageRecords.length}};const rawRecord={id:sourceFileHash,sourceFileName:candidate.provenance.sourceFileName,sourceFileHash,importedAt,bytes:new Blob([bytes],{type:file.type||'multipart/related'}),byteLength:bytes.length};try{await saveMhtImport(rawRecord,candidate,imageRecords)}catch(error){const fallback={...candidate,embeddedImages:(candidate.embeddedImages||[]).map(image=>({...image,persisted:false})),imagePersistenceStatus:{state:'FAILED',requestedCount:imageRecords.length,savedCount:0,code:error?.name==='QuotaExceededError'?'QUOTA_EXCEEDED':'IMAGE_PERSISTENCE_FAILED'},imageDiagnostics:{...(candidate.imageDiagnostics||{}),persistedCount:0}};await saveMhtImport(rawRecord,fallback,[]);candidate=fallback}const progress=collectionProgress([...existing,candidate]);if(candidate.pageType===PAGE_TYPES.SEARCH_RESULT)result.innerHTML=`<h3>ページ ${candidate.pageNumber??'不明'} を認識しました</h3><p>${candidate.occurrenceCount}件検出 · 固有 ${candidate.uniqueCardCount} · 重複 ${candidate.duplicateCount}</p>${imageResultHtml(candidate)}<small>状態: ${esc(candidate.state)} · ${progress.nextSuggestedPage?`次に推奨: ページ${progress.nextSuggestedPage}`:'要確認'}</small>`;else if(candidate.pageType===PAGE_TYPES.CARD_DETAIL)result.innerHTML=`<h3>${esc(candidate.cardName||'カード名未取得')}</h3><p>${esc(candidate.cardNumber||'番号未取得')} · ${esc(candidate.officialId||'ID未取得')}</p>${imageResultHtml(candidate)}<small>${esc(candidate.state)} · raw保存済み</small>`;else{result.classList.add('error');result.innerHTML=`<h3>ページ種別を判定できません</h3>${imageResultHtml(candidate)}<p>rawは保存しました。再試行または人間レビューが必要です。</p>`}await render()}catch(error){result.classList.add('error');result.textContent=`FAILED [${error.code||'IMPORT_ERROR'}]: ${error.message}`;if(bytes&&sourceFileHash)try{const lastAttempt=new Date().toISOString(),id=crypto.randomUUID();await saveMhtImport({id:sourceFileHash,sourceFileName:file.name.replace(/^.*[\\/]/,'').slice(0,255),sourceFileHash,importedAt:lastAttempt,bytes:new Blob([bytes],{type:file.type||'multipart/related'}),byteLength:bytes.length},{id,pageType:PAGE_TYPES.UNKNOWN,state:'FAILED',humanReviewRequired:true,retryCount:1,lastAttempt,failure:{code:error.code||'IMPORT_ERROR',message:String(error.message).slice(0,500)},imageDiagnostics:{totalImageParts:0,candidateCount:0,persistedCount:0},imagePersistenceStatus:{state:'FAILED',requestedCount:0,savedCount:0,code:error.code||'IMPORT_ERROR'},provenance:{sourceType:'OFFICIAL_MHT',sourceFileName:file.name.replace(/^.*[\\/]/,'').slice(0,255),sourceFileHash,importedAt:lastAttempt,rawSourceReference:sourceFileHash}},[])}catch{result.textContent+='（raw保存にも失敗しました。容量を確認してください）'}}}

async function downloadMhtImage(hash,baseName='card-image'){const image=await get('mhtImages',hash);if(!image?.blob)return;const url=URL.createObjectURL(image.blob),link=Object.assign(document.createElement('a'),{href:url,download:`${sanitizeFilename(baseName)}${extensionForMime(image.mimeType||image.headerMimeType)}`});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

const mhtInput=$('#mht-input'),drop=$('#mht-drop');
mhtInput.onchange=()=>{if(mhtInput.files[0])importMht(mhtInput.files[0]);mhtInput.value=''};
for(const event of['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('drag')});
for(const event of['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('drag')});
drop.addEventListener('drop',event=>{const file=event.dataTransfer.files[0];if(file)importMht(file)});

$('#capture').onclick=()=>capture({text:$('#capture-input').value,url:location.href},'paste');
$('#capture-page').onclick=()=>capture({url:location.href,title:document.title,text:document.body.innerText,images:[...document.images].map(i=>i.currentSrc||i.src)},'visible-dom');
$('#resume').onclick=async()=>{for(const raw of await getAll('raw'))await processRaw(raw);await render();$('#status').textContent='保留中の回収を再検証しました。'};
$('#export').onclick=async()=>{const [raw,staging,failed,mhtImports,mhtImages]=await Promise.all(['raw','staging','failed','mhtImports','mhtImages'].map(getAll)),comparisons=compareRecords(staging),annotated=annotateWithComparisons(staging,comparisons),output={appVersion:APP_VERSION,schemaVersion:1,exportedAt:new Date().toISOString(),records:annotated,mhtImports,raw:exportSafeRaw(raw),failed,comparisons,mhtImageMetadata:exportSafeImages(mhtImages)};const link=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'})),download:`dm-card-collector-${Date.now()}.json`});link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)};
document.querySelectorAll('.filter-btn').forEach(btn=>{btn.onclick=()=>{document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentFilter=btn.dataset.filter;render()}});
$('#search-input').oninput=()=>{currentSearch=$('#search-input').value;render()};
$('#records').addEventListener('click',event=>{const button=event.target.closest('[data-download-image]');if(button)downloadMhtImage(button.dataset.downloadImage,button.dataset.downloadName)});

window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install').hidden=false});
$('#install').onclick=async()=>{await installPrompt?.prompt();installPrompt=null;$('#install').hidden=true};

const params=new URLSearchParams(location.search);
if(params.has('capture')||params.has('share')){try{const shared=params.has('share')?{title:params.get('title')||'',text:params.get('capture')||'',url:params.get('url')||''}:JSON.parse(params.get('capture'));await capture(shared,params.has('share')?'share-target':'bookmarklet');history.replaceState({},'',location.pathname)}catch{$('#status').textContent='共有データを読み取れませんでした。'}}

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js');
document.querySelector('footer').textContent=`NO CLOUD WRITES · INDEXEDDB ONLY · BUILD ${APP_VERSION}`;
render();
