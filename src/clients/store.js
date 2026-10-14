/**
 * Owner-only Client Management. The database is intentionally independent of the
 * WhatsApp/Group Status database to leave the locked migrations untouched.
 * Stores small campaign summaries, not ads, contacts' conversations or raw reports.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const schema = `
CREATE TABLE IF NOT EXISTS clients (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 contact TEXT NOT NULL DEFAULT '' CHECK(length(contact) <= 100),
 package_name TEXT NOT NULL DEFAULT '' CHECK(length(package_name) <= 160),
 price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
 paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(paid_cents >= 0),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 500),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS client_postings (
 posting_id INTEGER PRIMARY KEY,
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 label TEXT NOT NULL,
 linked_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS client_postings_by_client ON client_postings(client_id, posting_id);
CREATE TABLE IF NOT EXISTS client_campaign_reports (
 job_id INTEGER PRIMARY KEY,
 posting_id INTEGER NOT NULL,
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 job_status TEXT NOT NULL,
 success_count INTEGER NOT NULL DEFAULT 0,
 failed_count INTEGER NOT NULL DEFAULT 0,
 processed_count INTEGER NOT NULL DEFAULT 0,
 unknown_count INTEGER NOT NULL DEFAULT 0,
 report_filename TEXT NOT NULL DEFAULT '',
 completed_at TEXT,
 updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS client_reports_client ON client_campaign_reports(client_id,job_id);
`;

function withClientDb(path, fn) {
 mkdirSync(dirname(path), {recursive:true,mode:0o700});
 const db = new DatabaseSync(path);
 try {
  chmodSync(path,0o600);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec(schema);
  if(!db.prepare("PRAGMA table_info(client_campaign_reports)").all().some(c=>c.name==='unknown_count'))db.exec("ALTER TABLE client_campaign_reports ADD COLUMN unknown_count INTEGER NOT NULL DEFAULT 0");
  if(!db.prepare('PRAGMA table_info(client_campaign_reports)').all().some(c=>c.name==='snapshot_json'))db.exec("ALTER TABLE client_campaign_reports ADD COLUMN snapshot_json TEXT");
  return fn(db);
 } finally {db.close();}
}

const clock=()=>new Date().toISOString();
const positiveId=(v)=>{
 const n=Number(v);
 if(!Number.isSafeInteger(n)||n<1) throw new Error('ID tidak sah.');
 return n;
};
const cleaned=(v,max,label)=>{
 const text=String(v??'').trim().replace(/\s+/g,' ');
 if(!text || text.length>max)throw new Error(`${label} mesti 1–${max} aksara.`);
 return text;
};
export function moneyToCents(value){
 const s=String(value??'').trim().replace(/^rm\s*/i,'');
 if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(s))throw new Error('Masukkan jumlah seperti 29 atau 29.90.');
 const [ringgit,sen='']=s.split('.');const cents=Number(ringgit)*100+Number(sen.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents))throw new Error('Jumlah tidak sah.');
 return cents;
}
export const clientPaymentStatus=client=> Number(client.priceCents||0)===0?'BELUM TETAP HARGA':Number(client.paidCents||0)===0?'PENDING':Number(client.paidCents)<Number(client.priceCents)?'PARTIAL':'PAID';
const clientSelect='SELECT id,name,contact,package_name AS packageName,price_cents AS priceCents,paid_cents AS paidCents,notes,created_at AS createdAt,updated_at AS updatedAt FROM clients';
const one=(db,id)=>db.prepare(`${clientSelect} WHERE id=?`).get(positiveId(id))||null;
export function createClient(path,name){
 const value=cleaned(name,120,'Nama pelanggan');
 return withClientDb(path,db=>{
  if(db.prepare('SELECT name FROM clients').all().some(c=>c.name.toLocaleLowerCase()===value.toLocaleLowerCase()))throw new Error('Nama client sudah wujud. Pilih profil sedia ada.');
  const now=clock();const row=db.prepare('INSERT INTO clients(name,created_at,updated_at) VALUES (?,?,?)').run(value,now,now);
  return one(db,Number(row.lastInsertRowid));
 });
}
export function getClient(path,id){return withClientDb(path,db=>one(db,id));}
export function listClients(path,{page=1,perPage=10}={}){
 return withClientDb(path,db=>{
  const size=Math.max(1,Math.min(20,Math.floor(Number(perPage)||10)));
  const total=Number(db.prepare('SELECT count(*) AS n FROM clients').get().n);
  const pages=Math.max(1,Math.ceil(total/size)); const p=Math.max(1,Math.min(pages,Math.floor(Number(page)||1)));
  return {items:db.prepare(`${clientSelect} ORDER BY id DESC LIMIT ? OFFSET ?`).all(size,(p-1)*size),total,page:p,pages};
 });
}
export function setClientField(path,id,field,value){
 const columns={name:'name',contact:'contact',packageName:'package_name',notes:'notes'};
 if(!columns[field])throw new Error('Jenis maklumat tidak sah.');
 const limits={name:120,contact:100,packageName:160,notes:500};
 const entry=String(value??'').trim().replace(/\s+/g,' ');
 if(entry.length>limits[field])throw new Error('Maklumat terlalu panjang.');
 return withClientDb(path,db=>{
  if(!one(db,id))throw new Error('Client tidak ditemui.');
  if(field==='name'&&(!entry||entry==='-'||db.prepare('SELECT id,name FROM clients').all().some(c=>c.id!==Number(id)&&c.name.toLocaleLowerCase()===entry.toLocaleLowerCase())))throw new Error('Nama kosong atau sudah digunakan client lain.');
  db.prepare(`UPDATE clients SET ${columns[field]}=?,updated_at=? WHERE id=?`).run(entry==='-'?'':entry,clock(),positiveId(id));
  return one(db,id);
 });
}
export function setClientPrice(path,id,amount){
 const cents=moneyToCents(amount);
 return withClientDb(path,db=>{
  const c=one(db,id);if(!c)throw new Error('Client tidak ditemui.');
  if(cents<c.paidCents)throw new Error('Harga tak boleh lebih rendah daripada jumlah yang sudah dibayar.');
  db.prepare('UPDATE clients SET price_cents=?,updated_at=? WHERE id=?').run(cents,clock(),positiveId(id));
  return one(db,id);
 });
}
export function addClientPayment(path,id,amount){
 const cents=moneyToCents(amount);if(cents<=0)throw new Error('Bayaran mesti lebih daripada RM0.');
 return withClientDb(path,db=>{
  const c=one(db,id);if(!c)throw new Error('Client tidak ditemui.');
  if(c.priceCents===0)throw new Error('Tetapkan harga pakej dahulu.');
  if(c.paidCents+cents>c.priceCents)throw new Error('Bayaran melebihi baki harga pakej. Semak semula jumlah.');
  db.prepare('UPDATE clients SET paid_cents=paid_cents+?,updated_at=? WHERE id=?').run(cents,clock(),positiveId(id));
  return one(db,id);
 });
}
export function linkClientPosting(path,clientId,postingId,label){
 return withClientDb(path,db=>{
  if(!one(db,clientId))throw new Error('Client tidak ditemui.');
  db.prepare('INSERT INTO client_postings(posting_id,client_id,label,linked_at) VALUES (?,?,?,?)')
    .run(positiveId(postingId),positiveId(clientId),cleaned(label,120,'Nama posting'),clock());
  return {clientId:positiveId(clientId),postingId:positiveId(postingId)};
 });
}
export function unlinkClientPosting(path,postingId){
 return withClientDb(path,db=>db.prepare('DELETE FROM client_postings WHERE posting_id=?').run(positiveId(postingId)).changes>0);
}
export function clientForPosting(path,postingId){
 return withClientDb(path,db=>db.prepare('SELECT client_id AS clientId,posting_id AS postingId FROM client_postings WHERE posting_id=?').get(positiveId(postingId))||null);
}
// Before the main engine deletes heavy job details, take a small durable snapshot.
export function saveClientCampaignSnapshot(path,snapshot,filename=''){
 if(!snapshot?.job?.id || !snapshot?.job?.postingId)return false;
 return withClientDb(path,db=>{
  const j=snapshot.job;
  const linked=db.prepare('SELECT client_id AS clientId FROM client_postings WHERE posting_id=?').get(positiveId(j.postingId));
  if(!linked)return false;
  const file=String(filename||j.reportFilename||'').slice(0,180);
  db.prepare(`INSERT INTO client_campaign_reports(job_id,posting_id,client_id,job_status,success_count,failed_count,processed_count,unknown_count,report_filename,completed_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(job_id) DO UPDATE SET job_status=excluded.job_status, success_count=excluded.success_count,
    failed_count=excluded.failed_count, processed_count=excluded.processed_count,unknown_count=excluded.unknown_count,
    report_filename=CASE WHEN excluded.report_filename<>'' THEN excluded.report_filename ELSE client_campaign_reports.report_filename END,
    completed_at=excluded.completed_at,updated_at=excluded.updated_at`)
    .run(positiveId(j.id),positiveId(j.postingId),linked.clientId,String(j.status||'UNKNOWN'),Math.max(0,Number(j.successCount||0)),
     Math.max(0,Number(j.failedCount||0)),Math.max(0,Number(j.processedCount||0)),Math.max(0,Number(j.unknownCount||0)),file,j.completedAt||null,clock());
  db.prepare('UPDATE client_campaign_reports SET snapshot_json=? WHERE job_id=?').run(JSON.stringify({job:{...snapshot.job,summaryJson:null,ads:snapshot.ads||[]},ads:snapshot.ads||[],accountStats:snapshot.accountStats||[]}),j.id);
  return true;
 });
}
export function listClientCampaigns(path,mainDbPath,clientId){
 return withClientDb(path,clients=>{
  if(!one(clients,clientId))throw new Error('Client tidak ditemui.');
  const links=clients.prepare('SELECT posting_id AS postingId,label,linked_at AS linkedAt FROM client_postings WHERE client_id=? ORDER BY posting_id DESC').all(positiveId(clientId));
  const saved=clients.prepare('SELECT job_id AS jobId,posting_id AS postingId,job_status AS status,success_count AS successCount,failed_count AS failedCount,processed_count AS processedCount,unknown_count AS unknownCount,report_filename AS reportFilename,completed_at AS completedAt FROM client_campaign_reports WHERE client_id=? ORDER BY job_id DESC').all(positiveId(clientId));
  const results=new Map(saved.map(j=>[Number(j.jobId),j]));
  const main=new DatabaseSync(mainDbPath,{readOnly:true});
  try{
   main.exec('PRAGMA busy_timeout=5000');
   const query=main.prepare('SELECT id AS jobId,posting_id AS postingId,status,success_count AS successCount,failed_count AS failedCount,processed_count AS processedCount,unknown_count AS unknownCount,report_filename AS reportFilename,completed_at AS completedAt FROM posting_jobs WHERE posting_id=? ORDER BY id DESC');
   for(const link of links){for(const row of query.all(link.postingId)){
    const old=results.get(Number(row.jobId));
    if(old && !row.completedAt && !['COMPLETED','STOPPED'].includes(row.status))results.set(Number(row.jobId),{...row,reportFilename:old.reportFilename||row.reportFilename});
    else if(!old)results.set(Number(row.jobId),row);
    else if(row.completedAt && old.completedAt && row.completedAt>old.completedAt)results.set(Number(row.jobId),row);
   }}
  }finally{main.close();}
  return {links,jobs:[...results.values()].sort((a,b)=>Number(b.jobId)-Number(a.jobId))};
 });
}

export function findClientsByName(path,name){const text=cleaned(name,120,'Nama client').toLocaleLowerCase();return withClientDb(path,db=>db.prepare(`${clientSelect} ORDER BY id`).all().filter(c=>c.name.toLocaleLowerCase()===text));}

export function clientDirectory(path){return withClientDb(path,db=>db.prepare(`${clientSelect} ORDER BY id`).all().map((c,i)=>({...c,displayNumber:i+1})));}
export function clientSavedReports(path,id){return withClientDb(path,db=>db.prepare('SELECT job_id AS jobId,posting_id AS postingId,job_status AS status,success_count AS successCount,failed_count AS failedCount,unknown_count AS unknownCount,snapshot_json AS snapshotJson FROM client_campaign_reports WHERE client_id=? ORDER BY job_id').all(id).map(r=>({...r,snapshot:r.snapshotJson?JSON.parse(r.snapshotJson):null})));}

export function clientPostingLinks(path,id){return withClientDb(path,db=>db.prepare('SELECT posting_id AS postingId,label FROM client_postings WHERE client_id=?').all(id));}
