import {FollowupFlow} from '../src/followup/flow.js';
import {FollowupRunner} from '../src/followup/runner.js';
import {recover as recoverFollowup} from '../src/followup/store.js';
import {MemberExportFlow} from '../src/telegram/member-export-flow.js';
import {MiniAppController} from '../src/miniapp/controller.js';
import {diskReady} from '../src/system/disk.js';
import {SystemFlow} from '../src/system/flow.js';
import {archivePost,archiveGs} from '../src/system/lifecycle.js';
import {policyDb,capturePolicy} from '../src/system/policy.js';
import { CampaignHub } from '../src/telegram/campaign-hub.js';
import { GroupStatusLive } from '../src/telegram/groupstatus-live.js';
import { resolveGsSelection } from '../src/groupstatus/navigation.js';
import { gsSettingMessage, gsSettingPrompt, gsResult, gsDate } from '../src/telegram/groupstatus-ui.js';
import { postingClientSelectMessage, postingClientNameMessage } from '../src/telegram/posting-ui.js';
import { ClientFlow } from '../src/clients/flow.js';
import { clientChargeMessage } from '../src/clients/ui.js';
import { isClientPosting, setPostingCharge, postingPaymentState } from '../src/posting/store.js';
import { moneyToCents } from '../src/clients/store.js';
import { PostingLive } from '../src/telegram/posting-live.js';
import { isPostingInput, postingBackRoute, draftNextAction } from '../src/telegram/posting-draft.js';
import { GroupFlow } from '../src/telegram/group-flow.js';
import { groupSummary } from '../src/whatsapp/group-store.js';
import { AutoJoinFlow } from '../src/telegram/autojoin-flow.js';
import { AutoJoinRunner } from '../src/whatsapp/autojoin-runner.js';
import { AccountsFlow } from '../src/telegram/accounts-flow.js';
import { accountNumber } from '../src/telegram/accounts-ui.js';
import { readFileSync, appendFileSync, statSync, renameSync, mkdirSync, openSync, writeFileSync, closeSync, unlinkSync, rmSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/system/config.js';
import { projectRoot, databasePath, sessionsPath } from '../src/system/paths.js';
import { progressiveRetryBackoffMs, telegramRetryDelayMs, telegramTransportState, formatUptime } from '../src/system/runtime.js';
import { bytesToHuman, storageSnapshot, cleanTempCache, cleanLogs, cleanOrphanPostingMedia, cleanManagedStorage } from '../src/system/storage.js';
import { loadTelegramState, isTelegramStateCurrent } from '../src/telegram/state.js';
import { getMe, getWebhookInfo, getUpdates, sendMessage, editMessageText, sendPhotoBuffer, editPhotoBuffer, deleteTelegramMessage, sendVideoBuffer, sendDocumentBuffer, answerCallbackQuery, getFileInfo, downloadTelegramFile, retryTelegramCheck, isTransientTelegramError } from '../src/telegram/api.js';
import {
  routeTelegramUpdate, formatTelegramMessage, mainMenuText, whatsappAccountMessage,
  postingNewMessage, postingNamePromptMessage, postingAdInputMessage, postingAdAcceptedMessage,
  postingButtonNamePromptMessage, postingButtonUrlPromptMessage, postingButtonSavedMessage,
  postingAdCompleteMessage, postingAdsManageMessage, postingAdDetailMessage, postingPreviewHeaderMessage,
  postingPreviewFooterMessage, postingButtonManageMessage, postingButtonSelectMessage, postingAdsReadyMessage,
  postingAccountSelectMessage, postingTargetModeMessage, postingTargetSuccessMessage, postingTargetDaysMessage, postingReuseMessage,
  postingScheduleMessage, postingSchedulePromptMessage, postingReviewMessage, postingRunBoundaryMessage,
  postingStartedMessage, postingJobStatusMessage, postingActiveMessage, recordsMessage, reportMessage, statusMessage,
  systemMessage, autoReadMessage, systemCheckMessage, storageMessage, versionMessage, helpMessage,
  helpTopicMessage, placeholderMessage, gsMenuMessage, gsContentPrompt, gsAccountPrompt, gsTargetPrompt, gsDashboard, gsPreviewMessage, gsMenuKeyboard, gsPreviewKeyboard, gsDashboardKeyboard, gsReportMessage
} from '../src/telegram/controller.js';
import { printHeader, printFooter, row, divider, cyan, green, yellow, red, dim, clearScreen } from '../src/system/ui.js';
import { WhatsAppManager } from '../src/whatsapp/manager.js';
import { classifyGsError } from '../src/groupstatus/protocol.js';
import { classifyGsGroupRejection } from '../src/groupstatus/diagnostics.js';
import {createGsJob,getGsJob,latestGsJob,listGsJobs,listAllGsJobs,setGsContent,setGsAccounts,prepareGsTargets,gsSnapshot,listGsRecent,setGsStatus,claimGsNext,finishGsTarget,requeueGsUnsent,gsAccountProgress,gsListPosts,gsRecordAccountHealth,gsRetryBlockedAccount,recoverGsJobs,deleteGsJob,cloneGsJob,gsAccountStats,setGsPace,gsNextWaitMs,gsTargetsChanged} from '../src/groupstatus/store.js';
import {
  getClient,
  linkClientPosting,unlinkClientPosting,saveClientCampaignSnapshot
} from '../src/clients/store.js';
import { initializeDatabase } from '../src/database/connection.js';
import { listWhatsAppAccounts, whatsappAccountSummary, listWhatsAppGroups,
  recoverAutoJoinJobs,
  getWhatsAppAutoMarkRead, setWhatsAppAutoMarkRead
} from '../src/whatsapp/store.js';
import {
  getDraftPosting, getCurrentPosting, getUnstartedPosting, getPostingJobForPosting, getPosting, createPosting, reopenPostingDraft, markPostingReady,
  deleteDraftPosting, deletePosting, listPostingAds, getPostingAd, createPostingAd, updatePostingAd, deletePostingAd,
  listPostingButtons, addPostingButton, updatePostingButton, deletePostingButton, postingAdSummary,
  getPostingPlan, savePostingPlanAccounts, setPostingCampaignMode, setPostingSuccessTarget, setPostingDaysTarget, setPostingContinuous, setPostingReuseMode, updatePostingScheduleSettings, postingPlanSummary,
  createPostingJob, getPostingJob, getLatestPostingJob, listPostingJobs, setPostingJobStatus, recoverPostingJobs,
  claimNextPostingTarget, getPostingJobAd, completePostingTarget, requeuePostingTarget, setPostingAccountWait,
  listRecentPostingTargets, randomPostingWait, postingJobCounts,
  claimNextCampaignWork, completeCampaignWork, requeueCampaignWork, getPostingWorker, setPostingWorkerWait, randomWorkerWait,
  finalizeExpiredPostingJobs, listPendingPostingReports, listPendingPostingCleanup, postingReportSnapshot, markPostingReportFailed, markPostingReportSent, cleanupPostingJobData, requestPostingCampaignDelete,
  markCampaignSendStarted,pauseCampaignForMedia,capturePostingReview,setPostingClient,readPostingFlowState,savePostingFlowState,getPostingDefaults,setPostingDefaults,isPostingMediaReferenced,
  deletePostingReportRecord, deleteAllPostingReportRecords
} from '../src/posting/store.js';

process.umask(0o077);

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const build = pkg.wapromobot.build;
const stage = pkg.wapromobot.stage;
const lockPath = join(projectRoot, 'temp', 'telegram-controller.lock');

function renderStarting(step = 'Telegram sedang disambungkan...') {
  const width = printHeader('TELEGRAM CONTROLLER', 'Owner-only Remote Control');
  console.log(row('', width));
  console.log(cyan(row('STARTUP', width)));
  console.log(yellow(row('Controller   ● STARTING', width)));
  console.log(row(`Status       ${step}`, width));
  console.log(row('', width));
  console.log(cyan(divider(width)));
  console.log(dim(row('Sila tunggu sebentar. Tidak perlu tekan apa-apa.', width)));
  console.log(row('', width));
  printFooter(`Build ${build} • ${stage}`, width);
}

function fatal(message) {
  const width = printHeader('TELEGRAM CONTROLLER');
  console.log(row('', width));
  console.log(red(row(`● ${message}`, width)));
  console.log(row('', width));
  printFooter('Controller not started', width);
  process.exit(1);
}

function acquireLock() {
  mkdirSync(join(projectRoot, 'temp'), { recursive: true, mode: 0o700 });
  try {
    const fd = openSync(lockPath, 'wx', 0o600);
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let pid = 0;
    try { pid = Number(readFileSync(lockPath, 'utf8').trim()); } catch {}
    if (pid > 0) {
      try { process.kill(pid, 0); throw new Error('Telegram Controller sudah berjalan.'); }
      catch (probe) { if (probe.message === 'Telegram Controller sudah berjalan.') throw probe; }
    }
    try { unlinkSync(lockPath); } catch {}
    const fd = openSync(lockPath, 'wx', 0o600);
    writeFileSync(fd, `${process.pid}\n`);
    closeSync(fd);
  }
}

function releaseLock() {
  try { unlinkSync(lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

renderStarting('Menyiapkan sistem...');
initializeDatabase(databasePath);

const config = loadConfig();
const state = loadTelegramState();
if (!config) fatal('Telegram belum disediakan.');
if (!isTelegramStateCurrent(config, state)) fatal('Owner Telegram belum VERIFIED.');

const clientsDbPath = join(projectRoot, 'data', 'clients.sqlite');
const token = config.telegram.botToken;
const ownerId = config.telegram.ownerUserId;
let bot;
try {
  acquireLock();
} catch (error) {
  fatal(error.message);
}

let startupRetryAttempt = 0;
while (!bot) {
  try {
    renderStarting(startupRetryAttempt ? 'Telegram cuba disambungkan semula...' : 'Telegram sedang disambungkan...');
    const [botInfo, webhook] = await Promise.all([
      getMe(token),
      getWebhookInfo(token)
    ]);
    if (webhook.url) {
      releaseLock();
      fatal('Webhook aktif. Controller polling tidak boleh dimulakan.');
    }
    bot = botInfo;
  } catch (error) {
    if (!isTransientTelegramError(error)) {
      releaseLock();
      fatal(error.message);
    }
    startupRetryAttempt += 1;
    const retryMs = 3000;
    const retrySec = 3;
    renderStarting(`Telegram belum stabil · cuba lagi ${retrySec}s...`);
    await new Promise(resolve => setTimeout(resolve, retryMs));
  }
}

let running = true;
let processed = 0;
let ignored = 0;
let lastAction = 'IDLE';
let lastError = '-';
let telegramConnected = true;
let offset;
let telegramRetryAttempt = 0;
let telegramFailureStreak = 0;
let telegramRetryInSec = 0;
const controllerStartedAt = Date.now();
const wakeLockActive = process.env.WAPROMOBOT_WAKE_LOCK === '1';
const abort = new AbortController();
let panelTimer = null;
let stopKeyHandler = null;
let stopRequested = false;
let shutdownFallback = null;
const whatsapp = new WhatsAppManager({ databasePath, sessionsPath });
const accountFlow = new AccountsFlow({
  manager:whatsapp, databasePath,
  send:(chatId,text) => sendScreen(chatId,text),
  photo:async (chatId,qr,caption,messageId) => {
    const QRCode = await import('qrcode');
    const toBuffer = QRCode.toBuffer || QRCode.default?.toBuffer;
    const bytes = await toBuffer(qr,{width:480,margin:2});
    const options = { caption:formatTelegramMessage(caption),parseMode:'HTML',signal:abort.signal };
    return messageId ? editPhotoBuffer(token,chatId,messageId,bytes,options) : sendPhotoBuffer(token,chatId,bytes,options);
  },
  removeMessage:(chatId,messageId) => deleteTelegramMessage(token,chatId,messageId,{signal:abort.signal})
});
const joinRunner = new AutoJoinRunner({ databasePath, manager:whatsapp, onUpdate:id=>joinFlow.updateLive(id) });
const joinFlow = new AutoJoinFlow({
  databasePath, manager:whatsapp, runner:joinRunner,
  send:(chatId,text)=>sendScreen(chatId,text),
  edit:(chatId,messageId,text)=>editMessageText(token,chatId,messageId,formatTelegramMessage(text),{parseMode:'HTML',signal:abort.signal}),
  readDocument:async doc=>{
    const info=await getFileInfo(token,doc.fileId,{signal:abort.signal});
    if(Number(info.fileSize||0)>1024*1024)throw new Error('Had fail TXT ialah 1 MB.');
    return downloadTelegramFile(token,info.filePath,{signal:abort.signal});
  }
});
const groupFlow=new GroupFlow({databasePath,manager:whatsapp,accountsFlow:accountFlow,
 send:(chatId,text)=>sendScreen(chatId,text),
 edit:(chatId,messageId,text)=>editMessageText(token,chatId,messageId,formatTelegramMessage(text),{parseMode:'HTML',signal:abort.signal})
});
accountFlow.groupFlow=groupFlow;
const memberExportFlow=new MemberExportFlow({databasePath,manager:whatsapp,
 send:(chatId,text)=>sendScreen(chatId,text),
 edit:(chatId,messageId,text)=>editMessageText(token,chatId,messageId,formatTelegramMessage(text),{parseMode:'HTML',signal:abort.signal}),
 document:(chatId,file,options)=>sendDocumentBuffer(token,chatId,file.buffer,{filename:file.filename,mimeType:file.mimeType,caption:options.caption,signal:AbortSignal.any([abort.signal,options.signal])})
});
recoverFollowup(databasePath,ownerId);
const followupRunner=new FollowupRunner({databasePath,owner:ownerId,manager:whatsapp,onUpdate:id=>followupFlow.update(id)});
const followupFlow=new FollowupFlow({databasePath,owner:ownerId,manager:whatsapp,runner:followupRunner,
 send:(chat,text)=>sendScreen(chat,text),
 edit:(chat,id,text)=>editMessageText(token,chat,id,formatTelegramMessage(text),{parseMode:'HTML',signal:abort.signal}),
 readDocument:async doc=>{const info=await getFileInfo(token,doc.fileId,{signal:abort.signal});if(Number(info.fileSize)>1024*1024)throw Error('Had TXT ialah 1 MB.');return downloadTelegramFile(token,info.filePath,{signal:abort.signal,timeoutMs:30000});},
 saveMedia:async(route,job,kind)=>{
  const media=await savePostingMedia(route,{id:job.id},1,kind);
  const dir=join(projectRoot,'media','followup',`fu-${job.id}`);mkdirSync(dir,{recursive:true,mode:0o700});
  const filename=media.mediaPath.split('/').pop();renameSync(join(projectRoot,media.mediaPath),join(dir,filename));
  return {...media,mediaPath:`media/followup/fu-${job.id}/${filename}`};
 },
 preview:async(chat,ad)=>{
  const caption=ad.body,replyMarkup=ad.buttons?.length?{inline_keyboard:ad.buttons.map(b=>[{text:b.label,url:b.url}])}:undefined;
  if(ad.kind==='TEXT')return sendMessage(token,chat,caption,{replyMarkup,signal:abort.signal});
  const buffer=readFileSync(join(projectRoot,ad.mediaPath));
  return ad.kind==='PHOTO'?sendPhotoBuffer(token,chat,buffer,{caption,replyMarkup,signal:abort.signal}):sendVideoBuffer(token,chat,buffer,{caption,replyMarkup,signal:abort.signal});
 },
 document:(chat,file)=>sendDocumentBuffer(token,chat,file.buffer,{filename:file.filename,mimeType:file.mimeType,signal:abort.signal})
});
const restoredPostingInput=readPostingFlowState(databasePath,'input:'+ownerId);
let pendingInput = restoredPostingInput?.pendingInput||null;
let postingUi = restoredPostingInput?.postingUi||null;
let postingScreen = restoredPostingInput?.postingScreen||null;
const postingLive = new PostingLive({databasePath,projectRoot,manager:whatsapp,
 send:(chatId,text,options={})=>sendMessage(token,chatId,formatTelegramMessage(text),{...options,parseMode:'HTML',signal:abort.signal}),
 edit:(chatId,messageId,text)=>editMessageText(token,chatId,messageId,formatTelegramMessage(text),{parseMode:'HTML',signal:abort.signal}),
 startScheduler:chatId=>{ensurePostingScheduler(chatId);},
 resolvePosting:()=>postingUi?.postingId?getPosting(databasePath,postingUi.postingId):getUnstartedPosting(databasePath)
});
const clientFlow = new ClientFlow({databasePath,clientsDbPath,send:sendScreen,postingLive,
 beginClient:async(chatId,client)=>{pendingInput={type:'posting_name',chatId,ownerType:'CLIENT',clientId:client.id};postingUi=null;return sendScreen(chatId,postingClientNameMessage(client));}
});
postingLive.review=(chatId,id)=>showPostingReview(chatId,id);
const gsRunners = new Map();
const gsLiveMessages = new Map();
const postingWorkerTasks = new Map();
const postingReportTasks = new Set();
let postingSchedulerTask = null;
let postingMaintenanceTask = null;
let filteredWhatsAppNoise = 0;
let sessionWarningWindow = [];
let sessionWarningsSinceLog = 0;
let lastSessionWarningAt = 0;
let lastSessionWarningKind = '-';
let lastSessionLogAt = 0;
function recordSessionWarning(kind = 'SESSION') {
  const now = Date.now();
  lastSessionWarningAt = now;
  lastSessionWarningKind = String(kind || 'SESSION').toUpperCase();
  sessionWarningWindow.push(now);
  sessionWarningWindow = sessionWarningWindow.filter(time => now - time <= 60000);
  sessionWarningsSinceLog += 1;

  // Diagnostic sahaja. Jangan jadikan setiap line libsignal sebagai status
  // kegagalan akaun; connection health datang daripada socket sebenar.
  if (lastSessionLogAt && now - lastSessionLogAt < 30000) return;
  lastSessionLogAt = now;
  try {
    const file = join(projectRoot, 'logs', 'session-warnings.log');
    mkdirSync(join(projectRoot, 'logs'), { recursive: true, mode: 0o700 });
    try { if (statSync(file).size > 1048576) renameSync(file, file + '.1'); } catch {}
    appendFileSync(file, JSON.stringify({
      time: new Date().toISOString(),
      event: 'signal_diagnostic',
      kind: lastSessionWarningKind,
      recent60s: sessionWarningWindow.length,
      sinceLastLog: sessionWarningsSinceLog
    }) + '\n', { mode: 0o600 });
    sessionWarningsSinceLog = 0;
  } catch { lastError = 'Log session gagal ditulis'; }
}
function friendlyUserError(error, fallback = 'Operasi tidak berjaya. Cuba semula.') {
  const raw = String(error?.message || error || '').trim();
  const value = raw.toLowerCase();
  if (/belum online|tiada connection|logged out|disconnected|connection.*closed|socket.*closed/u.test(value)) return 'Sambungan WhatsApp terganggu.';
  if (/timeout|timed out|network|econnreset|eai_again|enetunreach|temporary/u.test(value)) return 'Sambungan sementara terganggu.';
  if (/invalid|expired|revoked|not found/u.test(value)) return 'Data tidak sah / tamat tempoh.';
  return fallback;
}

const originalStderrWrite = process.stderr.write.bind(process.stderr);
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
let signalNoiseBurstUntil = 0;
let signalStdoutNoiseUntil = 0;

function isKnownWhatsAppNoiseLine(line = '') {
  const value = String(line);
  if (/Over 2000 messages into the future/i.test(value)) {
    recordSessionWarning('COUNTER_GAP');
    signalNoiseBurstUntil = Date.now() + 1500;
    filteredWhatsAppNoise += 1;
    return true;
  }
  const trigger = /Failed to decrypt message with any known session|Session error:.*Bad MAC|Bad MAC Error/i.test(value);
  if (trigger) {
    recordSessionWarning(/Bad MAC/i.test(value) ? 'BAD_MAC' : 'DECRYPT');
    signalNoiseBurstUntil = Date.now() + 1500;
    filteredWhatsAppNoise += 1;
    return true;
  }
  const stackNoise = /node_modules\/(?:libsignal|@whiskeysockets\/baileys\/lib\/Utils\/queue-job)|SessionCipher|decryptWhisperMessage|decryptWithSessions|verifyMAC/i.test(value);
  if (stackNoise && Date.now() < signalNoiseBurstUntil) {
    filteredWhatsAppNoise += 1;
    return true;
  }
  return false;
}

function isKnownWhatsAppStdoutNoise(chunk = '') {
  const value = String(chunk || '');

  // libsignal sometimes bypasses the Baileys/pino logger and writes a complete
  // SessionEntry dump through console/stdout. It is diagnostic noise only and
  // may contain raw ratchet/key buffers, so never expose it in the user panel.
  const closingSession = /Closing stale open session for new outgoing prekey bundle|Closing session:\s*SessionEntry\s*\{/i.test(value);
  if (closingSession) {
    signalStdoutNoiseUntil = Date.now() + 250;
    filteredWhatsAppNoise += 1;
    return true;
  }

  // Guard the unlikely case where Node splits the same util.inspect output
  // across writes. Only swallow unmistakable Signal-session fragments and
  // only immediately after the trigger above; normal WAPromoBot UI is kept.
  if (Date.now() < signalStdoutNoiseUntil
      && /(?:_chains|currentRatchet|ephemeralKeyPair|lastRemoteEphemeralKey|remoteIdentityKey|pendingPreKey|signedKeyId|preKeyId|registrationId|chainKey|baseKeyType)\s*:/i.test(value)) {
    filteredWhatsAppNoise += 1;
    return true;
  }

  return false;
}

function finishFilteredWrite(encoding, callback) {
  if (typeof encoding === 'function') encoding();
  else if (typeof callback === 'function') callback();
  return true;
}

function installWhatsAppNoiseFilter() {
  process.stderr.write = function filteredStderr(chunk, encoding, callback) {
    const raw = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8') : String(chunk);
    const kept = raw.split(/(?<=\n)/).filter(part => !isKnownWhatsAppNoiseLine(part)).join('');
    if (!kept) return finishFilteredWrite(encoding, callback);
    if (typeof encoding === 'function') return originalStderrWrite(kept, encoding);
    return originalStderrWrite(kept, encoding, callback);
  };

  process.stdout.write = function filteredStdout(chunk, encoding, callback) {
    const raw = Buffer.isBuffer(chunk) ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8') : String(chunk);
    if (isKnownWhatsAppStdoutNoise(raw)) return finishFilteredWrite(encoding, callback);
    if (typeof encoding === 'function') return originalStdoutWrite(raw, encoding);
    return originalStdoutWrite(raw, encoding, callback);
  };
}

function restoreWhatsAppNoiseFilter() {
  process.stderr.write = originalStderrWrite;
  process.stdout.write = originalStdoutWrite;
}

installWhatsAppNoiseFilter();

whatsapp.on('error', ({ account, error }) => {
  lastError = `WA ${account?.id || '-'}: ${String(error?.message || 'error').slice(0, 18)}`;
});

renderStarting('Telegram siap · WhatsApp sedang dipulihkan...');
await whatsapp.start();
const recoveredJoin = recoverAutoJoinJobs(databasePath);
if(recoveredJoin.pausedJobs || recoveredJoin.uncertainTargets) {
  await sendScreen(ownerId,`🔄 AUTO JOIN DIPULIHKAN\n\n⏸ Job dipulihkan sebagai Dijeda.\nPermintaan terganggu selepas dihantar direkodkan sebagai Belum Pasti.\n\n📁 ↳ .join-list → Pilih & Semak Job\n▶️ ↳ .join-resume → Sambung Job Pilihan`).catch(()=>{});
}
recoverPostingJobs(databasePath);
recoverGsJobs(databasePath);
ensurePostingScheduler(ownerId);

function render() {
  const width = printHeader('TELEGRAM CONTROLLER', 'Owner-only Remote Control');
  console.log(row('', width));
  console.log(cyan(row('LIVE STATUS', width)));
  console.log(green(row('Controller   ● ONLINE', width)));
  const telegramMode = telegramTransportState(telegramFailureStreak);
  const telegramState = telegramMode === 'CONNECTED' ? '● CONNECTED'
    : telegramMode === 'DEGRADED' ? '● DEGRADED' : '● RECONNECTING';
  const telegramPaint = telegramMode === 'CONNECTED' ? green : yellow;
  console.log(telegramPaint(row(`Telegram     ${telegramState}`, width)));
  const accounts = whatsapp.list();
  const health = whatsapp.healthSummary();
  console.log(row(`WhatsApp     ${health.online}/${accounts.length} ONLINE`, width));
  const healthText = health.state === 'OPERATIONAL' ? '● OPERATIONAL'
    : health.state === 'RECOVERING' ? '● RECOVERING'
      : health.state === 'DEGRADED' ? '● DEGRADED' : '● OFFLINE';
  const healthPaint = health.state === 'OPERATIONAL' ? green : (health.state === 'RECOVERING' ? yellow : red);
  console.log(healthPaint(row(`Health       ${healthText}`, width)));
  console.log(row(`Uptime       ${formatUptime(Date.now() - controllerStartedAt)}`, width));
  console.log((wakeLockActive ? green : yellow)(row(`Keep Alive   ${wakeLockActive ? '● ACTIVE' : '● OS MANAGED'}`, width)));
  console.log(row(`Bot          ${bot.username ? '@' + bot.username : bot.firstName}`, width));
  console.log(row(`Owner ID     ${ownerId}`, width));
  console.log(row(`Processed    ${processed}`, width));
  console.log(row(`Ignored      ${ignored}`, width));
  console.log(row(`Activity     ${lastAction}`, width));
  if (telegramFailureStreak >= 2 && telegramRetryInSec > 0) console.log(yellow(row(`Retry        automatik · ${telegramRetryInSec}s`, width)));
  if (telegramFailureStreak >= 2 && lastError !== '-') console.log(yellow(row(`Last Error   ${lastError}`, width)));
  console.log(row('', width));
  console.log(cyan(divider(width)));
  console.log(dim(row('Kawal dari Telegram menggunakan menu bot.', width)));
  console.log(dim(row('Tekan Q untuk kembali ke Control Panel.', width)));
  console.log(row('', width));
  printFooter(`Build ${build} • ${stage}`, width);
}

function renderStopping(step = 'Menyimpan progress & menutup sambungan...') {
  const width = printHeader('TELEGRAM CONTROLLER', 'Owner-only Remote Control');
  console.log(row('', width));
  console.log(cyan(row('SHUTDOWN', width)));
  console.log(yellow(row('Controller   ● STOPPING', width)));
  console.log(row(`Status       ${step}`, width));
  console.log(row('', width));
  console.log(cyan(divider(width)));
  console.log(dim(row('Sila tunggu sebentar. Akan kembali ke Control Panel.', width)));
  console.log(row('', width));
  printFooter(`Build ${build} • ${stage}`, width);
}

function requestStop(reason = 'USER') {
  if (stopRequested) return;
  stopRequested = true;
  running = false;
  joinRunner.close();
  joinFlow.close();
  groupFlow.close();
  memberExportFlow.close();
  followupFlow.close();
  postingLive.close();closeSystemFlow();miniApp?.close();
  closeGsLive();
  clientFlow.close();
  lastAction = 'STOPPING';
  if (panelTimer) {
    clearInterval(panelTimer);
    panelTimer = null;
  }
  renderStopping(reason === 'USER' ? 'Kembali ke Control Panel...' : 'Menutup Controller dengan selamat...');
  abort.abort();

  // Guard terakhir: jika library/network meninggalkan handle aktif, jangan biar
  // Termux kelihatan stuck. Cleanup normal tetap diberi peluang dahulu.
  shutdownFallback = setTimeout(() => process.exit(0), 2500);
}

async function sendScreen(chatId, text, replyMarkup) {
  return sendMessage(token, chatId, formatTelegramMessage(text), { parseMode: 'HTML', replyMarkup, signal: abort.signal });
}


// Group Status is an independent, sequential job. Never fall back to normal chat sends.
let gsContext=readPostingFlowState(databasePath,'gs-context')||{};
let systemFlow=null,systemTimer=null,systemTickBusy=false,systemDiskWarned=false;
let miniApp=null;
function ensureMiniApp(){if(!miniApp)miniApp=new MiniAppController({projectRoot,databasePath,clientsDbPath,manager:whatsapp,postingLive,joinRunner,joinFlow,gsRunners,beginGsRunner,gsRefresh:gsRender,gsReport:deliverGsReport,forgetGs:id=>{gsLiveMessages.delete(id);gsLive?.forget(id);if(Number(gsContext.jobId)===id){gsContext.jobId=null;gsContext.stage=null;saveGsContext();}},ownerId,token,build,memberExportFlow,followupRunner,followupFlow,botName:bot?.username||'',system:ensureSystemFlow,send:sendScreen});return miniApp;}

function ensureSystemFlow(){if(systemFlow)return systemFlow;systemFlow=new SystemFlow({root:projectRoot,databasePath,send:sendScreen,accounts:()=>listWhatsAppAccounts(databasePath),build});return systemFlow;}
function startSystemMaintenance(){policyDb(databasePath,db=>{for(const [kind,table] of [['post','posting_jobs'],['gs','group_status_jobs']])for(const j of db.prepare('SELECT id FROM '+table).all())capturePolicy(db,kind,j.id);});systemTimer=setInterval(()=>{if(systemTickBusy)return;systemTickBusy=true;const low=!diskReady(databasePath);if(low!==systemDiskWarned){systemDiskWarned=low;sendScreen(ownerId,low?'⚠️ RUANG PERANTI RENDAH\nPenghantaran baharu ditangguhkan. Semak .storage.':'✅ RUANG PERANTI MENCUKUPI\nPenghantaran boleh mengambil giliran semula.').catch(()=>{});}retryGsReports().then(()=>ensureSystemFlow().tick()).catch(()=>{}).finally(()=>systemTickBusy=false);},60000);systemTimer.unref?.();}
function closeSystemFlow(){if(systemTimer)clearInterval(systemTimer);systemTimer=null;systemFlow?.close();}
async function deliverGsReport(chat,id){
 policyDb(databasePath,db=>db.prepare('INSERT INTO system_gs_report_outbox(id) VALUES(?) ON CONFLICT(id) DO UPDATE SET sent=0').run(id));
 try{const result=await sendScreen(chat,gsReportMessage(gsView(gsSnapshot(databasePath,id)),gsAccountStats(databasePath,id)));policyDb(databasePath,db=>db.prepare('UPDATE system_gs_report_outbox SET sent=1 WHERE id=?').run(id));try{archiveGs(databasePath,id);}catch{}return result;}
 catch(e){policyDb(databasePath,db=>db.prepare('UPDATE system_gs_report_outbox SET attempts=attempts+1,next_at=? WHERE id=?').run(Date.now()+300000,id));throw e;}
}
async function retryGsReports(){const rows=policyDb(databasePath,db=>db.prepare('SELECT * FROM system_gs_report_outbox WHERE next_at<=? ORDER BY next_at LIMIT 3').all(Date.now()));for(const row of rows){const job=getGsJob(databasePath,row.id);if(!job||!['STOPPED','COMPLETED'].includes(job.status)){policyDb(databasePath,db=>db.prepare('DELETE FROM system_gs_report_outbox WHERE id=?').run(row.id));continue;}if(row.sent){archiveGs(databasePath,row.id);policyDb(databasePath,db=>db.prepare('UPDATE system_gs_report_outbox SET next_at=? WHERE id=?').run(Date.now()+600000,row.id));}else if(row.attempts<5){await deliverGsReport(ownerId,row.id).catch(()=>{});}else policyDb(databasePath,db=>db.prepare('UPDATE system_gs_report_outbox SET next_at=? WHERE id=?').run(Date.now()+3600000,row.id));}}

let campaignHub=null;
function ensureCampaignHub(){
 if(campaignHub)return campaignHub;
 campaignHub=new CampaignHub({databasePath,post:postingLive,send:sendScreen,account:id=>whatsapp.get(id),gsShow:async(id,chat)=>{openGs(id);return gsShow(id,chat);},gsAction:async(id,route)=>{openGs(id);return dispatch({...route,hubBypass:true});}});
 postingLive.decorate=(id,text)=>campaignHub.decorate('post',id,text);
 postingLive.feedback=id=>campaignHub.feedback('post',id);
 postingLive.afterDelete=(chat,id)=>campaignHub.afterDelete(chat,'post',id);
 postingLive.cancelDelete=chat=>campaignHub.cancelDelete(chat);
 return campaignHub;
}
function saveGsContext(){savePostingFlowState(databasePath,'gs-context',gsContext);}
function openGs(id){gsContext.jobId=Number(id);gsCaptureNumbers();return getGsJob(databasePath,id);}
function gsView(job){if(!job)return job;const jobs=listAllGsJobs(databasePath).slice().reverse();const labels={};for(const [index,a] of listWhatsAppAccounts(databasePath).entries())labels[a.id]=`Akaun ${index+1} · WhatsApp …${String(a.phone||'').slice(-4)}`;return {...job,displayNumber:jobs.findIndex(x=>x.id===job.id)+1,accountLabels:labels};}
function currentGs(value=0){const choice=resolveGsSelection(listAllGsJobs(databasePath).slice().reverse(),gsContext,value);if(!choice.id)return null;const job=getGsJob(databasePath,choice.id);if(value&&job)openGs(job.id);return job;}
function gsCaptureNumbers(){gsContext.numbers=listAllGsJobs(databasePath).slice().reverse().map(x=>x.id);saveGsContext();}
function gsListScreen(chatId){gsCaptureNumbers();if(!listAllGsJobs(databasePath).slice().reverse().length)return sendScreen(chatId,'📁 SENARAI AUTO STATUS GROUP\n↳ Tiada kempen tersimpan.\n\n➕ ↳ .gs-new → Cipta Status\n↩️ ↳ .group-status → Menu Auto Status');return sendScreen(chatId,'📁 SENARAI AUTO STATUS GROUP\n↳ Buka atau padam kempen daripada senarai ini.\n\n'+listAllGsJobs(databasePath).slice().reverse().slice(0,30).map((j,i)=>`${i+1}. Auto Status ${i+1} · ${j.status}\n↳ ${j.kind==='PHOTO'?'Gambar + Caption':j.kind==='TEXT'?'Teks':'Draf belum lengkap'} · ${String(j.body||'').replace(/\s+/g,' ').slice(0,55)}\n📊 ↳ .gs-status ${i+1} → Buka Kempen ${i+1}\n${j.status==='RUNNING'?`⏹ ↳ .gs-stop ${i+1} → Hentikan Sebelum Padam`:`🗑 ↳ .gs-delete ${i+1} → Padam Kempen`}`).join('\n\n')+'\n\n↩️ ↳ .group-status → Menu Auto Status');}
function gsDraft(){return listAllGsJobs(databasePath).slice().reverse().find(x=>['DRAFT','READY'].includes(x.status));}
function gsAccountsScreen(job,chatId){openGs(job.id);gsContext.stage='accounts';gsContext.accounts=listWhatsAppAccounts(databasePath).map(a=>a.id);saveGsContext();pendingInput={type:'gs_accounts_input',chatId,jobId:job.id};return sendScreen(chatId,gsAccountPrompt(gsView(job),listWhatsAppAccounts(databasePath)));}
function gsSettingsScreen(job,chatId){gsContext.stage='settings';saveGsContext();return sendScreen(chatId,gsSettingMessage(gsView(job)));}
function gsSelectAllOnline(jobId) {
  const online=listWhatsAppAccounts(databasePath).filter(a=>a.status==='ONLINE' && whatsapp.get(a.id)?.status==='ONLINE');
  if(!online.length)throw new Error('Tiada akaun WhatsApp ONLINE. Semak .accounts.');
  setGsAccounts(databasePath,jobId,online.map(a=>a.id));
  // ALL is all locally synced, available groups, not a verified group-status eligibility check.
  return prepareGsTargets(databasePath,jobId,{mode:'ALL'});
}

let gsLive=null,gsLivePulse=null;
function ensureGsLive(){
 if(gsLive)return gsLive;
 gsLive=new GroupStatusLive({
  readJob:id=>gsSnapshot(databasePath,id),
  render:id=>{const text=gsDashboard(gsView(gsSnapshot(databasePath,id)),listGsRecent(databasePath,id,10),gsAccountProgress(databasePath,id));return formatTelegramMessage(campaignHub?campaignHub.decorate('gs',id,text):text);},
  load:id=>readPostingFlowState(databasePath,'gs-live:'+id),
  save:(id,ref)=>savePostingFlowState(databasePath,'gs-live:'+id,ref),
  send:(chat,text,options={})=>sendMessage(token,chat,text,{parseMode:'HTML',...options,signal:abort.signal}),
  edit:(chat,messageId,text)=>editMessageText(token,chat,messageId,text,{parseMode:'HTML',signal:abort.signal}),
  feedback:id=>{const j=gsView(gsSnapshot(databasePath,id));const done=j.accepted+j.skipped+j.failed+j.unknown;const state={RUNNING:'BERJALAN',PAUSED:'DIJEDA',STOPPED:'DIHENTIKAN',COMPLETED:'SELESAI',READY:'SEDIA',DRAFT:'DRAF'}[j.status]||j.status;return formatTelegramMessage(gsHubText(id,`📊 AUTO STATUS ${j.displayNumber} · ${state}\n↳ Selesai proses ${done}/${j.total} · Baki ${j.pending}\n↳ Tekan mesej rujukan di atas untuk dashboard live.\n\n📄 ↳ .gs-report ${j.displayNumber} → Laporan\n📁 ↳ .gs-posts ${j.displayNumber} 1 → Rekod Penghantaran`));}
 });
 gsLivePulse=setInterval(()=>gsLive?.pulse(),5000);gsLivePulse.unref?.();
 return gsLive;
}
function gsHubText(id,text){return campaignHub?(text.includes('Tekan mesej rujukan')?campaignHub.feedback('gs',id):campaignHub.decorate('gs',id,text)):text;}
function closeGsLive(){if(gsLivePulse)clearInterval(gsLivePulse);gsLivePulse=null;gsLive?.close();}
async function gsRender(id,chatId,{forceNew=false}={}){ensureGsLive().refresh(id,chatId,{force:forceNew});}
async function gsShow(id,chatId){return ensureGsLive().show(id,chatId);}
async function gsSleep(ms,id){
  let left=ms;
  while(left>0&&running&&!abort.signal.aborted){
    const j=getGsJob(databasePath,id);if(j?.status!=='RUNNING')return false;
    const amount=Math.min(left,1000);await sleep(amount);left-=amount;
  }
  return running&&!abort.signal.aborted;
}
function beginGsRunner(id,chatId){
  id=Number(id);if(gsRunners.has(id))return;
  const task=(async()=>{
    let unknownStreak=0;
    try{
      while(running&&!abort.signal.aborted){
        const job=getGsJob(databasePath,id);if(!job||job.status!=='RUNNING')return;
        // Restore persisted pacing after restart/pause: never bypass a due REST.
        const waitMs=gsNextWaitMs(databasePath,id);
        if(waitMs===null)return;
        if(waitMs>0){if(!await gsSleep(Math.min(waitMs,2000),id))return;continue;}
        const target=claimGsNext(databasePath,id);
        if(!target){
          const check=gsSnapshot(databasePath,id);
          if(check?.pending>0){
            const progress=gsAccountProgress(databasePath,id);
            // All remaining accounts can be blocked by repeated failures; no busy-loop.
            if(progress.some(a=>a.pending>0 && !a.blockedAt)){
              if(!await gsSleep(1000,id))return;
              continue;
            }
            setGsStatus(databasePath,id,'PAUSED');
            await gsRender(id,chatId,{forceNew:true}).catch(()=>{});
            await sendScreen(chatId,`⚠️ AUTO STATUS ${gsView(getGsJob(databasePath,id))?.displayNumber||'?'} · SEMAK AKAUN\nSemua akaun dengan baki kerja kini DIJEDA kerana ralat berulang. Akaun lain yang sihat telah diproses.\n\n→ .gs-status\n→ .gs-report\n↳ Selepas semakan: .gs-account-retry N`).catch(()=>{});
            return;
          }
          setGsStatus(databasePath,id,'COMPLETED');await gsRender(id,chatId,{forceNew:true}).catch(()=>{});await deliverGsReport(chatId,id).catch(()=>{});return;
        }
        const account=whatsapp.get(target.account_id);
        if(!account||account.status!=='ONLINE'){
          // No send was attempted. Keep this group's queue intact; other accounts can continue.
          requeueGsUnsent(databasePath,target.id,60);
          const active=gsAccountProgress(databasePath,id).filter(a=>a.pending>0);
          if(!active.some(a=>whatsapp.get(a.accountId)?.status==='ONLINE')){
            setGsStatus(databasePath,id,'PAUSED');
            await sendScreen(chatId,`⚠️ AUTO STATUS ${gsView(getGsJob(databasePath,id))?.displayNumber||'?'} DIJEDA\nSemua akaun berbaki OFFLINE. Tiada penghantaran dicuba.\n\n→ .accounts\n→ .gs-resume`).catch(()=>{});
            return;
          }
          await gsRender(id,chatId).catch(()=>{});
          continue;
        }
        let outcome='UNKNOWN',messageId='',errorText='',ackStatus='NOT_OBSERVED',ackSource='NONE',unsupportedProtocol=false;
        try{
          const result=await whatsapp.sendGroupStatus(target.account_id,target.group_jid,{kind:job.kind,body:job.body,mediaPath:job.media_path,mediaMime:job.media_mime});
          messageId=result.messageId;
          ackStatus=result.serverAck||'NOT_OBSERVED';ackSource=result.ackSource||'NONE';
          outcome=ackStatus==='OK'?'ACCEPTED':'UNKNOWN';
          errorText=ackStatus==='OK'?'ACK OK - DISPLAY NOT VERIFIED':`ACK ${ackStatus} - DISPLAY NOT VERIFIED`;
        }catch(error){
          outcome=classifyGsError(error);
          ackStatus=error?.serverAck?`REJECTED ${String(error.serverAck).slice(0,12)}`:'EXCEPTION';ackSource=error?.ackSource||'NONE';
          errorText=String(error.message||error).slice(0,240);
          if(outcome==='UNSUPPORTED'){unsupportedProtocol=true;outcome='UNKNOWN';}
          if(error?.code==='GS_SERVER_REJECTED' && ['479','403'].includes(String(error?.serverAck))) {
            // Unlike the old blanket 479 pause, diagnose THIS group first.
            // Never assume that every 479 is simply an admin-only group.
            const check=await whatsapp.diagnoseGroupStatusFailure(target.account_id,target.group_jid);
            const decision=classifyGsGroupRejection(check,String(error.serverAck));
            outcome=decision.outcome;
            errorText=`${errorText} | ${decision.diagnostic}: ${check.note}`.slice(0,240);
          }
        }
        // A missing/corrupt shared campaign media file is not a group-level failure.
        // No relay occurred in this branch. Keep the target pending and halt the job
        // for operator repair instead of consuming every group's attempt.
        if (ackStatus==='EXCEPTION' && /(?:Media Group Status tidak ditemui|Media melebihi 20 MB|Laluan media Status tidak sah|Media Status kosong)/iu.test(errorText)) {
          requeueGsUnsent(databasePath,target.id,60);
          setGsStatus(databasePath,id,'PAUSED');
          await sendScreen(chatId,`⚠️ AUTO STATUS ${gsView(getGsJob(databasePath,id))?.displayNumber||'?'} · BAHAN BERMASALAH\n${errorText}\n\n↳ Tiada cubaan dihantar untuk group ini.\n↳ Baiki bahan dahulu sebelum sambung.\n→ .gs-status`).catch(()=>{});
          return;
        }
        const saved=finishGsTarget(databasePath,target.id,outcome,messageId,`SERVER ACK ${ackStatus} (${ackSource}) ${errorText}`.slice(0,280));
        if(!saved)return; // stopped while network request was in-flight; do not resurrect job.
        // An isolated 479 is a FAILED *group*, not evidence that all groups are prohibited.
        // Never retry it automatically: the server may have emitted an ambiguous result.
        const fault=unsupportedProtocol?'UNSUPPORTED':
          outcome==='FAILED'?`REJECTED:${ackStatus.replace(/^REJECTED\s*/, '').slice(0,16)}`:
          outcome==='UNKNOWN'?'UNKNOWN':'';
        const health=gsRecordAccountHealth(databasePath,id,target.account_id,fault);
        if(health?.blocked){
          await sendScreen(chatId,[`⚠️ AUTO STATUS ${gsView(getGsJob(databasePath,id))?.displayNumber||'?'} · AKAUN DIJEDA`,`Akaun : ${target.account_id}`,
            `Ralat : ${health.fault} (${health.streak} berturut-turut)`,
            `Group terakhir : ${String(target.group_name||'-').slice(0,65)}`,
            '',`↳ Group gagal direkod, TIDAK dihantar semula automatik.`,
            `↳ Akaun lain terus berjalan mengikut giliran.`,
            `↳ Selepas semakan jika perlu: .gs-account-retry ${accountNumber(whatsapp.get(target.account_id))}`,
            '',`→ .gs-status`].join('\n')).catch(()=>{});
        }
        const after=gsSnapshot(databasePath,id);
        await gsRender(id,chatId).catch(()=>{});
        if(!after||after.status!=='RUNNING')return;
        if(after.pending===0&&after.inFlight===0){setGsStatus(databasePath,id,'COMPLETED');await gsRender(id,chatId,{forceNew:true}).catch(()=>{});await deliverGsReport(chatId,id).catch(()=>{});return;}
        // Next delay/rest is transactionally persisted by finishGsTarget().
        // Loop checks next_run_at on every iteration, allowing PAUSE / STOP.
      }
    }catch(error){
      try{const j=getGsJob(databasePath,id);if(j?.status==='RUNNING')setGsStatus(databasePath,id,'PAUSED');}catch{}
      await sendScreen(chatId,`⚠️ GROUP STATUS DIJEDA\n${String(error.message||error).slice(0,200)}\n\n→ .gs-status ${gsView(getGsJob(databasePath,id))?.displayNumber||1}`).catch(()=>{});
    }finally{gsRunners.delete(id);}
  })();
  gsRunners.set(id,task);task.catch(()=>{});
}
async function saveGsMedia(route,job,kind){
  const source=route.media||route.document||{};
  const cap=String(route.text||'');if(Array.from(cap).length>500)throw new Error('Caption maksimum 500 aksara.');
  if(Number(source.fileSize||0)>20*1024*1024)throw new Error('Had media 20 MB.');
  const declared=String(source.mimeType||'').toLowerCase();
  if(kind==='VIDEO'&&declared!=='video/mp4')throw new Error('Gunakan video MP4 sahaja.');
  if(kind==='PHOTO'&&declared&&!['image/jpeg','image/png'].includes(declared))throw new Error('Gambar mesti JPEG/PNG.');
  const info=await getFileInfo(token,source.fileId,{signal:abort.signal});
  if(Number(info.fileSize||0)>20*1024*1024)throw new Error('Fail melebihi 20 MB.');
  const buffer=await downloadTelegramFile(token,info.filePath,{signal:abort.signal,timeoutMs:30000});
  if(!buffer.length||buffer.length>20*1024*1024)throw new Error('Fail media kosong atau terlalu besar.');
  const jpeg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
  const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const mp4=buffer.subarray(4,8).toString('ascii')==='ftyp';
  if(kind==='PHOTO'&&!jpeg&&!png)throw new Error('Data gambar bukan JPEG/PNG yang sah.');
  if(kind==='VIDEO'&&!mp4)throw new Error('Data video bukan MP4.');
  const mime=kind==='PHOTO'?(jpeg?'image/jpeg':'image/png'):'video/mp4';
  const ext=kind==='VIDEO'?'.mp4':jpeg?'.jpg':'.png';
  const dir=join(projectRoot,'media','group-status',`gs-${job.id}`);mkdirSync(dir,{recursive:true,mode:0o700});
  const file=`status-${randomUUID().slice(0,12)}${ext}`,absolute=join(dir,file),temp=absolute+'.tmp';
  try{writeFileSync(temp,buffer,{mode:0o600});renameSync(temp,absolute);}
  finally{try{unlinkSync(temp);}catch{}}
  return {kind,body:cap,mediaPath:`media/group-status/gs-${job.id}/${file}`,mediaMime:mime};
}
async function saveGsInput(route,kind){
  if(pendingInput?.type!=='gs_content'||String(pendingInput.chatId)!==String(route.chatId))return false;
  const job=getGsJob(databasePath,pendingInput.jobId);if(!job)throw new Error('Job sudah tiada.');
  let content;
  if(kind==='TEXT'){
    const body=String(route.text||'').trim();if(!body)throw new Error('Teks tidak boleh kosong.');
    content={kind:'TEXT',body};
  }else content=await saveGsMedia(route,job,kind);
  // Old media remains if cloned by RUN AGAIN; media cleanup only on delete of last reference.
  const result=setGsContent(databasePath,job.id,content);
  pendingInput=null;
  try {
    const ids=JSON.parse(result.selected_accounts||'[]');
    if(!ids.length){
      await sendScreen(route.chatId,gsAccountPrompt(result,listWhatsAppAccounts(databasePath)));
    }else{
      const planned=prepareGsTargets(databasePath,result.id,{mode:'ALL'});
      await gsSettingsScreen(planned,route.chatId);
    }
  } catch(error) {
    await sendScreen(route.chatId,`⚠️ AUTO STATUS ${gsView(result).displayNumber}: Kandungan disimpan, tetapi sasaran belum tersedia.\n${String(error.message||error).slice(0,180)}\n\n→ .gs-accounts`);
  }
  return true;
}
async function gsPreview(chatId,id,{showMedia=true}={}){
  const j=gsSnapshot(databasePath,id);if(!j)return sendScreen(chatId,'Job GS tidak ditemui.');
  if(showMedia && j.media_path&&['PHOTO','VIDEO'].includes(j.kind)){
    const filename=join(projectRoot,j.media_path);
    try{
      if(j.kind==='PHOTO')await sendPhotoBuffer(token,chatId,readFileSync(filename),{mimeType:j.media_mime,caption:(j.body||'').slice(0,500),signal:abort.signal});
      else await sendVideoBuffer(token,chatId,readFileSync(filename),{mimeType:'video/mp4',caption:(j.body||'').slice(0,500),signal:abort.signal});
    }catch(error){await sendScreen(chatId,`⚠️ Media preview: ${String(error.message||error).slice(0,100)}`);}
  }else if(showMedia && j.kind==='TEXT')await sendScreen(chatId,'📝 CONTOH TEKS\n'+j.body);
  return sendScreen(chatId,gsPreviewMessage(gsView(j),gsAccountStats(databasePath,id)));
}
function formatMalaysiaDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  }).format(date);
}

function safeReportName(value = '') {
  return String(value || 'Campaign').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'Campaign';
}

function buildCampaignReportText(snapshot) {
  const { job, accountStats = [], attempts = [], ads = [] } = snapshot || {};
  if (!job) return '';
  const mode = job.targetMode === 'SUCCESS'
    ? `SUCCESS${job.reuseMode === 'REPEAT' ? ' · ULANG SAMPAI TARGET' : ' · UNIQUE'}`
    : job.targetMode === 'DAYS' ? `HARI · ${job.targetDays} Hari` : 'BERTERUSAN';
  const rows = [
    'WAPromoBot · CAMPAIGN REPORT', '',
    `Rujukan Rekod : CAM-${String(job.id).padStart(3, '0')}`,
    `Kempen   : ${job.displayName}`,
    `Client   : ${job.clientName||'Sendiri'}`,
    job.chargeCents?`Caj      : RM${(job.chargeCents/100).toFixed(2)}`:'',
    job.paidFullAt?`Bayaran  : BAYARAN PENUH · Disahkan owner ${formatMalaysiaDateTime(job.paidFullAt)}`:'',
    `Sebab Tamat : ${job.finishReason||job.status}`,
    `Mode     : ${mode}`,
    job.targetMode === 'SUCCESS' ? `Target   : ${job.targetSuccess} ${job.targetUnit==='UNIQUE_GROUPS'?'Group WhatsApp':'SUCCESS'}` : '',
    `Status   : ${job.status}`, '',
    `Mula     : ${formatMalaysiaDateTime(job.startedAt || job.createdAt)}`,
    `Tamat    : ${formatMalaysiaDateTime(job.completedAt)}`,
    'Timezone : Malaysia (MYT / UTC+8)', '',
    '────────────────────────', '',
    `TOTAL SUCCESS : ${job.successCount}`,
    `TOTAL FAILED  : ${job.failedCount}`,
    `BELUM PASTI   : ${job.unknownCount||0}`,
    `TOTAL PROSES  : ${job.processedCount}`, '',
    'PER ACCOUNT'
  ].filter(Boolean);
  for (const account of accountStats) {
    rows.push('', `ACC-${String(account.accountId).padStart(2, '0')} · ${account.accountLabel}`,
      `Success : ${account.successCount}`, `Failed  : ${account.failedCount}`, `Belum Pasti : ${account.unknownCount||0}`, `Round   : ${account.currentRound}`);
  }
  rows.push('', '────────────────────────', '', `IKLAN : ${ads.length}`);
  for (const ad of ads) {
    const type = ad.kind === 'PHOTO' ? 'Gambar + Caption' : ad.kind === 'VIDEO' ? 'Video + Caption' : 'Teks';
    rows.push(`Iklan ${String(ad.adNo).padStart(2, '0')} · ${type} · ${ad.buttonCount} Button`);
  }
  const success = attempts.filter(item => item.status === 'SUCCESS');
  const failed = attempts.filter(item => item.status === 'FAILED');
  rows.push('', '────────────────────────', '', `SUCCESS GROUPS · ${success.length}`);
  success.forEach((item, index) => {
    rows.push('', `${String(index + 1).padStart(3, '0')}. ${item.groupName}`,
      `    Akaun : ACC-${String(item.accountId).padStart(2, '0')}`,
      `    Round : ${item.roundNo}`,
      `    Iklan : ${String(item.adNo).padStart(2, '0')}`,
      `    Masa  : ${formatMalaysiaDateTime(item.completedAt)}`,
      '    Status: SUCCESS');
  });
  rows.push('', '────────────────────────', '', `FAILED GROUPS · ${failed.length}`);
  failed.forEach((item, index) => {
    rows.push('', `${String(index + 1).padStart(3, '0')}. ${item.groupName}`,
      `    Akaun : ACC-${String(item.accountId).padStart(2, '0')}`,
      `    Round : ${item.roundNo}`,
      `    Iklan : ${String(item.adNo).padStart(2, '0')}`,
      `    Masa  : ${formatMalaysiaDateTime(item.completedAt)}`,
      `    Sebab : ${item.errorText || 'Hantar tidak berjaya.'}`,
      '    Status: FAILED');
  });
  const unknown=attempts.filter(a=>a.status==='UNKNOWN');
  rows.push('',`BELUM PASTI · ${unknown.length}`);
  unknown.forEach((a,i)=>rows.push('',`${i+1}. ${a.groupName}`,`Akaun: ${a.accountId} · Iklan ${a.adNo} · Round ${a.roundNo}`,`Masa: ${formatMalaysiaDateTime(a.completedAt)}`,`Sebab: ${a.errorText||'Keputusan belum disahkan.'}`));
  rows.push('', '────────────────────────', '', 'Generated by WAPromoBot');
  return rows.join('\n');
}

async function cleanupSentCampaign(job, chatId = ownerId) {
  try {
    // Preserve only small client summary BEFORE main posting cleanup removes details.
    const clientSnapshot = postingReportSnapshot(databasePath, job.id);
    if(clientSnapshot) saveClientCampaignSnapshot(clientsDbPath, clientSnapshot, job.reportFilename || '');
    if(!archivePost(databasePath,job.id))return true;
    await postingLive.refresh(job.id,true);
    const cleanup = cleanupPostingJobData(databasePath, job.id);
    // Media is removed only by the reference-checked maintenance scanner.
    await sendScreen(chatId, `✅ LAPORAN KEMPEN DIHANTAR
${job.displayName}

Queue operasi dibersihkan. Butiran dan bahan disimpan mengikut polisi kempen.`).catch(() => {});
    return true;
  } catch (error) {
    lastError = `CLEANUP CAM-${job.id}: ${String(error?.message || error).slice(0, 38)}`;
    return false;
  }
}

async function processPendingPostingCleanup(chatId = ownerId) {
  const pending = listPendingPostingCleanup(databasePath).slice(0, 3);
  for (const job of pending) {
    if (postingReportTasks.has(Number(job.id))) continue;
    postingReportTasks.add(Number(job.id));
    try { await cleanupSentCampaign(job, chatId); }
    finally { postingReportTasks.delete(Number(job.id)); }
  }
}

async function processPendingPostingReports(chatId = ownerId) {
  const pending = listPendingPostingReports(databasePath).slice(0, 3);
  for (const job of pending) {
    if (postingReportTasks.has(Number(job.id))) continue;
    postingReportTasks.add(Number(job.id));
    let sent = false;
    try {
      const snapshot = postingReportSnapshot(databasePath, job.id);
      if (!snapshot) continue;
      const text = buildCampaignReportText(snapshot);
      const filename = `CAM-${String(job.id).padStart(3, '0')}-${safeReportName(job.displayName)}-Report.txt`;
      await sendDocumentBuffer(token, chatId, Buffer.from(text, 'utf8'), {
        filename, mimeType: 'text/plain',
        caption: `📄 ${filename}
✅ ${job.successCount} Success · ❌ ${job.failedCount} Failed · ❔ ${job.unknownCount||0} Belum Pasti`,
        signal: abort.signal
      });
      markPostingReportSent(databasePath, job.id, filename);
      sent = true;
    } catch (error) {
      markPostingReportFailed(databasePath, job.id, String(error?.message || error));
    } finally {
      postingReportTasks.delete(Number(job.id));
    }
    if (sent) {
      const fresh = getPostingJob(databasePath, job.id);
      if (fresh) await cleanupSentCampaign(fresh, chatId);
    }
  }
}

async function runAccountPostingWork(accountId, chatId = ownerId) {
 const onlineIds=whatsapp.list().filter(a=>a.status==='ONLINE').map(a=>Number(a.id));
 const work=claimNextCampaignWork(databasePath,accountId,onlineIds);if(!work)return false;
 postingLive.refresh(work.jobId).catch(()=>{});
 let ad;
 try {
  ad=getPostingJobAd(databasePath,work.jobId,work.adNo);
  if(!ad||(ad.kind!=='TEXT'&&(!ad.mediaPath||!existsSync(join(projectRoot,ad.mediaPath))))){
   pauseCampaignForMedia(databasePath,work,'Media / snapshot iklan hilang. Pulihkan bahan sebelum sambung.');postingLive.refresh(work.jobId).catch(()=>{});return true;
  }
 }catch(error){
  // The target was claimed, but WhatsApp has not been called. Preserve it and
  // pause this campaign instead of leaving PROCESSING to lock the account.
  pauseCampaignForMedia(databasePath,work,'Semakan bahan iklan gagal sebelum penghantaran. Semak bahan sebelum sambung.');
  postingLive.refresh(work.jobId).catch(()=>{});return true;
 }
 try {
  const sent=await whatsapp.sendPostingAd(work.accountId,work.groupJid,ad,{
   onSendStarted:()=>{if(!markCampaignSendStarted(databasePath,work))throw new Error('Percubaan penghantaran sudah berubah.');},
   onSendResult:sent=>{if(sent?.key?.id){completeCampaignWork(databasePath,work,{success:true,messageId:sent.key.id});postingLive.refresh(work.jobId).catch(()=>{});}}
  });
  completeCampaignWork(databasePath,work,{success:true,messageId:sent.messageId});
 }catch(error){
  if(error.sendStarted){completeCampaignWork(databasePath,work,{unknown:!error.definiteRejection,error:friendlyUserError(error,'Hasil penghantaran belum disahkan.')});}
  else if(whatsapp.get(work.accountId)?.status!=='ONLINE'){
   requeueCampaignWork(databasePath,work.id,'Akaun offline sebelum send.');setPostingWorkerWait(databasePath,work.accountId,60,{jobId:work.jobId,kind:'DELAY'});
  }else if(/media|snapshot/i.test(error.message||''))pauseCampaignForMedia(databasePath,work,'Media iklan tidak tersedia. Pulihkan bahan sebelum sambung.');
  else completeCampaignWork(databasePath,work,{success:false,error:friendlyUserError(error,'Penghantaran ditolak sebelum send.')});
 }
 postingLive.refresh(work.jobId).catch(()=>{});return true;
}

function ensurePostingScheduler(chatId = ownerId) {
  if (postingSchedulerTask) return postingSchedulerTask;
  postingSchedulerTask = (async () => {
    let lastLivePulse=0;
    while (running && !abort.signal.aborted) {
      try {
        finalizeExpiredPostingJobs(databasePath);
        if(Date.now()-lastLivePulse>=3000){lastLivePulse=Date.now();postingLive.pulse();}
        const online = whatsapp.list().filter(item => item.status === 'ONLINE');
        let launched = 0;
        for (const account of online) {
          const id = Number(account.id);
          if (postingWorkerTasks.has(id)||!diskReady(databasePath)) continue;
          const worker = getPostingWorker(databasePath, id);
          if (worker.availableAt && Date.parse(worker.availableAt) > Date.now()) continue;
          const task = runAccountPostingWork(id, chatId)
            .catch(error => { lastError = `POST ACC-${id}: ${String(error?.message || error).slice(0, 38)}`; })
            .finally(() => postingWorkerTasks.delete(id));
          postingWorkerTasks.set(id, task);
          launched += 1;
        }
        // Telegram report delivery can stall independently of WhatsApp sends.
        // Keep maintenance single-flight without holding the account scheduler.
        if (!postingMaintenanceTask) {
          postingMaintenanceTask = (async () => {
            await processPendingPostingReports(chatId);
            await processPendingPostingCleanup(chatId);
          })().catch(error => {
            lastError = `POST REPORT: ${String(error?.message || error).slice(0, 38)}`;
          }).finally(() => { postingMaintenanceTask = null; });
        }
        await sleep(launched ? 250 : 800);
      } catch (error) {
        lastError = `POST SCHED: ${String(error?.message || error).slice(0, 38)}`;
        await sleep(1200);
      }
    }
  })().finally(() => { postingSchedulerTask = null; });
  return postingSchedulerTask;
}


async function sendMenu(chatId = ownerId) {
  const summary = whatsappAccountSummary(databasePath);
  const postingCounts = postingJobCounts(databasePath);
  const groups=groupSummary(databasePath);
  return sendScreen(chatId, mainMenuText(bot.username, {
    connectedAccounts: summary.connected,
    totalAccounts: summary.total,
    groups: groups.accessCount,
    uniqueGroups: groups.uniqueCount,
    activePostings: postingCounts.active,
    records: postingCounts.records
  }));
}


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePostingAccountSelection(target) {
  const accounts = listWhatsAppAccounts(databasePath);
  const online = accounts.filter(account => account.status === 'ONLINE' && account.groupCount > 0);
  if (!online.length) throw new Error('Tiada akaun ONLINE dengan group tersimpan. Semak akaun dan sync group dahulu.');

  const value = String(target || '').trim().toLowerCase();
  if (value === 'all') return online;

  const ids = [...new Set(value.split(',').map(item => Number(item.trim())).filter(Number.isInteger))];
  if (!ids.length) throw new Error('Pilihan akaun tidak sah.');
  const byId = new Map(accounts.map(account => [Number(account.id), account]));
  const selected = [];
  for (const id of ids) {
    const account = byId.get(id);
    if (!account) throw new Error(`Akaun ${id} tidak ditemui.`);
    if (account.status !== 'ONLINE') throw new Error(`${account.label} belum ONLINE.`);
    if (!account.groupCount) throw new Error(`Akaun ${accountNumber(account)} belum mempunyai group tersimpan. Jalankan sync dahulu.`);
    selected.push(account);
  }
  return selected.sort((a, b) => Number(a.id) - Number(b.id));
}

function resolvePosting() {
  if (postingUi?.postingId) {
    const posting=getPosting(databasePath,postingUi.postingId);
    if(posting&&!getPostingJobForPosting(databasePath,posting.id))return posting;
  }
  const posting=getUnstartedPosting(databasePath);
  if(posting)postingUi={chatId:ownerId,postingId:posting.id,adNo:null};
  return posting;
}

function postingSummary(id) {
 const summary=postingPlanSummary(databasePath,id);
 if(summary?.plan)summary.plan.autoRead=getWhatsAppAutoMarkRead(databasePath);
 if(summary?.plan)summary.plan.accounts=summary.plan.accounts.map(a=>{
  const live=whatsapp.get(a.accountId);
  return {...a,...(live?{displayNumber:accountNumber(live),phone:live.phone,status:live.status}:{status:'OFFLINE'})};
 });
 return summary;
}

function resolvePostingAd(adNo = null) {
  const posting = resolvePosting();
  if (!posting) return { posting: null, ad: null };
  const wanted = Number(adNo || postingUi?.adNo || 0);
  if (wanted > 0) {
    const ad = getPostingAd(databasePath, posting.id, wanted);
    if (ad) {
      postingUi = { chatId: postingUi?.chatId || ownerId, postingId: posting.id, adNo: ad.adNo };
      return { posting, ad };
    }
  }
  const ads = listPostingAds(databasePath, posting.id);
  const latest = ads.at(-1);
  if (!latest) return { posting, ad: null };
  const ad = getPostingAd(databasePath, posting.id, latest.adNo);
  postingUi = { chatId: postingUi?.chatId || ownerId, postingId: posting.id, adNo: ad.adNo };
  return { posting, ad };
}

function resolveSelectedPostingAd() {
  if (!postingUi?.postingId || !postingUi?.adNo) return { posting: null, ad: null };
  const posting = getPosting(databasePath, postingUi.postingId);
  if(posting&&getPostingJobForPosting(databasePath,posting.id))return {posting:null,ad:null};
  const ad = posting ? getPostingAd(databasePath, posting.id, postingUi.adNo) : null;
  return { posting, ad };
}

function postingMediaDirectory(postingId) {
  return join(projectRoot, 'media', 'postings', `posting-${Number(postingId)}`);
}

function removeStoredPostingMedia(relativePath) {
  const value = String(relativePath || '').replaceAll('\\', '/');
  if (!value.startsWith('media/postings/') || value.includes('..')) return;
  if(isPostingMediaReferenced(databasePath,value))return;
  try { rmSync(join(projectRoot, value), { force: true }); } catch {}
}

function removePostingMediaDirectory(postingId) {
  try { rmSync(postingMediaDirectory(postingId), { recursive: true, force: true }); } catch {}
}

function mediaExtension(kind, mimeType, filePath = '') {
  const ext = extname(String(filePath || '')).toLowerCase();
  if (/^\.[a-z0-9]{1,5}$/u.test(ext)) return ext;
  if (kind === 'PHOTO') return mimeType === 'image/png' ? '.png' : '.jpg';
  if (mimeType === 'video/quicktime') return '.mov';
  return '.mp4';
}

async function savePostingMedia(route, posting, adNo, kind) {
  const source = route.media || route.document || {};
  if (!source.fileId) throw new Error('Media Telegram tidak sah.');
  const declared = Number(source.fileSize || 0);
  const limit = 20 * 1024 * 1024;
  if (declared > limit) throw new Error('Media maksimum 20 MB.');
  const info = await getFileInfo(token, source.fileId, { signal: abort.signal });
  if (Number(info.fileSize || 0) > limit) throw new Error('Media maksimum 20 MB.');
  const buffer = await downloadTelegramFile(token, info.filePath, { signal: abort.signal, timeoutMs: 30000 });
  if (!buffer.length || buffer.length > limit) throw new Error('Media kosong atau melebihi 20 MB.');
  const photo=(buffer[0]===0xff&&buffer[1]===0xd8)||(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP');
  const video=buffer.toString('ascii',4,8)==='ftyp'||buffer.subarray(0,4).equals(Buffer.from([26,69,223,163]));
  if(kind==='PHOTO'?!photo:!video)throw new Error('Kandungan fail tidak sepadan dengan gambar / video yang disokong.');
  const mimeType = String(source.mimeType || (kind === 'PHOTO' ? 'image/jpeg' : 'video/mp4'));
  const ext = mediaExtension(kind, mimeType, info.filePath || source.fileName);
  const dir = postingMediaDirectory(posting.id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filename = `ad-${String(adNo).padStart(2, '0')}-${randomUUID().slice(0, 8)}${ext}`;
  const absolute = join(dir, filename);
  const temp = `${absolute}.tmp`;
  try {
    writeFileSync(temp, buffer, { mode: 0o600 });
    renameSync(temp, absolute);
  } finally {
    try { unlinkSync(temp); } catch {}
  }
  return {
    mediaPath: `media/postings/posting-${Number(posting.id)}/${filename}`,
    mediaMime: mimeType,
    mediaSize: buffer.length
  };
}

async function acceptPostingAdContent(route, kind) {
  const input = pendingInput;
  if(route.mediaGroupId){await sendScreen(route.chatId,'⚠️ Hantar satu gambar atau video setiap mesej. Album tidak disimpan sebagai iklan.');return true;}
  if (!input || !['posting_ad_content', 'posting_ad_edit'].includes(input.type)) return false;
  const posting = getPosting(databasePath, input.postingId);
  if (!posting) {
    pendingInput = null;
    await sendScreen(route.chatId || ownerId, '⚠️ IKLAN\nPosting tidak ditemui.\n\n→ .mula');
    return true;
  }
  const adNo = Number(input.adNo || (listPostingAds(databasePath, posting.id).length + 1));
  const body = String(route.text || '').trim();
  if (!body) {
    await sendScreen(route.chatId || ownerId, `⚠️ IKLAN ${String(adNo).padStart(2, '0')}\n${kind === 'TEXT' ? 'Teks' : 'Caption'} tidak boleh kosong.\n\nHantar semula atau batal → .mula-cancel`);
    return true;
  }

  let media = { mediaPath: null, mediaMime: null, mediaSize: 0 };
  let oldMedia = null;
  let savedAd = null;
  try {
    if (kind !== 'TEXT') media = await savePostingMedia(route, posting, adNo, kind);
    let ad;
    if (input.type === 'posting_ad_edit') {
      const previous = getPostingAd(databasePath, posting.id, adNo);
      if (!previous) throw new Error('Iklan tidak ditemui.');
      oldMedia = previous.mediaPath;
      ad = updatePostingAd(databasePath, posting.id, adNo, { kind, body, ...media });
      savedAd=ad;
      if (oldMedia && oldMedia !== ad.mediaPath) removeStoredPostingMedia(oldMedia);
      pendingInput = null;
      postingUi = { chatId: route.chatId, postingId: posting.id, adNo };
      const detail = getPostingAd(databasePath, posting.id, adNo);
      await sendScreen(route.chatId, `✅ IKLAN ${String(adNo).padStart(2, '0')} DIKEMAS KINI\n\n${postingAdDetailMessage(posting, detail)}`);
      return true;
    }
    ad = createPostingAd(databasePath, posting.id, { kind, body, ...media });
    savedAd=ad;
    pendingInput = null;
    postingUi = { chatId: route.chatId, postingId: posting.id, adNo: ad.adNo };
    await sendScreen(route.chatId, postingAdAcceptedMessage(posting, ad));
    return true;
  } catch (error) {
    if(savedAd){
      // Only delivery failed; the material and its CTA association are intact.
      try{await sendScreen(route.chatId||ownerId,`✅ IKLAN ${savedAd.adNo} TELAH DISIMPAN\n↳ ${posting.displayName}\n• Balasan sebelumnya belum dapat dihantar. Bahan tidak perlu dihantar semula.\n\n🔎 ↳ .iklan ${savedAd.adNo} → Semak Iklan\n🔗 ↳ .button-manage ${savedAd.adNo} → Urus CTA\n✅ ↳ .iklan-siap → Teruskan`);}catch{}
      return true;
    }
    if (media.mediaPath) removeStoredPostingMedia(media.mediaPath);
    await sendScreen(route.chatId || ownerId, `⚠️ IKLAN\n${String(error.message || error)}\n\nHantar semula bahan iklan.`);
    return true;
  }
}

function telegramPreviewButtons(buttons = []) {
  if (!buttons.length) return undefined;
  return { inline_keyboard: buttons.map(button => [{ text: button.label, url: button.url }]) };
}

async function sendPostingPreview(chatId, posting, ad) {
  await sendScreen(chatId, postingPreviewHeaderMessage(posting, ad));
  const buttons = telegramPreviewButtons(ad.buttons || []);
  if (ad.kind === 'TEXT') {
    await sendMessage(token, chatId, ad.body, { replyMarkup: buttons, signal: abort.signal });
  } else {
    const buffer = readFileSync(join(projectRoot, ad.mediaPath));
    const shortCaption = ad.body.length <= 1024;
    if (ad.kind === 'PHOTO') {
      await sendPhotoBuffer(token, chatId, buffer, {
        caption: shortCaption ? ad.body : undefined,
        mimeType: ad.mediaMime || 'image/jpeg',
        filename: `iklan-${String(ad.adNo).padStart(2, '0')}${mediaExtension('PHOTO', ad.mediaMime, ad.mediaPath)}`,
        replyMarkup: shortCaption ? buttons : undefined,
        signal: abort.signal
      });
    } else {
      await sendVideoBuffer(token, chatId, buffer, {
        caption: shortCaption ? ad.body : undefined,
        mimeType: ad.mediaMime || 'video/mp4',
        filename: `iklan-${String(ad.adNo).padStart(2, '0')}${mediaExtension('VIDEO', ad.mediaMime, ad.mediaPath)}`,
        replyMarkup: shortCaption ? buttons : undefined,
        signal: abort.signal
      });
    }
    if (!shortCaption) await sendMessage(token, chatId, ad.body, { replyMarkup: buttons, signal: abort.signal });
  }
  return sendScreen(chatId, postingPreviewFooterMessage(ad));
}

function adDoneScreen(posting, adNo) {
  const ad = getPostingAd(databasePath, posting.id, adNo);
  return postingAdCompleteMessage(posting, ad, ad?.buttons || []);
}

function chargeOrSchedule(chatId,posting,plan){
 if(isClientPosting(posting)&&!posting.chargeCents){pendingInput={type:'posting_charge',chatId,postingId:posting.id};postingScreen='posting_charge';return sendScreen(chatId,clientChargeMessage(posting));}
 pendingInput=null;postingScreen='posting_setting';return sendScreen(chatId,postingScheduleMessage(posting,plan));
}
function showPostingReview(chatId,id){
 const posting=getPosting(databasePath,id);
 if(isClientPosting(posting)&&!posting.chargeCents)return chargeOrSchedule(chatId,posting,getPostingPlan(databasePath,id));
 pendingInput=null;postingScreen='posting_review';return clientFlow.review(chatId,id,postingSummary(id));
}
function currentStorageMessage() {
  const snapshot = storageSnapshot(projectRoot, databasePath);
  return storageMessage({
    database: bytesToHuman(snapshot.database),
    media: bytesToHuman(snapshot.media),
    reports: bytesToHuman(snapshot.reports),
    logs: bytesToHuman(snapshot.logs),
    temp: bytesToHuman(snapshot.temp),
    managedTotal: bytesToHuman(snapshot.managedTotal),
    deviceFree: snapshot.deviceFree > 0 ? bytesToHuman(snapshot.deviceFree) : '—'
  });
}

function storageCleanupPrompt(target) {
  const labels = {
    temp: 'Temp / Cache',
    logs: 'Logs',
    media: 'Media orphan / campaign tamat',
    all: 'Temp + Logs + Media orphan'
  };
  return [
    '🧹 BERSIHKAN STORAGE?', '',
    `Target : ${labels[target] || target}`,
    '',
    '🔒 Dilindungi:',
    '↳ Database aktif',
    '↳ WhatsApp session',
    '↳ Media campaign/draf yang masih dirujuk',
    '↳ Report TXT dalam Telegram',
    '',
    'CONFIRM',
    `→ .storage-clean ${target} CONFIRM`,
    '',
    '⬅️ BATAL',
    '→ .storage'
  ].join('\n');
}

function runStorageCleanup(target) {
  if (target === 'temp') return { target, ...cleanTempCache(projectRoot) };
  if (target === 'logs') return { target, ...cleanLogs(projectRoot) };
  if (target === 'media') return { target, ...cleanOrphanPostingMedia(projectRoot, databasePath) };
  if (target === 'all') return { target, ...cleanManagedStorage(projectRoot, databasePath) };
  throw new Error('Pilihan storage tidak sah.');
}


async function dispatch(route) {
 const leaving=['home','wa_cancel'].includes(route.action)&&isPostingInput(pendingInput)&&!pendingInput.type.includes('confirm')?{pendingInput:{...pendingInput},postingUi,postingScreen}:null;
 try{return await dispatchPostingRoute(route);}
 finally{
  const safe=isPostingInput(pendingInput)&&!pendingInput.type.includes('confirm')?pendingInput:null;
  if(safe)savePostingFlowState(databasePath,'input:'+(route.chatId||ownerId),{pendingInput:safe,postingUi,postingScreen});
  else savePostingFlowState(databasePath,'input:'+(route.chatId||ownerId),leaving||{pendingInput:null,postingUi,postingScreen});
 }
}
async function dispatchPostingRoute(route) {
  if (route.callbackQueryId) {
    try { await answerCallbackQuery(token, route.callbackQueryId, { signal: abort.signal }); } catch {}
  }

  const chatId = route.chatId || ownerId;
  route = { ...route, chatId, args:[...(route.args || [])] };
  if(route.action.startsWith('fu_')){pendingInput=null;postingScreen=null;postingLive.confirmations.delete(String(chatId));gsContext.stage=null;saveGsContext();await accountFlow.cancel();joinFlow.leave(chatId);await followupFlow.handle(route);return;}
  if(followupFlow.active&&['wa_back','wa_cancel'].includes(route.action)){await followupFlow.handle({...route,action:route.action==='wa_back'?'fu_back':'fu_cancel'});return;}
  if(['text','photo','video','document'].includes(route.action)){if(await followupFlow.handle(route))return;}
  else followupFlow.leave();
  if(route.action.startsWith('extract_')){pendingInput=null;postingScreen=null;postingLive.confirmations.delete(String(chatId));gsContext.stage=null;saveGsContext();await accountFlow.cancel();joinFlow.leave(chatId);await memberExportFlow.handle(route);return;}
  if(route.action.startsWith('panel')){await ensureMiniApp().handle(route);return;}
  if(['system','system_default','system_cleanup','system_cleanup_toggle','system_retention','system_old','system_repeat','system_report_retry','system_check','storage','storage_clean'].includes(route.action)){pendingInput=null;postingScreen=null;postingLive.confirmations.delete(String(chatId));await accountFlow.cancel();joinFlow.leave(chatId);}
  if(await ensureSystemFlow().handle(route))return;
  if(!route.hubBypass&&(['posting_active','posting_refresh','posting_status','records','records_refresh','report','report_refresh'].includes(route.action)||route.action.startsWith('hub_'))){pendingInput=null;postingScreen=null;postingLive.confirmations.delete(String(chatId));await accountFlow.cancel();joinFlow.leave(chatId);if(await ensureCampaignHub().handle(route))return;}
  if(route.action==='posting_native_status')route.action='posting_status';
  if(!route.action.startsWith('gs_')&&!['text','photo','video','document','wa_back','wa_cancel'].includes(route.action)){gsContext.stage=null;saveGsContext();}
  if(['gs_status','gs_report','gs_posts','gs_pause','gs_resume','gs_stop','gs_delete','gs_again'].includes(route.action)){
    const choice=resolveGsSelection(listAllGsJobs(databasePath).slice().reverse(),gsContext,route.args?.[0]);
    if(choice.error){pendingInput=null;await sendScreen(chatId,'📋 PILIH AUTO STATUS\n↳ '+choice.error);return gsListScreen(chatId);}
  }
  if(route.action.startsWith('gs_')){postingScreen=null;await accountFlow.cancel();joinFlow.leave(chatId);}
  if(['wa_cancel','wa_back','home'].includes(route.action)&&pendingInput?.type?.startsWith('gs_')){
    const input=pendingInput;pendingInput=null;
    if(route.action==='wa_back'){
      const job=getGsJob(databasePath,input.jobId);
      if(input.type==='gs_setting_input'&&input.step>0){input.step--;input.values.pop();pendingInput=input;return sendScreen(chatId,gsSettingPrompt(input.step,input.values));}
      if(input.type==='gs_content')return gsAccountsScreen(job,chatId);
      return gsSettingsScreen(job,chatId);
    }
    if(route.action==='wa_cancel'){if(input.type==='gs_delete_confirm'){if(await campaignHub?.cancelDelete(chatId))return;await sendScreen(chatId,'↩️ Padam dibatalkan. Kempen dikekalkan.');return gsListScreen(chatId);}return sendScreen(chatId,input.type==='gs_stop_confirm'?'↩️ Hentikan dibatalkan. Kempen dikekalkan.\n\n📊 ↳ .gs-status → Dashboard Live':'📝 Draf disimpan.\n\n↩️ ↳ .group-status → Menu Auto Status');}
  }
  if(route.action==='wa_back'&&gsContext.stage&&currentGs()){
    if(gsContext.stage==='preview')return gsSettingsScreen(currentGs(),chatId);
    if(gsContext.stage==='settings'){route={...route,action:'gs_content'};}
  }
  if(route.action==='text'&&pendingInput?.type==='gs_delete_confirm'){
    const input=pendingInput;if(Date.now()>input.expires){pendingInput=null;return sendScreen(chatId,'Pengesahan tamat tempoh. Buka kempen semula melalui .gs-list.');}
    if(String(route.text).trim().toUpperCase()!=='SAH')return sendScreen(chatId,'Balas SAH untuk padam rekod atau .batal untuk batalkan.');
    const job=getGsJob(databasePath,input.jobId);pendingInput=null;
    if(!job)return gsListScreen(chatId);
    openGs(job.id);route={...route,action:'gs_delete',gsDeleteConfirmed:true,args:[String(gsView(job).displayNumber),'confirm']};
  }
  if(route.action==='text'&&pendingInput?.type==='gs_stop_confirm'){
    const input=pendingInput;if(Date.now()>input.expires){pendingInput=null;return sendScreen(chatId,'Pengesahan tamat tempoh. Gunakan .gs-stop semula.');}
    if(String(route.text).trim().toUpperCase()!=='SAH')return sendScreen(chatId,'Balas SAH untuk hentikan atau .batal untuk batalkan.');
    pendingInput=null;const job=getGsJob(databasePath,input.jobId);if(!job||!['RUNNING','PAUSED'].includes(job.status))return sendScreen(chatId,'Kempen telah berubah. Semak .gs-list.');
    setGsStatus(databasePath,job.id,'STOPPED');gsShow(job.id,chatId).catch(()=>{});
    if(gsRunners.has(job.id)){gsRunners.get(job.id).then(()=>deliverGsReport(chatId,job.id)).catch(()=>{});return sendScreen(chatId,'⏹ Kempen dihentikan. Menunggu hasil operasi sedang berlangsung; laporan akan dihantar selepas selesai.');}
    return deliverGsReport(chatId,job.id);
  }
  if(route.action==='text'&&pendingInput?.type==='gs_accounts_input'){
    const value=String(route.text||'').trim().toLowerCase();if(!/^(all|[0-9]+(?:,[0-9]+)*)$/.test(value))return sendScreen(chatId,'Pilihan tidak sah. Hantar 1, 1,2 atau all.');
    route={...route,action:'gs_accounts',args:[value]};
  }
  if(route.action==='text'&&pendingInput?.type==='gs_setting_input'){
    const input=pendingInput,value=String(route.text||'').trim();
    if(input.step===5){if(value.toUpperCase()!=='SAH')return sendScreen(chatId,gsSettingPrompt(5,input.values));const [a,b,c,d,e]=input.values;try{setGsPace(databasePath,input.jobId,{delayMinSec:a,delayMaxSec:b,batchSize:c,restMinSec:d*60,restMaxSec:e*60});pendingInput=null;return gsSettingsScreen(getGsJob(databasePath,input.jobId),chatId);}catch(error){return sendScreen(chatId,error.message);}}
    const n=Number(value),limits=[[5,600],[5,600],[1,500],[0,60],[0,60]][input.step];
    if(!/^\d+$/.test(value)||n<limits[0]||n>limits[1]||(input.step===1&&n<input.values[0])||(input.step===4&&n<input.values[3]))return sendScreen(chatId,'Nilai tidak sah atau maksimum kurang daripada minimum.\n'+gsSettingPrompt(input.step,input.values));
    input.values.push(n);input.step++;return sendScreen(chatId,gsSettingPrompt(input.step,input.values));
  }
  if(['posting_run','posting_active','posting_refresh','posting_status','posting_pause','posting_resume','posting_stop','posting_accounts'].includes(route.action)){await accountFlow.cancel();joinFlow.leave(chatId);}
  if(route.action.startsWith('client_')||['posting_client','posting_client_manual'].includes(route.action)){pendingInput=null;postingScreen=null;postingLive.confirmations.delete(String(chatId));await accountFlow.cancel();joinFlow.leave(chatId);}
  if(await clientFlow.handle(route))return;
  if(await postingLive.handle(route)){if(route.action!=='posting_run'){pendingInput=null;postingScreen=null;}return;}
  if(['wa_cancel','wa_back'].includes(route.action)&&(isPostingInput(pendingInput)||postingScreen)){
    if(route.action==='wa_cancel'){
      pendingInput=null;postingScreen='posting_new';
      return sendScreen(chatId,postingNewMessage(getUnstartedPosting(databasePath)));
    }
    const previous=postingBackRoute(pendingInput,postingScreen);
    if(previous.action==='posting_setting_back'){
      pendingInput=previous.input;return sendScreen(chatId,postingSchedulePromptMessage(previous.step,pendingInput.draft));
    }
    route={...route,...previous};
  }
  if(route.action==='text'&&pendingInput?.type==='posting_account_input'&&pendingInput.chatId===chatId){
    const choice=String(route.text||'').trim().toLowerCase().replace(/\s+/g,'');
    if(!/^(all|[1-9]\d*(?:,[1-9]\d*)*)$/.test(choice))return sendScreen(chatId,'⚠️ PILIH AKAUN\nBalas 1, 1,2 atau all.\n✖️ ↳ .batal → Batal Input');
    route={...route,action:'posting_account_choose',args:[choice]};
  }
  if(route.action==='text'&&pendingInput?.type==='posting_mode_input'){
    const action={'1':'posting_target_success','2':'posting_target_days','3':'posting_target_continuous'}[String(route.text).trim()];
    if(!action)return sendScreen(chatId,'⚠️ Balas 1, 2 atau 3 untuk memilih mode.');route={...route,action,args:[]};
  }
  if(route.action==='text'&&pendingInput?.type==='posting_reuse_input'){
    const action={'1':'posting_reuse_repeat','2':'posting_reuse_unique'}[String(route.text).trim()];
    if(!action)return sendScreen(chatId,'⚠️ Balas 1 atau 2 untuk memilih penggunaan group.');route={...route,action,args:[]};
  }
  if(route.action==='posting_draft'){
    const draft=getUnstartedPosting(databasePath),saved=readPostingFlowState(databasePath,'input:'+chatId);
    if(draft&&saved?.pendingInput?.postingId===draft.id&&!saved.pendingInput.type.includes('confirm')){
      const input=saved.pendingInput;
      if(input.type.startsWith('posting_setting_')){pendingInput=input;postingUi=saved.postingUi;postingScreen='posting_setting_custom';return sendScreen(chatId,postingSchedulePromptMessage(input.type.slice(16),input.draft));}
      if(input.type==='button_url'||input.type==='button_label'){
        const ad=getPostingAd(databasePath,draft.id,input.adNo);if(ad){pendingInput=input;postingUi=saved.postingUi;postingScreen='button_add';return sendScreen(chatId,input.type==='button_label'?postingButtonNamePromptMessage(ad,ad.buttons.length+1):postingButtonUrlPromptMessage(ad,ad.buttons.length+1,input.label));}
      }
    }
    if(draft)postingUi={chatId,postingId:draft.id,adNo:null};
    route={...route,action:draftNextAction(draft,draft?postingSummary(draft.id):null),args:[]};
  }
  if(!['text','photo','video','document','wa_cancel','wa_back'].includes(route.action)){
    postingScreen=/^(posting_|ad_|button_)/.test(route.action)?route.action:null;
  }

  if (await accountFlow.handle(route)) {
    joinFlow.leave(chatId);
    pendingInput = null;
    return;
  }
  if (await joinFlow.handle(route)) { pendingInput = null; return; }
  if (await groupFlow.handle(route)) { pendingInput = null; return; }
  const selectionScreens = new Set(['posting_account_select','ad_done','gs_new','gs_accounts_help']);
  if (selectionScreens.has(route.action)) accountFlow.capture();
  try {
    if(route.action!=='gs_accounts')route = accountFlow.mapRoute(route);
  } catch (error) {
    return accountFlow.list(chatId,1,error.message);
  }
  const accountId = Number(route.args?.[0] || 0);

  if (!['text', 'photo', 'video', 'document', 'wa_login_pair', 'wa_replace'].includes(route.action)) pendingInput = null;

  switch (route.action) {
    case 'gs_menu': gsCaptureNumbers();gsContext.stage=null;saveGsContext();return sendScreen(chatId,gsMenuMessage(listAllGsJobs(databasePath).slice().reverse()));
    case 'gs_list': return gsListScreen(chatId);
    case 'gs_draft': {const j=gsDraft();if(!j)return sendScreen(chatId,'Tiada draf. → .gs-new');openGs(j.id);if(!JSON.parse(j.selected_accounts||'[]').length)return gsAccountsScreen(j,chatId);if(!j.kind){pendingInput={type:'gs_content',chatId,jobId:j.id};return sendScreen(chatId,gsContentPrompt(j));}return gsSettingsScreen(j,chatId);}
    case 'gs_new': {
      try{const job=createGsJob(databasePath);openGs(job.id);pendingInput=null;if(job.kind)return gsSettingsScreen(job,chatId);if(JSON.parse(job.selected_accounts||'[]').length){gsContext.stage='content';saveGsContext();pendingInput={type:'gs_content',chatId,jobId:job.id};return sendScreen(chatId,gsContentPrompt(job));}return gsAccountsScreen(job,chatId);}
      catch(e){return sendScreen(chatId,`⚠️ ${String(e.message||e)}\n\n→ .group-status`);}
    }
    case 'gs_content':{
      const job=gsDraft();if(job)openGs(job.id);if(!job||!['DRAFT','READY'].includes(job.status))return sendScreen(chatId,'Tiada draf. → .gs-new');
      gsContext.stage='content';saveGsContext();pendingInput={type:'gs_content',chatId,jobId:job.id};return sendScreen(chatId,gsContentPrompt(job));
    }
    case 'gs_all':{
      try {
        const job=currentGs();if(!job)throw new Error('Tiada job. Cipta dahulu dengan .gs-new.');
        if(!['DRAFT','READY'].includes(job.status))throw new Error(`AUTO STATUS ${gsView(job).displayNumber} ${job.status}. STOP dahulu sebelum job baharu.`);
        const ids=JSON.parse(job.selected_accounts||'[]');
        if(!ids.length)return sendScreen(chatId,gsAccountPrompt(job,listWhatsAppAccounts(databasePath)));
        if(!job.kind){pendingInput={type:'gs_content',chatId,jobId:job.id};return sendScreen(chatId,gsContentPrompt(job));}
        const planned=prepareGsTargets(databasePath,job.id,{mode:'ALL'});
        gsContext.stage='preview';saveGsContext();return gsPreview(chatId,planned.id,{showMedia:true});
      }catch(error){return sendScreen(chatId,'⚠️ AUTO SEMUA\n'+String(error.message||error)+'\n\n→ .gs-status');}
    }
    case 'gs_accounts_help':{
      const j=gsDraft();return j?gsAccountsScreen(j,chatId):sendScreen(chatId,'→ .gs-new');
    }
    case 'gs_accounts':{
      try{
        const j=currentGs();if(!j)throw new Error('Cipta job dahulu.');
        const a=listWhatsAppAccounts(databasePath).filter(x=>x.status==='ONLINE');
        const ids=route.args[0]==='all'?a.map(x=>x.id):route.args[0].split(',').map(n=>gsContext.accounts?.[Number(n)-1]);
        if(ids.some(id=>!id))throw new Error('Senarai akaun berubah. Buka .gs-accounts semula.');
        for(const id of ids){const acc=whatsapp.get(id);if(acc?.status!=='ONLINE')throw new Error('Akaun belum ONLINE.');if(!listWhatsAppAccounts(databasePath).find(x=>x.id===id)?.groupCount)throw new Error('Akaun tiada group tersimpan. Gunakan .group-sync '+accountNumber(acc));}
        const updated=setGsAccounts(databasePath,j.id,ids);
        // Explicit accounts come before content in the agreed classic flow.
        if(!updated.kind){pendingInput={type:'gs_content',chatId,jobId:updated.id};return sendScreen(chatId,gsContentPrompt(updated));}
        const planned=prepareGsTargets(databasePath,updated.id,{mode:'ALL'});
        return gsSettingsScreen(planned,chatId);
      }catch(e){return sendScreen(chatId,'⚠️ AKAUN\n'+String(e.message||e)+'\n\n→ .gs-accounts');}
    }
    case 'gs_target_help':{
      const j=currentGs();return j?sendScreen(chatId,gsTargetPrompt({...j,selected_accounts:JSON.stringify(JSON.parse(j.selected_accounts||'[]').map(id=>accountNumber(whatsapp.get(id))))})):sendScreen(chatId,'→ .gs-new');
    }
    case 'gs_groups':{
      const j=currentGs();if(!j)return sendScreen(chatId,'→ .gs-new');
      const id=Number(route.args[0]),page=Number(route.args[1]||1),display=accountNumber(whatsapp.get(id));
      const allowed=JSON.parse(j.selected_accounts||'[]');if(!allowed.includes(id))return sendScreen(chatId,'Pilih akaun dahulu. → .gs-accounts');
      const result=listWhatsAppGroups(databasePath,id,{page,perPage:20});
      const rows=[`👥 AUTO STATUS ${gsView(j).displayNumber} · AKAUN ${display}`,`Page ${result.page}/${result.totalPages} · ${result.total} group`,''];
      result.items.forEach((g,i)=>rows.push(`${result.offset+i+1}. ${String(g.subject).slice(0,48)}`));
      rows.push('','Pilih group contoh:',`→ .gs-target ${display}:${result.offset+1}`,'Semua group akaun terpilih:','→ .gs-target all');
      if(result.page<result.totalPages)rows.push('Page seterusnya:',`→ .gs-groups ${display} ${result.page+1}`);
      return sendScreen(chatId,rows.join('\n'));
    }
    case 'gs_target':{
      try{
        const j=currentGs();if(!j)throw new Error('Cipta job dahulu.');
        const raw=route.args[0];
        const selections=raw==='all'?[]:raw.split(',').map(pair=>{const [a,n]=pair.split(':');return {accountId:Number(a),position:Number(n)};});
        const result=prepareGsTargets(databasePath,j.id,{mode:raw==='all'?'ALL':'SELECTED',selections});
        return gsPreview(chatId,result.id);
      }catch(e){return sendScreen(chatId,'⚠️ GROUP\n'+String(e.message||e)+'\n\n→ .gs-target');}
    }
    case 'gs_setting_help': {const j=currentGs();if(!j||!['DRAFT','READY'].includes(j.status))return sendScreen(chatId,'Buka draf melalui .gs-draft.');pendingInput={type:'gs_setting_input',chatId,jobId:j.id,step:0,values:[]};return sendScreen(chatId,gsSettingPrompt(0));}
    case 'gs_setting_save': {
      const j=currentGs();if(!j)return sendScreen(chatId,'Pilih kempen melalui .gs-list atau cipta melalui .gs-new.');
      try {
        const [a,b,c,d,e]=route.args.map(Number);
        const v=setGsPace(databasePath,j.id,{delayMinSec:a,delayMaxSec:b,batchSize:c,restMinSec:d*60,restMaxSec:e*60});
        return gsPreview(chatId,v.id);
      }catch(e){return sendScreen(chatId,`⚠️ ${String(e.message||e)}\n→ .gs-setting`);}
    }
    case 'gs_posts': {
      try {
        const j=currentGs(route.args?.[0]);if(!j)throw new Error('Tiada kempen GS.');
        const page=Number(route.args?.[1]||1);
        const data=gsListPosts(databasePath,j.id,page,10);
        const rows=[`📁 AUTO STATUS ${gsView(j).displayNumber} · REKOD PENGHANTARAN`,
          `Sasaran: ${data.total} · Halaman ${data.page}/${data.pages}`,
          `↳ Rekod setiap percubaan; ACK bukan jaminan paparan.`, ''];
        for(const x of data.items){
          rows.push(`${(data.page-1)*10+data.items.indexOf(x)+1}. ${gsView(j).accountLabels[x.accountId]} · ${String(x.groupName).slice(0,46)}`);
          rows.push(`↳ ${gsResult(x.status)} · ${gsDate(x.attemptedAt)} · ${x.messageId?'ID mesej disimpan':'Tiada ID mesej'}`);
          if(x.error)rows.push(`  ↳ ${String(x.error).slice(0,90)}`);
        }
        if(!data.items.length)rows.push('Tiada rekod.');
        if(data.page<data.pages)rows.push('',`→ .gs-posts ${gsView(j).displayNumber} ${data.page+1}`);
        rows.push('',`→ .gs-report ${gsView(j).displayNumber}`,`→ .gs-status ${gsView(j).displayNumber}`);
        return sendScreen(chatId,rows.join('\n'));
      }catch(error){return sendScreen(chatId,'⚠️ REKOD STATUS\n'+String(error.message||error));}
    }
    case 'gs_retry_account':{
      const job=currentGs();if(!job)return sendScreen(chatId,'Tiada kempen. → .gs-new');
      try{
        const a=Number(route.args[0]);
        const result=gsRetryBlockedAccount(databasePath,job.id,a);
        return sendScreen(chatId,`✅ AUTO STATUS ${gsView(job).displayNumber} · AKAUN ${a} BOLEH DISAMBUNG\n↳ Group gagal sebelum ini tidak diulang automatik.\n↳ Gunakan hanya selepas punca ralat diperiksa.\n\n→ .gs-resume`);
      }catch(error){return sendScreen(chatId,`⚠️ ${String(error.message||error)}\n→ .gs-status`);}
    }
    case 'gs_preview':{
      const j=currentGs();gsContext.stage='preview';saveGsContext();return j?gsPreview(chatId,j.id,{showMedia:true}):sendScreen(chatId,'→ .gs-new');
    }
    case 'gs_run':{
      let j=currentGs(route.args?.[0]);
      try{
        if(j?.status==='RUNNING')return gsRender(j.id,chatId);
        if(j&&['DRAFT','READY'].includes(j.status)&&gsTargetsChanged(databasePath,j.id)){prepareGsTargets(databasePath,j.id,{mode:'ALL'});await sendScreen(chatId,'🔄 Sasaran group berubah selepas semakan. Semak preview terkini dan hantar .gs-run semula.');return gsPreview(chatId,j.id);}
        if(!j||j.status!=='READY')throw new Error('Job belum READY. Ikut flow: .gs-accounts → bahan → .gs-setting');
        if(j.media_path&&!existsSync(join(projectRoot,j.media_path)))throw new Error('Bahan Status hilang. Muat naik semula melalui .gs-content.');
        const snapshot=gsSnapshot(databasePath,j.id);
        if(!snapshot.total)throw new Error('Tiada group sasaran. → .group-sync all');
        if(!['TEXT','PHOTO'].includes(j.kind))throw new Error('Enjin NEXUS belum disahkan untuk VIDEO. Pilih teks atau gambar.');
        const selected=JSON.parse(j.selected_accounts||'[]');
        if(!selected.some(a=>whatsapp.get(a)?.status==='ONLINE'))throw new Error('Tiada akaun terpilih ONLINE. Sambung semula dahulu.');
        setGsStatus(databasePath,j.id,'RUNNING');
        await gsRender(j.id,chatId,{forceNew:true}).catch(()=>{});beginGsRunner(j.id,chatId);return;
      }catch(e){return sendScreen(chatId,'⚠️ RUN\n'+String(e.message||e)+'\n\n→ .gs-preview');}
    }
    case 'gs_status':{
      const j=currentGs(route.args?.[0]);if(!j)return gsListScreen(chatId);
      openGs(j.id);return gsShow(j.id,chatId);
    }
    case 'gs_report':{
      const j=currentGs(route.args?.[0]);return j?sendScreen(chatId,gsReportMessage(gsView(gsSnapshot(databasePath,j.id)),gsAccountStats(databasePath,j.id))):sendScreen(chatId,'Tiada job. → .gs-new');
    }
    case 'gs_pause':case 'gs_resume':case 'gs_stop':{
      const j=currentGs(route.args?.[0]);if(!j)return sendScreen(chatId,'Pilih kempen melalui .gs-list.');
      if(route.action==='gs_stop'){pendingInput={type:'gs_stop_confirm',chatId,jobId:j.id,expires:Date.now()+120000};return sendScreen(chatId,`⏹ HENTIKAN AUTO STATUS?\n\n📢 Kempen : Auto Status ${gsView(j).displayNumber}\n↳ ${String(j.body||'Status').replace(/\s+/g,' ').slice(0,90)}\n• Hasil dan baki disimpan untuk resume.\n• Permintaan sedang berlangsung mungkin masih selesai.\n\n✅ ↳ Balas SAH → Hentikan\n✖️ ↳ .batal → Batal`);}
      const target=route.action==='gs_pause'?'PAUSED':route.action==='gs_resume'?'RUNNING':'STOPPED';
      try{
        if(target==='RUNNING'){
          if(gsRunners.has(j.id))throw new Error('Operasi lama masih diselesaikan. Cuba resume sebentar lagi.');
          if(j.media_path&&!existsSync(join(projectRoot,j.media_path)))throw new Error('Bahan Status hilang. Pulihkan fail sebelum resume.');
          if(!['TEXT','PHOTO'].includes(j.kind))throw new Error('Enjin ini hanya diuji untuk teks/gambar.');
          if(!JSON.parse(j.selected_accounts||'[]').some(a=>whatsapp.get(a)?.status==='ONLINE'))throw new Error('Tiada akaun terpilih ONLINE.');
        }
        setGsStatus(databasePath,j.id,target);
        if(target==='RUNNING')beginGsRunner(j.id,chatId);
        return gsShow(j.id,chatId);
      }catch(e){return sendScreen(chatId,`⚠️ ${String(e.message||e)}\n\n→ .gs-status ${gsView(j).displayNumber}`);}
    }
    case 'gs_delete':{
      const chosen=currentGs(route.args[0]);if(!chosen)return sendScreen(chatId,'Kempen tidak ditemui. Semak .gs-list.');const id=chosen.id,display=gsView(chosen).displayNumber;if(chosen.status==='RUNNING')return sendScreen(chatId,`Kempen masih berjalan. Hentikan dahulu melalui .gs-stop ${display}.`);if(route.args?.[1]!=='confirm'||!route.gsDeleteConfirmed){pendingInput={type:'gs_delete_confirm',chatId,jobId:id,expires:Date.now()+120000};return sendScreen(chatId,`🗑 PADAM AUTO STATUS ${display}?\n↳ ${String(chosen.body||'Draf belum lengkap').replace(/\s+/g,' ').slice(0,100)}\n\n📥 Baki Belum Diproses : ${gsSnapshot(databasePath,id)?.pending||0}\n\n• Rekod kempen dan baki akan dibuang; kempen tidak boleh disambung.\n• Media dibuang hanya jika tidak digunakan kempen lain.\n• Status yang sudah diterbitkan di WhatsApp kekal.\n\n✅ ↳ Balas SAH → Padam Kempen\n✖️ ↳ .batal → Batal`);}
      if(gsRunners.has(id)||gsSnapshot(databasePath,id)?.inFlight)return sendScreen(chatId,'⏳ Penghantaran masih diselesaikan. Tunggu sebentar, kemudian pilih Padam semula melalui .gs-list.');
      try{
        const removed=deleteGsJob(databasePath,id);
        gsLiveMessages.delete(id);gsLive?.forget(id);
        // Shared media from RUN AGAIN may be referenced by another job.
        if(removed.media_path){
          const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(databasePath,{readOnly:true});
          let other;try{other=db.prepare('SELECT count(*) AS n FROM group_status_jobs WHERE media_path=?').get(removed.media_path).n;}finally{db.close();}
          if(!other){const path=join(projectRoot,removed.media_path);if(path.startsWith(join(projectRoot,'media','group-status')+'/'))rmSync(path,{force:true});}
        }
        if(Number(gsContext.jobId)===id){gsContext.jobId=null;gsContext.stage=null;saveGsContext();}
        if(await campaignHub?.afterDelete(chatId,'gs',id))return;
        await sendScreen(chatId,`✅ AUTO STATUS ${display} DIPADAM\n↳ Senarai di bawah menggunakan nombor terkini.`);
        return gsListScreen(chatId);
      }catch(e){return sendScreen(chatId,'⚠️ '+String(e.message||e));}
    }
    case 'gs_again':{
      try{const cloned=cloneGsJob(databasePath,currentGs(route.args[0])?.id);openGs(cloned.id);return gsAccountsScreen(cloned,chatId);}
      catch(e){return sendScreen(chatId,'⚠️ '+String(e.message||e));}
    }
    case 'home': return sendMenu(chatId);
    case 'text': {
      if(['posting_delete_confirm','posting_ad_delete_confirm'].includes(pendingInput?.type)&&pendingInput.chatId===chatId){
        const input=pendingInput;
        if(Date.now()>input.expires){pendingInput=null;return sendScreen(chatId,'⚠️ Pengesahan tamat tempoh. Buka draf semula melalui .mula.');}
        if(String(route.text||'').trim().toUpperCase()!=='SAH')return sendScreen(chatId,'Balas SAH untuk sahkan atau .batal untuk kekalkan draf.');
        pendingInput=null;
        const posting=getPosting(databasePath,input.postingId);
        if(!posting||getPostingJobForPosting(databasePath,posting.id))return sendScreen(chatId,'⚠️ Draf telah berubah. Semak semula melalui .mula.');
        if(input.type==='posting_delete_confirm'){
          deletePosting(databasePath,posting.id);unlinkClientPosting(clientsDbPath,posting.id);removePostingMediaDirectory(posting.id);postingUi=null;
          return sendScreen(chatId,'✅ DRAF DIBUANG\n\n🚀 ↳ .mula → Cipta Kempen');
        }
        const ad=getPostingAd(databasePath,posting.id,input.adNo);
        if(!ad||ad.id!==input.adId)return sendScreen(chatId,'⚠️ Susunan iklan berubah. Pilih semula melalui .iklan-urus.');
        reopenPostingDraft(databasePath,posting.id);
        const removed=deletePostingAd(databasePath,posting.id,input.adNo);if(removed?.mediaPath)removeStoredPostingMedia(removed.mediaPath);
        postingUi={chatId,postingId:posting.id,adNo:null};
        return sendScreen(chatId,postingAdsManageMessage(postingAdSummary(databasePath,posting.id)));
      }

      if(pendingInput?.type==='gs_content' && String(pendingInput.chatId)===String(chatId)){
        try{return await saveGsInput(route,'TEXT');}catch(e){return sendScreen(chatId,'⚠️ STATUS TEKS\n'+String(e.message||e)+'\n\nSila hantar semula.');}
      }
      if (pendingInput?.type === 'posting_name' && pendingInput.chatId === chatId) {
        const ownerType = pendingInput.ownerType;
        try {
          const client=pendingInput.clientId?getClient(clientsDbPath,pendingInput.clientId):null;
          if(ownerType==='CLIENT'&&!client)throw new Error('Pilih client dahulu melalui .mula client.');
          const posting = createPosting(databasePath, { ownerType, displayName: route.text });
          if(client){try{linkClientPosting(clientsDbPath,client.id,posting.id,posting.displayName);setPostingClient(databasePath,posting.id,client);}catch(e){deletePosting(databasePath,posting.id);throw e;}}
          postingUi = { chatId, postingId: posting.id, adNo: 1 };
          pendingInput = { type: 'posting_ad_content', chatId, postingId: posting.id, adNo: 1 };
          await sendScreen(chatId, `✅ POSTING DIKUNCI\n\nJenis : ${posting.ownerType === 'CLIENT' ? '💼 Client' : '📢 Sendiri'}\n${posting.ownerType === 'CLIENT' ? 'Client' : 'Nama'} : ${posting.displayName}`);
          return sendScreen(chatId, postingAdInputMessage(posting, 1));
        } catch (error) {
          return sendScreen(chatId, `⚠️ MULA POSTING\n${String(error.message || error)}\n\n→ .mula`);
        }
      }
      if(pendingInput?.type==='posting_charge'&&pendingInput.chatId===chatId){
        try{const posting=setPostingCharge(databasePath,pendingInput.postingId,moneyToCents(route.text));pendingInput=null;return chargeOrSchedule(chatId,posting,getPostingPlan(databasePath,posting.id));}
        catch(e){return sendScreen(chatId,'⚠️ '+e.message+'\n✍️ Hantar jumlah caj semula.');}
      }
      if (pendingInput?.type === 'posting_target_success' && pendingInput.chatId === chatId) {
        const input = pendingInput;
        const target = Number(String(route.text || '').trim());
        if (!Number.isInteger(target) || target < 1) return sendScreen(chatId, `⚠️ JUMLAH SUCCESS\nTaip nombor bulat sahaja, contoh: 100\n\n❌ BATAL\n→ .mula-cancel`);
        try {
          const plan = setPostingSuccessTarget(databasePath, input.postingId, target, 'REPEAT');
          pendingInput = {type:'posting_reuse_input',chatId,postingId:input.postingId};
          const posting = getPosting(databasePath, input.postingId);
          postingUi = { chatId, postingId: posting.id, adNo: postingUi?.adNo || null };
          if(isClientPosting(posting))return chargeOrSchedule(chatId,posting,plan);
          return sendScreen(chatId, postingReuseMessage(posting, plan));
        } catch (error) {
          return sendScreen(chatId, `⚠️ JUMLAH SUCCESS\n${String(error.message || error)}\n\nTaip target baru atau tukar akaun → .pilih-akaun`);
        }
      }
      if (pendingInput?.type === 'posting_target_days' && pendingInput.chatId === chatId) {
        const input = pendingInput;
        const days = Number(String(route.text || '').trim());
        if (!Number.isInteger(days) || days < 1) return sendScreen(chatId, '⚠️ TEMPOH HARI\nTaip nombor bulat sahaja, contoh: 3\n\n→ .target');
        try {
          const plan = setPostingDaysTarget(databasePath, input.postingId, days);
          pendingInput = null;
          const posting = getPosting(databasePath, input.postingId);
          return chargeOrSchedule(chatId,posting,plan);
        } catch (error) {
          return sendScreen(chatId, `⚠️ TEMPOH HARI\n${String(error.message || error)}\n\nTaip semula atau → .target`);
        }
      }
      if (pendingInput?.type?.startsWith('posting_setting_') && pendingInput.chatId === chatId) {
        const input=pendingInput,draft={...(input.draft||{})},step=input.type.slice(16),text=String(route.text||'').trim(),v=text.split(/\s+/).map(Number);
        try{
          if(step==='confirm'){
            if(text.toUpperCase()!=='YA')throw new Error('Balas YA untuk simpan atau .kembali untuk ubah.');
            updatePostingScheduleSettings(databasePath,input.postingId,draft);
            return showPostingReview(chatId,input.postingId);
          }
          if(!text||!v.every(Number.isInteger))throw new Error('Masukkan nombor bulat.');
          let next;
          if(step==='delay'){
            if(v.length===2){if(v[0]<10||v[1]<v[0]||v[1]>3600)throw new Error('Delay 10–3600 saat; maksimum ≥ minimum.');draft.delayMinSec=v[0];draft.delayMaxSec=v[1];next='batch';}
            else{if(v.length!==1||v[0]<10||v[0]>3600)throw new Error('Delay minimum 10–3600 saat.');draft.delayMinSec=v[0];next='delay_max';}
          }else if(step==='delay_max'){if(v.length!==1||v[0]<draft.delayMinSec||v[0]>3600)throw new Error('Maksimum mesti ≥ minimum dan ≤ 3600 saat.');draft.delayMaxSec=v[0];next='batch';}
          else if(step==='batch'){if(v.length!==1||v[0]<1||v[0]>100)throw new Error('Batch mesti 1–100 proses.');draft.batchSize=v[0];next='rest';}
          else if(step==='rest'){
            if(v.length===2){if(v[0]<0||v[1]<v[0]||v[1]>360)throw new Error('Rehat 0–360 minit; maksimum ≥ minimum.');draft.restMinSec=v[0]*60;draft.restMaxSec=v[1]*60;next='confirm';}
            else{if(v.length!==1||v[0]<0||v[0]>360)throw new Error('Rehat minimum 0–360 minit.');draft.restMinSec=v[0]*60;next='rest_max';}
          }else if(step==='rest_max'){if(v.length!==1||v[0]*60<draft.restMinSec||v[0]>360)throw new Error('Rehat maksimum ≥ minimum dan ≤ 360 minit.');draft.restMaxSec=v[0]*60;next='confirm';}
          pendingInput={type:'posting_setting_'+next,chatId,postingId:input.postingId,draft};
          return sendScreen(chatId,postingSchedulePromptMessage(next,draft));
        }catch(error){return sendScreen(chatId,'⚠️ TETAPAN TIDAK SAH\n'+error.message+'\n✖️ ↳ .batal → Keluar & Simpan Draf');}
      }
      if (['posting_ad_content', 'posting_ad_edit'].includes(pendingInput?.type) && pendingInput.chatId === chatId) {
        if (await acceptPostingAdContent(route, 'TEXT')) return;
      }
      if (pendingInput?.type === 'button_label' && pendingInput.chatId === chatId) {
        const label = String(route.text || '').trim();
        if (!label || label.length > 64) return sendScreen(chatId, '⚠️ BUTTON\nNama button mesti 1–64 aksara.\n\nTaip semula atau batal → .button-cancel');
        const { posting, ad } = resolvePostingAd(pendingInput.adNo);
        if (!posting || !ad) { pendingInput = null; return sendScreen(chatId, '⚠️ BUTTON\nIklan tidak ditemui.\n\n→ .iklan-urus'); }
        pendingInput = { type: 'button_url', chatId, postingId: posting.id, adNo: ad.adNo, label };
        return sendScreen(chatId, postingButtonUrlPromptMessage(ad, Number((ad.buttons || []).length) + 1, label));
      }
      if (pendingInput?.type === 'button_url' && pendingInput.chatId === chatId) {
        const input = pendingInput;
        try {
          const button = addPostingButton(databasePath, input.postingId, input.adNo, { label: input.label, url: route.text });
          pendingInput = null;
          const posting = getPosting(databasePath, input.postingId);
          const ad = getPostingAd(databasePath, input.postingId, input.adNo);
          postingUi = { chatId, postingId: posting.id, adNo: ad.adNo };
          return sendScreen(chatId, postingButtonSavedMessage(posting, ad, ad.buttons || [button]));
        } catch (error) {
          return sendScreen(chatId, `⚠️ LINK BUTTON\n${String(error.message || error)}\n\nHantar link semula atau batal → .button-cancel`);
        }
      }
      if (pendingInput?.type === 'button_edit_label' && pendingInput.chatId === chatId) {
        const label = String(route.text || '').trim();
        if (!label || label.length > 64) return sendScreen(chatId, '⚠️ EDIT BUTTON\nNama button mesti 1–64 aksara.\n\nTaip semula atau batal → .button-cancel');
        const input = pendingInput;
        pendingInput = { ...input, type: 'button_edit_url', label };
        return sendScreen(chatId, `🔗 EDIT LINK BUTTON\n↳ ${label}\n\nMasukkan link baru.\n\n❌ BATAL\n→ .button-cancel`);
      }
      if (pendingInput?.type === 'button_edit_url' && pendingInput.chatId === chatId) {
        const input = pendingInput;
        try {
          updatePostingButton(databasePath, input.postingId, input.adNo, input.buttonNo, { label: input.label, url: route.text });
          pendingInput = null;
          const posting = getPosting(databasePath, input.postingId);
          const ad = getPostingAd(databasePath, input.postingId, input.adNo);
          postingUi = { chatId, postingId: posting.id, adNo: ad.adNo };
          return sendScreen(chatId, `✅ BUTTON DIKEMAS KINI\n\n${postingButtonManageMessage(posting, ad)}`);
        } catch (error) {
          return sendScreen(chatId, `⚠️ EDIT BUTTON\n${String(error.message || error)}\n\nHantar link semula atau batal → .button-cancel`);
        }
      }
      return sendScreen(chatId, helpMessage());
    }
    case 'photo': {
      if(pendingInput?.type==='gs_content' && String(pendingInput.chatId)===String(chatId)){
        try{return await saveGsInput(route,'PHOTO');}catch(e){return sendScreen(chatId,'⚠️ STATUS GAMBAR\n'+String(e.message||e)+'\n\nSila hantar semula.');}
      }
      if (['posting_ad_content', 'posting_ad_edit'].includes(pendingInput?.type) && pendingInput.chatId === chatId) {
        if (await acceptPostingAdContent(route, 'PHOTO')) return;
      }
      return sendScreen(chatId, helpMessage());
    }
    case 'video': {
      if(pendingInput?.type==='gs_content' && String(pendingInput.chatId)===String(chatId)){
        return sendScreen(chatId,'⚠️ GS NEXUS: video belum disahkan. Gunakan teks atau gambar + caption.');
      }
      if (['posting_ad_content', 'posting_ad_edit'].includes(pendingInput?.type) && pendingInput.chatId === chatId) {
        if (await acceptPostingAdContent(route, 'VIDEO')) return;
      }
      return sendScreen(chatId, helpMessage());
    }
    case 'document': {
      if(pendingInput?.type==='gs_content' && String(pendingInput.chatId)===String(chatId)){
        const mime=String(route.document?.mimeType||'').toLowerCase();
        try{
          if(['image/jpeg','image/png'].includes(mime)){route.media=route.document;return await saveGsInput(route,'PHOTO');}
          if(mime==='video/mp4')return sendScreen(chatId,'⚠️ Video Group Status belum disahkan. Gunakan gambar atau teks.');
          return sendScreen(chatId,'Hantar fail gambar JPEG/PNG atau video MP4 sahaja.');
        }catch(e){return sendScreen(chatId,'⚠️ STATUS MEDIA\n'+String(e.message||e));}
      }
      if (['posting_ad_content', 'posting_ad_edit'].includes(pendingInput?.type) && pendingInput.chatId === chatId) {
        const mime = String(route.document?.mimeType || '').toLowerCase();
        if (mime.startsWith('image/')) {
          route.media = route.document;
          if (await acceptPostingAdContent(route, 'PHOTO')) return;
        }
        if (mime.startsWith('video/')) {
          route.media = route.document;
          if (await acceptPostingAdContent(route, 'VIDEO')) return;
        }
      }
      return sendScreen(chatId, helpMessage());
    }
    case 'posting_new': {
      const draft=getUnstartedPosting(databasePath);postingUi=draft?{chatId,postingId:draft.id,adNo:null}:null;
      return sendScreen(chatId,postingNewMessage(draft,draft?postingSummary(draft.id):null));
    }
    case 'posting_self': {
      const draft = getUnstartedPosting(databasePath);
      if (draft) return sendScreen(chatId, postingNewMessage(draft));
      pendingInput = { type: 'posting_name', chatId, ownerType: 'SENDIRI' };
      postingUi = null;
      return sendScreen(chatId, postingNamePromptMessage('SENDIRI'));
    }
    case 'posting_cancel': {
      const posting=resolvePosting();
      if(!posting)return sendScreen(chatId,postingNewMessage());
      pendingInput={type:'posting_delete_confirm',chatId,postingId:posting.id,expires:Date.now()+120000};
      return sendScreen(chatId,`🗑️ BUANG DRAF KEMPEN?\n\n📋 ${posting.displayName}\n• Iklan, Button dan media draf ini akan dibuang.\n\n✅ ↳ Balas SAH → Buang Draf\n✖️ ↳ .batal → Kekalkan Draf`);
    }
    case 'ad_add': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ TAMBAH IKLAN\nTiada posting sedang disediakan.\n\n→ .mula');
      try { reopenPostingDraft(databasePath, posting.id); } catch (error) { return sendScreen(chatId, `⚠️ TAMBAH IKLAN\n${String(error.message || error)}\n\n→ .iklan-urus`); }
      const nextNo = listPostingAds(databasePath, posting.id).length + 1;
      postingUi = { chatId, postingId: posting.id, adNo: nextNo };
      pendingInput = { type: 'posting_ad_content', chatId, postingId: posting.id, adNo: nextNo };
      return sendScreen(chatId, postingAdInputMessage(posting, nextNo, { next: true }));
    }
    case 'ad_manage': {
      const posting = resolvePosting();
      return sendScreen(chatId, postingAdsManageMessage(posting ? postingAdSummary(databasePath, posting.id) : null,route.args?.[0]||1));
    }
    case 'ad_back': {
      const { posting, ad } = resolvePostingAd();
      return sendScreen(chatId, ad ? postingAdDetailMessage(posting, ad) : postingAdsManageMessage(posting ? postingAdSummary(databasePath, posting.id) : null));
    }
    case 'ad_detail': {
      const posting = resolvePosting();
      const adNo = Number(route.args?.[0] || 0);
      const ad = posting ? getPostingAd(databasePath, posting.id, adNo) : null;
      if (posting && ad) postingUi = { chatId, postingId: posting.id, adNo };
      return sendScreen(chatId, postingAdDetailMessage(posting, ad));
    }
    case 'ad_preview': {
      const posting = resolvePosting();
      const adNo = Number(route.args?.[0] || 0);
      const ad = posting ? getPostingAd(databasePath, posting.id, adNo) : null;
      if (!posting || !ad) return sendScreen(chatId, '⚠️ PREVIEW\nIklan tidak ditemui.\n\n→ .iklan-urus');
      postingUi = { chatId, postingId: posting.id, adNo };
      try { return await sendPostingPreview(chatId, posting, ad); }
      catch (error) { return sendScreen(chatId, `⚠️ PREVIEW GAGAL\n${String(error.message || error)}\n\n→ .iklan ${adNo}`); }
    }
    case 'ad_edit': {
      const posting = resolvePosting();
      const adNo = Number(route.args?.[0] || 0);
      const ad = posting ? getPostingAd(databasePath, posting.id, adNo) : null;
      if (!posting || !ad) return sendScreen(chatId, '⚠️ EDIT IKLAN\nIklan tidak ditemui.\n\n→ .iklan-urus');
      try { reopenPostingDraft(databasePath, posting.id); } catch (error) { return sendScreen(chatId, `⚠️ EDIT IKLAN\n${String(error.message || error)}\n\n→ .iklan-urus`); }
      postingUi = { chatId, postingId: posting.id, adNo };
      pendingInput = { type: 'posting_ad_edit', chatId, postingId: posting.id, adNo };
      return sendScreen(chatId, `✏️ EDIT IKLAN ${String(adNo).padStart(2, '0')} · ${posting.displayName.toUpperCase()}\n↳ Hantar teks, gambar + caption atau video + caption baru.\n↳ Button sedia ada akan dikekalkan.\n\n❌ BATAL\n→ .iklan ${adNo}`);
    }
    case 'ad_delete': {
      const posting=resolvePosting(),adNo=Number(route.args?.[0]||0);
      const ad=posting?getPostingAd(databasePath,posting.id,adNo):null;
      if(!ad)return sendScreen(chatId,'⚠️ Iklan tidak ditemui.\n↩️ ↳ .iklan-urus → Senarai Iklan');
      pendingInput={type:'posting_ad_delete_confirm',chatId,postingId:posting.id,adId:ad.id,adNo,expires:Date.now()+120000};
      return sendScreen(chatId,`🗑️ PADAM IKLAN?\n\n📋 ${posting.displayName}\n📝 Iklan ${adNo}\n• Kandungan dan Button iklan ini akan dibuang.\n\n✅ ↳ Balas SAH → Padam Iklan\n✖️ ↳ .batal → Kekalkan Iklan`);
    }
    case 'button_add': {
      const { posting, ad } = route.args?.[0]?resolvePostingAd(Number(route.args[0])):resolveSelectedPostingAd();
      if (!posting || !ad) return sendScreen(chatId, '⚠️ BUTTON\nPilih iklan dahulu.\n\n→ .iklan-urus');
      const buttons = ad.buttons || [];
      if (buttons.length >= 2) return sendScreen(chatId, postingButtonManageMessage(posting, ad));
      postingUi = { chatId, postingId: posting.id, adNo: ad.adNo };
      pendingInput = { type: 'button_label', chatId, postingId: posting.id, adNo: ad.adNo };
      return sendScreen(chatId, postingButtonNamePromptMessage(ad, buttons.length + 1));
    }
    case 'button_skip':
    case 'button_done': {
      const { posting, ad } = route.args?.[0]?resolvePostingAd(Number(route.args[0])):resolveSelectedPostingAd();
      if (!posting || !ad) return sendScreen(chatId, '⚠️ IKLAN\nIklan tidak ditemui.\n\n→ .iklan-urus');
      pendingInput = null;
      return sendScreen(chatId, adDoneScreen(posting, ad.adNo));
    }
    case 'button_cancel': {
      pendingInput = null;
      const { posting, ad } = resolveSelectedPostingAd();
      if (!posting || !ad) return sendScreen(chatId, '↩️ DIBATALKAN\n\n→ .iklan-urus');
      return sendScreen(chatId, postingButtonManageMessage(posting, ad));
    }
    case 'button_manage': {
      const posting = resolvePosting();
      const adNo = Number(route.args?.[0] || postingUi?.adNo || 0);
      const ad = posting ? getPostingAd(databasePath, posting.id, adNo) : null;
      if (posting && ad) postingUi = { chatId, postingId: posting.id, adNo };
      return sendScreen(chatId, postingButtonManageMessage(posting, ad));
    }
    case 'button_edit': {
      const { posting, ad } = resolveSelectedPostingAd();
      if (!posting || !ad) return sendScreen(chatId, '⚠️ EDIT BUTTON\nPilih iklan dahulu.\n\n→ .iklan-urus');
      const buttons = ad.buttons || [];
      if (!buttons.length) return sendScreen(chatId, postingButtonManageMessage(posting, ad));
      const requested = Number(route.args?.[0] || 0);
      if (!requested && buttons.length > 1) return sendScreen(chatId, postingButtonSelectMessage('edit', ad, buttons));
      const buttonNo = requested || Number(buttons[0].buttonNo);
      const button = buttons.find(item => Number(item.buttonNo) === buttonNo);
      if (!button) return sendScreen(chatId, postingButtonSelectMessage('edit', ad, buttons));
      pendingInput = { type: 'button_edit_label', chatId, postingId: posting.id, adNo: ad.adNo, buttonNo };
      return sendScreen(chatId, `✏️ EDIT BUTTON ${String(buttonNo).padStart(2, '0')}\n↳ Sekarang: ${button.label}\n\nTaip nama button baru.\n\n❌ BATAL\n→ .button-cancel`);
    }
    case 'button_delete': {
      const { posting, ad } = resolveSelectedPostingAd();
      if (!posting || !ad) return sendScreen(chatId, '⚠️ PADAM BUTTON\nPilih iklan dahulu.\n\n→ .iklan-urus');
      const buttons = ad.buttons || [];
      if (!buttons.length) return sendScreen(chatId, postingButtonManageMessage(posting, ad));
      const requested = Number(route.args?.[0] || 0);
      if (!requested && buttons.length > 1) return sendScreen(chatId, postingButtonSelectMessage('delete', ad, buttons));
      const buttonNo = requested || Number(buttons[0].buttonNo);
      const removed = deletePostingButton(databasePath, posting.id, ad.adNo, buttonNo);
      if (!removed) return sendScreen(chatId, postingButtonManageMessage(posting, getPostingAd(databasePath, posting.id, ad.adNo)));
      const refreshed = getPostingAd(databasePath, posting.id, ad.adNo);
      return sendScreen(chatId, `✅ BUTTON DIPADAM\n\n${postingButtonManageMessage(posting, refreshed)}`);
    }
    case 'ad_done': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ IKLAN\nTiada posting sedang disediakan.\n\n→ .mula');
      try {
        markPostingReady(databasePath, posting.id);
        pendingInput = null;
        postingUi = { chatId, postingId: posting.id, adNo: listPostingAds(databasePath, posting.id).at(-1)?.adNo || null };
        return sendScreen(chatId, postingAdsReadyMessage(postingAdSummary(databasePath, posting.id)));
      } catch (error) {
        return sendScreen(chatId, `⚠️ IKLAN BELUM SIAP\n${String(error.message || error)}\n\n→ .iklan-tambah`);
      }
    }
    case 'posting_account_select': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ PILIH AKAUN\nTiada posting yang sedia.\n\n→ .mula');
      if (posting.status !== 'READY') return sendScreen(chatId, '⚠️ PILIH AKAUN\nSelesaikan iklan dahulu.\n\n→ .iklan-siap');
      postingUi = { chatId, postingId: posting.id, adNo: postingUi?.adNo || null };
      pendingInput={type:'posting_account_input',chatId,postingId:posting.id};
      return sendScreen(chatId, postingAccountSelectMessage(posting, listWhatsAppAccounts(databasePath), getPostingPlan(databasePath, posting.id),route.args?.[0]||1));
    }
    case 'posting_account_choose': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ PILIH AKAUN\nTiada posting yang sedia.\n\n→ .mula');
      if (posting.status !== 'READY') return sendScreen(chatId, '⚠️ PILIH AKAUN\nSelesaikan iklan dahulu.\n\n→ .iklan-siap');
      try {
        const selected = normalizePostingAccountSelection(route.args?.[0]);
        const plan = savePostingPlanAccounts(databasePath, posting.id, selected);
        postingUi = { chatId, postingId: posting.id, adNo: postingUi?.adNo || null };
        pendingInput = {type:'posting_mode_input',chatId,postingId:posting.id};
        return sendScreen(chatId, postingTargetModeMessage(posting, plan));
      } catch (error) {
        pendingInput={type:'posting_account_input',chatId,postingId:posting.id};
        return sendScreen(chatId, `⚠️ PILIH AKAUN\n${String(error.message || error)}\n\n↩️ ↳ .pilih-akaun → Pilih Semula`);
      }
    }
    case 'posting_target_mode': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ MODE POSTING\nTiada posting yang sedia.\n\n→ .mula');
      const plan = getPostingPlan(databasePath, posting.id);
      pendingInput={type:'posting_mode_input',chatId,postingId:posting.id};
      return sendScreen(chatId, postingTargetModeMessage(posting, plan));
    }
    case 'posting_target_success': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ JUMLAH SUCCESS\nTiada posting yang sedia.\n\n→ .mula');
      try {
        const plan = setPostingCampaignMode(databasePath, posting.id, 'SUCCESS');
        pendingInput = { type: 'posting_target_success', chatId, postingId: posting.id };
        return sendScreen(chatId, postingTargetSuccessMessage(posting, plan));
      } catch (error) { return sendScreen(chatId, `⚠️ MODE SUCCESS\n${String(error.message || error)}\n\n→ .pilih-akaun`); }
    }
    case 'posting_target_days': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ TEMPOH HARI\nTiada posting yang sedia.\n\n→ .mula');
      try {
        const plan = setPostingCampaignMode(databasePath, posting.id, 'DAYS');
        pendingInput = { type: 'posting_target_days', chatId, postingId: posting.id };
        return sendScreen(chatId, postingTargetDaysMessage(posting, plan));
      } catch (error) { return sendScreen(chatId, `⚠️ MODE HARI\n${String(error.message || error)}\n\n→ .pilih-akaun`); }
    }
    case 'posting_target_continuous': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ BERTERUSAN\nTiada posting yang sedia.\n\n→ .mula');
      try {
        const plan = setPostingContinuous(databasePath, posting.id);
        pendingInput = null;
        return chargeOrSchedule(chatId,posting,plan);
      } catch (error) { return sendScreen(chatId, `⚠️ BERTERUSAN\n${String(error.message || error)}\n\n→ .pilih-akaun`); }
    }
    case 'posting_reuse_repeat':
    case 'posting_reuse_unique': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ GROUP REUSE\nTiada posting yang sedia.\n\n→ .mula');
      try {
        const plan = setPostingReuseMode(databasePath, posting.id, route.action === 'posting_reuse_unique' ? 'UNIQUE' : 'REPEAT');
        return chargeOrSchedule(chatId,posting,plan);
      } catch (error) { return sendScreen(chatId, `⚠️ GROUP REUSE\n${String(error.message || error)}\n\n→ .reuse ulang`); }
    }
    case 'posting_system_defaults': {
      try{
        if(route.args?.[0]){const v=String(route.args[0]).trim().split(/\s+/).map(Number);if(v.length!==5)throw new Error('Gunakan 5 nilai: delay min/max (saat), batch, rehat min/max (minit).');setPostingDefaults(databasePath,{delayMinSec:v[0],delayMaxSec:v[1],batchSize:v[2],restMinSec:v[3]*60,restMaxSec:v[4]*60});}
        const d=getPostingDefaults(databasePath);return sendScreen(chatId,`⚙️ DEFAULT AUTO POST\n⏱ Delay : ${d.delayMinSec}–${d.delayMaxSec}s\n📦 Rehat Selepas : ${d.batchSize} proses\n💤 Rehat : ${d.restMinSec/60}–${d.restMaxSec/60} minit\n\n✍️ Contoh: .system-posting 60 120 5 5 10\n• Terpakai kepada draf baharu. Kempen lama mengekalkan tetapan.\n↩️ ↳ .system → Tetapan Sistem`);
      }catch(error){return sendScreen(chatId,'⚠️ '+error.message);}
    }
    case 'posting_charge': {
      const posting=getUnstartedPosting(databasePath);
      if(!isClientPosting(posting))return sendScreen(chatId,'⚠️ Pilih draf client melalui .mula client.');
      pendingInput={type:'posting_charge',chatId,postingId:posting.id};
      return sendScreen(chatId,clientChargeMessage(posting));
    }
    case 'posting_setting': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ SETTING POSTING\nTiada posting yang sedia.\n\n→ .mula');
      return chargeOrSchedule(chatId,posting,getPostingPlan(databasePath, posting.id));
    }
    case 'posting_setting_default': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ SETTING POSTING\nTiada posting yang sedia.\n\n→ .mula');
      const plan = updatePostingScheduleSettings(databasePath, posting.id, getPostingDefaults(databasePath));
      return showPostingReview(chatId,posting.id);
    }
    case 'posting_setting_custom': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ CUSTOM SETTING\nTiada posting yang sedia.\n\n→ .mula');
      pendingInput = { type: 'posting_setting_delay', chatId, postingId: posting.id, draft: {} };
      return sendScreen(chatId, postingSchedulePromptMessage('delay'));
    }
    case 'posting_review': {
      const posting = resolvePosting();
      if (!posting) return sendScreen(chatId, '⚠️ SEMAK POSTING\nTiada posting yang sedia.\n\n→ .mula');
      return showPostingReview(chatId,posting.id);
    }
    case 'system': {
      const wa = whatsappAccountSummary(databasePath);
      return sendScreen(chatId, systemMessage({ build, stage, whatsapp: wa, autoMarkRead: getWhatsAppAutoMarkRead(databasePath) }));
    }
    case 'auto_read': return sendScreen(chatId, autoReadMessage(getWhatsAppAutoMarkRead(databasePath)));
    case 'auto_read_on': {
      setWhatsAppAutoMarkRead(databasePath, true);
      return sendScreen(chatId, `✅ AUTO MARK READ DIAKTIFKAN\n\n${autoReadMessage(true)}`);
    }
    case 'auto_read_off': {
      setWhatsAppAutoMarkRead(databasePath, false);
      return sendScreen(chatId, `❌ AUTO MARK READ DIMATIKAN\n\n${autoReadMessage(false)}`);
    }
    case 'system_status': { const wa = whatsappAccountSummary(databasePath); return sendScreen(chatId, statusMessage({ build, botUsername: bot.username, ownerUserId: ownerId, verified: true, whatsapp: wa })); }
    case 'system_check': return sendScreen(chatId, systemCheckMessage(whatsappAccountSummary(databasePath)));
    case 'storage': return sendScreen(chatId, currentStorageMessage());
    case 'storage_clean': {
      const target = String(route.args?.[0] || '').toLowerCase();
      const confirm = String(route.args?.[1] || '').toLowerCase() === 'confirm';
      if (!['temp','logs','media','all'].includes(target)) return sendScreen(chatId, currentStorageMessage());
      if (!confirm) return sendScreen(chatId, storageCleanupPrompt(target));
      try {
        const result = runStorageCleanup(target);
        return sendScreen(chatId, [
          '✅ STORAGE CLEANUP SELESAI', '',
          `Target          : ${target.toUpperCase()}`,
          `Fail dibersih   : ${Number(result.files || 0)}`,
          `Ruang dibebas   : ${bytesToHuman(result.bytes || 0)}`,
          result.media?.skippedRecent ? `Media baru skip : ${result.media.skippedRecent}` : '',
          result.skippedRecent ? `Media baru skip : ${result.skippedRecent}` : '',
          '',
          currentStorageMessage()
        ].filter(Boolean).join('\n'));
      } catch (error) {
        return sendScreen(chatId, `⚠️ STORAGE CLEANUP BELUM SELESAI\n\n${String(error?.message || error)}\n\n→ .storage`);
      }
    }
    case 'version': return sendScreen(chatId, versionMessage({ build, stage }));
    case 'help': return sendScreen(chatId, helpMessage());
    case 'help_client':
    case 'help_group_status':
    case 'help_records':
    case 'help_problem':
    case 'help_whatsapp':
    case 'help_join':
    case 'help_group':
    case 'help_posting':
    case 'help_manage':
    case 'help_report':
    case 'help_system':
      return sendScreen(chatId, helpTopicMessage(route.action));
    case 'ping': return sendScreen(chatId, '🏓 PONG\nWAPromoBot Controller ONLINE');
    case 'posting_refresh': return sendScreen(chatId, postingActiveMessage());
    case 'records_refresh': return sendScreen(chatId, recordsMessage());
    case 'report_refresh': return sendScreen(chatId, reportMessage());
    default: return sendMenu(chatId);
  }
}

