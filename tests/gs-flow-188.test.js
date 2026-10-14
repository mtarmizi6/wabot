import {policyDb} from '../src/system/policy.js';
import {SystemFlow} from '../src/system/flow.js';
import {archiveGs} from '../src/system/lifecycle.js';
import { CampaignHub } from '../src/telegram/campaign-hub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {initializeDatabase} from '../src/database/connection.js';
import * as gs from '../src/groupstatus/store.js';
import * as posting from '../src/posting/store.js';
import * as wa from '../src/whatsapp/store.js';
import * as ui from '../src/telegram/controller.js';
import {GroupStatusLive} from '../src/telegram/groupstatus-live.js';
import {resolveGsSelection} from '../src/groupstatus/navigation.js';
import * as navigation from '../src/telegram/posting-draft.js';
import * as gsUi from '../src/telegram/groupstatus-ui.js';
import {accountNumber} from '../src/telegram/accounts-ui.js';
const runtime=fs.readFileSync(new URL('../scripts/telegram-controller.js',import.meta.url),'utf8');
function harness(t){
 const dir=fs.mkdtempSync(join(tmpdir(),'gs-flow-188-')),db=join(dir,'db.sqlite');initializeDatabase(db);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const a=wa.createWhatsAppAccount(db,{phone:'60123456789'});wa.updateWhatsAppAccount(db,a.id,{status:'ONLINE',lastConnectedAt:new Date().toISOString()});wa.syncWhatsAppGroups(db,a.id,[{jid:'1@g.us',subject:'First Group'},{jid:'2@g.us',subject:'Second Group'}]);
 const sent=[];const send=async(chat,text)=>{sent.push(text);return {message_id:sent.length};};
 const deps={followupFlow:{leave(){},handle:async()=>false},...fs,...gs,...posting,...wa,...ui,...gsUi,...navigation,build:196,SystemFlow,archiveGs,policyDb,resolveGsSelection,GroupStatusLive,CampaignHub,join,extname,randomUUID,accountNumber,databasePath:db,projectRoot:dir,ownerId:'1',token:'test',abort:{signal:{aborted:false}},running:false,sendScreen:send,sendMessage:async(token,chat,text)=>send(chat,text),editMessageText:async()=>({}),sleep:async()=>{},sendMenu:()=>send('1','MENU'),whatsapp:{get:id=>wa.getWhatsAppAccount(db,id),list:()=>wa.listWhatsAppAccounts(db)},accountFlow:{cancel:async()=>{},handle:async()=>false,capture:()=>{},mapRoute:r=>r},joinFlow:{leave:()=>{},handle:async()=>false},groupFlow:{handle:async()=>false},postingLive:{handle:async()=>false,confirmations:new Map()},clientFlow:{handle:async()=>false}};
 delete deps.default;
 let gsHelpers=runtime.slice(runtime.indexOf('let gsContext='),runtime.indexOf('function formatMalaysiaDateTime'));
 gsHelpers=gsHelpers.slice(0,gsHelpers.indexOf('function beginGsRunner'))+'function beginGsRunner(){}\n'+gsHelpers.slice(gsHelpers.indexOf('async function saveGsMedia'));
 const postingHelpers=runtime.slice(runtime.indexOf('function normalizePostingAccountSelection'),runtime.indexOf('function currentStorageMessage'));
 const dispatch=runtime.slice(runtime.indexOf('async function dispatch(route)'),runtime.indexOf('\nfunction enableStopKey()',runtime.indexOf('async function dispatch(route)')));
 const factory=new Function(...Object.keys(deps),`let pendingInput=null,postingUi=null,postingScreen=null;const gsRunners=new Map(),gsLiveMessages=new Map();${gsHelpers}\n${postingHelpers}\n${dispatch}\nreturn {close:closeGsLive,dispatch,state:()=>({pendingInput,gsContext})};`);
 const h=factory(...Object.values(deps));t.after(()=>h.close());return {...h,db,sent,command:text=>h.dispatch(ui.routeTelegramUpdate({message:{from:{id:1},chat:{id:1,type:'private'},text}},'1'))};
}
test('actual four-step Status wizard uses reply selection, separate settings and final preview',async t=>{
 const h=harness(t);await h.command('.gs-new');assert.match(h.sent.at(-1),/LANGKAH 1\/4/);await h.command('1');assert.match(h.sent.at(-1),/LANGKAH 2\/4/);await h.command('Test Status');assert.match(h.sent.at(-1),/LANGKAH 3\/4/);await h.command('.gs-setting');for(const value of ['60','120','25','5','10'])await h.command(value);await h.command('SAH');assert.match(h.sent.at(-1),/LANGKAH 3\/4/);await h.command('.gs-preview');assert.match(h.sent.at(-1),/LANGKAH 4\/4/);assert.match(h.sent.at(-1),/Sasaran Akaun–Group : 2/);await h.command('.gs-new');assert.equal(gs.listGsJobs(h.db).length,1);
});

