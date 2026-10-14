// State race regression tests against the shipped app source; browser rendering
// and live HTTP/database integration are exercised separately in the audit.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
function harness(){
 const elements=new Map(),events={},calls=[];let refreshes=0;
 const element=()=>({innerHTML:'',content:'',className:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},querySelectorAll:()=>[],showModal(){this.open=true;},close(){this.open=false;}});
 const doc={querySelector:s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s);},querySelectorAll:()=>[],addEventListener(){},body:element(),hidden:false};
 const context=vm.createContext({document:doc,window:{Telegram:{WebApp:{initData:'synthetic',ready(){},expand(){},isVersionAtLeast:()=>false}},scrollTo(){},addEventListener:(name,fn)=>events[name]=fn},location:{search:''},URLSearchParams,URL,Blob,AbortSignal,crypto:webcrypto,localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:true}),setTimeout:()=>1,clearTimeout(){},setInterval(){},queueMicrotask,console});
 let source=readFileSync(new URL('../miniapp/app.js',import.meta.url),'utf8').replace("let demoApi;if(demo)demoApi=(await import('./demo.js')).demoApi;",'let demoApi;').replace('refresh();setInterval(refresh,5000);','');
 vm.runInContext(source+`;globalThis.audit={get state(){return state;},get generation(){return generation;},setState(s){state={...state,...s};connected=true;},setApi(fn){api=fn;},setHooks(r){render=()=>{};refresh=r;},click:handleClick,perform,navigate,openJob,get confirmation(){return confirmationTarget;},get connected(){return connected;}};`,context);
 const app=context.audit;app.setHooks(async()=>refreshes++);app.setApi(async(path,params,body)=>{calls.push({path,body});return {ok:true,job:{...app.state.detail,status:'PAUSED'}};});
 const click=data=>app.click({target:{closest:()=>({dataset:data,disabled:false})}});return {app,click,calls,elements,events,refreshes:()=>refreshes};
}
const job=(key,status='RUNNING')=>({key,status,name:key,kind:key.split(':')[0],actions:['pause','stop'],accounts:[]});
test('late mutation response never overwrites the job opened meanwhile',async()=>{
 const h=harness();h.app.setState({key:'post:1',detail:job('post:1'),overview:{}});let finish;
 h.app.setApi(async(path,params,body)=>{h.calls.push(body);return new Promise(r=>finish=r);});
 const action=h.click({action:'pause'});h.app.openJob('post:2');h.app.setState({detail:job('post:2')});finish({job:job('post:1','PAUSED')});await action;
 assert.equal(h.app.state.key,'post:2');assert.equal(h.app.state.detail.key,'post:2');assert.equal(h.calls[0].key,'post:1');
});
test('late stop/delete confirmation is discarded after navigation',async()=>{
 for(const action of ['stop','delete']){
  const h=harness();h.app.setState({key:'gs:1',detail:job('gs:1'),overview:{}});let finish;h.app.setApi(()=>new Promise(r=>finish=r));
  const request=h.click({action});h.app.openJob('join:1');finish({...job('gs:1'),nonce:'old'});await request;
  assert.equal(h.elements.get('#sheet').open,false);assert.equal(h.app.confirmation,null);
 }
});
test('resume confirmation cannot follow user to a different job or changed status',async()=>{
 const h=harness();h.app.setState({key:'join:1',detail:job('join:1','PAUSED'),overview:{}});await h.click({action:'resume'});assert.equal(h.app.confirmation.key,'join:1');
 h.app.openJob('join:2');h.app.setState({detail:job('join:2','PAUSED')});await h.click({confirmResume:'1'});assert.equal(h.calls.length,0);
 h.app.setState({key:'join:1',detail:job('join:1','PAUSED')});await h.click({action:'resume'});h.app.setState({detail:job('join:1','STOPPED')});await h.click({confirmResume:'1'});assert.equal(h.calls.length,0);
});
test('double tap sends one mutation; disconnect closes confirmation and blocks action',async()=>{
 const h=harness();h.app.setState({key:'post:1',detail:job('post:1'),overview:{}});let finish;h.app.setApi((path,params,body)=>{h.calls.push(body);return new Promise(r=>finish=r);});
 const one=h.click({action:'pause'});await h.click({action:'pause'});assert.equal(h.calls.length,1);finish({job:job('post:1','PAUSED')});await one;
 await h.click({action:'resume'});h.events.offline();assert.equal(h.app.connected,false);assert.equal(h.app.confirmation,null);await h.click({confirmResume:'1'});assert.equal(h.calls.length,1);
});