function enableStopKey() {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  stopKeyHandler = data => {
    const value = data.toString('utf8');
    if (value.toLowerCase() === 'q' || value === '\u0003') requestStop('USER');
  };
  process.stdin.on('data', stopKeyHandler);
}

function restoreInput() {
  if (stopKeyHandler) {
    try { process.stdin.off('data', stopKeyHandler); } catch {}
    stopKeyHandler = null;
  }
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return;
  try { process.stdin.setRawMode(false); } catch {}
  process.stdin.pause();
}

process.once('SIGTERM', () => requestStop('SYSTEM'));
process.once('SIGHUP', () => requestStop('SYSTEM'));
process.once('SIGINT', () => requestStop('USER'));

try {
  enableStopKey();

  try {
    const pending = await retryTelegramCheck(() => getUpdates(token, undefined, 0, { signal: abort.signal }), { attempts: 2, delayMs: 1200 });
    for (const item of pending) offset = Math.max(offset ?? 0, Number(item.update_id) + 1);
  } catch (error) {
    if (!abort.signal.aborted) lastError = String(error?.message || 'Sambungan Telegram belum stabil.').slice(0, 44);
  }

  telegramConnected = true;
  lastAction = 'IDLE';
  render();
  startSystemMaintenance();
  ensureMiniApp().start().catch(()=>{});
  panelTimer = setInterval(() => {
    if (running) render();
  }, 5000);
  panelTimer.unref?.();
  try { await sendMenu(ownerId); await followupFlow.resumeNotice(ownerId); }
  catch (error) { lastError = String(error?.message || 'Telegram belum dapat menerima menu.').slice(0, 44); render(); }

  while (running) {
    try {
      const updates = await getUpdates(token, offset, 25, { signal: abort.signal });

      // A successful long-poll means Telegram connectivity has recovered.
      // Clear a stale RETRYING/error state even when there are no new updates,
      // so the live panel does not keep showing an old network warning.
      telegramRetryAttempt = 0;
      const recovered = telegramFailureStreak >= 2 || !telegramConnected || lastError !== '-';
      telegramFailureStreak = 0;
      telegramRetryInSec = 0;
      telegramConnected = true;
      lastError = '-';
      if (updates.length === 0) lastAction = 'IDLE';
      if (recovered) render();

      for (const update of updates) {
        offset = Math.max(offset ?? 0, Number(update.update_id) + 1);
        const route = routeTelegramUpdate(update, ownerId);
        if (route.action === 'ignore') {
          ignored += 1;
          lastAction = 'IGNORED';
          continue;
        }
        lastAction = 'PROSES ' + route.action.toUpperCase();
        render();
        try {
          await dispatch(route);
          lastAction = route.action.toUpperCase();
          lastError = '-';
        } catch (error) {
          if (!running || abort.signal.aborted) break;
          // A failed command reply must not abort the rest of this update batch
          // or be reported as a failed long-poll. Never replay the mutation.
          lastAction = route.action.toUpperCase() + ' · SEMAK BALASAN';
          lastError = friendlyUserError(error, 'Balasan belum dapat dihantar.').slice(0,44);
        }
        processed += 1;
      }
      if (updates.length) render();
    } catch (error) {
      if (!running || abort.signal.aborted) break;
      telegramRetryAttempt += 1;
      telegramFailureStreak += 1;
      const transient = isTransientTelegramError(error);
      const retryMs = transient ? telegramRetryDelayMs(telegramFailureStreak) : 5000;
      telegramRetryInSec = Math.ceil(retryMs / 1000);

      // One isolated transient poll failure is normal on a mobile network.
      // Keep the controller visibly CONNECTED and retry silently. Only expose
      // DEGRADED after two consecutive failures and RECONNECTING after three.
      if (transient && telegramFailureStreak === 1) {
        telegramConnected = true;
        lastError = '-';
      } else {
        telegramConnected = false;
        lastError = friendlyUserError(error, 'Sambungan Telegram tidak stabil.').slice(0, 44);
        render();
      }
      await new Promise(resolve => setTimeout(resolve, retryMs));
    }
  }
} finally {
  if (panelTimer) {
    clearInterval(panelTimer);
    panelTimer = null;
  }

  if (stopRequested) renderStopping('Menyimpan progress...');

  // Controller berhenti bermaksud runner Auto Join juga berhenti. Simpan state
  // sebagai resumable sekarang, bukan tunggu startup seterusnya.
  joinRunner.close();
  joinFlow.close();
  groupFlow.close();
  memberExportFlow.close();
  followupFlow.close();
  postingLive.close();closeSystemFlow();miniApp?.close();
  closeGsLive();
  clientFlow.close();
  try { recoverAutoJoinJobs(databasePath);
recoverPostingJobs(databasePath);
recoverGsJobs(databasePath);
 } catch {}
  try { await accountFlow.close(); } catch {}
  try { await whatsapp.stop(); } catch {}

  restoreInput();
  try { releaseLock(); } catch {}
  restoreWhatsAppNoiseFilter();

  if (shutdownFallback) {
    clearTimeout(shutdownFallback);
    shutdownFallback = null;
  }

  if (stopRequested) {
    renderStopping('Selesai · kembali ke Control Panel...');
    // Paksa child process tamat selepas semua state penting disimpan. Ini
    // mengelakkan handle Baileys/network tertinggal dan nampak seperti stuck.
    process.exit(0);
  }

  clearScreen();
}