test('STOP confirmation binds campaign, cancel preserves RUNNING and resume keeps the same target snapshot',async t=>{const h=harness(t);await h.command('.gs-new');await h.command('all');await h.command('Test');await h.command('.gs-preview');await h.command('.gs-run');await new Promise(r=>setImmediate(r));const job=gs.listGsJobs(h.db)[0];assert.equal(job.status,'RUNNING');await h.command('.gs-stop');assert.equal(gs.gsSnapshot(h.db,job.id).status,'RUNNING');await h.command('.batal');assert.equal(gs.gsSnapshot(h.db,job.id).status,'RUNNING');await h.command('.gs-stop');await h.command('SAH');assert.equal(gs.gsSnapshot(h.db,job.id).status,'STOPPED');await h.command('.gs-resume');assert.equal(gs.gsSnapshot(h.db,job.id).status,'RUNNING');assert.equal(gs.gsSnapshot(h.db,job.id).total,2);});

test('report and records share the opened campaign and never expose internal GS IDs',async t=>{const h=harness(t);await h.command('.gs-new');await h.command('all');await h.command('Old Status');const old=gs.listGsJobs(h.db)[0];gs.setGsStatus(h.db,old.id,'STOPPED');await h.command('.gs-new');await h.command('all');await h.command('Current Status');await h.command('.gs-list');await h.command('.gs-status 1');await h.command('.gs-report');assert.match(h.sent.at(-1),/Kempen 1/);await h.command('.gs-posts');assert.match(h.sent.at(-1),/AUTO STATUS 1 · REKOD PENGHANTARAN/);assert.doesNotMatch(h.sent.at(-1),/GS-\d/);await h.command('.gs-status 2');await h.command('.gs-report');assert.match(h.sent.at(-1),/Kempen 2/);});
test('stale list number is rejected and deleted context never silently selects another job',()=>{const old={numbers:[15,7],jobId:15};assert.match(resolveGsSelection([{id:22},{id:15},{id:7}],old,'1').error,/berubah/);assert.match(resolveGsSelection([{id:7}],old).error,/Pilih/);assert.equal(resolveGsSelection([{id:15},{id:7}],old,'2').id,7);});

test('delete SAH remains bound to the chosen campaign after directory positions change',async t=>{const h=harness(t);await h.command('.gs-new');await h.command('all');await h.command('Old');const old=gs.listGsJobs(h.db)[0];gs.setGsStatus(h.db,old.id,'STOPPED');await h.command('.gs-list');await h.command('.gs-delete 1');const other=gs.createGsJob(h.db);await h.command('SAH');assert.equal(gs.getGsJob(h.db,old.id),null);assert.ok(gs.getGsJob(h.db,other.id));});

