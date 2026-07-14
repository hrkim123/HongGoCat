const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron')
const path = require('path')

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
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true   // fallback: apply on quit if not applied earlier
  const startedAt = Date.now()
  autoUpdater.on('error', (e) => console.error('[bongo] update error:', e && e.message))
  autoUpdater.on('update-downloaded', () => {
    // If the update finished downloading soon after launch, apply it NOW (silent install +
    // relaunch) so you effectively "update on start". If the app has been running a while,
    // don't yank the user mid-session — let it install on the next quit instead.
    if (Date.now() - startedAt < 3 * 60 * 1000) {
      console.log('[bongo] update downloaded — installing on start')
      setImmediate(() => autoUpdater.quitAndInstall(true, true)) // isSilent, isForceRunAfter
    } else {
      console.log('[bongo] update downloaded — installs on quit')
    }
  })
  try { autoUpdater.checkForUpdatesAndNotify() } catch (e) { console.error('[bongo] update check failed:', e.message) }
}

let win = null          // transparent overlay
let settingsWin = null  // normal settings window
let winOrigin = { x: 0, y: 0 } // top-left of the (multi-monitor) overlay in screen coords
let chatting = false          // while true, the overlay is allowed to stay focused (for typing)

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
    if (want !== interactive) {
      interactive = want
      win.setIgnoreMouseEvents(!want, { forward: true })
    }
  }, 24)
}

app.whenReady().then(() => {
  if (!gotTheLock) return // a second instance — bail before creating any window
  createWindow()
  startCursorPoll()
  initAutoUpdate()

  const ok = globalShortcut.register('Control+Shift+B', openChatFocus)
  if (!ok) console.error('[bongo] failed to register chat hotkey Ctrl+Shift+B')

  if (uIOhook) {
    const keysDown = new Set()
    const isCtrl = () => keysDown.has(UiohookKey.Ctrl) || keysDown.has(UiohookKey.CtrlRight)
    const isAlt = () => keysDown.has(UiohookKey.Alt) || keysDown.has(UiohookKey.AltRight)
    // Ctrl+Alt+1/2/3 → fire weapon in slot 1/2/3. We only OBSERVE keys (can't block them), so
    // the combo must not collide with OS shortcuts: Ctrl+number = browser tabs, Ctrl+Shift+
    // number = Explorer/desktop icon-view size. Ctrl+Alt+number isn't a standard shortcut.
    // uiohook keycodes are physical → the number key matches regardless of any shifted symbol.
    const SLOT_KEYS = { [UiohookKey['1']]: 1, [UiohookKey['2']]: 2, [UiohookKey['3']]: 3 }
    uIOhook.on('keydown', (e) => {
      // ignore OS auto-repeat while a key is held — act only on the initial press
      if (keysDown.has(e.keycode)) return
      keysDown.add(e.keycode)
      sendInput('key')
      if (SLOT_KEYS[e.keycode] && isCtrl() && isAlt()) {
        if (win && !win.isDestroyed()) win.webContents.send('command', { t: 'fire-slot', slot: SLOT_KEYS[e.keycode] })
      }
    })
    uIOhook.on('keyup', (e) => { keysDown.delete(e.keycode) })
    uIOhook.on('mousedown', (e) => {
      sendInput('mouse')
      // left click (uiohook button 1) → boost active missiles in their current heading
      if (e && e.button === 1 && win && !win.isDestroyed()) win.webContents.send('command', { t: 'boost' })
    })
    // mouse wheel / scroll intentionally does NOT count
    try { uIOhook.start() } catch (err) {
      console.error('[bongo] failed to start global hook:', err.message)
    }
  }
})

ipcMain.on('open-settings', toggleSettings)
// renderer reports the widget rect (window coords) + whether to force interactive (chat/edit)
ipcMain.on('hotzone', (_e, z) => {
  hotzone = z && z.rect ? z.rect : null
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
