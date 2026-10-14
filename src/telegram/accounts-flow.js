import { accountActiveCampaignCount, accountDependencies, findWhatsAppAccountByPhone, assertAccountAvailableForRemoval, listWhatsAppGroups } from '../whatsapp/store.js';
import { normalizePhone } from '../whatsapp/manager.js';
import * as ui from './accounts-ui.js';
import { groupListMessage } from './controller.js';

// This flow belongs to the existing owner controller. Database and campaign
// operations always receive internal IDs; screen numbers are resolved here.
export class AccountsFlow {
  constructor({ manager, databasePath, send, photo, removeMessage = async () => {}, now = Date.now }) {
    Object.assign(this, { manager, databasePath, send, photo, removeMessage, now });
    this.selection = null;
    this.state = null;
    this.tasks = new Set();
  }
  accounts() { return this.manager.list(); }
  fingerprint() { return this.accounts().map(a => a.id).join(','); }
  capture() { this.selection = this.fingerprint(); }
  enrich(a) {
    return a && { ...a, activeCampaigns:accountActiveCampaignCount(this.databasePath,a.id),
      reconnecting:this.manager.reconnectTimers?.has(a.id) || false };
  }
  resolve(value) {
    if (this.selection === null || this.selection !== this.fingerprint()) throw new Error('Senarai akaun telah berubah atau belum dibuka. Pilih semula daripada senarai terkini.');
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new Error('Nombor akaun tidak sah.');
    const a = this.accounts().find(x => ui.accountNumber(x) === n);
    if (!a) throw new Error('Akaun tidak ditemui dalam senarai terkini.');
    return a;
  }
  mapRoute(input) {
    const route = { ...input,args:[...(input.args || [])] };
    const single = new Set(['join_select','group_account','group_info','group_sync','gs_groups','gs_retry_account']);
    if (single.has(route.action) && route.args[0] && route.args[0] !== 'all') route.args[0]=String(this.resolve(route.args[0]).id);
    if (['posting_account_choose','gs_accounts'].includes(route.action) && route.args[0] !== 'all') {
      route.args[0]=route.args[0].split(',').map(n=>this.resolve(n).id).join(',');
    }
    if (route.action === 'gs_target' && route.args[0] !== 'all') {
      route.args[0]=route.args[0].split(',').map(pair=>{const [n,position]=pair.split(':');return this.resolve(n).id+':'+position;}).join(',');
    }
    return route;
  }
  async list(chatId, page = 1, note = '') {
    this.capture();
    await this.send(chatId, (note ? `⚠️ ${note}\n\n` : '') + ui.whatsappMessage(this.accounts(),page));
  }
  async detail(chatId, a) { await this.send(chatId,ui.whatsappAccountMessage(this.enrich(this.manager.get(a.id)))); }
  safe(task) {
    const pending = Promise.resolve(task).catch(() => {}).finally(() => this.tasks.delete(pending));
    this.tasks.add(pending); return pending;
  }
  async idle() { await Promise.all([...this.tasks]); }
  async cancel() {
    const previous = this.state;
    this.state = null;
    if (!previous) return;
    previous.cancelled = true;
    if (previous.internalId) await this.manager.cancelLogin(previous.internalId);
    if (previous.qrMessageId) this.safe(this.removeMessage(previous.chatId,previous.qrMessageId));
  }
  async render(state = this.state) {
    if (!state) return;
    if (state.step === 'METHOD') return this.send(state.chatId,ui.whatsappLoginMessage([],state.account));
    if (state.step === 'PHONE') return this.send(state.chatId,ui.whatsappPairPromptMessage(state.account));
    if (state.step === 'REVIEW') return this.send(state.chatId,ui.whatsappPairReviewMessage(state.phone));
    if (state.step === 'CONFIRM') return this.send(state.chatId,ui.whatsappConfirmMessage(state.action,state.account));
    if (state.code) return this.send(state.chatId,ui.whatsappPairCodeMessage({phone:state.phone},state.code));
    return this.send(state.chatId,state.method === 'qr' ? ui.whatsappQrMessage() :
      '📲 PAIRING CODE\n⏳ Sedang mendapatkan kod sebenar…\n\n✖️ ↳ .batal → Batal');
  }
  async start(chatId, account = null) {
    if (this.state?.step && this.state.step !== 'CONFIRM') return this.render();
    await this.cancel();
    if (account) {
      if (account.status === 'ONLINE') throw new Error('Akaun masih ONLINE. Gunakan Sambung Semula pada halaman akaun.');
    }
    this.state = { step:'METHOD',chatId,account,expires:this.now()+300000,queue:Promise.resolve() };
    await this.render();
  }
  launch(state, method) {
    state.step = 'WAITING'; state.method = method; state.expires = this.now()+180000;
    state.queue = state.queue.catch(() => {}).then(() => state.cancelled ? undefined : this.send(state.chatId,
      method === 'qr' ? '🔳 SCAN QR\n⏳ Sedang menjana QR sebenar…\n✖️ ↳ .batal → Batal' : '📲 PAIRING CODE\n⏳ Sedang mendapatkan kod sebenar…\n✖️ ↳ .batal → Batal'));
    this.safe(state.queue);
    const events = event => this.event(state,event);
    // Start immediately, but do not hold the Telegram polling loop while the
    // socket generates a pairing code. .batal and other accounts stay usable.
    const task = method === 'qr'
      ? state.account ? this.manager.replaceQr(state.account.id,events) : this.manager.createQr(events)
      : state.account ? this.manager.replacePairing(state.account.id,state.phone,events) : this.manager.createPairing(state.phone,events);
    this.safe(Promise.resolve(task).catch(async error => {
      if (this.state !== state || state.cancelled) return;
      this.state = null; state.cancelled = true;
      if (state.qrMessageId) await this.removeMessage(state.chatId,state.qrMessageId).catch(() => {});
      await this.send(state.chatId,ui.whatsappLoginFailedMessage(this.reason(error),state.account));
    }));
  }
  reason(error) {
    const message = String(error?.message || error || 'Sambungan belum berjaya.');
    if (/format|kod negara|nombor|Nombor|sudah|Login semula|akaun asal|Akaun masih|Satu proses/.test(message)) return message.slice(0,200);
    if (/timeout|tamat|code belum|masa/i.test(message)) return 'Proses login telah tamat masa.';
    return 'Sambungan WhatsApp belum berjaya. Semak internet dan cuba semula.';
  }
  event(state,event) {
    if (this.state !== state || state.cancelled) return;
    if (event.type === 'created') { state.internalId = event.account.id; return; }
    if (event.type === 'status' || event.type === 'pairing_restart') return;
    if (event.type === 'pairing_code') state.code = event.code;
    if (event.type === 'connected') {
      // Connection is already committed by the manager. Telegram notification
      // errors must not undo it or remove its session.
      this.state = null; state.cancelled = true; this.capture();
      this.safe(state.queue.then(async () => {
        if (state.qrMessageId) await this.removeMessage(state.chatId,state.qrMessageId).catch(() => {});
        await this.send(state.chatId,ui.whatsappConnectedMessage(this.manager.get(event.account.id) || event.account));
      }));
      return;
    }
    if (['error','login_failed','login_timeout','pairing_ready_timeout'].includes(event.type)) {
      this.state = null; state.cancelled = true;
      this.safe(state.queue.then(async () => {
        if (state.internalId) await this.manager.cancelLogin(state.internalId);
        if (state.qrMessageId) await this.removeMessage(state.chatId,state.qrMessageId).catch(() => {});
        await this.send(state.chatId,ui.whatsappLoginFailedMessage(event.reason || this.reason(event.error || 'timeout'),state.account));
      }));
      return;
    }
    state.queue = state.queue.catch(() => {}).then(async () => {
      if (state.cancelled) return;
      if (event.type === 'pairing_code') return this.render(state);
      if (event.type === 'qr') {
        const result = await this.photo(state.chatId,event.qr,ui.whatsappQrMessage(),state.qrMessageId);
        state.qrMessageId = result?.message_id || state.qrMessageId;
        if (state.cancelled && state.qrMessageId) await this.removeMessage(state.chatId,state.qrMessageId).catch(() => {});
      }
    });
    this.safe(state.queue);
  }
  async confirm(state) {
    if (this.now() > state.expires || this.selection !== this.fingerprint()) {
      await this.cancel(); return this.list(state.chatId,1,'Pengesahan tamat atau senarai berubah. Pilih akaun semula.');
    }
    const a = this.manager.get(state.account.id);
    if (!a || a.phone !== state.account.phone) {
      await this.cancel(); return this.list(state.chatId,1,'Identiti akaun telah berubah.');
    }
    // Consume before awaiting: SAH is one-use and can never act on a renumbered account.
    this.state = null;
    assertAccountAvailableForRemoval(this.databasePath,a.id);
    if (state.action === 'delete') await this.manager.delete(a.id);
    else await this.manager.logout(a.id);
    this.selection = null;
    await this.send(state.chatId,`${state.action === 'delete' ? '✅ AKAUN DIPADAM' : '✅ LOG KELUAR SELESAI'}\n\n${ui.accountIdentity(a)}\n📞 Nombor: +${a.phone}\n\n↩️ ↳ .accounts → Lihat senarai terkini`);
  }
  async handle(route) {
    if (route.action === 'wa_refresh') route = { ...route,action:'wa' };
    const chatId = route.chatId;
    const own = new Set(['wa','wa_login','wa_login_pair','wa_login_qr','wa_account','wa_replace','wa_reconnect','wa_logout','wa_delete','wa_account_group','wa_account_sync']);
    if (this.state && String(this.state.chatId) !== String(chatId)) return false;
    if (this.state && this.now() > this.state.expires) {
      await this.cancel();
      if (route.action === 'text') { await this.list(chatId,1,'Input telah tamat tempoh. Mulakan semula.'); return true; }
    }
    if (!own.has(route.action) && route.action !== 'text' && !['wa_cancel','wa_back'].includes(route.action)) {
      if (this.state) await this.cancel();
      return false;
    }
    if (['wa_cancel','wa_back'].includes(route.action) && !this.state) return false;
    if (route.action === 'text' && !this.state) return false;
    try {
      if (route.action === 'wa_cancel') { await this.cancel(); await this.list(chatId); return true; }
      if (route.action === 'wa_back') {
        const state = this.state;
        if (state.step === 'REVIEW') state.step = 'PHONE';
        else if (state.step === 'PHONE') state.step = 'METHOD';
        else { await this.cancel(); await this.list(chatId); return true; }
        await this.render(); return true;
      }
      if (route.action === 'wa') { await this.cancel(); await this.list(chatId,Number(route.args?.[0] || 1)); return true; }
      if (['wa_login','wa_login_pair','wa_login_qr'].includes(route.action)) {
        const wasActive = !!this.state && this.state.step !== 'CONFIRM';
        await this.start(chatId);
        if (!wasActive && route.action === 'wa_login_pair') { this.state.step='PHONE'; await this.render(); }
        if (!wasActive && route.action === 'wa_login_qr') { this.launch(this.state,'qr'); }
        return true;
      }
      if (route.action === 'text') {
        const state = this.state;
        const text = String(route.text || '').trim();
        if (state.step === 'METHOD') {
          if (text === '1') { state.step='PHONE'; await this.render(); }
          else if (text === '2') { this.launch(state,'qr'); }
          else await this.send(chatId,'Balas 1 untuk Pairing Code atau 2 untuk QR.\n✖️ ↳ .batal → Batal');
        } else if (state.step === 'PHONE') {
          const value = normalizePhone(text);
          const duplicate = findWhatsAppAccountByPhone(this.databasePath,value,state.account?.id);
          if (duplicate) {
            this.capture();
            await this.send(chatId,`⚠️ Nombor sudah didaftarkan.\n${ui.accountIdentity(duplicate)}\n🔎 ↳ .account ${ui.accountNumber(duplicate)} → Urus Akaun\n\nHantar nombor lain atau .batal.`);
          } else if (state.account && value !== normalizePhone(state.account.phone)) {
            await this.send(chatId,'⚠️ Gunakan nombor asal akaun ini. Nombor lain perlu ditambah melalui .login.');
          } else { state.phone=value; state.step='REVIEW'; await this.render(); }
        } else if (state.step === 'REVIEW') {
          if (text.toUpperCase() === 'YA') { this.launch(state,'pair'); }
          else await this.send(chatId,'Balas YA untuk mendapatkan kod, atau .kembali untuk betulkan nombor.');
        } else if (state.step === 'CONFIRM') {
          if (text.toUpperCase() === 'SAH') await this.confirm(state);
          else await this.send(chatId,'Balas SAH untuk tindakan pada akaun yang dipaparkan, atau .batal.');
        } else await this.render();
        return true;
      }
      // Account actions are resolved against the last displayed list, then
      // pinned to the immutable internal ID for all asynchronous work.
      await this.cancel();
      let a;
      try { a=this.resolve(route.args?.[0]); }
      catch (error) { await this.list(chatId,1,error.message); return true; }
      if (route.action === 'wa_account') await this.detail(chatId,a);
      if (route.action === 'wa_replace') await this.start(chatId,a);
      if (route.action === 'wa_account_group' && this.groupFlow) { await this.groupFlow.listAccount(chatId,a,Number(route.args?.[1]||1)); return true; }
      if (route.action === 'wa_account_group') await this.send(chatId,groupListMessage(a,listWhatsAppGroups(this.databasePath,a.id,{page:Number(route.args?.[1]||1)})));
      if (route.action === 'wa_reconnect') {
        if (a.status === 'LOGGED_OUT') { await this.detail(chatId,a); return true; }
        if (a.status === 'CONNECTING' || this.manager.connecting?.has(a.id)) {
          await this.send(chatId,`⏳ ${ui.accountIdentity(a)}\nSambungan sedang diproses.\n📱 ↳ .account ${ui.accountNumber(a)} → Urus Akaun`);
          return true;
        }
        await this.send(chatId,`🔌 SAMBUNG SEMULA\n↳ ${ui.accountIdentity(a)}\n\n⏳ Sedang menyambungkan akaun…\n• Sesi sedia ada dikekalkan.\n\n📱 ↳ .account ${ui.accountNumber(a)} → Urus Akaun`);
        this.safe(this.manager.reconnect(a.id).catch(() => this.send(chatId,`⚠️ Sambungan belum berjaya.\n📱 ↳ .account ${ui.accountNumber(a)} → Semak Akaun`)));
      }
      if (route.action === 'wa_account_sync') {
        if(this.groupFlow){await this.groupFlow.startSyncAccount(chatId,a);return true;}
        if (a.status !== 'ONLINE') throw new Error('Akaun perlu ONLINE sebelum sync group.');
        if (this.manager.groupSyncs?.has(a.id)) throw new Error('Sync akaun ini sedang berjalan. Sila tunggu.');
        await this.send(chatId,ui.accountSyncMessage(a));
        this.safe(this.manager.syncGroups(a.id).then(result => this.send(chatId,ui.accountSyncMessage(result.account,true)))
          .catch(() => this.send(chatId,`⚠️ SYNC GROUP GAGAL\n↳ ${ui.accountIdentity(a)}\nSenarai lengkap sebelumnya dikekalkan. Semak sambungan.\n\n🔄 ↳ .account-sync ${ui.accountNumber(a)} → Cuba Semula`)));
      }
      if (['wa_logout','wa_delete'].includes(route.action)) {
        const dependencies=accountDependencies(this.databasePath,a.id);
        if (dependencies.length) {
          await this.send(chatId,`⚠️ AKAUN MASIH DIGUNAKAN\n↳ ${ui.accountIdentity(a)}\n\n${dependencies.map(x=>'• '+x.name+' · '+x.status).join('\n')}\n\nHentikan kempen atau keluarkan akaun dahulu. Tunggu penghantaran selesai.\n\n⚡ ↳ .status → Kempen Aktif\n📱 ↳ .account ${ui.accountNumber(a)} → Urus Akaun`);
        } else {
          this.state={step:'CONFIRM',chatId,account:{...a},action:route.action==='wa_delete'?'delete':'logout',expires:this.now()+180000};
          await this.render();
        }
      }
      return true;
    } catch (error) {
      await this.send(chatId,'⚠️ '+this.reason(error)+'\n\n✖️ ↳ .batal → Batal\n↩️ ↳ .accounts → Senarai Akaun');
      return true;
    }
  }
  async close() { await this.cancel(); }
}
