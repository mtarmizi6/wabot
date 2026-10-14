import {DatabaseSync} from 'node:sqlite';
const iso=()=>new Date().toISOString();
export function withDb(path,fn){const db=new DatabaseSync(path);try{db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');return fn(db);}finally{db.close();}}
function tx(path,fn){return withDb(path,db=>{db.exec('BEGIN IMMEDIATE');try{const r=fn(db);db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}});}
const decode=r=>r?{...r,...JSON.parse(r.data),id:r.id,owner:r.owner,status:r.status}:null;
function read(db,id,owner){return decode(db.prepare('SELECT * FROM fu_jobs WHERE id=? AND owner=?').get(id,String(owner)));}
function write(db,j){const {id,owner,status,data,created_at,updated_at,...payload}=j;db.prepare('UPDATE fu_jobs SET status=?,data=?,updated_at=? WHERE id=? AND owner=?').run(status,JSON.stringify(payload),iso(),id,owner);return j;}
export const getJob=(p,id,o)=>withDb(p,db=>read(db,id,o));
export const listJobs=(p,o)=>withDb(p,db=>db.prepare('SELECT * FROM fu_jobs WHERE owner=? ORDER BY id DESC').all(String(o)).map(decode));
export function editJob(p,id,o,fn){return tx(p,db=>{const j=read(db,id,o);if(!j)throw Error('Kempen tidak ditemui.');fn(j,db);return write(db,j);});}
export function newJob(p,o){return tx(p,db=>{const draft=decode(db.prepare("SELECT * FROM fu_jobs WHERE owner=? AND status='DRAFT' ORDER BY id DESC LIMIT 1").get(String(o)));if(draft)return draft;const data={stage:'accounts',accounts:[],ads:[],cursor:0,adCursor:0,round:1,pace:{min:60,max:120,batch:5,restMin:300,restMax:600,quota:20},input:null};const t=iso();const id=Number(db.prepare('INSERT INTO fu_jobs(owner,data,created_at,updated_at) VALUES(?,?,?,?)').run(String(o),JSON.stringify(data),t,t).lastInsertRowid);return read(db,id,o);});}
export function normalizePhone(s){s=String(s).trim().replace(/[ ()-]/g,'');if(/^00/.test(s))s='+'+s.slice(2);if(/^0\d{8,10}$/.test(s))s='+60'+s.slice(1);s=s.replace(/^\+/,'');return /^[1-9]\d{7,14}$/.test(s)?s:null;}
export function parseNumbers(text){if(Buffer.byteLength(text)>1024*1024)throw Error('Had senarai ialah 1 MB.');const rows=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(rows.length>20000)throw Error('Maksimum 20,000 baris setiap senarai.');let invalid=0,duplicate=0;const numbers=new Set();for(const line of rows){const n=normalizePhone(line);if(!n)invalid++;else if(numbers.has(n))duplicate++;else numbers.add(n);}return {numbers:[...numbers],total:rows.length,invalid,duplicate};}
export function importNumbers(p,id,o,text){const parsed=parseNumbers(text);return editJob(p,id,o,(j,db)=>{if(j.status!=='DRAFT')throw Error('Senarai kempen yang sudah dimulakan dikunci.');if(!parsed.numbers.length)throw Error('Tiada nombor sah. Hantar satu nombor setiap baris.');db.prepare('DELETE FROM fu_targets WHERE job_id=?').run(id);const add=db.prepare('INSERT INTO fu_targets(job_id,phone) VALUES(?,?)');for(const n of parsed.numbers)add.run(id,n);j.import={total:parsed.total,valid:parsed.numbers.length,invalid:parsed.invalid,duplicate:parsed.duplicate};j.source='numbers';j.stage='content';});}
export function snapshot(p,id,o){return withDb(p,db=>{const j=read(db,id,o);if(!j)return null;const counts={PENDING:0,PROCESSING:0,SUCCESS:0,FAILED:0,UNKNOWN:0};for(const r of db.prepare('SELECT status,COUNT(*) n FROM fu_targets WHERE job_id=? GROUP BY status').all(id))counts[r.status]=r.n;const recent=db.prepare('SELECT * FROM fu_targets WHERE job_id=? AND status<>? ORDER BY id DESC LIMIT 10').all(id,'PENDING');const perAccount=db.prepare('SELECT account_id,status,COUNT(*) n FROM fu_targets WHERE job_id=? AND account_id IS NOT NULL GROUP BY account_id,status').all(id);return {job:j,counts,recent,perAccount,total:Object.values(counts).reduce((a,b)=>a+b,0)};});}
export function recover(p,o){return tx(p,db=>{db.prepare("UPDATE fu_targets SET status='UNKNOWN',error='Controller terhenti selepas nombor dituntut; tiada retry.',finished_at=? WHERE status='PROCESSING' AND job_id IN(SELECT id FROM fu_jobs WHERE owner=?)").run(iso(),String(o));db.prepare("UPDATE fu_jobs SET status='PAUSED',updated_at=? WHERE owner=? AND status='RUNNING'").run(iso(),String(o));});}
export function startJob(p,id,o,{continueQuota=false}={}){return editJob(p,id,o,(j,db)=>{
 if(j.status==='RUNNING')return;
 if(!['DRAFT','PAUSED','STOPPED','QUOTA'].includes(j.status))throw Error('Kempen ini telah selesai.');
 if(j.source==='chats'){const ids=new Set(j.accounts.map(a=>a.id));const sources=db.prepare('SELECT DISTINCT source_account_id id FROM fu_targets WHERE job_id=?').all(id);if(sources.some(r=>!ids.has(r.id)))throw Error('Akaun pilihan berubah. Semak semula akaun asal penerima.');}
 if(!j.accounts.length||j.accounts.length>50||!j.ads.length)throw Error('Lengkapkan akaun dan bahan dahulu.');
 if(!db.prepare("SELECT 1 FROM fu_targets WHERE job_id=? AND status='PENDING'").get(id))throw Error('Tiada nombor yang belum dicuba.');
 if(db.prepare("SELECT 1 FROM fu_targets WHERE job_id=? AND status='PROCESSING'").get(id))throw Error('Tunggu penghantaran semasa selesai.');
 const exhausted=quotaExhausted(j,db);
 if(exhausted&&!continueQuota)throw Error('Kuota habis. Gunakan Sambung Baki untuk pusingan kuota baharu.');
 if(continueQuota){if(!exhausted)throw Error('Kuota masih ada. Gunakan Sambung biasa.');j.round++;j.roundUsed=0;for(const a of j.accounts)a.used=0;}
 j.quotaBlocked=false;j.status='RUNNING';j.stage=null;j.startedAt||=iso();j.endedAt=null;
});}
export function claim(p,id,o,online,now=Date.now()) {return tx(p,db=>{const j=read(db,id,o);if(j?.status!=='RUNNING')return null;
 if(db.prepare("SELECT 1 FROM fu_targets WHERE job_id=? AND status='PROCESSING'").get(id))return null;
 const target=db.prepare("SELECT * FROM fu_targets WHERE job_id=? AND status='PENDING' ORDER BY id LIMIT 1").get(id);
 if(!target){j.status='COMPLETED';j.endedAt=iso();write(db,j);return null;}
 if(quotaExhausted(j,db)){j.status='QUOTA';j.quotaBlocked=true;write(db,j);return null;}
 let index=-1;for(let i=0;i<j.accounts.length;i++){const n=(j.cursor+i)%j.accounts.length,a=j.accounts[n];if(online.includes(a.id)&&a.used<j.pace.quota&&(a.nextAt||0)<=now&&db.prepare("SELECT 1 FROM fu_targets WHERE job_id=? AND status='PENDING' AND (source_account_id IS NULL OR source_account_id=?)").get(id,a.id)){index=n;break;}}
 if(index<0)return null;const a=j.accounts[index];const eligible=db.prepare("SELECT * FROM fu_targets WHERE job_id=? AND status='PENDING' AND (source_account_id IS NULL OR source_account_id=?) ORDER BY id LIMIT 1").get(id,a.id);a.used++;j.roundUsed=(j.roundUsed||0)+1;a.attempts=(a.attempts||0)+1;j.cursor=(index+1)%j.accounts.length;
 const ad=j.ads[j.adCursor%j.ads.length];j.adCursor++;
 db.prepare("UPDATE fu_targets SET status='PROCESSING',account_id=?,attempted_at=? WHERE id=? AND status='PENDING'").run(a.id,new Date(now).toISOString(),eligible.id);write(db,j);
 return {...eligible,status:'PROCESSING',account_id:a.id,job:j,ad};});}
export function finish(p,work,result,now=Date.now(),random=Math.random){return editJob(p,work.job.id,work.job.owner,(j,db)=>{
 const target=db.prepare('SELECT * FROM fu_targets WHERE id=? AND job_id=?').get(work.id,j.id);if(!target)return;
 // A late positive result may resolve UNKNOWN, but can never schedule another send.
 if(target.status!=='PROCESSING'&&!(target.status==='UNKNOWN'&&result.status==='SUCCESS'))return;
 db.prepare('UPDATE fu_targets SET status=?,message_id=?,error=?,finished_at=? WHERE id=?').run(result.status,result.messageId||null,result.error||null,new Date(now).toISOString(),target.id);
 if(target.status==='PROCESSING'){const a=j.accounts.find(a=>a.id===work.account_id);if(a){const pick=(min,max)=>min+Math.floor(random()*(max-min+1));let wait=pick(j.pace.min,j.pace.max);if(a.attempts%j.pace.batch===0)wait+=pick(j.pace.restMin,j.pace.restMax);a.nextAt=now+wait*1000;}}
});}
export function changeStatus(p,id,o,status){return editJob(p,id,o,j=>{if(!['RUNNING','PAUSED','QUOTA','STOPPED'].includes(j.status))throw Error('Kempen belum bermula atau telah selesai.');j.status=status;if(status==='QUOTA')j.quotaBlocked=true;if(status==='STOPPED')j.endedAt=iso();});}

// Owner-scoped input routing only. Never restore a stop confirmation or run a job.
export function readInputContext(p,owner){return withDb(p,db=>{const row=db.prepare('SELECT value FROM system_meta WHERE key=?').get('fu-input:'+String(owner));if(!row)return null;try{return JSON.parse(row.value);}catch{return null;}});}
export function saveInputContext(p,owner,context){return withDb(p,db=>db.prepare('INSERT INTO system_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('fu-input:'+String(owner),JSON.stringify(context)));}

export function quotaExhausted(j,db){if(j.pace.roundLimit>0&&(j.roundUsed||0)>=j.pace.roundLimit)return true;if(!db)return j.quotaBlocked||j.accounts.every(a=>a.used>=j.pace.quota);return !j.accounts.some(a=>a.used<j.pace.quota&&db.prepare("SELECT 1 FROM fu_targets WHERE job_id=? AND status='PENDING' AND (source_account_id IS NULL OR source_account_id=?)").get(j.id,a.id));}
