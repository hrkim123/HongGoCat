// Overlay: render loop, global input, multiplayer client, edit mode.
(function () {
  const canvas = document.getElementById('stage')
  const ctx = canvas.getContext('2d')
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
  const SHIELD_ARC = (140 * Math.PI) / 180        // 140° facing the cursor
  const SHIELD_R = 108                            // outer-rim radius (px, × view.scale)
  const SHIELD_HP = 10                            // breaks after 10 missile hits
  // fixed scatter order in which rim segments crack as HP drops (looks shattered, not a wipe)
  const SHIELD_SEG = 15
  const SHIELD_BREAK_ORDER = [7, 2, 11, 4, 13, 0, 9, 5, 14, 1, 8, 12, 3, 10, 6]
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
      else if (msg.t === 'pulse') { const p = peers.get(msg.id); if (p) pulse(p, msg.kind) }
      else if (msg.t === 'chat') { const p = peers.get(msg.id); if (p) showBubble(p, String(msg.text)) }
      else if (msg.t === 'throw') { const src = targetOf(msg.id); launch('me', src ? { from: src } : {}) }
      else if (msg.t === 'missiles') { remoteMissiles.set(msg.id, { list: msg.list || [], ts: performance.now() }) }
      else if (msg.t === 'hit') { if (msg.target === me.netId) me.hitUntil = performance.now() + 1000 + Math.min((msg.power || 1) - 1, 5) * 200 }
      else if (msg.t === 'shield') {
        if (msg.ttl > 0) remoteShields.set(msg.id, { until: performance.now() + msg.ttl, angle: msg.angle || 0, hp: msg.hp != null ? msg.hp : SHIELD_HP, max: msg.max || SHIELD_HP })
        else { if (msg.broke) remoteBreaks.push(msg.id); remoteShields.delete(msg.id) }
      }
      else if (msg.t === 'shield-hit') { if (msg.target === me.netId) hitMyShield() }
      else if (msg.t === 'ants') { remoteAnts.set(msg.id, { list: msg.list || [], ts: performance.now() }) }
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
  const remoteMissiles = new Map() // peerId -> { list:[{id,dx,dy,power}], ts }

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

  // fire the weapon assigned to a slot (extensible)
  function fireWeapon(id) {
    if (id === 'missile') fireHoming()
    else if (id === 'shield') activateShield()
    else if (id === 'ant') summonAnt()
    // future: else if (id === 'rock') fireRock() ...
  }

  // Shield: a wide 140° arc RIM in front of the cat, facing the cursor. Blocks missiles
  // that enter its arc. 10s active, then 3s cooldown. No number UI — HP (10 hits) shows as
  // the rim cracking apart; when HP runs out it shatters. It also fades/blinks near the end.
  function activateShield() {
    const now = performance.now()
    if (now < (me.shieldCdUntil || 0)) return  // active or on cooldown
    me.shieldUntil = now + SHIELD_DUR
    me.shieldCdUntil = now + SHIELD_DUR + SHIELD_CD
    me.shieldHP = SHIELD_HP
  }
  // an incoming (peer) missile hit my shield → lose 1 HP; shatter + break at 0
  function hitMyShield() {
    const now = performance.now()
    if (!me.shieldUntil || now >= me.shieldUntil) return
    me.shieldHP = (me.shieldHP || 0) - 1
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
  // rim only (no filled sector). hp01 = HP fraction (1 full → 0 broken): as it drops, rim
  // segments crack away in a scattered order and the color bleeds cyan → red, with a flicker.
  function drawShield(cx, cy, angle, alpha, sc, hp01) {
    if (alpha <= 0.01) return
    const R = SHIELD_R * sc, half = SHIELD_ARC / 2
    const hp = Math.max(0, Math.min(1, hp01))
    const cr = Math.round(120 + (255 - 120) * (1 - hp))
    const cg = Math.round(205 - (205 - 90) * (1 - hp))
    const cb = Math.round(255 - (255 - 80) * (1 - hp))
    const col = (a) => `rgba(${cr},${cg},${cb},${a})`
    let a = alpha
    if (hp < 0.35) a *= 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 60))   // hurt flicker
    const broken = Math.round((1 - hp) * SHIELD_SEG)
    const step = SHIELD_ARC / SHIELD_SEG, segLen = step * 0.82
    ctx.save()
    ctx.globalAlpha = a
    ctx.lineCap = 'round'
    // soft outer glow band along the whole arc (dimming as HP falls)
    ctx.beginPath(); ctx.arc(cx, cy, R, angle - half, angle + half)
    ctx.strokeStyle = col(0.10 + 0.10 * hp); ctx.lineWidth = 15 * sc; ctx.stroke()
    for (let s = 0; s < SHIELD_SEG; s++) {
      const a0 = angle - half + s * step, a1 = a0 + segLen
      const cracked = SHIELD_BREAK_ORDER[s] < broken
      if (cracked) {
        // fractured remnant: faint, nudged outward — reads as a broken shard
        const jr = R + (2 + (s % 3)) * sc
        ctx.beginPath(); ctx.arc(cx, cy, jr, a0 + step * 0.15, a1 - step * 0.15)
        ctx.strokeStyle = col(0.16); ctx.lineWidth = 2 * sc; ctx.stroke()
      } else {
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1)
        ctx.strokeStyle = col(0.95); ctx.lineWidth = 5 * sc; ctx.stroke()
        ctx.beginPath(); ctx.arc(cx, cy, R - 3.5 * sc, a0, a1)
        ctx.strokeStyle = col(0.5); ctx.lineWidth = 2 * sc; ctx.stroke()
      }
    }
    ctx.restore()
  }
  function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d) }
  // returns the cat whose shield catches missile `p`. A shield blocks a missile that is
  // within its arc/radius AND moving INWARD (toward that cat) — so it stops incoming fire
  // (including your own missiles curving back in) but lets you launch missiles outward.
  function shieldBlocks(p, now) {
    const R = SHIELD_R * view.scale, half = SHIELD_ARC / 2
    for (let i = 0; i < catPos.length; i++) {
      const cat = allRef[i], c = catPos[i]
      let until = 0, ang = 0
      if (cat.id === 'me') { until = me.shieldUntil || 0; ang = me.shieldAngle || 0 }
      else { const rs = remoteShields.get(cat.id); if (rs) { until = rs.until; ang = rs.angle } }
      if (now >= until) continue
      const toCatX = c.x - p.x, toCatY = c.y - p.y
      const inward = (p.vx * toCatX + p.vy * toCatY) > 0                 // heading toward the cat
      if (!inward) continue
      if (Math.hypot(-toCatX, -toCatY) <= R && angDiff(Math.atan2(-toCatY, -toCatX), ang) <= half) return cat
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
  // glass-shard burst along the arc when a shield breaks
  function spawnShatter(c, angle, sc, _hp) {
    if (!c) return
    const R = SHIELD_R * sc, half = SHIELD_ARC / 2, N = 18
    for (let k = 0; k < N; k++) {
      const ph = angle - half + SHIELD_ARC * (k / (N - 1))
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
  let nextAntId = 1
  function antGroundY() { const tb = taskbarRect(); return tb ? tb.top + tb.h * 0.5 : canvas.clientHeight - 22 }
  function summonAnt() {
    if (ants.filter((a) => !a.dead).length >= MAX_ANTS) return
    ants.push({ id: nextAntId++, x: cursor.x, y: cursor.y, vy: 0, onGround: false, hp: ANT_HP,
      dir: Math.random() < 0.5 ? -1 : 1, wanderUntil: 0, atkCd: 0, dead: false, deadAt: 0, step: Math.random() * 10 })
  }
  function remoteAntScreenPos(peerId, a) {
    const idx = allRef.findIndex((c) => c.id === peerId)
    if (idx < 0) return null
    const c = catPos[idx]; if (!c) return null
    return { x: c.x + a.x, y: c.y + a.y, id: a.id, hp: a.hp, dead: a.dead }
  }
  function nearestEnemyAnt(x) {
    const now = performance.now(); let best = null, bd = Infinity
    for (const [pid, rec] of remoteAnts) {
      if (now - rec.ts > 800) continue
      for (const a of rec.list) {
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
      for (const a of rec.list) {
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
    for (const [pid, rec] of [...remoteAnts]) {
      if (now - rec.ts > 1000) { remoteAnts.delete(pid); continue }
      for (const a of rec.list) {
        if (a.dead) continue
        const s = remoteAntScreenPos(pid, a); if (!s) continue
        drawAnt({ x: s.x, y: s.y, dir: 1, step: now / 90, hp: a.hp }, now, false, true)
      }
    }
  }
  function drawAnt(a, now, fighting, enemy) {
    const s = view.scale, dir = a.dir || 1
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
    const s = view.scale, t = (now - a.deadAt) / 420
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

  function drawMissile(x, y, ang, now, power = 1) {
    const s = missileScale(power)
    const body = missileColor(power)
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s)
    const fl = 7 + Math.sin(now / 40) * 3
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

  // a peer's missile is streamed relative to THEIR cat; place it under their cat in my view
  function remoteMissileScreenPos(peerId, m) {
    const idx = allRef.findIndex((c) => c.id === peerId)
    if (idx < 0) return null
    const c = catPos[idx]; if (!c) return null
    return { x: c.x + m.dx, y: c.y + m.dy, power: m.power || 1 }
  }
  function hitRemoteMissile(x, y, power) {
    const now = performance.now()
    for (const [pid, rec] of remoteMissiles) {
      if (now - rec.ts > 500) continue
      for (const m of rec.list) {
        const s = remoteMissileScreenPos(pid, m); if (!s) continue
        if (Math.hypot(x - s.x, y - s.y) < 16 + (power + s.power) * 2) return s
      }
    }
    return null
  }
  function drawRemoteMissiles(now) {
    for (const [pid, rec] of [...remoteMissiles]) {
      if (now - rec.ts > 500) { remoteMissiles.delete(pid); continue }
      for (const m of rec.list) {
        const s = remoteMissileScreenPos(pid, m); if (!s) continue
        drawMissile(s.x, s.y, now / 200, now, s.power) // spin in place (no local velocity)
      }
    }
  }

  function addEffect(x, y, power) {
    effects.push({ x, y, born: performance.now(), dur: 520, power: power || 1 })
    if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS)
    if (inTaskbar(x, y)) spawnCrack(x)   // blasting the taskbar leaves a crack + debris
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
        const dx = cursor.x - p.x, dy = cursor.y - p.y
        const d = Math.hypot(dx, dy) || 1
        const SPEED = 6.5
        p.vx += (dx / d * SPEED - p.vx) * 0.11
        p.vy += (dy / d * SPEED - p.vy) * 0.11
        p.x += p.vx; p.y += p.vy
        // a shield (mine or a peer's) intercepts the missile before it reaches the cat
        const blk = shieldBlocks(p, now)
        if (blk) {
          addEffect(p.x, p.y, p.power)
          if (blk.id === 'me') hitMyShield()
          else if (connected()) net.send(JSON.stringify({ t: 'shield-hit', target: blk.id }))
          projectiles.splice(i, 1); continue
        }
        // a missile can also squash ants (mine → local; a peer's → tell that peer)
        const ah = missileHitsAnt(p.x, p.y)
        if (ah) {
          addEffect(p.x, p.y, p.power)
          if (ah.local) antTakeDmg(ah.ant, ANT_HP)
          else if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: ANT_HP }))
          projectiles.splice(i, 1); continue
        }
        const hit = hitTestCats(p.x, p.y)
        if (hit) {
          addEffect(hit.at.x, hit.at.y, p.power)
          hit.cat.hitUntil = now + 1000 + Math.min(p.power - 1, 5) * 200
          if (hit.cat.id !== 'me' && connected()) net.send(JSON.stringify({ t: 'hit', target: hit.cat.id, power: p.power }))
          projectiles.splice(i, 1); continue
        }
        // explode on contact with an enemy (remote) missile
        const rm = hitRemoteMissile(p.x, p.y, p.power)
        if (rm) { addEffect((p.x + rm.x) / 2, (p.y + rm.y) / 2, Math.max(p.power, rm.power)); projectiles.splice(i, 1); continue }
        drawMissile(p.x, p.y, Math.atan2(p.vy, p.vx), now, p.power)
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
    const mine = projectiles.filter((p) => p.homing)
    if (mine.length) {
      sentMissiles = true
      const my = catPos[0] || { x: 0, y: 0 }
      net.send(JSON.stringify({
        t: 'missiles',
        list: mine.map((m) => ({ id: m.mid, dx: Math.round(m.x - my.x), dy: Math.round(m.y - my.y), power: m.power }))
      }))
    } else if (sentMissiles) { net.send(JSON.stringify({ t: 'missiles', list: [] })); sentMissiles = false }

    if (me.shieldUntil && now < me.shieldUntil) {
      sentShield = true
      net.send(JSON.stringify({ t: 'shield', angle: me.shieldAngle || 0, ttl: Math.round(me.shieldUntil - now), hp: me.shieldHP || 0, max: SHIELD_HP }))
    } else if (sentShield) { net.send(JSON.stringify({ t: 'shield', ttl: 0 })); sentShield = false }

    if (ants.length) {
      sentAnts = true
      const my = catPos[0] || { x: 0, y: 0 }
      net.send(JSON.stringify({ t: 'ants', list: ants.map((a) => ({ id: a.id, x: Math.round(a.x - my.x), y: Math.round(a.y - my.y), hp: a.hp, dead: a.dead })) }))
    } else if (sentAnts) { net.send(JSON.stringify({ t: 'ants', list: [] })); sentAnts = false }
  }, 90)

  // ---------- widget placement + click-through management ----------
  // The window covers the whole screen. The cat "widget" (cat + desk + bottom bar)
  // sits at a draggable spot; everywhere else the window is click-through so it never
  // blocks your normal desktop use. Interactive only while the cursor is over the widget.
  const SCALE = 1.0
  const BAR_SPACE = 40 // room below the cell for the DOM #hud-bar
  const SIDE = 6
  const hudBar = document.getElementById('hud-bar')
  const cellPxW = CELL_W * SCALE
  const cellPxH = CELL_H * SCALE

  let wx = null, wy = null // widget top-left (of me's cell)
  let primaryRect = null   // primary monitor work area (canvas coords), from main
  if (inputSource.onLayout) inputSource.onLayout((l) => { primaryRect = l.primary; wx = null /* re-center */ })

  function clampWidget() {
    const W = canvas.clientWidth, H = canvas.clientHeight
    wx = Math.max(0, Math.min(wx, W - cellPxW))
    wy = Math.max(0, Math.min(wy, H - (cellPxH + BAR_SPACE)))
  }
  function initWidget() {
    // start bottom-center of the PRIMARY monitor (draggable to any monitor within the session)
    const pr = primaryRect || { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight }
    wx = Math.round(pr.x + (pr.w - cellPxW) / 2)
    wy = Math.round(pr.y + pr.h - (cellPxH + BAR_SPACE) - 12)
    clampWidget()
    sendHotzone()
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
    if (dragging) { dragging = null; sendHotzone() }
  })

  // ---------- render loop ----------
  function resize() {
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(canvas.clientWidth * dpr)
    canvas.height = Math.round(canvas.clientHeight * dpr)
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
    // keep the backing store in sync with the CSS box (robust against resize timing)
    const cw = Math.round(canvas.clientWidth * dpr), ch = Math.round(canvas.clientHeight * dpr)
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)

    if (wx == null) initWidget()

    const all = [me, ...peers.values()]
    allRef = all
    for (const p of all) tickBlink(p, now)

    // fixed-size widget anchored at (wx, wy); peers line up to the right of me
    const scale = SCALE
    view.scale = scale; view.offX = wx; view.offY = wy
    const BUB = window.AnimalArt.BUBBLE_H
    catPos = all.map((p, i) => ({
      x: wx + i * CELL_W * scale + CELL_W / 2 * scale,
      y: wy + (BUB + 100) * scale // ~ head/upper body
    }))

    // shield faces the cursor while active
    if (catPos[0]) me.shieldAngle = Math.atan2(cursor.y - catPos[0].y, cursor.x - catPos[0].x)

    all.forEach((p, i) => {
      ctx.save()
      ctx.translate(wx + i * CELL_W * scale, wy)
      ctx.scale(scale, scale)
      window.AnimalArt.draw(ctx, p.animal, p, now)
      ctx.restore()
    })

    drawShields(now)
    stepProjectiles(now)
    drawShieldShards(now)
    drawRemoteMissiles(now)
    drawTaskbarFX(now)
    stepAnts(now)
    drawRemoteAnts(now)
    positionHandles(now)
    positionHud()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  pushState()
})()
