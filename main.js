const { app, BrowserWindow, ipcMain, globalShortcut, screen, Notification, dialog } = require('electron')
const path = require('path')

let updater = null   // electron-updater instance (set in initAutoUpdate), for restart-to-apply

// Transparent windows on Windows can render a white bar/flash via GPU compositing —
// disabling GPU compositing is a common fix. (Light overlay, negligible perf cost.)
app.disableHardwareAcceleration()

let uIOhook = null
let UiohookKey = {}
try {
  ({ uIOhook, UiohookKey } = require('uiohook-napi'))
} catch (err) {
  console.error('[bongo] uiohook-napi load failed — global input hook disabled:', err.message)
}

// Auto-update (electron-updater + GitHub Releases). Only meaningful in a PACKAGED build;
// require is guarded so the app still runs in dev / before `npm install`.
function initAutoUpdate() {
  if (!app.isPackaged) return
  let autoUpdater
  try { ({ autoUpdater } = require('electron-updater')) } catch (e) {
    console.error('[bongo] electron-updater not installed — auto-update disabled:', e.message); return
  }
  updater = autoUpdater
  // ASK-FIRST flow: never download or install silently, and NEVER install on quit. On launch
  // (and periodic re-checks) we detect a new version, ask the user with a popup, and only then
  // download → install → relaunch.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  let promptedVersion = null   // ask at most once per version per session
  let downloading = false
  let manualCheck = false      // true while a user-initiated "업데이트 확인" is in flight
  autoUpdater.on('error', (e) => {
    downloading = false
    console.error('[bongo] update error:', e && e.message)
    if (manualCheck) {
      manualCheck = false
      dialog.showMessageBox({ type: 'error', buttons: ['확인'], noLink: true, title: 'HongGoCat 업데이트', message: '업데이트 확인에 실패했습니다.', detail: (e && e.message) || '네트워크 상태를 확인해 주세요.' }).catch(() => {})
    }
  })
  autoUpdater.on('update-available', (info) => { const wasManual = manualCheck; manualCheck = false; promptUpdate(info && info.version, wasManual) })
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      manualCheck = false
      dialog.showMessageBox({ type: 'info', buttons: ['확인'], noLink: true, title: 'HongGoCat 업데이트', message: '최신 버전입니다.', detail: `현재 v${app.getVersion()}을(를) 사용 중입니다.` }).catch(() => {})
    }
  })
  autoUpdater.on('update-downloaded', () => {
    // user already consented → apply now (silent install + relaunch)
    setImmediate(() => { try { autoUpdater.quitAndInstall(true, true) } catch (e) {} })
  })

  // Ask the user whether to update; on "예" download it (update-downloaded then relaunches).
  function promptUpdate(version, force) {
    const v = version ? `v${version}` : '새 버전'
    if (downloading) return
    if (!force && promptedVersion === version) return   // auto-checks dedupe; a MANUAL "업데이트 확인" always re-prompts
    promptedVersion = version
    dialog.showMessageBox({
      type: 'info',
      buttons: ['업데이트', '나중에'],
      defaultId: 0, cancelId: 1, noLink: true,
      title: 'HongGoCat 업데이트',
      message: `${v}이(가) 있습니다.`,
      detail: '지금 업데이트를 받고 재시작할까요?'
    }).then((r) => {
      if (r.response === 0) { downloading = true; try { autoUpdater.downloadUpdate() } catch (e) { downloading = false } }
    }).catch(() => {})
  }
  updater.promptUpdate = promptUpdate
  // Manual "업데이트 확인" from settings: check now; update-available → ask-first prompt,
  // update-not-available → "최신 버전입니다" popup, error → failure popup.
  updater.checkManual = function () {
    if (downloading) { dialog.showMessageBox({ type: 'info', buttons: ['확인'], noLink: true, title: 'HongGoCat 업데이트', message: '업데이트를 이미 받는 중입니다.' }).catch(() => {}); return }
    manualCheck = true
    Promise.resolve(autoUpdater.checkForUpdates()).then((r) => {
      // fallback: if a cached result meant no event fired, still give feedback from the promise
      if (!manualCheck) return
      manualCheck = false
      const info = r && r.updateInfo, v = info && info.version
      if (v && v !== app.getVersion()) promptUpdate(v, true)
      else dialog.showMessageBox({ type: 'info', buttons: ['확인'], noLink: true, title: 'HongGoCat 업데이트', message: '최신 버전입니다.', detail: `현재 v${app.getVersion()}을(를) 사용 중입니다.` }).catch(() => {})
    }).catch((e) => {
      if (!manualCheck) return
      manualCheck = false
      dialog.showMessageBox({ type: 'error', buttons: ['확인'], noLink: true, title: 'HongGoCat 업데이트', message: '업데이트 확인에 실패했습니다.', detail: (e && e.message) || '네트워크 상태를 확인해 주세요.' }).catch(() => {})
    })
  }

  try { autoUpdater.checkForUpdates() } catch (e) { console.error('[bongo] update check failed:', e.message) }
  // re-check while the app stays open (long sessions) — still ask-first, once per version
  setInterval(() => { try { autoUpdater.checkForUpdates() } catch (e) {} }, 30 * 60 * 1000)
}

