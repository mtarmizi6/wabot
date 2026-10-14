// Input navigation is scoped to the currently open posting screen.
export function isPostingInput(input) {
 return /^(posting_|button_)/.test(input?.type||'');
}
export function postingBackRoute(input,screen='posting_new') {
 const type=input?.type;
 const steps={posting_setting_delay_max:'delay',posting_setting_batch:'delay_max',posting_setting_rest:'batch',posting_setting_rest_max:'rest',posting_setting_confirm:'rest_max'};
 if(steps[type])return {action:'posting_setting_back',step:steps[type],input:{...input,type:'posting_setting_'+steps[type]}};
 if(type==='posting_client_choose'||type==='posting_client_new')return {action:'posting_client',args:[]};
 if(type==='posting_charge')return {action:'posting_target_mode',args:[]};
 if(type==='posting_name')return {action:'posting_new',args:[]};
 if(type?.startsWith('button_'))return {action:'button_manage',args:[String(input.adNo)]};
 if(type==='posting_ad_edit')return {action:'ad_detail',args:[String(input.adNo)]};
 if(type==='posting_ad_content')return {action:'ad_manage',args:[]};
 if(type?.startsWith('posting_target'))return {action:'posting_target_mode',args:[]};
 if(type?.startsWith('posting_setting'))return {action:'posting_setting',args:[]};
 const previous={posting_account_select:'ad_manage',posting_account_choose:'posting_account_select',posting_target_mode:'posting_account_select',posting_target_continuous:'posting_target_mode',posting_reuse_repeat:'posting_target_mode',posting_reuse_unique:'posting_target_mode',posting_setting:'posting_target_mode',posting_review:'posting_setting',ad_detail:'ad_manage',ad_preview:'ad_detail',ad_manage:'posting_new',ad_done:'ad_manage'};
 return {action:previous[screen]||'posting_new',args:[]};
}
export function draftNextAction(posting,summary) {
 if(!posting)return 'posting_new';
 if(!summary?.ads?.length)return 'ad_add';
 if(posting.status!=='READY')return 'ad_manage';
 if(!summary.plan?.accounts?.length||summary.plan.accountsNeedReview)return 'posting_account_select';
 if(summary.plan.status!=='READY')return 'posting_target_mode';
 if(posting.ownerType==='CLIENT'&&posting.clientFlowVersion>=186&&!posting.chargeCents)return 'posting_charge';
 return 'posting_review';
}
