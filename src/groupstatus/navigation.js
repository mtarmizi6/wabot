// Display positions are valid only for the directory snapshot the owner saw.
export function resolveGsSelection(jobs,context,value){
 const ids=jobs.map(j=>Number(j.id));
 if(value){
  const n=Number(value),seen=context.numbers;
  if(!Number.isSafeInteger(n)||n<1)return {error:'Nombor kempen tidak sah.'};
  if(!Array.isArray(seen)||JSON.stringify(seen)!==JSON.stringify(ids))return {error:'Senarai kempen berubah. Pilih semula daripada senarai terkini.'};
  const id=seen[n-1];return id?{id}:{error:'Kempen tidak ditemui dalam senarai.'};
 }
 if(ids.includes(Number(context.jobId)))return {id:Number(context.jobId)};
 return {error:'Pilih kempen dahulu. Dashboard, laporan dan rekod akan merujuk kempen pilihan yang sama.'};
}
