// Settings window — edits live in the overlay via IPC relay.
(function () {
  const api = window.bongo
  const $ = (id) => document.getElementById(id)
  const inName = $('in-name'), inSkin = $('in-skin'), inPattern = $('in-pattern'), inHat = $('in-hat')
  const inEar = $('in-ear'), inEye = $('in-eye'), inMouth = $('in-mouth'), inTail = $('in-tail')
  const inEdit = $('in-edit'), inServer = $('in-server'), inRoom = $('in-room')
  const btnConnect = $('btn-connect'), btnDisconnect = $('btn-disconnect')
  const statusEl = $('status'), capacityEl = $('capacity')

  if (!api) { statusEl.textContent = '이 창은 홍고캣 앱에서 열어야 합니다'; return }

  let ready = false

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
    const ht = $('host-tools'); if (ht) ht.classList.toggle('hidden', !!s.connected && !s.isHost)
    // achievement: 🎯 저격수 (enemy-cat missile hits)
    const ch = s.catHits || 0, chGoal = s.catHitGoal || 500, chDone = !!s.catHitRewarded
    const chFill = $('achv-cathit-fill'), chSt = $('achv-cathit-status'), chCard = $('achv-cathit')
    if (chFill) chFill.style.width = Math.min(100, (ch / chGoal) * 100) + '%'
    if (chSt) chSt.textContent = chDone ? `달성! ${ch} / ${chGoal} ✓ (보상 지급됨)` : `${ch} / ${chGoal}`
    if (chCard) chCard.classList.toggle('done', chDone)
    // achievement: 💥 완전 파괴
    const dv = s.destroys || 0, dvGoal = s.destroyGoal || 5, dvDone = !!s.destroyRewarded
    const dvFill = $('achv-destroy-fill'), dvSt = $('achv-destroy-status'), dvCard = $('achv-destroy')
    if (dvFill) dvFill.style.width = Math.min(100, (dv / dvGoal) * 100) + '%'
    if (dvSt) dvSt.textContent = dvDone ? `달성! ${dv} / ${dvGoal} ✓ (보상 지급됨)` : `${dv} / ${dvGoal}`
    if (dvCard) dvCard.classList.toggle('done', dvDone)
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

  btnConnect.onclick = () => {
    sendProfile()
    const url = inServer.value.trim(), room = inRoom.value.trim().toUpperCase()
    if (!url || !room) { statusEl.textContent = '서버 주소와 방 코드를 입력하세요'; statusEl.style.color = '#c9a2b0'; return }
    api.toOverlay({ t: 'connect', url, room })
  }
  $('platform-mode').onclick = () => api.toOverlay({ t: 'platform-mode' })

  btnDisconnect.onclick = () => api.toOverlay({ t: 'disconnect' })
  $('btn-monitor').onclick = () => api.toOverlay({ t: 'next-monitor' })
  $('btn-restore-bar').onclick = () => api.toOverlay({ t: 'reset-taskbar' })
  $('btn-chat').onclick = () => api.toOverlay({ t: 'chat' })
  $('btn-check-update').onclick = () => { if (api.checkUpdate) api.checkUpdate() }
  $('btn-quit').onclick = () => api.toOverlay({ t: 'quit' })

  api.toOverlay({ t: 'request-state' })
})()
