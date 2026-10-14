import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeDatabase } from '../src/database/connection.js';
import { createPosting, createPostingAd, savePostingPlanAccounts, setPostingSuccessTarget, createPostingJob, getPostingJob, markPostingReady } from '../src/posting/store.js';
import {
 createClient,getClient,listClients,setClientField,setClientPrice,addClientPayment,clientPaymentStatus,
 linkClientPosting,unlinkClientPosting,clientForPosting,listClientCampaigns,saveClientCampaignSnapshot,moneyToCents
} from '../src/clients/store.js';
import { clientListMessage, clientDetailMessage, clientCampaignMessage, clientReportMessage } from '../src/clients/ui.js';
import { routeTelegramUpdate, controllerKeyboard, postingNewMessage } from '../src/telegram/controller.js';
const owner = '123456789';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'wap-clients-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const main=join(dir,'wapromobot.sqlite'),clients=join(dir,'clients.sqlite');initializeDatabase(main);return {main,clients};}
function command(s,from=owner){return routeTelegramUpdate({message:{from:{id:Number(from)},chat:{id:Number(from),type:'private'},text:s}},owner);}

test('Client profile persists payment state and rejects duplicate overpayment',t=>{
 const {clients}=fixture(t);
 const c=createClient(clients,'Ahmad Printing');
 assert.equal(c.id,1);
 assert.equal(listClients(clients).total,1);
 assert.equal(clientPaymentStatus(c),'BELUM TETAP HARGA');
 setClientField(clients,c.id,'packageName','STANDARD 600 Group');
 setClientField(clients,c.id,'contact','60123456789');
 setClientPrice(clients,c.id,'29.00');
 let updated=addClientPayment(clients,c.id,'10');
 assert.equal(updated.paidCents,1000);
 assert.equal(clientPaymentStatus(updated),'PARTIAL');
 assert.throws(()=>addClientPayment(clients,c.id,'20'),/melebihi/);
 updated=addClientPayment(clients,c.id,'19');
 assert.equal(clientPaymentStatus(updated),'PAID');
 assert.equal(getClient(clients,c.id).packageName,'STANDARD 600 Group');
 assert.throws(()=>setClientPrice(clients,c.id,'10'),/lebih rendah/);
 assert.equal(moneyToCents('RM2.05'),205);
 assert.throws(()=>moneyToCents('1.234'),/jumlah|Masukkan/);
});

test('Independent client DB links multiple posts even when labels match',t=>{
 const {main,clients}=fixture(t);
 const c1=createClient(clients,'Ahmad Printing');const c2=createClient(clients,'Ali Affiliate');
 const p1=createPosting(main,{ownerType:'CLIENT',displayName:c1.name});
 linkClientPosting(clients,c1.id,p1.id,p1.displayName);
 assert.deepEqual({...clientForPosting(clients,p1.id)},{clientId:c1.id,postingId:p1.id});
 assert.throws(()=>linkClientPosting(clients,c2.id,p1.id,p1.displayName),/UNIQUE/);
 const linked=listClientCampaigns(clients,main,c1.id);
 assert.equal(linked.links.length,1);assert.equal(linked.jobs.length,0);
 assert.match(clientListMessage(listClients(clients)),/client 2/);
 assert.match(clientDetailMessage(c1,linked),/Client 1/);
 assert.match(clientCampaignMessage(c1,linked),/Tiada kempen/);
 assert.match(clientReportMessage(c1,linked),/Tiada kempen/);
 assert.equal(unlinkClientPosting(clients,p1.id),true);
 assert.equal(clientForPosting(clients,p1.id),null);
});

test('Client report snapshots remain isolated from other clients and do not double count',t=>{
 const {main,clients}=fixture(t);
 const c1=createClient(clients,'Ahmad Printing'),c2=createClient(clients,'Ali Affiliate');
 const p1=createPosting(main,{ownerType:'CLIENT',displayName:'Ahmad Printing'});
 linkClientPosting(clients,c1.id,p1.id,p1.displayName);
 // A persisted report can be kept even when main engine clears old job details.
 assert.equal(saveClientCampaignSnapshot(clients,{job:{id:19,postingId:p1.id,status:'COMPLETED',successCount:95,failedCount:5,processedCount:100,completedAt:'2026-09-29T05:00:00.000Z'}},'CAM-019.txt'),true);
 const result=listClientCampaigns(clients,main,c1.id);
 assert.equal(result.jobs.length,1);
 assert.equal(result.jobs[0].successCount,95);
 assert.equal(result.jobs[0].reportFilename,'CAM-019.txt');
 assert.match(clientReportMessage(c1,result),/Success : 95/);
 assert.equal(listClientCampaigns(clients,main,c2.id).jobs.length,0);
 saveClientCampaignSnapshot(clients,{job:{id:19,postingId:p1.id,status:'COMPLETED',successCount:96,failedCount:4,processedCount:100}},'');
 assert.equal(listClientCampaigns(clients,main,c1.id).jobs[0].successCount,96);
 assert.equal(listClientCampaigns(clients,main,c1.id).jobs[0].reportFilename,'CAM-019.txt');
 assert.equal(saveClientCampaignSnapshot(clients,{job:{id:55,postingId:222,status:'COMPLETED'}},'x'),false);
});

test('Owner commands route correctly without adding a tenth main menu or buttons',()=>{
 const expected=new Map([
  ['.client','client_list'],['.client-new','client_new'],['.client 1','client_detail'],
  ['.client-list 2','client_list'],['.client-post 1','client_post'],['.client-report 1','client_report'],
  ['.client-campaign 1','client_campaign'],['.client-package 1','client_edit'],
  ['.client-price 1','client_edit'],['.client-paid 1','client_edit'],
  ['.client-contact 1','client_edit'],['.client-note 1','client_edit'],
  ['.client-cancel','client_cancel'],['.mula-client-manual','posting_client_manual']
 ]);
 for(const [msg,action] of expected)assert.equal(command(msg).action,action,msg);
 assert.equal(command('.client-new','9876543').action,'ignore');
 assert.equal(controllerKeyboard().inline_keyboard.flat().length,9);
 assert.match(postingNewMessage(),/\.client/);
});

