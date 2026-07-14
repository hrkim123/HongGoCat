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
  const WEAPONS = { none: '없음', missile: '🚀 미사일', shield: '🛡 쉴드', ant: '🐜 개미', blackhole: '🕳 블랙홀', gatling: '🔫 게틀링건', human: '🕺 인간', adogen: '🔵 아도겐' }
  // 🔫 Gatling: deploy a turret at the cursor (fixed). Hold LEFT-CLICK to spray bullets toward
  // the cursor. Overheats after ~5s continuous fire (3s lock). HP 10 — enemy missiles/bullets/
  // ants damage it; at 0 it's destroyed (60s cooldown). Bullets collide with everything.
  const GAT_HP = 10, GAT_CD = 60000, GAT_DMG = 0.3   // bullet damage (missile = 1)
  const GAT_HEAT_MAX = 100, GAT_OVERHEAT = 3000      // ~2s continuous fire → 3s lock
  const GAT_HEAT_RATE = GAT_HEAT_MAX / 2000          // heat per ms while holding fire (time-based)
  const GAT_COOL_RATE = GAT_HEAT_MAX / 4000          // cool per ms once released
  const GAT_FIRE_MS = 80, GAT_BSPEED = 13            // bullets live until off-screen or a collision
  const GAT_SCALE = 3.8, GAT_HIT_R = 46              // turret ~4x bigger; incoming-hit radius
  const gbullets = []                 // my bullets { id, x, y, vx, vy, born }
  let gbulletId = 1
  const gatSmoke = []                 // overheat smoke puffs { x, y, vx, vy, r, born, life }
  const remoteGatlings = new Map()    // peerId -> { nx, ny, hp, ang }
  const remoteGBullets = new Map()    // peerId -> { items: Map, ts }
  let lmbDown = false                 // left mouse held (from main's global hook)
  // 🕳 Black hole: cast at the cursor, fixed for 10s, 60s cooldown. Pulls missiles/ants within
  // its radius toward the center (stronger nearer); reaching the core dust-particles them away.
  const BH_DUR = 10000, BH_CD = 60000
  const BH_R = 0.096    // radius as a fraction of screen width (80% of the old 0.12)
  const BH_CORE = 0.016 // core radius (fraction) — objects here get consumed
  const remoteBlackholes = new Map()  // peerId -> { nx, ny, until }
  const bhDust = []                   // consumption particles (spiral into center + fade)
  // achievement: kill 100 ants to unlock the black hole. antKills persists in localStorage.
  const ANT_KILL_GOAL = 100
  let antKills = parseInt(localStorage.getItem('antKills') || '0', 10) || 0
  let isHost = localStorage.getItem('host') === '1'   // set true by the SERVER (loopback client)
  const isDev = !!(window.bongo && window.bongo.isDev)   // developer PC only (env HONGGOCAT_DEV=1) → everything unlocked
  if (isDev) setTimeout(() => { try { showToast('🛠️ 개발자 모드 — 전체 해금') } catch {} }, 900)
  let bhNotified = localStorage.getItem('bhNotified') === '1'
  // achievement: hit ENEMY cats with missiles 500 times → reward 10,000 counts (once)
  const CAT_HIT_GOAL = 500, CAT_HIT_REWARD = 10000
  let catHits = parseInt(localStorage.getItem('catHits') || '0', 10) || 0
  let catHitRewarded = localStorage.getItem('catHitRewarded') === '1'
  // black hole usable if you're the host OR you've earned the achievement
  // ---------- shop / ownership ----------
  // Every weapon except the basic missile must be PURCHASED in the shop, spending the counter
  // (taps) as currency. One-time purchase → permanently owned (localStorage). Host owns all.
  const PRICES = { shield: 10000, gatling: 10000, blackhole: 10000, ant: 10000, human: 10000, adogen: 10000 }   // all unlocks 10k
  // per-summon cost: even after unlocking, these charge the counter EACH time you summon them
  const USE_COST = { gatling: 500, human: 500, blackhole: 1000 }
  const SHOP_ITEMS = ['shield', 'gatling', 'ant', 'human', 'blackhole']
  const SLOT_CHOICES = ['none', 'missile', 'shield', 'gatling', 'ant', 'human', 'blackhole']
  let owned = new Set()
  try { const a = JSON.parse(localStorage.getItem('owned') || '[]'); if (Array.isArray(a)) owned = new Set(a) } catch {}
  function isOwned(id) { return isHost || isDev || owned.has(id) }
  // hats are all LOCKED for now (to be sold in the shop / given as achievement rewards later).
  // ownedHats starts empty → only 'none' is available.
  let ownedHats = new Set()
  try { const a = JSON.parse(localStorage.getItem('ownedHats') || '[]'); if (Array.isArray(a)) ownedHats = new Set(a) } catch {}
  function isHatOwned(hat) { return hat === 'none' || isDev || ownedHats.has(hat) }
  function bhAvailable() { return isOwned('blackhole') }   // black hole is shop-only now (no achievement)
  // can this weapon actually be used right now? (missile is free; everything else must be owned)
  function weaponUsable(id) {
    if (id === 'none' || id === 'missile') return true
    return isOwned(id)
  }
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
  if (!isHatOwned(me.hat)) { me.hat = 'none'; localStorage.setItem('hat', 'none') }   // hats locked for now
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
  setInterval(() => { if (carveDirty) { try { localStorage.setItem('bardig', JSON.stringify((carve || []).map((v) => Math.round(v)))); localStorage.setItem('bardmg', String(barDamage)) } catch {} carveDirty = false } }, 1500)
  window.addEventListener('beforeunload', () => localStorage.setItem('taps', String(tapCount)))

  // ---------- shop popup (buy weapons with the counter as currency) ----------
  const shopEl = document.getElementById('shop')
  const shopBtn = document.getElementById('btn-shop')
  const shopListEl = document.getElementById('shop-list')
  const shopCoinEl = document.getElementById('shop-coin')
  let shopOpenFlag = false
  function renderShop() {
    if (shopCoinEl) shopCoinEl.textContent = tapCount.toLocaleString()
    if (!shopListEl) return
    shopListEl.innerHTML = ''
    for (const id of SHOP_ITEMS) {
      const own = (id === 'blackhole') ? bhAvailable() : isOwned(id)
      const row = document.createElement('div'); row.className = 'shop-row' + (own ? ' owned' : '')
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = WEAPONS[id] || id
      row.appendChild(nm)
      if (USE_COST[id]) { const u = document.createElement('span'); u.className = 'use'; u.textContent = `소환 🪙${USE_COST[id]}`; row.appendChild(u) }
      if (own) {
        const s = document.createElement('span'); s.className = 'shop-owned'; s.textContent = '보유중'; row.appendChild(s)
      } else {
        const price = PRICES[id] || 0
        const pr = document.createElement('span'); pr.className = 'pr'; pr.textContent = '🪙 ' + price.toLocaleString(); row.appendChild(pr)
        const b = document.createElement('button'); b.className = 'shop-buy'; b.textContent = '구매'
        b.disabled = tapCount < price; b.onclick = () => buyWeapon(id)
        row.appendChild(b)
      }
      shopListEl.appendChild(row)
    }
    const hl = document.getElementById('shop-human-list')   // 🔵 아도겐 (one-time unlock; used by an unarmed human)
    if (hl) {
      hl.innerHTML = ''
      const own = isOwned('adogen')
      const row = document.createElement('div'); row.className = 'shop-row' + (own ? ' owned' : '')
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = WEAPONS.adogen; row.appendChild(nm)
      if (own) { const s = document.createElement('span'); s.className = 'shop-owned'; s.textContent = '보유중'; row.appendChild(s) }
      else {
        const pr = document.createElement('span'); pr.className = 'pr'; pr.textContent = '🪙 ' + PRICES.adogen.toLocaleString(); row.appendChild(pr)
        const b = document.createElement('button'); b.className = 'shop-buy'; b.textContent = '구매'
        b.disabled = tapCount < PRICES.adogen; b.onclick = () => buyWeapon('adogen')
        row.appendChild(b)
      }
      hl.appendChild(row)
    }
    renderSlots()
  }
  // weapon-slot selectors live at the bottom of the shop; unowned weapons show 🔒 and are blocked
  function renderSlots() {
    for (let i = 0; i < 3; i++) {
      const sel = document.getElementById('shop-slot-' + i); if (!sel) continue
      const cur = me.slots[i] || 'none'
      sel.innerHTML = ''
      for (const id of SLOT_CHOICES) {
        const opt = document.createElement('option'); opt.value = id
        opt.textContent = (weaponUsable(id) ? '' : '🔒 ') + (WEAPONS[id] || id)
        sel.appendChild(opt)
      }
      sel.value = cur
      sel.onchange = () => {
        const v = sel.value
        if (!weaponUsable(v)) { showToast(`🔒 ${WEAPONS[v] || '이 무기'}은(는) 상점에서 구매해야 슬롯에 넣을 수 있어요`); sel.value = me.slots[i] || 'none'; return }
        me.slots[i] = v; localStorage.setItem('slots', JSON.stringify(me.slots)); pushState()
      }
    }
  }
  function buyWeapon(id) {
    if (isOwned(id) || (id === 'blackhole' && bhAvailable())) { renderShop(); return }
    const price = PRICES[id] || 0
    if (tapCount < price) { showToast(`🪙 재화가 부족해요 — ${price.toLocaleString()} 필요`); return }
    tapCount -= price; counterDirty = true; renderCounter()
    owned.add(id); try { localStorage.setItem('owned', JSON.stringify([...owned])) } catch {}
    showToast(`✅ ${WEAPONS[id]} 구매 완료!`); renderShop()
  }
  // spend counter as currency for a per-summon cost; returns false (and does nothing) if too poor
  function spendCoins(n) {
    if (!n || isDev) return true   // dev PC: summons are free
    if (tapCount < n) return false
    tapCount -= n; counterDirty = true; renderCounter()
    return true
  }
  let shopPos = null   // manual position from dragging the shop header (null = auto-anchor to widget)
  function positionShop() {
    if (wx == null || !shopBtn) return
    shopBtn.classList.remove('hidden')
    shopBtn.style.left = (wx + cellPxW - 30) + 'px'
    shopBtn.style.top = (wy + 2) + 'px'
    if (!shopOpenFlag) return
    const W = canvas.clientWidth, H = canvas.clientHeight, pw = 340, ph = Math.min(shopEl.offsetHeight || 400, H - 12)
    let px, py
    if (shopPos) { px = shopPos.x; py = shopPos.y }   // user-dragged
    else { px = wx + cellPxW / 2 - pw / 2; py = wy - ph - 6; if (py < 6) py = wy + 40 }
    px = Math.max(6, Math.min(px, W - pw - 6)); py = Math.max(6, Math.min(py, H - ph - 6))
    shopEl.style.left = px + 'px'; shopEl.style.top = py + 'px'
  }
  function openShop() { shopOpenFlag = true; renderShop(); shopEl.classList.remove('hidden'); positionShop(); sendHotzone() }
  function closeShop() { shopOpenFlag = false; shopEl.classList.add('hidden'); sendHotzone() }
  function toggleShop() { if (shopOpenFlag) closeShop(); else openShop() }
  if (shopBtn) shopBtn.onclick = toggleShop
  const shopCloseBtn = document.getElementById('shop-close'); if (shopCloseBtn) shopCloseBtn.onclick = closeShop
  // drag the shop by its header (overlay is interactive while the shop is open)
  const shopHead = document.getElementById('shop-head')
  let shopDrag = null
  if (shopHead) shopHead.addEventListener('mousedown', (e) => {
    if (e.target.id === 'shop-close') return
    const r = shopEl.getBoundingClientRect(); shopDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.preventDefault()
  })
  window.addEventListener('mousemove', (e) => { if (shopDrag) { shopPos = { x: e.clientX - shopDrag.dx, y: e.clientY - shopDrag.dy }; positionShop() } })
  window.addEventListener('mouseup', () => { shopDrag = null })

  // ---------- 🖌️ HOST platform tool: brush strokes that become floor (HP 10) ----------
  const PLAT_HP = 10
  const platforms = []                 // { pts:[{x,y}], hp }
  let platformMode = false, curStroke = null
  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2; t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
  }
  function hitPlatform(x, y) {
    const th = 6 * view.scale
    for (const pl of platforms) { const p = pl.pts; for (let i = 1; i < p.length; i++) if (distToSeg(x, y, p[i - 1], p[i]) < th) return pl }
    return null
  }
  function damagePlatform(pl, dmg) { pl.hp -= dmg; if (pl.hp <= 0) { const i = platforms.indexOf(pl); if (i >= 0) platforms.splice(i, 1) } }
  // y of a platform surface directly under x that an entity descending (prevY→feetY) lands on
  function platformFloorAt(x, feetY, prevY) {
    for (const pl of platforms) {
      const p = pl.pts
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i]
        if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue
        const tt = (b.x - a.x) ? (x - a.x) / (b.x - a.x) : 0
        const segY = a.y + (b.y - a.y) * tt
        if (prevY <= segY + 2 && feetY >= segY) return segY
      }
    }
    return null
  }
  function drawPlatforms() {
    const strokes = curStroke ? platforms.concat([curStroke]) : platforms
    for (const pl of strokes) {
      const p = pl.pts; if (!p.length) continue
      const hp01 = Math.max(0, pl.hp) / PLAT_HP
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.strokeStyle = hp01 > 0.5 ? '#8ad6ff' : (hp01 > 0.2 ? '#ffd36b' : '#ff6b6b')
      ctx.lineWidth = 6 * view.scale
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y)
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5 * view.scale; ctx.stroke()
      ctx.restore()
    }
  }
  function platformAllowed() { return !connected() || isHost }   // offline: anyone · online: host only
  function togglePlatformMode() {
    if (!platformAllowed()) { showToast('🖌️ 접속 중엔 서버 호스트만 그릴 수 있어요'); return }
    platformMode = !platformMode; curStroke = null
    showToast(platformMode ? '🖌️ 플랫폼 그리기 ON — 왼쪽 클릭 드래그로 그리기' : '플랫폼 그리기 OFF')
    sendHotzone()
  }

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
      if (msg.t === 'joined') {
        me.netId = msg.id; roomMax = msg.max || 12; setStatus(`방 ${msg.room} 접속됨`)
        // the SERVER decides host (loopback client) — persist it so all weapons stay unlocked
        if (msg.host && !isHost) { isHost = true; localStorage.setItem('host', '1'); pushState() }
      }
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
        // drop any remote entities belonging to peers who left (no lingering state)
        for (const m of [remoteMissiles, remoteShields, remoteAnts, remoteBlackholes, remoteGatlings, remoteGBullets])
          for (const id of [...m.keys()]) if (!seen.has(id)) m.delete(id)
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
      else if (msg.t === 'blackhole') {
        if (msg.ttl > 0) remoteBlackholes.set(msg.id, { nx: msg.nx, ny: msg.ny, until: performance.now() + msg.ttl })
        else remoteBlackholes.delete(msg.id)
      }
      else if (msg.t === 'dig') { carveTaskbar((msg.nx || 0) * canvas.clientWidth, msg.power || 1, false) }  // shared taskbar damage
      else if (msg.t === 'digreset') { resetTaskbarDig(false) }   // someone restored → everyone restores
      else if (msg.t === 'gatling') {
        if (msg.active) remoteGatlings.set(msg.id, { nx: msg.nx, ny: msg.ny, hp: msg.hp, ang: msg.ang })
        else remoteGatlings.delete(msg.id)
      }
      else if (msg.t === 'gbullets') { mergeRemote(remoteGBullets, msg.id, msg.list, 'nx', 'ny') }
      else if (msg.t === 'gat-hit') { if (msg.target === me.netId) damageMyGatling(msg.dmg || 1) }
      else if (msg.t === 'error' && msg.reason === 'room_full') { setStatus('방이 가득 찼어요'); ws.close() }
    }
    ws.onclose = () => { if (net === ws) { net = null; peers.clear(); remoteAnts.clear(); remoteBlackholes.clear(); remoteGatlings.clear(); remoteGBullets.clear(); me.netId = undefined; roomCount = 0; setStatus('오프라인 — 혼자 연주 중') } }
    ws.onerror = () => setStatus('접속 실패')
  }
  function disconnect() {
    if (net) { const ws = net; net = null; ws.close() }
    peers.clear(); remoteMissiles.clear(); remoteShields.clear(); remoteAnts.clear(); remoteBlackholes.clear(); remoteGatlings.clear(); remoteGBullets.clear(); me.netId = undefined; roomCount = 0
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
      count: connected() ? roomCount : 0, max: roomMax,
      antKills, antGoal: ANT_KILL_GOAL, isHost, bhAvailable: bhAvailable(),
      catHits, catHitGoal: CAT_HIT_GOAL, catHitReward: CAT_HIT_REWARD, catHitRewarded,
      ownedHats: [...ownedHats]
    })
  }

  inputSource.onCommand((msg) => {
    if (!msg) return
    if (msg.t === 'request-state') pushState()
    else if (msg.t === 'profile') {
      if (typeof msg.name === 'string') { me.name = msg.name.trim() || '나'; localStorage.setItem('name', me.name) }
      if (msg.skin) { me.skin = msg.skin; me.tint = msg.skin; localStorage.setItem('skin', me.skin) }
      if (msg.pattern) { me.pattern = msg.pattern; localStorage.setItem('pattern', me.pattern) }
      if (msg.hat) { me.hat = isHatOwned(msg.hat) ? msg.hat : 'none'; localStorage.setItem('hat', me.hat) }   // reject locked hats
      sendUpdate(); pushState()
    }
    else if (msg.t === 'connect') { connect(msg.url, msg.room) }
    else if (msg.t === 'disconnect') { disconnect(); setStatus('오프라인 — 혼자 연주 중') }
    else if (msg.t === 'edit') { setEditing(!!msg.on) }
    else if (msg.t === 'chat') { openChat() }
    else if (msg.t === 'boost') { if (platformMode) { /* drawing */ } else if (me.humanActive) humanAttack(); else boostMissiles() }
    else if (msg.t === 'lmb') {
      const was = lmbDown; lmbDown = !!msg.down
      if (platformMode) {   // drawing a platform stroke while the button is held
        if (lmbDown && !was) curStroke = { pts: [{ x: cursor.x, y: cursor.y }], hp: PLAT_HP }
        else if (!lmbDown && was && curStroke) { if (curStroke.pts.length >= 2) { platforms.push(curStroke); if (platforms.length > 40) platforms.shift() } curStroke = null }
      } else if (was && !lmbDown && me.humanActive) humanRelease()   // sword: release → swing or fire 검기
    }
    else if (msg.t === 'platform-mode') { togglePlatformMode() }
    else if (msg.t === 'human-key') { if (msg.down) humanKeys.add(msg.key); else humanKeys.delete(msg.key) }
    else if (msg.t === 'fire-missile') { fireWeapon('missile') }
    else if (msg.t === 'fire-slot') { fireWeapon(me.slots[(msg.slot || 1) - 1] || 'none') }
    else if (msg.t === 'slots') {
      if (Array.isArray(msg.slots)) { me.slots = msg.slots.slice(0, 3); while (me.slots.length < 3) me.slots.push('none'); localStorage.setItem('slots', JSON.stringify(me.slots)); pushState() }
    }
    else if (msg.t === 'update-ready') { showUpdateToast(msg.version) }
    else if (msg.t === 'achv-add') { for (let k = 0; k < (msg.n || 10); k++) addAntKill() }
    else if (msg.t === 'achv-reset') { antKills = 0; bhNotified = false; localStorage.setItem('antKills', '0'); localStorage.removeItem('bhNotified'); pushState() }
    else if (msg.t === 'reset-taskbar') { resetTaskbarDig() }
    else if (msg.t === 'quit') { inputSource.quit() }
  })

  // "new version ready" toast (shown when an update downloads while the app is running)
  const updateToast = document.getElementById('update-toast')
  let updateToastTimer = null
  function showToast(text, ms) {
    if (!updateToast) return
    updateToast.textContent = text
    updateToast.classList.remove('hidden')
    clearTimeout(updateToastTimer)
    updateToastTimer = setTimeout(() => updateToast.classList.add('hidden'), ms || 30000)
  }
  function showUpdateToast(version) {
    showToast(`🎉 새 버전${version ? ' v' + version : ''} 준비됨 · 앱 재시작 시 적용`)
  }

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
  const SMOOTH = 0.4               // per-frame lerp toward the latest received position

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
    if (!weaponUsable(id)) { showToast(`🛒 ${WEAPONS[id] || '이 무기'}은(는) 상점에서 먼저 구매하세요`); return }
    if (id === 'missile') fireHoming()
    else if (id === 'shield') activateShield()
    else if (id === 'ant') summonAnt()
    else if (id === 'blackhole') activateBlackhole()
    else if (id === 'gatling') deployGatling()
    else if (id === 'human') deployHuman()
    // future: else if (id === 'rock') fireRock() ...
  }

  // ---------- 🕺 controllable human (WASD) — LOCAL ONLY, never broadcast (others can't see it) ----------
  // WASD move + W jump, E = raise a shield (blocks front hits), left-click = punch (dmg 1).
  const HUMAN_SPEED = 3.4, HUMAN_JUMP = 12, HUMAN_GRAV = 0.62, HUMAN_HP = 5, HUMAN_SCALE = 1.8
  const humanKeys = new Set()
  function deployHuman() {
    if (me.humanActive) { removeHuman(); return }   // fire again → dismiss (no charge)
    if (!spendCoins(USE_COST.human)) { showToast(`🪙 인간 소환 비용 ${USE_COST.human} 부족`); return }
    if (me.gatActive) me.gatActive = false          // gatling + human are mutually exclusive
    me.humanActive = true
    me.humanX = cursor.x; me.humanY = antGroundY(cursor.x) - 1
    me.humanVX = 0; me.humanVY = 0; me.humanFace = 1; me.humanGround = true
    me.humanHp = HUMAN_HP; me.humanHitCd = 0; me.humanWeapon = null; me.humanAtkCd = 0; me.charging = false; me.charge = 0
    humanKeys.clear()
    if (inputSource.humanControl) inputSource.humanControl(true)   // ask main to forward WASD
  }
  function removeHuman() {
    me.humanActive = false; humanKeys.clear()
    if (inputSource.humanControl) inputSource.humanControl(false)
  }
  function humanTakeDmg(dmg, now) {
    if (!me.humanActive) return
    const hs = view.scale * HUMAN_SCALE
    me.humanHp = (me.humanHp || 0) - dmg; me.humanHitCd = now + 250
    spawnBlood(me.humanX, me.humanY - 15 * hs, 4)
    if (me.humanHp <= 0) { addEffect(me.humanX, me.humanY - 12 * hs, 1); spawnBlood(me.humanX, me.humanY - 15 * hs, 12); removeHuman() }
  }
  // left-click punch: short melee in the facing direction; kills ants (dmg 1)
  function humanPunch() {
    if (!me.humanActive) return
    const now = performance.now()
    if (now < (me.humanPunchCd || 0)) return
    me.humanPunchCd = now + 320; me.humanPunchUntil = now + 150
    const hs = view.scale * HUMAN_SCALE
    const px = me.humanX + me.humanFace * 18 * hs, py = me.humanY - 18 * hs, r = 16 * hs
    for (const a of ants) if (!a.dead && Math.hypot(px - a.x, py - a.y) < r) { antTakeDmg(a, 1); if (a.dead) addAntKill() }
    for (const [pid, rec] of remoteAnts) for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp && Math.hypot(px - sp.x, py - sp.y) < r && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: a.id, dmg: 1 })) }
    spawnSpark(px, py)
  }

  // ---------- 🕺 human weapons (pick up from the ground; sword/pistol/rifle/bazooka) ----------
  const HUMAN_WEAPONS = {
    sword:   { name: '🗡️ 칼', price: 5000, emoji: '🗡️', melee: true, range: 24, dmg: 2, cd: 320 },
    pistol:  { name: '🔫 권총', price: 10000, emoji: '🔫', speed: 13, dmg: 1, cd: 340, life: 900 },
    rifle:   { name: '🎯 라이플', price: 30000, emoji: '🎯', speed: 19, dmg: 2, cd: 150, life: 1100 },
    bazooka: { name: '🚀 바주카', price: 50000, emoji: '🚀', power: 3, cd: 800 }
  }
  const HUMAN_WEAPON_ITEMS = ['sword', 'pistol', 'rifle', 'bazooka']
  const GW_LIFE = 30000, GW_BLINK = 3000, GW_MAX = 3
  const groundWeapons = []            // { kind, x, y, vy, onGround, born }
  const hbullets = []                 // pistol/rifle bullets { x,y,vx,vy,born,life,dmg,big }
  let gwSpawnAt = 0
  function spawnGroundWeapon(kind, atCursor) {
    const W = canvas.clientWidth
    const gx = atCursor ? cursor.x : 40 + Math.random() * (W - 80)
    // fall from just ABOVE the taskbar (not the whole sky); shop drops still come from the cursor
    const gy = atCursor ? cursor.y : antGroundY(gx) - 130 * view.scale
    groundWeapons.push({ kind, x: gx, y: gy, vy: 0, onGround: false, born: performance.now() })
  }
  function summonHumanWeapon(id) {   // shop: spend, then drop it at the cursor to be picked up
    const w = HUMAN_WEAPONS[id]; if (!w) return
    if (!spendCoins(w.price)) { showToast(`🪙 재화 부족 — ${w.price.toLocaleString()} 필요`); return }
    spawnGroundWeapon(id, true); showToast(`${w.name} 소환! 🕺 인간으로 주우세요`); renderShop()
  }
  function humanTryPickup() {
    if (!me.humanActive) return false
    const r = 44 * view.scale
    for (let i = 0; i < groundWeapons.length; i++) {
      const g = groundWeapons[i]
      if (Math.hypot(me.humanX - g.x, me.humanY - g.y) < r) { me.humanWeapon = g.kind; groundWeapons.splice(i, 1); showToast(`${HUMAN_WEAPONS[g.kind].name} 획득!`); return true }
    }
    return false
  }
  function stepGroundWeapons(now) {
    if (me.humanActive && now > gwSpawnAt && groundWeapons.length < GW_MAX) {   // random spawns only while a human exists
      gwSpawnAt = now + 15000 + Math.random() * 20000
      spawnGroundWeapon(HUMAN_WEAPON_ITEMS[Math.floor(Math.random() * HUMAN_WEAPON_ITEMS.length)], false)
    } else if (!me.humanActive) gwSpawnAt = now + 8000   // hold off the timer until a human is summoned
    const s = view.scale
    for (let i = groundWeapons.length - 1; i >= 0; i--) {
      const g = groundWeapons[i], age = now - g.born
      if (age >= GW_LIFE) { groundWeapons.splice(i, 1); continue }
      if (!g.onGround) { g.vy += 0.5; g.y += g.vy; const gy = antGroundY(g.x); if (g.y >= gy) { g.y = gy; g.vy = 0; g.onGround = true } }
      if ((GW_LIFE - age) < GW_BLINK && Math.floor(now / 140) % 2 === 0) continue   // blink out near the end
      ctx.save()
      ctx.fillStyle = 'rgba(255,220,120,0.25)'; ctx.beginPath(); ctx.ellipse(g.x, g.y + 1 * s, 16 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill()   // faint glow (reverted)
      ctx.translate(g.x, g.y - 9 * s); ctx.rotate(-0.35)                                                                                       // laid at a slight angle
      const L = (g.kind === 'rifle' || g.kind === 'bazooka') ? 20 * s : (g.kind === 'sword' ? 16 * s : 11 * s)   // ~70% of the held size
      ctx.translate(-L * 0.4, 0); drawWeapon(g.kind, L)
      ctx.restore()
    }
  }
  const SWORD_CHARGE_MS = 700   // hold this long → release a sword-wave (검기)
  const SWING_MS = 140, SLASH_MIN = 0.35   // fast swing; min charge to release a 검기
  function humanAttack() {   // left-click DOWN
    if (!me.humanActive) return
    if (humanTryPickup()) return                 // near a ground weapon → pick it up
    const now = performance.now(), wk = me.humanWeapon
    if (wk === 'sword') { me.charging = true; me.chargeKind = 'sword'; me.chargeStart = now; me.charge = 0; return }  // hold to charge
    if (!wk && isOwned('adogen')) { me.charging = true; me.chargeKind = 'adogen'; me.chargeStart = now; me.charge = 0; return }  // 아도겐 기 모으기
    if (wk === 'rifle') return                    // full-auto handled in stepHuman while held
    if (!wk) { humanPunch(); return }             // bare fists
    if (now < (me.humanAtkCd || 0)) return
    const w = HUMAN_WEAPONS[wk]
    me.humanAtkCd = now + w.cd; me.humanPunchUntil = now + 150
    if (wk === 'bazooka') fireBazooka(w, now)
    else fireHumanBullet(w, now)
  }
  function humanRelease() {   // left-click UP — release a charged sword-wave / 아도겐, or a quick swing/punch
    if (!me.humanActive || !me.charging) return
    me.charging = false
    const now = performance.now(), kind = me.chargeKind, ch = me.charge
    if (kind === 'sword') {
      me.swingUntil = now + SWING_MS; me.humanAtkCd = now + 260
      if (ch >= SLASH_MIN) fireSlash(now, ch); else humanMelee(HUMAN_WEAPONS.sword, now)
    } else if (kind === 'adogen') {
      me.humanAtkCd = now + 260
      if (ch >= SLASH_MIN) fireAdogen(now, ch); else humanPunch()
    }
    me.charge = 0
  }
  function fireAdogen(now, charge) {   // 아도겐: ki blast — size/HP/damage scale with charge (max 5); big ground dig
    const hs = view.scale * HUMAN_SCALE, oy = me.humanY - 18 * hs
    const ang = Math.atan2(cursor.y - oy, cursor.x - me.humanX); me.humanFace = Math.cos(ang) >= 0 ? 1 : -1
    const hp = Math.max(1, Math.round(charge * 5))              // 1..5
    hbullets.push({ x: me.humanX + Math.cos(ang) * 26 * hs, y: oy + Math.sin(ang) * 26 * hs, vx: Math.cos(ang) * 9, vy: Math.sin(ang) * 9, born: now, life: 1800, dmg: hp, adogen: true, hp, waveR: (10 + charge * 26) * view.scale, ang })
  }
  function fireSlash(now, charge) {   // 검기: crescent wave — size/damage/HP scale with charge (max hp=dmg=3)
    const hs = view.scale * HUMAN_SCALE, oy = me.humanY - 18 * hs
    const ang = Math.atan2(cursor.y - oy, cursor.x - me.humanX); me.humanFace = Math.cos(ang) >= 0 ? 1 : -1
    const hp = Math.max(1, Math.round(charge * 3))              // 1..3
    hbullets.push({ x: me.humanX + Math.cos(ang) * 22 * hs, y: oy + Math.sin(ang) * 22 * hs, vx: Math.cos(ang) * 11, vy: Math.sin(ang) * 11, born: now, life: 1500, dmg: hp, wave: true, hp, waveR: (12 + charge * 20) * view.scale, ang })
  }
  function humanMelee(w, now) {                   // sword: wider/stronger than a punch
    const hs = view.scale * HUMAN_SCALE
    const px = me.humanX + me.humanFace * w.range * hs, py = me.humanY - 18 * hs, r = w.range * 0.8 * hs
    for (const a of ants) if (!a.dead && Math.hypot(px - a.x, py - a.y) < r) { antTakeDmg(a, w.dmg); if (a.dead) addAntKill() }
    for (const [pid, rec] of remoteAnts) for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp && Math.hypot(px - sp.x, py - sp.y) < r && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: a.id, dmg: w.dmg })) }
    for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci]; if (!cat) continue; const c = catPos[ci]; if (Math.hypot(px - c.x, py - c.y) < 56 * view.scale) { cat.hitUntil = now + 700; if (cat.id !== 'me' && connected()) net.send(JSON.stringify({ t: 'hit', target: cat.id, power: w.dmg })) } }
    spawnSpark(px, py)
  }
  function fireHumanBullet(w, now) {              // pistol / rifle → straight bullet toward the cursor
    const hs = view.scale * HUMAN_SCALE, oy = me.humanY - 18 * hs
    const ang = Math.atan2(cursor.y - oy, cursor.x - me.humanX); me.humanFace = Math.cos(ang) >= 0 ? 1 : -1
    hbullets.push({ x: me.humanX + Math.cos(ang) * 16 * hs, y: oy + Math.sin(ang) * 16 * hs, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed, born: now, life: w.life, dmg: w.dmg, big: w.dmg >= 2 })
  }
  function fireBazooka(w, now) {                  // bazooka → non-homing missile at boost speed (reuses missile system)
    const hs = view.scale * HUMAN_SCALE, oy = me.humanY - 18 * hs
    const ang = Math.atan2(cursor.y - oy, cursor.x - me.humanX); me.humanFace = Math.cos(ang) >= 0 ? 1 : -1
    const spd = MISSILE_SPEED * BOOST_MULT
    projectiles.push({ homing: true, boost: true, power: w.power, mid: nextMid++, x: me.humanX + Math.cos(ang) * 18 * hs, y: oy + Math.sin(ang) * 18 * hs, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, born: now, life: MISSILE_LIFE })
  }
  function stepHbullets(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight, s = view.scale
    if (hbullets.length > 120) hbullets.splice(0, hbullets.length - 120)   // cap
    for (let i = hbullets.length - 1; i >= 0; i--) {
      const p = hbullets[i]
      if (now - p.born > p.life) { hbullets.splice(i, 1); continue }
      const bh = blackholePull(p, now); if (bh) { spawnDustToHole(p.x, p.y, bh); hbullets.splice(i, 1); continue }
      p.x += p.vx; p.y += p.vy
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { hbullets.splice(i, 1); continue }
      if (inTaskbar(p.x, p.y)) { carveTaskbar(p.x, p.adogen ? p.hp * 0.8 : 0.1); spawnSpark(p.x, p.y); hbullets.splice(i, 1); continue }   // 아도겐: dig scales with size
      const energy = p.wave || p.adogen, waveR = p.waveR || 16 * s
      // energy blasts (검기/아도겐) lose 1 HP per blocking collision (missile/bullet/platform), throttled
      const deplete = () => { if (now < (p.hitCd || 0)) return false; p.hitCd = now + 130; addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); return (--p.hp) <= 0 }
      const pl = hitPlatform(p.x, p.y)
      if (pl) { damagePlatform(pl, p.dmg); if (!energy) { spawnSpark(p.x, p.y); hbullets.splice(i, 1); continue } else if (deplete()) { hbullets.splice(i, 1); continue } }
      const antR = energy ? waveR : 12 * s   // energy sweeps wider + pierces
      let hit = false
      for (const a of ants) if (!a.dead && Math.hypot(p.x - a.x, p.y - a.y) < antR) { antTakeDmg(a, p.dmg); if (a.dead) addAntKill(); hit = true; if (!energy) break }
      if (!hit || energy) { const ah = missileHitsAnt(p.x, p.y); if (ah && !ah.local) { if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: p.dmg })); hit = true } }
      // generous full-body cat hitbox (tall ellipse) so shots from the low human don't slip past the sprite
      const chw = (energy ? waveR + 26 * s : 52 * s), chh = (energy ? waveR + 56 * s : 90 * s)
      for (let ci = 0; ci < catPos.length; ci++) {
        const cat = allRef[ci]; if (!cat) continue; const c = catPos[ci]
        const dx = p.x - c.x, dy = p.y - c.y
        if ((dx * dx) / (chw * chw) + (dy * dy) / (chh * chh) <= 1) {
          if (!catShieldCovers(cat, c, p.x, p.y, now)) { cat.hitUntil = now + 700; if (cat.id !== 'me' && connected()) net.send(JSON.stringify({ t: 'hit', target: cat.id, power: p.dmg })) }
          if (energy && now >= (p.catBurst || 0)) { p.catBurst = now + 120; addEffect(p.x, p.y, 1) }   // burst even while piercing
          hit = true; if (!energy) break
        }
      }
      if (energy) {   // enemy missiles/bullets collide with the blast → they pop, blast loses HP
        if (hitRemoteMissile(p.x, p.y, p.dmg) || hitRemoteGBullet(p.x, p.y)) { if (deplete()) { hbullets.splice(i, 1); continue } }
      }
      if (hit && !energy) { addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); hbullets.splice(i, 1); continue }   // explode like a missile on contact
      ctx.save(); ctx.lineCap = 'round'
      if (p.adogen) {   // 아도겐 — glowing ki ball
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, waveR)
        grd.addColorStop(0, 'rgba(235,250,255,0.95)'); grd.addColorStop(0.5, 'rgba(120,200,255,0.8)'); grd.addColorStop(1, 'rgba(80,160,255,0)')
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, waveR, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#eaf8ff'; ctx.beginPath(); ctx.arc(p.x, p.y, waveR * 0.4, 0, Math.PI * 2); ctx.fill()
      } else if (p.wave) {   // 검기 — crescent perpendicular to travel
        ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx))
        ctx.strokeStyle = 'rgba(150,210,255,0.9)'; ctx.lineWidth = (3 + p.hp) * s; ctx.beginPath(); ctx.arc(0, 0, waveR, -1.15, 1.15); ctx.stroke()
        ctx.strokeStyle = 'rgba(235,248,255,0.8)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(-3 * s, 0, waveR, -1.05, 1.05); ctx.stroke()
      } else {
        ctx.strokeStyle = 'rgba(255,210,90,0.9)'; ctx.lineWidth = (p.big ? 3.5 : 2.5) * s
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 1.1, p.y - p.vy * 1.1); ctx.stroke()
        ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(p.x, p.y, (p.big ? 3 : 2.2) * s, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }
  }
  function stepHuman(now) {
    if (!me.humanActive) return
    const s = view.scale, hs = view.scale * HUMAN_SCALE, W = canvas.clientWidth
    // black hole pull (faster) — but the human can STILL move (WASD) to fight it, like a missile/bullet
    let bhPull = null
    for (const b of activeBlackholes(now)) {
      const dx = b.x - me.humanX, dy = b.y - me.humanY, d = Math.hypot(dx, dy) || 0.001
      if (d > b.r) continue
      if (d < BH_CORE * W + 6 * s) { spawnDustToHole(me.humanX, me.humanY, b); removeHuman(); return }
      const t = 1 - d / b.r, sp = (1.4 + t * t * 9) * s   // stronger/faster suction
      bhPull = { x: (dx / d) * sp, y: (dy / d) * sp }; break
    }
    let moving = false
    if (humanKeys.has('a')) { me.humanX -= HUMAN_SPEED * hs; me.humanFace = -1; moving = true }
    if (humanKeys.has('d')) { me.humanX += HUMAN_SPEED * hs; me.humanFace = 1; moving = true }
    const floor = antGroundY(me.humanX) - 1
    if (bhPull) {                                       // sucked in: pull + your input combine; no gravity/floor
      if (humanKeys.has('w')) me.humanY -= HUMAN_SPEED * hs
      if (humanKeys.has('s')) me.humanY += HUMAN_SPEED * hs
      me.humanX += bhPull.x; me.humanY += bhPull.y; me.humanGround = false; me.humanVY = 0
    } else {
      if (humanKeys.has('w') && me.humanGround) { me.humanVY = -HUMAN_JUMP * hs; me.humanGround = false }
      const prevY = me.humanY
      me.humanGround = false
      me.humanVY += HUMAN_GRAV * hs; me.humanY += me.humanVY
      if (humanKeys.has('s')) me.humanY += 5 * hs                           // fast-fall
      if (me.humanVY >= 0) { const segY = platformFloorAt(me.humanX, me.humanY, prevY); if (segY != null) { me.humanY = segY; me.humanVY = 0; me.humanGround = true } }
      if (me.humanY >= floor) { me.humanY = floor; me.humanVY = 0; me.humanGround = true }
    }
    me.humanX = Math.max(12 * hs, Math.min(W - 12 * hs, me.humanX))
    if (humanKeys.has('e')) me.humanFace = cursor.x >= me.humanX ? 1 : -1   // face the cursor while guarding
    // collide with ENEMY weapons (human is local, so only remote threats reach it). 250ms i-frames.
    if (now >= (me.humanHitCd || 0)) {
      const cx = me.humanX, cy = me.humanY - 15 * hs, r = 20 * hs
      let tx = null, ty = null
      const rm = hitRemoteMissile(cx, cy, 1); if (rm) { tx = rm.x; ty = rm.y }
      if (tx == null) {   // remote gatling bullets (position so the barrier can face them)
        for (const [, rec] of remoteGBullets) {
          if (now - rec.ts > 400) continue
          for (const it of rec.items.values()) { const bx = it.sx * W, by = it.sy * canvas.clientHeight; if (Math.hypot(cx - bx, cy - by) < 12 * hs) { tx = bx; ty = by; break } }
          if (tx != null) break
        }
      }
      if (tx == null) {   // remote ants
        for (const [pid, rec] of remoteAnts) {
          for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp && Math.hypot(cx - sp.x, cy - sp.y) < r) { tx = sp.x; ty = sp.y; break } }
          if (tx != null) break
        }
      }
      if (tx != null) {
        // barrier (cursor-facing, above the human) blocks threats coming from within its arc
        const scx = me.humanX, scy = me.humanY - 34 * hs * 0.7
        const shieldAng = Math.atan2(cursor.y - scy, cursor.x - scx)
        const blocked = humanKeys.has('e') && angDiff(Math.atan2(ty - scy, tx - scx), shieldAng) <= SHIELD_SPAN / 2
        if (blocked) { spawnSpark(scx + Math.cos(shieldAng) * 30 * hs, scy + Math.sin(shieldAng) * 30 * hs); me.humanHitCd = now + 150 }
        else { humanTakeDmg(1, now); if (!me.humanActive) return }
      }
    }
    if (me.charging) {   // build sword/아도겐 charge while holding; face the cursor
      me.humanFace = cursor.x >= me.humanX ? 1 : -1
      if (lmbDown) me.charge = Math.min(1, (now - me.chargeStart) / SWORD_CHARGE_MS)
      else { me.charging = false; me.charge = 0 }
    }
    if (me.humanWeapon === 'rifle' && lmbDown && !platformMode && now >= (me.humanAtkCd || 0)) {   // full-auto
      me.humanAtkCd = now + HUMAN_WEAPONS.rifle.cd; me.humanPunchUntil = now + 100; fireHumanBullet(HUMAN_WEAPONS.rifle, now)
    }
    drawHuman(now, moving && me.humanGround)
  }
  // human body color follows the cat's fur skin (Stick-Fight-style flat single color)
  const SKIN_BODY = { default: '#e9e9f0', cream: '#ecd6a8', gray: '#aab0bd', brown: '#a06a3a', black: '#3a3a46', orange: '#e79a3c', pink: '#f0abc6', mint: '#9fe3cb', lavender: '#c7b3ef' }
  function humanColor() { return SKIN_BODY[me.skin] || SKIN_BODY.default }
  // draw a weapon pointing +x from the grip origin (y=0 centerline); L = length in px
  function drawWeapon(kind, L) {
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    if (kind === 'sword') {
      ctx.strokeStyle = '#7a4a24'; ctx.lineWidth = L * 0.13; ctx.beginPath(); ctx.moveTo(-L * 0.14, 0); ctx.lineTo(L * 0.04, 0); ctx.stroke()
      ctx.strokeStyle = '#d9b25a'; ctx.lineWidth = L * 0.05; ctx.beginPath(); ctx.moveTo(L * 0.05, -L * 0.11); ctx.lineTo(L * 0.05, L * 0.11); ctx.stroke()
      ctx.fillStyle = '#e3e9f0'; ctx.strokeStyle = '#9aa6b4'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(L * 0.07, -L * 0.05); ctx.lineTo(L * 0.9, -L * 0.03); ctx.lineTo(L, 0); ctx.lineTo(L * 0.9, L * 0.03); ctx.lineTo(L * 0.07, L * 0.05); ctx.closePath(); ctx.fill(); ctx.stroke()
    } else if (kind === 'pistol') {
      ctx.fillStyle = '#3a3e4a'; ctx.beginPath(); ctx.roundRect(-L * 0.1, -L * 0.16, L * 0.85, L * 0.3, L * 0.06); ctx.fill()
      ctx.beginPath(); ctx.roundRect(0, L * 0.05, L * 0.28, L * 0.5, L * 0.05); ctx.fill()
      ctx.fillStyle = '#20242c'; ctx.fillRect(L * 0.6, -L * 0.09, L * 0.22, L * 0.12)
    } else if (kind === 'rifle') {   // AK-ish silhouette
      ctx.fillStyle = '#5a3d22'; ctx.beginPath(); ctx.roundRect(-L * 0.28, -L * 0.05, L * 0.26, L * 0.16, L * 0.03); ctx.fill()   // wood stock
      ctx.fillStyle = '#43474f'; ctx.beginPath(); ctx.roundRect(-L * 0.06, -L * 0.09, L * 0.72, L * 0.18, L * 0.03); ctx.fill() // receiver
      ctx.fillStyle = '#2b2f36'; ctx.fillRect(L * 0.62, -L * 0.04, L * 0.4, L * 0.08)                                           // barrel
      ctx.fillStyle = '#2b2f36'; ctx.fillRect(L * 0.34, -L * 0.15, L * 0.06, L * 0.08)                                          // front sight
      ctx.save(); ctx.translate(L * 0.24, L * 0.09); ctx.rotate(0.35); ctx.fillStyle = '#3a3e48'; ctx.beginPath(); ctx.roundRect(-L * 0.06, 0, L * 0.13, L * 0.34, L * 0.03); ctx.fill(); ctx.restore() // curved mag
      ctx.save(); ctx.translate(L * 0.08, L * 0.09); ctx.rotate(0.2); ctx.fillStyle = '#5a3d22'; ctx.fillRect(-L * 0.04, 0, L * 0.1, L * 0.2); ctx.restore()  // grip
    } else if (kind === 'bazooka') {   // cylindrical tube
      ctx.fillStyle = '#4c5a3a'; ctx.beginPath(); ctx.roundRect(-L * 0.16, -L * 0.15, L * 1.02, L * 0.3, L * 0.14); ctx.fill()
      ctx.fillStyle = '#2c3424'; ctx.beginPath(); ctx.ellipse(L * 0.85, 0, L * 0.05, L * 0.16, 0, 0, Math.PI * 2); ctx.fill()   // muzzle mouth
      ctx.beginPath(); ctx.moveTo(-L * 0.16, -L * 0.15); ctx.lineTo(-L * 0.32, -L * 0.22); ctx.lineTo(-L * 0.32, L * 0.22); ctx.lineTo(-L * 0.16, L * 0.15); ctx.closePath(); ctx.fill()   // rear cone
      ctx.fillStyle = '#3a3e48'; ctx.beginPath(); ctx.roundRect(L * 0.3, L * 0.12, L * 0.12, L * 0.22, L * 0.03); ctx.fill()    // grip
      ctx.fillStyle = '#2b2f36'; ctx.fillRect(L * 0.2, -L * 0.26, L * 0.04, L * 0.12)                                           // sight
    }
    ctx.restore()
  }
  function drawHuman(now, walking) {
    const s = view.scale * HUMAN_SCALE, x = me.humanX, y = me.humanY, f = me.humanFace || 1
    const H = 34 * s, headR = 6.5 * s, armLen = 11 * s
    const hipY = -H * 0.42, shoulderY = -H * 0.74, headCY = -H + headR
    const t = walking ? Math.sin(now / 90) : 0
    const guarding = humanKeys.has('e'), punching = now < (me.humanPunchUntil || 0)
    const wk = me.humanWeapon, aiming = wk === 'pistol' || wk === 'rifle' || wk === 'bazooka'
    const swingP = now < (me.swingUntil || 0) ? 1 - (me.swingUntil - now) / SWING_MS : -1   // 0..1 while swinging
    const col = humanColor(), outline = 'rgba(0,0,0,0.5)'
    ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 1, 10 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill()   // shadow
    // body — thick single color with a dark outline pass for contrast
    const limbs = (color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath()
      ctx.moveTo(0, hipY); ctx.lineTo(t * 6 * s, 0); ctx.moveTo(0, hipY); ctx.lineTo(-t * 6 * s, 0)   // legs
      ctx.moveTo(0, hipY); ctx.lineTo(0, shoulderY)                                                   // torso
      ctx.moveTo(0, shoulderY); ctx.lineTo(-f * 5 * s, shoulderY + 9 * s); ctx.stroke()               // back arm
    }
    limbs(outline, 6 * s); limbs(col, 3.8 * s)
    // front arm angle (facing-space): aim toward cursor for guns; posed for sword/guard/punch
    let localAng
    if (aiming) localAng = Math.atan2(cursor.y - (y + shoulderY), (cursor.x - x) * f)
    else if (wk === 'sword') localAng = swingP >= 0 ? (-2.1 + swingP * 2.7) : -1.15   // overhead → down slash
    else if (me.charging && me.chargeKind === 'adogen') localAng = Math.atan2(cursor.y - (y + shoulderY), (cursor.x - x) * f)   // aim the ki-blast
    else if (punching) localAng = 0
    else if (guarding) localAng = -0.7
    else localAng = 0.9 + t * 0.3
    ctx.save(); ctx.scale(f, 1)
    const hx = Math.cos(localAng) * armLen, hy = shoulderY + Math.sin(localAng) * armLen
    if (wk === 'sword' && swingP >= 0) {   // slash trail
      ctx.strokeStyle = 'rgba(190,225,255,0.55)'; ctx.lineWidth = 3.5 * s
      ctx.beginPath(); ctx.arc(0, shoulderY, armLen + 18 * s, -2.1, localAng); ctx.stroke()
    }
    ctx.strokeStyle = outline; ctx.lineWidth = 6 * s; ctx.beginPath(); ctx.moveTo(0, shoulderY); ctx.lineTo(hx, hy); ctx.stroke()
    ctx.strokeStyle = col; ctx.lineWidth = 3.8 * s; ctx.beginPath(); ctx.moveTo(0, shoulderY); ctx.lineTo(hx, hy); ctx.stroke()
    if (wk) {
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(localAng)
      const L = wk === 'rifle' ? 30 * s : wk === 'bazooka' ? 30 * s : wk === 'sword' ? 22 * s : 13 * s
      drawWeapon(wk, L)
      if (wk === 'sword' && me.charging && me.chargeKind === 'sword' && me.charge > 0) {   // charge aura on the blade (no gauge)
        const g = me.charge
        ctx.globalAlpha = 0.35 + 0.5 * g; ctx.fillStyle = g >= 1 ? '#8fd0ff' : '#cfe6ff'
        ctx.beginPath(); ctx.arc(L * 0.75, 0, (3 + g * 7) * s, 0, Math.PI * 2); ctx.fill()
        if (g >= 1) { ctx.globalAlpha = 0.9; ctx.strokeStyle = '#e6f4ff'; ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.arc(L * 0.75, 0, 10 * s, 0, Math.PI * 2); ctx.stroke() }
        ctx.globalAlpha = 1
      }
      ctx.restore()
    } else {   // unarmed: fist, or a growing 아도겐 ki-ball while charging
      if (me.charging && me.chargeKind === 'adogen') {
        const g = me.charge, rr = (4 + g * 12) * s
        ctx.fillStyle = g >= 1 ? '#9be0ff' : '#cdeeff'; ctx.globalAlpha = 0.4 + 0.5 * g
        ctx.beginPath(); ctx.arc(hx + 4 * s, hy, rr, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#eaf8ff'; ctx.lineWidth = 1.5 * s; ctx.beginPath(); ctx.arc(hx + 4 * s, hy, rr, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 1
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(hx, hy, 2.6 * s, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
    // head (big round, skin color) + eye
    ctx.fillStyle = col; ctx.strokeStyle = outline; ctx.lineWidth = 2 * s
    ctx.beginPath(); ctx.arc(0, headCY, headR, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#2a2a30'; ctx.beginPath(); ctx.arc(f * headR * 0.4, headCY, 1.5 * s, 0, Math.PI * 2); ctx.fill()
    const hpw = 22 * s, hp01 = Math.max(0, (me.humanHp || 0) / HUMAN_HP), by = headCY - headR - 6 * s
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-hpw / 2, by, hpw, 3 * s)
    ctx.fillStyle = hp01 > 0.3 ? '#7ecb7e' : '#d05555'; ctx.fillRect(-hpw / 2, by, hpw * hp01, 3 * s)
    ctx.restore()
    if (guarding) {   // 🛡 cat-shield-style barrier above the human, orbiting toward the cursor
      const scx = x, scy = y - H * 0.7, ang = Math.atan2(cursor.y - scy, cursor.x - scx)
      drawShield(scx, scy, ang, 0.95, view.scale * HUMAN_SCALE * 0.24, 1)
    }
  }

  // Black hole — cast at the cursor, fixed there for 10s, 60s cooldown. Gated by achievement.
  function activateBlackhole() {
    if (!bhAvailable()) return
    const now = performance.now()
    if (now < (me.bhCdUntil || 0)) return   // active or on cooldown
    if (!spendCoins(USE_COST.blackhole)) { showToast(`🪙 블랙홀 소환 비용 ${USE_COST.blackhole} 부족`); return }
    me.bhX = cursor.x; me.bhY = cursor.y
    me.bhUntil = now + BH_DUR
    me.bhCdUntil = now + BH_DUR + BH_CD
  }
  // all active black holes (mine + peers') as {x,y,r,mine} in screen coords
  function activeBlackholes(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight, r = BH_R * W, list = []
    if (me.bhUntil && now < me.bhUntil) list.push({ x: me.bhX, y: me.bhY, r, mine: true })
    for (const [, b] of remoteBlackholes) if (now < b.until) list.push({ x: b.nx * W, y: b.ny * H, r, mine: false })
    return list
  }
  // Bopl-battle-style vortex: dark core + rotating accretion disk + spiral arms + glow.
  function drawBlackholes(now) {
    for (const b of activeBlackholes(now)) {
      const R = b.r, sp = now / 260
      ctx.save(); ctx.translate(b.x, b.y)
      // pull glow
      const g = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R)
      g.addColorStop(0, 'rgba(120,70,200,0.45)'); g.addColorStop(0.6, 'rgba(80,40,150,0.18)'); g.addColorStop(1, 'rgba(60,30,120,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill()
      // spiral arms
      ctx.strokeStyle = 'rgba(190,150,255,0.55)'; ctx.lineWidth = 2 * view.scale; ctx.lineCap = 'round'
      for (let s = 0; s < 3; s++) {
        ctx.beginPath()
        for (let k = 0; k <= 24; k++) {
          const f = k / 24, rr = R * 0.9 * f, ang = sp + s * (Math.PI * 2 / 3) + f * 6
          const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
        }
        ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1
      }
      // accretion ring
      ctx.strokeStyle = 'rgba(210,180,255,0.85)'; ctx.lineWidth = 3 * view.scale
      ctx.beginPath(); ctx.ellipse(0, 0, R * 0.42, R * 0.30, sp * 0.5, 0, Math.PI * 2); ctx.stroke()
      // dark core
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.28)
      cg.addColorStop(0, '#000'); cg.addColorStop(0.7, '#05010f'); cg.addColorStop(1, 'rgba(20,8,40,0.2)')
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, R * 0.28, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }
  // Pull a moving object {x,y,vx,vy} toward any black hole it's within; returns the hole that
  // consumed it (reached the core) or null. Force grows sharply toward the center.
  function blackholePull(o, now) {
    const W = canvas.clientWidth, core = BH_CORE * W
    for (const b of activeBlackholes(now)) {
      const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy) || 0.001
      if (d > b.r) continue
      if (d < core) return b                       // consumed
      const t = 1 - d / b.r                         // 0 at rim → 1 near center
      const accel = 0.7 + t * t * 5.5               // stronger near the center
      o.vx += (dx / d) * accel; o.vy += (dy / d) * accel
    }
    return null
  }
  // dust burst: an object turns to particles that spiral into the hole center and fade
  function spawnDustToHole(x, y, hole) {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 1.5
      bhDust.push({ x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        hx: hole.x, hy: hole.y, born: performance.now(), life: 500 + Math.random() * 250 })
    }
  }
  function drawBhDust(now) {
    if (bhDust.length > 240) bhDust.splice(0, bhDust.length - 240)   // cap: drop oldest during bursts
    for (let i = bhDust.length - 1; i >= 0; i--) {
      const p = bhDust[i], t = (now - p.born) / p.life
      if (t >= 1) { bhDust.splice(i, 1); continue }
      const dx = p.hx - p.x, dy = p.hy - p.y, d = Math.hypot(dx, dy) || 1   // accelerate inward + swirl
      p.vx += (dx / d) * 0.9 - dy / d * 0.5; p.vy += (dy / d) * 0.9 + dx / d * 0.5
      p.vx *= 0.9; p.vy *= 0.9; p.x += p.vx; p.y += p.vy
      ctx.save(); ctx.globalAlpha = (1 - t) * 0.9
      ctx.fillStyle = '#c9a9ff'; ctx.beginPath(); ctx.arc(p.x, p.y, 2 * view.scale, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }
  // register an ant kill toward the achievement; unlock + notify at the goal
  function addAntKill() {   // black hole no longer tied to this; just track the count
    antKills++
    localStorage.setItem('antKills', String(antKills))
    pushState()
  }
  // achievement: my missile hit an ENEMY cat → count toward the 500-hit reward
  function addCatHit() {
    catHits++
    localStorage.setItem('catHits', String(catHits))
    if (!catHitRewarded && catHits >= CAT_HIT_GOAL) {
      catHitRewarded = true; localStorage.setItem('catHitRewarded', '1')
      tapCount += CAT_HIT_REWARD; counterDirty = true; renderCounter()
      showToast(`🏆 업적 달성! 상대 고양이 ${CAT_HIT_GOAL}회 타격 — 🪙${CAT_HIT_REWARD.toLocaleString()} 지급!`)
    }
    pushState()
  }

  // ---------- 🔫 gatling gun ----------
  function deployGatling() {
    const now = performance.now()
    if (me.gatActive || now < (me.gatCdUntil || 0)) return   // one at a time; respect destroy cooldown
    if (!spendCoins(USE_COST.gatling)) { showToast(`🪙 게틀링건 소환 비용 ${USE_COST.gatling} 부족`); return }
    if (me.humanActive) removeHuman()                        // gatling + human are mutually exclusive
    me.gatActive = true; me.gatX = cursor.x; me.gatY = cursor.y
    me.gatHp = GAT_HP; me.gatHeat = 0; me.gatOverUntil = 0; me.gatLastShot = 0
    me.gatAng = 0
  }
  function damageMyGatling(dmg) {
    if (!me.gatActive) return
    me.gatHp -= (dmg || 1)
    if (me.gatHp <= 0) { spawnGatDestroy(me.gatX, me.gatY); me.gatActive = false; me.gatCdUntil = performance.now() + GAT_CD }
  }
  function spawnSpark(x, y) {
    for (let k = 0; k < 5; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5
      debris.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: performance.now(), life: 180 + Math.random() * 120, sz: 1.4 + Math.random() * 1.6, color: k % 2 ? '#fff2a0' : '#ffcf47' })
    }
  }
  function spawnGatDestroy(x, y) {
    addEffect(x, y, 3)                       // orange blast
    for (let k = 0; k < 16; k++) {           // flying metal bolts/debris
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI, sp = 2 + Math.random() * 4
      debris.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, born: performance.now(), life: 700 + Math.random() * 400, sz: 2 + Math.random() * 2.5, color: k % 3 ? '#8a8f9c' : '#4a4e5a' })
    }
  }
  // all active gatlings (mine + peers') as {x,y,hp,ang,mine,pid}
  function activeGatlings() {
    const W = canvas.clientWidth, H = canvas.clientHeight, list = []
    if (me.gatActive) list.push({ x: me.gatX, y: me.gatY, hp: me.gatHp, ang: me.gatAng, mine: true })
    for (const [pid, g] of remoteGatlings) list.push({ x: g.nx * W, y: g.ny * H, hp: g.hp, ang: g.ang || 0, mine: false, pid })
    return list
  }
  function hitRemoteGatling(x, y) {          // returns the peer gatling at (x,y), for bullets/missiles
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const [pid, g] of remoteGatlings) { if (Math.hypot(x - g.nx * W, y - g.ny * H) < GAT_HIT_R * view.scale) return { pid } }
    return null
  }
  function hitRemoteGBullet(x, y) {          // any peer bullet near (x,y)?
    const now = performance.now()
    for (const [, rec] of remoteGBullets) {
      if (now - rec.ts > 400) continue
      for (const it of rec.items.values()) if (Math.hypot(x - it.sx * canvas.clientWidth, y - it.sy * canvas.clientHeight) < 10 * view.scale) return true
    }
    return false
  }
  // fire + advance my bullets; collisions with taskbar / ants / black hole / enemy bullets/missiles/guns
  function stepGatling(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    if (me.gatActive) {
      // a black hole drags the WHOLE turret in; reaching the core consumes (destroys) it
      const core = BH_CORE * W
      for (const b of activeBlackholes(now)) {
        const dx = b.x - me.gatX, dy = b.y - me.gatY, d = Math.hypot(dx, dy) || 0.001
        if (d > b.r) continue
        if (d < core + 6 * view.scale) { spawnDustToHole(me.gatX, me.gatY, b); me.gatActive = false; me.gatCdUntil = now + GAT_CD; break }
        const t = 1 - d / b.r, step = (1.2 + t * t * 8) * view.scale   // faster the nearer the center
        me.gatX += (dx / d) * step; me.gatY += (dy / d) * step
      }
    }
    if (me.gatActive) {
      me.gatAng = Math.atan2(cursor.y - me.gatY, cursor.x - me.gatX)
      const dt = Math.min(100, now - (me.gatHeatT || now)); me.gatHeatT = now
      const overheated = now < (me.gatOverUntil || 0)
      if (overheated) {
        me.gatHeat = GAT_HEAT_MAX                                   // stay maxed (red) during the lock
        if (now - (me.gatSmokeT || 0) > 70) {                      // puff smoke from the barrels
          me.gatSmokeT = now
          const s = view.scale, bx = me.gatX + Math.cos(me.gatAng) * 22 * s * GAT_SCALE, by = me.gatY + Math.sin(me.gatAng) * 22 * s * GAT_SCALE - 10 * s
          gatSmoke.push({ x: bx + (Math.random() - 0.5) * 10 * s, y: by, vx: (Math.random() - 0.5) * 0.5, vy: -0.8 - Math.random() * 0.7, r: 4 * s, born: now, life: 700 + Math.random() * 500 })
          if (gatSmoke.length > 120) gatSmoke.shift()
        }
      } else {
        if (me.gatOverUntil && me.gatHeat >= GAT_HEAT_MAX) { me.gatHeat = 0; me.gatOverUntil = 0 }  // just recovered → reset
        if (lmbDown && !platformMode) {
          me.gatHeat = Math.min(GAT_HEAT_MAX, me.gatHeat + GAT_HEAT_RATE * dt)   // builds by TIME held, not per shot
          if (me.gatHeat >= GAT_HEAT_MAX) me.gatOverUntil = now + GAT_OVERHEAT
          if (now - me.gatLastShot >= GAT_FIRE_MS) {
            me.gatLastShot = now
            const a = me.gatAng + (Math.random() - 0.5) * 0.08, muzzle = 26 * view.scale * GAT_SCALE
            gbullets.push({ id: gbulletId++, x: me.gatX + Math.cos(me.gatAng) * muzzle, y: me.gatY + Math.sin(me.gatAng) * muzzle, vx: Math.cos(a) * GAT_BSPEED, vy: Math.sin(a) * GAT_BSPEED, born: now })
            if (gbullets.length > 200) gbullets.shift()
          }
        } else {
          me.gatHeat = Math.max(0, me.gatHeat - GAT_COOL_RATE * dt)  // cool only when the button is released
        }
      }
    }
    const s = view.scale
    for (let i = gbullets.length - 1; i >= 0; i--) {
      const p = gbullets[i]
      const bh = blackholePull(p, now)          // black hole sucks bullets in
      if (bh) { spawnDustToHole(p.x, p.y, bh); gbullets.splice(i, 1); continue }
      p.x += p.vx; p.y += p.vy
      // NO time limit: a bullet lives until it leaves the overlay or hits something
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) { gbullets.splice(i, 1); continue }
      if (inTaskbar(p.x, p.y)) { carveTaskbar(p.x, 0.12); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }   // bullets barely dent
      const plB = hitPlatform(p.x, p.y)
      if (plB) { damagePlatform(plB, GAT_DMG); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // local ants
      let hitLocalAnt = false
      for (const an of ants) if (!an.dead && Math.hypot(p.x - an.x, p.y - an.y) < 14 * s) { antTakeDmg(an, GAT_DMG); if (an.dead) addAntKill(); hitLocalAnt = true; break }
      if (hitLocalAnt) { spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // remote ants
      if (missileHitsAnt(p.x, p.y)) { const ah = missileHitsAnt(p.x, p.y); if (ah && !ah.local && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: GAT_DMG })); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // MY OWN missiles too → the bullet detonates them (self collision)
      let hitOwnMissile = false
      for (let mi = projectiles.length - 1; mi >= 0; mi--) { const m = projectiles[mi]; if (!m.homing) continue; if (Math.hypot(p.x - m.x, p.y - m.y) < 14 * view.scale + (m.power || 1) * 2) { explode(m.x, m.y, m.power); projectiles.splice(mi, 1); hitOwnMissile = true; break } }
      if (hitOwnMissile) { spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // enemy bullets / missiles → mutual destruction (each side destroys its own on overlap)
      if (hitRemoteGBullet(p.x, p.y) || hitRemoteMissile(p.x, p.y, GAT_DMG)) { spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // enemy gatling turret → damage it
      const rg = hitRemoteGatling(p.x, p.y)
      if (rg) { if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: rg.pid, dmg: GAT_DMG })); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // a shield (mine or a peer's) absorbs the bullet
      const sblk = shieldBlocks(p, now)
      if (sblk) {
        if (sblk.id === 'me') hitMyShield(GAT_DMG)
        else if (connected()) net.send(JSON.stringify({ t: 'shield-hit', target: sblk.id, power: GAT_DMG }))
        spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue
      }
      // CHARACTER body → hit reaction (own cat included; respect the cat's shield)
      let hitCat = false
      for (let ci = 0; ci < catPos.length; ci++) {
        const cat = allRef[ci]; if (!cat) continue
        const c = catPos[ci]
        if (Math.hypot(p.x - c.x, p.y - c.y) < 56 * view.scale) {
          if (!catShieldCovers(cat, c, p.x, p.y, now)) {
            cat.hitUntil = now + 800
            if (cat.id !== 'me' && connected()) net.send(JSON.stringify({ t: 'hit', target: cat.id, power: GAT_DMG }))
          }
          hitCat = true; break
        }
      }
      if (hitCat) { spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // draw bullet: bright core + tracer
      ctx.save(); ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(255,180,60,0.85)'; ctx.lineWidth = 4 * s
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 1.1, p.y - p.vy * 1.1); ctx.stroke()
      ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.6 * s, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }
  function drawGatling(g) {
    const s = view.scale * GAT_SCALE          // turret geometry is ~4x the base scale
    ctx.save(); ctx.translate(g.x, g.y)
    // base
    ctx.fillStyle = '#3a3e4a'; ctx.beginPath(); ctx.ellipse(0, 6 * s, 14 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill()
    // rotating barrels toward aim
    ctx.save(); ctx.rotate(g.ang)
    ctx.fillStyle = '#5b6070'; ctx.strokeStyle = '#2a2e38'; ctx.lineWidth = 1 * s
    ctx.beginPath(); ctx.roundRect(-6 * s, -6 * s, 26 * s, 12 * s, 3 * s); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#3a3e48'
    for (let b = -1; b <= 1; b++) { ctx.beginPath(); ctx.roundRect(14 * s, (b * 3.5 - 1.5) * s, 12 * s, 3 * s, 1.5 * s); ctx.fill() }
    ctx.restore()
    // HP + heat bars: sized/positioned in BASE scale so they stay readable above the big body
    const bs = view.scale, top = -6 * s - 10 * bs
    const hpw = 44 * bs, hp = Math.max(0, g.hp) / GAT_HP
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-hpw / 2, top, hpw, 5 * bs)
    ctx.fillStyle = hp > 0.3 ? '#7ecb7e' : '#d05555'; ctx.fillRect(-hpw / 2, top, hpw * hp, 5 * bs)
    if (g.mine) {
      const h01 = Math.min(1, (me.gatHeat || 0) / GAT_HEAT_MAX), over = performance.now() < (me.gatOverUntil || 0)
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-hpw / 2, top - 6 * bs, hpw, 4 * bs)
      ctx.fillStyle = over ? '#ff5a5a' : (h01 > 0.7 ? '#ffa53a' : '#8fb7ff'); ctx.fillRect(-hpw / 2, top - 6 * bs, hpw * h01, 4 * bs)
    }
    ctx.restore()
  }
  function drawGatlings() { for (const g of activeGatlings()) drawGatling(g) }
  function drawGatSmoke(now) {
    for (let i = gatSmoke.length - 1; i >= 0; i--) {
      const p = gatSmoke[i], t = (now - p.born) / p.life
      if (t >= 1) { gatSmoke.splice(i, 1); continue }
      p.x += p.vx; p.y += p.vy; p.vy *= 0.99; p.r += 0.35 * view.scale
      ctx.save(); ctx.globalAlpha = (1 - t) * 0.38
      ctx.fillStyle = '#9aa0ad'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }
  function drawRemoteGBullets(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const [pid, rec] of [...remoteGBullets]) {
      if (now - rec.ts > 400) { remoteGBullets.delete(pid); continue }
      for (const it of rec.items.values()) {
        it.sx += (it.nx - it.sx) * 0.5; it.sy += (it.ny - it.sy) * 0.5
        ctx.save(); ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(it.sx * W, it.sy * H, 3.6 * view.scale, 0, Math.PI * 2); ctx.fill(); ctx.restore()
      }
    }
  }
  function nearestEnemyGatling(x) {
    let best = null, bd = Infinity, W = canvas.clientWidth
    for (const [pid, g] of remoteGatlings) { const d = Math.abs(g.nx * W - x); if (d < bd) { bd = d; best = { pid, x: g.nx * W } } }
    return best
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
  const debris = []          // { x, y, vx, vy, born, life, sz, color }
  // taskbar "dig" heightmap — persistent carved depth per CARVE_SEG-wide column (like shooting
  // a game's ground). Accumulates + deepens with hits; restored via the settings button.
  const CARVE_SEG = 6
  let carve = null, carveDirty = false
  try { const a = JSON.parse(localStorage.getItem('bardig') || 'null'); if (Array.isArray(a)) carve = a } catch {}
  // total accumulated damage → global stages: 0 pits, 1 cracks spread over whole bar, 2 shattered
  let barDamage = parseInt(localStorage.getItem('bardmg') || '0', 10) || 0
  function taskbarRect() {
    if (!primaryRect) return null
    const H = canvas.clientHeight
    const top = primaryRect.y + primaryRect.h
    if (top < H - 2) return { top, h: H - top, x: primaryRect.x, w: primaryRect.w }
    return null
  }
  // dug depth at a given screen x (0 = intact surface)
  function carveDepthAt(x) {
    if (!carve) return 0
    const s = Math.round(x / CARVE_SEG)
    return (s >= 0 && s < carve.length) ? carve[s] : 0
  }
  // the "solid surface" y at x = taskbar top + how deep it's been dug there
  function taskbarSurfaceY(x) { const tb = taskbarRect(); return tb ? tb.top + carveDepthAt(x) : canvas.clientHeight }
  // carve-aware: a missile reaches the DUG floor (not the flat top) before it detonates
  function inTaskbar(x, y) {
    const tb = taskbarRect()
    return tb ? (x >= tb.x - 2 && x <= tb.x + tb.w + 2 && y >= tb.top + carveDepthAt(x) - 6) : false
  }
  function frnd(seed) { const s = Math.sin(seed) * 43758.5453; return s - Math.floor(s) }  // stable per-seed noise
  function spawnDebris(x, y, n, color) {
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = 1.5 + Math.random() * 3.5
      debris.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, born: performance.now(), life: 650 + Math.random() * 300, sz: 1.5 + Math.random() * 2.5, color: color || '#2a2a30' })
    }
  }
  function ensureCarve() {
    const segs = Math.max(1, Math.ceil(canvas.clientWidth / CARVE_SEG))
    if (!carve || carve.length !== segs) {
      const old = carve; carve = new Array(segs).fill(0)
      if (old) for (let i = 0; i < Math.min(old.length, segs); i++) carve[i] = old[i]
    }
    return carve
  }
  // gouge the taskbar at x — deepens (accumulates) a crater; capped at ~taskbar height.
  // `local` hits broadcast so everyone's taskbar takes the same damage ("break it together").
  function carveTaskbar(x, power, local) {
    const tb = taskbarRect(); if (!tb) return
    ensureCarve()
    // crater size scales with `power`: a missile (power≥1) gouges wide+deep, a gatling bullet
    // (power≈0.12) barely dents. `power` is what gets broadcast, so peers carve the same size.
    const ci = Math.round(x / CARVE_SEG), rad = Math.min(42, Math.max(1, Math.round(power * 8))), maxD = tb.h * 0.72
    for (let s = ci - rad; s <= ci + rad; s++) {
      if (s < 0 || s >= carve.length) continue
      const f = 1 - Math.abs(s - ci) / (rad + 1)
      carve[s] = Math.min(maxD, carve[s] + (2 + power * 12) * f * f)
    }
    barDamage += power
    carveDirty = true
    spawnDebris(x, tb.top + 3, Math.max(2, Math.round(power * 8)), '#3a3a42')
    if (local !== false && connected() && net) net.send(JSON.stringify({ t: 'dig', nx: +(x / canvas.clientWidth).toFixed(4), power }))
  }
  function resetTaskbarDig(local) {
    carve = null; ensureCarve(); barDamage = 0; localStorage.removeItem('bardig'); localStorage.removeItem('bardmg'); carveDirty = false
    if (local !== false && connected() && net) net.send(JSON.stringify({ t: 'digreset' }))   // everyone restores together
  }
  // draw the accumulated pits: dark excavated region between the surface (tb.top) and the
  // carved profile (tb.top + carve[s]), with a rough chipped rim
  function drawTaskbarDig() {
    const tb = taskbarRect(); if (!tb || !carve) return
    const W = canvas.clientWidth
    let any = false; for (let s = 0; s < carve.length; s++) if (carve[s] > 0.5) { any = true; break }
    if (!any) return
    // ---- local pits only (no crack / no whole-bar collapse effect) ----
    if (any) {
      const prof = (s) => tb.top + carve[s] + (carve[s] > 0.5 ? (frnd(s) - 0.5) * 3 : 0)
      ctx.save()
      ctx.beginPath(); ctx.moveTo(0, tb.top)
      for (let s = 0; s < carve.length; s++) ctx.lineTo(s * CARVE_SEG, prof(s))
      ctx.lineTo(W, tb.top); ctx.closePath()
      const g = ctx.createLinearGradient(0, tb.top, 0, tb.top + tb.h)
      g.addColorStop(0, 'rgba(6,5,9,0.95)'); g.addColorStop(1, 'rgba(14,12,20,0.85)')
      ctx.fillStyle = g; ctx.fill()
      ctx.beginPath(); let down = false
      for (let s = 0; s < carve.length; s++) {
        const x = s * CARVE_SEG
        if (carve[s] > 0.5) { if (!down) { ctx.moveTo(x, prof(s)); down = true } else ctx.lineTo(x, prof(s)) }
        else down = false
      }
      ctx.strokeStyle = 'rgba(200,205,220,0.4)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.stroke()
      ctx.restore()
    }
  }
  function drawDebris(now) {
    const tb = taskbarRect(); const floor = tb ? tb.top + tb.h - 2 : canvas.clientHeight - 2
    if (debris.length > 320) debris.splice(0, debris.length - 320)   // cap: drop oldest during bursts
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i], t = (now - d.born) / d.life
      if (t >= 1) { debris.splice(i, 1); continue }
      d.vy += 0.22; d.x += d.vx; d.y += d.vy; d.vx *= 0.99
      if (d.y > floor) { d.y = floor; d.vy *= -0.35; d.vx *= 0.6 }
      ctx.save(); ctx.globalAlpha = (1 - t) * 0.9; ctx.fillStyle = d.color
      ctx.fillRect(d.x - d.sz / 2, d.y - d.sz / 2, d.sz, d.sz); ctx.restore()
    }
  }

  // ---------- ants (🐜) — crawl on the taskbar, fight enemy ants, die in 3 hits ----------
  const ants = []              // MY ants (I simulate them authoritatively)
  const remoteAnts = new Map() // peerId -> { list:[{id,x,y,hp,dead}], ts }  (x,y relative to peer cat)
  const MAX_ANTS = 5
  const ANT_HP = 1
  const ANT_DRAW = 2   // ant visual size multiplier (on top of view.scale)
  // per-player ant color — tied to the owner's fur skin so each player's ants are distinct
  const ANT_COLORS = { default: '#5b5b66', cream: '#caa96a', gray: '#7b8290', brown: '#7a4a2a', black: '#26262e', orange: '#e0862a', pink: '#e06a95', mint: '#2fa98c', lavender: '#8f6ad6' }
  function antColor(skin) { return ANT_COLORS[skin] || ANT_COLORS.default }
  let nextAntId = 1
  // Ants stand ON the taskbar's top boundary line (feet on the line, body above it) — not
  // sunk inside the bar. Falls back to the screen bottom if there's no detectable taskbar.
  // ants stand on the DUG surface at their x (dip into pits), not the flat taskbar top
  function antGroundY(x) { const tb = taskbarRect(); return (tb ? tb.top + carveDepthAt(x || 0) : canvas.clientHeight) - 5 * view.scale }
  function summonAnt() {
    if (ants.filter((a) => !a.dead).length >= MAX_ANTS) return
    ants.push({ id: nextAntId++, x: cursor.x, y: cursor.y, vy: 0, onGround: false, hp: ANT_HP,
      dir: Math.random() < 0.5 ? -1 : 1, wanderUntil: 0, atkCd: 0, dead: false, deadAt: 0, step: Math.random() * 10 })
  }
  // peer ants: normalized X → my screen; pinned to MY taskbar line so they always crawl on it
  function remoteAntScreenPos(peerId, a) {
    const sx = (a.sx != null ? a.sx : a.nx) * canvas.clientWidth
    return { x: sx, y: antGroundY(sx), id: a.id, hp: a.hp, dead: a.dead }
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
    const W = canvas.clientWidth, myCol = antColor(me.skin)
    for (let i = ants.length - 1; i >= 0; i--) {
      const a = ants[i]
      if (a.dead) {
        if (now - a.deadAt > 420) ants.splice(i, 1)
        else drawAntCorpse(a, now)
        continue
      }
      // black hole pull overrides falling + AI; reaching the core dust-consumes the ant
      let hole = null, hbest = Infinity
      for (const b of activeBlackholes(now)) { const dd = Math.hypot(b.x - a.x, b.y - a.y); if (dd <= b.r && dd < hbest) { hbest = dd; hole = b } }
      if (hole) {
        const dx = hole.x - a.x, dy = hole.y - a.y, d = hbest || 1
        if (d < BH_CORE * W) { spawnDustToHole(a.x, a.y, hole); if (hole.mine) addAntKill(); ants.splice(i, 1); continue }
        const sp = 2 + (1 - d / hole.r) * 8
        a.x += (dx / d) * sp; a.y += (dy / d) * sp; a.onGround = false
        a.dir = dx >= 0 ? 1 : -1; a.step += 0.4
        drawAnt(a, now, false, myCol); continue
      }
      const gy = antGroundY(a.x)   // dug-surface height at this ant's x
      if (!a.onGround) {                        // fall from the cursor onto the bar
        a.vy += 0.5; a.y += a.vy
        if (a.y >= gy) { a.y = gy; a.vy = 0; a.onGround = true }
        drawAnt(a, now, false, myCol); continue
      }
      // target the nearest enemy — an ant OR a gatling turret (both take melee damage)
      const eAnt = nearestEnemyAnt(a.x), eGat = nearestEnemyGatling(a.x)
      let tgt = null
      const dAnt = eAnt ? Math.abs(eAnt.s.x - a.x) : Infinity, dGat = eGat ? Math.abs(eGat.x - a.x) : Infinity
      if (dAnt <= dGat && eAnt) tgt = { x: eAnt.s.x, msg: { t: 'ant-hit', target: eAnt.pid, ant: eAnt.s.id, dmg: 1 } }
      else if (eGat) tgt = { x: eGat.x, msg: { t: 'gat-hit', target: eGat.pid, dmg: 1 } }
      let moving = true
      if (tgt) {                                // march toward the nearest enemy
        a.dir = tgt.x >= a.x ? 1 : -1
        if (Math.abs(tgt.x - a.x) <= 22) {      // melee range (ants are ~2x now)
          moving = false
          if (now >= a.atkCd) { a.atkCd = now + 600; a.atkFlash = now + 220; spawnBlood(tgt.x, a.y - 4 * view.scale, 5); if (connected()) net.send(JSON.stringify(tgt.msg)) }   // bite: lunge + red burst at the target
        }
      } else if (now >= a.wanderUntil) {
        a.wanderUntil = now + 700 + Math.random() * 1400; if (Math.random() < 0.35) a.dir *= -1
      }
      if (moving) { a.x += a.dir * 0.9; if (a.x < 8) { a.x = 8; a.dir = 1 } if (a.x > W - 8) { a.x = W - 8; a.dir = -1 } a.step += 0.35 }
      a.y = gy
      drawAnt(a, now, !moving, myCol)
    }
  }
  function drawRemoteAnts(now) {
    const W = canvas.clientWidth
    for (const [pid, rec] of [...remoteAnts]) {
      if (now - rec.ts > 1000) { remoteAnts.delete(pid); continue }
      const col = antColor((peers.get(pid) || {}).tint)   // color by that peer's fur skin
      for (const a of rec.items.values()) {
        if (a.dead) continue
        a.sx += (a.nx - a.sx) * SMOOTH   // glide toward latest (normalized X)
        const ax = a.sx * W
        drawAnt({ x: ax, y: antGroundY(ax), dir: a.dir || 1, step: now / 90, hp: a.hp }, now, false, col)  // dir from owner
      }
    }
  }
  function drawAnt(a, now, fighting, color) {
    const s = view.scale * ANT_DRAW, dir = a.dir || 1
    const body = color || '#5b5b66', leg = 'rgba(18,16,24,0.9)'   // body = owner color, dark legs
    const biting = a.atkFlash && now < a.atkFlash
    const lunge = biting ? Math.sin((1 - (a.atkFlash - now) / 220) * Math.PI) * 5 * s : 0   // quick forward jab
    ctx.save(); ctx.translate(a.x + dir * lunge, a.y); ctx.scale(s * dir, s)
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
    if (biting) {   // wide-open mandibles + bright chomp burst at the mouth
      ctx.strokeStyle = leg; ctx.lineWidth = 1.8
      ctx.beginPath(); ctx.moveTo(7, -6); ctx.lineTo(13, -9); ctx.moveTo(7, -2); ctx.lineTo(13, 1); ctx.stroke()
      ctx.strokeStyle = 'rgba(255,235,150,0.95)'; ctx.lineWidth = 1.4
      for (let k = 0; k < 5; k++) { const ang = k * 1.257 + 0.3; ctx.beginPath(); ctx.moveTo(12, -4); ctx.lineTo(12 + Math.cos(ang) * 5, -4 + Math.sin(ang) * 5); ctx.stroke() }
    } else if (fighting && Math.floor(now / 120) % 2 === 0) {
      ctx.beginPath(); ctx.moveTo(8, -5); ctx.lineTo(11, -6); ctx.moveTo(8, -3); ctx.lineTo(11, -2); ctx.stroke()  // idle mandible snap
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
    if (inTaskbar(x, y)) carveTaskbar(x, (power || 1) * 0.192)   // small craters (30% of the previous 0.64); still scales with merge level
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
    for (const a of ants) if (!a.dead && Math.hypot(x - a.x, y - a.y) <= R) { antTakeDmg(a, power); if (a.dead) addAntKill() }
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
      if (cat.id !== 'me') { if (connected()) net.send(JSON.stringify({ t: 'hit', target: cat.id, power })); addCatHit() }   // achievement: enemy-cat hit
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
        // a black hole (mine or a peer's) pulls the missile in; reaching the core consumes it
        const bh = blackholePull(p, now)
        if (bh) { spawnDustToHole(p.x, p.y, bh); projectiles.splice(i, 1); continue }
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
        // missile hits an enemy gatling turret → damage it, then blast
        const rgm = hitRemoteGatling(p.x, p.y)
        if (rgm) { if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: rgm.pid, dmg: p.power })); explode(p.x, p.y, p.power); projectiles.splice(i, 1); continue }
        // a drawn platform is solid: detonate on it and chip its HP
        const pl = hitPlatform(p.x, p.y)
        if (pl) { damagePlatform(pl, p.power); explode(p.x, p.y, p.power); projectiles.splice(i, 1); continue }
        // detonate on contact with an ant, cat, peer missile, peer gatling bullet, OR taskbar
        if (missileHitsAnt(p.x, p.y) || hitTestCats(p.x, p.y) || hitRemoteMissile(p.x, p.y, p.power) || hitRemoteGBullet(p.x, p.y) || inTaskbar(p.x, p.y)) {
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
  let sentMissiles = false, sentShield = false, sentAnts = false, sentBh = false, sentGat = false, sentGB = false
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
      net.send(JSON.stringify({ t: 'ants', list: ants.map((a) => ({ id: a.id, nx: +(a.x / NW).toFixed(4), hp: a.hp, dead: a.dead, dir: a.dir })) }))
    } else if (sentAnts) { net.send(JSON.stringify({ t: 'ants', list: [] })); sentAnts = false }

    if (me.bhUntil && now < me.bhUntil) {
      sentBh = true
      net.send(JSON.stringify({ t: 'blackhole', nx: +(me.bhX / NW).toFixed(4), ny: +(me.bhY / NH).toFixed(4), ttl: Math.round(me.bhUntil - now) }))
    } else if (sentBh) { net.send(JSON.stringify({ t: 'blackhole', ttl: 0 })); sentBh = false }

    if (me.gatActive) {
      sentGat = true
      net.send(JSON.stringify({ t: 'gatling', active: 1, nx: +(me.gatX / NW).toFixed(4), ny: +(me.gatY / NH).toFixed(4), hp: me.gatHp, ang: +(me.gatAng || 0).toFixed(2) }))
    } else if (sentGat) { net.send(JSON.stringify({ t: 'gatling', active: 0 })); sentGat = false }
    if (gbullets.length) {
      sentGB = true
      net.send(JSON.stringify({ t: 'gbullets', list: gbullets.slice(-40).map((p) => ({ id: p.id, nx: +(p.x / NW).toFixed(4), ny: +(p.y / NH).toFixed(4) })) }))
    } else if (sentGB) { net.send(JSON.stringify({ t: 'gbullets', list: [] })); sentGB = false }

    // my widget position (normalized 0..1 to my screen) + interaction count, so peers place
    // my cat where I put it and can see my counter
    if (wx != null) {
      const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1
      net.send(JSON.stringify({ t: 'pos', nx: +(wx / W).toFixed(4), ny: +(wy / H).toFixed(4), taps: tapCount }))
    }
  }, 50)   // ~20 updates/s — higher rate so remote missiles/ants move smoother

  // ---------- widget placement + click-through management ----------
  // The window covers the whole screen. The cat "widget" (cat + desk + bottom bar)
  // sits at a draggable spot; everywhere else the window is click-through so it never
  // blocks your normal desktop use. Interactive only while the cursor is over the widget.
  const SCALE = 0.8    // widget (cat + desk + bar) drawn 20% smaller (counter text stays CSS-sized)
  const BAR_SPACE = 34 // room below the cell for the DOM #hud-bar
  const GRID_COLS = 8, GRID_ROWS = 4   // drag-snap preset anchors
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
    positionShop()
  }
  function positionChat() {
    chatbar.style.left = (wx + cellPxW / 2) + 'px'
    chatbar.style.top = (wy - 34) + 'px'
  }
  // a peer's interaction counter — same bottom-bar design as MY HUD (#hud-bar + #counter),
  // just WITHOUT the hamburger. Drawn on-canvas below their cat, full cell width, fixed text.
  function drawPeerCount(origin, taps) {
    const sc = view.scale
    const barW = CELL_W * sc, x = origin.x, y = origin.y + CELL_H * sc + 2
    const h = 32, pad = 4
    ctx.save()
    // light bar (matches #hud-bar)
    ctx.beginPath(); ctx.roundRect(x, y, barW, h, 10)
    ctx.fillStyle = 'rgba(238,240,245,0.97)'; ctx.fill()
    // dark counter chip spanning the full inner width (no hamburger) — matches #counter
    ctx.beginPath(); ctx.roundRect(x + pad, y + pad, barW - pad * 2, h - pad * 2, 6)
    ctx.fillStyle = '#2a2a34'; ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '700 13px "Segoe UI", "Malgun Gothic", sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText((taps || 0).toLocaleString(), x + barW / 2, y + h / 2 + 0.5)
    ctx.restore()
  }

  // Main decides click-through by polling the real cursor against this "hotzone".
  // We just report the widget rect (+ force flag while chatting/editing).
  let chatOpenFlag = false, dragging = null
  function sendHotzone() {
    if (wx == null) return
    inputSource.setHotzone({ rect: { x: wx, y: wy, w: cellPxW, h: cellPxH + BAR_SPACE }, force: chatOpenFlag || editing || shopOpenFlag || platformMode })
  }

  // cursor for missile homing + dragging comes from main's poll (window-relative)
  if (inputSource.onCursor) inputSource.onCursor((p) => {
    cursor.x = p.x; cursor.y = p.y
    if (dragging) { wx = p.x - dragging.dx; wy = p.y - dragging.dy; clampWidget(); positionHud(); sendHotzone() }
    if (platformMode && lmbDown && curStroke) {   // sample brush points (distance-throttled)
      const last = curStroke.pts[curStroke.pts.length - 1]
      if (curStroke.pts.length < 400 && Math.hypot(p.x - last.x, p.y - last.y) > 6) curStroke.pts.push({ x: p.x, y: p.y })
    }
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
    drawTaskbarDig()        // taskbar surface/cracks/collapse — FURTHEST BACK so missiles/ants pass in FRONT of it
    drawPlatforms()         // host-drawn floor platforms
    stepGroundWeapons(now)  // pick-up-able weapons resting on the taskbar
    drawBlackholes(now)
    drawShields(now)
    stepProjectiles(now)
    drawShieldShards(now)
    drawRemoteMissiles(now)
    drawDebris(now)
    stepAnts(now)
    drawRemoteAnts(now)
    drawGatlings()
    stepGatling(now)
    drawGatSmoke(now)
    drawRemoteGBullets(now)
    stepHbullets(now)
    stepHuman(now)
    drawBhDust(now)
    ctx = stagectx

    positionHandles(now)
    positionHud()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  pushState()
})()
