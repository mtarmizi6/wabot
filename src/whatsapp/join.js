// Invite codes are case-sensitive. Normalize the URL, never the code itself.
export function normalizeInviteCode(value = '') {
  const code=String(value).trim();
  return /^[A-Za-z0-9_-]{10,64}$/.test(code) ? code : null;
}
export function parseWhatsAppInviteLinks(input = '') {
  const seen=new Set(), targets=[], invalid=[];
  let duplicateCount=0,totalInput=0;
  const candidates=String(input||'').match(/(?:https?:\/\/|(?:www\.)?chat\.whatsapp\.com\/)[^\s<>"']+/giu)||[];
  for(const candidate of candidates) {
    const raw=candidate.replace(/[.,;!?)\]}]+$/u,''); totalInput++;
    let code=null;
    try {
      const url=new URL(/^https?:/i.test(raw)?raw:'https://'+raw);
      if(['chat.whatsapp.com','www.chat.whatsapp.com'].includes(url.hostname.toLowerCase()) && !url.port && !url.username && !url.password) {
        const m=url.pathname.match(/^\/(?:invite\/)?([A-Za-z0-9_-]{10,64})\/?$/u);
        if(m) code=normalizeInviteCode(m[1]);
      }
    } catch {}
    if(!code) {invalid.push(raw.slice(0,300));continue;}
    if(seen.has(code)) {duplicateCount++;continue;}
    seen.add(code);targets.push({inviteCode:code,inviteUrl:'https://chat.whatsapp.com/'+code});
  }
  return {totalInput,validCount:targets.length,duplicateCount,invalidCount:invalid.length,invalid,targets};
}

export const DEFAULT_AUTO_JOIN_SCHEDULER = Object.freeze({
  delayMinSec: 60,
  delayMaxSec: 120,
  batchSize: 5,
  restMinSec: 300,
  restMaxSec: 600,
  cooldownEvery: 25,
  cooldownSec: 900
});

export function randomIntInclusive(min, max, random = Math.random) {
  const lo = Math.ceil(Number(min));
  const hi = Math.floor(Number(max));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) throw new Error('Julat rawak tidak sah.');
  const value = Number(random());
  const safe = Number.isFinite(value) ? Math.min(0.999999999999, Math.max(0, value)) : 0;
  return lo + Math.floor(safe * (hi - lo + 1));
}

export function nextAutoJoinWait(job = {}, account = {}, random = Math.random) {
  const delayMinSec = Math.max(10, Number(job.delayMinSec || DEFAULT_AUTO_JOIN_SCHEDULER.delayMinSec));
  const delayMaxSec = Math.max(delayMinSec, Number(job.delayMaxSec || DEFAULT_AUTO_JOIN_SCHEDULER.delayMaxSec));
  const batchSize = Math.max(1, Number(job.batchSize || DEFAULT_AUTO_JOIN_SCHEDULER.batchSize));
  const restMinSec = Math.max(0, Number(job.restMinSec ?? DEFAULT_AUTO_JOIN_SCHEDULER.restMinSec));
  const restMaxSec = Math.max(restMinSec, Number(job.restMaxSec ?? DEFAULT_AUTO_JOIN_SCHEDULER.restMaxSec));
  const cooldownEvery = Math.max(1, Number(job.cooldownEvery || DEFAULT_AUTO_JOIN_SCHEDULER.cooldownEvery));
  const cooldownSec = Math.max(0, Number(job.cooldownSec ?? DEFAULT_AUTO_JOIN_SCHEDULER.cooldownSec));
  const processedCount = Number(account.processedCount || 0) + 1;
  const batchProcessed = Number(account.batchProcessed || 0) + 1;
  const delaySec = randomIntInclusive(delayMinSec, delayMaxSec, random);

  const batchDue=batchProcessed>=batchSize;
  const cooldownDue=processedCount%cooldownEvery===0;
  const batchRest=batchDue?randomIntInclusive(restMinSec,restMaxSec,random):0;
  const restSec=Math.max(batchRest,cooldownDue?cooldownSec:0);
  return {type:cooldownDue?'cooldown':batchDue?'batch-rest':'delay',delaySec,restSec,
    waitSec:Math.max(delaySec,restSec),resetBatch:batchDue||cooldownDue};
}

function autoJoinErrorStatus(error) {
  return Number(
    error?.output?.statusCode ||
    error?.statusCode ||
    error?.data?.statusCode ||
    error?.response?.status ||
    error?.cause?.code ||
    0
  ) || 0;
}

export function classifyAutoJoinError(error) {
  const message=String(error?.message||error||'').toLowerCase();
  const code=autoJoinErrorStatus(error);
  const before=error?.joinDispatched===false;
  const headers=error?.output?.headers||error?.response?.headers||{};
  const retryValue=Number(error?.retryAfterSec??headers['retry-after']??error?.data?.retry_after);
  const retryAfterSec=Number.isFinite(retryValue)&&retryValue>0?retryValue:0;
  if(/already.*(?:participant|member)|already in (?:the )?group|participant already exists/u.test(message))
    return {kind:'already',retryable:false,userMessage:'Akaun sudah berada dalam group.'};
  if(/(?:request|join).*(?:pending|awaiting approval)|membership_approval_request/u.test(message))
    return {kind:'approval',retryable:false,userMessage:'Permintaan menunggu kelulusan admin.'};
  if(/account_reachout_restricted|account.*(?:restricted|banned)/u.test(message))
    return {kind:'restricted',retryable:false,userMessage:'Akaun disekat daripada membuat join. Semak WhatsApp dahulu.'};
  if(/invite.*(?:invalid|expired|revoked)|(?:invalid|expired|revoked).*invite|not-authorized|not authorized|forbidden/u.test(message)||[400,403,404,410].includes(code))
    return {kind:'invalid',retryable:false,userMessage:'Link tidak sah / tamat tempoh atau akses ditolak.'};
  if(before&&(/belum online|tiada connection|connection.*(?:closed|lost)|socket.*closed|disconnected|logged out/u.test(message)||code===401))
    return {kind:'account',retryable:true,retryAfterSec,userMessage:'Menunggu akaun kembali ONLINE.'};
  if(code===429 || (before&&(/timeout|timed out|network|econn|eai_again|enetunreach|etimedout|temporary/u.test(message)||code===408||code>=500)))
    return {kind:'transient',retryable:true,retryAfterSec,userMessage:code===429?'Pelayan meminta akaun menunggu.':'Gangguan sebelum permintaan join dihantar.'};
  if(!before) return {kind:'uncertain',retryable:false,userMessage:'Permintaan mungkin dihantar; keputusan belum pasti. Tidak diulang automatik.'};
  return {kind:'unknown',retryable:false,userMessage:'Join tidak berjaya sebelum permintaan dihantar.'};
}

export function autoJoinRetryDelayMs(attempt) {
  const values = [3000, 10000, 30000];
  const index = Math.max(0, Math.min(values.length - 1, Number(attempt || 1) - 1));
  return values[index];
}
