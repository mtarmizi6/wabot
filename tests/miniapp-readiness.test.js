import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {MiniAppController,waitForPanel,probeReason} from '../src/miniapp/controller.js';
const turn=()=>new Promise(r=>setImmediate(r));
function controller(t){
 const sent=[],menus=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.emit('exit',0);};
 const c=new MiniAppController({projectRoot:'/nonexistent-panel-test',send:async(...x)=>sent.push(x),ownerId:'123',spawnTunnel:()=>child});
 c.config.mode='quick';c.menuButton=async url=>menus.push(url);c.server={readinessNonce:'nonce',close(){}};c.readyAbort=new AbortController();c.starting=true;
 t.after(()=>c.close());return {c,child,sent,menus};
}
test('HTTPS readiness retries DNS/unready/wrong server and only accepts this server challenge',async()=>{
 const attempts=[];let calls=0;await waitForPanel('https://panel.test','nonce',{attempts:4,pause:async()=>{},fetcher:async(url,opts)=>{
 attempts.push([url,opts]);if(++calls===1)throw Error('ENOTFOUND');return {ok:true,json:async()=>({ready:calls===3?'nonce':'other'})};
 }});assert.equal(calls,3);assert.ok(attempts.every(([url,opts])=>url.endsWith('/nonce')&&!opts.headers&&opts.redirect==='error'));
 await assert.rejects(waitForPanel('https://panel.test','nonce',{attempts:2,pause:async()=>{},fetcher:async()=>({ok:false,json:async()=>({ready:'nonce'})})}),/belum dapat/);
});
test('readiness cancellation stops retries',async()=>{
 const abort=new AbortController();let calls=0;
 await assert.rejects(waitForPanel('https://panel.test','nonce',{signal:abort.signal,pause:async()=>{},fetcher:async()=>{calls++;abort.abort();throw Error('network');}}));assert.equal(calls,1);
});
test('quick tunnel URL announcement does not publish ready before HTTPS challenge',async t=>{
 const {c,child,sent,menus}=controller(t);let done;c.readinessCheck=()=>new Promise(r=>done=r);c.quickTunnel();
 child.stderr.write('https://sample-tunnel.trycloudflare.com\n');await turn();assert.equal(c.url,'');assert.equal(c.starting,true);assert.equal(sent.length,0);assert.equal(menus.length,0);
 done(true);await turn();assert.equal(c.url,'https://sample-tunnel.trycloudflare.com');assert.equal(c.starting,false);assert.deepEqual(menus,[c.url]);assert.equal(sent.length,0);
 child.emit('exit',1);await turn();assert.equal(c.url,'');assert.equal(menus.at(-1),'');assert.match(c.error,/terputus/);
});
test('old tunnel completion after stop cannot publish URL or ready message',async t=>{
 const {c,child,sent,menus}=controller(t);let done;c.readinessCheck=()=>new Promise(r=>done=r);c.quickTunnel();child.stdout.write('https://old.trycloudflare.com');await turn();c.stopRuntime();done(true);await turn();assert.equal(c.url,'');assert.equal(sent.length,0);assert.equal(menus.length,0);
});
test('failed HTTPS challenge retains local server and tunnel without claiming ready',async t=>{
 const {c,child,sent,menus}=controller(t);c.readinessCheck=async()=>{throw Error('Alamat belum dapat dicapai.');};c.quickTunnel();child.stderr.write('https://bad.trycloudflare.com');await turn();assert.equal(c.url,'');assert.ok(c.server);assert.equal(c.tunnel,child);assert.equal(c.pendingUrl,'https://bad.trycloudflare.com');assert.ok(c.retryTimer);assert.equal(c.starting,false);assert.equal(menus.length,0);assert.ok(sent.every(x=>!x[1].startsWith('📱 MINI APP SEDIA')));
});
test('fixed URL readiness runs in background and cancellation keeps controller responsive',async t=>{
 const {c,sent}=controller(t);c.stopRuntime();c.config={enabled:true,mode:'fixed',url:'https://panel.test',port:0};c.manager={on(){},off(){}};
 let done;c.readinessCheck=()=>new Promise(r=>done=r);await c.start();assert.equal(c.starting,true);assert.equal(c.url,'');
 c.stopRuntime();done(true);await turn();assert.equal(sent.length,0);assert.equal(c.url,'');
});
test('transient DNS failure automatically recovers using the same running tunnel',async t=>{
 const {c,child,sent,menus}=controller(t);c.retryDelayMs=5;let checks=0;
 c.readinessCheck=async()=>{if(++checks===1)throw Error('DNS belum dapat diselesaikan (ENOTFOUND)');return true;};
 let done;const recovered=new Promise(r=>done=r);const original=c.menuButton;c.menuButton=async(...args)=>{await original(...args);done();};
 c.quickTunnel();child.stderr.write('https://recover.trycloudflare.com\nRegistered tunnel connection');
 let timeout;try{await Promise.race([recovered,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('recovery did not run')),1000);})]);}finally{clearTimeout(timeout);}
 assert.equal(checks,2);assert.equal(c.tunnel,child);assert.equal(c.url,'https://recover.trycloudflare.com');assert.equal(c.error,'');assert.equal(c.retryTimer,null);assert.equal(menus.length,1);assert.equal(sent.filter(x=>x[1].startsWith('📱 MINI APP SEDIA')).length,0);
});
test('pending panel only offers explicit test button after tunnel registration; duplicate commands reuse probe',async t=>{
 const {c,child,sent}=controller(t);let done,checks=0;c.readinessCheck=()=>{checks++;return new Promise(r=>done=r);};c.quickTunnel();child.stderr.write('https://pending.trycloudflare.com');
 await c.handle({action:'panel',chatId:'123'});assert.equal(sent.at(-1)[2],undefined);
 child.stderr.write('Registered tunnel connection connIndex=0');
 await c.handle({action:'panel',chatId:'123'});assert.match(sent.at(-1)[1],/belum disahkan/);assert.equal(sent.at(-1)[2].inline_keyboard[0][0].text,'🧪 Uji Buka Panel');assert.equal(c.server.origin,'https://pending.trycloudflare.com');
 await c.handle({action:'panel_quick',chatId:'123'});await c.handle({action:'panel_quick',chatId:'123'});assert.equal(checks,1);assert.equal(c.tunnel,child);done(true);await turn();
});
test('stop cancels delayed recovery and cannot publish a stale ready message',async t=>{
 const {c,child,sent}=controller(t);let checks=0;c.retryDelayMs=5;c.readinessCheck=async()=>{checks++;throw Error('DNS');};c.quickTunnel();child.stderr.write('https://cancel.trycloudflare.com');await turn();assert.ok(c.retryTimer);c.stopRuntime();
 await new Promise(r=>setTimeout(r,20));assert.equal(checks,1);assert.equal(c.pendingUrl,'');assert.equal(c.retryTimer,null);assert.equal(c.server,null);assert.ok(sent.every(x=>!x[1].startsWith('📱 MINI APP SEDIA')));
});
test('probe diagnostics preserve safe DNS/HTTP causes without leaking response text',async()=>{
 const err=Object.assign(Error('fetch failed secret-value'),{cause:{code:'ENOTFOUND'}});assert.match(probeReason(err),/ENOTFOUND/);assert.doesNotMatch(probeReason(err),/secret/);
 await assert.rejects(waitForPanel('https://panel.test','nonce',{attempts:1,fetcher:async()=>{throw err;}}),/ENOTFOUND/);
 await assert.rejects(waitForPanel('https://panel.test','nonce',{attempts:1,fetcher:async()=>({ok:false,status:530,json:async()=>{throw Error('must not parse error HTML');}})}),/HTTP 530/);
});
test('cloudflared API endpoint is never mistaken for the allocated public URL',async t=>{
 const {c,child}=controller(t);let checks=0;c.readinessCheck=async()=>{checks++;return true;};c.quickTunnel();child.stderr.write('Request https://api.trycloudflare.com/tunnel');await turn();assert.equal(checks,0);assert.equal(c.pendingUrl,'');
 child.stderr.write('\nhttps://real-endpoint.trycloud');child.stderr.write('flare.com\n');await turn();assert.equal(c.url,'https://real-endpoint.trycloudflare.com');assert.equal(checks,1);
});
test('wrong panel identity cannot expose the pending test button',async t=>{
 const {c,child,sent}=controller(t);c.readinessCheck=()=>waitForPanel('https://wrong.test','nonce',{attempts:1,fetcher:async()=>({ok:true,json:async()=>({ready:'someone-else'})})});c.quickTunnel();child.stderr.write('https://wrong.trycloudflare.com\nRegistered tunnel connection');await turn();
 assert.equal(c.identityMismatch,true);await c.handle({action:'panel',chatId:'123'});assert.equal(sent.at(-1)[2],undefined);assert.equal(c.url,'');
});
test('recovery has a bounded automatic budget and leaves the tunnel available for explicit retry',async t=>{
 const {c,child,sent}=controller(t);let checks=0;c.readinessCheck=async()=>{checks++;throw Error('HTTP 530');};c.quickTunnel();child.stderr.write('https://slow.trycloudflare.com');await c.probePromise;
 for(let n=1;n<6;n++)await c.beginReadiness(c.pendingUrl);
 assert.equal(checks,6);assert.equal(c.retryTimer,null);assert.equal(c.tunnel,child);assert.ok(c.server);assert.equal(sent.length,0);assert.equal(c.error,'HTTP 530');
 await c.handle({action:'panel_quick',chatId:'123'});await c.probePromise;assert.equal(checks,7);assert.equal(c.tunnel,child);
});
test('Telegram ready-notice failure does not downgrade an already verified panel',async t=>{
 const {c,child}=controller(t);c.readinessCheck=async()=>true;c.send=async()=>{throw Error('Telegram offline');};c.quickTunnel();child.stderr.write('https://ready.trycloudflare.com');await c.probePromise;
 assert.equal(c.url,'https://ready.trycloudflare.com');assert.equal(c.pendingUrl,'');assert.equal(c.retryTimer,null);assert.equal(c.error,'');assert.equal(c.starting,false);
});
test('real local challenge works while pending-origin API still requires owner authentication',async t=>{
 const {PanelServer}=await import('../src/miniapp/server.js');
 const server=new PanelServer({root:'/nonexistent-panel-assets',data:{},act(){throw Error('must not run');},token:'123:test-token',ownerId:'123',port:0});
 const address=await server.start();t.after(()=>server.close());server.origin='https://pending.trycloudflare.com';const local='http://127.0.0.1:'+address.port;
 assert.equal(await waitForPanel(local,server.readinessNonce,{attempts:1}),true);
 assert.equal((await fetch(local+'/api/overview',{headers:{Origin:server.origin}})).status,401);
 assert.equal((await fetch(local+'/api/action',{method:'POST',headers:{Origin:server.origin,'Content-Type':'application/json'},body:JSON.stringify({action:'resume',key:'join:1'})})).status,401);
 assert.equal((await fetch(local+'/api/overview',{headers:{Origin:'https://other.test'}})).status,403);
});
test('repeated panel-quick after readiness keeps the same server, tunnel, URL and menu',async t=>{
 const {c,child,sent,menus}=controller(t);let checks=0,spawns=0;
 c.spawnTunnel=()=>{spawns++;return child;};c.readinessCheck=async()=>{checks++;return true;};
 c.save=()=>assert.fail('a repeated check must not rewrite config');
 c.start=async()=>assert.fail('a repeated check must not restart');
 c.quickTunnel();child.stderr.write('https://stable.trycloudflare.com\nRegistered tunnel connection');await c.probePromise;
 const server=c.server,version=c.runtimeVersion,url=c.url;
 await c.handle({action:'panel_quick',chatId:'123'});
 await c.handle({action:'panel',chatId:'123'});
 await c.handle({action:'panel_quick',chatId:'123'});
 assert.equal(c.server,server);assert.equal(c.tunnel,child);assert.equal(c.runtimeVersion,version);assert.equal(c.url,url);
 assert.equal(spawns,1);assert.equal(checks,1);assert.deepEqual(menus,[url]);
 for(const msg of sent.slice(-3))assert.equal(msg[2].inline_keyboard[0][0].web_app.url,url);
 assert.equal(sent.filter(x=>x[1].startsWith('📱 MINI APP SEDIA')).length,0);
});
test('fresh registration clears retry notes, split log chunks work, old events are not replayed',async t=>{
 const {c,child}=controller(t);let done;c.readinessCheck=()=>new Promise(r=>done=r);c.quickTunnel();child.stderr.write('https://log.trycloudflare.com\n');
 child.stderr.write('failed to dial\nRegistered tunnel connection\n');assert.equal(c.tunnelConnected,true);assert.equal(c.tunnelNote,'');
 child.stderr.write('failed to dial\n');assert.match(c.tunnelNote,/dicuba semula/);
 child.stdout.write('unrelated log\n');assert.match(c.tunnelNote,/dicuba semula/);
 child.stderr.write('Registered tunnel con');assert.match(c.tunnelNote,/dicuba semula/);
 child.stderr.write('nection\n');assert.equal(c.tunnelNote,'');
 child.stderr.write('unrelated log\n');assert.equal(c.tunnelNote,'');
 child.stdout.write('lookup edge: no such host\n');assert.match(c.tunnelNote,/DNS/);
 child.stderr.write('another unrelated log\n');assert.match(c.tunnelNote,/DNS/);
 child.stdout.write('Registered tunnel connection\nfailed to dial\n');assert.match(c.tunnelNote,/dicuba semula/);
 done(true);await c.probePromise;assert.equal(c.tunnelNote,'');assert.equal(c.error,'');
});
test('temporary transport retries after verification keep the URL available and recover the displayed note',async t=>{
 const {c,child,sent}=controller(t);c.readinessCheck=async()=>true;c.quickTunnel();child.stderr.write('https://same.trycloudflare.com\nRegistered tunnel connection');await c.probePromise;
 child.stderr.write('\nhandshake timeout\n');
 await c.handle({action:'panel_quick',chatId:'123'});assert.equal(c.tunnel,child);assert.equal(c.url,'https://same.trycloudflare.com');assert.match(sent.at(-1)[1],/dicuba semula/);
 child.stderr.write('Registered tunnel connection\n');
 await c.handle({action:'panel',chatId:'123'});assert.equal(c.tunnelNote,'');assert.doesNotMatch(sent.at(-1)[1],/dicuba semula/);
 assert.equal(sent.at(-1)[2].inline_keyboard[0][0].web_app.url,'https://same.trycloudflare.com');
});
test('explicit panel-off releases verified runtime and panel-quick can start again',async t=>{
 const {c,child,sent,menus}=controller(t);c.save=()=>{};c.readinessCheck=async()=>true;c.quickTunnel();child.stderr.write('https://old-ready.trycloudflare.com');await c.probePromise;
 await c.handle({action:'panel_off',chatId:'123'});
 assert.equal(c.url,'');assert.equal(c.server,null);assert.equal(c.tunnel,null);assert.equal(c.config.enabled,false);assert.equal(menus.at(-1),'');
 let starts=0;c.start=async()=>{starts++;};
 await c.handle({action:'panel_quick',chatId:'123'});
 assert.equal(starts,1);assert.equal(c.config.enabled,true);assert.equal(c.config.mode,'quick');
 const count=sent.length;child.stderr.write('\nRegistered tunnel connection\nfailed to dial\n');
 assert.equal(c.tunnelConnected,false);assert.equal(c.tunnelNote,'');assert.equal(sent.length,count);
});
test('genuine tunnel exit clears the verified address so a later quick command can recover',async t=>{
 const {c,child,menus}=controller(t);c.save=()=>{};c.readinessCheck=async()=>true;c.quickTunnel();child.stderr.write('https://exited.trycloudflare.com');await c.probePromise;
 child.emit('exit',1);await turn();assert.equal(c.url,'');assert.equal(c.tunnel,null);assert.equal(c.server,null);assert.equal(menus.at(-1),'');
 let starts=0;c.start=async()=>{starts++;};await c.handle({action:'panel_quick',chatId:'123'});assert.equal(starts,1);
});

test('tunnel failure remains silent until owner requests panel status',async t=>{const {c,child,sent}=controller(t);c.quickTunnel();child.emit('error',new Error('missing tunnel'));await turn();assert.equal(sent.length,0);assert.match(c.error,/cloudflared/);await c.handle({action:'panel',chatId:'123'});assert.equal(sent.length,1);assert.match(sent[0][1],/cloudflared/);});
