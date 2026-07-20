// Overlay: render loop, global input, multiplayer client, edit mode.
(function () {
  const canvas = document.getElementById('stage')
  const fxCanvas = document.getElementById('fx')   // weapons layer — sits ABOVE the DOM HUD bar
  const stagectx = canvas.getContext('2d')
  const fxctx = fxCanvas.getContext('2d')
  let ctx = stagectx   // current draw target; swapped between the two layers each frame
  const { CELL_W, CELL_H, DEFAULT_FEAT, DEFAULT_SHAPE } = window.AnimalArt
  const SHAPE_KEYS = ['ear', 'eye', 'mouth', 'tail']   // wire order for the packed shape string
  function loadShape() {
    let s = {}; try { s = JSON.parse(localStorage.getItem('catShape') || '{}') || {} } catch {}
    return Object.assign({}, DEFAULT_SHAPE, s)
  }
  function shapeStr(sh) { return SHAPE_KEYS.map((k) => (sh || {})[k] || DEFAULT_SHAPE[k]).join('|') }
  function parseShape(str) {
    const parts = String(str || '').split('|'); const o = {}
    SHAPE_KEYS.forEach((k, i) => { o[k] = parts[i] || DEFAULT_SHAPE[k] })
    return o
  }

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
  const WEAPONS = { none: '없음', missile: '🚀 미사일', shield: '🛡 쉴드', ant: '🐜 개미', blackhole: '🕳 블랙홀', gatling: '🔫 게틀링건', human: '🕺 인간', adogen: '🔵 아도겐', lightning: '⚡ 낙뢰', net: '🕸️ 그물' }
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
  const remoteHumans = new Map()      // peerId -> { nx, ny, hp, weapon, face }
  const remoteHbullets = new Map()    // peerId -> { items: Map, ts }  (human bullets/검기/아도겐)
  let hbId = 1
  let lmbDown = false                 // left mouse held (from main's global hook)
  // 🕳 Black hole: cast at the cursor, fixed for 10s, 60s cooldown. Pulls missiles/ants within
  // its radius toward the center (stronger nearer); reaching the core dust-particles them away.
  const BH_DUR = 10000, BH_CD = 60000
  const BH_R = 0.096    // VISUAL radius (fraction of width) — the vortex art size; pull now reaches the whole screen
  const BH_CORE = 0.016 // core radius (fraction) — objects here get consumed
  const BH_NEAR = 0.09  // characteristic pull distance: force is at half-strength ~here, falls off with distance²
  // whole-screen gravity: strong near the summon point, weak (but never zero on-screen) far away
  function bhForce(d, peak) { const n = BH_NEAR * canvas.clientWidth; return peak * (n * n) / (n * n + d * d) }
  const remoteBlackholes = new Map()  // peerId -> { nx, ny, until }
  const bhDust = []                   // consumption particles (spiral into center + fade)
  // achievement: kill 100 ants to unlock the black hole. antKills persists in localStorage.
  const ANT_KILL_GOAL = 100
  let antKills = parseInt(localStorage.getItem('antKills') || '0', 10) || 0
  let isHost = localStorage.getItem('host') === '1'   // set true by the SERVER (loopback client)
  const isDev = !!(window.bongo && window.bongo.isDev)   // developer PC only (env HONGGOCAT_DEV=1) → mint count currency freely
  if (isDev) setTimeout(() => { try { showToast('🛠️ 개발자 모드 — 상점에서 카운트 무한 획득') } catch {} }, 900)
  let bhNotified = localStorage.getItem('bhNotified') === '1'
  // achievement: hit ENEMY cats with missiles 500 times → reward 10,000 counts (once)
  const CAT_HIT_GOAL = 500, CAT_HIT_REWARD = 10000
  let catHits = parseInt(localStorage.getItem('catHits') || '0', 10) || 0
  let catHitRewarded = localStorage.getItem('catHitRewarded') === '1'
  // character HP: weapon damage chips it; desk/keyboard/mouse break in stages + face worsens as it drops.
  // achievement: reach 0 HP (완전 파괴) 5 times → 20,000 counts. HP is reset in the shop (500).
  const CAT_HP = 100, DESTROY_GOAL = 5, DESTROY_REWARD = 20000
  let destroyCount = parseInt(localStorage.getItem('destroys') || '0', 10) || 0
  let destroyRewarded = localStorage.getItem('destroyRewarded') === '1'
  // achievements: destroy an enemy's gatling / human 10 times → 10,000 counts each
  const GAT_KILL_GOAL = 10, HUMAN_KILL_GOAL = 10, KILL_REWARD = 10000
  const MECHA_KILL_GOAL = 10, MECHA_KILL_REWARD = 15000                      // destroy 10 enemy ant mechas → 15,000
  let gatKills = parseInt(localStorage.getItem('gatKills') || '0', 10) || 0
  let gatKillRewarded = localStorage.getItem('gatKillRewarded') === '1'
  let humanKills = parseInt(localStorage.getItem('humanKills') || '0', 10) || 0
  let humanKillRewarded = localStorage.getItem('humanKillRewarded') === '1'
  let mechaKills = parseInt(localStorage.getItem('mechaKills') || '0', 10) || 0
  let mechaKillRewarded = localStorage.getItem('mechaKillRewarded') === '1'
  // black hole usable if you're the host OR you've earned the achievement
  // ---------- shop / ownership ----------
  // Every weapon except the basic missile must be PURCHASED in the shop, spending the counter
  // (taps) as currency. One-time purchase → permanently owned (localStorage). Host owns all.
  const PRICES = { shield: 10000, gatling: 10000, blackhole: 10000, ant: 10000, human: 10000, adogen: 10000, lightning: 10000, net: 10000 }   // all unlocks 10k
  // per-summon cost: even after unlocking, these charge the counter EACH time you summon them
  const USE_COST = {}   // 소환 추가비용 폐지 — 보유하면 무료 소환 (배틀 UI 개편)
  const SHOP_ITEMS = ['shield', 'gatling', 'ant', 'human', 'blackhole', 'lightning', 'net']
  const SLOT_CHOICES = ['none', 'missile', 'shield', 'gatling', 'ant', 'human', 'blackhole', 'lightning', 'net']
  // 배틀 UI 개편: 최신 버전 최초 실행 시 1회 초기화 — 카운트·레거시 무기·업그레이드·가챠를
  // 전부 리셋하고 스타터(개미·미사일)만 남긴다. (플래그로 1회만)
  try {
    if (!localStorage.getItem('hgbattle.migrated')) {
      localStorage.setItem('taps', '0')
      localStorage.setItem('owned', '[]')
      localStorage.removeItem('missileUp'); localStorage.removeItem('antUp'); localStorage.removeItem('lightningUp')
      if (window.BattleGacha && window.BattleGacha._devReset) window.BattleGacha._devReset()
      localStorage.setItem('hgbattle.migrated', '1')
    }
  } catch (e) {}
  let owned = new Set()
  try { const a = JSON.parse(localStorage.getItem('owned') || '[]'); if (Array.isArray(a)) owned = new Set(a) } catch {}
  // 보유 판정 통합: 호스트 / 레거시 구매(owned) / 가챠 보유(BattleGacha) 중 하나면 보유.
  function isOwned(id) { return isHost || owned.has(id) || !!(window.BattleGacha && window.BattleGacha.isOwned(id)) }
  // hats are all LOCKED for now (to be sold in the shop / given as achievement rewards later).
  // ownedHats starts empty → only 'none' is available.
  let ownedHats = new Set()
  try { const a = JSON.parse(localStorage.getItem('ownedHats') || '[]'); if (Array.isArray(a)) ownedHats = new Set(a) } catch {}
  function isHatOwned(hat) { return hat === 'none' || ownedHats.has(hat) }
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
  me.shape = loadShape()
  const IDLE_MS = 5 * 60 * 1000      // no key/mouse input for 5 min → 자리비움(away)
  me.lastInput = performance.now()   // for the 자리비움(away) animation
  me.away = false
  me.hp = parseInt(localStorage.getItem('catHp') || String(CAT_HP), 10); if (!(me.hp >= 0) || me.hp > CAT_HP) me.hp = CAT_HP
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

  // ---------- user-configurable slot hotkeys (settings → 단축키) ----------
  const DEFAULT_KEYBINDS = { mod: 'alt', keys: ['Z', 'X', 'C'] }
  let keybinds = DEFAULT_KEYBINDS
  try { const kb = JSON.parse(localStorage.getItem('keybinds') || 'null'); if (kb && Array.isArray(kb.keys) && kb.keys.length) keybinds = { mod: kb.mod || 'alt', keys: kb.keys.slice(0, 3) } } catch {}
  if (inputSource.setKeybinds) inputSource.setKeybinds(keybinds)   // tell main which physical keys to watch

  // ---------- counter ----------
  const counterEl = document.getElementById('counter')
  let tapCount = parseInt(localStorage.getItem('taps') || '0', 10) || 0
  let counterDirty = false
  let penaltyAcc = 0   // while 완전 파괴, only every 2nd input counts (half rate)
  function renderCounter() {
    counterEl.textContent = tapCount.toLocaleString() // no animation
    const broken = me.hp <= 0
    counterEl.classList.toggle('penalty', broken)
    counterEl.title = broken ? '완전 파괴 패널티 — 입력 2번당 +1' : '내 상호작용 횟수'
  }
  function floatPenalty() {   // faint red "+1" so you can tell you're earning at half rate
    const bar = document.getElementById('hud-bar'); if (!bar) return
    const f = document.createElement('div'); f.className = 'pen-float'; f.textContent = '+1'
    bar.appendChild(f); setTimeout(() => f.remove(), 650)
  }
  function showCreditPop(n) {   // big gold coin-gain flourish (e.g. destroying an opponent → +500)
    const bar = document.getElementById('hud-bar'); if (!bar) return
    const f = document.createElement('div'); f.className = 'credit-pop'; f.textContent = `＋${n.toLocaleString()} 🪙`
    bar.appendChild(f); setTimeout(() => f.remove(), 1400)
    if (counterEl) { counterEl.classList.add('credit-flash'); setTimeout(() => counterEl.classList.remove('credit-flash'), 900) }
  }
  function showLossPop(n) {   // red coin-LOSS flourish (my summoned thing was destroyed → −count)
    const bar = document.getElementById('hud-bar'); if (!bar) return
    const f = document.createElement('div'); f.className = 'loss-pop'; f.textContent = `−${n.toLocaleString()} 🪙`
    bar.appendChild(f); setTimeout(() => f.remove(), 1300)
    if (counterEl) { counterEl.classList.add('loss-flash'); setTimeout(() => counterEl.classList.remove('loss-flash'), 800) }
  }
  const KILL_COUNT = { ant: 10, human: 200, gat: 300, mecha: 300, mechahuman: 500 }   // reward per destroy; owner loses the same (mecha human-form = 500)
  function rewardKill(kind, amt) {   // I destroyed a peer's ant/human/gatling → +count
    const n = amt || KILL_COUNT[kind] || 0; if (!n) return
    tapCount += n; counterDirty = true; renderCounter(); showCreditPop(n)
  }
  function loseCredits(n) { if (!n) return; tapCount = Math.max(0, tapCount - n); counterDirty = true; renderCounter(); showLossPop(n) }
  function creditKill(kind, byId) {   // MY summoned entity was destroyed by a peer → I lose count; killer gains it
    if (byId == null || !connected() || !net) return   // only a networked opponent's kill (not self/environmental) counts
    const n = KILL_COUNT[kind] || 0
    loseCredits(n)
    net.send(JSON.stringify({ t: 'kill', kind, by: byId, amt: n }))
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
    if (isDev) {   // dev-only: mint count currency (click as many times as you want)
      const row = document.createElement('div'); row.className = 'shop-row'
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = '🛠️ 개발자 카운트'; row.appendChild(nm)
      for (const amt of [100000, 1000000]) { const b = document.createElement('button'); b.className = 'shop-buy'; b.textContent = '+' + amt.toLocaleString(); b.onclick = () => addDevCoins(amt); row.appendChild(b) }
      shopListEl.appendChild(row)
    }
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
    renderUpgrades()
    renderSlots()
  }
  // 🚀 missile-count upgrade shown as a 5-segment gauge; +1 max missile per 3,000 (base 5 → 10)
  function renderUpgrades() {
    const el = document.getElementById('shop-upgrade-list'); if (!el) return
    el.innerHTML = ''
    // generic 5-segment gauge upgrade row
    const gaugeRow = (label, level, valueText, price, onBuy) => {
      const row = document.createElement('div'); row.className = 'shop-row'
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; row.appendChild(nm)
      const gauge = document.createElement('div'); gauge.className = 'upg-gauge'
      for (let k = 0; k < 5; k++) { const seg = document.createElement('span'); seg.className = 'upg-seg' + (k < level ? ' on' : ''); gauge.appendChild(seg) }
      row.appendChild(gauge)
      const v = document.createElement('span'); v.className = 'use'; v.textContent = valueText; row.appendChild(v)
      if (level >= 5) { const s = document.createElement('span'); s.className = 'shop-owned'; s.textContent = 'MAX'; row.appendChild(s) }
      else { const b = document.createElement('button'); b.className = 'shop-buy'; b.textContent = `+1 🪙${price.toLocaleString()}`; b.disabled = tapCount < price; b.onclick = onBuy; row.appendChild(b) }
      el.appendChild(row)
    }
    // (레거시 미사일/개미/낙뢰 게이지 제거 — 이제 보유 시 기본 최대로 작동)
    // 🩹 HP reset (consumable)
    const r2 = document.createElement('div'); r2.className = 'shop-row'
    const n2 = document.createElement('span'); n2.className = 'nm'; n2.textContent = '🩹 체력 리셋'; r2.appendChild(n2)
    const hpTxt = document.createElement('span'); hpTxt.className = 'use'; hpTxt.textContent = `HP ${Math.round(me.hp * 10) / 10}/${CAT_HP}`; r2.appendChild(hpTxt)
    if (me.hp >= CAT_HP) { const s = document.createElement('span'); s.className = 'shop-owned'; s.textContent = '가득'; r2.appendChild(s) }
    else { const b2 = document.createElement('button'); b2.className = 'shop-buy'; b2.textContent = '🪙500'; b2.disabled = tapCount < 500; b2.onclick = () => buyHpReset(); r2.appendChild(b2) }
    el.appendChild(r2)
  }
  function buyHpReset() {
    if (me.hp >= CAT_HP) return
    if (!spendCoins(500)) { showToast('🪙 재화 부족 — 500 필요'); return }
    resetCatHp(); showToast('🩹 체력 회복 완료!'); renderShop(); pushState()
  }
  function buyMissileUpgrade() {
    if (missileUp >= 5) return
    if (!spendCoins(3000)) { showToast('🪙 재화 부족 — 3,000 필요'); return }
    missileUp++; localStorage.setItem('missileUp', String(missileUp))
    showToast(`⬆️ 미사일 최대 ${5 + missileUp}개!${missileUp >= 5 ? ' (10개 합체 = ☢ 핵)' : ''}`); renderShop()
  }
  function buyAntUpgrade() {
    if (antUp >= 5) return
    if (!spendCoins(1000)) { showToast('🪙 재화 부족 — 1,000 필요'); return }
    antUp++; localStorage.setItem('antUp', String(antUp))
    showToast(`⬆️ 개미 최대 ${antMax()}마리!`); renderShop()
  }
  function buyLightningUpgrade() {
    if (lightningUp >= 5) return
    if (!spendCoins(3000)) { showToast('🪙 재화 부족 — 3,000 필요'); return }
    lightningUp++; localStorage.setItem('lightningUp', String(lightningUp))
    showToast(`⬆️ 낙뢰 충전 ${lightningMax()}단계까지!`); renderShop()
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
    if (!n) return true
    if (tapCount < n) return false
    tapCount -= n; counterDirty = true; renderCounter()
    return true
  }
  function addDevCoins(n) {   // dev-only: mint count currency for testing
    if (!isDev) return
    tapCount += n; counterDirty = true; renderCounter(); renderShop(); showToast(`🛠️ +${n.toLocaleString()} 카운트`)
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

  // ---------- 🏆 achievements popup (its own button, directly under the shop button) ----------
  const achvBtn = document.getElementById('btn-achv')
  const achvEl = document.getElementById('achv')
  const achvListEl = document.getElementById('achv-list')
  let achvOpenFlag = false, achvPos = null
  const ACHIEVEMENTS = [
    { key: 'cathit', name: '🎯 저격수', desc: '상대 고양이를 미사일로 500회 타격', reward: CAT_HIT_REWARD, cur: () => catHits, goal: CAT_HIT_GOAL, done: () => catHitRewarded },
    { key: 'destroy', name: '💥 완전 파괴', desc: '내 캐릭터 체력이 0이 되어 완전 파괴 5회', reward: DESTROY_REWARD, cur: () => destroyCount, goal: DESTROY_GOAL, done: () => destroyRewarded },
    { key: 'gat', name: '🔫 게틀링 파괴자', desc: '상대 게틀링건 10회 파괴', reward: KILL_REWARD, cur: () => gatKills, goal: GAT_KILL_GOAL, done: () => gatKillRewarded },
    { key: 'human', name: '🕺 인간 사냥꾼', desc: '상대 인간 10회 파괴', reward: KILL_REWARD, cur: () => humanKills, goal: HUMAN_KILL_GOAL, done: () => humanKillRewarded },
    { key: 'mecha', name: '🐜🤖 메카 파괴자', desc: '상대 메카 개미(개미형·인간형) 10회 처치', reward: MECHA_KILL_REWARD, cur: () => mechaKills, goal: MECHA_KILL_GOAL, done: () => mechaKillRewarded }
  ]
  function renderAchv() {
    if (!achvListEl) return
    achvListEl.innerHTML = ''
    for (const a of ACHIEVEMENTS) {
      const cur = a.cur(), done = a.done(), pct = Math.min(100, (cur / a.goal) * 100)
      const card = document.createElement('div'); card.className = 'ach' + (done ? ' done' : '')
      card.innerHTML = `<div class="ach-top"><span class="ach-name">${a.name}</span><span class="ach-reward">🎁 🪙 ${a.reward.toLocaleString()}</span></div>` +
        `<p class="ach-desc">${a.desc}</p><div class="ach-bar"><div class="ach-fill" style="width:${pct}%"></div></div>` +
        `<div class="ach-status">${done ? `달성! ${cur} / ${a.goal} ✓ (보상 지급됨)` : `${cur} / ${a.goal}`}</div>`
      achvListEl.appendChild(card)
    }
  }
  function positionAchv() {
    if (wx == null || !achvBtn) return
    achvBtn.classList.remove('hidden')
    achvBtn.style.left = (wx + cellPxW - 30) + 'px'
    achvBtn.style.top = (wy + 2 + 34) + 'px'   // directly below the shop button (30px + gap)
    if (!achvOpenFlag) return
    const W = canvas.clientWidth, H = canvas.clientHeight, pw = 300, ph = Math.min(achvEl.offsetHeight || 340, H - 12)
    let px, py
    if (achvPos) { px = achvPos.x; py = achvPos.y }
    else { px = wx + cellPxW / 2 - pw / 2; py = wy - ph - 6; if (py < 6) py = wy + 40 }
    px = Math.max(6, Math.min(px, W - pw - 6)); py = Math.max(6, Math.min(py, H - ph - 6))
    achvEl.style.left = px + 'px'; achvEl.style.top = py + 'px'
  }
  function openAchv() { achvOpenFlag = true; renderAchv(); achvEl.classList.remove('hidden'); positionAchv(); sendHotzone() }
  function closeAchv() { achvOpenFlag = false; achvEl.classList.add('hidden'); sendHotzone() }
  function toggleAchv() { if (achvOpenFlag) closeAchv(); else openAchv() }
  if (achvBtn) achvBtn.onclick = toggleAchv
  const achvCloseBtn = document.getElementById('achv-close'); if (achvCloseBtn) achvCloseBtn.onclick = closeAchv
  const achvHead = document.getElementById('achv-head')
  let achvDrag = null
  if (achvHead) achvHead.addEventListener('mousedown', (e) => { if (e.target.id === 'achv-close') return; const r = achvEl.getBoundingClientRect(); achvDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.preventDefault() })
  window.addEventListener('mousemove', (e) => { if (achvDrag) { achvPos = { x: e.clientX - achvDrag.dx, y: e.clientY - achvDrag.dy }; positionAchv() } })
  window.addEventListener('mouseup', () => { achvDrag = null })

  // ---------- 🎉 update-notes popup (shows once after updating to a new version) ----------
  // Compares the last-seen version (localStorage) to the current app version; lists every changelog
  // entry between them (first run just shows the current version). Add newest versions at the TOP.
  const CHANGELOG = {
    '0.6.5': [
      '☢ 리틀보이 폭탄 디자인 개선 — 아래 탄두가 뚱뚱한 형태로, 크기 2배',
    ],
    '0.6.4': [
      '☢ 핵미사일 2개가 부딪히면 리틀보이 폭탄으로 합쳐져 땅에 떨어짐 (데미지 30, 폭발 범위 3배)',
      '캐릭터 체력 10초당 1 자연회복',
      '블랙홀이 메카 포탄·에너지포·요격 미사일까지 빨아들임',
      '모든 투사체 피격 연출이 상대 화면에도 동일하게 보이도록',
      '메카 재합체 시 떨어지던 버그 수정 · 이제 커서 위치에서 합체',
      '개미가 공중의 대상은 못 물도록 수정 · 빠른 미사일이 플랫폼 통과하던 버그 수정',
    ],
    '0.6.3': [
      '멀티 일관성 대폭 개선 — 투사체 파괴/폭발이 모든 사람 화면에서 동일하게 보임',
      '미사일·총알 등 투사체 상호 소멸이 확정적으로 처리(한쪽만 감지해도 양쪽 소멸)',
      '메카·인간폼 색상이 내 고양이 털색을 따라감',
      '상대 흐리게 더 투명하게',
    ],
    '0.6.2': [
      '업데이트 노트 팝업 추가 (지금 이 창!)',
    ],
    '0.6.1': [
      '메카·인간 소환체가 상대 투사체와 제대로 충돌 + HP 관통 규칙 통합',
      '요격 미사일: 화면 전체 유도 + 모든 투사체 요격, 크기 30%↑',
      '평화 모드 돔이 날아오는 탄을 막음',
      '메카/인간폼 쉴드 조작 원복 (E 홀드 · 커서 방향)',
      '그물이 메카가 쏘는 포탄·에너지포도 잡음',
      '멀티 끊김(스무딩) 개선 · 메카가 파인 지형 반영',
    ],
    '0.6.0': [
      '개미 메카 & 인간형(건담) 변신 — 에너지포·요격 미사일·판넬 쉴드',
      '평화 모드(무적 돔) · 개발자 전체 무기 잠금 · 상대별 흐리게',
      '육각(벌집) 쉴드 디자인 · 메카 처치 업적(15,000)',
      '플랫폼 체력 30 · 개미 대포 쿨타임 · 프리셋 겹침 방지',
    ],
  }
  const unEl = document.getElementById('update-notes'), unBody = document.getElementById('un-body'), unVer = document.getElementById('un-ver'), unClose = document.getElementById('un-close')
  let updateNotesOpen = false
  function verCmp(a, b) { const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d } return 0 }
  function showUpdateNotes() {
    const cur = String(inputSource.appVersion || '').trim()
    if (!cur || !unEl) return
    const last = localStorage.getItem('lastVersion')
    if (last === cur) return   // already seen this version
    const vers = Object.keys(CHANGELOG).filter((v) => verCmp(v, cur) <= 0 && (last ? verCmp(v, last) > 0 : true)).sort((a, b) => verCmp(b, a))   // first run: show recent history
    localStorage.setItem('lastVersion', cur)   // record even if there's no note, so it won't nag
    if (!vers.length) return
    unVer.textContent = 'v' + cur
    unBody.innerHTML = ''
    for (const v of vers) {
      const block = document.createElement('div'); block.className = 'un-ver-block'
      block.innerHTML = `<span class="un-ver-tag">v${v}</span><ul>${CHANGELOG[v].map((s) => `<li>${s}</li>`).join('')}</ul>`
      unBody.appendChild(block)
    }
    updateNotesOpen = true; unEl.classList.remove('hidden'); sendHotzone()
  }
  if (unClose) unClose.onclick = () => { updateNotesOpen = false; if (unEl) unEl.classList.add('hidden'); sendHotzone() }
  setTimeout(showUpdateNotes, 1200)   // after the widget is placed so the popup is clickable

  // ---------- 🖌️ HOST platform tool: brush strokes that become floor (HP 30) ----------
  // Multiplayer: the HOST is authoritative. It broadcasts the platform list (t:'platforms') and the
  // live stroke (t:'platdraw'); peers render + collide against them, and report hits via t:'plat-hit'.
  const PLAT_HP = 30
  const platforms = []                 // { id, pts:[{x,y}], hp }
  let platformMode = false, curStroke = null
  let nextPlatId = 1
  let remoteDrawStroke = null           // peer: the host's in-progress stroke (ghost preview)
  let platformsDirty = false            // host: platform list STRUCTURE changed (add/remove) → full rebroadcast
  const platHpDirty = new Set()         // host: platform ids whose HP changed → lightweight delta only
  let platformsAreRemote = false        // peer: `platforms` came from the host (clear on disconnect)
  let lastPlatDraw = 0, wasDrawing = false
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
  // swept check so a FAST projectile can't tunnel through a thin platform between frames:
  // sample the path prev→cur every ~5px and return the first platform hit (with its point)
  function platformSweep(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.ceil(dist / (5 * view.scale)))
    for (let k = 1; k <= steps; k++) { const t = k / steps, hx = x0 + dx * t, hy = y0 + dy * t; const pl = hitPlatform(hx, hy); if (pl) return { pl, hx, hy } }
    return null
  }
  function damagePlatform(pl, dmg) {
    if (connected() && !isDev) { if (net) net.send(JSON.stringify({ t: 'plat-hit', pid: pl.id, dmg })); return }   // the DEV (drawer) is authoritative
    pl.hp -= dmg
    if (pl.hp <= 0) { const i = platforms.indexOf(pl); if (i >= 0) platforms.splice(i, 1); platHpDirty.delete(pl.id); platformsDirty = true }   // removed → full list
    else platHpDirty.add(pl.id)   // just HP → tiny delta (no geometry resend)
  }
  // serialize/rebuild platforms in normalized (0..1) coords so peers on any monitor size match
  function serializePlatforms() {
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1
    return platforms.map((pl) => ({ id: pl.id, hp: pl.hp, p: pl.pts.flatMap((pt) => [+(pt.x / W).toFixed(4), +(pt.y / H).toFixed(4)]) }))
  }
  function strokeFromFlat(p) {
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1, pts = []
    for (let i = 0; i + 1 < p.length; i += 2) pts.push({ x: p[i] * W, y: p[i + 1] * H })
    return pts
  }
  // y of the platform surface directly under x that an entity should stand on. Robust on hand-drawn,
  // uneven strokes: instead of requiring a pixel-perfect "descending onto it", we snap to the highest
  // surface within a step tolerance both above (step up small rises) and below (land from a fall) the
  // feet — so walking along a wavy line no longer falls through where the line rises ahead.
  function platformFloorAt(x, feetY, prevY) {
    const STEP = 14 * view.scale
    let best = null
    for (const pl of platforms) {
      const p = pl.pts
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i]
        if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue
        const tt = (b.x - a.x) ? (x - a.x) / (b.x - a.x) : 0
        const segY = a.y + (b.y - a.y) * tt
        // land if the feet are near the surface (fell onto it OR stepping up a small rise)
        if (feetY >= segY - STEP && prevY <= segY + STEP) { if (best == null || segY < best) best = segY }
      }
    }
    return best
  }
  function drawPlatforms() {
    const ghost = curStroke || remoteDrawStroke
    const strokes = ghost ? platforms.concat([ghost]) : platforms
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
  function platformAllowed() { return isDev }   // developer-only tool
  function togglePlatformMode() {
    if (!platformAllowed()) { showToast('🖌️ 플랫폼 그리기는 개발자 전용입니다'); return }
    platformMode = !platformMode; curStroke = null
    showToast(platformMode ? '🖌️ 플랫폼 그리기 ON — 왼쪽 클릭 드래그로 그리기' : '플랫폼 그리기 OFF')
    sendHotzone()
  }
  function clearPlatforms() {   // dev: wipe all platforms (synced to peers)
    if (!isDev) return
    platforms.length = 0; curStroke = null; platHpDirty.clear(); platformsDirty = true
    showToast('🗑️ 플랫폼 전체 삭제')
  }

  // ---------- 🕊️ PEACE MODE (developer toggle on the character) ----------
  // Clears every summon + restores the taskbar, and LOCKS all weapons for everyone (dev included).
  // Broadcast to the room; while on, each character shows a 🕊️ badge so peers know why nothing fires.
  let peaceMode = false
  const peaceBtn = document.getElementById('btn-peace')
  function clearMySummons() {
    projectiles.length = 0; ants.length = 0; gbullets.length = 0; hbullets.length = 0; bolts.length = 0
    energyShots.length = 0; interceptors.length = 0; mechaShells.length = 0
    if (me.gatActive) setGat(false)
    if (me.humanActive) removeHuman()
    if (me.mechaActive) removeMecha()
    me.mechaMerging = false
    me.netActive = false; me.netAiming = false; me.netPulling = false; me.netCaught = []
    me.bhUntil = 0; me.shieldUntil = 0
  }
  function setPeace(on, fromRemote) {
    peaceMode = !!on
    if (peaceMode) { clearMySummons(); if (!fromRemote) resetTaskbarDig(true) }   // dev's restore broadcasts digreset to all
    if (!fromRemote && connected() && net) net.send(JSON.stringify({ t: 'peace', on: peaceMode ? 1 : 0 }))
    if (peaceBtn) { peaceBtn.classList.toggle('on', peaceMode); peaceBtn.textContent = peaceMode ? '🔓' : '🔒' }
    showToast(peaceMode ? '🔒 전체 무기 잠금 ON — 모두 무기 사용 불가 · 소환체/작업표시줄 초기화' : '전체 무기 잠금 OFF')
  }
  function togglePeace() { if (!isDev) return; setPeace(!peaceMode, false) }
  if (peaceBtn) peaceBtn.onclick = togglePeace
  function positionPeace() {
    if (wx == null || !peaceBtn) return
    if (!isDev) { peaceBtn.classList.add('hidden'); return }   // developer-only control
    peaceBtn.classList.remove('hidden')
    peaceBtn.style.left = (wx + cellPxW - 30) + 'px'
    peaceBtn.style.top = (wy + 2 + 68) + 'px'   // directly below the achievements button
  }
  // 👁 dim opponents — PER-PEER: each opponent gets a small 👁 button by their head; clicking it
  // fades THAT player's character + weapons on my screen only. (No button on my own cat.)
  const DIM_A = 0.15
  const dimmedPeers = new Set()          // peer ids I've chosen to fade
  let peerDimBtns = []                   // per-frame [{ pid, x, y, r }] hit targets (also fed to the hotzone)
  function peerAlpha(pid) { return dimmedPeers.has(pid) ? DIM_A : 1 }
  function toggleDimPeer(pid) { if (dimmedPeers.has(pid)) dimmedPeers.delete(pid); else dimmedPeers.add(pid) }
  function drawPeerDimButtons(now) {
    peerDimBtns = []
    const R = 12 * view.scale
    for (let i = 0; i < catPos.length; i++) {
      const cat = allRef[i]; if (!cat || cat.id === 'me') continue   // opponents only
      const c = catPos[i]; if (!c) continue
      const bx = c.x + 34 * view.scale, by = c.y - 34 * view.scale   // up-right of the peer's head
      peerDimBtns.push({ pid: cat.id, x: bx, y: by, r: R })
      const dimmed = dimmedPeers.has(cat.id)
      ctx.save(); ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2)
      ctx.fillStyle = dimmed ? 'rgba(58,90,134,0.95)' : 'rgba(42,42,52,0.9)'; ctx.fill()
      ctx.strokeStyle = dimmed ? 'rgba(120,180,255,0.9)' : 'rgba(200,205,220,0.5)'; ctx.lineWidth = 1.5 * view.scale; ctx.stroke()
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${13 * view.scale}px sans-serif`
      ctx.fillText(dimmed ? '🚫' : '👁', bx, by + 0.5 * view.scale)
      ctx.restore()
    }
  }
  function hitPeerDimButton(x, y) { for (const b of peerDimBtns) if (Math.hypot(x - b.x, y - b.y) <= b.r + 3) return b; return null }
  // 🕊️ SAFE MODE (settings toggle): a 9999-HP honeycomb dome wraps my cat (invincible), but I can't
  // use weapons while it's on — a "leave it running safely" mode. Broadcast so peers see the dome.
  me.safeMode = localStorage.getItem('safeMode') === '1'
  function setSafeMode(on) {
    me.safeMode = !!on; localStorage.setItem('safeMode', on ? '1' : '0')
    if (me.safeMode) clearMySummons()   // drop my weapons when entering the pacifist dome
    showToast(me.safeMode ? '🕊️ 평화 모드 — 무적 쉴드 ON (무기 사용 불가)' : '평화 모드 OFF')
    pushState()
  }
  function weaponsLocked() { return peaceMode || me.safeMode }   // dev whole-room lock OR my personal safe mode
  function drawSafeDomes(now) {   // honeycomb dome around me + any peer in safe mode
    for (let i = 0; i < catPos.length; i++) {
      const cat = allRef[i], c = catPos[i]; if (!c) continue
      const on = cat.id === 'me' ? me.safeMode : !!cat.safe
      if (!on) continue
      const r = 108 * view.scale, cyb = c.y + 30 * view.scale   // snug around the cat (base at its feet)
      ctx.save(); if (cat.id !== 'me') ctx.globalAlpha = peerAlpha(cat.id)
      drawHexDome(c.x, cyb, r, 1, now, true)
      ctx.restore()
    }
  }
  function drawPeaceBadges(now) {   // 🕊️ above every character while peace mode locks weapons
    const s = view.scale
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    for (const c of catPos) {
      if (!c) continue
      const by = c.y - 64 * s + Math.sin(now / 400 + c.x * 0.01) * 3 * s
      ctx.globalAlpha = 0.9; ctx.fillStyle = 'rgba(120,40,40,0.85)'
      ctx.beginPath(); ctx.roundRect(c.x - 16 * s, by - 12 * s, 32 * s, 23 * s, 8 * s); ctx.fill()
      ctx.globalAlpha = 1; ctx.font = `${16 * s}px sans-serif`; ctx.fillText('🔒', c.x, by)
    }
    ctx.restore()
  }

  let net = null, sendBudget = 0, budgetRefill = performance.now()
  inputSource.onInput((kind) => {
    pulse(me, kind)
    me.lastInput = performance.now(); me.away = false   // any input clears 자리비움
    if (me.hp <= 0) {                    // 완전 파괴 패널티: 입력 2번당 카운트 +1
      penaltyAcc++
      if (penaltyAcc % 2 === 0) { tapCount++; counterDirty = true; floatPenalty() }
    } else { tapCount++; counterDirty = true }
    renderCounter()
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
  // When the OWNER destroys one of its projectiles, tell everyone so peers remove the copy AND show
  // the SAME explosion at the SAME spot immediately (no inferring removal from a silent position list).
  function bcBoom(chan, id, x, y, power) {
    if (id == null || !connected() || !net) return
    net.send(JSON.stringify({ t: 'boom', chan, eid: id, nx: +(x / canvas.clientWidth).toFixed(4), ny: +(y / canvas.clientHeight).toFixed(4), pw: power || 1 }))
  }

  function profileMsg() {
    return { name: me.name, animal: me.animal, skin: me.skin, pattern: me.pattern, hat: me.hat, shape: shapeStr(me.shape) }
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
        if (isDev && platforms.length) platformsDirty = true   // re-send platforms so late joiners see them
        const seen = new Set()
        for (const p of msg.peers) {
          if (p.id === me.netId) continue
          seen.add(p.id)
          const ex = peers.get(p.id)
          if (ex) { ex.name = p.name; ex.tint = p.skin || 'default'; ex.pattern = p.pattern || 'solid'; ex.hat = p.hat || 'none'; ex.shape = parseShape(p.shape) }
          else peers.set(p.id, { id: p.id, name: p.name, animal: 'cat', tint: p.skin || 'default', pattern: p.pattern || 'solid', hat: p.hat || 'none', shape: parseShape(p.shape), feat: {}, ...newAnimState() })
        }
        for (const id of [...peers.keys()]) if (!seen.has(id)) peers.delete(id)
        // drop any remote entities belonging to peers who left (no lingering state)
        for (const m of [remoteMissiles, remoteShields, remoteAnts, remoteBlackholes, remoteGatlings, remoteGBullets, remoteHumans, remoteHbullets, remoteNets, remoteMechas, remoteMShells])
          for (const id of [...m.keys()]) if (!seen.has(id)) m.delete(id)
        pushState()   // reflect the new count in the settings window
      }
      else if (msg.t === 'pos') { const p = peers.get(msg.id); if (p) { p.nx = msg.nx; p.ny = msg.ny; p.taps = msg.taps; if (msg.hp != null) p.hp = msg.hp; p.away = !!msg.away; p.safe = !!msg.safe } }
      else if (msg.t === 'pulse') { const p = peers.get(msg.id); if (p) pulse(p, msg.kind) }
      else if (msg.t === 'chat') { const p = peers.get(msg.id); if (p) showBubble(p, String(msg.text)) }
      else if (msg.t === 'throw') { const src = targetOf(msg.id); launch('me', src ? { from: src } : {}) }
      else if (msg.t === 'missiles') { mergeRemote(remoteMissiles, msg.id, msg.list, 'nx', 'ny') }
      else if (msg.t === 'hit') {
        if (msg.target === me.netId) { me.hitUntil = performance.now() + 1000 + Math.min((msg.power || 1) - 1, 5) * 200; if (msg.shock) me.shockUntil = performance.now() + 650; damageMyCat(msg.power || 1, msg.id) }
        else { const tp = peers.get(msg.target); if (tp) { tp.hitUntil = performance.now() + 800 + Math.min((msg.power || 1) - 1, 5) * 100; if (msg.shock) tp.shockUntil = performance.now() + 650; const c = peerCatCenter(tp); if (c) addEffect(c.x, c.y, Math.min(msg.power || 1, 3)) } }   // 3rd-party peers see the hit too
      }
      else if (msg.t === 'bolt') { const bx = (msg.nx || 0) * canvas.clientWidth, H2 = canvas.clientHeight; spawnBolt(bx, (msg.nyTop || 0) * H2, msg.nyBot != null ? msg.nyBot * H2 : boltGroundY(bx), msg.level || 1, false) }
      else if (msg.t === 'platforms') {   // the dev's authoritative list → replace mine (non-devs)
        if (!isDev) { platforms.length = 0; for (const it of (msg.list || [])) platforms.push({ id: it.id, hp: it.hp, pts: strokeFromFlat(it.p || []) }); platformsAreRemote = true }
      }
      else if (msg.t === 'platdraw') { if (!isDev) remoteDrawStroke = (msg.p && msg.p.length) ? { hp: PLAT_HP, pts: strokeFromFlat(msg.p) } : null }
      else if (msg.t === 'plathp') { if (!isDev && Array.isArray(msg.ups)) for (const u of msg.ups) { const pl = platforms.find((p) => p.id === u.id); if (pl) pl.hp = u.hp } }
      else if (msg.t === 'plat-hit') { if (isDev) { const pl = platforms.find((p) => p.id === msg.pid); if (pl) damagePlatform(pl, msg.dmg || 1) } }
      else if (msg.t === 'shield') {
        if (msg.ttl > 0) remoteShields.set(msg.id, { until: performance.now() + msg.ttl, angle: msg.angle || 0, hp: msg.hp != null ? msg.hp : SHIELD_HP, max: msg.max || SHIELD_HP })
        else { if (msg.broke) remoteBreaks.push(msg.id); remoteShields.delete(msg.id) }
      }
      else if (msg.t === 'shield-hit') { if (msg.target === me.netId) hitMyShield(msg.power || 1) }
      else if (msg.t === 'ants') { mergeRemote(remoteAnts, msg.id, msg.list, 'nx', 'nx') }
      else if (msg.t === 'ant-hit') { if (msg.target === me.netId) { const a = ants.find((x) => x.id === msg.ant); if (a && !a.dead) { antTakeDmg(a, msg.dmg || 1); if (a.dead) creditKill('ant', msg.id) } } }
      else if (msg.t === 'blackhole') {
        if (msg.ttl > 0) remoteBlackholes.set(msg.id, { nx: msg.nx, ny: msg.ny, until: performance.now() + msg.ttl })
        else remoteBlackholes.delete(msg.id)
      }
      else if (msg.t === 'dig') { carveTaskbar((msg.nx || 0) * canvas.clientWidth, msg.power || 1, false) }  // shared taskbar damage
      else if (msg.t === 'digreset') { resetTaskbarDig(false) }   // someone restored → everyone restores
      else if (msg.t === 'peace') { setPeace(!!msg.on, true) }    // dev toggled peace mode → lock/unlock weapons for me too
      else if (msg.t === 'gatling') {
        if (msg.active) remoteGatlings.set(msg.id, { nx: msg.nx, ny: msg.ny, hp: msg.hp, ang: msg.ang })
        else remoteGatlings.delete(msg.id)
      }
      else if (msg.t === 'gbullets') { mergeRemote(remoteGBullets, msg.id, msg.list, 'nx', 'ny') }
      else if (msg.t === 'gat-hit') { if (msg.target === me.netId) damageMyGatling(msg.dmg || 1, msg.id) }
      else if (msg.t === 'mecha-hit') { if (msg.target === me.netId && me.mechaActive) mechaTakeDmg(msg.dmg || 1, performance.now(), msg.id) }
      else if (msg.t === 'human-hit') {
        if (msg.target === me.netId && me.humanActive) {
          const nowP = performance.now(), hs = view.scale * HUMAN_SCALE
          const scx = me.humanX, scy = me.humanY - 34 * hs * 0.7, shieldAng = Math.atan2(cursor.y - scy, cursor.x - scx)
          const hx = (msg.hx || 0) * canvas.clientWidth, hy = (msg.hy || 0) * canvas.clientHeight
          const blocked = humanKeys.has('e') && angDiff(Math.atan2(hy - scy, hx - scx), shieldAng) <= SHIELD_SPAN / 2   // cursor shield on the hit side
          if (blocked) { me.humanHitCd = nowP + 150; spawnSpark(scx + Math.cos(shieldAng) * 30 * hs, scy + Math.sin(shieldAng) * 30 * hs) }
          else humanTakeDmg(msg.dmg || 1, nowP, msg.id)
        }
      }
      else if (msg.t === 'kill') {
        if (msg.by === me.netId) {
          if (msg.kind === 'cat') rewardCatDestroy()
          else { rewardKill(msg.kind, msg.amt); if (msg.kind === 'gat') addGatKill(); else if (msg.kind === 'human') addHumanKill(); else if (msg.kind === 'mecha' || msg.kind === 'mechahuman') addMechaKill() }
        }
      }
      else if (msg.t === 'human') {
        if (msg.active) remoteHumans.set(msg.id, { nx: msg.nx, ny: msg.ny, hp: msg.hp, weapon: msg.weapon || '', face: msg.face || 1 })
        else remoteHumans.delete(msg.id)
      }
      else if (msg.t === 'mecha') {
        if (msg.active) remoteMechas.set(msg.id, { nx: msg.nx, ny: msg.ny, hp: msg.hp, face: msg.face || 1, shield: msg.shield || 0, form: msg.form || 0, thr: msg.thr || 0, ch: msg.ch || 0, chg: msg.chg || 0, sdep: msg.sdep || 0, snx: msg.snx, sny: msg.sny, sang: msg.sang || 0 })
        else remoteMechas.delete(msg.id)
      }
      else if (msg.t === 'mshells') { mergeRemote(remoteMShells, msg.id, msg.list, 'nx', 'ny') }
      else if (msg.t === 'net') {
        if (msg.active) {
          const r = remoteNets.get(msg.id) || {}
          r.ph = msg.ph; r.ax = msg.ax; r.ay = msg.ay; r.bx = msg.bx; r.by = msg.by; r.sp = msg.sp; r.items = msg.items || []; r.n = msg.n || 0; r.ts = performance.now()
          if (r.sbx == null) { r.sbx = msg.bx; r.sby = msg.by; r.sax = msg.ax; r.say = msg.ay }   // seed smoothed positions
          remoteNets.set(msg.id, r)
        } else remoteNets.delete(msg.id)
      }
      else if (msg.t === 'healall') { resetCatHp(); showToast('🩹 개발자가 전체 체력을 회복했습니다'); pushState() }
      else if (msg.t === 'setcur') {   // dev set my currency (multiplayer)
        if (msg.target === me.netId) {
          if (typeof msg.count === 'number') { tapCount = Math.max(0, msg.count | 0); counterDirty = true; renderCounter() }
          if (typeof msg.gems === 'number' && window.BattleGacha) window.BattleGacha.setGems(msg.gems)
          if (typeof msg.mat === 'number' && window.BattleGacha) window.BattleGacha.setMaterials(msg.mat)
          showToast('🛠️ 개발자가 재화를 설정했습니다')
        }
      }
      else if (msg.t === 'capture') {   // a peer's net grabbed one of MY collidables → remove it here
        if (msg.target === me.netId) {
          if (msg.kind === 'mshell') { for (const arr of [mechaShells, energyShots, interceptors]) { const i = arr.findIndex((o) => o.id === msg.eid); if (i >= 0) { arr.splice(i, 1); break } } }
          else {
            let arr = null, key = 'id'
            if (msg.kind === 'missile') { arr = projectiles; key = 'mid' }
            else if (msg.kind === 'gbullet') arr = gbullets
            else if (msg.kind === 'ant') arr = ants
            else arr = hbullets   // adogen / wave / hbullet
            if (arr) { const i = arr.findIndex((o) => o[key] === msg.eid); if (i >= 0) arr.splice(i, 1) }
          }
        }
      }
      else if (msg.t === 'col-dmg') {   // unified: an opponent's collidable damaged me → apply attrition here
        if (msg.target === me.netId) {
          const dmg = msg.dmg || 1, eid = msg.eid
          // owner applies attrition to ITS OWN projectile; if it dies, broadcast a boom so everyone agrees
          const dec = (arr, key, chan) => { const idx = arr.findIndex((o) => o[key] === eid); if (idx < 0) return; const o = arr[idx]; if (o.power != null) o.power -= dmg; else if (o.hp != null) o.hp -= dmg; else { bcBoom(chan, o[key], o.x, o.y, 1); arr.splice(idx, 1); return }; if ((o.power != null ? o.power : o.hp) <= 0) { if (o.x != null) addEffect(o.x, o.y, 1); bcBoom(chan, o[key], o.x, o.y, o.power || o.hp || 1); arr.splice(idx, 1) } }
          if (msg.kind === 'missile') dec(projectiles, 'mid', 'missile')
          else if (msg.kind === 'gbullet') { const j = gbullets.findIndex((o) => o.id === eid); if (j >= 0) { const o = gbullets[j]; bcBoom('gbullet', o.id, o.x, o.y, 1); gbullets.splice(j, 1) } }
          else if (msg.kind === 'hbullet') dec(hbullets, 'id', 'hbullet')
          else if (msg.kind === 'mshell') { if (mechaShells.some((o) => o.id === eid)) dec(mechaShells, 'id', 'mshell'); else if (energyShots.some((o) => o.id === eid)) dec(energyShots, 'id', 'mshell'); else dec(interceptors, 'id', 'mshell') }
        }
      }
      else if (msg.t === 'boom') {   // owner destroyed a projectile → drop the copy + show the identical blast
        const W = canvas.clientWidth, H = canvas.clientHeight
        const map = { missile: remoteMissiles, gbullet: remoteGBullets, hbullet: remoteHbullets, mshell: remoteMShells }[msg.chan]
        if (map) { const rec = map.get(msg.id); if (rec && rec.items) rec.items.delete(msg.eid) }
        addEffect(msg.nx * W, msg.ny * H, msg.pw || 1); spawnSpark(msg.nx * W, msg.ny * H)
      }
      else if (msg.t === 'littleboy') { spawnLittleBoy(msg.nx * canvas.clientWidth, msg.ny * canvas.clientHeight, false) }   // peer's authoritative fused bomb — visual only
      else if (msg.t === 'hbullets') { mergeRemote(remoteHbullets, msg.id, msg.list, 'nx', 'ny') }
      else if (msg.t === 'error' && msg.reason === 'room_full') { setStatus('방이 가득 찼어요'); ws.close() }
    }
    ws.onclose = () => { if (net === ws) { net = null; peers.clear(); remoteAnts.clear(); remoteBlackholes.clear(); remoteGatlings.clear(); remoteGBullets.clear(); remoteHumans.clear(); remoteHbullets.clear(); remoteNets.clear(); remoteMechas.clear(); remoteMShells.clear(); remoteDrawStroke = null; if (platformsAreRemote) { platforms.length = 0; platformsAreRemote = false }; me.netId = undefined; roomCount = 0; setStatus('오프라인 — 혼자 연주 중') } }
    ws.onerror = () => setStatus('접속 실패')
  }
  function disconnect() {
    if (net) { const ws = net; net = null; ws.close() }
    peers.clear(); remoteMissiles.clear(); remoteShields.clear(); remoteAnts.clear(); remoteBlackholes.clear(); remoteGatlings.clear(); remoteGBullets.clear(); remoteNets.clear(); me.netId = undefined; roomCount = 0
    remoteDrawStroke = null; if (platformsAreRemote) { platforms.length = 0; platformsAreRemote = false }
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

  // ---------- ⚔ 무기 설정 팝업 (오버레이 단축키 3슬롯) — 배틀 UI 룩(.bg-back) 재사용 ----------
  function openWeaponLoadout() {
    const back = document.createElement('div'); back.className = 'bg-back'
    const card = document.createElement('div'); card.className = 'bg-card'; card.style.width = 'min(360px,92vw)'; back.appendChild(card)
    const close = () => { back.remove(); sendHotzone() }
    back.addEventListener('mousedown', (ev) => { if (ev.target === back) close() })
    card.innerHTML = `<div class="bg-head"><div class="bg-title">⚔ 무기 설정</div><button class="bg-x">✕</button></div>` +
      `<div class="bg-sub" style="margin-bottom:10px">오버레이(재미용) 단축키로 쓸 무기를 고르세요. 🔒 = 미획득(가챠로 획득).</div>`
    card.querySelector('.bg-x').onclick = close
    const keys = ['Alt+Z', 'Alt+X', 'Alt+C']
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px'
      const lb = document.createElement('span'); lb.textContent = keys[i]; lb.style.cssText = 'width:56px;color:#aeb4c0;font-size:13px'
      const sel = document.createElement('select'); sel.style.cssText = 'flex:1;padding:7px;border-radius:8px;background:#242a36;color:#e8ebf0;border:1px solid #3a4150;font-size:14px'
      for (const id of SLOT_CHOICES) { const opt = document.createElement('option'); opt.value = id; opt.textContent = (weaponUsable(id) ? '' : '🔒 ') + (WEAPONS[id] || id); sel.appendChild(opt) }
      sel.value = me.slots[i] || 'none'
      sel.onchange = () => { const v = sel.value; if (!weaponUsable(v)) { sel.value = me.slots[i] || 'none'; return } me.slots[i] = v; localStorage.setItem('slots', JSON.stringify(me.slots)); pushState() }
      row.append(lb, sel); card.appendChild(row)
    }
    document.body.appendChild(back); sendHotzone()
  }

  // ---------- 통합 햄버거 메뉴 (배틀 UI + 기존 기능 브리지) ----------
  const menuBtn = document.getElementById('btn-menu')
  if (window.BattleGachaUI && window.BattleGacha) {
    window.BattleGachaUI.setCountBridge({ get: () => tapCount, spend: (n) => { spendCoins(n) }, set: (n) => { tapCount = Math.max(0, n | 0); counterDirty = true; renderCounter() } })
    window.BattleGachaUI.setDev(isDev)
    window.BattleGachaUI.setDevContext({
      peers: () => [...peers.values()].map((p) => ({ id: p.id, name: p.name })),
      setPeer: (id, cur) => { if (net && connected()) net.send(JSON.stringify({ t: 'setcur', target: id, count: cur.count, gems: cur.gems, mat: cur.mat })) },
    })
    window.BattleGachaUI.setHpBridge({
      get: () => me.hp, max: CAT_HP, cost: 500,
      heal: () => { if (me.hp >= CAT_HP || !spendCoins(500)) return false; resetCatHp(); pushState(); return true },
    })
    window.BattleGachaUI.setBridges({
      weapon: () => openWeaponLoadout(),         // ⚔ 무기 설정: 전용 팝업(오버레이 단축키 슬롯)
      achievements: () => openAchv(),            // 🏆 업적: 기존 팝업
      settings: () => inputSource.openSettings(), // ⚙ 설정: 기존 설정 창
    })
    window.__bgModalChanged = () => sendHotzone()   // 배틀 팝업 열림/닫힘 → hotzone 갱신
    menuBtn.onclick = () => { window.BattleGachaUI.openMenu(); sendHotzone() }
    // 떠있던 개별 버튼 숨김 — 전부 메뉴로 통합 (인라인 display 로 이후 재노출 방지)
    for (const b of [shopBtn, achvBtn, peaceBtn]) if (b) b.style.display = 'none'
  } else {
    menuBtn.onclick = () => inputSource.openSettings()
  }

  function pushState() {
    inputSource.pushState({
      name: me.name, skin: me.skin, pattern: me.pattern, hat: me.hat, shape: Object.assign({}, me.shape), slots: me.slots,
      server: localStorage.getItem('server') || 'ws://localhost:8787',
      room: localStorage.getItem('room') || '',
      connected: connected(), status, editing, safeMode: me.safeMode,
      count: connected() ? roomCount : 0, max: roomMax,
      antKills, antGoal: ANT_KILL_GOAL, isHost, isDev, bhAvailable: bhAvailable(), keybinds,
      catHits, catHitGoal: CAT_HIT_GOAL, catHitReward: CAT_HIT_REWARD, catHitRewarded,
      destroys: destroyCount, destroyGoal: DESTROY_GOAL, destroyReward: DESTROY_REWARD, destroyRewarded, hp: me.hp,
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
      // body-part shapes (character customization)
      if (msg.shape && typeof msg.shape === 'object') {
        for (const k of SHAPE_KEYS) if (typeof msg.shape[k] === 'string') me.shape[k] = msg.shape[k]
        localStorage.setItem('catShape', JSON.stringify(me.shape))
      }
      sendUpdate(); pushState()
    }
    else if (msg.t === 'connect') { connect(msg.url, msg.room) }
    else if (msg.t === 'disconnect') { disconnect(); setStatus('오프라인 — 혼자 연주 중') }
    else if (msg.t === 'edit') { setEditing(!!msg.on) }
    else if (msg.t === 'safemode') { setSafeMode(!!msg.on) }
    else if (msg.t === 'chat') { openChat() }
    else if (msg.t === 'boost') { if (!weaponsLocked() && !platformMode && !me.netAiming && !me.netActive) boostMissiles() }   // net owns the click while aiming/held
    else if (msg.t === 'lmb') {
      const was = lmbDown; lmbDown = !!msg.down
      if (me.netActive) { if (lmbDown && !was) releaseNet() }              // held net → click releases (fling)
      else if (me.netAiming) {                                            // bow aim: press = pull, release = fire
        if (lmbDown && !was) startNetPull()
        else if (!lmbDown && was) fireNet()
      }
      else if (platformMode) {   // drawing a platform stroke while the button is held
        if (lmbDown && !was) curStroke = { id: nextPlatId++, pts: [{ x: cursor.x, y: cursor.y }], hp: PLAT_HP }
        else if (!lmbDown && was && curStroke) { if (curStroke.pts.length >= 2) { platforms.push(curStroke); if (platforms.length > 40) platforms.shift(); platformsDirty = true } curStroke = null }
      }
    }
    else if (msg.t === 'platform-mode') { togglePlatformMode() }
    else if (msg.t === 'platform-clear') { clearPlatforms() }
    else if (msg.t === 'heal-all') {   // dev: restore every connected player's cat HP
      if (isDev) { resetCatHp(); showToast('🩹 전체 체력 회복'); if (connected() && net) net.send(JSON.stringify({ t: 'healall' })); pushState() }
    }
    else if (msg.t === 'keybinds') {
      if (msg.keys && msg.keys.length) {
        keybinds = { mod: msg.mod || 'alt', keys: msg.keys.slice(0, 3) }
        localStorage.setItem('keybinds', JSON.stringify(keybinds))
        if (inputSource.setKeybinds) inputSource.setKeybinds(keybinds)
        pushState()
      }
    }
    else if (msg.t === 'human-key') {
      if (msg.down) {
        if (!humanKeys.has(msg.key)) {
          humanKeys.add(msg.key)
          if (msg.key === 'q') {
            if (weaponsLocked()) { /* weapons locked */ }
            else if (me.humanActive) humanAttack()                              // human attack
            else if (me.mechaActive) { me.mechaCharging = true; me.mechaChargeStart = performance.now(); me.mechaCharge = 0 }   // mecha cannon / energy charge
            else if (!me.gatActive && antMax() >= 10 && ants.filter((a) => !a.dead && !a.falling).length >= 10) mergeAntsToMecha()   // 10 ants → merge
          } else if (msg.key === 'r' && !weaponsLocked() && me.mechaActive && (me.mechaForm || 0) >= 0.5 && !me.mechaTransforming) fireInterceptors(performance.now())   // human-form R: interceptors
        }
      } else {
        humanKeys.delete(msg.key)
        if (msg.key === 'q') { if (me.humanActive) humanRelease(); else if (me.mechaActive && me.mechaCharging) { me.mechaCharging = false; const t = performance.now(); if (weaponsLocked()) { /* locked */ } else if ((me.mechaForm || 0) >= 0.5) fireEnergyCannon(t); else if (t >= (me.mechaShellCd || 0)) { fireMechaShell(t); me.mechaShellCd = t + MSHELL_CD } } }
      }
    }
    else if (msg.t === 'mecha-transform') { if (me.mechaActive) startMechaTransform(performance.now()) }
    else if (msg.t === 'fire-missile') { fireWeapon('missile') }
    else if (msg.t === 'fire-slot') {
      const id = me.slots[(msg.slot || 1) - 1] || 'none'
      if (id === 'lightning') { if (msg.down === false) lightningRelease(); else lightningPress() }
      else if (msg.down !== false) fireWeapon(id)   // other weapons fire once on press; ignore key-up
    }
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
    updateToastTimer = setTimeout(() => updateToast.classList.add('hidden'), ms || 2400)   // quick auto-dismiss
  }
  function showUpdateToast(version) {
    showToast(`🎉 새 버전${version ? ' v' + version : ''} 준비됨 · 앱 재시작 시 적용`, 8000)   // keep the update notice up longer
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
  // missile cap (also the merge cap): base 5, +1 per shop upgrade → up to 10 (a fully merged 10 = nuke)
  let missileUp = parseInt(localStorage.getItem('missileUp') || '0', 10) || 0   // 0..5 purchased upgrades
  function missileMax() { return 10 }   // 획득=디폴트: 최대 10(합체 10 = ☢핵)
  let antUp = parseInt(localStorage.getItem('antUp') || '0', 10) || 0            // 0..5 → ant cap 5..10
  function antMax() { return 10 }        // 획득=디폴트: 최대 10마리
  let lightningUp = parseInt(localStorage.getItem('lightningUp') || '0', 10) || 0 // 0..5 → charge ceiling (0 = no charge)
  function lightningMax() { return 5 }   // 획득=디폴트: 최대 5단계 충전
  const MISSILE_LIFE = 14000  // how long a missile lives before fizzling out (ms)

  // fire a missile from the bottom-left corner that then chases the mouse cursor and
  // explodes on contact with any cat. Capped at MAX_MISSILES concurrently — once one
  // explodes or fizzles, you can fire another.
  function fireHoming() {
    // count by total POWER (a merged power-5 missile counts as 5), not by missile count
    let activePower = 0
    for (const p of projectiles) if (p.homing) activePower += p.power
    if (activePower >= missileMax()) return
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
    if (weaponsLocked()) { showToast(me.safeMode ? '🕊️ 평화 모드 — 무기 사용 불가' : '🔒 무기 잠금 중'); return }
    if (!weaponUsable(id)) { showToast(`🛒 ${WEAPONS[id] || '이 무기'}은(는) 상점에서 먼저 구매하세요`); return }
    if (id === 'missile') fireHoming()
    else if (id === 'shield') activateShield()
    else if (id === 'ant') summonAnt()
    else if (id === 'blackhole') activateBlackhole()
    else if (id === 'gatling') deployGatling()
    else if (id === 'human') deployHuman()
    else if (id === 'lightning') lightningPress()   // (release handled via fire-slot key-up)
    else if (id === 'net') toggleNetAim()
    // future: else if (id === 'rock') fireRock() ...
  }

  // ---------- ⚡ 낙뢰 (lightning) — strike from the cursor down to the taskbar; hold to charge (1..5) ----------
  const bolts = []                 // { x, yTop, yBot, level, born, life, seed, mine }
  const LIGHT_CHARGE_MS = 2850     // hold this long to reach max level (3× slower → weightier charge)
  const LIGHT_CD = 500             // 0.5s cooldown between strikes
  let nextBoltSeed = 1
  // color ramps electric-yellow (lvl1) → violet (lvl5)
  function lightningColor(level, a) {
    const t = Math.min(1, Math.max(0, (level - 1) / 4))
    const r = Math.round(255 - t * 100), g = Math.round(238 - t * 175), b = Math.round(150 + t * 105)
    return `rgba(${r},${g},${b},${a == null ? 1 : a})`
  }
  function boltGroundY(x) { const tb = taskbarRect(); return tb ? tb.top + carveDepthAt(x) : (canvas.clientHeight - 4) }   // strike the DUG floor (into pits / through holes), not the original surface
  function lightningPress() {
    if (!weaponUsable('lightning')) { showToast('🛒 ⚡ 낙뢰은(는) 상점에서 먼저 구매하세요'); return }
    if (performance.now() < (me.lightCd || 0)) return                     // 0.5s cooldown between strikes
    if (lightningMax() < 1) { fireBolt(cursor.x, cursor.y, 1); return }   // no charge upgrade → fixed lvl-1 strike
    me.lightCharging = true; me.lightChargeStart = performance.now(); me.lightCharge = 0
  }
  function lightningRelease() {
    if (!me.lightCharging) return
    me.lightCharging = false
    const maxL = lightningMax()
    const level = maxL <= 1 ? 1 : 1 + Math.round((me.lightCharge || 0) * (maxL - 1))
    fireBolt(cursor.x, cursor.y, Math.max(1, level))
    me.lightCharge = 0
  }
  function electrocuteAt(x, y, level) {   // crackle burst where the bolt lands on something
    for (let k = 0; k < 3 + level; k++) spawnSpark(x + (Math.random() - 0.5) * 26, y + (Math.random() - 0.5) * 34)
    addEffect(x, y, Math.min(level, 3))
  }
  function spawnBolt(x, yTop, yBot, level, mine) {   // visual only
    bolts.push({ x, yTop: Math.min(yTop, yBot - 4), yBot, level, born: performance.now(), life: 320, seed: nextBoltSeed++, mine })
    spawnSpark(x, yBot)
  }
  // LOCAL strike: the bolt travels DOWN from the cursor and STOPS at the first thing it hits
  // (cat / ant / human). Only if it reaches the taskbar untouched does it dig the ground.
  function fireBolt(x, yTop, level) {
    const now = performance.now(), W = canvas.clientWidth, H = canvas.clientHeight, s = view.scale
    me.lightCd = now + LIGHT_CD
    const ground = boltGroundY(x)
    const hitW = (16 + level * 11) * s, top = yTop - 8 * s   // wider effect range at higher charge
    let impactY = ground, target = null   // default: no obstacle → reaches the taskbar
    const consider = (oy, kind, ref) => { if (oy >= top && oy < impactY) { impactY = oy; target = { kind, ref } } }
    for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci]; if (!cat) continue; const c = catPos[ci]; if (Math.abs(c.x - x) < hitW + 30 * s) consider(c.y - 24 * s, 'cat', { cat, c }) }
    for (const a of ants) if (!a.dead && Math.abs(a.x - x) < hitW) consider(a.y, 'ant', a)
    for (const [pid, rec] of remoteAnts) for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp && Math.abs(sp.x - x) < hitW) consider(sp.y, 'rant', { pid, id: a.id }) }
    if (me.humanActive && Math.abs(me.humanX - x) < hitW) consider(me.humanY - 15 * view.scale * HUMAN_SCALE, 'human', null)
    if (target) {   // cut the bolt at the FIRST obstacle and resolve only that one
      if (target.kind === 'cat') { const { cat, c } = target.ref; if (!catShieldCovers(cat, c, x, impactY, now)) applyCatHit(cat, level, now, true) }
      else if (target.kind === 'ant') { const a = target.ref; antTakeDmg(a, level); if (a.dead) addAntKill() }
      else if (target.kind === 'rant') { if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: target.ref.pid, ant: target.ref.id, dmg: level })) }
      else if (target.kind === 'human') { humanTakeDmg(level, now) }
      electrocuteAt(x, impactY, level)
    } else {   // clean strike all the way down → dig the taskbar
      carveTaskbar(x, level * 0.192)   // 50% of a fully-merged missile's dig at level 5
      electrocuteAt(x, ground, level)
    }
    spawnBolt(x, yTop, impactY, level, true)
    if (connected() && net) net.send(JSON.stringify({ t: 'bolt', nx: +(x / W).toFixed(4), nyTop: +(yTop / H).toFixed(4), nyBot: +(impactY / H).toFixed(4), level }))
  }
  function stepLightning(now) {
    if (me.lightCharging) {
      const maxL = lightningMax()
      me.lightCharge = Math.min(1, (now - me.lightChargeStart) / LIGHT_CHARGE_MS)
      const level = maxL <= 1 ? 1 : 1 + Math.round(me.lightCharge * (maxL - 1))
      const frac = maxL <= 1 ? 1 : (me.lightCharge * (maxL - 1)) - (level - 1) + (level > 1 ? 0 : me.lightCharge)  // progress within the current level
      const s = view.scale, cx = cursor.x, cy = cursor.y, R = (12 + level * 9) * s, pulse = 0.85 + 0.15 * Math.sin(now / 70)
      ctx.save()
      // outer glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * pulse)
      g.addColorStop(0, lightningColor(level, 0.95)); g.addColorStop(0.45, lightningColor(level, 0.5)); g.addColorStop(1, lightningColor(level, 0))
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * pulse, 0, Math.PI * 2); ctx.fill()
      // in-swirling energy particles (more as it charges) → gathering feel
      const np = 5 + level * 3
      for (let k = 0; k < np; k++) {
        const seed = k * 2.3, spin = now / 240 + seed, orbit = R * (1.5 - (now / 380 + seed) % 1)   // spiral inward
        if (orbit < R * 0.3) continue
        const px = cx + Math.cos(spin) * orbit, py = cy + Math.sin(spin) * orbit
        ctx.fillStyle = lightningColor(level, 0.9); ctx.beginPath(); ctx.arc(px, py, (1 + level * 0.3) * s, 0, Math.PI * 2); ctx.fill()
      }
      // crackling arcs radiating out
      ctx.strokeStyle = lightningColor(level, 0.9); ctx.lineWidth = (1.2 + level * 0.3) * s; ctx.lineCap = 'round'; ctx.shadowColor = lightningColor(level, 0.9); ctx.shadowBlur = 8 * s
      for (let k = 0; k < level + 2; k++) {
        const a0 = (now / 80 + k * 1.9) % (Math.PI * 2)
        let px = cx + Math.cos(a0) * R * 0.35, py = cy + Math.sin(a0) * R * 0.35
        ctx.beginPath(); ctx.moveTo(px, py)
        for (let j = 1; j <= 3; j++) { const a1 = a0 + (Math.sin(now / 50 + k + j) * 0.4), rr = R * (0.35 + j * 0.24); ctx.lineTo(cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr) }
        ctx.stroke()
      }
      ctx.shadowBlur = 0
      // bright core + charge ring (fills as the current level charges)
      ctx.fillStyle = `rgba(255,255,255,${0.7 + 0.3 * Math.sin(now / 60)})`; ctx.beginPath(); ctx.arc(cx, cy, (3 + level) * s, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = lightningColor(Math.min(5, level + 1), 0.9); ctx.lineWidth = 2.5 * s; ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.max(0, Math.min(1, frac)) * Math.PI * 2); ctx.stroke()
      // level pips
      for (let k = 0; k < maxL; k++) { const a = -Math.PI / 2 + (k / Math.max(1, maxL)) * Math.PI * 2, rr = R * 0.82; ctx.fillStyle = k < level ? lightningColor(level, 0.95) : 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 * s, 0, Math.PI * 2); ctx.fill() }
      ctx.restore()
    }
    drawBolts(now)
  }
  function drawBolts(now) {
    const s = view.scale
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i], t = (now - b.born) / b.life
      if (t >= 1) { bolts.splice(i, 1); continue }
      const a = 1 - t, span = b.yBot - b.yTop
      const rnd = (n) => { const v = Math.sin((b.seed * 12.9 + n * 78.233)) * 43758.5453; return v - Math.floor(v) }
      const segs = Math.max(4, Math.round(span / (26 * s)))
      const jag = (6 + b.level * 3) * s
      const stroke = (lw, col) => {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(b.x, b.yTop)
        for (let k = 1; k <= segs; k++) { const yy = b.yTop + span * (k / segs); const xx = k === segs ? b.x : b.x + (rnd(k) - 0.5) * 2 * jag; ctx.lineTo(xx, yy) }
        ctx.stroke()
      }
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.shadowColor = lightningColor(b.level, 0.95); ctx.shadowBlur = (14 + b.level * 3) * s
      stroke((3 + b.level) * 2.6 * s, lightningColor(b.level, a * 0.22))    // wide soft aura
      stroke((2 + b.level) * 2.2 * s, lightningColor(b.level, a * 0.4))     // outer glow
      ctx.shadowBlur = 0
      stroke((1.6 + b.level * 0.55) * s, lightningColor(b.level, a))        // core
      stroke(1.1 * s, `rgba(255,255,255,${a})`)                            // white hot center
      // branches — more + longer at higher charge
      for (let k = 1; k < segs - 1; k++) {
        if (rnd(k + 40) > 0.62) {
          const yy = b.yTop + span * (k / segs), xx = b.x + (rnd(k) - 0.5) * 2 * jag, side = rnd(k + 5) - 0.5
          ctx.strokeStyle = lightningColor(b.level, a * 0.85); ctx.lineWidth = 1.2 * s; ctx.shadowColor = lightningColor(b.level, 0.8); ctx.shadowBlur = 5 * s
          let bxp = xx, byp = yy; ctx.beginPath(); ctx.moveTo(bxp, byp)
          for (let j = 1; j <= 2; j++) { bxp += side * (18 + b.level * 8) * s; byp += (10 + rnd(k + j) * 12) * s; ctx.lineTo(bxp, byp) }
          ctx.stroke(); ctx.shadowBlur = 0
        }
      }
      // impact burst at the strike point — radial flash + glow ring, scales with charge
      const ir = (12 + b.level * 8) * s
      const ig = ctx.createRadialGradient(b.x, b.yBot, 0, b.x, b.yBot, ir)
      ig.addColorStop(0, `rgba(255,255,255,${a * 0.8})`); ig.addColorStop(0.4, lightningColor(b.level, a * 0.55)); ig.addColorStop(1, lightningColor(b.level, 0))
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(b.x, b.yBot, ir, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = lightningColor(b.level, a * 0.7); ctx.lineWidth = 2 * s   // expanding shock ring
      ctx.beginPath(); ctx.arc(b.x, b.yBot, ir * (0.4 + t * 0.8), 0, Math.PI * 2); ctx.stroke()
      // radiating impact sparks
      for (let k = 0; k < 5 + b.level; k++) { const ang = rnd(k + 70) * Math.PI * 2, len = ir * (0.5 + rnd(k + 80) * 0.7) * (0.5 + t)
        ctx.strokeStyle = lightningColor(b.level, a * 0.7); ctx.lineWidth = 1.3 * s; ctx.beginPath(); ctx.moveTo(b.x, b.yBot); ctx.lineTo(b.x + Math.cos(ang) * len, b.yBot + Math.sin(ang) * len * 0.5); ctx.stroke() }
      ctx.restore()
    }
  }

  // ---------- 🕸️ 그물 (net) — cast (투망) from the hotkey spot, spread open to trap collidables, then a cursor pendulum ----------
  const NET_LEN = 130                                   // rope length (held phase; long → big swings)
  const NET_GRAV = 0.5, NET_DAMP = 0.97, NET_COUPLE = 0.17   // cursor motion couples into the bob (light + builds momentum); damping caps the top speed
  const NET_R = 40, NET_CAP = 20                        // held pouch radius + capacity
  const NET_MAX_PULL = 260, NET_FLING = 1.35, NET_KILL_SPEED = 9   // fling strength; ≥ NET_KILL_SPEED (×scale) → dies on ground impact
  const NET_MIN_RANGE = 60, NET_RANGE_SPAN = 360        // cast distance (px, pre-scale) scaled by pull power
  const NET_SPREAD = 82                                 // fully-open cast canopy radius (pre-scale)
  const CAST_MS = 380                                   // cast (투망) opening duration
  const remoteNets = new Map()                          // peerId -> { ph, ax, ay, bx, by, sp, items, n, ts }
  const netTrail = []                                   // recent bundle positions (motion trail)
  function toggleNetAim() {
    if (!weaponUsable('net')) { showToast('🛒 🕸️ 그물은(는) 상점에서 먼저 구매하세요'); return }
    if (me.netActive) return
    me.netAiming = !me.netAiming; me.netPulling = false
    if (me.netAiming) { me.netOX = cursor.x; me.netOY = cursor.y }   // hotkey spot = launch origin + aim-UI anchor
    showToast(me.netAiming ? '🕸️ 조준: 이 지점에서 왼쪽 버튼을 반대로 당겨 발사' : '그물 취소')
  }
  function startNetPull() { me.netPulling = true }        // pull from the fixed hotkey spot (netOX/OY)
  function netAimData() {
    const ox = me.netOX, oy = me.netOY
    const dx = ox - cursor.x, dy = oy - cursor.y, pull = Math.hypot(dx, dy), d = pull || 1
    return { ox, oy, dx: dx / d, dy: dy / d, pull, power: Math.min(1, pull / NET_MAX_PULL) }
  }
  function fireNet() {
    if (!me.netPulling) { me.netAiming = false; return }
    me.netPulling = false; me.netAiming = false
    const a = netAimData()
    if (a.pull < 8) return                                // negligible → cancel
    me.netActive = true; me.netPhase = 'cast'; me.netCastStart = performance.now()
    me.netCaught = []; netTrail.length = 0
    me.netDirX = a.dx; me.netDirY = a.dy
    me.netRange = (NET_MIN_RANGE + a.power * NET_RANGE_SPAN) * view.scale
    me.netBx = a.ox; me.netBy = a.oy; me.netVx = 0; me.netVy = 0; me.netSpread = NET_R * view.scale * 0.5
    me.netPrevBx = a.ox; me.netPrevBy = a.oy; me.netScreenVx = 0; me.netScreenVy = 0; me.netPrevAx = cursor.x; me.netPrevAy = cursor.y
    showToast('🕸️ 투망! 커서로 휘두르고 다시 왼클릭하면 풀림')
  }
  function netCatch(radius) {
    const grab = (arr, kindOf) => {
      for (let i = arr.length - 1; i >= 0 && me.netCaught.length < NET_CAP; i--) {
        const o = arr[i]
        if (Math.hypot(o.x - me.netBx, o.y - me.netBy) < radius) { arr.splice(i, 1); me.netCaught.push({ kind: kindOf(o), obj: o, arr }); spawnSpark(o.x, o.y) }
      }
    }
    grab(projectiles, () => 'missile')
    grab(hbullets, (o) => o.adogen ? 'adogen' : (o.wave ? 'wave' : 'hbullet'))
    grab(gbullets, () => 'gbullet')
    grab(mechaShells, () => 'mshell')   // 개미 대포 shells (a summon's PROJECTILE — catchable; the mecha itself is not)
    grab(energyShots, () => 'energy')   // 에너지포
    grab(ants, () => 'ant')
    if (me.humanActive && !me.humanNetted && Math.hypot(me.humanX - me.netBx, me.humanY - me.netBy) < radius) { me.humanNetted = true; me.netCaught.push({ kind: 'human', obj: me }) }
    // MULTIPLAYER: also trap OTHER players' collidables — remove them from the owner (t:'capture') and
    // keep a local copy in the net so I can fling it as my own.
    if (connected()) {
      const W = canvas.clientWidth, H = canvas.clientHeight, nowP = performance.now(), cap = () => me.netCaught.length >= NET_CAP
      const steal = (pid, id, kind, x, y, obj, arr) => { if (net) net.send(JSON.stringify({ t: 'capture', target: pid, kind, eid: id })); me.netCaught.push({ kind, obj, arr }); spawnSpark(x, y) }
      for (const [pid, rec] of remoteMissiles) { if (nowP - rec.ts > 500) continue
        for (const [id, it] of rec.items) { if (cap()) break; const x = it.sx * W, y = it.sy * H
          if (Math.hypot(x - me.netBx, y - me.netBy) < radius) { rec.items.delete(id); steal(pid, id, 'missile', x, y, { homing: true, power: it.power || 1, mid: nextMid++, x, y, vx: 0, vy: 0, born: nowP, life: MISSILE_LIFE }, projectiles) } } }
      for (const [pid, rec] of remoteGBullets) { if (nowP - rec.ts > 500) continue
        for (const [id, it] of rec.items) { if (cap()) break; const x = it.sx * W, y = it.sy * H
          if (Math.hypot(x - me.netBx, y - me.netBy) < radius) { rec.items.delete(id); steal(pid, id, 'gbullet', x, y, { id: gbulletId++, x, y, vx: 0, vy: 0, born: nowP }, gbullets) } } }
      for (const [pid, rec] of remoteHbullets) { if (nowP - rec.ts > 500) continue
        for (const [id, it] of rec.items) { if (cap()) break; const x = it.sx * W, y = it.sy * H
          if (Math.hypot(x - me.netBx, y - me.netBy) < radius) { rec.items.delete(id); const k = it.k === 2 ? 'adogen' : (it.k === 1 ? 'wave' : 'hbullet'); steal(pid, id, k, x, y, { x, y, vx: 0, vy: 0, born: nowP, life: 1500, adogen: it.k === 2, wave: it.k === 1, hp: 1, hp0: 1, waveR: (it.r || 0.01) * W }, hbullets) } } }
      for (const [pid, rec] of remoteAnts) { if (nowP - rec.ts > 800) continue
        for (const [id, a] of rec.items) { if (cap()) break; if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (!sp) continue
          if (Math.hypot(sp.x - me.netBx, sp.y - me.netBy) < radius) { rec.items.delete(id); steal(pid, id, 'ant', sp.x, sp.y, { id: nextAntId++, x: sp.x, y: sp.y, hp: ANT_HP, dir: 1, onGround: false, vy: 0, dead: false, step: 0, atkCd: 0, wanderUntil: 0 }, ants) } } }
      for (const [pid, rec] of remoteMShells) { if (nowP - rec.ts > 500) continue   // enemy mecha's shells / energy (the mecha itself is never caught)
        for (const [id, it] of rec.items) { if (cap()) break; const x = it.sx * W, y = it.sy * H
          if (Math.hypot(x - me.netBx, y - me.netBy) < radius) { rec.items.delete(id); steal(pid, id, 'mshell', x, y, { x, y, vx: 0, vy: 0, hp: it.pw || 5, born: nowP, life: 6000 }, mechaShells) } } }
    }
  }
  function stepNet(now) {
    if (!me.netActive) return
    // measure the bundle's ACTUAL on-screen velocity (position delta) — this captures how hard you
    // whip the cursor, unlike the physics velocity which only holds gravity/damping. Used for the fling.
    const pvx = me.netBx - (me.netPrevBx != null ? me.netPrevBx : me.netBx)
    const pvy = me.netBy - (me.netPrevBy != null ? me.netPrevBy : me.netBy)
    me.netScreenVx = (me.netScreenVx || 0) * 0.35 + pvx * 0.65
    me.netScreenVy = (me.netScreenVy || 0) * 0.35 + pvy * 0.65
    me.netPrevBx = me.netBx; me.netPrevBy = me.netBy
    const s = view.scale, H = canvas.clientHeight
    if (me.netPhase === 'cast') {   // 투망: the net flies from the hotkey spot, spreading wide open
      const t = Math.min(1, (now - me.netCastStart) / CAST_MS)
      me.netBx = me.netOX + me.netDirX * me.netRange * t
      me.netBy = me.netOY + me.netDirY * me.netRange * t
      me.netSpread = (NET_R * 0.5 + (NET_SPREAD - NET_R * 0.5) * Math.sin(t * Math.PI * 0.5)) * s
      netCatch(me.netSpread)                              // everything inside the open canopy is trapped
      if (me.humanNetted) { me.humanX = me.netBx; me.humanY = me.netBy }
      if (t >= 1) { me.netPhase = 'held'; me.netVx = me.netDirX * 3 * s; me.netVy = me.netDirY * 3 * s }
      return
    }
    // held: closed pouch hanging from the live cursor (pendulum)
    const L = NET_LEN * s, ax = cursor.x, ay = cursor.y
    // couple the CURSOR's motion into the bob's velocity → feels light (tracks the cursor) AND builds
    // momentum when you keep circling (energy pumped in each frame; damping caps it → speeds up then plateaus)
    const avx = ax - (me.netPrevAx != null ? me.netPrevAx : ax), avy = ay - (me.netPrevAy != null ? me.netPrevAy : ay)
    me.netPrevAx = ax; me.netPrevAy = ay
    me.netVx += avx * NET_COUPLE; me.netVy += avy * NET_COUPLE
    me.netVy += NET_GRAV * s
    me.netVx *= NET_DAMP; me.netVy *= NET_DAMP
    me.netBx += me.netVx; me.netBy += me.netVy
    if (me.netBy > H) { me.netVy *= -0.5; me.netBy = H }
    const maxLen = L * 1.3, dx = me.netBx - ax, dy = me.netBy - ay, dist = Math.hypot(dx, dy) || 0.001
    if (dist > maxLen) {   // clamp to the rope length; bleed only HALF the outward velocity so the swing keeps building
      me.netBx = ax + (dx / dist) * maxLen; me.netBy = ay + (dy / dist) * maxLen
      const rvx = dx / dist, rvy = dy / dist, radial = me.netVx * rvx + me.netVy * rvy
      if (radial > 0) { me.netVx -= radial * rvx * 0.5; me.netVy -= radial * rvy * 0.5 }
    }
    me.netSpread = NET_R * s
    netCatch(NET_R * s)                                   // held net still grabs on contact
    if (me.humanNetted) { me.humanX = me.netBx; me.humanY = me.netBy }
    netTrail.push({ x: me.netBx, y: me.netBy }); if (netTrail.length > 8) netTrail.shift()
  }
  function releaseNet() {
    if (!me.netActive) return
    const s = view.scale, nowP = performance.now()
    // fling by the bundle's real on-screen velocity (whipping the cursor = strong throw)
    let vx = me.netScreenVx || 0, vy = me.netScreenVy || 0, m = Math.hypot(vx, vy)
    if (m < 2) { vx = 0; vy = -6 * s; m = 6 * s }        // gentle default toss if barely moving
    const dx = vx / m, dy = vy / m, flingT = m * NET_FLING, lethal = m >= NET_KILL_SPEED * s   // hard throw → dies on landing
    for (const it of me.netCaught) {
      const o = it.obj
      if (it.kind === 'human') {   // thrown in the swing direction (arc), lands → WASD resumes (or dies if hard)
        me.humanNetted = false; me.humanX = me.netBx; me.humanY = me.netBy - 2 * s
        me.humanTossVx = dx * flingT * 0.85; me.humanVY = dy * flingT * 0.85 - 3 * s; me.humanGround = false; me.humanTossKill = lethal; continue   // slight upward loft
      }
      o.x = me.netBx; o.y = me.netBy; o.born = nowP
      if (it.kind === 'missile') { const sp = Math.max(flingT, MISSILE_SPEED * BOOST_MULT * 0.6); o.vx = dx * sp; o.vy = dy * sp; o.boost = true; projectiles.push(o) }
      else if (it.kind === 'ant') {   // thrown as a parabola in the swing direction (see stepAnts toss)
        const sp = Math.max(flingT * 1.2, 8 * s); o.tvx = dx * sp; o.tvy = dy * sp - 3 * s; o.tossed = true; o.onGround = false; o.tossKill = lethal; it.arr.push(o)   // slight upward loft
      }
      else { const sp = Math.max(flingT, 6 * s); o.vx = dx * sp; o.vy = dy * sp; it.arr.push(o) }
    }
    addEffect(me.netBx, me.netBy, Math.min(3, 1 + Math.floor(me.netCaught.length / 4)))
    me.netCaught = []; me.netActive = false; netTrail.length = 0
  }
  function drawNetIcon(kind, x, y, s) {   // simplified glyph (used for PEERS' nets — no real obj available)
    if (kind === 'missile') { ctx.fillStyle = '#e8663a'; ctx.beginPath(); ctx.arc(x, y, 3.4 * s, 0, Math.PI * 2); ctx.fill(); return }
    if (kind === 'ant') { ctx.fillStyle = '#33333c'; ctx.beginPath(); ctx.arc(x, y, 3.2 * s, 0, Math.PI * 2); ctx.fill(); return }
    if (kind === 'gbullet') { ctx.fillStyle = '#ffd76b'; ctx.beginPath(); ctx.arc(x, y, 2.6 * s, 0, Math.PI * 2); ctx.fill(); return }
    if (kind === 'human') { ctx.strokeStyle = '#c79a6d'; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.moveTo(x, y - 4 * s); ctx.lineTo(x, y + 3 * s); ctx.stroke(); ctx.fillStyle = '#c79a6d'; ctx.beginPath(); ctx.arc(x, y - 5.5 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill(); return }
    ctx.fillStyle = '#bfe6ff'; ctx.beginPath(); ctx.arc(x, y, 2.8 * s, 0, Math.PI * 2); ctx.fill()
  }
  function drawNetEntity(it, x, y, s, now) {   // the REAL caught entity, drawn inside my net
    const o = it.obj
    if (it.kind === 'missile') { drawMissile(x, y, now / 260, now, o.power || 1, !!o.boost) }
    else if (it.kind === 'ant') { const ox = o.x, oy = o.y; o.x = x; o.y = y; drawAnt(o, now, false, antColor(me.skin)); o.x = ox; o.y = oy }
    else if (it.kind === 'human') {
      ctx.save(); ctx.strokeStyle = humanColor(); ctx.fillStyle = humanColor(); ctx.lineWidth = 2.6 * s; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(x, y - 6 * s); ctx.lineTo(x, y + 4 * s); ctx.moveTo(x, y - 3 * s); ctx.lineTo(x - 4 * s, y + 1 * s); ctx.moveTo(x, y - 3 * s); ctx.lineTo(x + 4 * s, y + 1 * s); ctx.moveTo(x, y + 4 * s); ctx.lineTo(x - 3 * s, y + 9 * s); ctx.moveTo(x, y + 4 * s); ctx.lineTo(x + 3 * s, y + 9 * s); ctx.stroke()
      ctx.beginPath(); ctx.arc(x, y - 8.5 * s, 3 * s, 0, Math.PI * 2); ctx.fill(); ctx.restore()
    }
    else if (it.kind === 'adogen') { const g = ctx.createRadialGradient(x, y, 0, x, y, 8 * s); g.addColorStop(0, 'rgba(235,250,255,0.95)'); g.addColorStop(0.5, 'rgba(120,200,255,0.8)'); g.addColorStop(1, 'rgba(80,160,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 8 * s, 0, Math.PI * 2); ctx.fill() }
    else if (it.kind === 'wave') { ctx.strokeStyle = 'rgba(150,210,255,0.9)'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(x, y, 6 * s, -1.15, 1.15); ctx.stroke() }
    else { ctx.fillStyle = it.kind === 'gbullet' ? '#ffd76b' : '#fff1b0'; ctx.beginPath(); ctx.arc(x, y, 2.8 * s, 0, Math.PI * 2); ctx.fill() }
  }
  // draw a net canopy (radial ribs + concentric rings + weighted rim) — used open (cast) or closed (held)
  function drawNetMesh(cx, cy, R, s) {
    ctx.fillStyle = 'rgba(180,200,220,0.14)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(224,234,248,0.5)'; ctx.lineWidth = 1
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke() }
    for (let ring = 1; ring <= 3; ring++) { ctx.beginPath(); ctx.arc(cx, cy, R * ring / 3, 0, Math.PI * 2); ctx.stroke() }
    ctx.strokeStyle = 'rgba(232,242,255,0.92)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = 'rgba(210,220,235,0.9)'; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 2 * s, 0, Math.PI * 2); ctx.fill() }
  }
  function drawNetContents(cx, cy, R, list, drawItem, now) {
    const shown = Math.min(list.length, 12)
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip()
    for (let i = 0; i < shown; i++) { const ang = (i / Math.max(1, shown)) * Math.PI * 2 + now / 700, rr = R * (i % 2 ? 0.28 : 0.55); drawItem(list[i], cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr) }
    ctx.restore()
    if (list.length) { ctx.fillStyle = 'rgba(20,24,32,0.85)'; ctx.beginPath(); ctx.arc(cx + R * 0.72, cy - R * 0.72, 8 * view.scale, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `bold ${9 * view.scale}px "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(list.length), cx + R * 0.72, cy - R * 0.72) }
  }
  function drawNetAll(now) {
    const s = view.scale
    if (me.netAiming) {
      const a = netAimData(), ox = a.ox, oy = a.oy
      ctx.save(); ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(200,220,240,0.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ox, oy, 15 * s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
      if (me.netPulling) {
        ctx.strokeStyle = 'rgba(220,230,240,0.7)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(cursor.x, cursor.y); ctx.stroke(); ctx.setLineDash([])
        const tx = ox + a.dx * (34 + a.power * 80) * s, ty = oy + a.dy * (34 + a.power * 80) * s, aa = Math.atan2(a.dy, a.dx)
        ctx.strokeStyle = `rgba(120,220,150,${0.5 + 0.5 * a.power})`; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tx, ty); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(aa - 0.4) * 9 * s, ty - Math.sin(aa - 0.4) * 9 * s); ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(aa + 0.4) * 9 * s, ty - Math.sin(aa + 0.4) * 9 * s); ctx.stroke()
        // power gauge ring at the hotkey spot
        ctx.strokeStyle = 'rgba(20,24,32,0.6)'; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.arc(ox, oy, 24 * s, 0, Math.PI * 2); ctx.stroke()
        ctx.strokeStyle = `hsl(${Math.round(120 - a.power * 120)},80%,60%)`; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.arc(ox, oy, 24 * s, -Math.PI / 2, -Math.PI / 2 + a.power * Math.PI * 2); ctx.stroke()
        ctx.fillStyle = '#fff'; ctx.font = `bold ${11 * s}px "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Math.round(a.power * 100) + '%', ox, oy)
      }
      ctx.restore()
    }
    if (me.netActive) {
      const R = me.netSpread || NET_R * s
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      if (me.netPhase === 'cast') {
        ctx.strokeStyle = 'rgba(210,222,236,0.8)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(me.netOX, me.netOY); ctx.lineTo(me.netBx, me.netBy); ctx.stroke()   // throw line
      } else {
        for (let i = 0; i < netTrail.length; i++) { const t = netTrail[i]; ctx.fillStyle = `rgba(200,220,240,${(i / netTrail.length) * 0.22})`; ctx.beginPath(); ctx.arc(t.x, t.y, R * 0.5, 0, Math.PI * 2); ctx.fill() }
        ctx.strokeStyle = 'rgba(210,222,236,0.9)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(cursor.x, cursor.y); ctx.lineTo(me.netBx, me.netBy); ctx.stroke()   // rope from cursor
      }
      drawNetMesh(me.netBx, me.netBy, R, s)
      drawNetContents(me.netBx, me.netBy, R, me.netCaught, (it, x, y) => drawNetEntity(it, x, y, s, now), now)   // REAL entities
      ctx.restore()
    }
  }
  function drawRemoteNets(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight, s = view.scale
    for (const [pid, r] of [...remoteNets]) {
      if (now - r.ts > 500) { remoteNets.delete(pid); continue }
      ctx.globalAlpha = peerAlpha(pid)
      r.sbx += (r.bx - r.sbx) * 0.35; r.sby += (r.by - r.sby) * 0.35   // interpolate between 20Hz updates (no extra bandwidth)
      r.sax += (r.ax - r.sax) * 0.35; r.say += (r.ay - r.say) * 0.35
      const bx = r.sbx * W, by = r.sby * H, ax = r.sax * W, ay = r.say * H, R = Math.max(6 * s, (r.sp || 0.03) * W)
      ctx.save(); ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(210,222,236,0.85)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      drawNetMesh(bx, by, R, s)
      drawNetContents(bx, by, R, r.items || [], (kind, x, y) => drawNetIcon(kind, x, y, s), now)   // peers get glyphs
      ctx.restore()
    }
  }

  // ---------- 🕺 controllable human (WASD) — broadcast so peers see it (t:'human' / 'hbullets') ----------
  // WASD move + W jump, E = raise a shield (blocks front hits), left-click = punch (dmg 1).
  const HUMAN_SPEED = 3.4, HUMAN_JUMP = 12, HUMAN_GRAV = 0.62, HUMAN_HP = 5, HUMAN_SCALE = 1.8
  const humanKeys = new Set()
  function deployHuman() {
    if (me.humanActive) { removeHuman(); return }   // fire again → dismiss (no charge)
    if (!spendCoins(USE_COST.human)) { showToast(`🪙 인간 소환 비용 ${USE_COST.human} 부족`); return }
    if (me.gatActive) setGat(false)                 // gatling + human are mutually exclusive
    if (me.mechaActive) removeMecha()               // mecha too
    me.humanActive = true
    me.humanX = cursor.x; me.humanY = antGroundY(cursor.x) - 1
    me.humanVX = 0; me.humanVY = 0; me.humanFace = 1; me.humanGround = true
    me.humanTossVx = 0; me.humanTossKill = false; me.humanNetted = false; me.humanFalling = false
    me.humanHp = HUMAN_HP; me.humanHitCd = 0; me.humanWeapon = null; me.humanAtkCd = 0; me.charging = false; me.charge = 0
    humanKeys.clear()
    if (inputSource.humanControl) inputSource.humanControl(true)   // ask main to forward WASD
  }
  function removeHuman() {
    me.humanActive = false; humanKeys.clear()
    if (inputSource.humanControl) inputSource.humanControl(false)
  }
  function humanTakeDmg(dmg, now, byId) {
    if (!me.humanActive) return
    const hs = view.scale * HUMAN_SCALE
    me.humanHp = (me.humanHp || 0) - dmg; me.humanHitCd = now + 250
    spawnBlood(me.humanX, me.humanY - 15 * hs, 4)
    if (me.humanHp <= 0) {
      addEffect(me.humanX, me.humanY - 12 * hs, 1); spawnBlood(me.humanX, me.humanY - 15 * hs, 18); addBloodStain(me.humanX, me.humanY - 2 * hs, 16 * view.scale); removeHuman()
      creditKill('human', byId)   // killer +200, I lose 200
    }
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
    sword:   { name: '🗡️ 칼', price: 5000, emoji: '🗡️', melee: true, range: 24, dmg: 1, cd: 320 },
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
    if (weaponsLocked()) return
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
    hbullets.push({ x: me.humanX + Math.cos(ang) * 26 * hs, y: oy + Math.sin(ang) * 26 * hs, vx: Math.cos(ang) * 9, vy: Math.sin(ang) * 9, born: now, life: 1800, adogen: true, hp, hp0: hp, waveR: (10 + charge * 26) * view.scale, ang })
  }
  function fireSlash(now, charge) {   // 검기: crescent wave — size/damage/HP scale with charge (max hp=dmg=6, 2× size)
    const hs = view.scale * HUMAN_SCALE, oy = me.humanY - 18 * hs
    const ang = Math.atan2(cursor.y - oy, cursor.x - me.humanX); me.humanFace = Math.cos(ang) >= 0 ? 1 : -1
    const hp = Math.max(1, Math.round(charge * 6))              // 1..6 (2× damage)
    hbullets.push({ x: me.humanX + Math.cos(ang) * 22 * hs, y: oy + Math.sin(ang) * 22 * hs, vx: Math.cos(ang) * 11, vy: Math.sin(ang) * 11, born: now, life: 1500, wave: true, hp, hp0: hp, waveR: (24 + charge * 40) * view.scale, ang })
  }
  function humanMelee(w, now) {                   // sword: swing toward the cursor
    const hs = view.scale * HUMAN_SCALE
    const oy = me.humanY - 18 * hs
    const ang = Math.atan2(cursor.y - oy, cursor.x - me.humanX)
    me.humanFace = Math.cos(ang) >= 0 ? 1 : -1; me.swingAng = ang
    const px = me.humanX + Math.cos(ang) * w.range * hs, py = oy + Math.sin(ang) * w.range * hs, r = w.range * 0.8 * hs
    for (const a of ants) if (!a.dead && Math.hypot(px - a.x, py - a.y) < r) { antTakeDmg(a, w.dmg); if (a.dead) addAntKill() }
    for (const [pid, rec] of remoteAnts) for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp && Math.hypot(px - sp.x, py - sp.y) < r && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: a.id, dmg: w.dmg })) }
    for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci]; if (!cat) continue; const c = catPos[ci]; if (Math.hypot(px - c.x, py - c.y) < 56 * view.scale) applyCatHit(cat, w.dmg, now) }
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
    projectiles.push({ homing: true, boost: true, human: true, power: w.power, mid: nextMid++, x: me.humanX + Math.cos(ang) * 18 * hs, y: oy + Math.sin(ang) * 18 * hs, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, born: now, life: MISSILE_LIFE })
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
      if (inTaskbar(p.x, p.y)) { carveTaskbar(p.x, p.adogen ? p.hp * 0.32 : (p.wave ? p.hp * 0.05 : 0.1)); spawnSpark(p.x, p.y); bcBoom('hbullet', p.id, p.x, p.y, 1); hbullets.splice(i, 1); continue }   // 아도겐: dig scales with size (~40% of before); 검기: ~3× its old dent
      const energy = p.wave || p.adogen, waveR = p.waveR || 16 * s
      const hpFrac = energy && p.hp0 ? p.hp / p.hp0 : 1
      const effR = energy ? waveR * (0.45 + 0.55 * hpFrac) : waveR   // charged blast shrinks as its HP is chipped away
      const dmg = energy ? p.hp : (p.dmg || 1)                       // energy damage = current HP
      // energy blasts lose HP = the OTHER collidable's DMG per blocking hit (missile/bullet/platform), throttled
      const deplete = (amt) => { if (now < (p.hitCd || 0)) return false; p.hitCd = now + 130; addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); p.hp -= (amt || 1); return p.hp <= 0 }
      const pl = hitPlatform(p.x, p.y)
      if (pl) { damagePlatform(pl, dmg); if (!energy) { spawnSpark(p.x, p.y); hbullets.splice(i, 1); continue } else if (deplete(1)) { hbullets.splice(i, 1); continue } }
      const antR = energy ? effR : 12 * s   // energy sweeps wider + pierces
      let hit = false, catHit = false
      for (const a of ants) if (!a.dead && Math.hypot(p.x - a.x, p.y - a.y) < antR) { antTakeDmg(a, dmg); if (a.dead) addAntKill(); hit = true; if (!energy) break }
      if (!hit || energy) { const ah = missileHitsAnt(p.x, p.y); if (ah && !ah.local) { if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg })); hit = true } }
      // generous full-body cat hitbox (tall ellipse) so shots from the low human don't slip past the sprite
      const chw = (energy ? effR + 26 * s : 52 * s), chh = (energy ? effR + 56 * s : 90 * s)
      for (let ci = 0; ci < catPos.length; ci++) {
        const cat = allRef[ci]; if (!cat) continue; const c = catPos[ci]
        const dx = p.x - c.x, dy = p.y - c.y
        if ((dx * dx) / (chw * chw) + (dy * dy) / (chh * chh) <= 1) {
          if (!catShieldCovers(cat, c, p.x, p.y, now)) applyCatHit(cat, dmg, now)
          hit = true; catHit = true; if (!energy) break
        }
      }
      if (energy && catHit) { addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); bcBoom('hbullet', p.id, p.x, p.y, 2); hbullets.splice(i, 1); continue }   // character = solid: deliver DMG (via applyCatHit) then vanish
      if (energy) {   // enemy projectiles chip the blast's HP by THEIR damage (missile = its power)
        const rm = hitRemoteMissile(p.x, p.y, dmg)
        if (rm) { if (connected()) net.send(JSON.stringify({ t: 'col-dmg', target: rm.pid, kind: 'missile', eid: rm.id, dmg })); if (deplete(rm.power || 1)) { bcBoom('hbullet', p.id, p.x, p.y, 2); hbullets.splice(i, 1); continue } }
        else if (hitRemoteGBullet(p.x, p.y)) { if (deplete(1)) { bcBoom('hbullet', p.id, p.x, p.y, 2); hbullets.splice(i, 1); continue } }
      }
      if (hit && !energy) { addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); bcBoom('hbullet', p.id, p.x, p.y, 1); hbullets.splice(i, 1); continue }   // explode like a missile on contact
      ctx.save(); ctx.lineCap = 'round'
      if (p.adogen) {   // 아도겐 — glowing ki ball (shrinks with HP)
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, effR)
        grd.addColorStop(0, 'rgba(235,250,255,0.95)'); grd.addColorStop(0.5, 'rgba(120,200,255,0.8)'); grd.addColorStop(1, 'rgba(80,160,255,0)')
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, effR, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#eaf8ff'; ctx.beginPath(); ctx.arc(p.x, p.y, effR * 0.4, 0, Math.PI * 2); ctx.fill()
      } else if (p.wave) {   // 검기 — crescent perpendicular to travel
        ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx))
        ctx.strokeStyle = 'rgba(150,210,255,0.9)'; ctx.lineWidth = (3 + p.hp) * s; ctx.beginPath(); ctx.arc(0, 0, effR, -1.15, 1.15); ctx.stroke()
        ctx.strokeStyle = 'rgba(235,248,255,0.8)'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(-3 * s, 0, effR, -1.05, 1.05); ctx.stroke()
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
    if (me.humanNetted) { drawHuman(now, false); return }   // caught in a net → held at the bundle (stepNet positions it)
    const s = view.scale, hs = view.scale * HUMAN_SCALE, W = canvas.clientWidth
    if (me.humanFalling) {   // fell into a dug-through hole → drop straight down, remove once fully off-screen
      me.humanFallVy = (me.humanFallVy || 1) + 0.6 * hs; me.humanY += me.humanFallVy; drawHuman(now, false)
      if (me.humanY > canvas.clientHeight + 50 * s) removeHuman()
      return
    }
    // black hole pull (faster) — but the human can STILL move (WASD) to fight it, like a missile/bullet
    let bhPull = null
    for (const b of activeBlackholes(now)) {
      const dx = b.x - me.humanX, dy = b.y - me.humanY, d = Math.hypot(dx, dy) || 0.001
      if (d < BH_CORE * W + 6 * s) { spawnDustToHole(me.humanX, me.humanY, b); removeHuman(); return }
      const sp = bhForce(d, 10) * s                       // whole-screen suction (summed over all holes)
      if (!bhPull) bhPull = { x: 0, y: 0 }
      bhPull.x += (dx / d) * sp; bhPull.y += (dy / d) * sp
    }
    let moving = false
    if (humanKeys.has('a')) { me.humanX -= HUMAN_SPEED * hs; me.humanFace = -1; moving = true }
    if (humanKeys.has('d')) { me.humanX += HUMAN_SPEED * hs; me.humanFace = 1; moving = true }
    if (me.humanTossVx) { me.humanX += me.humanTossVx; me.humanTossVx *= 0.99; if (Math.abs(me.humanTossVx) < 0.2) me.humanTossVx = 0 }   // net-fling horizontal (persists → real arc)
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
      if (me.humanVY >= 0) { const segY = platformFloorAt(me.humanX, me.humanY, prevY); if (segY != null) { me.humanY = segY; me.humanVY = 0; me.humanGround = true; me.humanTossVx = 0; if (me.humanTossKill) { me.humanTossKill = false; humanTakeDmg(99, now); return } } }
      if (me.humanY >= floor) { me.humanY = floor; me.humanVY = 0; me.humanGround = true; me.humanTossVx = 0; if (me.humanTossKill) { me.humanTossKill = false; humanTakeDmg(99, now); return } }
    }
    me.humanX = Math.max(12 * hs, Math.min(W - 12 * hs, me.humanX))
    if (me.humanGround && taskbarHoleAt(me.humanX)) { me.humanFalling = true; me.humanFallVy = 2; me.humanFallStart = now; spawnFallFx(me.humanX, me.humanY); return }   // standing over a hole → fall in
    if (humanKeys.has('e')) me.humanFace = cursor.x >= me.humanX ? 1 : -1   // face the cursor while guarding
    // melee: enemy ANTS touching the human (missiles/bullets/shells collide attacker-side → human-hit). 250ms i-frames.
    if (now >= (me.humanHitCd || 0)) {
      const cx = me.humanX, cy = me.humanY - 15 * hs, r = 20 * hs
      let tx = null, ty = null, byPid = null
      for (const [pid, rec] of remoteAnts) {
        for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp && Math.hypot(cx - sp.x, cy - sp.y) < r) { tx = sp.x; ty = sp.y; byPid = pid; break } }
        if (tx != null) break
      }
      if (tx != null) {
        // barrier (cursor-facing, above the human) blocks threats coming from within its arc
        const scx = me.humanX, scy = me.humanY - 34 * hs * 0.7
        const shieldAng = Math.atan2(cursor.y - scy, cursor.x - scx)
        const blocked = humanKeys.has('e') && angDiff(Math.atan2(ty - scy, tx - scx), shieldAng) <= SHIELD_SPAN / 2
        if (blocked) { spawnSpark(scx + Math.cos(shieldAng) * 30 * hs, scy + Math.sin(shieldAng) * 30 * hs); me.humanHitCd = now + 150 }
        else { humanTakeDmg(1, now, byPid); if (!me.humanActive) return }
      }
    }
    // the human is solid to its OWNER's OWN missiles too — you can attack your own human
    if (now >= (me.humanHitCd || 0)) {
      const cx = me.humanX, cy = me.humanY - 15 * hs, r = 20 * hs
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const pr = projectiles[i]
        if (pr.human || now < (pr.pierceCd || 0)) continue        // skip the human's own bazooka shot / just-pierced
        if (Math.hypot(cx - pr.x, cy - pr.y) < r + (pr.power ? pr.power * 3 : 0)) {
          const hp0 = me.humanHp || 0
          addEffect(pr.x, pr.y, 1); spawnSpark(pr.x, pr.y)
          if ((pr.power || 1) > hp0) { humanTakeDmg(hp0 || 1, now); pr.power -= hp0; pr.pierceCd = now + 140; if (!me.humanActive) return }   // punch through, shrink, keep flying
          else { humanTakeDmg(pr.power || 1, now); projectiles.splice(i, 1); if (!me.humanActive) return; break }
        }
      }
    }
    const qHeld = humanKeys.has('q')
    if (me.charging) {   // build sword/아도겐 charge while Q held; face the cursor
      me.humanFace = cursor.x >= me.humanX ? 1 : -1
      if (qHeld) me.charge = Math.min(1, (now - me.chargeStart) / SWORD_CHARGE_MS)
      else { me.charging = false; me.charge = 0 }
    }
    if (me.humanWeapon === 'rifle' && qHeld && now >= (me.humanAtkCd || 0)) {   // full-auto while Q held
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

  // ---------- 🐜🤖 ant MECHA — merge 10 ants (Q) into a big metal ant with a back cannon + dome shield ----------
  // Controlled like the human (WASD). Q = charge→ballistic ant shell. E = protoss-style dome shield.
  // Drawn from separable parts (via `form` 0=ant … 1=human) so a future upgrade can animate a transform.
  const MECHA_HP = 25, MECHA_SCALE = 2.72, MECHA_SPEED = 2.8, MECHA_JUMP = 13, MECHA_GRAV = 0.62   // 80% of the original size
  const MSHIELD_HP = 10, MSHIELD_BREAK_MS = 5000, MSHIELD_REGEN = 2 / 60   // per frame (~+2/sec)
  const MECHA_CHARGE_MS = 900                                             // Q hold → launch distance (not damage)
  const MSHELL_MIN = 7, MSHELL_MAX = 22, MSHELL_GRAV = 0.34, MSHELL_DMG = 5, MSHELL_HP = 5, MSHELL_CD = 500   // 0.5s between cannon shells
  // ---- 🤖 human form (transform with Ctrl+`) ----
  const TRANSFORM_MS = 950, TRANSFORM_CD = 20000
  const HF_THRUST = 0.95, HF_MAXUP = 5.5, HF_MAXFALL = 8   // booster flight (per view.scale); MAXUP tamed so it doesn't rocket up
  const ECANNON_MS = 1000, ECANNON_SPD = 17, ECANNON_DMG = 10, ECANNON_HP = 10   // Q energy cannon (charge=power, straight, punch-through)
  const INT_COUNT = 10, INT_CD = 3000, INT_DMG = 1                                // R interceptors
  const HF_GRAV = 0.42, HF_HSPD = 4.2, HF_DOWN = 6, HF_LIFT = 1.5   // booster flight: gravity / horizontal / fast-descend / peak thrust accel (ramps up while held)
  const energyShots = []            // { x, y, vx, vy, hp, power, born, life }
  const interceptors = []           // { x, y, vx, vy, born, life }
  const mechaShells = []            // { x, y, vx, vy, hp, born, life }
  const littleBoys = []             // ☢ two 10-merged nukes fuse into a falling Little Boy bomb { x, y, vy, damaging }
  const LITTLEBOY_DMG = 30          // + blast radius = 3× a nuke
  const remoteMechas = new Map()    // peerId -> { nx, ny, hp, face, shield, form }
  const remoteMShells = new Map()   // peerId -> { items: Map, ts }  (all mecha projectiles, keyed by kind)
  let antKeysSent = false           // whether main is currently forwarding WASD/Q/E for the mecha
  function mechaScale() { return view.scale * MECHA_SCALE }
  const MERGE_MS = 1100
  function mergeAntsToMecha() {   // START the magic-circle merge (ants spiral in; the mecha emerges after)
    const alive = ants.filter((a) => !a.dead && !a.falling)
    if (alive.length < 10 || antMax() < 10 || me.mechaActive || me.mechaMerging) return
    if (me.humanActive) removeHuman(); if (me.gatActive) setGat(false)   // exclusive with human/gatling
    const cx = Math.max(16 * mechaScale(), Math.min(canvas.clientWidth - 16 * mechaScale(), cursor.x))   // merge AT the cursor (player picks solid ground)
    me.mergeSnap = alive.map((a) => ({ x0: a.x, y0: a.y, step: Math.random() * 10 }))
    ants.length = 0
    me.mechaMerging = true; me.mechaMergeStart = performance.now(); me.mechaMergeX = cx; me.mechaMergeY = mechaGroundY(cx)
    showToast('🐜✨ 개미들이 뭉치는 중...')
  }
  function spawnMecha(cx, cy) {   // called when the merge animation completes
    me.mechaMerging = false; me.mechaActive = true
    me.mechaX = cx; me.mechaY = cy; me.mechaVY = 0; me.mechaFace = 1; me.mechaGround = true; me.mechaFalling = false   // clear stale falling state from a previous mecha
    me.mechaHp = MECHA_HP; me.mechaHitCd = 0; me.mechaForm = 0
    me.mechaShieldHp = MSHIELD_HP; me.mechaShieldOn = false; me.mechaShieldBrokenUntil = 0
    me.mechaCharging = false; me.mechaCharge = 0
    humanKeys.clear()
    showToast('🐜🤖 개미 메카 합체! WASD 이동 · Q 대포 · E 쉴드')
  }
  function drawMagicCircle(cx, cy, t, now) {   // 그랑죠-style summoning glyph
    const s = view.scale, R = (10 + t * 46) * s, a = t < 0.85 ? 0.9 : Math.max(0, (1 - t) / 0.15) * 0.9
    ctx.save(); ctx.translate(cx, cy); ctx.lineCap = 'round'
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R); g.addColorStop(0, `rgba(180,120,255,${a * 0.35})`); g.addColorStop(0.7, `rgba(120,90,230,${a * 0.18})`); g.addColorStop(1, 'rgba(120,90,230,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = `rgba(200,170,255,${a})`; ctx.lineWidth = 2 * s
    for (const [rr, dir] of [[R, 1], [R * 0.66, -1]]) {
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke()
      for (let k = 0; k < 12; k++) { const ang = now / 500 * dir + k * Math.PI / 6; ctx.beginPath(); ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr); ctx.lineTo(Math.cos(ang) * (rr - 5 * s), Math.sin(ang) * (rr - 5 * s)); ctx.stroke() }
    }
    ctx.strokeStyle = `rgba(232,214,255,${a})`; ctx.lineWidth = 1.5 * s   // rotating hexagram
    for (const off of [0, Math.PI / 3]) { ctx.beginPath(); for (let k = 0; k <= 3; k++) { const ang = now / 700 + off + k * 2 * Math.PI / 3, x = Math.cos(ang) * R * 0.82, y = Math.sin(ang) * R * 0.82; k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) } ctx.closePath(); ctx.stroke() }
    ctx.restore()
  }
  function stepMechaMerge(now) {
    if (!me.mechaMerging) return
    const t = Math.min(1, (now - me.mechaMergeStart) / MERGE_MS), s = view.scale
    const cx = me.mechaMergeX, cy = me.mechaMergeY, myCol = antColor(me.skin)
    drawMagicCircle(cx, cy, t, now)
    for (const a of (me.mergeSnap || [])) {   // ants spiral into the center
      const k = Math.min(1, t * 1.25), dx0 = a.x0 - cx, dy0 = a.y0 - cy
      const ang = Math.atan2(dy0, dx0) + (1 - k) * 5, rad = Math.hypot(dx0, dy0) * (1 - k)
      const ax = cx + Math.cos(ang) * rad, ay = cy + Math.sin(ang) * rad
      a.step += 0.4; drawAnt({ x: ax, y: ay, dir: cx >= ax ? 1 : -1, step: a.step, hp: 1 }, now, false, myCol)
    }
    if (t >= 1) { addEffect(cx, cy - 12 * s, 4); for (let k = 0; k < 12; k++) spawnSpark(cx + (Math.random() - 0.5) * 44 * s, cy - 10 * s); spawnMecha(cx, cy) }
  }
  function removeMecha() { me.mechaActive = false; me.mechaMerging = false; me.mechaCharging = false; me.mechaBoost = false; me.mechaTransforming = false; me.mechaThrust = false; me.mechaShieldWant = false; me.mechaShieldDeploy = 0; humanKeys.clear() }
  function mechaShieldShatter() {
    const s = mechaScale(), r = 30 * s
    addEffect(me.mechaX, me.mechaY - 20 * s, 2)
    for (let k = 0; k < 16; k++) { const a = Math.random() * Math.PI * 2; debris.push({ x: me.mechaX + Math.cos(a) * r, y: me.mechaY - 20 * s + Math.sin(a) * r, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3 - 1, born: performance.now(), life: 400 + Math.random() * 300, sz: 1.6 + Math.random() * 2, color: k % 2 ? 'rgba(120,200,255,0.9)' : 'rgba(180,230,255,0.85)' }) }
  }
  function mechaTakeDmg(dmg, now, byId) {
    if (!me.mechaActive || now < (me.mechaHitCd || 0)) return
    const s = mechaScale()
    if (me.mechaShieldOn && me.mechaShieldHp > 0) {   // shield (dome/funnel) absorbs while it's up
      me.mechaShieldHp -= dmg; me.mechaHitCd = now + 150
      spawnSpark(me.mechaX + (Math.random() - 0.5) * 40 * s, me.mechaY - 22 * s + (Math.random() - 0.5) * 30 * s)
      if (me.mechaShieldHp <= 0) { me.mechaShieldHp = 0; me.mechaShieldOn = false; me.mechaShieldBrokenUntil = now + MSHIELD_BREAK_MS; mechaShieldShatter() }
      return
    }
    me.mechaHp -= dmg; me.mechaHitCd = now + 250
    for (let k = 0; k < 4; k++) spawnSpark(me.mechaX + (Math.random() - 0.5) * 26 * s, me.mechaY - 20 * s)   // metal sparks
    if (me.mechaHp <= 0) {
      addEffect(me.mechaX, me.mechaY - 18 * s, 4); spawnDebris(me.mechaX, me.mechaY - 10 * s, 22, '#6a6f7c')
      creditKill((me.mechaForm || 0) >= 0.5 ? 'mechahuman' : 'mecha', byId)   // human form = 500, ant form = 300
      removeMecha()
    }
  }
  function fireMechaShell(now) {
    const s = mechaScale(), ox = me.mechaX, oy = me.mechaY - 28 * s
    const ang = Math.atan2(cursor.y - oy, cursor.x - ox); me.mechaFace = Math.cos(ang) >= 0 ? 1 : -1
    const spd = (MSHELL_MIN + (me.mechaCharge || 0) * (MSHELL_MAX - MSHELL_MIN)) * view.scale   // charge = launch power (distance)
    mechaShells.push({ x: ox + Math.cos(ang) * 20 * s, y: oy + Math.sin(ang) * 20 * s, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, hp: MSHELL_HP, born: now, life: 6000 })
    me.mechaCharge = 0
  }
  function startMechaTransform(now) {   // Ctrl+` : animate ant ⇄ human form (HP carries over; 20s cooldown)
    if (!me.mechaActive || me.mechaMerging || me.mechaTransforming) return
    if (now < (me.mechaTransformCd || 0)) { showToast(`🔄 변신 쿨타임 ${Math.ceil((me.mechaTransformCd - now) / 1000)}초`); return }
    me.mechaTransforming = true; me.mechaTransformStart = now; me.mechaTransformCd = now + TRANSFORM_CD
    me.mechaTransformFrom = me.mechaForm || 0; me.mechaTransformTo = (me.mechaForm || 0) >= 0.5 ? 0 : 1
    me.mechaCharging = false; me.mechaCharge = 0; me.mechaBoost = false; me.mechaThrust = false
    showToast(me.mechaTransformTo >= 0.5 ? '🤖 인간형으로 변신! W 부스터 · Q 에너지포 · R 요격 · E 쉴드' : '🐜 개미형으로 복귀!')
  }
  function stepMecha(now) {
    if (!me.mechaActive) return
    const s = mechaScale(), W = canvas.clientWidth
    if (me.mechaFalling) {   // fell into a dug-through hole
      me.mechaFallVy = (me.mechaFallVy || 1) + 0.6 * s; me.mechaY += me.mechaFallVy; drawMecha(now, false)
      if (me.mechaY > canvas.clientHeight + 60 * s) removeMecha()
      return
    }
    for (const b of activeBlackholes(now)) { const dx = b.x - me.mechaX, dy = b.y - me.mechaY, d = Math.hypot(dx, dy) || 0.001; if (d < BH_CORE * W + 6 * s) { spawnDustToHole(me.mechaX, me.mechaY, b); removeMecha(); return } }
    // ---- transform animation: control frozen, form interpolates, sparks cover the switch ----
    if (me.mechaTransforming) {
      const t = Math.min(1, (now - me.mechaTransformStart) / TRANSFORM_MS)
      me.mechaForm = me.mechaTransformFrom + (me.mechaTransformTo - me.mechaTransformFrom) * t
      if (now - (me.mechaTransformSpark || 0) > 55) { me.mechaTransformSpark = now; for (let k = 0; k < 4; k++) spawnSpark(me.mechaX + (Math.random() - 0.5) * 46 * s, me.mechaY - 24 * s + (Math.random() - 0.5) * 46 * s) }
      const floorT = mechaGroundY(me.mechaX); me.mechaVY = (me.mechaVY || 0) + MECHA_GRAV * s; me.mechaY = Math.min(floorT, me.mechaY + me.mechaVY); if (me.mechaY >= floorT) { me.mechaY = floorT; me.mechaVY = 0; me.mechaGround = true }
      if (t >= 1) { me.mechaForm = me.mechaTransformTo; me.mechaTransforming = false; me.mechaBoost = false }
      drawMecha(now, false); return
    }
    const human = (me.mechaForm || 0) >= 0.5
    const floor = mechaGroundY(me.mechaX)
    let moving = false
    if (human) {
      // ---- Iron-Man booster flight: W(ground)=jump, W(air again)=booster ON, hold W=thrust up, A/D=strafe, S=fast descend ----
      if (humanKeys.has('a')) { me.mechaX -= HF_HSPD * s; me.mechaFace = -1; moving = true }
      if (humanKeys.has('d')) { me.mechaX += HF_HSPD * s; me.mechaFace = 1; moving = true }
      const wDown = humanKeys.has('w')
      if (wDown && !me.mechaWWas) { if (me.mechaGround) { me.mechaVY = -MECHA_JUMP * s; me.mechaGround = false } else me.mechaBoost = true }
      me.mechaWWas = wDown
      const prevY = me.mechaY; me.mechaGround = false
      me.mechaVY += HF_GRAV * s
      const thrusting = me.mechaBoost && wDown
      if (thrusting) { me.mechaThrustHold = Math.min(60, (me.mechaThrustHold || 0) + 1); const ramp = 0.3 + 0.7 * Math.min(1, me.mechaThrustHold / 55); me.mechaVY -= HF_LIFT * ramp * s }   // gentle at first, builds while held
      else me.mechaThrustHold = 0
      if (humanKeys.has('s')) me.mechaVY += HF_DOWN * 0.5 * s
      me.mechaVY = Math.max(-HF_MAXUP * s, Math.min(HF_MAXFALL * s, me.mechaVY))
      me.mechaY += me.mechaVY
      if (me.mechaVY >= 0) { const segY = platformFloorAt(me.mechaX, me.mechaY, prevY); if (segY != null) { me.mechaY = segY; me.mechaVY = 0; me.mechaGround = true; me.mechaBoost = false } }
      if (me.mechaY >= floor) { me.mechaY = floor; me.mechaVY = 0; me.mechaGround = true; me.mechaBoost = false }
      if (me.mechaY < 26 * s) { me.mechaY = 26 * s; if (me.mechaVY < 0) me.mechaVY = 0 }   // ceiling
      me.mechaThrust = thrusting
    } else {
      // ---- ant walk (heavy, grounded) ----
      if (humanKeys.has('a')) { me.mechaX -= MECHA_SPEED * s; me.mechaFace = -1; moving = true }
      if (humanKeys.has('d')) { me.mechaX += MECHA_SPEED * s; me.mechaFace = 1; moving = true }
      if (humanKeys.has('w') && me.mechaGround) { me.mechaVY = -MECHA_JUMP * s; me.mechaGround = false }
      const prevY = me.mechaY; me.mechaGround = false
      me.mechaVY += MECHA_GRAV * s; me.mechaY += me.mechaVY
      if (humanKeys.has('s')) me.mechaY += 5 * s
      if (me.mechaVY >= 0) { const segY = platformFloorAt(me.mechaX, me.mechaY, prevY); if (segY != null) { me.mechaY = segY; me.mechaVY = 0; me.mechaGround = true } }
      if (me.mechaY >= floor) { me.mechaY = floor; me.mechaVY = 0; me.mechaGround = true }
      me.mechaThrust = false
    }
    me.mechaX = Math.max(16 * s, Math.min(W - 16 * s, me.mechaX))
    if (me.mechaGround && mechaOverHole(me.mechaX)) { me.mechaFalling = true; me.mechaFallVy = 2; spawnFallFx(me.mechaX, me.mechaY); return }
    // shield (E held): ant=dome around the mecha, human=funnels toward the cursor; follows the mecha
    if (me.mechaShieldBrokenUntil && now >= me.mechaShieldBrokenUntil && me.mechaShieldHp <= 0) { me.mechaShieldHp = MSHIELD_HP; me.mechaShieldBrokenUntil = 0 }
    const canShield = me.mechaShieldHp > 0 && now >= (me.mechaShieldBrokenUntil || 0)
    me.mechaShieldOn = canShield && humanKeys.has('e')   // held while E is down
    if (me.mechaShieldOn) { me.mechaShieldAng = Math.atan2(cursor.y - (me.mechaY - 38 * s), cursor.x - me.mechaX); if (human) me.mechaFace = cursor.x >= me.mechaX ? 1 : -1 }   // funnels/plate track the cursor
    if (!me.mechaShieldOn && canShield && me.mechaShieldHp < MSHIELD_HP) me.mechaShieldHp = Math.min(MSHIELD_HP, me.mechaShieldHp + MSHIELD_REGEN)
    me.mechaShieldDeploy = (me.mechaShieldDeploy || 0) + ((me.mechaShieldOn ? 1 : 0) - (me.mechaShieldDeploy || 0)) * 0.18   // deploy/retract animation
    // cannon/energy charge (Q held); face the cursor while charging
    if (me.mechaCharging) { me.mechaFace = cursor.x >= me.mechaX ? 1 : -1; const chMs = human ? ECANNON_MS : MECHA_CHARGE_MS; if (humanKeys.has('q')) me.mechaCharge = Math.min(1, (now - me.mechaChargeStart) / chMs); else { me.mechaCharging = false; me.mechaCharge = 0 } }
    // melee: enemy ANTS touching the mecha (missiles/bullets/shells now collide attacker-side → mecha-hit)
    if (now >= (me.mechaHitCd || 0)) {
      const cx = me.mechaX, cy = me.mechaY - 20 * s, r = 26 * s
      let byPid = null, hitit = false
      for (const [pid, rec] of remoteAnts) { for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp && Math.hypot(cx - sp.x, cy - sp.y) < r) { hitit = true; byPid = pid; break } } if (hitit) break }
      if (hitit) mechaTakeDmg(1, now, byPid)
    }
    drawMecha(now, moving && me.mechaGround)
  }
  // One parametric body that MORPHS between the ant mecha (form 0) and a Gundam-style humanoid (form 1):
  // head / chest / pelvis / legs positions interpolate, ant parts cross-fade out while gundam parts fade in,
  // and the whole frame rises as it "stands up" — so the transform reads as parts rearranging, not a pop.
  function drawMecha(now, walking) {
    const s = mechaScale(), x = me.mechaX, y = me.mechaY, f = me.mechaFace || 1
    const t = Math.max(0, Math.min(1, me.mechaForm || 0))
    const L = (a, b) => a + (b - a) * t
    const tint = antColor(me.skin || 'default')   // metal tinted toward the owner's cat color
    const metal = mixHex('#8a90a0', tint, 0.5), dark = mixHex('#4a4e5a', tint, 0.4), hi = mixHex('#c9cfdb', tint, 0.45), gm = mixHex('#7f8aa3', tint, 0.5), outline = 'rgba(10,12,18,0.6)', accent = '#d94b46'
    const aAnt = Math.max(0, Math.min(1, 1 - (t - 0.25) * 2.4))   // ant parts fade out 0.25→0.66
    const aGun = Math.max(0, Math.min(1, (t - 0.3) * 2.4))         // gundam parts fade in 0.3→0.72
    const bob = me.mechaThrust ? Math.sin(now / 90) * 2 * s : 0
    const bodyCY = L(-14, -40) * s
    ctx.save(); ctx.translate(x, y + bob); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const A0 = ctx.globalAlpha   // entry alpha — lets a dim wrapper (opponent 👁 fade) tint the whole mech
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(0, 1 - bob, L(22, 15) * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill()
    // (funnel plates / dome are drawn by drawMechaShield in absolute coords — the shield stays placed)
    // ===== legs: ant's 6 (fade out) crossfade with the gundam's 2 (fade in, walk cycle) =====
    if (aAnt > 0.01) {
      ctx.globalAlpha = A0 * aAnt; const gait = now / 130
      for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
        const group = (i + (side < 0 ? 0 : 1)) % 2, ph = gait + group * Math.PI
        const swing = walking ? Math.sin(ph) : 0, lift = walking ? Math.max(0, Math.sin(ph)) : 0.15
        const hipX = side * 6 * s, hipY = -13 * s
        const reach = (13 + i * 3) * s, spread = (i - 1) * 6 * s
        const footX = hipX + side * reach + spread * 0.3 + swing * 5 * s, footY = 0 - lift * 5 * s
        const kneeX = hipX + (footX - hipX) * 0.5 + side * 5 * s, kneeY = hipY + (footY - hipY) * 0.45 - 4 * s
        ctx.strokeStyle = dark; ctx.lineWidth = 2.8 * s; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke()
        ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(footX, footY, 1.4 * s, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    if (aGun > 0.01) {
      ctx.globalAlpha = A0 * aGun; const wph = walking ? now / 130 : 0
      for (const side of [-1, 1]) {
        const sw = walking ? Math.sin(wph + (side > 0 ? Math.PI : 0)) : 0
        const hipX = side * 5 * s, hipY = -22 * s
        const kneeX = side * 6 * s + sw * 3 * s, kneeY = -12 * s
        const footX = side * 6 * s + sw * 6 * s, footY = 0 - Math.max(0, sw) * 4 * s
        ctx.strokeStyle = gm; ctx.lineWidth = 7 * s; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke()
        ctx.strokeStyle = dark; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke()
        ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(footX - 5 * s, footY - 2.5 * s, 10 * s, 4.5 * s, 1.5 * s); ctx.fill()
        if (me.mechaThrust) { const fl = (7 + Math.random() * 6) * s; ctx.fillStyle = 'rgba(120,200,255,0.9)'; ctx.beginPath(); ctx.moveTo(footX - 3 * s, footY + 2 * s); ctx.lineTo(footX + 3 * s, footY + 2 * s); ctx.lineTo(footX, footY + 2 * s + fl); ctx.closePath(); ctx.fill(); ctx.fillStyle = 'rgba(255,235,160,0.95)'; ctx.beginPath(); ctx.moveTo(footX - 1.4 * s, footY + 2 * s); ctx.lineTo(footX + 1.4 * s, footY + 2 * s); ctx.lineTo(footX, footY + 2 * s + fl * 0.6); ctx.closePath(); ctx.fill() }
      }
      ctx.globalAlpha = 1
    }
    // ===== body: ant abdomen+thorax (fade out, positions lerp up) vs gundam torso (fade in) =====
    if (aAnt > 0.01) {
      ctx.globalAlpha = A0 * aAnt; ctx.strokeStyle = outline; ctx.lineWidth = 2 * s; ctx.fillStyle = metal
      ctx.beginPath(); ctx.ellipse(L(-f * 11, 0) * s, L(-14, -24) * s, L(15, 10) * s, 11 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()   // abdomen → pelvis
      ctx.beginPath(); ctx.ellipse(0, bodyCY, 9 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()                                     // thorax
      // ant back cannon (only meaningful in ant form; fades with the body)
      const canAng = Math.atan2(cursor.y - (y + bodyCY - 6 * s), cursor.x - x)
      ctx.save(); ctx.translate(L(-f * 6, 0) * s, bodyCY - 7 * s); ctx.rotate(canAng)
      ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(-4 * s, -4 * s, 26 * s, 8 * s, 3 * s); ctx.fill()
      if (me.mechaCharging && t < 0.5) { const g = me.mechaCharge || 0; ctx.fillStyle = `rgba(255,${Math.round(200 - g * 150)},80,0.9)`; ctx.beginPath(); ctx.arc(22 * s, 0, (2 + g * 4) * s, 0, Math.PI * 2); ctx.fill() }
      ctx.restore(); ctx.globalAlpha = 1
    }
    if (aGun > 0.01) {
      ctx.globalAlpha = A0 * aGun
      ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(-8 * s, -26 * s, 16 * s, 8 * s, 2 * s); ctx.fill()   // pelvis
      ctx.fillStyle = gm; ctx.strokeStyle = outline; ctx.lineWidth = 2 * s
      ctx.beginPath(); ctx.roundRect(-12 * s, -46 * s, 24 * s, 22 * s, 4 * s); ctx.fill(); ctx.stroke()          // chest
      ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(-11 * s, -44 * s, 7 * s, 8 * s, 1.5 * s); ctx.fill(); ctx.beginPath(); ctx.roundRect(4 * s, -44 * s, 7 * s, 8 * s, 1.5 * s); ctx.fill()
      ctx.fillStyle = 'rgba(255,220,90,0.95)'; ctx.beginPath(); ctx.roundRect(-10 * s, -43 * s, 5 * s, 6 * s, 1 * s); ctx.fill(); ctx.beginPath(); ctx.roundRect(5 * s, -43 * s, 5 * s, 6 * s, 1 * s); ctx.fill()   // yellow vents
      ctx.fillStyle = 'rgba(120,205,255,0.95)'; ctx.beginPath(); ctx.arc(0, -34 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill()   // core
      for (const side of [-1, 1]) { ctx.fillStyle = gm; ctx.strokeStyle = outline; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.roundRect(side < 0 ? -19 * s : 11 * s, -47 * s, 8 * s, 9 * s, 2 * s); ctx.fill(); ctx.stroke() }   // shoulders
      // back arm hanging + cursor-aimed cannon arm
      ctx.strokeStyle = dark; ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.moveTo(-f * 13 * s, -44 * s); ctx.lineTo(-f * 15 * s, -32 * s); ctx.stroke()
      const pivotY = -44 * s, ang = Math.atan2(cursor.y - (y + bob + pivotY), cursor.x - x)
      ctx.save(); ctx.translate(f * 3 * s, pivotY); ctx.rotate(ang)
      ctx.strokeStyle = gm; ctx.lineWidth = 6 * s; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14 * s, 0); ctx.stroke()
      ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(12 * s, -6 * s, 20 * s, 12 * s, 3 * s); ctx.fill()
      ctx.fillStyle = '#2b2f36'; ctx.beginPath(); ctx.arc(32 * s, 0, 4.5 * s, 0, Math.PI * 2); ctx.fill()
      if (me.mechaCharging) { const g = me.mechaCharge || 0; ctx.fillStyle = `rgba(${Math.round(120 + g * 80)},220,255,0.9)`; ctx.beginPath(); ctx.arc(32 * s, 0, (3 + g * 8) * s, 0, Math.PI * 2); ctx.fill() }
      ctx.restore(); ctx.globalAlpha = 1
    }
    // ===== head: ant helmet (front) → gundam head (top), position lerps + shapes crossfade =====
    const headX = L(f * 16, 0) * s, headY = L(-16, -56) * s
    if (aAnt > 0.01) {
      ctx.globalAlpha = A0 * aAnt
      ctx.fillStyle = metal; ctx.strokeStyle = outline; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(headX, headY, 7 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = dark; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(headX + f * 5 * s, headY - 2 * s); ctx.lineTo(headX + f * 11 * s, headY - 4 * s); ctx.moveTo(headX + f * 5 * s, headY + 2 * s); ctx.lineTo(headX + f * 11 * s, headY + 4 * s); ctx.stroke()
      ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(headX + f * 2 * s, headY, 1.8 * s, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
    }
    if (aGun > 0.01) {
      ctx.globalAlpha = A0 * aGun
      ctx.fillStyle = gm; ctx.strokeStyle = outline; ctx.lineWidth = 1.8 * s; ctx.beginPath(); ctx.roundRect(-5 * s, -58 * s, 10 * s, 10 * s, 2.5 * s); ctx.fill(); ctx.stroke()
      ctx.fillStyle = dark; ctx.fillRect(-6.4 * s, -55 * s, 1.6 * s, 4 * s); ctx.fillRect(4.8 * s, -55 * s, 1.6 * s, 4 * s)
      ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(-1 * s, -57 * s); ctx.lineTo(-8 * s, -63 * s); ctx.lineTo(-4 * s, -56 * s); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(1 * s, -57 * s); ctx.lineTo(8 * s, -63 * s); ctx.lineTo(4 * s, -56 * s); ctx.closePath(); ctx.fill()   // V-fin
      ctx.fillStyle = 'rgba(255,220,90,0.85)'; ctx.beginPath(); ctx.moveTo(0, -59 * s); ctx.lineTo(2 * s, -56 * s); ctx.lineTo(-2 * s, -56 * s); ctx.closePath(); ctx.fill()   // forehead crystal
      ctx.fillStyle = '#ffd23a'; ctx.fillRect(-4 * s, -53.5 * s, 8 * s, 2.4 * s)   // twin-eye visor
      ctx.globalAlpha = 1
    }
    // ===== HP bar =====
    ctx.globalAlpha = A0
    const hpw = 30 * s, hp01 = Math.max(0, (me.mechaHp || 0) / MECHA_HP), byy = L(-36, -68) * s
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-hpw / 2, byy, hpw, 3.5 * s)
    ctx.fillStyle = hp01 > 0.3 ? '#7ecb7e' : '#d05555'; ctx.fillRect(-hpw / 2, byy, hpw * hp01, 3.5 * s)
    ctx.restore()
    drawMechaShield(now)   // placed dome / funnel plates (absolute coords, stays where E was pressed)
  }
  function mechaShellImpact(p) { spawnBlood(p.x, p.y, 12); addBloodStain(p.x, p.y, 12 * view.scale); spawnSpark(p.x, p.y) }   // 피 연출 (not a blast)
  function drawMechaShell(p) {
    const s = view.scale, ang = Math.atan2(p.vy, p.vx)
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang); ctx.scale(s * 3.6, s * 3.6)   // 2× shell size
    ctx.fillStyle = '#33333c'
    ctx.beginPath(); ctx.ellipse(-3, 0, 3, 2.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, 0, 2, 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(3, 0, 2.2, 2, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(18,16,24,0.9)'; ctx.lineWidth = 0.8; for (const L of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(-2, L * 3); ctx.moveTo(1, 0); ctx.lineTo(2, L * 3); ctx.stroke() }
    ctx.restore()
  }
  function stepMechaShells(now) {
    const s = view.scale, W = canvas.clientWidth, H = canvas.clientHeight
    for (let i = mechaShells.length - 1; i >= 0; i--) {
      const p = mechaShells[i]
      if (now - p.born > p.life) { mechaShells.splice(i, 1); continue }
      { const bh = blackholePull(p, now); if (bh) { spawnDustToHole(p.x, p.y, bh); mechaShells.splice(i, 1); continue } }   // black hole sucks it in
      p.vy += MSHELL_GRAV * s; p.x += p.vx; p.y += p.vy
      if (p.x < -30 || p.x > W + 30 || p.y > H + 30) { mechaShells.splice(i, 1); continue }
      const rm = hitRemoteMissile(p.x, p.y, MSHELL_DMG)   // collidable vs missiles (mutual)
      if (rm) { if (connected()) net.send(JSON.stringify({ t: 'col-dmg', target: rm.pid, kind: 'missile', eid: rm.id, dmg: MSHELL_DMG })); p.hp -= (rm.power || 1); mechaShellImpact(p); if (p.hp <= 0) { bcBoom('mshell', p.id, p.x, p.y, 3); mechaShells.splice(i, 1); continue } }
      let hitP = false
      for (let j = projectiles.length - 1; j >= 0; j--) { const pr = projectiles[j]; if (Math.hypot(pr.x - p.x, pr.y - p.y) < 14 * s) { p.hp -= (pr.power || 1); explode(pr.x, pr.y, pr.power || 1); bcBoom('missile', pr.mid, pr.x, pr.y, pr.power || 1); projectiles.splice(j, 1); hitP = true; break } }
      if (hitP) { mechaShellImpact(p); if (p.hp <= 0) { bcBoom('mshell', p.id, p.x, p.y, 3); mechaShells.splice(i, 1); continue } }
      if (safeDomeBlocks(p.x, p.y)) { mechaShellImpact(p); mechaShells.splice(i, 1); continue }   // peace-mode dome stops it
      let land = false
      for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci]; if (!cat) continue; const cc = catPos[ci]; if (Math.abs(cc.x - p.x) < 52 * view.scale && Math.abs(cc.y - p.y) < 62 * view.scale) { if (!catShieldCovers(cat, cc, p.x, p.y, now)) applyCatHit(cat, MSHELL_DMG, now); land = true; break } }
      if (!land) { const ah = missileHitsAnt(p.x, p.y); if (ah) { if (ah.local) { antTakeDmg(ah.ant, MSHELL_DMG); if (ah.ant.dead) addAntKill() } else if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: MSHELL_DMG })); land = true } }
      if (!land) { const rg = hitRemoteGatling(p.x, p.y); if (rg) { if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: rg.pid, dmg: MSHELL_DMG })); land = true } }
      if (!land) { const rmc = hitRemoteMecha(p.x, p.y); if (rmc) { if (connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: rmc.pid, dmg: MSHELL_DMG })); land = true } }
      if (!land) { const rhu = hitRemoteHuman(p.x, p.y); if (rhu) { if (connected()) net.send(JSON.stringify({ t: 'human-hit', target: rhu.pid, dmg: MSHELL_DMG, hx: +(p.x / W).toFixed(4), hy: +(p.y / H).toFixed(4) })); land = true } }
      if (!land && inTaskbar(p.x, p.y)) { carveTaskbar(p.x, 1.0); land = true }   // crater ≈ 5 merged missiles
      if (land) { mechaShellImpact(p); bcBoom('mshell', p.id, p.x, p.y, 3); mechaShells.splice(i, 1); continue }
      drawMechaShell(p)
    }
  }
  function drawRemoteMechas(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const [pid, m] of remoteMechas) {
      ctx.globalAlpha = peerAlpha(pid)
      const sv = { x: me.mechaX, y: me.mechaY, f: me.mechaFace, hp: me.mechaHp, on: me.mechaShieldOn, sh: me.mechaShieldHp, ch: me.mechaCharging, cg: me.mechaCharge, form: me.mechaForm, thr: me.mechaThrust, dep: me.mechaShieldDeploy, sX: me.mechaShieldX, sY: me.mechaShieldY, sA: me.mechaShieldAng, skin: me.skin, active: me.mechaActive }
      const peer = peers.get(pid); me.skin = (peer && peer.skin) || 'default'   // color the mecha with the owner's cat color
      me.mechaX = m.nx * W; me.mechaY = m.ny * H; me.mechaFace = m.face || 1; me.mechaHp = m.hp
      me.mechaShieldHp = (m.shield || 0) * MSHIELD_HP
      me.mechaForm = m.form || 0; me.mechaThrust = !!m.thr; me.mechaCharging = !!m.ch; me.mechaCharge = m.chg || 0
      me.mechaShieldDeploy = m.sdep || 0; me.mechaShieldX = (m.snx != null ? m.snx : m.nx) * W; me.mechaShieldY = (m.sny != null ? m.sny : m.ny) * H; me.mechaShieldAng = m.sang || 0; me.mechaActive = true
      drawMecha(now, false)
      me.mechaX = sv.x; me.mechaY = sv.y; me.mechaFace = sv.f; me.mechaHp = sv.hp; me.mechaShieldOn = sv.on; me.mechaShieldHp = sv.sh; me.mechaCharging = sv.ch; me.mechaCharge = sv.cg; me.mechaForm = sv.form; me.mechaThrust = sv.thr; me.mechaShieldDeploy = sv.dep; me.mechaShieldX = sv.sX; me.mechaShieldY = sv.sY; me.mechaShieldAng = sv.sA; me.skin = sv.skin; me.mechaActive = sv.active
    }
  }
  function drawRemoteMShells(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const [pid, rec] of [...remoteMShells]) {
      if (now - rec.ts > 400) { remoteMShells.delete(pid); continue }
      ctx.globalAlpha = peerAlpha(pid)
      for (const it of rec.items.values()) {
        it.sx += (it.nx - it.sx) * SMOOTH; it.sy += (it.ny - it.sy) * SMOOTH
        const o = { x: it.sx * W, y: it.sy * H, vx: (it.vx || 0) * W, vy: (it.vy || 1) * H, power: it.pw || 6 }
        if (it.k === 1) drawEnergyShot(o, now)
        else if (it.k === 2) drawInterceptor(o)
        else drawMechaShell(o)
      }
    }
  }
  // ---- 🤖 human-form weapons: Q energy cannon (straight, punch-through) + R interceptors (homing) ----
  function fireEnergyCannon(now) {
    const s = mechaScale(), ox = me.mechaX, oy = me.mechaY - 42 * s
    const ang = Math.atan2(cursor.y - oy, cursor.x - ox); me.mechaFace = Math.cos(ang) >= 0 ? 1 : -1
    const stage = Math.max(1, Math.min(5, Math.ceil((me.mechaCharge || 0) * 5)))   // 5 charge stages
    const power = stage * 2                                                          // 2 … 10 (= DMG = HP)
    energyShots.push({ x: ox + Math.cos(ang) * 26 * s, y: oy + Math.sin(ang) * 26 * s, vx: Math.cos(ang) * ECANNON_SPD, vy: Math.sin(ang) * ECANNON_SPD, power, born: now, life: 2500, id: ++mshellId })
    me.mechaCharge = 0
  }
  function drawEnergyShot(p, now) {
    const r = (5 + (p.power || 6) * 1.7) * view.scale
    ctx.save(); ctx.translate(p.x, p.y)
    const A0 = ctx.globalAlpha   // respect a dim wrapper (opponent transparency)
    const tl = Math.atan2(p.vy || 1, p.vx || 0)
    ctx.globalAlpha = A0 * 0.4; ctx.fillStyle = 'rgba(120,210,255,0.5)'; ctx.beginPath(); ctx.ellipse(-Math.cos(tl) * r, -Math.sin(tl) * r, r * 1.3, r * 0.5, tl, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = A0
    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r)
    g.addColorStop(0, 'rgba(235,255,255,0.95)'); g.addColorStop(0.5, 'rgba(90,200,255,0.8)'); g.addColorStop(1, 'rgba(60,120,255,0)')
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = A0 * (0.5 + 0.3 * Math.sin(now / 40)); ctx.strokeStyle = 'rgba(190,240,255,0.9)'; ctx.lineWidth = 1.6 * view.scale; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }
  function stepEnergyShots(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (let i = energyShots.length - 1; i >= 0; i--) {
      const p = energyShots[i]
      if (now - p.born > p.life) { energyShots.splice(i, 1); continue }
      { const bh = blackholePull(p, now); if (bh) { spawnDustToHole(p.x, p.y, bh); energyShots.splice(i, 1); continue } }   // black hole sucks it in
      p.x += p.vx; p.y += p.vy
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) { energyShots.splice(i, 1); continue }
      if (safeDomeBlocks(p.x, p.y)) { addEffect(p.x, p.y, 2); spawnSpark(p.x, p.y); bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue }   // peace-mode dome stops it
      // solid cats stop it (like a missile)
      let gone = false
      for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci]; if (!cat) continue; const cc = catPos[ci]; if (Math.abs(cc.x - p.x) < 52 * view.scale && Math.abs(cc.y - p.y) < 62 * view.scale) { if (!catShieldCovers(cat, cc, p.x, p.y, now)) applyCatHit(cat, p.power, now); addEffect(p.x, p.y, 2); spawnSpark(p.x, p.y); bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); gone = true; break } }
      if (gone) continue
      // punch-through vs ants / gatling / enemy missiles (power depletes by target HP; gated so it doesn't multi-hit)
      if (now >= (p.pierceCd || 0)) {
        const ah = missileHitsAnt(p.x, p.y)
        if (ah) {
          if (ah.local) { antTakeDmg(ah.ant, p.power); if (ah.ant.dead) addAntKill() } else if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: p.power }))
          spawnSpark(p.x, p.y); p.pierceCd = now + 90; if (p.power > 1) p.power -= 1; else { addEffect(p.x, p.y, 1); bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue }
        }
        const rg = hitRemoteGatling(p.x, p.y)
        if (rg) { if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: rg.pid, dmg: p.power })); addEffect(p.x, p.y, 1); p.pierceCd = now + 120; if (p.power > (rg.hp || 1)) p.power -= (rg.hp || 1); else { bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue } }
        const rmc = hitRemoteMecha(p.x, p.y)
        if (rmc) { if (connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: rmc.pid, dmg: p.power })); addEffect(p.x, p.y, 1); p.pierceCd = now + 130; if (p.power > (rmc.hp || 1)) p.power -= (rmc.hp || 1); else { bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue } }
        const rhu = hitRemoteHuman(p.x, p.y)
        if (rhu) { if (connected()) net.send(JSON.stringify({ t: 'human-hit', target: rhu.pid, dmg: p.power, hx: +(p.x / W).toFixed(4), hy: +(p.y / H).toFixed(4) })); addEffect(p.x, p.y, 1); p.pierceCd = now + 130; if (p.power > (rhu.hp || 1)) p.power -= (rhu.hp || 1); else { bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue } }
        const rm = hitRemoteMissile(p.x, p.y, p.power)
        if (rm) { if (connected()) net.send(JSON.stringify({ t: 'col-dmg', target: rm.pid, kind: 'missile', eid: rm.id, dmg: p.power })); addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); p.pierceCd = now + 100; if (p.power > (rm.power || 1)) p.power -= (rm.power || 1); else { bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue } }
      }
      // vs local missiles (collidable, same punch-through rule as the ant shell)
      let consumed = false
      if (now >= (p.pierceCd || 0)) {
        for (let j = projectiles.length - 1; j >= 0; j--) {
          const pr = projectiles[j]
          if (Math.hypot(pr.x - p.x, pr.y - p.y) < 14 * view.scale) {
            const pw = pr.power || 1; explode(pr.x, pr.y, pw); bcBoom('missile', pr.mid, pr.x, pr.y, pw); projectiles.splice(j, 1); addEffect(p.x, p.y, 1); p.pierceCd = now + 90
            if (p.power > pw) p.power -= pw; else { bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); consumed = true }
            break
          }
        }
      }
      if (consumed) continue
      // taskbar: carve a crater sized by the remaining power, then the shot spends itself
      if (inTaskbar(p.x, p.y)) { carveTaskbar(p.x, Math.min(1.3, p.power * 0.13)); addEffect(p.x, p.y, 2); spawnSpark(p.x, p.y); bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue }
      drawEnergyShot(p, now)
    }
  }
  function fireInterceptors(now) {
    if (now < (me.interceptCd || 0)) { showToast(`🚀 요격 쿨타임 ${Math.ceil((me.interceptCd - now) / 1000)}초`); return }
    me.interceptCd = now + INT_CD
    const s = mechaScale(), ox = me.mechaX, oy = me.mechaY - 40 * s, spd = MISSILE_SPEED * BOOST_MULT * 1.2   // 1.2× left-click boost missile
    for (let k = 0; k < INT_COUNT; k++) {
      const a = -Math.PI / 2 + (k - (INT_COUNT - 1) / 2) * 0.16
      interceptors.push({ x: ox + (Math.random() - 0.5) * 12 * s, y: oy, vx: Math.cos(a) * spd * 0.5, vy: Math.sin(a) * spd, spd, born: now, life: 4000, id: ++mshellId })
    }
    showToast('🚀 요격 미사일 10발!')
  }
  // Homes onto ANY fired projectile across the WHOLE overlay (mine or an opponent's): missiles,
  // gatling bullets, adogen/waves, ant-cannon shells, energy pods — everything but characters.
  // Enemy collidables are damaged via a unified `col-dmg` relay so both sides vanish correctly.
  function nearestInterceptTarget(x, y) {
    let best = null, bd = Infinity   // whole-screen homing
    const consider = (tx, ty, hit) => { const d = Math.hypot(tx - x, ty - y); if (d < bd) { bd = d; best = { x: tx, y: ty, hit } } }
    const now = performance.now(), W = canvas.clientWidth, H = canvas.clientHeight
    const cd = (pid, kind, eid) => { if (connected()) net.send(JSON.stringify({ t: 'col-dmg', target: pid, kind, eid, dmg: INT_DMG })) }
    for (const pr of projectiles) consider(pr.x, pr.y, () => { const j = projectiles.indexOf(pr); if (j >= 0) { addEffect(pr.x, pr.y, 1); if ((pr.power || 1) > INT_DMG) pr.power -= INT_DMG; else projectiles.splice(j, 1) } })
    for (const a of ants) if (!a.dead && !a.falling) consider(a.x, a.y, () => antTakeDmg(a, INT_DMG))
    for (const [pid, rec] of remoteAnts) { if (now - rec.ts > 800) continue; for (const a of rec.items.values()) { if (a.dead) continue; const sp = remoteAntScreenPos(pid, a); if (sp) consider(sp.x, sp.y, () => { if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: a.id, dmg: INT_DMG })) }) } }
    for (const [pid, g] of remoteGatlings) consider(g.nx * W, g.ny * H, () => { if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: pid, dmg: INT_DMG })) })
    for (const [pid, m] of remoteMechas) consider(m.nx * W, m.ny * H - 26 * mechaScale(), () => { if (connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: pid, dmg: INT_DMG })) })
    for (const [pid, rec] of remoteMissiles) { if (now - rec.ts > 500) continue; for (const it of rec.items.values()) consider(it.sx * W, it.sy * H, () => cd(pid, 'missile', it.id)) }
    for (const [pid, rec] of remoteGBullets) { if (now - rec.ts > 400) continue; for (const it of rec.items.values()) consider(it.sx * W, it.sy * H, () => cd(pid, 'gbullet', it.id)) }
    for (const [pid, rec] of remoteHbullets) { if (now - rec.ts > 400) continue; for (const it of rec.items.values()) consider(it.sx * W, it.sy * H, () => cd(pid, 'hbullet', it.id)) }
    for (const [pid, rec] of remoteMShells) { if (now - rec.ts > 400) continue; for (const it of rec.items.values()) consider(it.sx * W, it.sy * H, () => cd(pid, 'mshell', it.id)) }
    return best
  }
  function stepInterceptors(now) {
    const W = canvas.clientWidth, s = view.scale
    for (let i = interceptors.length - 1; i >= 0; i--) {
      const p = interceptors[i]
      if (now - p.born > p.life) { interceptors.splice(i, 1); continue }
      { const bh = blackholePull(p, now); if (bh) { spawnDustToHole(p.x, p.y, bh); interceptors.splice(i, 1); continue } }   // black hole sucks it in
      const tg = nearestInterceptTarget(p.x, p.y)
      if (tg) {
        const dx = tg.x - p.x, dy = tg.y - p.y, d = Math.hypot(dx, dy) || 1
        p.vx += ((dx / d) * p.spd - p.vx) * 0.22; p.vy += ((dy / d) * p.spd - p.vy) * 0.22
        if (d < 15 * s) { tg.hit(); addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); bcBoom('mshell', p.id, p.x, p.y, 1); interceptors.splice(i, 1); continue }
      } else { p.vy += (-p.spd - p.vy) * 0.04; p.vx *= 0.96 }   // no target → climb and fade
      p.x += p.vx; p.y += p.vy
      if (p.x < -40 || p.x > W + 40 || p.y < -80) { interceptors.splice(i, 1); continue }
      drawInterceptor(p)
    }
  }
  function drawInterceptor(p) {
    const s = view.scale * 1.3, ang = Math.atan2(p.vy, p.vx)   // 30% larger
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang)
    ctx.fillStyle = 'rgba(255,170,60,0.9)'; ctx.beginPath(); ctx.ellipse(-7 * s, 0, 5 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill()   // thruster flame
    ctx.fillStyle = '#dfe4ee'; ctx.beginPath(); ctx.roundRect(-4 * s, -1.7 * s, 9 * s, 3.4 * s, 1.5 * s); ctx.fill()
    ctx.fillStyle = '#c0403a'; ctx.beginPath(); ctx.moveTo(6 * s, 0); ctx.lineTo(2.5 * s, -1.8 * s); ctx.lineTo(2.5 * s, 1.8 * s); ctx.closePath(); ctx.fill()   // nose cone
    ctx.restore()
  }
  // Shield FOLLOWS the mecha and is held while E is down (release → retracts). Ant form = honeycomb
  // hemisphere dome around the mecha; human form = 2 funnel plates that deploy toward the cursor,
  // merge, and spread a wider force field. Drawn in absolute coords after the body.
  function drawMechaShield(now) {
    const form = me.mechaForm || 0, dep = me.mechaShieldDeploy || 0, s = mechaScale()
    const hp01 = Math.max(0, Math.min(1, (me.mechaShieldHp || 0) / MSHIELD_HP))
    if (form < 0.5) {
      if (dep <= 0.02) return   // ant: nothing when off
      ctx.save(); ctx.globalAlpha *= Math.min(1, dep * 1.3)
      drawHexDome(me.mechaX, me.mechaY, (30 + 22 * dep) * s, hp01, now, true)   // dome around the mecha (follows it)
      ctx.restore()
      return
    }
    // ---- human form: funnel plates deploy toward the cursor from the mech's back ----
    const cx = me.mechaX, cy = me.mechaY, ang = me.mechaShieldAng != null ? me.mechaShieldAng : 0
    const D = 28 * s, perp = ang + Math.PI / 2, gap = (14 - 6 * dep) * s   // plates converge (merge) when deployed
    const depCx = cx + Math.cos(ang) * D, depCy = (cy - 38 * s) + Math.sin(ang) * D
    if (dep > 0.12) {   // merged, wider force field at the placed spot
      ctx.save(); ctx.translate(depCx, depCy); ctx.rotate(ang)
      const R = (16 + dep * 22) * s, base = ctx.globalAlpha
      ctx.globalAlpha = base * dep * (0.22 + 0.32 * hp01)
      const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R)
      g.addColorStop(0, 'rgba(150,215,255,0.55)'); g.addColorStop(0.7, 'rgba(120,200,255,0.22)'); g.addColorStop(1, 'rgba(120,200,255,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.72, R, 0, 0, Math.PI * 2); ctx.fill()
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, R * 0.72, R, 0, 0, Math.PI * 2); ctx.clip(); ctx.globalAlpha = base * dep * 0.45; ctx.strokeStyle = 'rgba(175,225,255,0.85)'; ctx.lineWidth = 0.9 * s; honeycomb(0, 0, R * 1.1, 5 * s); ctx.restore()
      if (hp01 < 0.45) { ctx.globalAlpha = base * (0.5 + 0.4 * Math.sin(now / 70)); ctx.strokeStyle = 'rgba(255,170,170,0.75)'; ctx.lineWidth = 1.2 * s; ctx.beginPath(); ctx.moveTo(-4 * s, -10 * s); ctx.lineTo(4 * s, 2 * s); ctx.lineTo(-4 * s, 14 * s); ctx.stroke() }
      ctx.restore()
    }
    for (const side of [-1, 1]) {   // plates: back-of-mech → fixed placed spot
      const dockX = cx + side * 13 * s, dockY = cy - 49 * s, dockRot = side * 0.7
      const dX = depCx + Math.cos(perp) * side * gap, dY = depCy + Math.sin(perp) * side * gap
      const px = dockX + (dX - dockX) * dep, py = dockY + (dY - dockY) * dep
      const rot = dockRot + (ang - dockRot) * dep
      ctx.save(); ctx.translate(px, py); ctx.rotate(rot)
      ctx.fillStyle = '#6f7a93'; ctx.strokeStyle = 'rgba(10,12,18,0.6)'; ctx.lineWidth = 1.4 * s
      ctx.beginPath(); ctx.roundRect(-4 * s, -14 * s, 8 * s, 28 * s, 3 * s); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#d94b46'; ctx.beginPath(); ctx.roundRect(-2.5 * s, -11 * s, 5 * s, 6 * s, 1 * s); ctx.fill()
      ctx.fillStyle = 'rgba(120,205,255,0.9)'; ctx.beginPath(); ctx.arc(0, 8 * s, 1.8 * s, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
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
  // cached per frame: blackholePull runs this once PER moving object, so rebuilding the list each
  // call churned the GC. Memoize by `now` (every caller in a frame shares the same timestamp).
  let bhCacheAt = -1; const bhCacheList = []
  function activeBlackholes(now) {
    if (now === bhCacheAt) return bhCacheList
    bhCacheList.length = 0
    const W = canvas.clientWidth, H = canvas.clientHeight, r = BH_R * W
    if (me.bhUntil && now < me.bhUntil) bhCacheList.push({ x: me.bhX, y: me.bhY, r, mine: true })
    for (const [, b] of remoteBlackholes) if (now < b.until) bhCacheList.push({ x: b.nx * W, y: b.ny * H, r, mine: false })
    bhCacheAt = now
    return bhCacheList
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
      if (d < core) return b                        // consumed
      const accel = bhForce(d, 6)                   // whole-screen: strong near, gently weak far
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
    renderAchv(); pushState()
  }
  // apply a weapon hit to a character: flash + (my cat → lose HP; enemy → send the hit)
  function applyCatHit(cat, power, now, shock) {
    cat.hitUntil = now + 700 + Math.min((power || 1) - 1, 5) * 100
    if (shock) cat.shockUntil = now + 650
    if (cat.id === 'me') damageMyCat(power || 1)
    else if (connected()) net.send(JSON.stringify({ t: 'hit', target: cat.id, power, shock: shock ? 1 : 0 }))
  }
  function damageMyCat(dmg, byId) {
    if (me.safeMode) return                // 🕊️ peace mode: invincible 9999-HP dome absorbs everything
    if (!(dmg > 0) || me.hp <= 0) return   // already at 0 → no re-trigger until healed (resetCatHp)
    me.hp = Math.max(0, me.hp - dmg); localStorage.setItem('catHp', String(me.hp))
    if (me.hp === 0) onCatDestroyed(byId)
  }
  function onCatDestroyed(byId) {   // desk fully wrecked; count toward the achievement (reset in the shop)
    destroyCount++; localStorage.setItem('destroys', String(destroyCount))
    const c = catPos[0]; if (c) { addEffect(c.x, c.y, 4); spawnDebris(c.x, c.y, 20, '#6a5a4a') }
    showToast('💥 완전 파괴! 상점에서 🩹 체력 리셋')
    if (!destroyRewarded && destroyCount >= DESTROY_GOAL) {
      destroyRewarded = true; localStorage.setItem('destroyRewarded', '1')
      tapCount += DESTROY_REWARD; counterDirty = true; renderCounter()
      showToast(`🏆 완전 파괴 ${DESTROY_GOAL}회 — 🪙${DESTROY_REWARD.toLocaleString()} 지급!`)
    }
    // credit the attacker who landed the final blow (once per destroy, since we're now at HP 0)
    if (byId != null && connected() && net) net.send(JSON.stringify({ t: 'kill', kind: 'cat', by: byId }))
    renderAchv(); pushState()
  }
  const CAT_KILL_REWARD = 500
  function rewardCatDestroy() {   // I destroyed an opponent's character → +500 with a coin-gain flourish
    tapCount += CAT_KILL_REWARD; counterDirty = true; renderCounter()
    showCreditPop(CAT_KILL_REWARD)
  }
  function resetCatHp() { me.hp = CAT_HP; localStorage.setItem('catHp', String(CAT_HP)) }
  function addGatKill() {   // I destroyed an enemy's gatling
    gatKills++; localStorage.setItem('gatKills', String(gatKills))
    if (!gatKillRewarded && gatKills >= GAT_KILL_GOAL) { gatKillRewarded = true; localStorage.setItem('gatKillRewarded', '1'); tapCount += KILL_REWARD; counterDirty = true; renderCounter(); showToast(`🏆 게틀링 파괴자 ${GAT_KILL_GOAL}회 — 🪙${KILL_REWARD.toLocaleString()}!`) }
    else showToast(`🔫 상대 게틀링 파괴 ${gatKills}/${GAT_KILL_GOAL}`)
    renderAchv(); pushState()
  }
  function addHumanKill() {   // I destroyed an enemy's human
    humanKills++; localStorage.setItem('humanKills', String(humanKills))
    if (!humanKillRewarded && humanKills >= HUMAN_KILL_GOAL) { humanKillRewarded = true; localStorage.setItem('humanKillRewarded', '1'); tapCount += KILL_REWARD; counterDirty = true; renderCounter(); showToast(`🏆 인간 사냥꾼 ${HUMAN_KILL_GOAL}회 — 🪙${KILL_REWARD.toLocaleString()}!`) }
    else showToast(`🕺 상대 인간 파괴 ${humanKills}/${HUMAN_KILL_GOAL}`)
    renderAchv(); pushState()
  }
  function addMechaKill() {   // I destroyed an enemy's ant mecha (ant OR human form)
    mechaKills++; localStorage.setItem('mechaKills', String(mechaKills))
    if (!mechaKillRewarded && mechaKills >= MECHA_KILL_GOAL) { mechaKillRewarded = true; localStorage.setItem('mechaKillRewarded', '1'); tapCount += MECHA_KILL_REWARD; counterDirty = true; renderCounter(); showToast(`🏆 메카 파괴자 ${MECHA_KILL_GOAL}회 — 🪙${MECHA_KILL_REWARD.toLocaleString()}!`) }
    else showToast(`🐜🤖 상대 메카 처치 ${mechaKills}/${MECHA_KILL_GOAL}`)
    renderAchv(); pushState()
  }

  // ---------- 🔫 gatling gun ----------
  // toggling gatActive also tells main whether to forward the Q key (fire) to the overlay
  function setGat(on) { me.gatActive = on; if (inputSource.gatlingControl) inputSource.gatlingControl(on) }
  function deployGatling() {
    const now = performance.now()
    if (me.gatActive || now < (me.gatCdUntil || 0)) return   // one at a time; respect destroy cooldown
    if (!spendCoins(USE_COST.gatling)) { showToast(`🪙 게틀링건 소환 비용 ${USE_COST.gatling} 부족`); return }
    if (me.humanActive) removeHuman()                        // gatling + human are mutually exclusive
    if (me.mechaActive) removeMecha()                        // mecha too
    setGat(true); me.gatX = cursor.x; me.gatY = cursor.y
    me.gatHp = GAT_HP; me.gatHeat = 0; me.gatOverUntil = 0; me.gatLastShot = 0
    me.gatAng = 0
  }
  function damageMyGatling(dmg, byId) {
    if (!me.gatActive) return
    me.gatHp -= (dmg || 1)
    if (me.gatHp <= 0) {
      spawnGatDestroy(me.gatX, me.gatY); setGat(false); me.gatCdUntil = performance.now() + GAT_CD
      creditKill('gat', byId)   // killer +300, I lose 300
    }
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
    for (const [pid, g] of remoteGatlings) { if (Math.hypot(x - g.nx * W, y - g.ny * H) < GAT_HIT_R * view.scale) return { pid, hp: g.hp || GAT_HP } }
    return null
  }
  // an enemy ant mecha (ant OR human form) at (x,y) — a collidable target with punch-through, HP 25.
  // Its DEPLOYED shield (placed dome / funnel field) also counts as a barrier, so shots that hit the
  // shield register too (and get absorbed by the owner's shield HP).
  function hitRemoteMecha(x, y) {
    const W = canvas.clientWidth, H = canvas.clientHeight, s = mechaScale()
    for (const [pid, m] of remoteMechas) {
      const mx = m.nx * W, my = m.ny * H - 26 * s
      if (Math.abs(x - mx) < 24 * s && Math.abs(y - my) < 34 * s) return { pid, hp: m.hp || MECHA_HP }
      if ((m.sdep || 0) > 0.6) {   // deployed shield barrier (follows the mecha)
        const bx = m.nx * W, by = m.ny * H
        if ((m.form || 0) < 0.5) { if (y <= by + 8 && Math.hypot(x - bx, y - by) < 52 * s) return { pid, hp: m.hp || MECHA_HP } }   // ant hemisphere dome
        else { const dx = bx + Math.cos(m.sang || 0) * 28 * s, dy = (by - 38 * s) + Math.sin(m.sang || 0) * 28 * s; if (Math.hypot(x - dx, y - dy) < 30 * s) return { pid, hp: m.hp || MECHA_HP } }   // funnel field
      }
    }
    return null
  }
  // an enemy human summon at (x,y) — a collidable target with punch-through, HP 5
  function hitRemoteHuman(x, y) {
    const W = canvas.clientWidth, H = canvas.clientHeight, s = view.scale * HUMAN_SCALE
    for (const [pid, h] of remoteHumans) {
      const hx = h.nx * W, hy = h.ny * H - 15 * s
      if (Math.abs(x - hx) < 16 * s && Math.abs(y - hy) < 22 * s) return { pid, hp: h.hp || HUMAN_HP }
    }
    return null
  }
  // an enemy in PEACE MODE (invincible dome) — shots are stopped at the dome, never reaching the cat
  function safeDomeBlocks(x, y) {
    for (let i = 0; i < catPos.length; i++) {
      const cat = allRef[i], c = catPos[i]
      if (!cat || cat.id === 'me' || !cat.safe || !c) continue
      const cyb = c.y + 30 * view.scale, r = 108 * view.scale
      if (y <= cyb + 8 && Math.hypot(x - c.x, y - cyb) <= r) return c
    }
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
        if (d < core + 6 * view.scale) { spawnDustToHole(me.gatX, me.gatY, b); setGat(false); me.gatCdUntil = now + GAT_CD; break }
        const step = bhForce(d, 9) * view.scale   // whole-screen drag
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
        if (humanKeys.has('q')) {   // Q holds to fire (same key as the human's attack)
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
      { const ah = missileHitsAnt(p.x, p.y); if (ah) { if (!ah.local && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: GAT_DMG })); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue } }
      // MY OWN missiles too → the bullet detonates them (self collision)
      let hitOwnMissile = false
      for (let mi = projectiles.length - 1; mi >= 0; mi--) { const m = projectiles[mi]; if (!m.homing) continue; if (Math.hypot(p.x - m.x, p.y - m.y) < 14 * view.scale + (m.power || 1) * 2) { explode(m.x, m.y, m.power); projectiles.splice(mi, 1); hitOwnMissile = true; break } }
      if (hitOwnMissile) { spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // enemy bullets / missiles → mutual destruction (each side destroys its own on overlap)
      if (hitRemoteGBullet(p.x, p.y) || hitRemoteMissile(p.x, p.y, GAT_DMG)) { spawnSpark(p.x, p.y); bcBoom('gbullet', p.id, p.x, p.y, 1); gbullets.splice(i, 1); continue }
      // enemy gatling turret → damage it
      const rg = hitRemoteGatling(p.x, p.y)
      if (rg) { if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: rg.pid, dmg: GAT_DMG })); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // enemy ant mecha → damage it (bullet consumed)
      const rmcG = hitRemoteMecha(p.x, p.y)
      if (rmcG) { if (connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: rmcG.pid, dmg: GAT_DMG })); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // enemy human summon → damage it (bullet consumed)
      const rhuG = hitRemoteHuman(p.x, p.y)
      if (rhuG) { if (connected()) net.send(JSON.stringify({ t: 'human-hit', target: rhuG.pid, dmg: GAT_DMG, hx: +(p.x / canvas.clientWidth).toFixed(4), hy: +(p.y / canvas.clientHeight).toFixed(4) })); spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // a shield (mine or a peer's) absorbs the bullet
      const sblk = shieldBlocks(p, now)
      if (sblk) {
        if (sblk.id === 'me') hitMyShield(GAT_DMG)
        else if (connected()) net.send(JSON.stringify({ t: 'shield-hit', target: sblk.id, power: GAT_DMG }))
        spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue
      }
      if (safeDomeBlocks(p.x, p.y)) { spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }   // peace-mode dome stops it
      // CHARACTER body → hit reaction (own cat included; respect the cat's shield)
      let hitCat = false
      for (let ci = 0; ci < catPos.length; ci++) {
        const cat = allRef[ci]; if (!cat) continue
        const c = catPos[ci]
        if (Math.hypot(p.x - c.x, p.y - c.y) < 56 * view.scale) {
          if (!catShieldCovers(cat, c, p.x, p.y, now)) applyCatHit(cat, GAT_DMG, now)
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
  function drawGatlings() { for (const g of activeGatlings()) { const a = ctx.globalAlpha; if (!g.mine) ctx.globalAlpha = peerAlpha(g.pid); drawGatling(g); ctx.globalAlpha = a } }   // 👁 dim an opponent's turret
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
      ctx.globalAlpha = peerAlpha(pid)
      const extrap = now - rec.ts < 240
      for (const it of rec.items.values()) {
        if (extrap) { it.nx += it.vx || 0; it.ny += it.vy || 0 }   // dead-reckon fast bullets
        it.sx += (it.nx - it.sx) * 0.5; it.sy += (it.ny - it.sy) * 0.5
        ctx.save(); ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(it.sx * W, it.sy * H, 3.6 * view.scale, 0, Math.PI * 2); ctx.fill(); ctx.restore()
      }
    }
  }
  function drawRemoteHumans(now) {   // peers' summoned humans are now visible
    const W = canvas.clientWidth, H = canvas.clientHeight, s = view.scale * HUMAN_SCALE
    for (const [pid, h] of remoteHumans) {
      ctx.globalAlpha = peerAlpha(pid)
      const x = h.nx * W, y = h.ny * H, f = h.face || 1
      const col = SKIN_BODY[(peers.get(pid) || {}).tint] || SKIN_BODY.default, outline = 'rgba(0,0,0,0.5)'
      const Hh = 34 * s, headR = 6.5 * s, shoulderY = -Hh * 0.74, hipY = -Hh * 0.42, headCY = -Hh + headR
      ctx.save(); ctx.translate(x, y); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 1, 10 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill()
      const limbs = (color, lw) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(3 * s, 0); ctx.moveTo(0, hipY); ctx.lineTo(-3 * s, 0); ctx.moveTo(0, hipY); ctx.lineTo(0, shoulderY); ctx.moveTo(0, shoulderY); ctx.lineTo(-f * 5 * s, shoulderY + 9 * s); ctx.moveTo(0, shoulderY); ctx.lineTo(f * 9 * s, shoulderY + 4 * s); ctx.stroke() }
      limbs(outline, 6 * s); limbs(col, 3.8 * s)
      if (h.weapon) { ctx.save(); ctx.translate(f * 11 * s, shoulderY + 4 * s); ctx.scale(f, 1); const L = (h.weapon === 'rifle' || h.weapon === 'bazooka') ? 30 * s : h.weapon === 'sword' ? 22 * s : 13 * s; drawWeapon(h.weapon, L); ctx.restore() }
      ctx.fillStyle = col; ctx.strokeStyle = outline; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.arc(0, headCY, headR, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#2a2a30'; ctx.beginPath(); ctx.arc(f * headR * 0.4, headCY, 1.5 * s, 0, Math.PI * 2); ctx.fill()
      const hpw = 22 * s, hp01 = Math.max(0, (h.hp || 0) / HUMAN_HP), by = headCY - headR - 6 * s
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-hpw / 2, by, hpw, 3 * s)
      ctx.fillStyle = hp01 > 0.3 ? '#7ecb7e' : '#d05555'; ctx.fillRect(-hpw / 2, by, hpw * hp01, 3 * s)
      ctx.restore()
    }
  }
  function drawRemoteHbullets(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight, s = view.scale
    for (const [pid, rec] of [...remoteHbullets]) {
      if (now - rec.ts > 400) { remoteHbullets.delete(pid); continue }
      ctx.globalAlpha = peerAlpha(pid)
      const extrap = now - rec.ts < 240
      for (const it of rec.items.values()) {
        if (extrap) { it.nx += it.vx || 0; it.ny += it.vy || 0 }   // dead-reckon 검기/총알
        const dx = it.nx - it.sx, dy = it.ny - it.sy
        it.sx += dx * SMOOTH; it.sy += dy * SMOOTH
        const x = it.sx * W, y = it.sy * H, r = Math.max(4 * s, (it.r || 0.004) * W), ang = Math.atan2(dy, dx)
        ctx.save()
        if (it.k === 2) {   // 아도겐 ball
          const grd = ctx.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, 'rgba(235,250,255,0.95)'); grd.addColorStop(0.5, 'rgba(120,200,255,0.8)'); grd.addColorStop(1, 'rgba(80,160,255,0)')
          ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#eaf8ff'; ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, Math.PI * 2); ctx.fill()
        } else if (it.k === 1) {   // 검기 crescent
          ctx.translate(x, y); ctx.rotate(ang); ctx.strokeStyle = 'rgba(150,210,255,0.9)'; ctx.lineWidth = 4.5 * s; ctx.beginPath(); ctx.arc(0, 0, r, -1.15, 1.15); ctx.stroke()
        } else {   // bullet
          ctx.fillStyle = '#fff1b0'; ctx.beginPath(); ctx.arc(x, y, 3 * s, 0, Math.PI * 2); ctx.fill()
        }
        ctx.restore()
      }
    }
  }
  function nearestEnemyGatling(x) {
    let best = null, bd = Infinity, W = canvas.clientWidth
    for (const [pid, g] of remoteGatlings) { const d = Math.abs(g.nx * W - x); if (d < bd) { bd = d; best = { pid, x: g.nx * W, y: g.ny * canvas.clientHeight } } }
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
  // ---- 🛡️ honeycomb shield look (shared by every shield: human plate, mecha dome, safe-mode dome) ----
  function hexPath(x, y, r) {   // pointy-top hexagon
    ctx.beginPath()
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 90), px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py) }
    ctx.closePath()
  }
  // stroke a honeycomb lattice covering radius R around (cx,cy); caller sets clip + stroke style
  function honeycomb(cx, cy, R, r) {
    const dx = Math.sqrt(3) * r, dy = 1.5 * r
    const rows = Math.ceil(R / dy) + 2, cols = Math.ceil(R / dx) + 2
    for (let row = -rows; row <= rows; row++) {
      const oy = cy + row * dy, off = (row & 1) ? dx / 2 : 0
      for (let col = -cols; col <= cols; col++) {
        const ox = cx + col * dx + off
        if (Math.hypot(ox - cx, oy - cy) > R) continue
        hexPath(ox, oy, r * 0.9); ctx.stroke()
      }
    }
  }
  function shieldTint(hp) { const h = Math.max(0, Math.min(1, hp)); return { r: Math.round(120 + 135 * (1 - h)), g: Math.round(205 - 120 * (1 - h)), b: Math.round(255 - 175 * (1 - h)) } }
  // energy DOME (hemisphere sitting on the ground at base y=cyb) with a honeycomb surface + base rings.
  // Matches the reference: translucent blue dome, hex lattice, concentric ground rings. Used by the
  // safe-mode shield; full-sphere variant (drawHexBubble) wraps the floating ant mecha.
  function drawHexDome(cx, cyb, r, hp01, now, hemi = true) {
    const hp = Math.max(0, Math.min(1, hp01)), c = shieldTint(hp), col = (a) => `rgba(${c.r},${c.g},${c.b},${a})`
    const a0 = Math.PI, a1 = hemi ? 2 * Math.PI : 3 * Math.PI   // hemi = top half only; else full circle
    let flick = 1; if (hp < 0.4) flick = 0.6 + 0.4 * Math.abs(Math.sin(now / 60))
    ctx.save(); ctx.globalAlpha *= flick
    // glassy fill
    ctx.beginPath(); hemi ? (ctx.arc(cx, cyb, r, Math.PI, 2 * Math.PI), ctx.closePath()) : ctx.arc(cx, cyb, r, 0, 2 * Math.PI)
    const g = ctx.createRadialGradient(cx, cyb - (hemi ? r * 0.35 : 0), r * 0.2, cx, cyb - (hemi ? r * 0.35 : 0), r)
    g.addColorStop(0, col(0.05)); g.addColorStop(0.72, col(0.14)); g.addColorStop(1, col(0.34))
    ctx.fillStyle = g; ctx.fill()
    // honeycomb clipped to the dome
    ctx.save(); ctx.beginPath(); hemi ? (ctx.arc(cx, cyb, r * 0.99, Math.PI, 2 * Math.PI), ctx.closePath()) : ctx.arc(cx, cyb, r * 0.99, 0, 2 * Math.PI); ctx.clip()
    ctx.globalAlpha *= 0.45; ctx.strokeStyle = col(0.85); ctx.lineWidth = 1 * view.scale
    honeycomb(cx, cyb - (hemi ? r * 0.42 : 0), r * 1.15, r * 0.17)
    ctx.restore()
    // bright rim
    ctx.beginPath(); ctx.arc(cx, cyb, r, a0, a1 === 3 * Math.PI ? 2 * Math.PI : a1); ctx.strokeStyle = col(0.9); ctx.lineWidth = 2.4 * view.scale; ctx.stroke()
    // ground rings (dome only)
    if (hemi) for (const rr of [r * 1.02, r * 0.78, r * 0.55]) { ctx.beginPath(); ctx.ellipse(cx, cyb, rr, rr * 0.16, 0, 0, Math.PI * 2); ctx.strokeStyle = col(0.5); ctx.lineWidth = 1.6 * view.scale; ctx.stroke() }
    ctx.restore()
  }
  function drawHexBubble(cx, cy, r, hp01, now) { drawHexDome(cx, cy, r, hp01, now, false) }
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
    let a = alpha * ctx.globalAlpha   // scale by any dim wrapper (opponent 👁 fade)
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
    // honeycomb lattice across the plate (clipped to the band)
    ctx.save(); platePath(); ctx.clip()
    ctx.globalAlpha = a * 0.5; ctx.strokeStyle = col(0.8); ctx.lineWidth = 0.9 * sc
    honeycomb(cx + Math.cos(angle) * D, cy + Math.sin(angle) * D, D * half + t * 2.5, 6 * sc)
    ctx.restore(); ctx.globalAlpha = a
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
      if (now < until) { const a = ctx.globalAlpha; if (cat.id !== 'me') ctx.globalAlpha = peerAlpha(cat.id); drawShield(c.x, c.y, ang, shieldAlpha(until, now), view.scale, hp01); ctx.globalAlpha = a }
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
  // a hole dug clean through the taskbar at x → things standing here fall in
  function taskbarHoleAt(x) { const tb = taskbarRect(); return !!tb && carveDepthAt(x) >= tb.h * 0.88 }
  function spawnFallFx(x, y) {   // "fell into the pit" — a little dark dust dropping DOWN into the hole (no blast)
    for (let k = 0; k < 8; k++) { const sx = (Math.random() - 0.5) * 14; debris.push({ x: x + sx, y, vx: sx * 0.05, vy: 1.5 + Math.random() * 2.5, born: performance.now(), life: 450 + Math.random() * 250, sz: 1.6 + Math.random() * 2, color: k % 2 ? '#2a2a32' : '#4a4e5a' }) }
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
    const ci = Math.round(x / CARVE_SEG), rad = Math.min(42, Math.max(1, Math.round(power * 8))), maxD = tb.h + 14   // dig past the bottom edge (no leftover line)
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
  const ANT_HP = 1
  const ANT_DRAW = 2   // ant visual size multiplier (on top of view.scale)
  // per-player ant color — tied to the owner's fur skin so each player's ants are distinct
  const ANT_COLORS = { default: '#5b5b66', cream: '#caa96a', gray: '#7b8290', brown: '#7a4a2a', black: '#26262e', orange: '#e0862a', pink: '#e06a95', mint: '#2fa98c', lavender: '#8f6ad6' }
  function antColor(skin) { return ANT_COLORS[skin] || ANT_COLORS.default }
  function mixHex(a, b, t) {   // blend two #rrggbb hex colors (t=0→a, 1→b)
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
    const r = Math.round((pa >> 16) + (((pb >> 16) - (pa >> 16)) * t))
    const g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t))
    const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t))
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)
  }
  let nextAntId = 1
  // Ants stand ON the taskbar's top boundary line (feet on the line, body above it) — not
  // sunk inside the bar. Falls back to the screen bottom if there's no detectable taskbar.
  // ants stand on the DUG surface at their x (dip into pits), not the flat taskbar top
  function antGroundY(x) { const tb = taskbarRect(); return (tb ? tb.top + carveDepthAt(x || 0) : canvas.clientHeight) - 5 * view.scale }
  // the big mecha stands on the taskbar SURFACE (bridges craters instead of sinking into them),
  // and only falls when a through-hole spans its whole footing — not on a single narrow blast pit.
  // the big mecha follows the DUG terrain — it rests on the shallowest point under its wide feet, so it
  // sinks into wide craters (affected by digging) but bridges narrow blast pits (doesn't nose-dive into one).
  function mechaGroundY(x) {
    const tb = taskbarRect(); if (!tb) return canvas.clientHeight - 1
    const cx = x != null ? x : me.mechaX, span = 14 * mechaScale()
    let minCarve = Infinity
    for (const dx of [-span, -span / 2, 0, span / 2, span]) minCarve = Math.min(minCarve, carveDepthAt(cx + dx))
    return tb.top + minCarve - 1
  }
  function mechaOverHole(x) {
    const tb = taskbarRect(); if (!tb) return false
    const span = 16 * mechaScale()
    for (const dx of [-span, 0, span]) if (carveDepthAt(x + dx) < tb.h * 0.88) return false
    return true
  }
  function summonAnt() {
    if (ants.filter((a) => !a.dead).length >= antMax()) return
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
  // brief red splat that lingers where something died, then fades
  const bloodStains = []
  function addBloodStain(x, y, r) {
    const blobs = []
    for (let k = 0; k < 5; k++) { const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.6; blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.7, rr: r * (0.28 + Math.random() * 0.5) }) }
    bloodStains.push({ x, y, born: performance.now(), life: 1500, blobs })
    if (bloodStains.length > 40) bloodStains.shift()
  }
  function drawBloodStains(now) {
    for (let i = bloodStains.length - 1; i >= 0; i--) {
      const st = bloodStains[i], t = (now - st.born) / st.life
      if (t >= 1) { bloodStains.splice(i, 1); continue }
      ctx.save(); ctx.fillStyle = `rgba(150,15,22,${(1 - t) * 0.55})`
      for (const b of st.blobs) { ctx.beginPath(); ctx.ellipse(st.x + b.dx, st.y + b.dy, b.rr, b.rr * 0.7, 0, 0, Math.PI * 2); ctx.fill() }
      ctx.restore()
    }
  }
  function antTakeDmg(ant, dmg) {
    if (ant.dead) return
    ant.hp -= dmg; spawnBlood(ant.x, ant.y, Math.min(dmg + 1, 3))
    if (ant.hp <= 0) { ant.dead = true; ant.deadAt = performance.now(); spawnBlood(ant.x, ant.y, 12); addBloodStain(ant.x, ant.y, 11 * view.scale) }   // death: bigger burst + lingering stain
  }
  function missileHitsAnt(x, y) {
    const rr = 18 * view.scale   // cover the ant's full sprite so a direct hit detonates on it (not just splash)
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
      if (a.falling) {   // fell into a dug-through hole → drop straight down, remove once fully off-screen
        a.fallVy = (a.fallVy || 1) + 0.55; a.y += a.fallVy; a.step += 0.5
        drawAnt(a, now, false, myCol)
        if (a.y - 14 > canvas.clientHeight) ants.splice(i, 1)   // gone below the screen
        continue
      }
      // black hole pull overrides falling + AI; reaching the core dust-consumes the ant (whole-screen)
      let hole = null, hbest = Infinity
      for (const b of activeBlackholes(now)) { const dd = Math.hypot(b.x - a.x, b.y - a.y); if (dd < hbest) { hbest = dd; hole = b } }
      if (hole) {
        const dx = hole.x - a.x, dy = hole.y - a.y, d = hbest || 1
        if (d < BH_CORE * W) { spawnDustToHole(a.x, a.y, hole); if (hole.mine) addAntKill(); ants.splice(i, 1); continue }
        const sp = bhForce(d, 10)
        a.x += (dx / d) * sp; a.y += (dy / d) * sp; a.onGround = false
        a.dir = dx >= 0 ? 1 : -1; a.step += 0.4
        drawAnt(a, now, false, myCol); continue
      }
      if (a.tossed) {   // thrown out of a net → parabolic flight, then resume crawling on landing
        a.tvy += 0.34; a.x += a.tvx; a.y += a.tvy; a.tvx *= 0.998; a.step += 0.5   // low gravity + little air drag = long arc
        if (a.x < 8) { a.x = 8; a.tvx = Math.abs(a.tvx) } if (a.x > W - 8) { a.x = W - 8; a.tvx = -Math.abs(a.tvx) }
        const g2 = antGroundY(a.x)
        if (a.tvy >= 0 && a.y >= g2) {
          a.y = g2; a.vy = 0; a.tossed = false; a.onGround = true
          if (a.tossKill) { a.tossKill = false; antTakeDmg(a, 99); continue }   // thrown hard → splat on impact
        }
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
      if (dAnt <= dGat && eAnt) tgt = { x: eAnt.s.x, y: eAnt.s.y, msg: { t: 'ant-hit', target: eAnt.pid, ant: eAnt.s.id, dmg: 1 } }
      else if (eGat) tgt = { x: eGat.x, y: eGat.y, msg: { t: 'gat-hit', target: eGat.pid, dmg: 1 } }
      let moving = true
      if (tgt) {                                // march toward the nearest enemy
        a.dir = tgt.x >= a.x ? 1 : -1
        if (Math.abs(tgt.x - a.x) <= 22 && Math.abs((tgt.y != null ? tgt.y : a.y) - a.y) <= 42 * view.scale) {   // melee range: must be at ~ground level too (can't bite an airborne target)
          moving = false
          if (now >= a.atkCd) { a.atkCd = now + 600; a.atkFlash = now + 220; spawnBlood(tgt.x, a.y - 4 * view.scale, 5); if (connected()) net.send(JSON.stringify(tgt.msg)) }   // bite: lunge + red burst at the target
        }
      } else if (now >= a.wanderUntil) {
        a.wanderUntil = now + 700 + Math.random() * 1400; if (Math.random() < 0.35) a.dir *= -1
      }
      if (moving) { a.x += a.dir * 0.9; if (a.x < 8) { a.x = 8; a.dir = 1 } if (a.x > W - 8) { a.x = W - 8; a.dir = -1 } a.step += 0.35 }
      if (taskbarHoleAt(a.x)) { a.falling = true; a.fallVy = 1; a.fallStart = now; spawnFallFx(a.x, a.y) }   // over a hole → start falling from the surface
      else a.y = gy
      drawAnt(a, now, !moving, myCol)
    }
  }
  function drawRemoteAnts(now) {
    const W = canvas.clientWidth
    for (const [pid, rec] of [...remoteAnts]) {
      if (now - rec.ts > 1000) { remoteAnts.delete(pid); continue }
      ctx.globalAlpha = peerAlpha(pid)
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
    if (power >= 10) return '#2f4a2a'   // NUKE — dark olive
    const t = Math.min(1, (power - 1) / 8)
    const lerp = (a, b) => Math.round(a + (b - a) * t)
    return `rgb(${lerp(225, 255)},${lerp(75, 207)},${lerp(75, 51)})`   // red → gold as it merges
  }
  function missileScale(power) { return 1 + Math.min(power - 1, 9) * 0.16 }   // up to power 10

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
        ctx.save(); ctx.globalAlpha *= 0.5; ctx.fillStyle = i % 2 ? '#ffd166' : '#8ec5ff'
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore()
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
    if (power >= 10) {   // ☢ NUKE — pulsing green glow + radiation trefoil on the body
      ctx.save(); ctx.globalAlpha = 0.35 + 0.2 * Math.sin(now / 110)
      const ng = ctx.createRadialGradient(0, 0, 2, 0, 0, 24); ng.addColorStop(0, 'rgba(130,255,120,0.7)'); ng.addColorStop(1, 'rgba(60,180,60,0)')
      ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill(); ctx.restore()
      ctx.save(); ctx.translate(-3, 0)
      ctx.fillStyle = '#ffe600'; ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#1a1a1a'
      for (let b = 0; b < 3; b++) { const a0 = b * 2.094 - 0.52; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 4.6, a0, a0 + 1.05); ctx.closePath(); ctx.fill() }
      ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, Math.PI * 2); ctx.fillStyle = '#ffe600'; ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }

  function drawExplosion(x, y, t, power = 1) {
    const nuke = power >= 10
    const boom = 1 + Math.min(power - 1, 9) * (nuke ? 0.5 : 0.35)
    const gold = power > 3
    ctx.save(); ctx.translate(x, y); ctx.scale(boom, boom)
    const ease = 1 - Math.pow(1 - t, 2)
    // white-hot core + a second softer flash for punch
    ctx.globalAlpha = Math.max(0, 1 - t * 1.4); ctx.fillStyle = nuke ? '#eaffea' : (gold ? '#fff0b0' : '#fff3c4')
    ctx.beginPath(); ctx.arc(0, 0, 8 + ease * 20, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = Math.max(0, 0.7 - t); ctx.fillStyle = nuke ? 'rgba(150,230,120,0.6)' : 'rgba(255,180,60,0.55)'
    ctx.beginPath(); ctx.arc(0, 0, 14 + ease * 30, 0, Math.PI * 2); ctx.fill()
    // shockwave ring(s)
    ctx.globalAlpha = Math.max(0, 1 - t); ctx.strokeStyle = nuke ? '#8fe66a' : (gold ? '#ffcf33' : '#ff9d33'); ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(0, 0, 10 + ease * 34, 0, Math.PI * 2); ctx.stroke()
    if (power > 3) { ctx.globalAlpha = Math.max(0, 0.8 - t); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 4 + ease * 52, 0, Math.PI * 2); ctx.stroke() }
    ctx.strokeStyle = nuke ? '#b6f58a' : '#ffcf47'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
    const spokes = nuke ? 16 : (gold ? 12 : 8)
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2, r0 = 12 + ease * 20, r1 = 12 + ease * (nuke ? 52 : 38)
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke()
    }
    if (nuke) {   // rising mushroom cloud (radioactive green)
      const rise = ease * 46; ctx.globalAlpha = Math.max(0, 0.85 - t)
      ctx.fillStyle = 'rgba(120,200,90,0.55)'
      ctx.beginPath(); ctx.roundRect(-6, -rise, 12, rise + 4, 5); ctx.fill()                                   // stem
      ctx.beginPath(); ctx.ellipse(0, -rise, 20 + ease * 8, 13 + ease * 6, 0, 0, Math.PI * 2); ctx.fill()      // cap
      ctx.fillStyle = 'rgba(180,240,150,0.5)'; ctx.beginPath(); ctx.ellipse(0, -rise, 12, 8, 0, 0, Math.PI * 2); ctx.fill()
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
      for (const [id, it] of rec.items) {
        const sx = it.sx * W, sy = it.sy * H
        if (Math.hypot(x - sx, y - sy) < 16 + (power + (it.power || 1)) * 2) return { x: sx, y: sy, power: it.power || 1, pid, id }
      }
    }
    return null
  }
  function drawRemoteMissiles(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const [pid, rec] of [...remoteMissiles]) {
      if (now - rec.ts > 500) { remoteMissiles.delete(pid); continue }
      ctx.globalAlpha = peerAlpha(pid)
      const extrap = now - rec.ts < 240   // dead-reckon only right after an update (avoids runaway on hiccups)
      for (const it of rec.items.values()) {
        if (extrap) { it.nx += it.vx || 0; it.ny += it.vy || 0 }   // move the estimate at the missile's own velocity
        const px = it.sx, py = it.sy
        it.sx += (it.nx - it.sx) * SMOOTH; it.sy += (it.ny - it.sy) * SMOOTH
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
      applyCatHit(cat, power, now)
      if (cat.id !== 'me') addCatHit()   // achievement: enemy-cat missile hit
    }
  }

  // ☢ Little Boy: two 10-merged nukes fusing. To stay identical on every screen, the LOWER-netId
  // player is authoritative — it spawns the bomb, broadcasts its spot, and is the only one that
  // applies blast damage (via relays); everyone else just renders the same falling bomb + blast.
  function triggerLittleBoy(x, y, otherPid) {
    for (let k = 0; k < 16; k++) spawnSpark(x + (Math.random() - 0.5) * 52 * view.scale, y + (Math.random() - 0.5) * 52 * view.scale)   // fusion flash
    addEffect(x, y, 4)
    const spawner = !connected() || otherPid == null || (me.netId != null && me.netId < otherPid)
    if (spawner) {
      spawnLittleBoy(x, y, true)
      if (connected() && net) net.send(JSON.stringify({ t: 'littleboy', nx: +(x / canvas.clientWidth).toFixed(4), ny: +(y / canvas.clientHeight).toFixed(4) }))
    }
    // the higher-netId client waits for the 'littleboy' broadcast to spawn its (visual) bomb at the same spot
  }
  function spawnLittleBoy(x, y, damaging) { littleBoys.push({ x, y, vy: -2 * view.scale, damaging, born: performance.now() }) }
  function stepLittleBoys(now) {
    for (let i = littleBoys.length - 1; i >= 0; i--) {
      const b = littleBoys[i]
      b.vy += 0.62 * view.scale; b.y += b.vy
      const ground = antGroundY(b.x)
      if (b.y >= ground) { b.y = ground; detonateLittleBoy(b); littleBoys.splice(i, 1); continue }
      drawLittleBoy(b, now)
    }
  }
  function detonateLittleBoy(b) {
    const x = b.x, y = b.y, R = blastRadius(10) * 3
    addEffect(x, y, 16); addEffect(x, y - 20 * view.scale, 12)   // huge double flash
    for (let k = 0; k < 44; k++) spawnDebris(x + (Math.random() - 0.5) * R, y, 1, k % 2 ? '#6a5a4a' : '#3a3a42')
    if (inTaskbar(x, y)) carveTaskbar(x, 2.2)   // massive crater
    if (b.damaging) nukeBlast(x, y, LITTLEBOY_DMG, R)
  }
  // AoE damage to EVERY collidable (except the caster's own? no — a nuke hits all) within R. Only the
  // authoritative (damaging) bomb runs this; local entities damaged directly, remote via relays.
  function nukeBlast(x, y, dmg, R) {
    const now = performance.now(), W = canvas.clientWidth, H = canvas.clientHeight
    for (const a of ants) if (!a.dead && Math.hypot(x - a.x, y - a.y) <= R) { antTakeDmg(a, dmg); if (a.dead) addAntKill() }
    for (const [pid, rec] of remoteAnts) { if (now - rec.ts > 800) continue; for (const a of rec.items.values()) { if (a.dead) continue; const s = remoteAntScreenPos(pid, a); if (s && Math.hypot(x - s.x, y - s.y) <= R && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: a.id, dmg })) } }
    for (let i = 0; i < catPos.length; i++) { const cat = allRef[i], c = catPos[i]; if (!cat || !c) continue; if (Math.hypot(x - c.x, y - c.y) > R + 30 * view.scale) continue; if (catShieldCovers(cat, c, x, y, now)) continue; applyCatHit(cat, dmg, now); if (cat.id !== 'me') addCatHit() }
    if (me.gatActive && Math.hypot(x - me.gatX, y - me.gatY) <= R) damageMyGatling(dmg)
    for (const [pid, g] of remoteGatlings) if (Math.hypot(x - g.nx * W, y - g.ny * H) <= R && connected()) net.send(JSON.stringify({ t: 'gat-hit', target: pid, dmg }))
    if (me.mechaActive && Math.hypot(x - me.mechaX, y - (me.mechaY - 20 * mechaScale())) <= R) mechaTakeDmg(dmg, now)
    for (const [pid, m] of remoteMechas) if (Math.hypot(x - m.nx * W, y - m.ny * H) <= R && connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: pid, dmg }))
    if (me.humanActive && Math.hypot(x - me.humanX, y - me.humanY) <= R) humanTakeDmg(dmg, now)
    for (const [pid, h] of remoteHumans) if (Math.hypot(x - h.nx * W, y - h.ny * H) <= R && connected()) net.send(JSON.stringify({ t: 'human-hit', target: pid, dmg, hx: +(x / W).toFixed(4), hy: +(y / H).toFixed(4) }))
  }
  function drawLittleBoy(b, now) {   // Little Boy bomb, falling nose-down — narrow tail, FAT bulbous warhead
    const s = view.scale * 4.4, x = b.x, y = b.y   // 2× the old size
    ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    const olive = '#6b7043', dark = '#565b34', darker = '#4a4e2c'
    // fat rounded warhead (lower / bottom) — much wider than the tail
    ctx.fillStyle = olive
    ctx.beginPath()
    ctx.moveTo(-4 * s, -12 * s)
    ctx.quadraticCurveTo(-7.5 * s, -8 * s, -7.5 * s, 0)          // bulge out
    ctx.quadraticCurveTo(-7.5 * s, 9 * s, 0, 13 * s)             // rounded bottom nose
    ctx.quadraticCurveTo(7.5 * s, 9 * s, 7.5 * s, 0)
    ctx.quadraticCurveTo(7.5 * s, -8 * s, 4 * s, -12 * s)
    ctx.closePath(); ctx.fill()
    // narrow tail cylinder (upper)
    ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(-4 * s, -24 * s, 8 * s, 13 * s, 2.5 * s); ctx.fill()
    ctx.fillStyle = olive; ctx.beginPath(); ctx.ellipse(0, -12 * s, 4 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill()   // seam
    // banding rings on the fat warhead
    ctx.strokeStyle = 'rgba(20,22,14,0.5)'; ctx.lineWidth = 1 * s
    ctx.beginPath(); ctx.moveTo(-7 * s, -1 * s); ctx.quadraticCurveTo(0, 3 * s, 7 * s, -1 * s); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(-5.5 * s, 6 * s); ctx.quadraticCurveTo(0, 9.5 * s, 5.5 * s, 6 * s); ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(-2.5 * s, 0, 1.6 * s, 6 * s, 0.2, 0, Math.PI * 2); ctx.stroke()   // sheen
    // 4 box tail fins at the very top
    ctx.fillStyle = darker
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 4 * s, -26 * s); ctx.lineTo(sx * 9 * s, -32 * s); ctx.lineTo(sx * 9 * s, -19 * s); ctx.lineTo(sx * 4 * s, -17 * s); ctx.closePath(); ctx.fill() }
    ctx.fillStyle = '#3a3d24'; ctx.fillRect(-1.6 * s, -32 * s, 3.2 * s, 12 * s)
    ctx.restore()
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
        const px0 = p.x, py0 = p.y   // pre-move position for swept collision (fast missiles must not tunnel)
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
        if (safeDomeBlocks(p.x, p.y)) { addEffect(p.x, p.y, p.power); spawnSpark(p.x, p.y); projectiles.splice(i, 1); continue }   // peace-mode dome stops it
        // UNIFIED COLLISION for HP targets (gatling/ant): mutual attrition. The target loses the
        // missile's power; the missile loses the target's HP. If power > HP the target dies and the
        // missile PUNCHES THROUGH with reduced power (shrinks); otherwise the missile detonates.
        const pierceReady = now >= (p.pierceCd || 0)
        const rgm = pierceReady ? hitRemoteGatling(p.x, p.y) : null
        if (rgm) {
          if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: rgm.pid, dmg: p.power }))
          addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y)
          if (p.power > rgm.hp) { p.power -= rgm.hp; p.pierceCd = now + 140 }   // punch through, shrink
          else { explode(p.x, p.y, p.power); bcBoom('missile', p.mid, p.x, p.y, p.power); projectiles.splice(i, 1); continue }
        }
        // an enemy ant mecha (ant/human form): same HP-based punch-through rule (HP 25 → usually detonates)
        const rmc = pierceReady ? hitRemoteMecha(p.x, p.y) : null
        if (rmc) {
          if (connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: rmc.pid, dmg: p.power }))
          addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y)
          if (p.power > rmc.hp) { p.power -= rmc.hp; p.pierceCd = now + 140 }   // punch through, shrink
          else { explode(p.x, p.y, p.power); bcBoom('missile', p.mid, p.x, p.y, p.power); projectiles.splice(i, 1); continue }
        }
        // an enemy human summon: same rule (HP 5). Its cursor shield can block (checked on the owner's side).
        const rhu = pierceReady ? hitRemoteHuman(p.x, p.y) : null
        if (rhu) {
          if (connected()) net.send(JSON.stringify({ t: 'human-hit', target: rhu.pid, dmg: p.power, hx: +(p.x / canvas.clientWidth).toFixed(4), hy: +(p.y / canvas.clientHeight).toFixed(4) }))
          addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y)
          if (p.power > rhu.hp) { p.power -= rhu.hp; p.pierceCd = now + 140 }   // punch through, shrink
          else { explode(p.x, p.y, p.power); bcBoom('missile', p.mid, p.x, p.y, p.power); projectiles.splice(i, 1); continue }
        }
        // a drawn platform is solid: detonate on it and chip its HP (swept so fast missiles can't tunnel)
        const psw = platformSweep(px0, py0, p.x, p.y)
        if (psw) { damagePlatform(psw.pl, p.power); explode(psw.hx, psw.hy, p.power); bcBoom('missile', p.mid, psw.hx, psw.hy, p.power); projectiles.splice(i, 1); continue }
        const ah = pierceReady ? missileHitsAnt(p.x, p.y) : null   // ant HP = 1
        if (ah) {
          if (ah.local) { antTakeDmg(ah.ant, 99); if (ah.ant.dead) addAntKill() }
          else if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: 99 }))
          addEffect(p.x, p.y, 1)
          if (p.power > 1) { p.power -= 1; p.pierceCd = now + 90 }   // punch through the ant, shrink
          else { explode(p.x, p.y, p.power); bcBoom('missile', p.mid, p.x, p.y, p.power); projectiles.splice(i, 1); continue }
        }
        // missile vs an enemy missile → mutual attrition (bigger punches through, shrinks; both die if equal).
        // Symmetric on both machines: each keeps its missile only if its power exceeds the other's.
        const rmm = pierceReady ? hitRemoteMissile(p.x, p.y, p.power) : null
        if (rmm) {
          // damage THEIR missile authoritatively (owner resolves + broadcasts) → both sides agree
          if (connected()) net.send(JSON.stringify({ t: 'col-dmg', target: rmm.pid, kind: 'missile', eid: rmm.id, dmg: p.power }))
          if (p.power >= 10 && (rmm.power || 1) >= 10) {   // ☢ NUKE + NUKE → fuse into a falling Little Boy
            triggerLittleBoy((p.x + rmm.x) / 2, (p.y + rmm.y) / 2, rmm.pid)
            bcBoom('missile', p.mid, p.x, p.y, p.power); projectiles.splice(i, 1); continue
          }
          addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y)
          if (p.power > (rmm.power || 1)) { p.power -= (rmm.power || 1); p.pierceCd = now + 120 }   // punch through, shrink
          else { explode(p.x, p.y, p.power); bcBoom('missile', p.mid, p.x, p.y, p.power); projectiles.splice(i, 1); continue }
        }
        // cat (SOLID — always detonates), peer gatling bullet, OR taskbar
        if (hitTestCats(p.x, p.y) || hitRemoteGBullet(p.x, p.y) || inTaskbar(p.x, p.y)) {
          explode(p.x, p.y, p.power); bcBoom('missile', p.mid, p.x, p.y, p.power)
          projectiles.splice(i, 1); continue
        }
        drawMissile(p.x, p.y, Math.atan2(p.vy, p.vx), now, p.power, p.boost)
        continue
      }

      const t = (now - p.born) / p.dur
      if (t >= 1) {
        addEffect(p.tx, p.ty, 1)
        const cat = allRef.find((c) => c.id === p.targetId)
        if (cat) applyCatHit(cat, 1, now)
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
  let sentMissiles = false, sentShield = false, sentAnts = false, sentBh = false, sentGat = false, sentGB = false, sentHuman = false, sentHB = false, sentNet = false, sentMecha = false, sentMShells = false
  let mshellId = 1
  let lastPos = { nx: -1, ny: -1, taps: -1, hp: -1, away: -1, at: 0 }   // skip identical pos (idle rooms); 1s heartbeat for late joiners
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
        list: mine.map((m) => ({ id: m.mid, nx: +(m.x / NW).toFixed(4), ny: +(m.y / NH).toFixed(4), vx: +(m.vx / NW).toFixed(5), vy: +(m.vy / NH).toFixed(5), power: m.power }))
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
      net.send(JSON.stringify({ t: 'gbullets', list: gbullets.slice(-40).map((p) => ({ id: p.id, nx: +(p.x / NW).toFixed(4), ny: +(p.y / NH).toFixed(4), vx: +(p.vx / NW).toFixed(5), vy: +(p.vy / NH).toFixed(5) })) }))
    } else if (sentGB) { net.send(JSON.stringify({ t: 'gbullets', list: [] })); sentGB = false }

    if (me.humanActive) {   // human is local-authoritative but now VISIBLE to peers
      sentHuman = true
      net.send(JSON.stringify({ t: 'human', active: 1, nx: +(me.humanX / NW).toFixed(4), ny: +(me.humanY / NH).toFixed(4), hp: me.humanHp, weapon: me.humanWeapon || '', face: me.humanFace || 1 }))
    } else if (sentHuman) { net.send(JSON.stringify({ t: 'human', active: 0 })); sentHuman = false }
    if (me.mechaActive) {
      sentMecha = true
      net.send(JSON.stringify({ t: 'mecha', active: 1, nx: +(me.mechaX / NW).toFixed(4), ny: +(me.mechaY / NH).toFixed(4), hp: me.mechaHp, face: me.mechaFace || 1, shield: +(me.mechaShieldHp / MSHIELD_HP).toFixed(2), form: +(me.mechaForm || 0).toFixed(2), thr: me.mechaThrust ? 1 : 0, ch: me.mechaCharging ? 1 : 0, chg: +(me.mechaCharge || 0).toFixed(2), sdep: +(me.mechaShieldDeploy || 0).toFixed(2), snx: +((me.mechaShieldX != null ? me.mechaShieldX : me.mechaX) / NW).toFixed(4), sny: +((me.mechaShieldY != null ? me.mechaShieldY : me.mechaY) / NH).toFixed(4), sang: +(me.mechaShieldAng || 0).toFixed(2) }))
    } else if (sentMecha) { net.send(JSON.stringify({ t: 'mecha', active: 0 })); sentMecha = false }
    // all mecha projectiles share one channel, tagged by kind (0=ant shell, 1=energy, 2=interceptor)
    const allMShells = mechaShells.map((p) => ({ p, k: 0 })).concat(energyShots.map((p) => ({ p, k: 1 }))).concat(interceptors.map((p) => ({ p, k: 2 })))
    if (allMShells.length) {
      sentMShells = true
      net.send(JSON.stringify({ t: 'mshells', list: allMShells.slice(-48).map(({ p, k }) => { if (!p.id) p.id = mshellId++; return { id: p.id, k, pw: p.power || 0, nx: +(p.x / NW).toFixed(4), ny: +(p.y / NH).toFixed(4), vx: +(p.vx / NW).toFixed(5), vy: +(p.vy / NH).toFixed(5) } }) }))
    } else if (sentMShells) { net.send(JSON.stringify({ t: 'mshells', list: [] })); sentMShells = false }
    if (hbullets.length) {
      sentHB = true
      net.send(JSON.stringify({ t: 'hbullets', list: hbullets.slice(-30).map((p) => { if (!p.id) p.id = hbId++; return { id: p.id, nx: +(p.x / NW).toFixed(4), ny: +(p.y / NH).toFixed(4), vx: +(p.vx / NW).toFixed(5), vy: +(p.vy / NH).toFixed(5), k: p.adogen ? 2 : (p.wave ? 1 : 0), r: +((p.waveR ? (p.waveR * (p.hp0 ? p.hp / p.hp0 : 1)) : 3 * view.scale) / NW).toFixed(4) } }) }))
    } else if (sentHB) { net.send(JSON.stringify({ t: 'hbullets', list: [] })); sentHB = false }
    if (me.netActive) {
      sentNet = true
      const anX = me.netPhase === 'cast' ? me.netOX : cursor.x, anY = me.netPhase === 'cast' ? me.netOY : cursor.y
      net.send(JSON.stringify({ t: 'net', active: 1, ph: me.netPhase === 'cast' ? 1 : 0, ax: +(anX / NW).toFixed(4), ay: +(anY / NH).toFixed(4), bx: +(me.netBx / NW).toFixed(4), by: +(me.netBy / NH).toFixed(4), sp: +((me.netSpread || NET_R * view.scale) / NW).toFixed(4), items: me.netCaught.slice(0, 12).map((c) => c.kind), n: me.netCaught.length }))
    } else if (sentNet) { net.send(JSON.stringify({ t: 'net', active: 0 })); sentNet = false }

    // DEV (platform authority): broadcast the platform list (on change) + the live stroke (throttled)
    if (isDev) {
      if (platformsDirty) { net.send(JSON.stringify({ t: 'platforms', list: serializePlatforms() })); platformsDirty = false; platHpDirty.clear() }
      else if (platHpDirty.size) {   // HP-only change → send a tiny delta instead of the whole geometry
        const ups = []; for (const id of platHpDirty) { const pl = platforms.find((p) => p.id === id); if (pl) ups.push({ id, hp: pl.hp }) }
        platHpDirty.clear(); if (ups.length) net.send(JSON.stringify({ t: 'plathp', ups }))
      }
      if (platformMode && curStroke) {
        if (now - lastPlatDraw > 100) { lastPlatDraw = now; net.send(JSON.stringify({ t: 'platdraw', p: curStroke.pts.flatMap((pt) => [+(pt.x / NW).toFixed(4), +(pt.y / NH).toFixed(4)]) })) }
        wasDrawing = true
      } else if (wasDrawing) { wasDrawing = false; net.send(JSON.stringify({ t: 'platdraw', p: [] })) }   // clear the ghost when the stroke ends
    }

    // my widget position (normalized 0..1 to my screen) + interaction count, so peers place
    // my cat where I put it and can see my counter
    if (wx != null) {
      const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1
      const nx = +(wx / W).toFixed(4), ny = +(wy / H).toFixed(4), aw = me.away ? 1 : 0, sf = me.safeMode ? 1 : 0
      // only send when something changed; heartbeat every 1s so late joiners still place my cat
      if (nx !== lastPos.nx || ny !== lastPos.ny || tapCount !== lastPos.taps || me.hp !== lastPos.hp || aw !== lastPos.away || sf !== lastPos.safe || now - lastPos.at > 1000) {
        net.send(JSON.stringify({ t: 'pos', nx, ny, taps: tapCount, hp: me.hp, away: aw, safe: sf }))
        lastPos = { nx, ny, taps: tapCount, hp: me.hp, away: aw, safe: sf, at: now }
      }
    }
  }, 50)   // ~20 updates/s — higher rate so remote missiles/ants move smoother

  // ---------- widget placement + click-through management ----------
  // The window covers the whole screen. The cat "widget" (cat + desk + bottom bar)
  // sits at a draggable spot; everywhere else the window is click-through so it never
  // blocks your normal desktop use. Interactive only while the cursor is over the widget.
  const SCALE = 0.62   // widget (cat + desk + bar) size (counter text stays CSS-sized)
  const BAR_SPACE = 34 // room below the cell for the DOM #hud-bar
  const GRID_COLS = 10, GRID_ROWS = 6   // drag-snap preset anchors
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
  // an anchor is "taken" if a peer's widget sits on/near it (so two players can't share a preset)
  function anchorOccupied(a) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    for (const p of peers.values()) {
      if (p.nx == null || p.ny == null) continue
      if (Math.abs(p.nx * W - a.x) < cellPxW * 0.6 && Math.abs(p.ny * H - a.y) < cellPxH * 0.6) return true
    }
    return false
  }
  function nearestAnchor(x, y, avoidPeers) {
    const pts = anchorPoints().sort((p, q) => ((p.x - x) ** 2 + (p.y - y) ** 2) - ((q.x - x) ** 2 + (q.y - y) ** 2))
    if (avoidPeers) { for (const p of pts) if (!anchorOccupied(p)) return p }   // nearest FREE preset
    return pts[0] || null
  }
  function snapToNearestAnchor() {
    const a = nearestAnchor(wx, wy, true); if (!a) return
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
    positionShop(); positionAchv(); positionPeace()
  }
  function positionChat() {
    chatbar.style.left = (wx + cellPxW / 2) + 'px'
    chatbar.style.top = (wy - 34) + 'px'
  }
  // a peer's interaction counter — same bottom-bar design as MY HUD (#hud-bar + #counter),
  // Screen-space center of a peer's cat body (same placement math as the render loop), so
  // hit/destroy effects land on the right spot for every observer.
  function peerCatCenter(p) {
    if (!p || p.nx == null || p.ny == null) return null
    const W = canvas.clientWidth, H = canvas.clientHeight, scale = SCALE, BUB = window.AnimalArt.BUBBLE_H
    const ox = Math.max(0, Math.min(p.nx * W, W - CELL_W * scale))
    const oy = Math.max(0, Math.min(p.ny * H, usableBottom() - (CELL_H * scale + BAR_SPACE)))
    return { x: ox + CELL_W / 2 * scale, y: oy + (BUB + 100) * scale }
  }
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
  let lastHzSend = 0, catRegenAt = 0
  function sendHotzone() {
    if (wx == null) return
    const extra = peerDimBtns.map((b) => ({ x: b.x - b.r - 2, y: b.y - b.r - 2, w: (b.r + 2) * 2, h: (b.r + 2) * 2 }))
    inputSource.setHotzone({ rect: { x: wx, y: wy, w: cellPxW, h: cellPxH + BAR_SPACE }, extra, force: chatOpenFlag || editing || shopOpenFlag || achvOpenFlag || platformMode || me.netAiming || me.netActive || updateNotesOpen || !!document.querySelector('.bg-back') })
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
    const pb = hitPeerDimButton(e.clientX, e.clientY)   // 👁 clicked an opponent's fade button?
    if (pb) { toggleDimPeer(pb.pid); e.preventDefault(); return }
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
    const pts = anchorPoints(), near = nearestAnchor(wx, wy, true)   // land on the nearest FREE preset
    const cxOff = cellPxW / 2, cyOff = cellPxH / 2
    ctx.save()
    for (const p of pts) {
      const isNear = near && p.x === near.x && p.y === near.y
      const taken = anchorOccupied(p)
      ctx.beginPath(); ctx.arc(p.x + cxOff, p.y + cyOff, isNear ? 11 : 6, 0, Math.PI * 2)
      ctx.fillStyle = isNear ? 'rgba(108,140,255,0.5)' : (taken ? 'rgba(230,90,90,0.3)' : 'rgba(150,160,190,0.28)')   // taken presets show red
      ctx.fill()
      if (isNear) { ctx.strokeStyle = 'rgba(108,140,255,0.9)'; ctx.lineWidth = 2; ctx.stroke() }
      else if (taken) { ctx.strokeStyle = 'rgba(230,90,90,0.7)'; ctx.lineWidth = 1.5; ctx.stroke() }
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
    me.away = (now - (me.lastInput || now)) > IDLE_MS   // 5-min 자리비움
    if (me.hp > 0 && me.hp < CAT_HP && now - (catRegenAt || 0) > 10000) { catRegenAt = now; me.hp = Math.min(CAT_HP, me.hp + 1); localStorage.setItem('catHp', String(me.hp)) }   // +1 HP / 10s natural regen
    // forward WASD/Q/E to the overlay when 10 ants can merge OR the mecha is active
    const wantAntKeys = me.mechaActive || me.mechaMerging || (antMax() >= 10 && ants.filter((a) => !a.dead && !a.falling).length >= 10)
    if (wantAntKeys !== antKeysSent) { antKeysSent = wantAntKeys; if (inputSource.antMechaControl) inputSource.antMechaControl(wantAntKeys) }
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
      if (p.id !== 'me') ctx.globalAlpha = peerAlpha(p.id)   // 👁 dim THIS opponent on my screen
      ctx.translate(origins[i].x, origins[i].y)
      ctx.scale(scale, scale)
      window.AnimalArt.draw(ctx, p.animal, p, now)
      ctx.restore()
      if (p.id !== 'me' && p.taps != null) { ctx.save(); ctx.globalAlpha = peerAlpha(p.id); drawPeerCount(origins[i], p.taps); ctx.restore() }   // peer's counter (dims with 👁)
    })

    // ---- FX layer (ABOVE the HUD bar): weapons draw on top of the character UI so ants /
    // missiles are never hidden behind the counter bar ----
    ctx = fxctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cW, cH)
    drawTaskbarDig()        // taskbar surface/cracks/collapse — FURTHEST BACK so missiles/ants pass in FRONT of it
    drawBloodStains(now)    // lingering red death splats (under the entities)
    drawPlatforms()         // host-drawn floor platforms
    stepGroundWeapons(now)  // pick-up-able weapons resting on the taskbar
    drawBlackholes(now)
    drawShields(now)
    stepProjectiles(now)
    drawShieldShards(now)
    ctx.save(); drawRemoteMissiles(now); ctx.restore()   // (per-peer 👁 dim set inside each drawRemote*; save/restore contains it)
    drawDebris(now)
    stepAnts(now)
    ctx.save(); drawRemoteAnts(now); ctx.restore()
    drawGatlings()
    stepGatling(now)
    drawGatSmoke(now)
    ctx.save(); drawRemoteGBullets(now); ctx.restore()
    stepHbullets(now)
    stepNet(now)          // net physics + catching (positions a netted human before it draws)
    stepHuman(now)
    stepMechaMerge(now)
    stepMecha(now)
    stepMechaShells(now)
    stepEnergyShots(now)
    stepInterceptors(now)
    stepLittleBoys(now)
    ctx.save(); drawRemoteHumans(now); ctx.restore()
    ctx.save(); drawRemoteMechas(now); ctx.restore()
    ctx.save(); drawRemoteMShells(now); ctx.restore()
    ctx.save(); drawRemoteHbullets(now); ctx.restore()
    drawNetAll(now)       // aim UI + my net pouch (on top of entities)
    ctx.save(); drawRemoteNets(now); ctx.restore()
    stepLightning(now)
    drawBhDust(now)
    drawSafeDomes(now)    // 🕊️ invincible peace-mode honeycomb dome (me + safe peers)
    drawPeerDimButtons(now)   // 👁 per-opponent fade buttons
    if (peaceMode) drawPeaceBadges(now)   // 🔒 badge above every character while the room is weapon-locked
    if (now - lastHzSend > 180) { lastHzSend = now; sendHotzone() }   // keep the per-peer button click-zones tracking moving peers
    ctx = stagectx

    positionHandles(now)
    positionHud()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  pushState()
})()
