const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bongo', {
  // ----- overlay window -----
  onInput(cb) { ipcRenderer.on('input', (_e, kind) => cb(kind)) },
  onChatOpen(cb) { ipcRenderer.on('chat-open', () => cb()) },
  chatClosed() { ipcRenderer.send('chat-close') },
  openSettings() { ipcRenderer.send('open-settings') },
  onCommand(cb) { ipcRenderer.on('command', (_e, msg) => cb(msg)) },
  onCursor(cb) { ipcRenderer.on('cursor', (_e, p) => cb(p)) },
  onLayout(cb) { ipcRenderer.on('layout', (_e, l) => cb(l)) },
  setHotzone(z) { ipcRenderer.send('hotzone', z) },
  pushState(state) { ipcRenderer.send('to-settings', state) },
  quit() { ipcRenderer.send('quit') },

  // ----- settings window -----
  toOverlay(msg) { ipcRenderer.send('to-overlay', msg) },
  onState(cb) { ipcRenderer.on('state', (_e, s) => cb(s)) }
})
