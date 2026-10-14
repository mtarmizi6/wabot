import {statfsSync} from 'node:fs';
import {dirname} from 'node:path';
const cached=new Map();
export function diskReady(databasePath,now=Date.now()) {let value=cached.get(databasePath);if(!value||now-value.at>30000){try{const s=statfsSync(dirname(databasePath));value={at:now,ready:Number(s.bavail)*Number(s.bsize)>=32*1024*1024};}catch{value={at:now,ready:true};}cached.set(databasePath,value);}return value.ready;}
