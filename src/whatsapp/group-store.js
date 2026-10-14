import {DatabaseSync} from 'node:sqlite';
import {listWhatsAppAccounts} from './store.js';

const compare=(a,b)=>a.subject.localeCompare(b.subject,'ms',{sensitivity:'base'})||(a.jid<b.jid?-1:a.jid>b.jid?1:0);
// Read saved access only: offline accounts retain their last complete snapshot.
export function groupSnapshot(path,scope='all',keyword='') {
 const accounts=listWhatsAppAccounts(path),byAccount=new Map(accounts.map(a=>[a.id,a]));
 const db=new DatabaseSync(path,{readOnly:true});let rows;
 try {
  db.exec('PRAGMA busy_timeout=5000;');
  rows=db.prepare(`SELECT g.id,g.account_id AS accountId,g.jid,g.subject,
   g.participant_count AS participantCount,g.participant_count_known AS participantCountKnown,
   g.account_role AS accountRole,g.announcement,g.synced_at AS syncedAt
   FROM whatsapp_groups g JOIN whatsapp_accounts a ON a.id=g.account_id
   WHERE g.is_available=1 AND a.deleted_at IS NULL AND a.last_connected_at IS NOT NULL
   ORDER BY g.synced_at DESC,g.id DESC`).all();
 } finally {db.close();}
 const groups=new Map(),counts=new Map();
 for(const row of rows) {
  const account=byAccount.get(row.accountId);if(!account)continue;
  counts.set(account.id,(counts.get(account.id)||0)+1);
  if(scope!=='all'&&account.id!==Number(scope))continue;
  const access={...row,account};
  let group=groups.get(row.jid);
  if(!group){group={...row,key:scope==='all'?row.jid:String(row.id),access:[]};groups.set(row.jid,group);}
  group.access.push(access);
 }
 const term=String(keyword).trim().toLocaleLowerCase('ms');
 const items=[...groups.values()].filter(g=>!term||g.subject.toLocaleLowerCase('ms').includes(term)).sort(compare);
 for(const g of items)g.access.sort((a,b)=>a.account.displayNumber-b.account.displayNumber);
 return {accounts:accounts.map(a=>({...a,groupCount:counts.get(a.id)||0})),items,scope,keyword:String(keyword).trim(),
  uniqueCount:new Set(rows.map(g=>g.jid)).size,accessCount:rows.length,
  fingerprint:JSON.stringify([accounts.map(a=>a.id),items.map(g=>[g.key,g.subject,g.access.map(a=>a.accountId)])])};
}
export function groupSummary(path) {
 const s=groupSnapshot(path);
 return {accounts:s.accounts,total:s.accounts.length,online:s.accounts.filter(a=>a.status==='ONLINE').length,uniqueCount:s.uniqueCount,accessCount:s.accessCount};
}
export function groupPage(snapshot,page=1) {
 const total=snapshot.items.length,totalPages=Math.max(1,Math.ceil(total/10));
 page=Math.max(1,Math.min(totalPages,Math.trunc(Number(page)||1)));
 return {...snapshot,items:snapshot.items.slice((page-1)*10,page*10),page,total,totalPages,offset:(page-1)*10};
}
