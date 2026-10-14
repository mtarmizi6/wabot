import { randomBytes } from 'node:crypto';
// Experimental Group Status envelope for *existing* Baileys socket.
// Never fall back to ordinary chat messages when this protocol is unsupported.
export class GroupStatusUnsupportedError extends Error {
  constructor(message) { super(message); this.name = 'GroupStatusUnsupportedError'; this.code='GS_UNSUPPORTED'; }
}
export function classifyGsError(error) {
  if(error?.code==='GROUP_ACCESS_UNAVAILABLE')return 'SKIPPED';
  const message=String(error?.message || error || 'Unknown send error');
  if(error?.code==='GS_SERVER_REJECTED')return 'FAILED';
  if(error?.code==='GS_UNSUPPORTED'||/unsupported group status|groupstatusmessagev2.*(?:unknown|unsupported|invalid)/i.test(message))return 'UNSUPPORTED';
  if(/\b(?:not a participant|not.participant|admin.only|not permitted|not.allowed|forbidden|no permission|401|403)\b/i.test(message))return 'FAILED';
  // A timeout, disconnect, or rejection after relay begins has uncertain delivery.
  return 'UNKNOWN';
}
// Pilot observer. A missing ACK means UNKNOWN; even a clean ACK is not proof
// that the WhatsApp client published the Group Status.
export function watchServerAck(socket,messageId,waitMs=12000) {
  const ws=socket?.ws;
  const ev=socket?.ev;
  // Some isolated test sockets / older engines expose neither event source.
  if(typeof ws?.on!=='function' && typeof ev?.on!=='function')return null;
  const cleanups=[];
  let done=false,resolveWait,timer,cleanAck=null;
  const promise=new Promise(resolve=>{resolveWait=resolve;});
  function end(info){
    if(done)return;
    done=true;clearTimeout(timer);
    for(const cleanup of cleanups)cleanup();
    resolveWait(info);
  }
  const off=(object,event,handler)=>{
    if(typeof object?.off==='function')object.off(event,handler);
    else if(typeof object?.removeListener==='function')object.removeListener(event,handler);
  };
  // websocket ACK can signal error after relayMessage has already resolved.
  if(typeof ws?.on==='function'){
    function ack(node){
      if(String(node?.attrs?.id||'')!==String(messageId))return;
      const err=String(node?.attrs?.error||'').trim();
      if(err)end({observed:true,error:err,source:'RAW_ACK'});
      // A clean transport ACK may precede an asynchronous messages.update error.
      // Keep observing until the wait window closes so late 479 is not lost.
      else cleanAck={observed:true,error:'',source:'RAW_ACK'};
    }
    ws.on('CB:ack,class:message',ack);
    cleanups.push(()=>off(ws,'CB:ack,class:message',ack));
  }
  // A second route, only for explicit error updates; no success assumptions.
  if(typeof ev?.on==='function'){
    function updated(updates){
      for(const item of Array.isArray(updates)?updates:[]){
        if(String(item?.key?.id||'')!==String(messageId))continue;
        if(Number(item?.update?.status)!==0 && !item?.update?.messageStubParameters?.length)continue;
        const err=String(item?.update?.messageStubParameters?.[0]||'ERROR');
        end({observed:true,error:err,source:'MESSAGES_UPDATE'});
        return;
      }
    }
    ev.on('messages.update',updated);
    cleanups.push(()=>off(ev,'messages.update',updated));
  }
  timer=setTimeout(()=>end(cleanAck||{observed:false,error:'',source:'NONE'}),Math.max(100,Math.min(30000,Number(waitMs)||12000)));
  return {promise,stop:()=>end({observed:false,error:'',source:'CANCELLED'})};
}

// This guard is intentionally opt-in. No multi-group publishing while investigating 479.
export function assertGsPilotTarget({kind,total},mode=process.env.WAPROMOBOT_GS_PILOT) {
  if(!['minimal_v2','nexus_meta'].includes(mode))return;
  if(Number(total)!==1 || (mode==='minimal_v2'?kind!=='TEXT':!['TEXT','PHOTO'].includes(kind)))
    throw new Error('GS PILOT: hanya TEKS atau GAMBAR dan tepat SATU group ujian dibenarkan. Pilih satu group yang anda uruskan menggunakan .gs-target ID:N.');
}

