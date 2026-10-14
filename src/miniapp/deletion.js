import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const tables={post:['posting_jobs','posting_job_targets','PROCESSING'],gs:['group_status_jobs','group_status_targets','IN_FLIGHT'],join:['auto_join_jobs','auto_join_targets','PROCESSING']};
// A read-only preview. The same guard is repeated synchronously at execution.
export function deletionInfo(path,kind,id){
 const spec=tables[kind];if(!spec)return {allowed:false,reason:'Sync tidak mempunyai rekod kempen untuk dipadam.'};
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const row=db.prepare(`SELECT * FROM ${spec[0]} WHERE id=?`).get(id);
  if(!row)throw Error('Rekod tidak lagi tersedia.');
  const counts=db.prepare(`SELECT status,count(*) n FROM ${spec[1]} WHERE job_id=? GROUP BY status ORDER BY status`).all(id);
  const inFlight=Number(counts.find(r=>r.status===spec[2])?.n||0),pending=Number(counts.find(r=>r.status==='PENDING')?.n||0);
  const has=name=>db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);
  const outbox=kind==='gs'&&has('system_gs_report_outbox')?db.prepare('SELECT sent FROM system_gs_report_outbox WHERE id=?').get(id):null;
  const archive=kind==='gs'&&has('system_job_archive')?db.prepare("SELECT report_sent FROM system_job_archive WHERE kind='gs' AND id=?").get(id):null;
  let reason='';
  if(!['STOPPED','COMPLETED'].includes(row.status))reason='Hentikan job dahulu atau tunggu sehingga selesai.';
  else if(inFlight)reason='Operasi masih diproses. Tunggu hasil terakhir sebelum memadam.';
  else if(kind==='post'&&row.report_status!=='SENT'||kind==='gs'&&!(outbox?outbox.sent:archive?.report_sent))reason='Laporan belum berjaya dihantar. Semak laporan dalam bot, kemudian cuba semula.';
  else if(kind==='post'&&!row.cleanup_at)reason='Cleanup job belum selesai. Cuba semula sebentar lagi.';
  const fingerprint=createHash('sha256').update(JSON.stringify([row,counts,outbox,archive])).digest('hex');
  return {allowed:!reason,reason,pending,inFlight,fingerprint};
 }finally{db.close();}
}
