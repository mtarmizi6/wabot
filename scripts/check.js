import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from '../src/system/paths.js';
function check(dir) {
  for (const file of readdirSync(dir, { withFileTypes:true })) {
    const path=join(dir,file.name);
    if (file.isDirectory()) check(path);
    else if (/\.(js|cjs)$/.test(path)) {
      const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});
      if (result.error || result.status !== 0) process.exit(1);
    }
  }
}
for (const dir of ['src','scripts','tests','miniapp']) check(join(projectRoot,dir));
console.log('Semakan syntax OK.');
