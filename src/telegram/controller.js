import { accountNumber, accountName } from './accounts-ui.js';
const HOME = 'home';

const CALLBACK_ACTIONS = new Set([
  HOME,
  'wa', 'wa_login', 'wa_refresh',
  'join', 'join_start', 'join_status', 'join_report',
  'group', 'group_all', 'group_sync', 'gs_menu', 'gs_new', 'gs_content', 'gs_preview',
  'posting_new', 'posting_self', 'posting_client',
  'posting_active', 'posting_refresh',
  'records', 'records_refresh',
  'report', 'report_refresh',
  'system', 'system_status', 'system_check', 'storage', 'version',
  'help_client', 'help_group_status', 'help_records', 'help_problem', 'help', 'help_whatsapp', 'help_join', 'help_group', 'help_posting', 'help_manage', 'help_report', 'help_system'
]);

// Legacy keyboards are retained only so older Telegram messages remain routable.
// Build 113 does not send inline navigation buttons for normal menu use.
export function controllerKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📱 WhatsApp', callback_data: 'wa' }, { text: '🔗 Auto Join', callback_data: 'join' }],
      [{ text: '👥 Group', callback_data: 'group' }, { text: '🚀 Mula Posting', callback_data: 'posting_new' }],
      [{ text: '📊 Posting Aktif', callback_data: 'posting_active' }, { text: '📁 Rekod', callback_data: 'records' }],
      [{ text: '📄 Report', callback_data: 'report' }, { text: '⚙️ System', callback_data: 'system' }],
      [{ text: '🆘 Bantuan', callback_data: 'help' }]
    ]
  };
}