let win = null          // transparent overlay
let settingsWin = null  // normal settings window
let winOrigin = { x: 0, y: 0 } // top-left of the (multi-monitor) overlay in screen coords
let chatting = false          // while true, the overlay is allowed to stay focused (for typing)
let humanActive = false       // true while the WASD-controllable human weapon is summoned
let gatlingActive = false     // true while a gatling turret is deployed (needs the Q fire key forwarded)
let antMechaActive = false    // true while 10 ants are ready to merge OR the ant mecha is active (WASD/Q/E)

// user-configurable slot hotkeys (from the settings window). mod = 'alt' | 'ctrlalt' | 'ctrlshift';
// keys are names (Z/X/C, 1/2/3, F6…) mapped to uiohook physical keycodes.
let slotMod = 'alt'
let slotKeyMap = {}           // uiohook keycode -> slot number (1/2/3)
function buildSlotKeys(keys) {
  const m = {}
  ;(keys || []).forEach((name, i) => { const code = UiohookKey[name]; if (code != null) m[code] = i + 1 })
  return m
}
function slotModMatches(ctrl, alt, shift, caps) {
  if (slotMod === 'ctrlalt') return ctrl && alt
  if (slotMod === 'ctrlshift') return ctrl && shift
  if (slotMod === 'caps') return caps   // hold CapsLock
  return alt && !ctrl   // 'alt' (not AltGr)
}
function applyKeybinds(kb) {
  if (kb && (kb.mod === 'alt' || kb.mod === 'ctrlalt' || kb.mod === 'ctrlshift' || kb.mod === 'caps')) slotMod = kb.mod
  if (kb && Array.isArray(kb.keys) && kb.keys.length) slotKeyMap = buildSlotKeys(kb.keys)
}

// Only ever allow ONE overlay — prevents stale/ghost windows from stacking up
// (repeated launches otherwise leave leftover windows that look like a stray bar).
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { win.show(); win.focus() }
  })
}

// Windows clamps a single transparent window to ONE monitor, so the overlay covers one
// display at a time. `curDisp` is which. Ctrl+Shift+. (or the settings button) cycles it.
let curDisp = 0

function activeDisplay() {
  const all = screen.getAllDisplays()
  return all[Math.min(curDisp, all.length - 1)] || screen.getPrimaryDisplay()
}

function createWindow() {
  const displays = screen.getAllDisplays()
  curDisp = displays.findIndex((d) => d.id === screen.getPrimaryDisplay().id)
  if (curDisp < 0) curDisp = 0
  const b = activeDisplay().bounds
  winOrigin = { x: b.x, y: b.y }
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,     // must be resizable or Windows clamps us to the work area (can't
    movable: false,      // cover the taskbar). frame:false means no user-facing resize grips.
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.setTitle('')
  win.once('ready-to-show', () => {
    win.showInactive() // show WITHOUT activating (no caption bar)
    // Windows clamps the initial size to the work area; re-assert full monitor bounds so the
    // overlay actually covers the taskbar (needed for ants/cracks/missiles down there).
    const fb = activeDisplay().bounds
    win.setBounds({ x: fb.x, y: fb.y, width: fb.width, height: fb.height })
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true }) // click-through; forward mousemove for hover
  stripWin11Chrome(win)
  win.webContents.on('did-finish-load', sendLayout)
  win.on('closed', () => { win = null })
}

