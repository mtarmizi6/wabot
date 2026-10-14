import test from 'node:test';
import assert from 'node:assert/strict';
import {assessGsMetadata,classifyGsGroupRejection} from '../src/groupstatus/diagnostics.js';
import {WhatsAppManager} from '../src/whatsapp/manager.js';
import {gsDashboard} from '../src/telegram/controller.js';
const member={id:'60123456789@s.whatsapp.net',lid:'12345@lid'};
const group=(announce,participants)=>({announce,participants});
test('not-admin admin-only chat after 479 is group-specific, cannot claim group-status permission fact',()=>{
  const diagnosis=assessGsMetadata(group(true,[{id:member.lid},{id:'222@lid',admin:'admin'}]),member);
  assert.equal(diagnosis.kind,'ADMIN_ONLY_CHAT');
  assert.match(diagnosis.note,/not confirmed/);
  assert.deepEqual(classifyGsGroupRejection(diagnosis),{outcome:'FAILED',fault:'REJECTED:479',diagnostic:'ADMIN_ONLY_CHAT'});
});
test('group admin in admin-only chat remains unverified after 479 and counts toward account protection',()=>{
  const diagnosis=assessGsMetadata(group(true,[{id:member.lid,admin:'admin'}]),member);
  assert.equal(diagnosis.kind,'MEMBER_CONFIRMED');
  assert.equal(classifyGsGroupRejection(diagnosis).fault,'REJECTED:479');
});
test('normal chat group with member verified and 479 still fails, no false skip',()=>{
  const diagnosis=assessGsMetadata(group(false,[{id:'60123456789:12@s.whatsapp.net'}]),member);
  assert.equal(diagnosis.kind,'MEMBER_CONFIRMED');
  assert.equal(classifyGsGroupRejection(diagnosis).outcome,'FAILED');
});
test('unmatched self with LID migration is INCONCLUSIVE (not automatically removed)',()=>{
  const diagnosis=assessGsMetadata(group(false,[{id:'99999@lid'}]),{id:'60111111111@s.whatsapp.net'});
  assert.equal(diagnosis.kind,'UNVERIFIED');
  assert.equal(classifyGsGroupRejection(diagnosis).outcome,'FAILED');
});
test('explicit not-in-group and 404 metadata response are group-specific',()=>{
  assert.equal(assessGsMetadata(null,member,new Error('you are not a participant')).kind,'NO_ACCESS');
  assert.equal(assessGsMetadata(null,member,{message:'status',output:{statusCode:404}}).kind,'GROUP_MISSING');
  assert.equal(classifyGsGroupRejection({kind:'NO_ACCESS'}).outcome,'SKIPPED');
});
test('403/timeout metadata errors are inconclusive and cannot explain rejection',()=>{
  assert.equal(assessGsMetadata(null,member,{message:'Forbidden',output:{statusCode:403}}).kind,'UNVERIFIED');
  assert.equal(assessGsMetadata(null,member,new Error('METADATA_TIMEOUT')).kind,'UNVERIFIED');
  assert.equal(classifyGsGroupRejection({kind:'UNVERIFIED'}).fault,'REJECTED:479');
});
test('live diagnostic queries one group only after error and returns group-specific reason',async()=>{
  const o=Object.create(WhatsAppManager.prototype);
  o.sockets=new Map([[4,{socket:{user:member,groupMetadata:async jid=>{
    assert.equal(jid,'1@g.us');return group(true,[{id:member.lid,admin:null}]);
  }}}]]);
  const info=await o.diagnoseGroupStatusFailure(4,'1@g.us');
  assert.equal(info.kind,'ADMIN_ONLY_CHAT');
});
test('live diagnostic timeout stays inconclusive, no fatal throw and no forced skip',async()=>{
  const o=Object.create(WhatsAppManager.prototype);
  o.sockets=new Map([[4,{socket:{user:member,groupMetadata:async()=>{throw new Error('timeout');}}}]]);
  assert.equal((await o.diagnoseGroupStatusFailure(4,'1@g.us')).kind,'UNVERIFIED');
});
test('dashboard displays last group failure reason and keeps compact arrow controls',()=>{
  const out=gsDashboard({id:7,status:'RUNNING',kind:'PHOTO',total:1,pending:0,inFlight:0,accepted:0,skipped:1,failed:0,unknown:0,delay_min_sec:60,delay_max_sec:120,rest_min_sec:300,rest_max_sec:600,batch_size:25},[{accountId:2,groupName:'Example',status:'SKIPPED',error:'SERVER ACK REJECTED 479 (MESSAGES_UPDATE) ADMIN_ONLY_CHAT: suspected restriction'}],[]);
  assert.match(out,/ADMIN_ONLY_CHAT/);assert.match(out,/↳ \.gs-pause 7 →/);
});

test('unverified 403 from server is not silently skipped as if chat permissions were known',()=>{
  const d=assessGsMetadata(null,member,{message:'forbidden',output:{statusCode:403}});
  assert.deepEqual(classifyGsGroupRejection(d,403),{outcome:'FAILED',fault:'REJECTED:403',diagnostic:'UNVERIFIED'});
});
