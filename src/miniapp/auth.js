import {createHmac,timingSafeEqual} from 'node:crypto';
export function validateInitData(raw,token,owner,now=Date.now()) {
 if(typeof raw!=='string'||raw.length>16384)throw new Error('Sila buka panel melalui bot anda.');
 const p=new URLSearchParams(raw),seen=new Set();for(const [k]of p){if(seen.has(k))throw new Error('Data pengesahan tidak sah.');seen.add(k);}
 const hash=p.get('hash');if(!/^[a-f0-9]{64}$/i.test(hash||''))throw new Error('Pengesahan Telegram diperlukan.');
 p.delete('hash');const check=[...p].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();const expected=createHmac('sha256',secret).update(check).digest();
 if(!timingSafeEqual(expected,Buffer.from(hash,'hex')))throw new Error('Bot / tandatangan tidak sepadan.');
 const at=Number(p.get('auth_date'));if(!Number.isSafeInteger(at)||at>now/1000+30||now/1000-at>3600)throw new Error('Sesi panel luput. Tutup dan buka semula dari bot.');
 let user;try{user=JSON.parse(p.get('user'));}catch{throw new Error('Identiti tidak sah.');}
 if(!user||String(user.id)!==String(owner))throw new Error('Panel ini hanya untuk pemilik bot.');
 return {id:String(user.id),name:String(user.first_name||'Pemilik').slice(0,80)};
}
