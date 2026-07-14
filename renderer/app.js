// Overlay: render loop, global input, multiplayer client, edit mode.
(function () {
  const canvas = document.getElementById('stage')
  const fxCanvas = document.getElementById('fx')   // weapons layer — sits ABOVE the DOM HUD bar
  const stagectx = canvas.getContext('2d')
  const fxctx = fxCanvas.getContext('2d')
  let ctx = stagectx   // current draw target; swapped between the two layers each frame
  const { CELL_W, CELL_H, DEFAULT_FEAT } = window.AnimalArt

  function newAnimState() {
    return {
      lastLeft: 0, lastRight: 0, lastMouse: 0, nextPawLeft: true,
      blinkUntil: 0, nextBlink: performance.now() + 1500 + Math.random() * 3000,
      seed: Math.random() * 10
    }
  }

  let savedFeat = {}
  try { savedFeat = JSON.parse(localStorage.getItem('feat') || '{}') } catch {}

  // Weapons registry (extensible — add new weapons here + a case in fireWeapon()).
  const WEAPONS = { none: '없음', missile: '🚀 미사일', shield: '🛡 쉴드', ant: '🐜 개미' }
  const SHIELD_DUR = 10000, SHIELD_CD = 3000      // 10s active, then 3s cooldown
  // A real "shield plate" that floats OUT in front of the cat (not a sector from the center)
  // and orbits toward the cursor. SHIELD_DIST = how far out it hovers; SHIELD_SPAN = its
  // angular width; SHIELD_T = plate half-thickness; SHIELD_BAND = block tolerance around it.
  const SHIELD_SPAN = (86 * Math.PI) / 180
  const SHIELD_DIST = 118
  const SHIELD_T = 10
  const SHIELD_BAND = 16
  const SHIELD_HP = 10                            // breaks after 10 hit-power
  const remoteShields = new Map()                 // peerId -> { until, angle, hp, max }
  const remoteBreaks = []                          // peerIds whose shield just shattered
  const shieldShards = []                          // shatter particles
  let savedSlots = ['missile', 'none', 'none']
  try { const s = JSON.parse(localStorage.getItem('slots') || 'null'); if (Array.isArray(s)) savedSlots = s } catch {}

  const me = {
    id: 'me',
    name: localStorage.getItem('name') || '나',
    animal: 'cat',
    skin: localStorage.getItem('skin') || 'default',
    pattern: localStorage.getItem('pattern') || 'solid',
    hat: localStorage.getItem('hat') || 'none',
    slots: savedSlots.slice(0, 3),
    feat: Object.assign({}, DEFAULT_FEAT, savedFeat),
    ...newAnimState()
  }
  me.tint = me.skin
  while (me.slots.length < 3) me.slots.push('none')
  const peers = new Map()

  function pulse(target, kind) {
    const now = performance.now()
    if (kind === 'mouse') target.lastMouse = now
    else {
      if (target.nextPawLeft) target.lastLeft = now
      else target.lastRight = now
      target.nextPawLeft = !target.nextPawLeft
    }
  }

  // ---------- input source ----------
  let editing = false
  const inputSource = window.bongo || {
    onInput(cb) {
      window.addEventListener('keydown', (e) => { if (!e.repeat && e.target.tagName !== 'INPUT') cb('key') })
      window.addEventListener('mousedown', () => cb('mouse'))
    },
    onChatOpen() {}, chatClosed() {}, openSettings() { alert('설정은 Electron 앱에서 열립니다') },
    onCommand(cb) {
      // dev-browser fallback: 'm' fires a missile
      window.addEventListener('keydown', (e) => { if (e.key === 'm' && e.target.tagName !== 'INPUT') cb({ t: 'fire-missile' }) })
    },
    onCursor(cb) { window.addEventListener('mousemove', (e) => cb({ x: e.clientX, y: e.clientY })) },
    onLayout() {},
    setHotzone() {},
    pushState() {}, quit() { window.close() }
  }

  // ---------- counter ----------
  const counterEl = document.getElementById('counter')
  let tapCount = parseInt(localStorage.getItem('taps') || '0', 10) || 0
  let counterDirty = false
  function renderCounter() {
    counterEl.textContent = tapCount.toLocaleString() // no animation
  }
  renderCounter()
  setInterval(() => { if (counterDirty) { localStorage.setItem('taps', String(tapCount)); counterDirty = false } }, 1000)
  window.addEventListener('beforeunload', () => localStorage.setItem('taps', String(tapCount)))

  let net = null, sendBudget = 0, budgetRefill = performance.now()
  inputSource.onInput((kind) => {
    pulse(me, kind)
    tapCount++; counterDirty = true; renderCounter()
    if (net && net.readyState === WebSocket.OPEN) {
      const now = performance.now()
      sendBudget = Math.min(25, sendBudget + (now - budgetRefill) * 0.025); budgetRefill = now
      if (sendBudget >= 1) { sendBudget -= 1; net.send(JSON.stringify({ t: 'pulse', kind })) }
    }
  })

  // ---------- networking ----------
  let status = '오프라인 — 혼자 연주 중'
  let roomCount = 0, roomMax = 12   // players in the current room + room capacity (from server)
  function setStatus(text) { status = text; pushState() }
  function connected() { return !!(net && net.readyState === WebSocket.OPEN) }

  function profileMsg() {
    return { name: me.name, animal: me.animal, skin: me.skin, pattern: me.pattern, hat: me.hat }
  }

  function connect(url, room) {
    disconnect()
    setStatus('접속 중…')
    localStorage.setItem('server', url); localStorage.setItem('room', room)
    let ws
    try { ws = new WebSocket(url) } catch { setStatus('잘못된 서버 주소'); return }
    net = ws
    ws.onopen = () => ws.send(JSON.stringify(Object.assign({ t: 'join', room }, profileMsg())))
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.t === 'joined') { me.netId = msg.id; roomMax = msg.max || 12; setStatus(`방 ${msg.room} 접속됨`) }
      else if (msg.t === 'roster') {
        roomCount = msg.peers.length   // includes me
        const seen = new Set()
        for (const p of msg.peers) {
          if (p.id === me.netId) continue
          seen.add(p.id)
          const ex = peers.get(p.id)
          if (ex) { ex.name = p.name; ex.tint = p.skin || 'default'; ex.pattern = p.pattern || 'solid'; ex.hat = p.hat || 'none' }
          else peers.set(p.id, { id: p.id, name: p.name, animal: 'cat', tint: p.skin || 'default', pattern: p.pattern || 'solid', hat: p.hat || 'none', feat: {}, ...newAnimState() })
        }
        for (const id of [...peers.keys()]) if (!seen.has(id)) peers.delete(id)
        pushState()   // reflect the new count in the settings window
      }
      else if (msg.t === 'pos') { const p = peers.get(msg.id); if (p) { p.nx = msg.nx; p.ny = msg.ny; p.taps = msg.taps } }
      else if (msg.t === 'pulse') { const p = peers.get(msg.id); if (p) pulse(p, msg.kind) }
      else if (msg.t === 'chat') { const p = peers.get(msg.id); if (p) showBubble(p, String(msg.text)) }
      else if (msg.t === 'throw') { const src = targetOf(msg.id); launch('me', src ? { from: src } : {}) }
      else if (msg.t === 'missiles') { mergeRemote(remoteMissiles, msg.id, msg.list, 'nx', 'ny') }
      else if (msg.t === 'hit') { if (msg.target === me.netId) me.hitUntil = performance.now() + 1000 + Math.min((msg.power || 1) - 1, 5) * 200 }
      else if (msg.t === 'shield') {
        if (msg.ttl > 0) remoteShields.set(msg.id, { until: performance.now() + msg.ttl, angle: msg.angle || 0, hp: msg.hp != null ? msg.hp : SHIELD_HP, max: msg.max || SHIELD_HP })
        else { if (msg.broke) remoteBreaks.push(msg.id); remoteShields.delete(msg.id) }
      }
      else if (msg.t === 'shield-hit') { if (msg.target === me.netId) hitMyShield(msg.power || 1) }
      else if (msg.t === 'ants') { mergeRemote(remoteAnts, msg.id, msg.list, 'nx', 'nx') }
      else if (msg.t === 'ant-hit') { if (msg.target === me.netId) { const a = ants.find((x) => x.id === msg.ant); if (a) antTakeDmg(a, msg.dmg || 1) } }
      else if (msg.t === 'error' && msg.reason === 'room_full') { setStatus('방이 가득 찼어요'); ws.close() }
    }
    ws.onclose = () => { if (net === ws) { net = null; peers.clear(); remoteAnts.clear(); me.netId = undefined; roomCount = 0; setStatus('오프라인 — 혼자 연주 중') } }
    ws.onerror = () => setStatus('접속 실패')
  }
  function disconnect() {
    if (net) { const ws = net; net = null; ws.close() }
    peers.clear(); remoteMissiles.clear(); remoteShields.clear(); remoteAnts.clear(); me.netId = undefined; roomCount = 0
  }
  function sendUpdate() {
    if (connected()) net.send(JSON.stringify(Object.assign({ t: 'update' }, profileMsg())))
  }

  // ---------- chat ----------
  const chatbar = document.getElementById('chatbar')
  const chatInput = document.getElementById('chat-input')
  function showBubble(target, text) {
    text = text.trim().slice(0, 80); if (!text) return
    target.bubbleText = text
    target.bubbleUntil = performance.now() + Math.min(9000, 4000 + text.length * 60)
  }
  function openChat() {
    chatOpenFlag = true; sendHotzone()
    if (wx != null) positionChat()
    chatbar.classList.remove('hidden'); chatInput.focus()
  }
  function closeChat() {
    chatOpenFlag = false
    chatbar.classList.add('hidden'); chatInput.value = ''
    if (inputSource.chatClosed) inputSource.chatClosed()
    sendHotzone()
  }
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      const text = chatInput.value.trim()
      if (text) { showBubble(me, text); if (connected()) net.send(JSON.stringify({ t: 'chat', text })) }
      closeChat()
    } else if (e.key === 'Escape') closeChat()
  })
  if (inputSource.onChatOpen) inputSource.onChatOpen(openChat)

  // ---------- settings button + command bridge ----------
  document.getElementById('btn-menu').onclick = () => inputSource.openSettings()

  function pushState() {
    inputSource.pushState({
      name: me.name, skin: me.skin, pattern: me.pattern, hat: me.hat, slots: me.slots,
      server: localStorage.getItem('server') || 'ws://localhost:8787',
      room: localStorage.getItem('room') || '',
      connected: connected(), status, editing,
      count: connected() ? roomCount : 0, max: roomMax
    })
  }

  inputSource.onCommand((msg) => {
    if (!msg) return
    if (msg.t === 'request-state') pushState()
    else if (msg.t === 'profile') {
      if (typeof msg.name === 'string') { me.name = msg.name.trim() || '나'; localStorage.setItem('name', me.name) }
      if (msg.skin) { me.skin = msg.skin; me.tint = msg.skin; localStorage.setItem('skin', me.skin) }
      if (msg.pattern) { me.pattern = msg.pattern; localStorage.setItem('pattern', me.pattern) }
      if (msg.hat) { me.hat = msg.hat; localStorage.setItem('hat', me.hat) }
      sendUpdate(); pushState()
    }
    else if (msg.t === 'connect') { connect(msg.url, msg.room) }
    else if (msg.t === 'disconnect') { disconnect(); setStatus('오프라인 — 혼자 연주 중') }
    else if (msg.t === 'edit') { setEditing(!!msg.on) }
    else if (msg.t === 'chat') { openChat() }
    else if (msg.t === 'boost') { boostMissiles() }
    else if (msg.t === 'fire-missile') { fireWeapon('missile') }
    else if (msg.t === 'fire-slot') { fireWeapon(me.slots[(msg.slot || 1) - 1] || 'none') }
    else if (msg.t === 'slots') {
      if (Array.isArray(msg.slots)) { me.slots = msg.slots.slice(0, 3); while (me.slots.length < 3) me.slots.push('none'); localStorage.setItem('slots', JSON.stringify(me.slots)); pushState() }
    }
    else if (msg.t === 'quit') { inputSource.quit() }
  })

  // ---------- edit mode (drag feature positions) ----------
  const banner = document.getElementById('edit-banner')
  const view = { scale: 1, offX: 0, offY: 0 }
  const HANDLE_DEFS = [
    { key: 'ears', label: '귀', dx: 'earDX', dy: 'earDY' },
    { key: 'eyes', label: '눈', dx: 'eyeDX', dy: 'eyeDY' },
    { key: 'tail', label: '꼬리', dx: 'tailDX', dy: 'tailDY' }
  ]
  const handles = {}
  for (const def of HANDLE_DEFS) {
    const el = document.createElement('div')
    el.className = 'handle hidden'
    el.textContent = def.label
    document.body.appendChild(el)
    handles[def.key] = el
    let drag = null
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId)
      drag = { x: e.clientX, y: e.clientY, sdx: me.feat[def.dx], sdy: me.feat[def.dy] }
    })
    el.addEventListener('pointermove', (e) => {
      if (!drag) return
      const ddx = (e.clientX - drag.x) / view.scale
      const ddy = (e.clientY - drag.y) / view.scale
      const clamp = (v) => Math.max(-34, Math.min(34, v))
      me.feat[def.dx] = clamp(drag.sdx + ddx)
      me.feat[def.dy] = clamp(drag.sdy + ddy)
    })
    const end = () => { if (drag) { drag = null; localStorage.setItem('feat', JSON.stringify(me.feat)) } }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }
  function setEditing(on) {
    editing = on
    document.body.classList.toggle('editing', on)
    banner.classList.toggle('hidden', !on)
    for (const k in handles) handles[k].classList.toggle('hidden', !on)
    if (typeof sendHotzone === 'function') sendHotzone()
    pushState()
  }
  // dev-browser fallback: F2 toggles edit mode
  if (!window.bongo) window.addEventListener('keydown', (e) => { if (e.key === 'F2') setEditing(!editing) })

  function positionHandles(now) {
    if (!editing) return
    const a = window.AnimalArt.anchors(me, now)
    for (const def of HANDLE_DEFS) {
      const p = a[def.key]
      const el = handles[def.key]
      el.style.left = (view.offX + p.x * view.scale) + 'px'
      el.style.top = (view.offY + p.y * view.scale) + 'px'
    }
  }

  // ---------- projectiles (missile fun) ----------
  const projectiles = []   // arc: {sx,sy,tx,ty,born,dur,arcH,targetId} | homing: {homing,x,y,vx,vy,born,life}
  const effects = []       // { x, y, born, dur }
  let catPos = []          // per-frame screen centers, index-aligned with `all`
  let allRef = [me]
  const cursor = { x: 0, y: 0 } // full-screen cursor (for homing missiles + hover)
  let nextMid = 1
  const remoteMissiles = new Map() // peerId -> { items: Map(id->{...,sx,sy,ang}), ts }
  const SMOOTH = 0.3               // per-frame lerp toward the latest received position

  // Merge an incoming list of {id,...} into a persistent per-peer Map, seeding smoothed
  // display coords (sx,sy). Remote entities arrive every ~90ms; we glide toward them each
  // frame (see draw fns) so they move smoothly instead of teleporting.
  function mergeRemote(store, peerId, list, xk, yk) {
    const rec = store.get(peerId) || { items: new Map(), ts: 0 }
    rec.ts = performance.now()
    const seen = new Set()
    for (const m of (list || [])) {
      seen.add(m.id)
      const it = rec.items.get(m.id)
      if (it) Object.assign(it, m)
      else rec.items.set(m.id, Object.assign({ sx: m[xk], sy: m[yk], ang: 0, dir: 1 }, m))
    }
    for (const id of [...rec.items.keys()]) if (!seen.has(id)) rec.items.delete(id)
    store.set(peerId, rec)
  }

  function targetOf(id) {
    const idx = allRef.findIndex((c) => c.id === id)
    return idx >= 0 ? catPos[idx] : null
  }

  const MAX_PROJECTILES = 40, MAX_EFFECTS = 40
  const MAX_MISSILES = 6      // at most this many missiles can exist at once (they merge)
  const MISSILE_LIFE = 14000  // how long a missile lives before fizzling out (ms)

  // fire a missile from the bottom-left corner that then chases the mouse cursor and
  // explodes on contact with any cat. Capped at MAX_MISSILES concurrently — once one
  // explodes or fizzles, you can fire another.
  function fireHoming() {
    // count by total POWER (a merged power-5 missile counts as 5), not by missile count
    let activePower = 0
    for (const p of projectiles) if (p.homing) activePower += p.power
    if (activePower >= MAX_MISSILES) return
    // launch from just above MY cat (not a fixed corner) so in multiplayer each missile
    // starts over its owner's character and won't instantly collide with others.
    const myCat = catPos[0] || { x: canvas.clientWidth / 2, y: canvas.clientHeight - 120 }
    projectiles.push({
      homing: true, power: 1, mid: nextMid++,
      x: myCat.x, y: myCat.y - 90,   // above the head, outside the cat's own hit radius
      vx: 0, vy: -6, born: performance.now(), life: MISSILE_LIFE
    })
  }

  // Left-click boost: every active homing missile locks onto its CURRENT heading and flies
  // straight at 2× speed (with a bigger booster flame) instead of curving to the cursor.
  const MISSILE_SPEED = 6.5, BOOST_MULT = 3
  function boostMissiles() {
    for (const p of projectiles) {
      if (!p.homing || p.boost) continue
      const m = Math.hypot(p.vx, p.vy) || 1
      const spd = MISSILE_SPEED * BOOST_MULT
      p.vx = (p.vx / m) * spd; p.vy = (p.vy / m) * spd   // lock direction, double speed
      p.boost = true
    }
  }

  // fire the weapon assigned to a slot (extensible)
  function fireWeapon(id) {
    if (id === 'missile') fireHoming()
    else if (id === 'shield') activateShield()
    else if (id === 'ant') summonAnt()
    // future: else if (id === 'rock') fireRock() ...
  }

  // Shield: a compact 118° FILLED sector in front of the cat, facing the cursor. Blocks
  // missiles entering it. 10s active, then 3s cooldown. No number UI — HP (10 hit-power)
  // shows as cracks spreading across the surface; at 0 it shatters. Fades/blinks near end.
  function activateShield() {
    const now = performance.now()
    if (now < (me.shieldCdUntil || 0)) return  // active or on cooldown
    me.shieldUntil = now + SHIELD_DUR
    me.shieldCdUntil = now + SHIELD_DUR + SHIELD_CD
    me.shieldHP = SHIELD_HP
  }
  // a missile hit my shield → lose `dmg` HP (merged missiles hit for their power); break at 0
  function hitMyShield(dmg) {
    const now = performance.now()
    if (!me.shieldUntil || now >= me.shieldUntil) return
    me.shieldHP = (me.shieldHP || 0) - (dmg || 1)
    if (me.shieldHP <= 0) {
      spawnShatter(catPos[0], me.shieldAngle || 0, view.scale, 0)
      me.shieldUntil = now
      me.shieldCdUntil = now + SHIELD_CD          // cooldown starts from the break
      if (connected() && net) net.send(JSON.stringify({ t: 'shield', ttl: 0, broke: true }))
    }
  }
  function shieldAlpha(until, now) {
    const rem = until - now
    if (rem <= 0) return 0
    let a = 0.9
    if (rem < 1000) a *= rem / 1000                          // fade out over the last second
    if (rem < 1500) a *= 0.55 + 0.45 * Math.sin(now / 70)    // + blink near the end
    return Math.max(0, a)
  }
  // A curved shield PLATE floating at distance SHIELD_DIST in front of the cat, facing
  // `angle` (toward the cursor). Drawn as a convex band with a rim + central boss — a real
  // shield, not a sector from the cat. hp01: as it drops, the plate tints cyan→red + cracks.
  function drawShield(cx, cy, angle, alpha, sc, hp01) {
    if (alpha <= 0.01) return
    const D = SHIELD_DIST * sc, half = SHIELD_SPAN / 2, t = SHIELD_T * sc
    const hp = Math.max(0, Math.min(1, hp01))
    const cr = Math.round(120 + (255 - 120) * (1 - hp))
    const cg = Math.round(205 - (205 - 90) * (1 - hp))
    const cb = Math.round(255 - (255 - 80) * (1 - hp))
    const col = (a) => `rgba(${cr},${cg},${cb},${a})`
    let a = alpha
    if (hp < 0.35) a *= 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 60))   // hurt flicker
    const platePath = () => { ctx.beginPath(); ctx.arc(cx, cy, D + t, angle - half, angle + half); ctx.arc(cx, cy, D - t, angle + half, angle - half, true); ctx.closePath() }
    ctx.save()
    ctx.globalAlpha = a
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    // metallic fill across the plate thickness
    platePath()
    const g = ctx.createLinearGradient(cx + Math.cos(angle) * (D - t), cy + Math.sin(angle) * (D - t), cx + Math.cos(angle) * (D + t), cy + Math.sin(angle) * (D + t))
    g.addColorStop(0, col(0.30)); g.addColorStop(0.5, col(0.62)); g.addColorStop(1, col(0.30))
    ctx.fillStyle = g; ctx.fill()
    // cracks across the plate surface (clipped to the band)
    ctx.save(); platePath(); ctx.clip()
    const nCracks = Math.round((1 - hp) * 8)
    for (let k = 0; k < nCracks; k++) {
      const ca = angle - half + SHIELD_SPAN * (frnd(k * 3.1 + 1) * 0.86 + 0.07)
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ca) * (D + t), cy + Math.sin(ca) * (D + t))
      const segs = 2 + Math.floor(frnd(k * 5.7) * 2)
      for (let s = 1; s <= segs; s++) {
        const rr = (D + t) - (2 * t) * (s / segs), ja = ca + (frnd(k + s * 2.3) - 0.5) * 0.16
        ctx.lineTo(cx + Math.cos(ja) * rr, cy + Math.sin(ja) * rr)
      }
      ctx.strokeStyle = col(0.9); ctx.lineWidth = 1.3 * sc; ctx.stroke()
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.6 * sc; ctx.stroke()
    }
    ctx.restore()
    // bright outer rim + fainter inner edge
    ctx.beginPath(); ctx.arc(cx, cy, D + t, angle - half, angle + half); ctx.strokeStyle = col(0.95); ctx.lineWidth = 2.6 * sc; ctx.stroke()
    ctx.beginPath(); ctx.arc(cx, cy, D - t, angle - half, angle + half); ctx.strokeStyle = col(0.7); ctx.lineWidth = 1.6 * sc; ctx.stroke()
    // central boss (knob) so it reads as a shield
    const bx = cx + Math.cos(angle) * D, by = cy + Math.sin(angle) * D
    ctx.beginPath(); ctx.arc(bx, by, 4.5 * sc, 0, Math.PI * 2); ctx.fillStyle = col(0.92); ctx.fill()
    ctx.strokeStyle = col(0.5); ctx.lineWidth = 1.2 * sc; ctx.stroke()
    ctx.restore()
  }
  function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d) }
  // returns the cat whose shield plate catches missile `p`: within the plate's angular span,
  // near the plate's radius (SHIELD_DIST ± band), and moving INWARD (so you can still fire out).
  function shieldBlocks(p, now) {
    const D = SHIELD_DIST * view.scale, half = SHIELD_SPAN / 2, band = SHIELD_BAND * view.scale
    for (let i = 0; i < catPos.length; i++) {
      const cat = allRef[i], c = catPos[i]
      let until = 0, ang = 0
      if (cat.id === 'me') { until = me.shieldUntil || 0; ang = me.shieldAngle || 0 }
      else { const rs = remoteShields.get(cat.id); if (rs) { until = rs.until; ang = rs.angle } }
      if (now >= until) continue
      const toCatX = c.x - p.x, toCatY = c.y - p.y
      if ((p.vx * toCatX + p.vy * toCatY) <= 0) continue        // must be heading toward the cat
      const dist = Math.hypot(toCatX, toCatY)
      if (dist >= D - band && dist <= D + band && angDiff(Math.atan2(-toCatY, -toCatX), ang) <= half) return cat
    }
    return null
  }
  function drawShields(now) {
    // spawn shatter for any peer shield that just broke (needs current positions)
    if (remoteBreaks.length) {
      for (const id of remoteBreaks) {
        const idx = allRef.findIndex((c) => c.id === id)
        if (idx >= 0 && catPos[idx]) spawnShatter(catPos[idx], remoteShields.get(id) ? remoteShields.get(id).angle : 0, view.scale, 0)
      }
      remoteBreaks.length = 0
    }
    for (let i = 0; i < catPos.length; i++) {
      const cat = allRef[i], c = catPos[i]
      let until = 0, ang = 0, hp01 = 1
      if (cat.id === 'me') { until = me.shieldUntil || 0; ang = me.shieldAngle || 0; hp01 = (me.shieldHP || 0) / SHIELD_HP }
      else { const rs = remoteShields.get(cat.id); if (rs) { until = rs.until; ang = rs.angle; hp01 = rs.hp / (rs.max || SHIELD_HP) } }
      if (now < until) drawShield(c.x, c.y, ang, shieldAlpha(until, now), view.scale, hp01)
    }
  }
  // glass-shard burst along the shield plate when it breaks
  function spawnShatter(c, angle, sc, _hp) {
    if (!c) return
    const R = SHIELD_DIST * sc, half = SHIELD_SPAN / 2, N = 18
    for (let k = 0; k < N; k++) {
      const ph = angle - half + SHIELD_SPAN * (k / (N - 1))
      const sp = 2 + Math.random() * 3
      shieldShards.push({
        x: c.x + Math.cos(ph) * R, y: c.y + Math.sin(ph) * R,
        vx: Math.cos(ph) * sp + (Math.random() - 0.5), vy: Math.sin(ph) * sp - 1.2,
        rot: ph, born: performance.now(), life: 620, sc
      })
    }
  }
  function drawShieldShards(now) {
    for (let i = shieldShards.length - 1; i >= 0; i--) {
      const s = shieldShards[i]
      const t = (now - s.born) / s.life
      if (t >= 1) { shieldShards.splice(i, 1); continue }
      s.x += s.vx; s.y += s.vy; s.vy += 0.13; s.vx *= 0.99
      ctx.save()
      ctx.globalAlpha = (1 - t) * 0.9
      ctx.translate(s.x, s.y); ctx.rotate(s.rot)
      ctx.strokeStyle = 'rgba(150,215,255,0.95)'; ctx.lineWidth = 3 * s.sc; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(-6 * s.sc, 0); ctx.lineTo(6 * s.sc, 0); ctx.stroke()
      ctx.restore()
    }
  }

  // ---------- taskbar destruction FX ("바탕화면 부시기" style) ----------
  // The overlay covers the whole monitor (incl. the taskbar) and sits above it, so we can
  // paint cracks/debris over the taskbar strip when a missile explodes there. We can't
  // touch the real taskbar — this is purely cosmetic overlay art.
  const cracks = []          // { x, y, born, seed, r }
  const debris = []          // { x, y, vx, vy, born, life, sz, color }
  const CRACK_LIFE = 7000
  function taskbarRect() {
    if (!primaryRect) return null
    const H = canvas.clientHeight
    const top = primaryRect.y + primaryRect.h
    if (top < H - 2) return { top, h: H - top, x: primaryRect.x, w: primaryRect.w }
    return null
  }
  function inTaskbar(x, y) {
    const tb = taskbarRect()
    return tb ? (y >= tb.top - 6 && x >= tb.x - 2 && x <= tb.x + tb.w + 2) : false
  }
  function frnd(seed) { const s = Math.sin(seed) * 43758.5453; return s - Math.floor(s) }  // stable per-seed noise
  function spawnDebris(x, y, n, color) {
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = 1.5 + Math.random() * 3.5
      debris.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, born: performance.now(), life: 650 + Math.random() * 300, sz: 1.5 + Math.random() * 2.5, color: color || '#2a2a30' })
    }
  }
  function spawnCrack(x) {
    const tb = taskbarRect(); const cy = tb ? tb.top + 3 : canvas.clientHeight - 20
    cracks.push({ x, y: cy, born: performance.now(), seed: Math.random() * 1000, r: 20 + Math.random() * 18 })
    if (cracks.length > 26) cracks.shift()
    spawnDebris(x, cy, 7, '#3a3a42')
  }
  function drawCracks(now) {
    for (let i = cracks.length - 1; i >= 0; i--) {
      const ck = cracks[i], t = (now - ck.born) / CRACK_LIFE
      if (t >= 1) { cracks.splice(i, 1); continue }
      ctx.save(); ctx.translate(ck.x, ck.y); ctx.globalAlpha = (1 - t) * 0.9
      ctx.fillStyle = 'rgba(10,10,14,0.7)'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill()
      const spokes = 7
      for (let s = 0; s < spokes; s++) {
        const ang = Math.PI + (s / (spokes - 1)) * Math.PI + (frnd(ck.seed + s) - 0.5) * 0.5  // fan upward over the bar
        const segs = 3 + Math.floor(frnd(ck.seed + s * 2) * 3)
        ctx.beginPath(); ctx.moveTo(0, 0)
        for (let g = 1; g <= segs; g++) {
          const rr = (ck.r * g) / segs, j = (frnd(ck.seed + s + g * 7) - 0.5) * 8
          ctx.lineTo(Math.cos(ang) * rr - Math.sin(ang) * j, Math.sin(ang) * rr + Math.cos(ang) * j)
        }
        ctx.strokeStyle = 'rgba(18,18,24,0.85)'; ctx.lineWidth = 1.6; ctx.stroke()
        ctx.strokeStyle = 'rgba(230,235,245,0.35)'; ctx.lineWidth = 0.7; ctx.stroke()
      }
      ctx.restore()
    }
  }
  function drawDebris(now) {
    const tb = taskbarRect(); const floor = tb ? tb.top + tb.h - 2 : canvas.clientHeight - 2
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], t = (now - d.born) / d.life
      if (t >= 1) { debris.splice(i, 1); continue }
      d.vy += 0.22; d.x += d.vx; d.y += d.vy; d.vx *= 0.99
      if (d.y > floor) { d.y = floor; d.vy *= -0.35; d.vx *= 0.6 }
      ctx.save(); ctx.globalAlpha = (1 - t) * 0.9; ctx.fillStyle = d.color
      ctx.fillRect(d.x - d.sz / 2, d.y - d.sz / 2, d.sz, d.sz); ctx.restore()
    }
  }
  function drawTaskbarFX(now) { drawCracks(now); drawDebris(now) }

  // ---------- ants (🐜) — crawl on the taskbar, fight enemy ants, die in 3 hits ----------
  const ants = []              // MY ants (I simulate them authoritatively)
  const remoteAnts = new Map() // peerId -> { list:[{id,x,y,hp,dead}], ts }  (x,y relative to peer cat)
  const MAX_ANTS = 5
  const ANT_HP = 3
  const ANT_DRAW = 2   // ant visual size multiplier (on top of view.scale)
  let nextAntId = 1
  // Ants stand ON the taskbar's top boundary line (feet on the line, body above it) — not
  // sunk inside the bar. Falls back to the screen bottom if there's no detectable taskbar.
  function antGroundY() { const tb = taskbarRect(); return (tb ? tb.top : canvas.clientHeight) - 5 * view.scale }
  function summonAnt() {
    if (ants.filter((a) => !a.dead).length >= MAX_ANTS) return
    ants.push({ id: nextAntId++, x: cursor.x, y: cursor.y, vy: 0, onGround: false, hp: ANT_HP,
      dir: Math.random() < 0.5 ? -1 : 1, wanderUntil: 0, atkCd: 0, dead: false, deadAt: 0, step: Math.random() * 10 })
  }
  // peer ants: normalized X → my screen; pinned to MY taskbar line so they always crawl on it
  function remoteAntScreenPos(peerId, a) {
    return { x: (a.sx != null ? a.sx : a.nx) * canvas.clientWidth, y: antGroundY(), id: a.id, hp: a.hp, dead: a.dead }
  }
  function nearestEnemyAnt(x) {
    const now = performance.now(); let best = null, bd = Infinity
    for (const [pid, rec] of remoteAnts) {
      if (now - rec.ts > 800) continue
      for (const a of rec.items.values()) {
        if (a.dead) continue
        const s = remoteAntScreenPos(pid, a); if (!s) continue
        const d = Math.abs(s.x - x); if (d < bd) { bd = d; best = { pid, s } }
      }
    }
    return best
  }
  function spawnBlood(x, y, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 2.2
      debris.push({ x, y, vx: Math.cos(a) * sp, vy: -1 - Math.random() * 2, born: performance.now(), life: 480 + Math.random() * 260, sz: 1.4 + Math.random() * 2, color: 'rgba(190,20,30,0.9)' })
    }
  }
  function antTakeDmg(ant, dmg) {
    if (ant.dead) return
    ant.hp -= dmg; spawnBlood(ant.x, ant.y, Math.min(dmg + 1, 3))
    if (ant.hp <= 0) { ant.dead = true; ant.deadAt = performance.now(); spawnBlood(ant.x, ant.y, 7) }
  }
  function missileHitsAnt(x, y) {
    const rr = 12 * view.scale
    for (const a of ants) if (!a.dead && Math.hypot(x - a.x, y - a.y) < rr) return { local: true, ant: a }
    const now = performance.now()
    for (const [pid, rec] of remoteAnts) {
      if (now - rec.ts > 800) continue
      for (const a of rec.items.values()) {
        if (a.dead) continue
        const s = remoteAntScreenPos(pid, a); if (!s) continue
        if (Math.hypot(x - s.x, y - s.y) < rr) return { local: false, pid, id: a.id }
      }
    }
    return null
  }
  function stepAnts(now) {
    const gy = antGroundY(), W = canvas.clientWidth
    for (let i = ants.length - 1; i >= 0; i--) {
      const a = ants[i]
      if (a.dead) {
        if (now - a.deadAt > 420) ants.splice(i, 1)
        else drawAntCorpse(a, now)
        continue
      }
      if (!a.onGround) {                        // fall from the cursor onto the bar
        a.vy += 0.5; a.y += a.vy
        if (a.y >= gy) { a.y = gy; a.vy = 0; a.onGround = true }
        drawAnt(a, now, false, false); continue
      }
      const enemy = nearestEnemyAnt(a.x)
      let moving = true
      if (enemy && Math.abs(enemy.s.x - a.x) < 400) {
        a.dir = enemy.s.x >= a.x ? 1 : -1
        if (Math.abs(enemy.s.x - a.x) <= 16) {  // melee
          moving = false
          if (now >= a.atkCd) { a.atkCd = now + 600; if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: enemy.pid, ant: enemy.s.id, dmg: 1 })) }
        }
      } else if (now >= a.wanderUntil) {
        a.wanderUntil = now + 700 + Math.random() * 1400; if (Math.random() < 0.35) a.dir *= -1
      }
      if (moving) { a.x += a.dir * 0.9; if (a.x < 8) { a.x = 8; a.dir = 1 } if (a.x > W - 8) { a.x = W - 8; a.dir = -1 } a.step += 0.35 }
      a.y = gy
      drawAnt(a, now, !moving, false)
    }
  }
  function drawRemoteAnts(now) {
    const W = canvas.clientWidth, gy = antGroundY()
    for (const [pid, rec] of [...remoteAnts]) {
      if (now - rec.ts > 1000) { remoteAnts.delete(pid); continue }
      for (const a of rec.items.values()) {
        if (a.dead) continue
        const px = a.sx
        a.sx += (a.nx - a.sx) * SMOOTH   // glide toward latest (normalized X)
        if (a.sx - px > 0.001) a.dir = 1; else if (a.sx - px < -0.001) a.dir = -1
        drawAnt({ x: a.sx * W, y: gy, dir: a.dir, step: now / 90, hp: a.hp }, now, false, true)
      }
    }
  }
  function drawAnt(a, now, fighting, enemy) {
    const s = view.scale * ANT_DRAW, dir = a.dir || 1
    const body = enemy ? '#3d1618' : '#1b1b22', leg = enemy ? '#2a0f10' : '#15151a'
    ctx.save(); ctx.translate(a.x, a.y); ctx.scale(s * dir, s)
    ctx.strokeStyle = leg; ctx.lineWidth = 1.1; ctx.lineCap = 'round'
    for (let L = -1; L <= 1; L++) {
      const lift = Math.sin(a.step + L * 1.1) * 2
      ctx.beginPath(); ctx.moveTo(L * 3, -1); ctx.lineTo(L * 3 + 4, 4 + lift); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(L * 3, -1); ctx.lineTo(L * 3 - 4, 4 - lift); ctx.stroke()
    }
    ctx.fillStyle = body
    ctx.beginPath(); ctx.ellipse(-6, -3, 5, 4, 0, 0, Math.PI * 2); ctx.fill()   // abdomen
    ctx.beginPath(); ctx.ellipse(0, -3.5, 3, 3, 0, 0, Math.PI * 2); ctx.fill()  // thorax
    ctx.beginPath(); ctx.ellipse(5, -4, 3.2, 3, 0, 0, Math.PI * 2); ctx.fill()  // head
    ctx.strokeStyle = leg
    ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(9, -10); ctx.moveTo(7, -6); ctx.lineTo(11, -8); ctx.stroke()  // antennae
    if (fighting && Math.floor(now / 120) % 2 === 0) {
      ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(11, -6); ctx.moveTo(8, -3); ctx.lineTo(11, -2); ctx.stroke()  // mandibles snap
    }
    ctx.restore()
    if (a.hp < ANT_HP) {   // damage pips
      ctx.save(); ctx.translate(a.x, a.y - 14 * s)
      for (let h = 0; h < ANT_HP; h++) {
        ctx.fillStyle = h < a.hp ? '#e0e055' : 'rgba(120,120,120,0.5)'
        ctx.beginPath(); ctx.arc((h - 1) * 5 * s, 0, 1.6 * s, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }
  }
  function drawAntCorpse(a, now) {
    const s = view.scale * ANT_DRAW, t = (now - a.deadAt) / 420
    ctx.save(); ctx.translate(a.x, a.y); ctx.scale(s, s)
    ctx.globalAlpha = (1 - t) * 0.55; ctx.fillStyle = '#96101a'
    ctx.beginPath(); ctx.ellipse(0, 2, 8, 3, 0, 0, Math.PI * 2); ctx.fill()   // blood pool
    ctx.globalAlpha = (1 - t) * 0.8; ctx.fillStyle = '#1b1b22'
    ctx.beginPath(); ctx.ellipse(-2, -2, 4, 3, 0.5, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  // red (power 1) → gold (power 6+)
  function missileColor(power) {
    const t = Math.min(1, (power - 1) / 5)
    const lerp = (a, b) => Math.round(a + (b - a) * t)
    return `rgb(${lerp(225, 255)},${lerp(75, 207)},${lerp(75, 51)})`
  }
  function missileScale(power) { return 1 + Math.min(power - 1, 6) * 0.22 }

  // launch a projectile at cat `id`; opts.from = {x,y} source (defaults to a screen edge)
  function launch(id, opts = {}) {
    const t = targetOf(id); if (!t) return
    const w = canvas.clientWidth, h = canvas.clientHeight
    const edge = opts.from || { x: (t.x < w / 2) ? w + 30 : -30, y: t.y + 40 }
    projectiles.push({
      sx: edge.x, sy: edge.y, tx: t.x, ty: t.y,
      born: performance.now(), dur: opts.dur || 820, arcH: opts.arcH != null ? opts.arcH : 120,
      type: opts.type || 'missile', targetId: id
    })
  }

  function drawMissile(x, y, ang, now, power = 1, boost = false) {
    const s = missileScale(power)
    const body = missileColor(power)
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s)
    // booster: a longer, hotter, flickering double flame + heat glow while boosted
    if (boost) {
      const bl = 22 + Math.sin(now / 22) * 8
      const bg = ctx.createLinearGradient(-14 - bl, 0, -13, 0)
      bg.addColorStop(0, 'rgba(120,180,255,0)'); bg.addColorStop(0.5, 'rgba(120,190,255,0.85)'); bg.addColorStop(1, '#fff3c4')
      ctx.fillStyle = bg
      ctx.beginPath(); ctx.moveTo(-13, -6); ctx.lineTo(-14 - bl, 0); ctx.lineTo(-13, 6); ctx.closePath(); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.beginPath(); ctx.moveTo(-13, -3); ctx.lineTo(-14 - bl * 0.6, 0); ctx.lineTo(-13, 3); ctx.closePath(); ctx.fill()
      for (let i = 0; i < 3; i++) {   // spark puffs trailing behind
        const px = -16 - (frnd(now / 40 + i) * 16), py = (frnd(now / 30 + i * 2) - 0.5) * 8
        ctx.globalAlpha = 0.5; ctx.fillStyle = i % 2 ? '#ffd166' : '#8ec5ff'
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
      }
    }
    const fl = (7 + Math.sin(now / 40) * 3) * (boost ? 1.4 : 1)
    const g = ctx.createLinearGradient(-14 - fl, 0, -13, 0)
    g.addColorStop(0, 'rgba(255,170,40,0)'); g.addColorStop(1, power > 3 ? '#ffe066' : '#ff9d33')
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-14, -4); ctx.lineTo(-14 - fl, 0); ctx.lineTo(-14, 4); ctx.closePath(); ctx.fill()
    ctx.fillStyle = body; ctx.strokeStyle = '#3a3742'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(-14, -5, 22, 10, 4); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#cfd3db'
    ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(16, 0); ctx.lineTo(8, 5); ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.fillStyle = power > 3 ? '#e0b020' : '#b23a3a'
    for (const sy of [-5, 5]) { ctx.beginPath(); ctx.moveTo(-13, sy); ctx.lineTo(-18, sy * 1.7); ctx.lineTo(-8, sy); ctx.closePath(); ctx.fill() }
    // sparkle aura for powered-up missiles
    if (power > 2) {
      ctx.strokeStyle = 'rgba(255,210,80,0.7)'; ctx.lineWidth = 1.5
      for (let i = 0; i < 4; i++) {
        const a = now / 120 + i * Math.PI / 2, r = 16 + Math.sin(now / 90 + i) * 3
        ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.6, 0, Math.PI * 2); ctx.stroke()
      }
    }
    ctx.restore()
  }

  function drawExplosion(x, y, t, power = 1) {
    const boom = 1 + Math.min(power - 1, 6) * 0.35
    const gold = power > 3
    ctx.save(); ctx.translate(x, y); ctx.scale(boom, boom)
    const ease = 1 - Math.pow(1 - t, 2)
    ctx.globalAlpha = Math.max(0, 1 - t * 1.4); ctx.fillStyle = gold ? '#fff0b0' : '#fff3c4'
    ctx.beginPath(); ctx.arc(0, 0, 8 + ease * 20, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = Math.max(0, 1 - t); ctx.strokeStyle = gold ? '#ffcf33' : '#ff9d33'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(0, 0, 10 + ease * 34, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = '#ffcf47'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
    const spokes = gold ? 12 : 8
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2, r0 = 12 + ease * 20, r1 = 12 + ease * 38
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke()
    }
    ctx.restore()
  }

  function hitTestCats(x, y) {
    const r = view.scale * 56
    for (let i = 0; i < catPos.length; i++) {
      const c = catPos[i]
      if (Math.hypot(x - c.x, y - c.y) < r) return { cat: allRef[i], at: c }
    }
    return null
  }

  // peer missiles arrive in NORMALIZED screen coords (nx,ny) → converge on the right target
  // on any resolution. Collision uses the smoothed on-screen position (sx,sy in 0..1).
  function hitRemoteMissile(x, y, power) {
    const W = canvas.clientWidth, H = canvas.clientHeight, now = performance.now()
    for (const [pid, rec] of remoteMissiles) {
      if (now - rec.ts > 500) continue
      for (const it of rec.items.values()) {
        const sx = it.sx * W, sy = it.sy * H
        if (Math.hypot(x - sx, y - sy) < 16 + (power + (it.power || 1)) * 2) return { x: sx, y: sy, power: it.power || 1 }
      }
    }
    return null
  }
  function drawRemoteMissiles(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const [pid, rec] of [...remoteMissiles]) {
      if (now - rec.ts > 500) { remoteMissiles.delete(pid); continue }
      for (const it of rec.items.values()) {
        const px = it.sx, py = it.sy
        it.sx += (it.nx - it.sx) * SMOOTH; it.sy += (it.ny - it.sy) * SMOOTH   // glide toward latest
        const mvx = (it.sx - px) * W, mvy = (it.sy - py) * H
        if (mvx * mvx + mvy * mvy > 0.25) it.ang = Math.atan2(mvy, mvx)          // face travel direction
        drawMissile(it.sx * W, it.sy * H, it.ang, now, it.power || 1)
      }
    }
  }

  function addEffect(x, y, power) {
    effects.push({ x, y, born: performance.now(), dur: 520, power: power || 1 })
    if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS)
    if (inTaskbar(x, y)) spawnCrack(x)   // blasting the taskbar leaves a crack + debris
  }

  // The blast's damage radius matches the explosion's visual size (grows with power).
  function blastRadius(power) {
    const boom = 1 + Math.min(power - 1, 6) * 0.35
    return 46 * boom * view.scale
  }
  // is (x,y) on `cat`'s shielded side? (a blast there is absorbed, so the cat isn't hurt)
  function catShieldCovers(cat, c, x, y, now) {
    let until = 0, ang = 0
    if (cat.id === 'me') { until = me.shieldUntil || 0; ang = me.shieldAngle || 0 }
    else { const rs = remoteShields.get(cat.id); if (rs) { until = rs.until; ang = rs.angle } }
    if (now >= until) return false
    const D = SHIELD_DIST * view.scale, half = SHIELD_SPAN / 2, band = SHIELD_BAND * view.scale
    // protected if the blast is in the shielded direction AND at/beyond the plate (plate is between)
    return Math.hypot(x - c.x, y - c.y) >= D - band && angDiff(Math.atan2(y - c.y, x - c.x), ang) <= half
  }
  // Area-of-effect detonation: the explosion damages EVERYTHING within its blast radius
  // (ants, cats, and it leaves a crack if on the taskbar) — not just the one thing it touched.
  function explode(x, y, power) {
    addEffect(x, y, power)
    const R = blastRadius(power), now = performance.now()
    for (const a of ants) if (!a.dead && Math.hypot(x - a.x, y - a.y) <= R) antTakeDmg(a, power)
    for (const [pid, rec] of remoteAnts) {
      if (now - rec.ts > 800) continue
      for (const a of rec.items.values()) {
        if (a.dead) continue
        const s = remoteAntScreenPos(pid, a); if (!s) continue
        if (Math.hypot(x - s.x, y - s.y) <= R && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: a.id, dmg: power }))
      }
    }
    for (let i = 0; i < catPos.length; i++) {
      const cat = allRef[i], c = catPos[i]
      if (Math.hypot(x - c.x, y - c.y) > R + view.scale * 30) continue   // blast overlaps the cat body
      if (catShieldCovers(cat, c, x, y, now)) continue
      cat.hitUntil = now + 1000 + Math.min(power - 1, 5) * 200
      if (cat.id !== 'me' && connected()) net.send(JSON.stringify({ t: 'hit', target: cat.id, power }))
    }
  }

  function mergeMissiles() {
    for (let i = 0; i < projectiles.length; i++) {
      const a = projectiles[i]; if (!a.homing) continue
      for (let j = i + 1; j < projectiles.length; j++) {
        const b = projectiles[j]; if (!b.homing) continue
        const r = 14 + (a.power + b.power) * 2
        if (Math.hypot(a.x - b.x, a.y - b.y) < r) {
          a.power += b.power                 // combine → bigger + goldener + fancier
          a.x = (a.x + b.x) / 2; a.y = (a.y + b.y) / 2
          projectiles.splice(j, 1); j--
        }
      }
    }
  }

  function stepProjectiles(now) {
    mergeMissiles()
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i]

      if (p.homing) {
        if (now - p.born > p.life) { projectiles.splice(i, 1); continue }
        if (!p.boost) {                       // normal: curve toward the cursor
          const dx = cursor.x - p.x, dy = cursor.y - p.y
          const d = Math.hypot(dx, dy) || 1
          p.vx += (dx / d * MISSILE_SPEED - p.vx) * 0.11
          p.vy += (dy / d * MISSILE_SPEED - p.vy) * 0.11
        }
        p.x += p.vx; p.y += p.vy
        // left the overlay (e.g. a boosted missile flying off-screen) → drop it now so it
        // stops counting toward the active-missile limit and you can fire again immediately
        const M = 60
        if (p.x < -M || p.x > canvas.clientWidth + M || p.y < -M || p.y > canvas.clientHeight + M) {
          projectiles.splice(i, 1); continue
        }
        // a shield (mine or a peer's) absorbs the missile — no area blast, shield eats it
        const blk = shieldBlocks(p, now)
        if (blk) {
          addEffect(p.x, p.y, p.power)
          if (blk.id === 'me') hitMyShield(p.power)   // merged missile deals its full power
          else if (connected()) net.send(JSON.stringify({ t: 'shield-hit', target: blk.id, power: p.power }))
          projectiles.splice(i, 1); continue
        }
        // detonate on contact with an ant, a cat, a peer missile, OR the taskbar → AoE blast
        if (missileHitsAnt(p.x, p.y) || hitTestCats(p.x, p.y) || hitRemoteMissile(p.x, p.y, p.power) || inTaskbar(p.x, p.y)) {
          explode(p.x, p.y, p.power)
          projectiles.splice(i, 1); continue
        }
        drawMissile(p.x, p.y, Math.atan2(p.vy, p.vx), now, p.power, p.boost)
        continue
      }

      const t = (now - p.born) / p.dur
      if (t >= 1) {
        addEffect(p.tx, p.ty, 1)
        const cat = allRef.find((c) => c.id === p.targetId)
        if (cat) cat.hitUntil = now + 1000
        projectiles.splice(i, 1); continue
      }
      const x = p.sx + (p.tx - p.sx) * t
      const y = p.sy + (p.ty - p.sy) * t - p.arcH * 4 * t * (1 - t)
      const t2 = Math.min(1, t + 0.02)
      const x2 = p.sx + (p.tx - p.sx) * t2
      const y2 = p.sy + (p.ty - p.sy) * t2 - p.arcH * 4 * t2 * (1 - t2)
      drawMissile(x, y, Math.atan2(y2 - y, x2 - x), now)
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i], t = (now - e.born) / e.dur
      if (t >= 1) { effects.splice(i, 1); continue }
      drawExplosion(e.x, e.y, t, e.power)
    }
  }

  // stream my missiles (relative to my cat) + shield state so peers can see/collide/block
  let sentMissiles = false, sentShield = false, sentAnts = false
  setInterval(() => {
    if (!connected()) return
    const now = performance.now()
    const NW = canvas.clientWidth || 1, NH = canvas.clientHeight || 1
    const mine = projectiles.filter((p) => p.homing)
    if (mine.length) {
      sentMissiles = true
      // stream missiles in NORMALIZED screen coords (0..1) so they converge on the right
      // target on every screen regardless of resolution/aspect
      net.send(JSON.stringify({
        t: 'missiles',
        list: mine.map((m) => ({ id: m.mid, nx: +(m.x / NW).toFixed(4), ny: +(m.y / NH).toFixed(4), power: m.power }))
      }))
    } else if (sentMissiles) { net.send(JSON.stringify({ t: 'missiles', list: [] })); sentMissiles = false }

    if (me.shieldUntil && now < me.shieldUntil) {
      sentShield = true
      net.send(JSON.stringify({ t: 'shield', angle: me.shieldAngle || 0, ttl: Math.round(me.shieldUntil - now), hp: me.shieldHP || 0, max: SHIELD_HP }))
    } else if (sentShield) { net.send(JSON.stringify({ t: 'shield', ttl: 0 })); sentShield = false }

    if (ants.length) {
      sentAnts = true
      // ants: normalized X only (peers pin them to THEIR taskbar line, see drawRemoteAnts)
      net.send(JSON.stringify({ t: 'ants', list: ants.map((a) => ({ id: a.id, nx: +(a.x / NW).toFixed(4), hp: a.hp, dead: a.dead })) }))
    } else if (sentAnts) { net.send(JSON.stringify({ t: 'ants', list: [] })); sentAnts = false }

    // my widget position (normalized 0..1 to my screen) + interaction count, so peers place
    // my cat where I put it and can see my counter
    if (wx != null) {
      const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1
      net.send(JSON.stringify({ t: 'pos', nx: +(wx / W).toFixed(4), ny: +(wy / H).toFixed(4), taps: tapCount }))
    }
  }, 90)

  // ---------- widget placement + click-through management ----------
  // The window covers the whole screen. The cat "widget" (cat + desk + bottom bar)
  // sits at a draggable spot; everywhere else the window is click-through so it never
  // blocks your normal desktop use. Interactive only while the cursor is over the widget.
  const SCALE = 0.8    // widget (cat + desk + bar) drawn 20% smaller (counter text stays CSS-sized)
  const BAR_SPACE = 34 // room below the cell for the DOM #hud-bar
  const GRID_COLS = 6, GRID_ROWS = 4   // drag-snap preset anchors
  const SIDE = 0   // HUD bar inset; 0 → bar width == desk width (both = cellPxW), always aligned
  const hudBar = document.getElementById('hud-bar')
  const cellPxW = CELL_W * SCALE
  const cellPxH = CELL_H * SCALE

  let wx = null, wy = null // widget top-left (of me's cell)
  let primaryRect = null   // primary monitor work area (canvas coords), from main
  // chosen preset as a grid cell {c,r} — persisted so it survives monitor switches & restarts
  let savedAnchor = null
  try { const s = JSON.parse(localStorage.getItem('anchor') || 'null'); if (s && typeof s.c === 'number') savedAnchor = s } catch {}
  // on monitor move, re-apply the SAME preset cell to the new screen (don't reset to center)
  if (inputSource.onLayout) inputSource.onLayout((l) => { primaryRect = l.primary; wx = null })

  // bottom limit for the cat widget = taskbar top (so it never overlaps the taskbar), or the
  // screen bottom if there's no detectable taskbar.
  function usableBottom() { const tb = taskbarRect(); return tb ? tb.top : canvas.clientHeight }
  function clampWidget() {
    const W = canvas.clientWidth
    wx = Math.max(0, Math.min(wx, W - cellPxW))
    wy = Math.max(0, Math.min(wy, usableBottom() - (cellPxH + BAR_SPACE)))
  }
  // Preset anchor positions (widget top-left) — a GRID_COLS×GRID_ROWS grid spanning the whole
  // usable area (0..maxX, 0..maxY), so the widget never runs off-screen. Ratio-based via the
  // span, so it maps consistently across resolutions.
  function anchorAt(c, r) {
    const W = canvas.clientWidth
    const maxX = Math.max(0, W - cellPxW), maxY = Math.max(0, usableBottom() - (cellPxH + BAR_SPACE))
    const fx = GRID_COLS === 1 ? 0.5 : c / (GRID_COLS - 1)
    const fy = GRID_ROWS === 1 ? 0.5 : r / (GRID_ROWS - 1)
    return { x: Math.round(fx * maxX), y: Math.round(fy * maxY), c, r }
  }
  function anchorPoints() {
    const pts = []
    for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) pts.push(anchorAt(c, r))
    return pts
  }
  function nearestAnchor(x, y) {
    let best = null, bd = Infinity
    for (const p of anchorPoints()) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p } }
    return best
  }
  function snapToNearestAnchor() {
    const a = nearestAnchor(wx, wy); if (!a) return
    wx = a.x; wy = a.y
    savedAnchor = { c: a.c, r: a.r }; localStorage.setItem('anchor', JSON.stringify(savedAnchor))
    clampWidget(); positionHud(); sendHotzone()
  }
  function initWidget() {
    // re-apply the saved preset cell (persists across monitor switches & restarts)
    if (savedAnchor && savedAnchor.c < GRID_COLS && savedAnchor.r < GRID_ROWS) {
      const a = anchorAt(savedAnchor.c, savedAnchor.r)
      wx = a.x; wy = a.y; clampWidget(); positionHud(); sendHotzone(); return
    }
    // first run: default bottom-center → snap (which also saves the choice)
    const pr = primaryRect || { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight }
    wx = Math.round(pr.x + (pr.w - cellPxW) / 2)
    wy = Math.round(pr.y + pr.h - (cellPxH + BAR_SPACE) - 12)
    clampWidget()
    snapToNearestAnchor()
  }
  function positionHud() {
    hudBar.style.left = (wx + SIDE) + 'px'
    hudBar.style.top = (wy + cellPxH + 2) + 'px'
    hudBar.style.width = (cellPxW - SIDE * 2) + 'px'
  }
  function positionChat() {
    chatbar.style.left = (wx + cellPxW / 2) + 'px'
    chatbar.style.top = (wy - 34) + 'px'
  }
  // a peer's interaction counter, drawn on-canvas below their cat (I show mine in the DOM HUD).
  // Count text stays a FIXED size (like my HUD counter) — not scaled with the smaller widget.
  function drawPeerCount(origin, taps) {
    const sc = view.scale
    const cx = origin.x + CELL_W / 2 * sc
    const y = origin.y + CELL_H * sc + 3
    const label = (taps || 0).toLocaleString()
    ctx.save()
    ctx.font = '13px "Segoe UI", "Malgun Gothic", sans-serif'
    const w = ctx.measureText(label).width + 18, h = 20
    ctx.fillStyle = 'rgba(20,20,28,0.82)'
    ctx.beginPath(); ctx.roundRect(cx - w / 2, y, w, h, 9); ctx.fill()
    ctx.fillStyle = '#ffe08a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, cx, y + h / 2 + 0.5)
    ctx.restore()
  }

  // Main decides click-through by polling the real cursor against this "hotzone".
  // We just report the widget rect (+ force flag while chatting/editing).
  let chatOpenFlag = false, dragging = null
  function sendHotzone() {
    if (wx == null) return
    inputSource.setHotzone({ rect: { x: wx, y: wy, w: cellPxW, h: cellPxH + BAR_SPACE }, force: chatOpenFlag || editing })
  }

  // cursor for missile homing + dragging comes from main's poll (window-relative)
  if (inputSource.onCursor) inputSource.onCursor((p) => {
    cursor.x = p.x; cursor.y = p.y
    if (dragging) { wx = p.x - dragging.dx; wy = p.y - dragging.dy; clampWidget(); positionHud(); sendHotzone() }
  })

  // drag the cat (canvas) to move the whole widget — but not while editing
  canvas.addEventListener('mousedown', (e) => {
    if (editing || wx == null) return
    const onCat = e.clientX >= wx && e.clientX <= wx + cellPxW && e.clientY >= wy && e.clientY <= wy + cellPxH
    if (onCat) dragging = { dx: e.clientX - wx, dy: e.clientY - wy }
  })
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = null; snapToNearestAnchor() }   // drop → snap to nearest preset
  })
  // faint preset dots while dragging; nearest one highlighted (where the cat will land)
  function drawSnapGrid() {
    if (!dragging) return
    const pts = anchorPoints(), near = nearestAnchor(wx, wy)
    const cxOff = cellPxW / 2, cyOff = cellPxH / 2
    ctx.save()
    for (const p of pts) {
      const isNear = near && p.x === near.x && p.y === near.y
      ctx.beginPath(); ctx.arc(p.x + cxOff, p.y + cyOff, isNear ? 11 : 6, 0, Math.PI * 2)
      ctx.fillStyle = isNear ? 'rgba(108,140,255,0.5)' : 'rgba(150,160,190,0.28)'
      ctx.fill()
      if (isNear) { ctx.strokeStyle = 'rgba(108,140,255,0.9)'; ctx.lineWidth = 2; ctx.stroke() }
    }
    ctx.restore()
  }

  // ---------- render loop ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1
    canvas.width = fxCanvas.width = Math.round(canvas.clientWidth * dpr)
    canvas.height = fxCanvas.height = Math.round(canvas.clientHeight * dpr)
    if (wx != null) clampWidget()
  }
  window.addEventListener('resize', resize)
  resize()

  function tickBlink(p, now) {
    if (now >= p.nextBlink) { p.blinkUntil = now + 120; p.nextBlink = now + 1800 + Math.random() * 3500 }
  }

  function frame() {
    const now = performance.now()
    const dpr = window.devicePixelRatio || 1
    // keep both backing stores in sync with the CSS box (robust against resize timing)
    const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr)
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = fxCanvas.width = cw; canvas.height = fxCanvas.height = ch }
    const cW = canvas.clientWidth, cH = canvas.clientHeight
    // ---- STAGE layer (below the DOM HUD bar): cats + preset dots + peer counters ----
    ctx = stagectx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cW, cH)

    if (wx == null) initWidget()

    const all = [me, ...peers.values()]
    allRef = all
    for (const p of all) tickBlink(p, now)

    const scale = SCALE
    view.scale = scale; view.offX = wx; view.offY = wy
    const BUB = window.AnimalArt.BUBBLE_H
    const W = canvas.clientWidth, H = canvas.clientHeight
    // each cat sits at its OWN top-left origin: me at my widget; a peer where THEY placed
    // themselves (normalized position they broadcast), so nobody is glued in a row.
    const origins = all.map((p, i) => {
      if (p.id === 'me') return { x: wx, y: wy }
      if (p.nx != null && p.ny != null) {
        return {
          x: Math.max(0, Math.min(p.nx * W, W - CELL_W * scale)),
          y: Math.max(0, Math.min(p.ny * H, usableBottom() - (CELL_H * scale + BAR_SPACE)))
        }
      }
      return { x: wx + i * CELL_W * scale, y: wy } // fallback until their position arrives
    })
    catPos = all.map((p, i) => ({
      x: origins[i].x + CELL_W / 2 * scale,
      y: origins[i].y + (BUB + 100) * scale // ~ head/upper body
    }))

    // shield faces the cursor while active
    if (catPos[0]) me.shieldAngle = Math.atan2(cursor.y - catPos[0].y, cursor.x - catPos[0].x)

    drawSnapGrid()   // preset dots under the cats while dragging

    all.forEach((p, i) => {
      ctx.save()
      ctx.translate(origins[i].x, origins[i].y)
      ctx.scale(scale, scale)
      window.AnimalArt.draw(ctx, p.animal, p, now)
      ctx.restore()
      if (p.id !== 'me' && p.taps != null) drawPeerCount(origins[i], p.taps) // peer's counter
    })

    // ---- FX layer (ABOVE the HUD bar): weapons draw on top of the character UI so ants /
    // missiles are never hidden behind the counter bar ----
    ctx = fxctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cW, cH)
    drawShields(now)
    stepProjectiles(now)
    drawShieldShards(now)
    drawRemoteMissiles(now)
    drawTaskbarFX(now)
    stepAnts(now)
    drawRemoteAnts(now)
    ctx = stagectx

    positionHandles(now)
    positionHud()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  pushState()
})()