export async function sendGroupStatusProtocol(lib,socket,jid,{kind,body='',buffer=null,mime='',ackWaitMs=12000,pilotMode=process.env.WAPROMOBOT_GS_PILOT}={}) {
  if(!jid?.endsWith('@g.us'))throw new Error('Alamat group tidak sah.');
  if(!socket?.user?.id||typeof socket.relayMessage!=='function')throw new Error('Sambungan WhatsApp tidak aktif.');
  const {proto, generateWAMessageFromContent, generateWAMessageContent, prepareWAMessageMedia, jidNormalizedUser}=lib;
  const nexusPilot=pilotMode==='nexus_meta';
  const minimalPilot=pilotMode==='minimal_v2';
  if(typeof jidNormalizedUser!=='function')
    throw new GroupStatusUnsupportedError('Baileys tidak mempunyai jidNormalizedUser.');
  if(!nexusPilot){
    if(!proto?.Message || typeof generateWAMessageFromContent!=='function')
      throw new GroupStatusUnsupportedError('Versi Baileys tidak mempunyai fungsi protokol yang diperlukan.');
    let supportsV2=false;
    try {
      const probe={groupStatusMessageV2:{message:{extendedTextMessage:{text:'probe'}}}};
      const decoded=proto.Message.decode(proto.Message.encode(proto.Message.fromObject(probe)).finish());
      supportsV2=!!decoded?.groupStatusMessageV2?.message?.extendedTextMessage?.text;
    } catch {}
    if(!supportsV2)throw new GroupStatusUnsupportedError('Baileys ini belum menyokong groupStatusMessageV2. Tiada mesej biasa dihantar.');
  }
  const sender=jidNormalizedUser(socket.user.id);
  if(nexusPilot){
    // Separate, opt-in implementation based on NexusTechPro's documented
    // generateWAMessage + relay meta approach. Distinct from the failed
    // handcrafted groupStatusMessageV2 variants; no fallback to normal chat.
    if(!['TEXT','PHOTO'].includes(kind))
      throw new GroupStatusUnsupportedError('GS LAB hanya menerima TEKS atau GAMBAR.');
    if(typeof lib.generateWAMessage!=='function')
      throw new GroupStatusUnsupportedError('Baileys tidak menyediakan generateWAMessage; tiada mesej dihantar.');
    if(kind==='TEXT'&&!String(body).trim())throw new Error('Teks Status kosong.');
    if(kind==='PHOTO'&&(!Buffer.isBuffer(buffer)||!buffer.length))throw new Error('Gambar Status kosong.');
    if(kind==='PHOTO'&&typeof socket.waUploadToServer!=='function')
      throw new GroupStatusUnsupportedError('Media upload tidak disokong; tiada mesej dihantar.');
    const content=kind==='TEXT'
      ? {text:body}
      : {image:buffer,caption:body,mimetype:mime||'image/jpeg'};
    let generated;
    try{
      generated=await lib.generateWAMessage(jid,content,{
        logger:socket.logger,
        userJid:sender,
        upload:socket.waUploadToServer,
        // Match documented background parameters for text Status.
        ...(kind==='TEXT'?{font:1,textColor:'#ffffff',backgroundColor:'#23313a'}:{})
      });
    }catch(error){throw new GroupStatusUnsupportedError(`GS LAB tidak dapat menjana mesej: ${String(error?.message||error)}`);}
    const messageType=kind==='TEXT'
      ? (generated?.message?.extendedTextMessage?'extendedTextMessage':generated?.message?.conversation?'conversation':null)
      : (generated?.message?.imageMessage?'imageMessage':null);
    if(!generated?.key?.id || !messageType || generated?.message?.groupStatusMessageV2)
      throw new GroupStatusUnsupportedError('GS LAB: bentuk mesej tidak sepadan; tiada mesej dihantar.');
    const ack=watchServerAck(socket,generated.key.id,ackWaitMs);
    let observed={observed:false,error:'',source:'NONE'};
    try {
      // Critical: do not invoke sock.sendMessage or fall back to normal chat;
      // relay with is_group_status meta in a single operation.
      await socket.relayMessage(jid,generated.message,{
        messageId:generated.key.id,
        additionalNodes:[{tag:'meta',attrs:{is_group_status:'true'},content:undefined}]
      });
      if(ack)observed=await ack.promise;
    }finally{ack?.stop();}
    if(observed.error){
      const error=new Error(`WhatsApp SERVER ACK ${observed.error}: Group Status ditolak (NEXUS LAB).`);
      error.code='GS_SERVER_REJECTED';error.serverAck=observed.error;error.ackSource=observed.source;
      throw error;
    }
    // This ACK is transport-level only, not client-side publication proof.
    return {messageId:generated.key.id,transport:'RELAY_ACCEPTED',serverAck:observed.observed?'OK':'NOT_OBSERVED',ackSource:observed.source,method:'NEXUS_META'};
  }
  if(minimalPilot && kind!=='TEXT')
    throw new GroupStatusUnsupportedError('GS PILOT minimal_v2 hanya menerima TEKS; gambar akan diuji selepas teks berjaya.');
  const contextInfo={
    isGroupStatus:true,
    forwardingScore:0,
    pairedMediaType:0,
    statusSourceType:4,
    featureEligibilities:{canBeReshared:true,canReceiveMultiReact:true},
    statusAttributions:[{type:6,groupStatus:{authorJid:sender}}]
  };
  let inner;
  if(kind==='TEXT') {
    if(!body.trim()) throw new Error('Teks Status kosong.');
    inner={extendedTextMessage:{text:body,font:1,backgroundArgb:0xff23313a,contextInfo}};
  } else if(kind==='PHOTO'||kind==='VIDEO') {
    if(!Buffer.isBuffer(buffer)||!buffer.length) throw new Error('Media Status kosong.');
    if(typeof prepareWAMessageMedia!=='function'||typeof socket.waUploadToServer!=='function')
      throw new GroupStatusUnsupportedError('Media upload WhatsApp tidak disokong.');
    const content=kind==='PHOTO'?{image:buffer,mimetype:mime||'image/jpeg',caption:body}:{video:buffer,mimetype:mime||'video/mp4',caption:body};
    // Construct status media through the standard Baileys content builder, when available.
    // Some WA clients reject handcrafted media envelopes even when relay accepts them.
    const prepared=typeof generateWAMessageContent==='function'
      ?await generateWAMessageContent(content,{upload:socket.waUploadToServer})
      :await prepareWAMessageMedia(content,{upload:socket.waUploadToServer});
    const type=kind==='PHOTO'?'imageMessage':'videoMessage';
    if(!prepared?.[type])throw new GroupStatusUnsupportedError(`Baileys gagal menyediakan ${kind} untuk Group Status.`);
    inner={[type]:{...prepared[type],contextInfo}};
  } else throw new Error('Jenis Status tidak disokong.');
  // Preserve messageSecret through outer and inner context for V2 media/text envelope.
  const messageSecret=randomBytes(32);
  inner.messageContextInfo={messageSecret};
  let envelope={messageContextInfo:{messageSecret},groupStatusMessageV2:{message:inner}};
  if(minimalPilot) {
    // Keep protobuf V2 so the server cannot silently route this as a regular chat.
    // Difference from the existing experiment is restricted to the status
    // metadata and outer envelope, allowing a meaningful single-group test.
    envelope={groupStatusMessageV2:{message:{extendedTextMessage:{
      text:body,font:1,backgroundArgb:0xff23313a,
      contextInfo:{
        forwardingScore:0,
        pairedMediaType:0,
        featureEligibilities:{canBeReshared:true,canReceiveMultiReact:true},
        isGroupStatus:true,
        statusAttributions:[{type:6,groupStatus:{authorJid:sender}}]
      }
    }}}};
  }
  // Verify the *actual encoded* status envelope retains the intended content.
  try {
    const decoded=proto.Message.decode(proto.Message.encode(proto.Message.fromObject(envelope)).finish());
    const innerDecoded=decoded?.groupStatusMessageV2?.message?.[kind==='TEXT'?'extendedTextMessage':kind==='PHOTO'?'imageMessage':'videoMessage'];
    if (!innerDecoded || innerDecoded.contextInfo?.isGroupStatus!==true)
      throw new Error('Group Status wrapper or isGroupStatus flag lost during serialization.');
  } catch(error) {throw new GroupStatusUnsupportedError(`Proto Group Status tidak sepadan: ${error.message}`);}
  const generated=generateWAMessageFromContent(jid,envelope,{userJid:sender});
  if(!generated?.message?.groupStatusMessageV2||!generated?.key?.id)
    throw new GroupStatusUnsupportedError('Baileys tidak menjana Group Status V2 yang sah.');
  // Never retry automatically after this call begins: a thrown timeout may already be delivered.
  // Listen *before* relay: server errors may arrive before relayMessage resolves.
  const ack=watchServerAck(socket,generated.key.id,ackWaitMs);
  let observed={observed:false,error:'',source:'NONE'};
  try {
    const relayOptions=minimalPilot
      ? {messageId:generated.key.id}
      : {messageId:generated.key.id,
          additionalNodes:[{tag:'meta',attrs:{is_group_status:'true'}}],
          ...(kind==='PHOTO'||kind==='VIDEO' ? {additionalAttributes:{mediatype:kind==='PHOTO'?'image':'video'}} : {})};
    await socket.relayMessage(jid,generated.message,relayOptions);
    if(ack)observed=await ack.promise;
  } finally {ack?.stop();}
  if(observed.error){
    const error=new Error(`WhatsApp SERVER ACK ${observed.error}: penghantaran Group Status ditolak.`);
    error.code='GS_SERVER_REJECTED';error.serverAck=observed.error;error.ackSource=observed.source;error.ackSource=observed.source;
    throw error;
  }
  // OK/no-error ACK still is NOT proof of client-side display.
  return {messageId:generated.key.id,transport:'RELAY_ACCEPTED',serverAck:observed.observed?'OK':'NOT_OBSERVED',ackSource:observed.source};
}