// Move the overlay to the next monitor (cycles). Repositions the window, recenters the
// cat, and updates all the coordinate math.
function moveToNextDisplay() {
  if (!win || win.isDestroyed()) return
  const all = screen.getAllDisplays()
  if (all.length < 2) return
  curDisp = (curDisp + 1) % all.length
  const b = all[curDisp].bounds
  winOrigin = { x: b.x, y: b.y }
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  stripWin11Chrome(win) // re-assert no-border after the move, just in case
  hotzone = defaultHotzone()
  sendLayout()
}

// Tell the renderer where the current monitor's work area is (relative to the overlay
// origin) so the cat widget starts bottom-center of that screen.
function sendLayout() {
  if (!win || win.isDestroyed()) return
  const wa = activeDisplay().workArea
  win.webContents.send('layout', {
    primary: { x: wa.x - winOrigin.x, y: wa.y - winOrigin.y, w: wa.width, h: wa.height }
  })
}

// Windows 11 draws a 1–2px accent BORDER around the active window (a light bar most
// visible at the top when focused) and rounds the corners. Electron exposes no option
// for these, so set the DWM attributes directly: DWMWA_BORDER_COLOR = NONE and
// DWMWA_WINDOW_CORNER_PREFERENCE = DONOTROUND.
function stripWin11Chrome(bw) {
  if (process.platform !== 'win32') return
  let hwnd
  try {
    const buf = bw.getNativeWindowHandle()
    hwnd = (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString()
  } catch (e) { console.error('[bongo] hwnd read failed:', e.message); return }
  const ps = [
    'Add-Type -Namespace D -Name W -MemberDefinition \'[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(System.IntPtr h,int a,ref int v,int s);\'',
    `$h=[System.IntPtr]::new([long]${hwnd})`,
    '$ncoff=1; [D.W]::DwmSetWindowAttribute($h,2,[ref]$ncoff,4)',   // DWMWA_NCRENDERING_POLICY = DISABLED (no caption/frame ever)
    '$none=-2; [D.W]::DwmSetWindowAttribute($h,34,[ref]$none,4)',   // DWMWA_BORDER_COLOR = NONE
    '$dnr=1;  [D.W]::DwmSetWindowAttribute($h,33,[ref]$dnr,4)'      // corners: DO NOT ROUND
  ].join('; ')
  require('child_process').execFile(
    'powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { windowsHide: true },
    (err) => { if (err) console.error('[bongo] DWM strip failed:', err.message) }
  )
}

// hamburger toggles: open if closed, close if open
function toggleSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.close(); return }
  openSettings()
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show(); settingsWin.moveTop(); settingsWin.focus(); return
  }
  settingsWin = new BrowserWindow({
    width: 310,
    height: 600,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,   // the overlay is screen-saver-level topmost; the settings window
    show: false,         // must sit ABOVE it or it opens hidden behind (the "two clicks" bug)
    title: 'HongGoCat 설정',
    backgroundColor: '#1a1a24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  settingsWin.setMenuBarVisibility(false)
  // Put the settings window in the SAME top band as the overlay (screen-saver) so it sits
  // ABOVE the transparent overlay and can't drop behind it (which read as "disappearing"
  // when you clicked away and back). Safe now that disableHardwareAcceleration fixed the
  // border/white-bar repaint. Re-assert top on focus so clicking it always keeps it up.
  settingsWin.setAlwaysOnTop(true, 'screen-saver')
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'))
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.moveTop(); settingsWin.focus() })
  settingsWin.on('focus', () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.moveTop() })
  settingsWin.on('closed', () => { settingsWin = null; reassertOverlay() })
}

function sendInput(kind) {
  if (win && !win.isDestroyed()) win.webContents.send('input', kind)
}

// Re-assert the overlay's chrome-free state. Windows re-draws the accent border on the
// topmost window when ANOTHER window (settings/chat) closes, so call this on those events.
function reassertOverlay() {
  if (!win || win.isDestroyed()) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(!interactive, { forward: true })
  stripWin11Chrome(win) // DWMWA_BORDER_COLOR = NONE again
}

function openChatFocus() {
  if (!win || win.isDestroyed()) return
  chatting = true          // allow the overlay to stay focused while typing
  interactive = true
  win.setIgnoreMouseEvents(false)
  win.show(); win.focus()
  win.webContents.send('chat-open')
}