test('delete is discoverable, cancellation preserves data and confirmation refreshes numbering',async t=>{
 const h=harness(t);await h.command('.gs-new');await h.command('all');await h.command('Delete menu test');const job=gs.listGsJobs(h.db)[0];
 await h.command('.gs-list');assert.match(h.sent.at(-1),/\.gs-delete 1 → Padam Kempen/);
 assert.match(gsUi.gsDashboard({...gs.gsSnapshot(h.db,job.id),displayNumber:1}),/\.gs-delete 1 → Padam Kempen/);
 await h.command('.gs-delete 1 confirm');assert.ok(gs.getGsJob(h.db,job.id));assert.match(h.sent.at(-1),/Baki Belum Diproses : 2/);assert.match(h.sent.at(-1),/Balas SAH/);
 await h.command('.batal');assert.ok(gs.getGsJob(h.db,job.id));assert.ok(h.sent.some(x=>/Padam dibatalkan/.test(x)));assert.doesNotMatch(h.sent.slice(-2).join('\n'),/Draf disimpan/);
 await h.command('.gs-delete 1');await h.command('SAH');assert.equal(gs.getGsJob(h.db,job.id),null);assert.match(h.sent.at(-1),/SENARAI AUTO STATUS GROUP/);assert.doesNotMatch(h.sent.at(-1),/\.gs-delete 1/);
});

test('unified status uses the existing GS controller for pause resume and bound stop',async t=>{const h=harness(t);await h.command('.gs-new');await h.command('all');await h.command('Unified Status');await h.command('.gs-preview');await h.command('.gs-run');const j=gs.listGsJobs(h.db)[0];await h.command('.status');assert.match(h.sent.at(-1),/KEMPEN AKTIF/);await h.command('.status 1');await h.command('.kempen-pause 1');assert.equal(gs.gsSnapshot(h.db,j.id).status,'PAUSED');await h.command('.kempen-resume 1');assert.equal(gs.gsSnapshot(h.db,j.id).status,'RUNNING');await h.command('.kempen-stop 1');assert.equal(gs.gsSnapshot(h.db,j.id).status,'RUNNING');await h.command('SAH');assert.equal(gs.gsSnapshot(h.db,j.id).status,'STOPPED');await h.command('.rekod');assert.match(h.sent.at(-1),/Unified Status/);});

test('GS record detail resumes the same pending campaign and confirmed delete returns unified records',async t=>{const h=harness(t);await h.command('.gs-new');await h.command('all');await h.command('Record flow');await h.command('.gs-preview');await h.command('.gs-run');const j=gs.listGsJobs(h.db)[0];await h.command('.gs-stop');await h.command('SAH');await h.command('.rekod');await h.command('.kempen-open 1');assert.match(h.sent.at(-1),/REKOD KEMPEN 1/);assert.match(h.sent.at(-1),/kempen-resume 1/);await h.command('.kempen-posts 1');assert.match(h.sent.at(-1),/REKOD PENGHANTARAN/);await h.command('.kempen-resume 1');assert.equal(gs.gsSnapshot(h.db,j.id).status,'RUNNING');assert.equal(gs.gsSnapshot(h.db,j.id).total,2);assert.match(h.sent.at(-1),/KEMPEN AKTIF/);await h.command('.kempen-stop 1');await h.command('SAH');await h.command('.rekod');await h.command('.kempen-delete 1');assert.ok(gs.getGsJob(h.db,j.id));await h.command('.batal');assert.ok(gs.getGsJob(h.db,j.id));await h.command('.rekod');await h.command('.kempen-delete 1');await h.command('SAH');assert.equal(gs.getGsJob(h.db,j.id),null);assert.match(h.sent.at(-1),/REKOD KEMPEN/);});

test('report commands route GS reports and confirmed deletion back to reports',async t=>{const h=harness(t);await h.command('.gs-new');await h.command('all');await h.command('Report routing');await h.command('.gs-preview');await h.command('.gs-run');await h.command('.gs-stop');await h.command('SAH');const j=gs.listGsJobs(h.db)[0];await h.command('.report');assert.match(h.sent.at(-1),/LAPORAN KEMPEN/);await h.command('.report 1');assert.match(h.sent.at(-1),/ACK OK/);assert.match(h.sent.at(-1),/Padam Laporan & Rekod/);await h.command('.kempen-delete 1');await h.command('.batal');assert.match(h.sent.at(-1),/LAPORAN KEMPEN/);await h.command('.kempen-delete 1');await h.command('SAH');assert.equal(gs.getGsJob(h.db,j.id),null);assert.match(h.sent.at(-1),/LAPORAN KEMPEN/);});
