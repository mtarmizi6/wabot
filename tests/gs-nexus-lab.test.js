import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {sendGroupStatusProtocol,assertGsPilotTarget,GroupStatusUnsupportedError} from '../src/groupstatus/protocol.js';
import {gsAccountPrompt,gsContentPrompt} from '../src/telegram/controller.js';
function setup({kind='TEXT',ackError='',delayedError=false,badShape=false,missingBuilder=false}={}){
  const ws=new EventEmitter(),ev=new EventEmitter();
  const history=[];
  const lib={jidNormalizedUser:x=>x,...(!missingBuilder?{generateWAMessage:async(jid,content,opts)=>{
    history.push({method:'generate',jid,content,opts});
    return {key:{id:'LAB-1'},message:badShape?{}:(kind==='TEXT'?{extendedTextMessage:{text:content.text}}:{imageMessage:{caption:content.caption}})};
  }}:{})};
  const socket={ws,ev,user:{id:'123@s.whatsapp.net'},waUploadToServer:async()=>{},sendMessage:()=>{throw new Error('MUST NOT send normal group chat')},
    async relayMessage(jid,msg,opts){history.push({method:'relay',jid,msg,opts});
      queueMicrotask(()=>{
        ws.emit('CB:ack,class:message',{attrs:{id:'LAB-1',error:delayedError?'':ackError}});
        if(delayedError)setTimeout(()=>ev.emit('messages.update',[{key:{id:'LAB-1'},update:{status:0,messageStubParameters:['479']}}]),15);
      });
    }};
  return {lib,socket,history};
}
test('lab sends TEXT using generated message and exclusive is_group_status relay meta',async()=>{
  const {lib,socket,history}=setup();
  const result=await sendGroupStatusProtocol(lib,socket,'123@g.us',{kind:'TEXT',body:'Ujian GS',pilotMode:'nexus_meta',ackWaitMs:100});
  assert.deepEqual(history.map(x=>x.method),['generate','relay']);
  assert.equal(history[0].content.text,'Ujian GS');
  assert.equal(history[0].opts.userJid,'123@s.whatsapp.net');
  assert.equal(history[1].msg.extendedTextMessage.text,'Ujian GS');
  assert.deepEqual(history[1].opts.additionalNodes[0].attrs,{is_group_status:'true'});
  assert.equal(result.method,'NEXUS_META');
  assert.equal(result.serverAck,'OK');
});
test('lab supports PHOTO and its caption without CTA buttons',async()=>{
  const {lib,socket,history}=setup({kind:'PHOTO'});
  await sendGroupStatusProtocol(lib,socket,'123@g.us',{kind:'PHOTO',body:'Kapsyen',buffer:Buffer.from('photo'),pilotMode:'nexus_meta',ackWaitMs:100});
  assert.ok(Buffer.isBuffer(history[0].content.image));
  assert.equal(history[0].content.caption,'Kapsyen');
  assert.equal(history[1].msg.imageMessage.caption,'Kapsyen');
  assert.equal(history[1].opts.additionalNodes[0].attrs.is_group_status,'true');
});
test('lab surfaces rejected ACK 479, rather than claiming success',async()=>{
  const {lib,socket}=setup({ackError:'479'});
  await assert.rejects(sendGroupStatusProtocol(lib,socket,'123@g.us',{kind:'TEXT',body:'test',pilotMode:'nexus_meta',ackWaitMs:100}),e=>e.code==='GS_SERVER_REJECTED'&&e.serverAck==='479');
});
test('lab continues listening after a clean raw ack for a late messages.update 479',async()=>{
  const {lib,socket}=setup({delayedError:true});
  await assert.rejects(sendGroupStatusProtocol(lib,socket,'123@g.us',{kind:'TEXT',body:'test',pilotMode:'nexus_meta',ackWaitMs:150}),e=>e.code==='GS_SERVER_REJECTED'&&e.ackSource==='MESSAGES_UPDATE');
});
test('lab refuses invalid generated shape or missing builder without calling relay',async()=>{
  for(const opts of [{badShape:true},{missingBuilder:true}]){
    const {lib,socket,history}=setup(opts);
    await assert.rejects(sendGroupStatusProtocol(lib,socket,'123@g.us',{kind:'TEXT',body:'test',pilotMode:'nexus_meta',ackWaitMs:100}),GroupStatusUnsupportedError);
    assert.equal(history.some(x=>x.method==='relay'),false);
  }
});
test('lab rejects non-group JID and guards 1 target even for PHOTO',async()=>{
  const {lib,socket}=setup();
  await assert.rejects(sendGroupStatusProtocol(lib,socket,'123@s.whatsapp.net',{kind:'TEXT',body:'test',pilotMode:'nexus_meta'}),/Alamat group/);
  assert.throws(()=>assertGsPilotTarget({kind:'TEXT',total:2},'nexus_meta'),/SATU group/);
  assert.throws(()=>assertGsPilotTarget({kind:'VIDEO',total:1},'nexus_meta'),/SATU group/);
  assert.doesNotThrow(()=>assertGsPilotTarget({kind:'PHOTO',total:1},'nexus_meta'));
});
test('classic UI selects account before collecting content',()=>{
  const msg=gsAccountPrompt({id:9},[{id:4,label:'Akaun 4',status:'ONLINE',groupCount:100}]);
  assert.ok(msg.includes('LANGKAH 1/4'));assert.ok(msg.includes('1,2'));assert.ok(msg.includes('all'));
  assert.ok(msg.includes('LANGKAH 1/4'));
  assert.ok(gsContentPrompt({id:9}).includes('Tiada CTA'));
});