export function homeKeyboard() {
  return { inline_keyboard: [[{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function backHomeKeyboard(backAction = HOME) {
  const row = [];
  if (backAction !== HOME) row.push({ text: '⬅️ Kembali', callback_data: backAction });
  row.push({ text: '🏠 Menu Utama', callback_data: HOME });
  return { inline_keyboard: [row] };
}

export function whatsappKeyboard() {
  return { inline_keyboard: [[{ text: '➕ Login Akaun', callback_data: 'wa_login' }, { text: '🔄 Refresh', callback_data: 'wa_refresh' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function joinKeyboard() {
  return { inline_keyboard: [[{ text: '▶️ Auto Join Baru', callback_data: 'join_start' }], [{ text: '📊 Status', callback_data: 'join_status' }, { text: '📄 Report', callback_data: 'join_report' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function groupKeyboard() {
  return { inline_keyboard: [[{ text: '👥 Semua Group', callback_data: 'group_all' }, { text: '🔄 Sync Semua', callback_data: 'group_sync' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function postingNewKeyboard() {
  return { inline_keyboard: [[{ text: '📢 SENDIRI', callback_data: 'posting_self' }, { text: '💼 CLIENT', callback_data: 'posting_client' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function postingActiveKeyboard() {
  return { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'posting_refresh' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function recordsKeyboard() {
  return { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'records_refresh' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function reportKeyboard() {
  return { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'report_refresh' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function systemKeyboard() {
  return { inline_keyboard: [[{ text: '📊 Status', callback_data: 'system_status' }, { text: '🩺 System Check', callback_data: 'system_check' }], [{ text: '💾 Storage', callback_data: 'storage' }, { text: 'ℹ️ Version', callback_data: 'version' }], [{ text: '📱 WhatsApp', callback_data: 'wa' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

export function helpKeyboard() {
  return { inline_keyboard: [[{ text: '📱 Sambung WhatsApp', callback_data: 'help_whatsapp' }], [{ text: '🔗 Auto Join Group', callback_data: 'help_join' }, { text: '👥 Sync Group', callback_data: 'help_group' }], [{ text: '🚀 Mula Posting', callback_data: 'help_posting' }], [{ text: '📊 Urus Posting', callback_data: 'help_manage' }], [{ text: '📄 Report & Rekod', callback_data: 'help_report' }], [{ text: '⚙️ System & Storage', callback_data: 'help_system' }], [{ text: '🏠 Menu Utama', callback_data: HOME }]] };
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const EMPHASIS_ICONS = '📨📋📱🔗👥🚀📇📊📁📄⚙️🆘🩺💾ℹ️➕🔄⬅️➡️▶️📢💼📝🖼🎥📥👁✏️🔘🔗🗑🏠⏸⏹🕘⛔❌✅⚠️🟢🔴🟡🤖🏓';

export function formatTelegramMessage(text = '') {
  let firstContentSeen = false;
  return String(text).split('\n').map(line => {
    if (line === '') return '';

    // Main-menu rows keep only the command selectable as monospace.
    const menuCommand = line.match(/^(.*?)↳\s+(\.[a-z-]+(?:\s+[^→]+?)?)\s+→\s+(.+)$/u);
    if (menuCommand) return `${escapeHtml(menuCommand[1])}↳ <code>${escapeHtml(menuCommand[2])}</code> → ${escapeHtml(menuCommand[3])}`;
    const reply = line.match(/^(.*?↳ Balas )(1|2|YA|SAH)(.*)$/u);
    if (reply) return `${escapeHtml(reply[1])}<code>${reply[2]}</code>${escapeHtml(reply[3])}`;
    if (line.startsWith('🔑 Kod: ')) return '🔑 Kod: <code>' + escapeHtml(line.slice(8)) + '</code>';
    const sectionTitle = line.match(/^\| ([A-Z0-9 -]+) \|$/u);
    if (sectionTitle) return `| <b>${escapeHtml(sectionTitle[1])}</b> |`;
    if (line === '📌 Menu utama: .menu') return '📌 Menu utama: <code>.menu</code>';

    // Compact classic command style: ↳ .accounts · Login & urus akaun
    const compactCommand = line.match(/^(\s*)↳\s+(.+?)\s+·\s+(.+)$/u);
    if (compactCommand && /^[./]/u.test(compactCommand[2])) {
      return `${escapeHtml(compactCommand[1])}↳ <code>${escapeHtml(compactCommand[2])}</code> · ${escapeHtml(compactCommand[3])}`;
    }

    // Backward-compatible classic arrow command style.
    const command = line.match(/^(\s*)→\s+(.+)$/u);
    if (command) {
      return `${escapeHtml(command[1])}→ <code>${escapeHtml(command[2])}</code>`;
    }

    if (line.startsWith('↳ ')) {
      return `↳ ${escapeHtml(line.slice(2))}`;
    }

    const safe = escapeHtml(line);
    if (!firstContentSeen) {
      firstContentSeen = true;
      return `<b>${safe}</b>`;
    }

    // Dashboard counters: bold the changing value for fast scanning.
    const dashboard = line.match(/^([📱👥🚀📇📁📄]\s*[^:]+\s*:\s*)(.+)$/u);
    if (dashboard) return `${escapeHtml(dashboard[1])}<b>${escapeHtml(dashboard[2])}</b>`;

    const trimmed = line.trimStart();
    const numbered = /^\d{2}\.\s+/u.test(trimmed);
    const iconLead = EMPHASIS_ICONS.includes(trimmed[0] || '') && !trimmed.includes(':');
    const upperAction = /^(?:LOGIN AKAUN|REFRESH|KEMBALI|SEMUA AKAUN|SYNC SEMUA|AUTO JOIN BARU|STATUS|REPORT|SYSTEM CHECK|STORAGE|VERSION)$/u.test(trimmed);
    if (numbered || iconLead || upperAction) return `<b>${safe}</b>`;

    const label = line.match(/^(\s*)(Build|Stage|Telegram|WhatsApp|Database|Controller|Owner ID|Owner|Storage|Status|Version|Runtime|Platform|Akaun|Online|Group|Aktif|Rekod)(\s*):\s*(.*)$/u);
    if (label) {
      return `${escapeHtml(label[1])}<b>${escapeHtml(label[2])}</b>${escapeHtml(label[3])}: ${escapeHtml(label[4])}`;
    }

    return safe;
  }).join('\n');
}

function normalizeCommand(text = '') {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  parts[0] = parts[0].replace(/@[-_a-z0-9]+$/i, '');
  return parts.join(' ').toLowerCase();
}

function commandRoute(command) {
  if (/^[./]followup$/.test(command)) return {action:'fu_home',args:[]};
  const fu=command.match(/^[./]fu-(limit|new|draft|back|next|pace|review|open|list|accounts|select|numbers|add|ads|ad|edit|remove|cta|cta-clear|setting|preview|run|status|pause|resume|continue|stop|report|remaining|cancel)(?:\s+(.*))?$/);
  if(fu)return {action:'fu_'+fu[1].replaceAll('-','_'),args:fu[2]?[fu[2]]:[]};
  const joinReportPage=command.match(/^[./]join-report\s+(\d+)\s+(\d+)$/u);
  if(joinReportPage)return {action:'join_report',args:joinReportPage.slice(1)};
  const joinCommand=command.match(/^[./]join-(new|draft|draft-delete|accounts|add|invalid|next|run|list|pause|resume|stop|delete|status|report)(?:\s+(\d+))?$/u);
  if(joinCommand)return {action:'join_'+joinCommand[1].replaceAll('-','_'),args:joinCommand[2]?[joinCommand[2]]:[]};
  const aliases = new Map([
    ['/start', HOME], ['.start', HOME], ['/menu', HOME], ['.menu', HOME],
    ['/accounts', 'wa'], ['.accounts', 'wa'],
    ['.batal', 'wa_cancel'], ['/batal', 'wa_cancel'], ['.kembali', 'wa_back'], ['/kembali', 'wa_back'],
    ['/login', 'wa_login'], ['.login', 'wa_login'],
    ['/login pair', 'wa_login_pair'], ['.login pair', 'wa_login_pair'],
    ['/login qr', 'wa_login_qr'], ['.login qr', 'wa_login_qr'],
    ['/join', 'join'], ['.join', 'join'],
    ['/join-start', 'join_start'], ['.join-start', 'join_start'],
    ['/join-status', 'join_status'], ['.join-status', 'join_status'],
    ['/join-report', 'join_report'], ['.join-report', 'join_report'],
    ['/join-setting', 'join_setting'], ['.join-setting', 'join_setting'],
    ['/join-setting standard', 'join_setting_standard'], ['.join-setting standard', 'join_setting_standard'],
    ['/join-setting custom', 'join_setting_custom'], ['.join-setting custom', 'join_setting_custom'],
    ['/join-link', 'join_link'], ['.join-link', 'join_link'],
    ['/join-txt', 'join_txt'], ['.join-txt', 'join_txt'],
    ['/join-reset', 'join_reset'], ['.join-reset', 'join_reset'],
    ['/group', 'group'], ['.group', 'group'],
    ['/group all', 'group_all'], ['.group all', 'group_all'],
    ['/group-sync', 'group_sync'], ['.group-sync', 'group_sync'],
    ['/group-sync all', 'group_sync'], ['.group-sync all', 'group_sync'],
    ['.group-status','gs_menu'], ['/group-status','gs_menu'], ['.gs-draft','gs_draft'], ['.gs-list','gs_list'], ['.gs-new','gs_new'], ['.gs-all','gs_all'], ['.gs-content','gs_content'], ['.gs-preview','gs_preview'], ['.gs-accounts','gs_accounts_help'], ['.gs-target','gs_target_help'], ['.gs-status','gs_status'], ['.gs-report','gs_report'], ['.gs-setting','gs_setting_help'], ['.gs-settings','gs_setting_help'],
    ['/client','client_list'], ['.client','client_list'],
    ['/client-new','client_new'], ['.client-new','client_new'],
    ['/client-cancel','client_cancel'], ['.client-cancel','client_cancel'],
    ['/mula-client-manual','posting_client_manual'], ['.mula-client-manual','posting_client_manual'],
    ['/mula', 'posting_new'], ['.mula', 'posting_new'],
    ['/mula sendiri', 'posting_self'], ['.mula sendiri', 'posting_self'],
    ['/mula client', 'posting_client'], ['.mula client', 'posting_client'],
    ['.posting-charge','posting_charge'], ['.posting-review','posting_review'], ['.posting-sambung','posting_draft'], ['.posting-batal','posting_cancel'], ['.posting-next','posting_review'], ['.posting-setting','posting_setting_custom'], ['.mula-draft', 'posting_draft'], ['/mula-draft', 'posting_draft'], ['/mula-cancel', 'posting_cancel'], ['.mula-cancel', 'posting_cancel'],
    ['/iklan-tambah', 'ad_add'], ['.iklan-tambah', 'ad_add'],
    ['/iklan-siap', 'ad_done'], ['.iklan-siap', 'ad_done'],
    ['/iklan-urus', 'ad_manage'], ['.iklan-urus', 'ad_manage'],
    ['/iklan-back', 'ad_back'], ['.iklan-back', 'ad_back'],
    ['/button-add', 'button_add'], ['.button-add', 'button_add'],
    ['/button-skip', 'button_skip'], ['.button-skip', 'button_skip'],
    ['/button-cancel', 'button_cancel'], ['.button-cancel', 'button_cancel'],
    ['/button-done', 'button_done'], ['.button-done', 'button_done'],
    ['/button-edit', 'button_edit'], ['.button-edit', 'button_edit'],
    ['/button-delete', 'button_delete'], ['.button-delete', 'button_delete'],
    ['/pilih-akaun', 'posting_account_select'], ['.pilih-akaun', 'posting_account_select'],
    ['/target', 'posting_target_mode'], ['.target', 'posting_target_mode'],
    ['/target-success', 'posting_target_success'], ['.target-success', 'posting_target_success'],
    ['/target success', 'posting_target_success'], ['.target success', 'posting_target_success'],
    ['/target hari', 'posting_target_days'], ['.target hari', 'posting_target_days'],
    ['/target terus', 'posting_target_continuous'], ['.target terus', 'posting_target_continuous'],
    ['/reuse ulang', 'posting_reuse_repeat'], ['.reuse ulang', 'posting_reuse_repeat'],
    ['/reuse unique', 'posting_reuse_unique'], ['.reuse unique', 'posting_reuse_unique'],
    ['/setting-posting', 'posting_setting'], ['.setting-posting', 'posting_setting'],
    ['/setting-default', 'posting_setting_default'], ['.setting-default', 'posting_setting_default'],
    ['/setting-custom', 'posting_setting_custom'], ['.setting-custom', 'posting_setting_custom'],
    ['/campaigns', 'posting_active'], ['.campaigns', 'posting_active'],
    ['/posting-semak', 'posting_review'], ['.posting-semak', 'posting_review'],
    ['/posting-mula', 'posting_run'], ['.posting-mula', 'posting_run'],
    ['/status', 'posting_active'], ['.status', 'posting_active'],
    ['/rekod', 'records'], ['.rekod', 'records'],
    ['/report', 'report'], ['.report', 'report'],
    ['/system', 'system'],
    ['.system-default', 'system_default'],
    ['.system-cleanup', 'system_cleanup'],
    ['.system-cleanup-toggle', 'system_cleanup_toggle'],
    ['.system-retention', 'system_retention'],
    ['.system-old', 'system_old'],
    ['.system-repeat', 'system_repeat'],
    ['.system-report-retry', 'system_report_retry'], ['.system', 'system'],
    ['.panel','panel'],['.panel-setup','panel_setup'],['.panel-quick','panel_quick'],['.panel-off','panel_off'],
    ['/auto-read', 'auto_read'], ['.auto-read', 'auto_read'],
    ['/auto-read on', 'auto_read_on'], ['.auto-read on', 'auto_read_on'],
    ['/auto-read off', 'auto_read_off'], ['.auto-read off', 'auto_read_off'],
    ['/system-check', 'system_check'], ['.system-check', 'system_check'],
    ['/storage', 'storage'], ['.storage', 'storage'],
    ['/storage-clean', 'storage'], ['.storage-clean', 'storage'],
    ['/version', 'version'], ['.version', 'version'],
    ['/help', 'help'], ['.help', 'help'],
    ['/help problem', 'help_problem'], ['.help problem', 'help_problem'],
    ['/help records', 'help_records'], ['.help records', 'help_records'],
    ['/help group-status', 'help_group_status'], ['.help group-status', 'help_group_status'],
    ['/help client', 'help_client'], ['.help client', 'help_client'],
    ['/help whatsapp', 'help_whatsapp'], ['.help whatsapp', 'help_whatsapp'],
    ['/help join', 'help_join'], ['.help join', 'help_join'],
    ['/help group', 'help_group'], ['.help group', 'help_group'],
    ['/help posting', 'help_posting'], ['.help posting', 'help_posting'],
    ['/help manage', 'help_manage'], ['.help manage', 'help_manage'],
    ['/help report', 'help_report'], ['.help report', 'help_report'],
    ['/help system', 'help_system'], ['.help system', 'help_system'],
    ['/ping', 'ping'], ['.ping', 'ping']
  ]);
  const direct = aliases.get(command);
  if (direct) {
    if (command === '/group-sync all' || command === '.group-sync all') return { action: direct, args: ['all'] };
    return { action: direct, args: [] };
  }

  const patterns = [
    [/^[./]panel-url\s+(https:\/\/\S+)$/u,'panel_url'],
    [/^[./]client-list(?:\s+(\d+))?$/u,'client_list'],
    [/^[./]client\s+(\d+)$/u,'client_detail'],
    [/^[./]client-post\s+(\d+)$/u,'client_post'],
    [/^[./]client-edit\s+(\d+)$/u,'client_edit_menu'],
    [/^[./]client-campaigns\s+(\d+)(?:\s+(\d+))?$/u,'client_campaigns'],
    [/^[./]client-campaign\s+(\d+)(?:\s+(\d+))?$/u,'client_campaign'],
    [/^[./]client-report-page\s+(\d+)(?:\s+(\d+))?$/u,'client_report_page'],
    [/^[./]client-report\s+(\d+)(?:\s+(\d+))?$/u,'client_report'],
    [/^[./]client-(package|price|paid|contact|note)\s+(\d+)$/u,'client_edit'],
    [/^[./]accounts\s+(\d+)$/u, 'wa'],
    [/^[./]account\s+(\d+)$/u, 'wa_account'],
    [/^[./]account-reconnect\s+(\d+)$/u, 'wa_reconnect'],
    [/^[./]account-replace\s+(\d+)$/u, 'wa_replace'],
    [/^[./]account-login\s+(\d+)$/u, 'wa_replace'],
    [/^[./]account-logout\s+(\d+)(?:\s+(confirm))?$/u, 'wa_logout'],
    [/^[./]account-delete\s+(\d+)(?:\s+(confirm))?$/u, 'wa_delete'],
    [/^[./]account-group\s+(\d+)(?:\s+(\d+))?$/u, 'wa_account_group'],
    [/^[./]account-sync\s+(\d+)$/u, 'wa_account_sync'],
    [/^[./]pilih-akaun\s+(all|\d+(?:,\d+)*)$/u, 'posting_account_choose'],
    [/^[./]posting-view\s+(\d+)$/u, 'posting_native_status'],
    [/^[./]status\s+(\d+)$/u, 'posting_status'],
    [/^[./]report-page\s+(\d+)$/u, 'hub_reports_page'],
    [/^[./]kempen-live\s+(\d+)$/u, 'hub_live'],
    [/^[./]kempen-open\s+(\d+)(?:\s+(\d+))?$/u, 'hub_open'],
    [/^[./]kempen-pause\s+(\d+)(?:\s+(\d+))?$/u, 'hub_pause'],
    [/^[./]kempen-resume\s+(\d+)(?:\s+(\d+))?$/u, 'hub_resume'],
    [/^[./]kempen-stop\s+(\d+)(?:\s+(\d+))?$/u, 'hub_stop'],
    [/^[./]kempen-report\s+(\d+)(?:\s+(\d+))?$/u, 'hub_report'],
    [/^[./]kempen-posts\s+(\d+)(?:\s+(\d+))?$/u, 'hub_posts'],
    [/^[./]kempen-accounts\s+(\d+)(?:\s+(\d+))?$/u, 'hub_accounts'],
    [/^[./]kempen-delete\s+(\d+)(?:\s+(\d+))?$/u, 'hub_delete'],
    [/^[./]posting-pause(?:\s+(\d+))?$/u, 'posting_pause'],
    [/^[./]posting-resume(?:\s+(\d+))?$/u, 'posting_resume'],
    [/^[./]posting-stop(?:\s+(\d+))?$/u, 'posting_stop'],
    [/^[./]campaign-delete\s+(\d+)(?:\s+(confirm))?$/u, 'posting_delete'],
    [/^[./]report-delete\s+(all|\d+)(?:\s+(confirm))?$/u, 'report_delete'],
    [/^[./]storage-clean\s+(temp|logs|media|all)(?:\s+(confirm))?$/u, 'storage_clean'],
    [/^[./]join\s+(all|\d+(?:,\d+)*)$/u, 'join_select'],
    [/^[./]join-start\s+(\d+)$/u, 'join_run'],
    [/^[./]join-status(?:\s+(\d+))?$/u, 'join_status'],
    [/^[./]join-pause\s+(\d+)$/u, 'join_pause'],
    [/^[./]join-resume\s+(\d+)$/u, 'join_resume'],
    [/^[./]join-stop\s+(\d+)$/u, 'join_stop'],
    [/^[./]join-report-info\s+(\d+)(?:\s+(\d+))?$/u, 'join_report_info'],
    [/^[./]join-report\s+(\d+)$/u, 'join_report_page'],
    [/^[./]campaigns\s+(\d+)$/u, 'posting_active'],
    [/^[./]rekod\s+(\d+)$/u,'records'],
    [/^[./]report\s+(\d+)$/u,'report'],
    [/^[./]button-add\s+(\d+)$/u,'button_add'],
    [/^[./]button-done\s+(\d+)$/u,'button_done'],
    [/^[./]mula-client-page\s+(\d+)$/u,'posting_client'],
    [/^[./]system-posting(?:\s+(.+))?$/u,'posting_system_defaults'],
    [/^[./]posting-accounts\s+(\d+)(?:\s+(\d+))?$/u, 'posting_accounts'],
    [/^[./]pilih-akaun-page\s+(\d+)$/u, 'posting_account_select'],
    [/^[./]iklan-urus\s+(\d+)$/u, 'ad_manage'],
    [/^[./]iklan\s+(\d+)$/u, 'ad_detail'],
    [/^[./]iklan-preview\s+(\d+)$/u, 'ad_preview'],
    [/^[./]iklan-edit\s+(\d+)$/u, 'ad_edit'],
    [/^[./]iklan-delete\s+(\d+)$/u, 'ad_delete'],
    [/^[./]button-manage\s+(\d+)$/u, 'button_manage'],
    [/^[./]button-edit\s+(\d+)$/u, 'button_edit'],
    [/^[./]button-delete\s+(\d+)$/u, 'button_delete'],
    [/^[./]gs-accounts\s+(all|[0-9,]+)$/u,'gs_accounts'],
    [/^[./]gs-setting\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/u,'gs_setting_save'],
    [/^[./]gs-posts(?:\s+(\d+))?(?:\s+(\d+))?$/u,'gs_posts'],
    [/^[./]gs-account-retry\s+(\d+)$/u,'gs_retry_account'],
    [/^[./]gs-groups\s+(\d+)(?:\s+(\d+))?$/u,'gs_groups'],
    [/^[./]gs-target\s+(all|[0-9:,]+)$/u,'gs_target'],
    [/^[./]gs-run(?:\s+(\d+))?$/u,'gs_run'],
    [/^[./]gs-status\s+(\d+)$/u,'gs_status'],
    [/^[./]gs-pause(?:\s+(\d+))?$/u,'gs_pause'],
    [/^[./]gs-resume(?:\s+(\d+))?$/u,'gs_resume'],
    [/^[./]gs-stop(?:\s+(\d+))?$/u,'gs_stop'],
    [/^[./]gs-delete\s+(\d+)(?:\s+(confirm))?$/u,'gs_delete'],
    [/^[./]gs-report\s+(\d+)$/u,'gs_report'],
    [/^[./]gs-again\s+(\d+)$/u,'gs_again'],
    [/^[./]extract(?:\s+(\d+))?$/u,'extract_home'],
    [/^[./]extract-account\s+(\d+)$/u,'extract_account'],
    [/^[./]extract-page\s+(\d+)$/u,'extract_page'],
    [/^[./]extract-search(?:\s+(.+))?$/u,'extract_search'],
    [/^[./]extract-group\s+(\d+)$/u,'extract_group'],
    [/^[./]extract-run$/u,'extract_run'],
    [/^[./]extract-status$/u,'extract_status'],
    [/^[./]extract-txt$/u,'extract_txt'],
    [/^[./]extract-csv$/u,'extract_csv'],
    [/^[./]extract-cancel$/u,'extract_cancel'],
    [/^[./]group\s+(\d+)(?:\s+(\d+))?$/u, 'group_account'],
    [/^[./]group\s+all\s+(\d+)$/u, 'group_all'],
    [/^[./]group-menu\s+(\d+)$/u, 'group_menu'],
    [/^[./]group-info\s+(all|\d+)\s+(\d+)(?:\s+(\d+))?$/u, 'group_info'],
    [/^[./]group-search\s+(all|\d+)\s+(.+)$/u, 'group_search'],
    [/^[./]group-result\s+(\d+)(?:\s+(\d+))?$/u, 'group_result'],
    [/^[./]group-search-page\s+(\d+)$/u, 'group_search_page'],
    [/^[./]group-sync-status(?:\s+(all|\d+))?(?:\s+(\d+))?$/u, 'group_sync_status'],
    [/^[./]group-sync\s+(\d+)$/u, 'group_sync']
  ];
  for (const [pattern, action] of patterns) {
    const match = command.match(pattern);
    if (match) return { action, args: match.slice(1).filter(value => value !== undefined) };
  }
  return null;
}

export function routeTelegramUpdate(update, ownerUserId) {
  const ownerId = String(ownerUserId || '');
  if (update?.callback_query) {
    const query = update.callback_query;
    if (String(query.from?.id || '') !== ownerId) return { action: 'ignore', reason: 'unauthorized' };
    if (query.message?.chat?.type && query.message.chat.type !== 'private') return { action: 'ignore', reason: 'not-private' };
    const data = String(query.data || '');
    const gsCallback=data.match(/^(gs_(?:run|pause|resume|stop|status|report|delete|again)):(\d+)$/u);
    if(gsCallback)return {action:gsCallback[1],args:[gsCallback[2]],callbackQueryId:String(query.id||''),chatId:String(query.message?.chat?.id||ownerId)};
    return {
      action: CALLBACK_ACTIONS.has(data) ? data : HOME,
      args: [],
      callbackQueryId: String(query.id || ''),
      chatId: String(query.message?.chat?.id || ownerId)
    };
  }

  const message = update?.message;
  if (!message?.from?.id) return { action: 'ignore', reason: 'unsupported' };
  if (String(message.from.id) !== ownerId) return { action: 'ignore', reason: 'unauthorized' };
  if (message.chat?.type !== 'private') return { action: 'ignore', reason: 'not-private' };

  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = message.photo[message.photo.length - 1] || {};
    return {
      action: 'photo', mediaGroupId:message.media_group_id||null,
      args: [],
      media: {
        fileId: String(photo.file_id || ''),
        fileSize: Number(photo.file_size || 0),
        mimeType: 'image/jpeg'
      },
      text: String(message.caption || '').trim(),
      chatId: String(message.chat.id)
    };
  }

  if (message.video) {
    return {
      action: 'video', mediaGroupId:message.media_group_id||null,
      args: [],
      media: {
        fileId: String(message.video.file_id || ''),
        fileName: String(message.video.file_name || ''),
        fileSize: Number(message.video.file_size || 0),
        mimeType: String(message.video.mime_type || 'video/mp4')
      },
      text: String(message.caption || '').trim(),
      chatId: String(message.chat.id)
    };
  }

  if (message.document) {
    return {
      action: 'document',
      args: [],
      document: {
        fileId: String(message.document.file_id || ''),
        fileName: String(message.document.file_name || ''),
        mimeType: String(message.document.mime_type || ''),
        fileSize: Number(message.document.file_size || 0)
      },
      text: String(message.caption || '').trim(),
      chatId: String(message.chat.id)
    };
  }

  const rawText = String(message.text || '').trim();
  const command = normalizeCommand(rawText);
  const route = commandRoute(command);
  if (route) return { ...route, chatId: String(message.chat.id), text: rawText };
  return {
    action: rawText ? 'text' : 'ignore',
    args: [],
    text: rawText,
    chatId: String(message.chat.id)
  };
}

export function mainMenuText(botUsername = '', stats = {}) {
  const connected = Number(stats.connectedAccounts || 0);
  const totalAccounts = Number(stats.totalAccounts || 0);
  const groups = Number(stats.groups || 0);
  const active = Number(stats.activePostings || 0);
  const records = Number(stats.records || 0);
  const number = value => Number(value || 0).toLocaleString('en-US');
  const section = (title, icon, command, description) => [
    '-'.repeat(title.length + 4), `| ${title} |`, '-'.repeat(title.length + 4),
    `${icon} ↳ ${command} → ${description}`, ''
  ];
  return [
    '🤖 WA PROMO BOT',
    'Urus akaun, group, posting, follow-up & laporan WhatsApp.',
    '',
    '📊 Ringkasan',
    '-------------------------',
    `📱 WhatsApp Online : ${connected}/${totalAccounts}`,
    ...(stats.uniqueGroups!==undefined?[`👥 Group Unik : ${number(stats.uniqueGroups)}`]:[]),
    `🔗 Jumlah Akses Group : ${number(groups)}`,
    `🚀 Kempen Aktif : ${number(active)}`,
    `📁 Rekod Kempen : ${number(records)}`,
    '-------------------------',
    '',
    ...section('WHATSAPP', '📱', '.accounts', 'Login, sambung & urus akaun'),
    ...section('AUTO JOIN GROUP', '🔗', '.join', 'Sertai group melalui link / fail TXT'),
    ...section('PENGURUSAN GROUP', '👥', '.group', 'Lihat senarai & sync group setiap akaun'),
    ...section('EXTRACT AHLI', '📇', '.extract', 'Pilih group & eksport nombor ahli ke TXT / CSV'),
    ...section('AUTO FOLLOW-UP', '💬', '.followup', 'Hantar maklumat ke senarai nombor dengan delay & kuota akaun'),
    ...section('MULA POSTING', '🚀', '.mula', 'Cipta kempen sendiri / client'),
    ...section('PENGURUSAN CLIENT', '👤', '.client', 'Urus pelanggan, pakej, bayaran & kempen'),
    ...section('GROUP STATUS', '📢', '.group-status', 'Cipta & urus penghantaran Status group'),
    ...section('KEMPEN AKTIF', '⚡', '.status', 'Pantau progress, pause, resume / stop'),
    ...section('REKOD KEMPEN', '🗂️', '.rekod', 'Semak & urus kempen terdahulu'),
    ...section('LAPORAN KEMPEN', '📊', '.report', 'Semak hasil penghantaran setiap kempen'),
    ...section('MINI APP', '📱', '.panel', 'Live progress & kawalan job'),
    ...section('TETAPAN SISTEM', '⚙️', '.system', 'Tetapan, sambungan & storage'),
    ...section('BANTUAN', '❓', '.help', 'Panduan penggunaan langkah demi langkah'),
    '📌 Menu utama: .menu',
    botUsername ? `🟢 Controller: @${String(botUsername).replace(/^@/, '')}` : '🟢 Controller: ONLINE',
    '© By TnAzam'
  ].join('\n');
}

export { whatsappMessage, whatsappLoginMessage, whatsappPairPromptMessage,
  whatsappReplacePromptMessage, whatsappPairCodeMessage, whatsappQrMessage,
  whatsappConnectedMessage, whatsappAccountMessage, whatsappConfirmMessage } from './accounts-ui.js';

export function joinMessage(jobs = [], settings = null) {
  const active = jobs.find(job => ['RUNNING','PAUSED'].includes(job.status));
  const rows = [
    '🔗 Auto Join Group',
    'Join group baru melalui fail TXT atau senarai link.',
    '',
    active ? `Status : ${active.status === 'RUNNING' ? '🟢 SEDANG JALAN' : '🟡 PAUSED'} · Job #${active.id}` : 'Status : ⚪ TIADA JOB AKTIF',
    '',
    '▶️ Auto Join Baru',
    '↳ .join-start · Pilih akaun & masukkan senarai link',
    '',
    '📊 Status',
    '↳ .join-status · Semak progress Auto Join',
    '',
    '📄 Report',
    '↳ .join-report · Lihat rekod Auto Join',
    '',
    '⚙️ Setting',
    `↳ .join-setting · ${settings?.mode === 'CUSTOM' ? 'CUSTOM' : 'STANDARD'} · ${Number(settings?.delayMinSec || 60)}–${Number(settings?.delayMaxSec || 120)}s`,
    '',
    '⬅️ Kembali',
    '↳ .menu · Menu utama',
    '',
    '↳ Gunakan link group yang anda dibenarkan sertai.'
  ];
  return rows.join('\n');
}

export function joinSettingMessage(settings = {}) {
  const mode = settings.mode === 'CUSTOM' ? 'CUSTOM' : 'STANDARD';
  return [
    '⚙️ AUTO JOIN SETTING',
    'Tetapan ini digunakan untuk job Auto Join yang baru.',
    '',
    `Mode         : ${mode === 'STANDARD' ? '🟢 STANDARD' : '🟡 CUSTOM'}`,
    `Delay        : ${Number(settings.delayMinSec || 60)}–${Number(settings.delayMaxSec || 120)}s`,
    `Batch        : ${Number(settings.batchSize || 5)} proses / akaun`,
    `Rehat Batch  : ${Math.round(Number(settings.restMinSec || 300) / 60)}–${Math.round(Number(settings.restMaxSec || 600) / 60)} min`,
    `Cooldown     : ${Math.round(Number(settings.cooldownSec || 900) / 60)} min / ${Number(settings.cooldownEvery || 25)} proses`,
    '',
    '01. Standard',
    '↳ Guna tetapan default yang disyorkan',
    '→ .join-setting standard',
    '',
    '02. Custom',
    '↳ Ubah delay, batch, rehat & cooldown',
    '→ .join-setting custom',
    '',
    '⬅️ Kembali',
    '→ .join'
  ].join('\n');
}

export function joinSettingPromptMessage(step = 'delay', draft = {}) {
  if (step === 'delay') return [
    '⚙️ CUSTOM · DELAY',
    'Taip Delay Min dan Max dalam SAAT.',
    '',
    'Contoh: 60 120',
    '↳ Min 10 saat · Max 3600 saat',
    '',
    '❌ Batal → .join-setting'
  ].join('\n');
  if (step === 'batch') return [
    '⚙️ CUSTOM · BATCH',
    `Delay : ${draft.delayMinSec}–${draft.delayMaxSec}s`,
    '',
    'Taip jumlah proses setiap batch.',
    'Contoh: 5',
    '↳ Julat 1–100',
    '',
    '❌ Batal → .join-setting'
  ].join('\n');
  if (step === 'rest') return [
    '⚙️ CUSTOM · REHAT BATCH',
    `Batch : ${draft.batchSize}`,
    '',
    'Taip Rehat Min dan Max dalam MINIT.',
    'Contoh: 5 10',
    '',
    '❌ Batal → .join-setting'
  ].join('\n');
  return [
    '⚙️ CUSTOM · COOLDOWN',
    `Rehat : ${Math.round(Number(draft.restMinSec || 0) / 60)}–${Math.round(Number(draft.restMaxSec || 0) / 60)} min`,
    '',
    'Taip: BILANGAN PROSES kemudian MINIT COOLDOWN.',
    'Contoh: 25 15',
    '↳ Maksud: rehat 15 minit setiap 25 proses / akaun',
    '',
    '❌ Batal → .join-setting'
  ].join('\n');
}

export function joinAccountSelectMessage(accounts = []) {
  const online = accounts.filter(account => account.status === 'ONLINE');
  const rows = [
    '🔗 AUTO JOIN GROUP',
    'Pilih akaun WhatsApp yang akan digunakan.',
    ''
  ];
  if (!accounts.length) {
    rows.push('Belum ada akaun WhatsApp.', '', '📱 Sambung Akaun', '→ .accounts');
    return rows.join('\n');
  }
  for (const account of accounts.slice(0, 10)) {
    const icon = account.status === 'ONLINE' ? '🟢' : '🔴';
    rows.push(`${String(accountNumber(account)).padStart(2, '0')}. ${accountName(account)} · ${icon} ${account.status}`);
    rows.push(account.status === 'ONLINE' ? `↳ Guna ${accountName(account)} sahaja` : '↳ Tidak tersedia untuk Auto Join');
    if (account.status === 'ONLINE') rows.push(`→ .join ${accountNumber(account)}`);
    rows.push('');
  }
  if (online.length > 1) {
    rows.push(`00. SEMUA AKAUN · 🟢 ${online.length} ONLINE`);
    rows.push('↳ Agihkan link secara bergilir kepada semua akaun online');
    rows.push('→ .join all', '');
  }
  rows.push('⬅️ Kembali', '→ .join');
  return rows.join('\n');
}

export function joinInputMessage(selectionLabel = 'Akaun') {
  return [
    `🔗 AUTO JOIN · ${String(selectionLabel).toUpperCase()}`,
    'Hantar senarai group sekarang.',
    '',
    '📥 Cara Masukkan',
    '↳ Tampal link terus · satu link setiap baris',
    '↳ Atau hantar fail .txt · satu link setiap baris',
    '',
    '✅ Auto Detect',
    '↳ WAPromoBot akan kenal pasti Link Manual atau Fail TXT secara automatik.',
    '↳ Format /invite/... dan link WhatsApp biasa kedua-duanya diterima.',
    '',
    'ℹ️ Command Manual',
    '↳ .join-link · Guna mode link secara manual jika diperlukan',
    '↳ .join-txt · Guna mode TXT secara manual jika diperlukan',
    '',
    '⬅️ Kembali',
    '→ .join-start'
  ].join('\n');
}

export function joinWaitingInputMessage(type = 'link') {
  return type === 'txt'
    ? [
      '📄 FAIL TXT · AUTO JOIN',
      'Hantar fail .txt sekarang.',
      '',
      'Format:',
      '↳ Satu link https://chat.whatsapp.com/... setiap baris',
      '↳ Maksimum 1 MB untuk satu fail',
      '',
      '❌ Batal',
      '→ .join'
    ].join('\n')
    : [
      '🔗 LINK MANUAL · AUTO JOIN',
      'Tampal senarai link sekarang.',
      '',
      'Format:',
      '↳ Satu link https://chat.whatsapp.com/... setiap baris',
      '',
      '❌ Batal',
      '→ .join'
    ].join('\n');
}

export function joinReviewMessage(job, accounts = []) {
  const accountLabel = job.mode === 'all'
    ? `Semua Akaun · ${accounts.length} Akaun`
    : (accounts[0]?.label || 'Akaun');
  return [
    '📋 SEMAK AUTO JOIN',
    '',
    `Job       : #${job.id}`,
    `Akaun     : ${accountLabel}`,
    `Jumlah    : ${Number(job.totalInput || 0).toLocaleString('en-US')} Link`,
    `Valid     : ${Number(job.validCount || 0).toLocaleString('en-US')}`,
    `Duplicate : ${Number(job.duplicateCount || 0).toLocaleString('en-US')}`,
    `Invalid   : ${Number(job.invalidCount || 0).toLocaleString('en-US')}`,
    '',
    `↳ ${Number(job.validCount || 0).toLocaleString('en-US')} link sedia untuk diproses.`,
    '↳ Setiap link hanya diproses sekali dalam job ini.',
    '',
    '▶️ Mula',
    `→ .join-start ${job.id}`,
    '',
    '🔄 Ganti Senarai',
    '→ .join-start',
    '',
    '❌ Batal',
    '→ .join'
  ].join('\n');
}

function compactWaitLabel(account = {}) {
  const at = account.availableAt ? Date.parse(account.availableAt) : 0;
  const remaining = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  if (!remaining) return 'READY';
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  const rest = Number(account.lastRestSec || 0);
  if (rest >= 300) return `☕ ${min}m ${sec}s`;
  return `⏳ ${remaining}s`;
}

export function joinStatusMessage(job = null, accounts = [], recent = []) {
  if (!job) return [
    '📊 STATUS AUTO JOIN',
    'Belum ada job Auto Join untuk dipaparkan.',
    '',
    '▶️ Auto Join Baru',
    '→ .join-start',
    '',
    '⬅️ Kembali',
    '→ .join'
  ].join('\n');
  const statusIcon = job.status === 'RUNNING' ? '🟢' : job.status === 'PAUSED' ? '🟡' : job.status === 'COMPLETED' ? '✅' : job.status === 'STOPPED' ? '⏹' : '⚪';
  const remaining = Math.max(0, Number(job.targetTotal || job.validCount || 0) - Number(job.processed || 0));
  const rows = [
    `🔗 AUTO JOIN · JOB #${job.id}`,
    '',
    `Status   : ${statusIcon} ${job.status}`,
    `Progress : ${Number(job.processed || 0).toLocaleString('en-US')} / ${Number(job.targetTotal || job.validCount || 0).toLocaleString('en-US')}`,
    `Success  : ${Number(job.successCount || 0).toLocaleString('en-US')}`,
    `Failed   : ${Number(job.failedCount || 0).toLocaleString('en-US')}`,
    `Baki     : ${remaining.toLocaleString('en-US')}`,
    '',
    '⚙️ JADUAL',
    `↳ Delay ${Number(job.delayMinSec || 60)}–${Number(job.delayMaxSec || 120)}s · Batch ${Number(job.batchSize || 5)}`,
    `↳ Rehat ${Math.round(Number(job.restMinSec || 300) / 60)}–${Math.round(Number(job.restMaxSec || 600) / 60)} min · Cooldown ${Math.round(Number(job.cooldownSec || 900) / 60)} min / ${Number(job.cooldownEvery || 25)} proses`,
    ''
  ];
  for (const account of accounts) rows.push(`📱 ${accountName(account)} · ${compactWaitLabel(account)}`);
  if (accounts.length) rows.push('');

  rows.push('🕘 10 TERKINI');
  if (!recent?.length) rows.push('↳ Belum ada hasil diproses.');
  recent.slice(0, 10).forEach((item, index) => {
    const icon = item.status === 'SUCCESS' ? '✅' : item.status === 'SKIPPED' ? '⏭' : '❌';
    const name = item.groupName || `Link #${item.position}`;
    rows.push(`${String(index + 1).padStart(2, '0')}. ${icon} ${name}`);
    const detail = item.status === 'SUCCESS'
      ? `${item.accountLabel || 'Akaun'}${Number(item.participantCount || 0) ? ` · ${Number(item.participantCount).toLocaleString('en-US')} Ahli` : ''}`
      : `${item.accountLabel || 'Akaun'}${item.errorText ? ` · ${String(item.errorText).slice(0, 42)}` : ''}`;
    rows.push(`    ↳ ${detail}`);
  });
  rows.push('');

  if (job.status === 'RUNNING') rows.push('⏸ Pause', `→ .join-pause ${job.id}`, '', '⏹ Stop', `→ .join-stop ${job.id}`, '');
  if (job.status === 'PAUSED') rows.push('▶️ Resume', `→ .join-resume ${job.id}`, '', '⏹ Stop', `→ .join-stop ${job.id}`, '');
  if (job.status === 'STOPPED' && remaining > 0) rows.push('▶️ Sambung Baki', `→ .join-resume ${job.id}`, '', '↳ Sambung hanya link yang masih belum diproses.', '');
  if (job.status === 'COMPLETED') rows.push('👥 Sync Group', '→ .group-sync all', '', '🔗 Auto Join Baru', '→ .join-start', '');
  rows.push('🔄 Refresh', `→ .join-status ${job.id}`, '', '📄 Report', `→ .join-report-info ${job.id}`, '', '⬅️ Kembali', '→ .join');
  return rows.join('\n');
}

export function joinCompletedMessage(job) {
  return [
    '✅ AUTO JOIN SELESAI',
    '',
    `Job     : #${job.id}`,
    `Jumlah  : ${Number(job.targetTotal || job.validCount || 0).toLocaleString('en-US')}`,
    `Success : ${Number(job.successCount || 0).toLocaleString('en-US')}`,
    `Failed  : ${Number(job.failedCount || 0).toLocaleString('en-US')}`,
    '',
    '👥 Sync Group',
    '↳ Kemas kini group selepas proses join',
    '→ .group-sync all',
    '',
    '📄 Report',
    `→ .join-report-info ${job.id}`,
    '',
    '🔗 Auto Join Baru',
    '→ .join-start',
    '',
    '⬅️ Menu Utama',
    '→ .menu'
  ].join('\n');
}

export function joinReportListMessage(result) {
  const rows = ['📄 REPORT AUTO JOIN', 'Lihat rekod Auto Join terdahulu.', ''];
  if (!result?.items?.length) rows.push('Belum ada rekod Auto Join.', '');
  for (const job of result?.items || []) {
    const icon = job.status === 'COMPLETED' ? '✅' : job.status === 'RUNNING' ? '🟢' : job.status === 'PAUSED' ? '🟡' : job.status === 'STOPPED' ? '⏹' : '⚪';
    rows.push(`#${job.id} · ${icon} ${job.status}`);
    rows.push(`↳ ✅ ${Number(job.successCount || 0).toLocaleString('en-US')} · ❌ ${Number(job.failedCount || 0).toLocaleString('en-US')}`);
    rows.push(`→ .join-report-info ${job.id}`);
    rows.push('');
  }
  rows.push(`Page : ${result?.page || 1} / ${result?.totalPages || 1}`);
  if ((result?.page || 1) < (result?.totalPages || 1)) rows.push('➡️ NEXT', `→ .join-report ${Number(result.page) + 1}`);
  if ((result?.page || 1) > 1) rows.push('⬅️ BACK', `→ .join-report ${Number(result.page) - 1}`);
  rows.push('', '⬅️ Kembali', '→ .join');
  return rows.join('\n');
}

export function joinReportDetailMessage(job, targets) {
  if (!job) return ['⚠️ REPORT TIDAK DITEMUI', '', '→ .join-report'].join('\n');
  const rows = [
    `📄 REPORT AUTO JOIN · #${job.id}`,
    '',
    `Status   : ${job.status}`,
    `Progress : ${Number(job.processed || 0).toLocaleString('en-US')} / ${Number(job.targetTotal || job.validCount || 0).toLocaleString('en-US')}`,
    `Success  : ${Number(job.successCount || 0).toLocaleString('en-US')}`,
    `Failed   : ${Number(job.failedCount || 0).toLocaleString('en-US')}`,
    `Baki     : ${Math.max(0, Number(job.targetTotal || job.validCount || 0) - Number(job.processed || 0)).toLocaleString('en-US')}`,
    '',
    '📊 Live Progress',
    `→ .join-status ${job.id}`,
    ''
  ];
  for (const target of targets?.items || []) {
    const icon = target.status === 'SUCCESS' ? '✅' : target.status === 'FAILED' ? '❌' : target.status === 'PROCESSING' ? '🟡' : '⚪';
    rows.push(`${String(target.position).padStart(2, '0')}. ${target.groupName || 'Group WhatsApp'}`);
    rows.push(`↳ ${target.accountLabel || '-'} · ${icon} ${target.status}`);
    if (target.status === 'SUCCESS' && Number(target.participantCount || 0) > 0) rows.push(`↳ ${Number(target.participantCount).toLocaleString('en-US')} Ahli`);
    rows.push('');
  }
  rows.push(`Page : ${targets?.page || 1} / ${targets?.totalPages || 1}`);
  if ((targets?.page || 1) < (targets?.totalPages || 1)) rows.push('➡️ NEXT', `→ .join-report-info ${job.id} ${Number(targets.page) + 1}`);
  if ((targets?.page || 1) > 1) rows.push('⬅️ BACK', `→ .join-report-info ${job.id} ${Number(targets.page) - 1}`);
  rows.push('', '⬅️ Kembali', '→ .join-report');
  return rows.join('\n');
}

export function groupMessage(accounts = []) {
  const total = accounts.reduce((sum, account) => sum + Number(account.groupCount || 0), 0);
  const online = accounts.filter(account => account.status === 'ONLINE').length;
  const rows = [
    '👥 Group',
    'Lihat, sync & urus group bagi setiap akaun.',
    '',
    `Akaun : ${accounts.length}`,
    `Online: ${online}`,
    `Group : ${total.toLocaleString('en-US')}`,
    ''
  ];

  if (accounts.length) {
    for (const account of accounts.slice(0, 10)) {
      const icon = account.status === 'ONLINE' ? '🟢' : account.status === 'OFFLINE' ? '🟡' : '🔴';
      rows.push(`${String(accountNumber(account)).padStart(2, '0')}. ${accountName(account)} · ${icon} ${account.status}`);
      rows.push(`↳ ${Number(account.groupCount || 0).toLocaleString('en-US')} Group`);
      rows.push(`→ .group ${accountNumber(account)}`);
      rows.push('');
    }
  }

  rows.push(
    '00. Semua Akaun',
    '↳ Lihat jumlah group semua akaun',
    '→ .group all',
    '',
    '🔄 Sync Semua',
    '↳ Kemas kini semua akaun yang ONLINE',
    '→ .group-sync all',
    '',
    '📲 Auto Group Status',
    '↳ Teks, gambar atau video untuk Group Status',
    '→ .group-status',
    '',
    '⬅️ Kembali',
    '→ .menu'
  );
  return rows.join('\n');
}

export function groupAllMessage(accounts = []) {
  const total = accounts.reduce((sum, account) => sum + Number(account.groupCount || 0), 0);
  const rows = [
    '👥 SEMUA GROUP',
    'Ringkasan group bagi semua akaun.',
    ''
  ];
  if (!accounts.length) rows.push('Belum ada akaun WhatsApp.', '');
  for (const account of accounts.slice(0, 10)) {
    const icon = account.status === 'ONLINE' ? '🟢' : account.status === 'OFFLINE' ? '🟡' : '🔴';
    rows.push(`${accountName(account)} · ${icon} ${Number(account.groupCount || 0).toLocaleString('en-US')} Group`);
    rows.push(`→ .group ${accountNumber(account)}`);
    rows.push('');
  }
  rows.push(
    `Total Access : ${total.toLocaleString('en-US')} Group`,
    '',
    '🔄 Sync Semua',
    '→ .group-sync all',
    '',
    '⬅️ Kembali',
    '→ .group'
  );
  return rows.join('\n');
}

export function groupListMessage(account, result) {
  if (!account) return ['⚠️ AKAUN TIDAK DITEMUI', '', '⬅️ Kembali', '→ .group'].join('\n');
  const rows = [
    `👥 GROUP · ${account.label.toUpperCase()}`,
    `${Number(result.total || 0).toLocaleString('en-US')} group tersedia.`,
    ''
  ];
  if (!result.items?.length) {
    rows.push('Belum ada group disimpan.', '↳ Jalankan Sync Group dahulu.', '');
  } else {
    result.items.forEach((group, index) => {
      const ordinal = Number(result.offset || 0) + index + 1;
      rows.push(`${String(ordinal).padStart(2, '0')}. ${group.subject}`);
      rows.push(`↳ ${Number(group.participantCount || 0).toLocaleString('en-US')} Ahli`);
      rows.push(`→ .group-info ${accountNumber(account)} ${ordinal}`);
      rows.push('');
    });
  }
  rows.push(`Page : ${result.page} / ${result.totalPages}`);
  if (result.page < result.totalPages) rows.push('➡️ NEXT', `→ .group ${accountNumber(account)} ${result.page + 1}`);
  if (result.page > 1) rows.push('⬅️ BACK', `→ .group ${accountNumber(account)} ${result.page - 1}`);
  rows.push(
    '',
    '🔄 Sync',
    `↳ Kemas kini group ${accountName(account)}`,
    `→ .group-sync ${accountNumber(account)}`,
    '',
    '⬅️ Kembali',
    '→ .group'
  );
  return rows.join('\n');
}

export function groupInfoMessage(account, group, position) {
  if (!account || !group) return ['⚠️ GROUP TIDAK DITEMUI', '', `→ .group ${account?.id || ''}`].join('\n');
  const synced = group.syncedAt ? new Date(group.syncedAt).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : '-';
  return [
    `👥 ${group.subject.toUpperCase()}`,
    '',
    `Akaun : ${accountName(account)}`,
    `Ahli  : ${Number(group.participantCount || 0).toLocaleString('en-US')}`,
    `Status: ${Number(group.isAvailable) === 1 ? '🟢 TERSEDIA' : '🔴 TIDAK TERSEDIA'}`,
    '',
    '🕒 Last Sync',
    `↳ ${synced}`,
    '',
    '⬅️ Kembali',
    `→ .group ${accountNumber(account)} ${Math.max(1, Math.ceil(Number(position || 1) / 10))}`
  ].join('\n');
}

export function groupSyncProgressMessage(account, progress = null) {
  const rows = [
    `🔄 SYNC GROUP · ${account.label.toUpperCase()}`,
    '',
    'Status : 🟢 SEDANG SYNC'
  ];
  if (progress && Number.isFinite(Number(progress.total))) {
    rows.push(`Progress : ${Number(progress.processed || 0).toLocaleString('en-US')} / ${Number(progress.total || 0).toLocaleString('en-US')}`);
    rows.push(`Dikesan  : ${Number(progress.accepted || 0).toLocaleString('en-US')} Group`);
    rows.push('');
    rows.push('↳ Data disimpan secara batch. Group lama kekal selamat sehingga sync selesai.');
  } else {
    rows.push('↳ Mengesan group WhatsApp dalam akaun ini...');
    rows.push('');
    rows.push('Tunggu sehingga proses selesai.');
  }
  return rows.join('\n');
}

export function groupSyncCompleteMessage(result) {
  const account = result.account;
  return [
    '✅ SYNC GROUP SELESAI',
    '',
    `Akaun   : ${accountName(account)}`,
    `Sebelum : ${Number(result.before || 0).toLocaleString('en-US')} Group`,
    `Sekarang: ${Number(result.detected || 0).toLocaleString('en-US')} Group`,
    `Baru    : +${Number(result.newCount || 0).toLocaleString('en-US')}`,
    result.restoredCount ? `Kembali : +${Number(result.restoredCount).toLocaleString('en-US')}` : null,
    result.removedCount ? `Tiada lagi: ${Number(result.removedCount).toLocaleString('en-US')}` : null,
    '',
    '👥 Lihat Group',
    `→ .group ${accountNumber(account)}`,
    '',
    '⬅️ Kembali',
    '→ .group'
  ].filter(line => line !== null).join('\n');
}

export function groupSyncAllMessage(results = []) {
  const ok = results.filter(item => item.ok);
  const failed = results.filter(item => !item.ok);
  const rows = [
    '✅ SYNC SEMUA SELESAI',
    '',
    `Berjaya : ${ok.length} Akaun`,
    `Gagal   : ${failed.length} Akaun`,
    ''
  ];
  for (const item of results) {
    if (item.ok) rows.push(`${item.account.label} · ✅ ${Number(item.result.detected || 0).toLocaleString('en-US')} Group`);
    else rows.push(`${item.account.label} · ❌ ${String(item.error?.message || 'Gagal')}`);
  }
  rows.push('', '👥 Semua Group', '→ .group all', '', '⬅️ Kembali', '→ .group');
  return rows.join('\n');
}

export { postingNewMessage, postingNamePromptMessage, postingAdInputMessage, postingAdAcceptedMessage, postingButtonNamePromptMessage, postingButtonUrlPromptMessage, postingButtonSavedMessage, postingAdCompleteMessage, postingAdsManageMessage, postingAdDetailMessage, postingPreviewHeaderMessage, postingPreviewFooterMessage, postingButtonManageMessage, postingButtonSelectMessage, postingAdsReadyMessage, postingAccountSelectMessage, postingTargetModeMessage, postingTargetSuccessMessage, postingTargetDaysMessage, postingReuseMessage, postingScheduleMessage, postingSchedulePromptMessage, postingReviewMessage, postingJobStatusMessage, postingStartedMessage, postingActiveMessage, postingAccountsMessage, postingRunBoundaryMessage } from './posting-ui.js';
import { postingStatusIcon, postingJobModeLabel } from './posting-ui.js';

export function recordsMessage(jobs = []) {
  const items = Array.isArray(jobs) ? jobs.filter(job => ['COMPLETED','STOPPED'].includes(String(job.status))) : [];
  if (!items.length) return [
    '📁 Rekod Posting',
    'Lihat campaign yang sudah tamat atau dihentikan.', '',
    'Rekod : 0', '',
    '🔄 Refresh', '↳ .rekod · Kemas kini senarai rekod', '',
    '⬅️ Kembali', '↳ .menu · Menu utama', '',
    '↳ COMPLETED dan STOPPED akan disimpan di sini.',
    '↳ STOP ≠ DELETE.'
  ].join('\n');
  const rows = ['📁 REKOD POSTING', `Rekod : ${items.length}`, ''];
  for (const job of items.slice(0, 10)) {
    rows.push(`${postingStatusIcon(job.status)} CAM-${String(job.id).padStart(3,'0')} · ${job.displayName}`);
    rows.push(`↳ ${postingJobModeLabel(job)} · ✅ ${job.successCount} · ❌ ${job.failedCount}`);
    rows.push(`↳ Report: ${job.reportStatus === 'SENT' ? 'DIHANTAR' : job.reportStatus || 'BELUM'}`);
    rows.push(`→ .status ${job.id}`, '');
  }
  rows.push('🔄 Refresh','→ .rekod','','⬅️ Kembali','→ .menu','','↳ STOP ≠ DELETE.');
  return rows.join('\n');
}

export function reportMessage(jobs = []) {
  const items = Array.isArray(jobs) ? jobs : [];
  if (!items.length) return [
    '📄 Report',
    'Report TXT campaign akan dihantar automatik selepas COMPLETED/STOPPED.', '',
    'Report : 0', '',
    '🔄 Refresh', '↳ .report · Kemas kini report', '',
    '⬅️ Kembali', '↳ .menu · Menu utama'
  ].join('\n');
  const rows = ['📄 REPORT CAMPAIGN', '↳ TXT dihantar ke Telegram sebelum cleanup local.', ''];
  for (const job of items.slice(0, 10)) {
    const status = job.reportStatus === 'SENT' ? '✅ DIHANTAR' : job.reportStatus === 'PENDING' ? '⏳ MENUNGGU' : '—';
    rows.push(`CAM-${String(job.id).padStart(3,'0')} · ${job.displayName}`);
    rows.push(`↳ ${status} · ✅ ${job.successCount} · ❌ ${job.failedCount}`);
    if (job.reportFilename) rows.push(`↳ ${job.reportFilename}`);
    rows.push(`→ .status ${job.id}`, '');
  }
  rows.push(
    '🗑 PADAM REKOD REPORT',
    '→ .report-delete <CAM-ID>',
    '→ .report-delete all',
    '',
    '↳ Hanya rekod local dipadam. TXT yang sudah dihantar ke Telegram kekal.',
    '',
    '🔄 Refresh','→ .report','','⬅️ Kembali','→ .menu'
  );
  return rows.join('\n');
}

export function statusMessage({ build, botUsername, ownerUserId, verified = true, whatsapp = {} }) {
  const connected = Number(whatsapp.connected || 0);
  const total = Number(whatsapp.total || 0);
  return [
    '📊 WAPromoBot · Status',
    '',
    `Build      : ${build}`,
    `Bot        : ${botUsername ? '@' + botUsername : '-'}`,
    `Owner ID   : ${ownerUserId}`,
    `Owner      : ${verified ? '✅ VERIFIED' : '⚠️ PENDING'}`,
    'Telegram   : 🟢 ONLINE',
    `WhatsApp   : ${connected ? '🟢' : total ? '🟡' : '⚪'} ${connected}/${total} Connected`,
    'Database   : 🟢 READY',
    'Controller : 🟢 ONLINE',
    '',
    '⬅️ Kembali',
    '↳ .system · System'
  ].join('\n');
}

export function systemMessage({ build, stage, whatsapp = {}, autoMarkRead = true }) {
  const connected = Number(whatsapp.connected || 0);
  const total = Number(whatsapp.total || 0);
  return [
    '⚙️ System',
    'Semak keadaan sistem, connection dan storage.',
    '',
    `Build     : ${build}`,
    `Stage     : ${stage}`,
    'Telegram  : 🟢 ONLINE',
    'Database  : 🟢 READY',
    `WhatsApp  : ${connected ? '🟢' : total ? '🟡' : '⚪'} ${connected}/${total} Connected`,
    'Storage   : 🟢 NORMAL',
    '',
    '🩺 System Check',
    '↳ .system-check · Periksa keseluruhan sistem',
    '',
    '💾 Storage',
    '↳ .storage · Semak & urus penggunaan storage',
    '',
    '📱 WhatsApp',
    '↳ .accounts · Semak keadaan akaun',
    '',
    '👁 Auto Mark Read',
    `↳ ${autoMarkRead ? '✅ ON' : '❌ OFF'} · Selepas posting SUCCESS`,
    '→ .auto-read',
    '',
    '⚙️ ↳ .system-posting → Default Delay & Rehat Auto Post',
    '',
    'ℹ️ Version',
    '↳ .version · Maklumat sistem',
    '',
    '🔄 Refresh',
    '↳ .system · Kemas kini status',
    '',
    '⬅️ Kembali',
    '↳ .menu · Menu utama'
  ].join('\n');
}

export function autoReadMessage(enabled = true) {
  return [
    '👁 AUTO MARK READ',
    '',
    `${enabled ? '✅ ON' : '❌ OFF'} · ${enabled ? 'Selepas posting SUCCESS, group ditandakan sudah dibaca.' : 'Unread count WhatsApp dibiarkan seperti biasa.'}`,
    '',
    '✅ ON',
    '↳ Hilangkan badge unread selepas iklan berjaya dihantar.',
    '→ .auto-read on',
    '',
    '❌ OFF',
    '↳ Jangan ubah read state group.',
    '→ .auto-read off',
    '',
    '↳ Tidak clear chat, tidak delete mesej dan tidak archive group.',
    '',
    '⬅️ Kembali',
    '→ .system'
  ].join('\n');
}

export function systemCheckMessage(whatsapp = {}) {
  const connected = Number(whatsapp.connected || 0);
  const total = Number(whatsapp.total || 0);
  const waLine = total === 0 ? '⚪ WhatsApp · Belum ada akaun' : connected === total ? `✅ WhatsApp · ${connected}/${total} ONLINE` : `⚠️ WhatsApp · ${connected}/${total} ONLINE`;
  return [
    '🩺 System Check',
    'Pemeriksaan keseluruhan sistem selesai.',
    '',
    '✅ Configuration',
    '✅ Telegram Bot',
    '✅ Owner Security',
    '✅ Database',
    '✅ Controller',
    '✅ WhatsApp Engine',
    waLine,
    '',
    connected === total && total > 0 ? '🟢 System normal.' : '↳ Semak WhatsApp jika ada akaun offline.',
    '',
    '🔄 Check Semula',
    '↳ .system-check · Jalankan semula pemeriksaan',
    '',
    '⬅️ Kembali',
    '↳ .system · System'
  ].join('\n');
}

export function storageMessage(snapshot = {}) {
  const value = key => snapshot?.[key] || '0 B';
  return [
    '💾 STORAGE MANAGER',
    'Semak penggunaan dan bersihkan storage dengan selamat.',
    '',
    `Database      : ${value('database')}`,
    `Media Iklan  : ${value('media')}`,
    `Report Local : ${value('reports')}`,
    `Logs          : ${value('logs')}`,
    `Temp / Cache  : ${value('temp')}`,
    `Jumlah Urus   : ${value('managedTotal')}`,
    `Ruang Bebas   : ${value('deviceFree')}`,
    '',
    '🔒 WhatsApp Session · DILINDUNGI',
    '↳ Session, database aktif & media campaign aktif tidak dipadam.',
    '',
    '🧹 BERSIHKAN STORAGE',
    '→ .storage-clean temp',
    '→ .storage-clean logs',
    '→ .storage-clean media',
    '→ .storage-clean all',
    '',
    '📄 Report Campaign',
    '↳ .report · Urus / padam history report',
    '',
    '🔄 Refresh',
    '↳ .storage · Kemas kini storage',
    '',
    '⬅️ Kembali',
    '↳ .system · System'
  ].join('\n');
}

export function versionMessage({ build, stage }) {
  return [
    'ℹ️ Version',
    '',
    '🤖 WAPromoBot',
    'Version : v1.0.0',
    `Build   : ${build}`,
    `Stage   : ${stage}`,
    'Runtime : Node.js',
    'Platform: Termux',
    '',
    '🩺 System Check',
    '↳ .system-check · Periksa sistem',
    '',
    '⬅️ Kembali',
    '↳ .system · System'
  ].join('\n');
}

export function helpMessage() { return "❓ PANDUAN & HELP\n↳ Panduan ringkas setiap fungsi, langkah demi langkah.\n\n------------------\n| MULA DI SINI |\n------------------\n1. Sambung akaun WhatsApp sehingga ONLINE.\n2. Sync group bagi akaun tersebut.\n3. Cipta kempen, semak preview dan mula.\n4. Pantau kempen; semak laporan selepas tamat.\n\n------------------\n| PILIH PANDUAN |\n------------------\n↳ .help whatsapp → Akaun Wa\n↳ .help join → Auto Join\n↳ .help group → Urus Group\n↳ .help posting → Auto Post\n↳ .help client → Urus Client\n↳ .help group-status → Auto Status Group\n↳ .help manage → Kempen Aktif\n↳ .help records → Rekod Kempen\n↳ .help report → Laporan Kempen\n↳ .help system → Tetapan Sistem\n↳ .panel-setup → Mini App & Live Panel\n↳ .help problem → Masalah Biasa\n\n• Salin dan hantar command panduan pilihan.\n• Panduan tidak memulakan penghantaran.\n• Gunakan command yang dipaparkan dalam menu terkini.\n\n🏠 ↳ .menu → Menu Utama\n\n© 2027 TnAzam · WAPromoBot"; }

export function helpTopicMessage(topic) {
 const topics = {
  "help_whatsapp": "📱 PANDUAN AKAUN WA\n↳ Sambung akaun sebelum mencipta kempen.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Buka Akaun WA dan pilih Login.\n2. Pilih Pairing Code atau QR, kemudian ikut arahan pada skrin.\n3. Tunggu sehingga ONLINE; akaun pairing yang belum berjaya belum boleh digunakan.\n4. Buka butiran akaun untuk sync group, logout atau padam.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .accounts → Senarai Akaun\n↳ .login → Sambung Akaun\n\nLogout dan padam memerlukan pengesahan. Akaun offline bukan bermaksud sesi perlu dipadam.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_join": "🔗 PANDUAN AUTO JOIN\n↳ Join group melalui link atau fail TXT.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Cipta job dan pilih akaun WhatsApp.\n2. Pilih agihan, kemudian tampal link atau hantar fail TXT.\n3. Semak link sah, duplicate dan tidak sah.\n4. Tetapkan delay, batch, rehat dan cooldown.\n5. Semak preview dan gunakan command mula yang dipaparkan.\n6. Pantau dashboard; pilih job daripada senarai untuk jeda, sambung atau hentikan.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .join → Menu Auto Join\n↳ .join-new → Cipta Job\n↳ .join-draft → Sambung Draf\n↳ .join-list → Senarai Job\n\nSelepas restart, semak job sebelum sambung. Hasil Belum Pasti tidak diulang secara automatik.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_group": "👥 PANDUAN URUS GROUP\n↳ Group disimpan mengikut akaun yang mempunyai akses.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Pastikan akaun ONLINE.\n2. Buka Urus Group dan pilih akaun atau semua akaun.\n3. Gunakan command Sync yang dipaparkan.\n4. Tunggu ringkasan sync, kemudian semak senarai group.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .group → Menu Urus Group\n↳ .group-sync all → Sync Semua Akaun\n↳ .extract → Pilih Akaun & Group, Eksport Nombor Ahli TXT / CSV\n\nSync mengemas kini senarai group. Ia tidak menghantar iklan atau menyertai group baharu.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_posting": "🚀 PANDUAN AUTO POST\n↳ Iklan sendiri atau client dalam satu kempen.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Buka Mula dan pilih Sendiri atau Client.\n2. Ikut arahan nama; bagi client, semak butiran caj dan bayaran yang dipaparkan.\n3. Masukkan teks, gambar + caption atau video + caption.\n4. Tambah sehingga 2 CTA untuk setiap iklan jika perlu; semak preview.\n5. Pilih akaun, mode SUCCESS / HARI / BERTERUSAN.\n6. Tetapkan delay, batch dan rehat, kemudian semak ringkasan.\n7. Gunakan command mula selepas semua pilihan disahkan.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .mula → Cipta / Sambung Draf\n↳ .iklan-urus → Urus Iklan\n↳ .status → Pantau Kempen\n\nSUCCESS tamat apabila target SUCCESS sebenar cukup. HARI tamat mengikut tempoh; BERTERUSAN berjalan sehingga dihentikan. Setiap akaun menggunakan group miliknya.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_client": "👤 PANDUAN URUS CLIENT\n↳ Semak pelanggan, caj, bayaran dan kempen.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Buka Urus Client dan pilih pelanggan daripada senarai.\n2. Semak profil, kempen serta baki bayaran pelanggan tersebut.\n3. Gunakan tindakan yang dipaparkan untuk tambah atau kemas kini maklumat.\n4. Untuk iklan client, buka Mula dan pilih Client.\n5. Semak nama dan jumlah sebelum mengesahkan tindakan bayaran.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .client → Menu Urus Client\n↳ .mula → Cipta Kempen Client\n\nCleanup operasi kempen tidak memadam profil client atau transaksi bayaran. Pengesahan bayaran tidak memulakan penghantaran secara automatik.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_group_status": "📢 PANDUAN AUTO STATUS GROUP\n↳ Status group dengan satu bahan bagi setiap kempen.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Cipta Status atau sambung draf.\n2. Pilih satu, beberapa atau semua akaun ONLINE yang dipaparkan.\n3. Hantar teks sahaja atau gambar berserta caption; tiada CTA.\n4. Tetapkan delay, batch dan rehat.\n5. Semak preview serta semua group tersimpan milik akaun pilihan.\n6. Mula dan pantau dashboard live 10 hasil terkini.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .group-status → Menu Auto Status\n↳ .gs-new → Cipta Status\n↳ .gs-draft → Sambung Draf\n↳ .gs-list → Pilih Kempen\n\nACK OK ialah penerimaan pelayan, bukan bukti Status muncul. Ini bukan mesej group biasa atau My Status peribadi. Kempen STOPPED dengan baki boleh disambung melalui kawalan kempen tersebut.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_manage": "⚡ PANDUAN KEMPEN AKTIF\n↳ Pantau Auto Post dan Auto Status Group.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Buka senarai Kempen Aktif.\n2. Pilih command Buka Kempen pada baris kempen yang dikehendaki.\n3. Buka mesej rujukan dashboard live untuk melihat progress dan 10 hasil terkini.\n4. Gunakan Jeda, Sambung atau Hentikan pada kempen tersebut.\n5. Semak nama kempen sebelum membalas SAH untuk hentikan.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .status → Senarai Kempen Aktif\n↳ .rekod → Kempen Terdahulu\n\nKawalan hanya untuk kempen terpilih. Operasi yang sudah dihantar mungkin masih selesai. Nombor senarai boleh berubah: gunakan command daripada paparan terkini. Auto Join diurus melalui .join.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_records": "🗂️ PANDUAN REKOD KEMPEN\n↳ Semak sejarah dan urus rekod lokal.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Buka Rekod Kempen dan pilih Butiran Rekod.\n2. Semak status, laporan, rekod penghantaran dan akaun.\n3. Jika Auto Status dihentikan dengan baki, gunakan Sambung Baki jika ditawarkan.\n4. Untuk padam, pilih Padam Rekod, semak skop dan balas SAH.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .rekod → Senarai Rekod\n↳ .report → Senarai Laporan\n\nPadam rekod lokal tidak memadam mesej atau Status yang sudah dihantar di WhatsApp. Kempen berjalan perlu dihentikan dahulu. Bahan yang sudah dibersihkan perlu dimuat naik semula untuk ulang.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_report": "📊 PANDUAN LAPORAN KEMPEN\n↳ Report ialah laporan hasil kempen.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Buka Laporan dan pilih kempen.\n2. Semak ringkasan, hasil per akaun dan halaman seterusnya jika ada.\n3. Buka Rekod Penghantaran untuk butiran yang masih disimpan.\n4. Untuk padam laporan dan rekod lokal, gunakan tindakan Padam jika tersedia, kemudian semak pengesahan.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .report → Senarai Laporan\n↳ .rekod → Senarai Rekod\n↳ .system-report-retry → Cuba Semula Laporan Tertangguh\n\nLaporan aktif ialah kiraan semasa. SUCCESS Auto Post berbeza daripada ACK OK Auto Status. Butiran tertakluk pada retention; laporan yang sudah dihantar ke Telegram kekal selepas cleanup lokal.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_system": "⚙️ PANDUAN TETAPAN SISTEM\n↳ Tetapan penghantaran, storage dan pembersihan.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Buka Tetapan Sistem untuk status dan penggunaan storage.\n2. Tetapkan default penghantaran untuk job baharu.\n3. Pilih polisi cleanup: Ringan, Simpan untuk Ulang atau Padam Selepas Selesai.\n4. Semak tempoh simpan; polisi job sedia ada tidak berubah secara senyap.\n5. Untuk cleanup manual, pilih kategori storage dan semak calon fail.\n6. Balas BERSIHKAN hanya selepas menyemak preview.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .system → Tetapan Sistem\n↳ .system-default → Default Penghantaran\n↳ .system-cleanup → Polisi Cleanup\n↳ .system-retention → Tempoh Simpan\n↳ .storage → Preview Pembersihan\n↳ .system-check → Pemeriksaan Lokal\n\nSesi, akaun, kempen aktif/dijeda, media dirujuk dan laporan belum dihantar dilindungi. Cleanup berpolisi meliputi Auto Post dan Auto Status; sejarah Auto Join diurus melalui modulnya.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama",
  "help_problem": "🩺 PANDUAN MASALAH BIASA\n↳ Semak punca sebelum mengulang tindakan.\n\n------------------\n| LANGKAH PENGGUNAAN |\n------------------\n1. Akaun offline: semak Akaun WA; login semula hanya jika sesi tidak sah.\n2. Tiada sasaran: sync group akaun pilihan dan semak semula preview.\n3. Kempen menunggu: periksa delay, rehat, giliran akaun atau sambungan pada dashboard.\n4. Media hilang: semak bahan yang disebut; jangan padam folder media aktif.\n5. Laporan tertangguh: gunakan cuba semula laporan; jangan jalankan semula kempen.\n6. Selepas restart: semak kempen dijeda, kemudian sambung yang dipilih.\n\n------------------\n| BUKA MODUL |\n------------------\n↳ .accounts → Semak Akaun\n↳ .status → Semak Kempen\n↳ .system-check → Pemeriksaan Lokal\n↳ .system-report-retry → Cuba Semula Laporan\n↳ .version → Maklumat Build\n\nJika masih bermasalah, hantar screenshot ralat dan nombor build. Jangan kongsi token bot, kod pairing atau fail sesi. Pemeriksaan lokal bukan ujian sambungan WhatsApp sebenar.\n\n↩️ ↳ .help → Panduan & Help\n🏠 ↳ .menu → Menu Utama"
};
 return topics[topic] || helpMessage();
}

export function placeholderMessage(title, detail = 'Fungsi ini akan diaktifkan pada phase seterusnya.') {
  return [
    title,
    'Modul ini akan diaktifkan pada fasa seterusnya.',
    '',
    '⏳ NEXT PHASE',
    detail,
    '',
    'Flow telah dikunci dan sedia untuk fungsi sebenar.'
  ].join('\n');
}

export { gsMenuMessage, gsContentPrompt, gsAccountPrompt, gsTargetPrompt, gsDashboard, gsPreviewMessage, gsMenuKeyboard, gsPreviewKeyboard, gsDashboardKeyboard, gsReportMessage } from './groupstatus-ui.js';
