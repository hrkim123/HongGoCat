// Settings window — edits live in the overlay via IPC relay.
(function () {
  const api = window.bongo
  const $ = (id) => document.getElementById(id)
  const inName = $('in-name'), inSkin = $('in-skin'), inPattern = $('in-pattern'), inHat = $('in-hat')
  const inEdit = $('in-edit'), inServer = $('in-server'), inRoom = $('in-room')
  const btnConnect = $('btn-connect'), btnDisconnect = $('btn-disconnect')
  const slotSel = [$('slot-0'), $('slot-1'), $('slot-2')]
  const statusEl = $('status'), capacityEl = $('capacity')

  if (!api) { statusEl.textContent = '이 창은 홍고캣 앱에서 열어야 합니다'; return }

  let ready = false

  api.onState((s) => {
    // don't stomp fields the user is editing; only sync when values differ meaningfully
    if (document.activeElement !== inName) inName.value = s.name || ''
    inSkin.value = s.skin || 'default'
    inPattern.value = s.pattern || 'solid'
    inHat.value = s.hat || 'none'
    inEdit.checked = !!s.editing
    if (document.activeElement !== inServer) inServer.value = s.server || 'ws://localhost:8787'
    if (document.activeElement !== inRoom) inRoom.value = s.room || ''
    const slots = Array.isArray(s.slots) ? s.slots : ['missile', 'none', 'none']
    slotSel.forEach((sel, i) => { if (sel && document.activeElement !== sel) sel.value = slots[i] || 'none' })
    statusEl.textContent = s.status || ''
    statusEl.style.color = s.connected ? '#8fd18f' : '#c9a2b0'
    btnConnect.disabled = !!s.connected
    btnDisconnect.disabled = !s.connected
    const max = s.max || 12
    capacityEl.textContent = s.connected
      ? `접속 인원: ${s.count || 0} / ${max}명`
      : `접속 인원: — / ${max}명 (오프라인)`
    ready = true
  })

  function sendProfile() {
    api.toOverlay({ t: 'profile', name: inName.value, skin: inSkin.value, pattern: inPattern.value, hat: inHat.value })
  }
  inName.addEventListener('change', sendProfile)
  inSkin.addEventListener('change', sendProfile)
  inPattern.addEventListener('change', sendProfile)
  inHat.addEventListener('change', sendProfile)
  inEdit.addEventListener('change', () => api.toOverlay({ t: 'edit', on: inEdit.checked }))
  slotSel.forEach((sel) => sel && sel.addEventListener('change', () =>
    api.toOverlay({ t: 'slots', slots: slotSel.map((s) => s.value) })))

  btnConnect.onclick = () => {
    sendProfile()
    const url = inServer.value.trim(), room = inRoom.value.trim().toUpperCase()
    if (!url || !room) { statusEl.textContent = '서버 주소와 방 코드를 입력하세요'; statusEl.style.color = '#c9a2b0'; return }
    api.toOverlay({ t: 'connect', url, room })
  }
  const wModal = $('weapon-modal')
  $('btn-weapon-info').onclick = () => wModal.classList.remove('hidden')
  $('weapon-modal-close').onclick = () => wModal.classList.add('hidden')
  wModal.addEventListener('click', (e) => { if (e.target === wModal) wModal.classList.add('hidden') })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') wModal.classList.add('hidden') })

  btnDisconnect.onclick = () => api.toOverlay({ t: 'disconnect' })
  $('btn-monitor').onclick = () => api.toOverlay({ t: 'next-monitor' })
  $('btn-chat').onclick = () => api.toOverlay({ t: 'chat' })
  $('btn-quit').onclick = () => api.toOverlay({ t: 'quit' })

  api.toOverlay({ t: 'request-state' })
})()
