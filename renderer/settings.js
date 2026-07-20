// Settings window — edits live in the overlay via IPC relay.
(function () {
  const api = window.bongo
  const $ = (id) => document.getElementById(id)
  const inName = $('in-name'), inSkin = $('in-skin'), inPattern = $('in-pattern'), inHat = $('in-hat')
  const inEar = $('in-ear'), inEye = $('in-eye'), inMouth = $('in-mouth'), inTail = $('in-tail')
  const inEdit = $('in-edit'), inServer = $('in-server'), inRoom = $('in-room'), inSafe = $('in-safe')
  const btnConnect = $('btn-connect'), btnDisconnect = $('btn-disconnect')
  const statusEl = $('status'), capacityEl = $('capacity')

  if (!api) { statusEl.textContent = '이 창은 홍고캣 앱에서 열어야 합니다'; return }

  let ready = false

  // ---------- configurable slot hotkeys ----------
  const kbMod = $('kb-mod'), kbKeys = [$('kb-key-0'), $('kb-key-1'), $('kb-key-2')], kbReset = $('kb-reset')
  let kb = { mod: 'alt', keys: ['Z', 'X', 'C'] }
  let kbCapturing = null
  function keyName(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    if (/^F\d{1,2}$/.test(code)) return code
    return null
  }
  function renderKb() { kbMod.value = kb.mod; kbKeys.forEach((b, i) => { if (kbCapturing !== i) b.textContent = kb.keys[i] || '?' }) }
  function sendKb() { api.toOverlay({ t: 'keybinds', mod: kb.mod, keys: kb.keys }) }
  kbMod.onchange = () => { kb.mod = kbMod.value; sendKb() }
  kbKeys.forEach((b, i) => { b.onclick = () => { kbCapturing = i; b.textContent = '…'; b.classList.add('capturing') } })
  window.addEventListener('keydown', (e) => {
    if (kbCapturing == null) return
    e.preventDefault(); e.stopPropagation()
    const idx = kbCapturing, name = e.code === 'Escape' ? null : keyName(e.code)
    if (name && !kb.keys.some((k, j) => k === name && j !== idx)) kb.keys[idx] = name   // ignore duplicates
    kbCapturing = null; kbKeys[idx].classList.remove('capturing'); renderKb(); if (name) sendKb()
  }, true)
  kbReset.onclick = () => { kb = { mod: 'alt', keys: ['Z', 'X', 'C'] }; renderKb(); sendKb() }

  api.onState((s) => {
    // don't stomp fields the user is editing; only sync when values differ meaningfully
    if (document.activeElement !== inName) inName.value = s.name || ''
    inSkin.value = s.skin || 'default'
    inPattern.value = s.pattern || 'solid'
    // hats: lock (🔒 + disable) any not owned; 'none' always allowed
    const ownedHats = new Set(s.ownedHats || [])
    for (const opt of inHat.options) {
      const owned = opt.value === 'none' || ownedHats.has(opt.value)
      opt.disabled = !owned
      if (!owned && !opt.textContent.startsWith('🔒')) opt.textContent = '🔒 ' + opt.textContent
      else if (owned && opt.textContent.startsWith('🔒 ')) opt.textContent = opt.textContent.slice(2)
    }
    inHat.value = (s.hat && (s.hat === 'none' || ownedHats.has(s.hat))) ? s.hat : 'none'
    const sh = s.shape || {}
    if (document.activeElement !== inEar) inEar.value = sh.ear || 'pointed'
    if (document.activeElement !== inEye) inEye.value = sh.eye || 'oval'
    if (document.activeElement !== inMouth) inMouth.value = sh.mouth || 'smile'
    if (document.activeElement !== inTail) inTail.value = sh.tail || 'curl'
    inEdit.checked = !!s.editing
    if (inSafe && document.activeElement !== inSafe) inSafe.checked = !!s.safeMode
    if (document.activeElement !== inServer) inServer.value = s.server || 'ws://localhost:8787'
    if (document.activeElement !== inRoom) inRoom.value = s.room || ''
    statusEl.textContent = s.status || ''
    statusEl.style.color = s.connected ? '#8fd18f' : '#c9a2b0'
    btnConnect.disabled = !!s.connected
    btnDisconnect.disabled = !s.connected
    const max = s.max || 12
    capacityEl.textContent = s.connected
      ? `접속 인원: ${s.count || 0} / ${max}명`
      : `접속 인원: — / ${max}명 (오프라인)`
    // platform tool: offline → anyone; online → host only. Hide only when connected & not host.
    const navHt = $('nav-host-tools'); if (navHt) navHt.classList.toggle('hidden', !s.isDev)   // dev 카테고리 나브 버튼 (dev 전용)
    // (achievements moved out of settings → dedicated 🏆 button under the shop button in the overlay)
    if (s.keybinds && kbCapturing == null) { kb = { mod: s.keybinds.mod || 'alt', keys: (s.keybinds.keys || ['Z', 'X', 'C']).slice(0, 3) }; renderKb() }
    ready = true
  })

  function sendProfile() {
    api.toOverlay({
      t: 'profile', name: inName.value, skin: inSkin.value, pattern: inPattern.value, hat: inHat.value,
      shape: { ear: inEar.value, eye: inEye.value, mouth: inMouth.value, tail: inTail.value }
    })
  }
  inName.addEventListener('change', sendProfile)
  inSkin.addEventListener('change', sendProfile)
  inPattern.addEventListener('change', sendProfile)
  inHat.addEventListener('change', sendProfile)
  inEar.addEventListener('change', sendProfile)
  inEye.addEventListener('change', sendProfile)
  inMouth.addEventListener('change', sendProfile)
  inTail.addEventListener('change', sendProfile)
  inEdit.addEventListener('change', () => api.toOverlay({ t: 'edit', on: inEdit.checked }))
  if (inSafe) inSafe.addEventListener('change', () => api.toOverlay({ t: 'safemode', on: inSafe.checked }))

  btnConnect.onclick = () => {
    sendProfile()
    const url = inServer.value.trim(), room = inRoom.value.trim().toUpperCase()
    if (!url || !room) { statusEl.textContent = '서버 주소와 방 코드를 입력하세요'; statusEl.style.color = '#c9a2b0'; return }
    api.toOverlay({ t: 'connect', url, room })
  }
  $('platform-mode').onclick = () => api.toOverlay({ t: 'platform-mode' })
  { const pc = $('platform-clear'); if (pc) pc.onclick = () => api.toOverlay({ t: 'platform-clear' }) }
  { const ha = $('heal-all'); if (ha) ha.onclick = () => api.toOverlay({ t: 'heal-all' }) }

  btnDisconnect.onclick = () => api.toOverlay({ t: 'disconnect' })
  $('btn-monitor').onclick = () => api.toOverlay({ t: 'next-monitor' })
  $('btn-restore-bar').onclick = () => api.toOverlay({ t: 'reset-taskbar' })
  $('btn-chat').onclick = () => api.toOverlay({ t: 'chat' })
  $('btn-check-update').onclick = () => { if (api.checkUpdate) api.checkUpdate() }
  { const q = $('btn-quit'); if (q) q.onclick = () => api.toOverlay({ t: 'quit' }) }   // 종료는 햄버거 메뉴로 이동

  api.toOverlay({ t: 'request-state' })
})()