// Poll the real cursor: feed it to the renderer (for missile homing) and flip the
// overlay interactive only while the cursor is over the widget "hotzone" (or chatting/
// editing). This is more reliable than forwarded mousemove for click-through windows.
let hotzone = null          // { x, y, w, h } in window coords
let hotzoneExtra = null     // [{ x, y, w, h }] extra clickable rects (per-opponent dim buttons)
let forceInteractive = false
let interactive = false
let pollTimer = null
// The widget defaults to bottom-center; main computes the same rect so click-through
// works immediately without waiting on the renderer (which only updates it on drag).
// Must match renderer: cellW=240, cellH=CELL_H(10+152+54=216), +BAR_SPACE(40) = 256.
function defaultHotzone() {
  const wa = activeDisplay().workArea
  const w = 240, h = 256
  const px = wa.x - winOrigin.x, py = wa.y - winOrigin.y
  return { x: Math.round(px + (wa.width - w) / 2), y: Math.round(py + wa.height - h - 12), w, h }
}
function startCursorPoll() {
  if (pollTimer) return
  if (!hotzone) hotzone = defaultHotzone()
  pollTimer = setInterval(() => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    const cx = p.x - winOrigin.x, cy = p.y - winOrigin.y
    win.webContents.send('cursor', { x: cx, y: cy })
    let want = forceInteractive
    if (!want && hotzone) {
      want = cx >= hotzone.x && cx <= hotzone.x + hotzone.w &&
             cy >= hotzone.y && cy <= hotzone.y + hotzone.h
    }
    if (!want && hotzoneExtra) {   // per-opponent 👁 buttons drawn near each peer are clickable too
      for (const r of hotzoneExtra) { if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) { want = true; break } }
    }
    if (want !== interactive) {
      interactive = want
      win.setIgnoreMouseEvents(!want, { forward: true })
    }
  }, 24)
}

app.whenReady().then(() => {
  if (!gotTheLock) return // a second instance — bail before creating any window
  app.setAppUserModelId('com.hrkim.honggocat') // Windows needs this for notifications to show
  createWindow()
  startCursorPoll()
  initAutoUpdate()

  const ok = globalShortcut.register('Control+Shift+B', openChatFocus)
  if (!ok) console.error('[bongo] failed to register chat hotkey Ctrl+Shift+B')

  if (uIOhook) {
    const keysDown = new Set()
    const isCtrl = () => keysDown.has(UiohookKey.Ctrl) || keysDown.has(UiohookKey.CtrlRight)
    const isAlt = () => keysDown.has(UiohookKey.Alt) || keysDown.has(UiohookKey.AltRight)
    const isShift = () => keysDown.has(UiohookKey.Shift) || keysDown.has(UiohookKey.ShiftRight)
    const isCaps = () => keysDown.has(UiohookKey.CapsLock)   // held (not the toggle state)
    // slot 1/2/3 hotkeys are user-configurable (settings → 단축키). Default Alt+Z/X/C. We only OBSERVE
    // keys (can't block), so combos must avoid OS/browser shortcuts — the UI warns about that.
    if (!Object.keys(slotKeyMap).length) slotKeyMap = buildSlotKeys(['Z', 'X', 'C'])
    const slotHeld = new Set()   // slot keys whose combo press we forwarded (for hold-to-charge weapons)
    // WASD forwarded to the overlay ONLY while a controllable human is active (privacy: we don't
    // leak key identity otherwise). The renderer toggles this via the 'human-control' ipc below.
    const MOVE_KEYS = { [UiohookKey.W]: 'w', [UiohookKey.A]: 'a', [UiohookKey.S]: 's', [UiohookKey.D]: 'd', [UiohookKey.E]: 'e', [UiohookKey.Q]: 'q', [UiohookKey.R]: 'r' }
    uIOhook.on('keydown', (e) => {
      // ignore OS auto-repeat while a key is held — act only on the initial press
      if (keysDown.has(e.keycode)) return
      keysDown.add(e.keycode)
      sendInput('key')
      if (slotKeyMap[e.keycode] && slotModMatches(isCtrl(), isAlt(), isShift(), isCaps())) {
        slotHeld.add(e.keycode)
        if (win && !win.isDestroyed()) win.webContents.send('command', { t: 'fire-slot', slot: slotKeyMap[e.keycode], down: true })
      }
      if ((humanActive || gatlingActive || antMechaActive) && MOVE_KEYS[e.keycode] && win && !win.isDestroyed()) {
        win.webContents.send('command', { t: 'human-key', key: MOVE_KEYS[e.keycode], down: true })
      }
      // Ctrl+` : toggle the ant mecha's human ⇄ ant form (only while a mecha is active)
      if (antMechaActive && e.keycode === UiohookKey.Backquote && isCtrl() && win && !win.isDestroyed()) {
        win.webContents.send('command', { t: 'mecha-transform' })
      }
    })
    uIOhook.on('keyup', (e) => {
      keysDown.delete(e.keycode)
      // always forward key-up so movement can't get stuck if the human is dismissed mid-hold
      if (MOVE_KEYS[e.keycode] && win && !win.isDestroyed()) {
        win.webContents.send('command', { t: 'human-key', key: MOVE_KEYS[e.keycode], down: false })
      }
      // release a held slot key (hold-to-charge weapons like 낙뢰) — forward regardless of modifiers
      if (slotHeld.has(e.keycode) && slotKeyMap[e.keycode]) {
        slotHeld.delete(e.keycode)
        if (win && !win.isDestroyed()) win.webContents.send('command', { t: 'fire-slot', slot: slotKeyMap[e.keycode], down: false })
      }
    })
    uIOhook.on('mousedown', (e) => {
      sendInput('mouse')
      // left click (uiohook button 1) → boost missiles + start holding (gatling continuous fire)
      if (e && e.button === 1 && win && !win.isDestroyed()) {
        win.webContents.send('command', { t: 'boost' })
        win.webContents.send('command', { t: 'lmb', down: true })
      }
    })
    uIOhook.on('mouseup', (e) => {
      if (e && e.button === 1 && win && !win.isDestroyed()) win.webContents.send('command', { t: 'lmb', down: false })
    })
    // mouse wheel / scroll intentionally does NOT count
    try { uIOhook.start() } catch (err) {
      console.error('[bongo] failed to start global hook:', err.message)
    }
  }
})

