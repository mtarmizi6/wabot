// A narrow, read-only explanation for a *failed* Group Status attempt.
// WhatsApp does not document that admin-only CHAT automatically forbids Group Status.
// Therefore, do not pre-skip any such group or report that implication as fact.
function canonical(jid) {
  const text=String(jid||'').trim().toLowerCase();
  return text.replace(/:\d+(?=@)/u,'');
}
function idsOf(value) {
  if(!value||typeof value!=='object')return [];
  return [value.id,value.jid,value.lid,value.phoneNumber,value.phoneNumberJid]
    .filter(x=>typeof x==='string'&&x.includes('@'))
    .map(canonical);
}
function errorText(error){return String(error?.message||error||'');}
export function assessGsMetadata(meta, sender={}, metaError=null){
  if(metaError){
    const message=errorText(metaError);
    if(/not a participant|not.participant|not in (?:this |the )?group|not a member|removed from (?:the )?group|left (?:the )?group/iu.test(message))
      return {kind:'NO_ACCESS',note:'Live metadata: server reported that this account is not a group member.'};
    const code=String(metaError?.output?.statusCode||metaError?.statusCode||metaError?.code||'');
    if(code==='404'||/group (?:does not exist|not found)|group not found/iu.test(message))
      return {kind:'GROUP_MISSING',note:'Live metadata: group not found or no longer accessible.'};
    return {kind:'UNVERIFIED',note:'Live group metadata unavailable; group permissions not established.'};
  }
  if(!meta||typeof meta!=='object')return {kind:'UNVERIFIED',note:'WhatsApp did not return usable group metadata.'};
  if(!Array.isArray(meta.participants)||!meta.participants.length)
    return {kind:'UNVERIFIED',note:'Live group membership list missing or empty.'};
  const self=new Set(idsOf(sender));
  const own=meta.participants.find(p=>idsOf(p).some(j=>self.has(j)));
  if(!own){
    // LID migrations and partial lists make an absent ID inconclusive.
    return {kind:'UNVERIFIED',note:'Could not match this account in group membership; PN/LID mismatch or lost access is possible.'};
  }
  const isAdmin=Boolean(own.admin||own.isAdmin||own.superadmin);
  if(meta.announce===true&&!isAdmin){
    return {kind:'ADMIN_ONLY_CHAT',note:'Live metadata: chat allows admins only and this account is not an admin. Group Status permission itself is not confirmed.'};
  }
  return {kind:'MEMBER_CONFIRMED',note:meta.announce===true
    ?'Live metadata: account is a group admin, chat is admin-only; Group Status rejection has another or unknown cause.'
    :'Live metadata: account is a member; Group Status rejection is not explained by admin-only chat.'};
}
// Only after a server rejection: do not suppress a Status based solely on chat permissions.
export function classifyGsGroupRejection(diagnostic,ackCode=479){
  if(['NO_ACCESS','GROUP_MISSING'].includes(diagnostic?.kind))
    return {outcome:'SKIPPED',fault:'',diagnostic:diagnostic.kind};
  return {outcome:'FAILED',fault:`REJECTED:${ackCode}`,diagnostic:diagnostic?.kind||'UNVERIFIED'};
}
