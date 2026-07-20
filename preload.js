const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bongo', {
  // developer unlock: ONLY the machine with env var HONGGOCAT_DEV=1 gets everything unlocked.
  // Friends don't have it set, so they can't fake it. Set once with: setx HONGGOCAT_DEV 1
  isDev: (process.env.HONGGOCAT_DEV || '').trim() === '1',   // trim: cmd `set X=1 &&`는 "1 "(뒤 공백) 저장될 수 있음
  appVersion: (() => { try { return ipcRenderer.sendSync('get-version') || '' } catch { return '' } })(),
  // ----- overlay window -----
  onInput(cb) { ipcRenderer.on('input', (_e, kind) => cb(kind)) },
  onChatOpen(cb) { ipcRenderer.on('chat-open', () => cb()) },
  chatClosed() { ipcRenderer.send('chat-close') },
  openSettings() { ipcRenderer.send('open-settings') },
  onCommand(cb) { ipcRenderer.on('command', (_e, msg) => cb(msg)) },
  onCursor(cb) { ipcRenderer.on('cursor', (_e, p) => cb(p)) },
  onLayout(cb) { ipcRenderer.on('layout', (_e, l) => cb(l)) },
  setHotzone(z) { ipcRenderer.send('hotzone', z) },
  humanControl(active) { ipcRenderer.send('human-control', !!active) },
  gatlingControl(active) { ipcRenderer.send('gatling-control', !!active) },
  antMechaControl(active) { ipcRenderer.send('antmecha-control', !!active) },
  setKeybinds(kb) { ipcRenderer.send('set-keybinds', kb) },
  pushState(state) { ipcRenderer.send('to-settings', state) },
  quit() { ipcRenderer.send('quit') },

  // ----- settings window -----
  toOverlay(msg) { ipcRenderer.send('to-overlay', msg) },
  checkUpdate() { ipcRenderer.send('check-update') },
  onState(cb) { ipcRenderer.on('state', (_e, s) => cb(s)) }
})