ipcMain.on('get-version', (e) => { try { e.returnValue = app.getVersion() } catch { e.returnValue = '' } })
ipcMain.on('human-control', (_e, active) => { humanActive = !!active })
ipcMain.on('gatling-control', (_e, active) => { gatlingActive = !!active })
ipcMain.on('antmecha-control', (_e, active) => { antMechaActive = !!active })
ipcMain.on('set-keybinds', (_e, kb) => applyKeybinds(kb))
ipcMain.on('open-settings', toggleSettings)
ipcMain.on('apply-update', () => { if (updater) { try { updater.quitAndInstall(true, true) } catch (e) {} } })
ipcMain.on('check-update', () => {
  if (updater && updater.checkManual) { updater.checkManual(); return }
  dialog.showMessageBox({
    type: 'info', buttons: ['확인'], noLink: true, title: 'HongGoCat 업데이트',
    message: app.isPackaged ? '업데이트 기능을 사용할 수 없습니다.' : '개발 모드에서는 업데이트를 확인할 수 없습니다.',
    detail: `현재 버전: v${app.getVersion()}`
  }).catch(() => {})
})
// renderer reports the widget rect (window coords) + whether to force interactive (chat/edit)
ipcMain.on('hotzone', (_e, z) => {
  hotzone = z && z.rect ? z.rect : null
  hotzoneExtra = z && Array.isArray(z.extra) ? z.extra : null
  forceInteractive = !!(z && z.force)
})
ipcMain.on('quit', () => app.quit())
ipcMain.on('chat-close', () => {
  chatting = false
  if (win && !win.isDestroyed()) { win.blur(); reassertOverlay() }
})

// relay settings-window commands → overlay
ipcMain.on('to-overlay', (_e, msg) => {
  if (!win || win.isDestroyed()) return
  if (msg && msg.t === 'chat') { openChatFocus(); return } // needs focus
  if (msg && msg.t === 'next-monitor') { moveToNextDisplay(); return }
  win.webContents.send('command', msg)
})
// relay overlay state → settings window
ipcMain.on('to-settings', (_e, msg) => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('state', msg)
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (uIOhook) { try { uIOhook.stop() } catch {} }
  app.quit()
})
