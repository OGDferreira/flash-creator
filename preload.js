const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ---- Gmail / contas ----
  getData: () => ipcRenderer.invoke('get-data'),
  getCodesFor: (email) => ipcRenderer.invoke('get-codes-for', email),
  addAccount: (data) => ipcRenderer.invoke('add-account', data),
  removeAccount: (email) => ipcRenderer.invoke('remove-account', email),
  receiveCode: (data) => ipcRenderer.invoke('receive-code', data),
  setManualStatus: (email, status) => ipcRenderer.invoke('set-manual-status', { email, status }),
  getNextPartition: () => ipcRenderer.invoke('get-next-partition'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),

  // ---- config ----
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),

  // ---- servidor local (extensão) ----
  getServerInfo: () => ipcRenderer.invoke('server-info'),
  restartServer: () => ipcRenderer.invoke('server-restart'),
  regenToken: () => ipcRenderer.invoke('server-regen-token'),

  // ---- Dolphin: proxies ----
  proxyList: () => ipcRenderer.invoke('proxy-list'),
  proxyAdd: (text, defaultType, category) => ipcRenderer.invoke('proxy-add', { text, defaultType, category }),
  proxyRemoveUnused: () => ipcRenderer.invoke('proxy-remove-unused'),
  proxyResetUsed: () => ipcRenderer.invoke('proxy-reset-used'),
  proxyClear: () => ipcRenderer.invoke('proxy-clear'),

  // ---- Allan Proxys (API do fornecedor) ----
  allanTest: () => ipcRenderer.invoke('allan-test'),
  allanFetch: () => ipcRenderer.invoke('allan-fetch'),
  allanBalances: () => ipcRenderer.invoke('allan-balances'),
  allanRotate: (login) => ipcRenderer.invoke('allan-rotate', login),

  // ---- AllanSMS (números virtuais / OTP) ----
  smsTest: () => ipcRenderer.invoke('sms-test'),
  smsBalance: () => ipcRenderer.invoke('sms-balance'),
  smsCountries: () => ipcRenderer.invoke('sms-countries'),
  smsServices: (country, all) => ipcRenderer.invoke('sms-services', { country, all }),
  smsBuy: (opts) => ipcRenderer.invoke('sms-buy', opts),
  smsOrderGet: (id) => ipcRenderer.invoke('sms-order-get', id),
  smsCancel: (id) => ipcRenderer.invoke('sms-cancel', id),
  smsFinish: (id) => ipcRenderer.invoke('sms-finish', id),
  smsList: () => ipcRenderer.invoke('sms-list'),
  smsClear: () => ipcRenderer.invoke('sms-clear'),

  // ---- FlowOTP (Gmail comprados / OTP) ----
  flowTest: () => ipcRenderer.invoke('flow-test'),
  flowBalance: () => ipcRenderer.invoke('flow-balance'),
  flowProducts: () => ipcRenderer.invoke('flow-products'),
  flowBuy: (opts) => ipcRenderer.invoke('flow-buy', opts),
  flowOrderGet: (id) => ipcRenderer.invoke('flow-order-get', id),
  flowList: () => ipcRenderer.invoke('flow-list'),
  flowClear: () => ipcRenderer.invoke('flow-clear'),

  // ---- Dolphin: perfis ----
  dolphinTest: () => ipcRenderer.invoke('dolphin-test'),
  dolphinCreate: (opts) => ipcRenderer.invoke('dolphin-create', opts),
  dolphinStop: () => ipcRenderer.invoke('dolphin-stop'),
  dolphinMadeList: () => ipcRenderer.invoke('dolphin-made-list'),
  dolphinRefreshRemote: () => ipcRenderer.invoke('dolphin-refresh-remote'),
  dolphinOpen: (ids) => ipcRenderer.invoke('dolphin-open', ids),

  // ---- Dolphin: espelhamento ----
  mirrorConfigure: (motherId, ids) => ipcRenderer.invoke('mirror-configure', { motherId, ids }),
  mirrorStart: () => ipcRenderer.invoke('mirror-start'),
  mirrorStop: () => ipcRenderer.invoke('mirror-stop'),
  mirrorPause: () => ipcRenderer.invoke('mirror-pause'),
  mirrorForceUrls: (on) => ipcRenderer.invoke('mirror-force-urls', on),
  mirrorGoUrl: (url) => ipcRenderer.invoke('mirror-go-url', url),

  // ---- eventos (main -> renderer) ----
  onNewCode: (cb) => ipcRenderer.on('new-code', (_, entry) => cb(entry)),
  onLog: (cb) => ipcRenderer.on('log', (_, e) => cb(e)),
  onProgress: (cb) => ipcRenderer.on('dolphin-progress', (_, e) => cb(e)),
  onProfileOpened: (cb) => ipcRenderer.on('profile-opened', (_, e) => cb(e)),
  onSmsUpdate: (cb) => ipcRenderer.on('sms-update', (_, order) => cb(order)),
  onFlowUpdate: (cb) => ipcRenderer.on('flow-update', (_, order) => cb(order))
})
