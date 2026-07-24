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
  const WEAPONS = { none: '없음', missile: '🚀 미사일', shield: '🛡 쉴드', ant: '🐜 개미', blackhole: '🕳 블랙홀', gatling: '🔫 게틀링건', human: '🕺 인간', adogen: '🔵 아도겐', lightning: '⚡ 낙뢰', net: '🕸️ 그물',
    rifleman: '🐜 라이플병', grenadier: '🐜 수류탄병', shielder: '🛡 쉴더', scout: '🐜 정찰병', kamikaze: '💣 카미카제', medic: '🩹 메딕' }
  // 🔫 Gatling: deploy a turret at the cursor (fixed). Hold LEFT-CLICK to spray bullets toward
  // the cursor. Overheats after ~5s continuous fire (3s lock). HP 10 — enemy missiles/bullets/
  // ants damage it; at 0 it's destroyed (60s cooldown). Bullets collide with everything.
  const GAT_HP = 10, GAT_CD = 60000, GAT_DMG = 0.3   // bullet damage (missile = 1)
  const GAT_HEAT_MAX = 100, GAT_OVERHEAT = 3000      // ~2s continuous fire → 3s lock
  const GAT_HEAT_RATE = GAT_HEAT_MAX / 2000          // heat per ms while holding fire (time-based)
  const GAT_COOL_RATE = GAT_HEAT_MAX / 4000          // cool per ms once released
  const GAT_FIRE_MS = 80, GAT_BSPEED = 13            // bullets live until off-screen or a collision
  const GAT_SCALE = 3.8, GAT_HIT_R = 46              // turret ~4x bigger; incoming-hit radius
  const GAT_STRUCT_HP = 24, GAT_BATTLE_L = 0.12      // 배틀: 게틀링 구조물 HP + 내 진영 앞 배치 위치(레인)
  let GAT_BATTLE_RANGE = 0                           // 자동 조준 사거리(px, view.scale 반영해 소환 시 계산)
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
  const CAT_HIT_GOAL = Infinity, CAT_HIT_REWARD = 10000   // (구 업적 비활성 — 누적 카운트 업적으로 대체)
  let catHits = parseInt(localStorage.getItem('catHits') || '0', 10) || 0
  let catHitRewarded = localStorage.getItem('catHitRewarded') === '1'
  // character HP: weapon damage chips it; desk/keyboard/mouse break in stages + face worsens as it drops.
  // achievement: reach 0 HP (완전 파괴) 5 times → 20,000 counts. HP is reset in the shop (500).
  const CAT_HP = 100, DESTROY_GOAL = Infinity, DESTROY_REWARD = 20000   // (구 업적 비활성)
  let destroyCount = parseInt(localStorage.getItem('destroys') || '0', 10) || 0
  let destroyRewarded = localStorage.getItem('destroyRewarded') === '1'
  // achievements: destroy an enemy's gatling / human 10 times → 10,000 counts each
  const GAT_KILL_GOAL = Infinity, HUMAN_KILL_GOAL = Infinity, KILL_REWARD = 10000   // (구 업적 비활성)
  const MECHA_KILL_GOAL = Infinity, MECHA_KILL_REWARD = 15000                       // (구 업적 비활성)
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
  const SLOT_CHOICES = ['none', 'missile', 'shield', 'gatling', 'ant', 'human', 'blackhole', 'lightning', 'net',
    'rifleman', 'grenadier', 'shielder', 'scout', 'kamikaze', 'medic']
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
  // 오버레이 단축키 슬롯에 넣을 수 있는 항목: 고정 오버레이 무기 + 스프라이트 소환체 전부(fireWeapon dispatch 기준)
  const SLOT_FIXED = ['missile', 'shield', 'ant', 'blackhole', 'gatling', 'human', 'lightning', 'net', 'bomber', 'broodTitan']
  function slotEligible(id) { return SLOT_FIXED.includes(id) || !!(window.BattleSprites && window.BattleSprites.has && window.BattleSprites.has(id)) }
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
  me.hp = CAT_HP; localStorage.setItem('catHp', String(CAT_HP))   // 오버레이 캐릭터 체력 개념 제거 → 항상 풀피(파괴/부서짐 없음)
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
  // 단축키 라벨(현재 설정 기준) — 단축키가 보이는 모든 곳이 이 헬퍼를 쓰게 해서 설정 변경 시 자동 최신화
  function modLabel(mod) { return mod === 'ctrlalt' ? 'Ctrl+Alt' : mod === 'ctrlshift' ? 'Ctrl+Shift' : mod === 'caps' ? 'CapsLock' : 'Alt' }   // 설정 옵션(alt/ctrlalt/ctrlshift/caps)과 일치
  function slotKeyLabel(i) { return `${modLabel(keybinds.mod)}+${String(keybinds.keys[i] || '?').toUpperCase()}` }
  function keybindForWeapon(id) { const i = (me.slots || []).indexOf(id); return i >= 0 ? slotKeyLabel(i) : null }   // 무기가 배치된 슬롯의 단축키(없으면 null)

  // ---------- counter ----------
  const counterEl = document.getElementById('counter')
  let tapCount = parseInt(localStorage.getItem('taps') || '0', 10) || 0
  let totalCount = parseInt(localStorage.getItem('totalTaps') || '0', 10) || 0   // 누적(타이핑) — 소비되지 않음
  let countMode = localStorage.getItem('countMode') || 'cur'                       // 'cur'(재화) | 'total'(누적)
  let counterDirty = false
  let penaltyAcc = 0   // while 완전 파괴, only every 2nd input counts (half rate)
  // 큰 수 축약: 100만↑ M, 1만↑ K
  function fmtCount(n) { n = Math.max(0, Math.floor(n || 0)); if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'; if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return n.toLocaleString() }
  const countIconEl = document.getElementById('count-icon')
  function renderCounter() {
    const total = countMode === 'total'
    counterEl.textContent = total ? fmtCount(totalCount) : tapCount.toLocaleString()
    if (countIconEl) countIconEl.textContent = total ? '∞' : '🪙'
    const broken = me.hp <= 0
    counterEl.classList.toggle('penalty', broken && !total)
    counterEl.title = total ? `총 누적 카운트 ${totalCount.toLocaleString()} (∞)` : (broken ? '완전 파괴 패널티 — 입력 2번당 +1' : '현재 재화 카운트 (🪙)')
  }
  function toggleCountMode() { countMode = countMode === 'cur' ? 'total' : 'cur'; localStorage.setItem('countMode', countMode); renderCounter() }
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
  setInterval(() => { if (counterDirty) { localStorage.setItem('taps', String(tapCount)); localStorage.setItem('totalTaps', String(totalCount)); counterDirty = false } }, 1000)
  setInterval(() => { if (carveDirty) { try { localStorage.setItem('bardig', JSON.stringify((carve || []).map((v) => Math.round(v)))); localStorage.setItem('bardmg', String(barDamage)) } catch {} carveDirty = false } }, 1500)
  window.addEventListener('beforeunload', () => { localStorage.setItem('taps', String(tapCount)); localStorage.setItem('totalTaps', String(totalCount)) })

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
    // (오버레이 캐릭터 체력 개념 제거 → 🩹 체력 리셋 상품 삭제)
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
        me.slots[i] = v; localStorage.setItem('slots', JSON.stringify(me.slots)); if (battleActive) buildBattleHud(); pushState()
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
  // 누적 카운트 업적(티어): 10,000 → 50,000 → 100,000 → 이후 +50,000마다. 보상 = 💎 소환 재화 3.
  const CUM_ACH_GEMS = 3
  let cumAchCleared = parseInt(localStorage.getItem('cumAchCleared') || '0', 10) || 0
  function cumTarget(c) { return c <= 0 ? 10000 : c === 1 ? 50000 : 100000 + (c - 2) * 50000 }
  // 배틀 업적(티어): 5 → 10 → 20 → 30 → … → 100. 참여/승리 각각. 보상 = 💎5/단계.
  const BATTLE_ACH_TARGETS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], BATTLE_ACH_GEMS = 5
  let battlePlays = parseInt(localStorage.getItem('battlePlays') || '0', 10) || 0
  let battleWins = parseInt(localStorage.getItem('battleWins') || '0', 10) || 0
  let battlePlayAch = parseInt(localStorage.getItem('battlePlayAch') || '0', 10) || 0
  let battleWinAch = parseInt(localStorage.getItem('battleWinAch') || '0', 10) || 0
  function checkTierAch(count, cleared, targets, gems, label) {
    let c = cleared
    while (c < targets.length && count >= targets[c]) {
      if (window.BattleGacha) window.BattleGacha.addGems(gems)
      showToast(`🏆 ${label} ${targets[c]}회 달성! 💎 +${gems}`); c++
    }
    return c
  }
  function recordBattlePlay() {
    battlePlays++; localStorage.setItem('battlePlays', String(battlePlays))
    battlePlayAch = checkTierAch(battlePlays, battlePlayAch, BATTLE_ACH_TARGETS, BATTLE_ACH_GEMS, '배틀 참여'); localStorage.setItem('battlePlayAch', String(battlePlayAch))
    if (achvOpenFlag) renderAchv()
  }
  function recordBattleWin() {
    battleWins++; localStorage.setItem('battleWins', String(battleWins))
    battleWinAch = checkTierAch(battleWins, battleWinAch, BATTLE_ACH_TARGETS, BATTLE_ACH_GEMS, '배틀 승리'); localStorage.setItem('battleWinAch', String(battleWinAch))
    if (achvOpenFlag) renderAchv()
  }
  function checkCumAch() {
    let target = cumTarget(cumAchCleared), gained = 0
    while (totalCount >= target) {
      cumAchCleared++; localStorage.setItem('cumAchCleared', String(cumAchCleared)); gained += CUM_ACH_GEMS
      if (window.BattleGacha) window.BattleGacha.addGems(CUM_ACH_GEMS)
      showToast(`🏆 누적 ${target.toLocaleString()}회 달성! 💎 소환 재화 +${CUM_ACH_GEMS}`)
      target = cumTarget(cumAchCleared)
    }
    if (gained && achvOpenFlag) renderAchv()
  }
  function achCard(name, reward, desc, cur, target, cleared, done) {
    const pct = done ? 100 : Math.min(100, (cur / target) * 100)
    const card = document.createElement('div'); card.className = 'ach'
    card.innerHTML = `<div class="ach-top"><span class="ach-name">${name}</span><span class="ach-reward">🎁 ${reward}</span></div>` +
      `<p class="ach-desc">${desc}</p>` +
      `<div class="ach-bar"><div class="ach-fill" style="width:${pct}%"></div></div>` +
      `<div class="ach-status">${done ? '✅ 전 단계 달성 완료' : `${cur.toLocaleString()} / ${target.toLocaleString()} · 지금까지 ${cleared}단계`}</div>`
    return card
  }
  function renderAchv() {
    if (!achvListEl) return
    achvListEl.innerHTML = ''
    // 1) 누적 카운트
    const t1 = cumTarget(cumAchCleared)
    achvListEl.appendChild(achCard(`🏆 누적 카운트 ${t1.toLocaleString()}회`, `💎 ${CUM_ACH_GEMS}`, `키보드·마우스 누적 입력 ${t1.toLocaleString()}회 달성 시 소환 재화 지급`, totalCount, t1, cumAchCleared, false))
    // 2) 배틀 참여
    const pDone = battlePlayAch >= BATTLE_ACH_TARGETS.length, pT = pDone ? BATTLE_ACH_TARGETS[BATTLE_ACH_TARGETS.length - 1] : BATTLE_ACH_TARGETS[battlePlayAch]
    achvListEl.appendChild(achCard(`⚔ 배틀 참여 ${pT}회`, `💎 ${BATTLE_ACH_GEMS}`, `배틀 모드 ${pT}회 참여 시 소환 재화 지급 (5·10·20…100)`, battlePlays, pT, battlePlayAch, pDone))
    // 3) 배틀 승리
    const wDone = battleWinAch >= BATTLE_ACH_TARGETS.length, wT = wDone ? BATTLE_ACH_TARGETS[BATTLE_ACH_TARGETS.length - 1] : BATTLE_ACH_TARGETS[battleWinAch]
    achvListEl.appendChild(achCard(`🏆 배틀 승리 ${wT}회`, `💎 ${BATTLE_ACH_GEMS}`, `배틀 모드에서 ${wT}회 승리 시 소환 재화 지급 (5·10·20…100)`, battleWins, wT, battleWinAch, wDone))
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
    '1.3.2': [
      '🐜 오버레이 소환체 공격이 배틀과 동일해졌어요 — 타이탄 레이저/생산, 얼음(감속·빙결), 대공포(유도 요격), 폭격나방(전진 자폭·격추 낙하), 망치(넉백), 지휘(오라), 쉴더(실드)',
      '🤖 합체 수정 — 이제 기본 개미 10마리일 때만 메카 합체(다른 소환체는 합체 안 됨)',
      '🔢 소환 제한 — 기본 개미 10마리 + 그 외 소환체 합쳐서 5마리',
      '🎯 오버레이 투사체가 상대 유닛에 제대로 명중(예전엔 빗나가 땅에 꽂힘)',
    ],
    '1.3.1': [
      '📋 덱 편성(컬렉션) 창에 대공 가능 유닛 ✈ 표시 (HUD와 동일)',
      '🦋 폭격 나방은 공중 공격 불가 — 지상 유닛/기지만 타격(도착 자폭·격추 낙하 모두)',
      '🦾 메카 인간폼 코스트 15 → 13',
    ],
    '1.3.0': [
      '🦋💣 폭격 나방 리워크 — 적 진영으로 무작정 전진→자폭(기지+범위 50), 격추되면 전진 방향으로 낙하해 착탄 폭발(범위 적 50). 대공으로만 요격 · 코스트 5',
      '🎯 공중 공격 정리 — 자폭 개미·저격 개미·라이플 솔져는 공중 공격 불가(대공은 대공포·드론·나방 등으로)',
      '❄️ 얼음 개미 광역은 한 번에 최대 3마리까지만 감속/빙결',
      '🐜 지상 원거리 유닛 이동속도 −20% — 앞줄 근접/탱커로 보호하는 전열 플레이 강화',
      '🕷 새끼거미 떼 코스트 2 · 🦋 나방 떼 코스트 4로 조정',
      '📋 덱 편성 설명(?) 창에 각 소환체 데미지·쿨·대공 여부 표기',
    ],
    '1.2.7': [
      '⚡ 배틀 템포↑ — 전장을 좁히고(양 끝에서 2번째 위치서 시작) 행군 속도 +29%로 교전이 더 빨라져요',
      '🤝 배틀 신청 안정화 — 여러 명에게 신청 시 꼬여서 "유령 배틀"에 갇히던 문제 수정(확인 핸드셰이크)',
      '🎯 대공포 개선 — 못 때리는 지상 유닛 앞에서 멈추던 문제 수정 + 사거리↑(메카 인간폼과 마주 요격)',
      '⚖ 마나 5단계 강화 비용 수정(상한 초과로 못 찍던 버그) · 기타 밸런스',
    ],
    '1.2.6': [
      '🎴 배틀 덱 — 소환체 세트 2개(각 5칸=최대 10) + 🔄 세트 스왑(배틀 중 한 세트 소환, 스왑으로 세트 통째 교체)',
      '💠 브루드 타이탄 개편 — 메카 개미 생산(13초)·마나 25 (오버레이에선 메카개미 자동 생산 없음)',
      '🐜 정찰 개미 = 기지 침투 러셔 — 초고속 + 기지 공성 특화(무방비 기지 빠르게 공략, 방어선엔 무력)',
      '🎖 지휘 개미 원거리화 — 후방에서 사격하며 +20% 오라 유지(앞으로 나가 죽던 것 개선)',
      '⚖ 마나 재조정 — 기본 회복 0.5/s·강화 0.8~2.3(러시와 저축 둘 다 성립) · 기지 체력 200',
      '🎯 기지 포탑 공중 유닛 조준 + 사거리 확대(기지 때리는 원거리 유닛 반격) · 대공포 유도 수정',
      '🧹 배틀 진입 시 오버레이 소환체(내것/상대것) 전부 정리 — 깨끗한 배틀 환경',
    ],
    '1.2.5': [
      '🎯 기지 포탑이 공중 유닛을 못 맞히던 문제 수정 — 이제 드론·나방·메카 인간폼 등 공중 유닛을 정조준 요격',
      '🚀 대공포 개미 미사일이 상대 진영 공중 유닛을 안 쫓던 문제 수정(진영 무관 반대편 공중 유닛 유도)',
      '🎯 대공포 개미 강화 — HP·연사·살보 상향(공대공 카운터로 확실히 기능)',
    ],
    '1.2.4': [
      '🆕 신규 소환체 — 🦋폭격 나방(공중, 전진하며 폭격)·🦋나방 떼(공중 물량)·🕷새끼거미 떼(지상 물량)·🎯대공포 개미(공대공 전용, 유도 요격 미사일)',
      '덱 6칸으로 축소(벤치 제거) — 6장에 집중해 덱 색깔이 뚜렷해져요',
      '⚡ 낙뢰 개편 — 즉발 광역(지상+공중) + 스턴, 이제 배틀 유닛에 제대로 적중',
      '❄️ 얼음 개미 개편 — 광역 서리로 무리를 통째로 늦추고 얼리는 컨트롤러',
      '🕳 블랙홀 개선 — 배틀 유닛도 중심으로 빨려들어가 소멸(마나 20)',
      '💠 브루드 타이탄 30코스트 · 폭격/베이스 캐논 쿨타임 상향 · 전반 땅파임 완화',
      '마나 강화 5단계로 정리 · 상대 소환체가 미사일에 안 맞던 문제 등 다수 수정',
    ],
    '1.2.3': [
      '⚖ 배틀 밸런스 개편 — "마나 풀업하면 무조건 승리" 메타 완화',
      '마나 강화 비용이 상위 단계로 갈수록 크게 증가 + 최대 회복 속도 하향(무작정 경제만 올리면 무방비 노출)',
      '무방비 기지엔 저코스트 근접·자폭 유닛이 큰 피해(러시로 탐욕을 처벌) · 방어 유닛 있으면 요격돼 무효',
      '기지가 밀리는 쪽은 마나 회복 보너스(컴백) — 한 번 앞섰다고 자동 승리가 안 되게',
      '💠 브루드 타이탄: 레이저로 공중 유닛도 공격 가능 + 폭탄개미(자폭) 생산',
    ],
    '1.2.2': [
      '🖥 바탕화면 모드 추가 — 메뉴에서 켜면 홍고캣이 다른 창들 뒤로 내려가, 창을 다 내렸을 때 바탕화면에서만 보여요(업무 방해 X)',
      '상점 업그레이드 화면 개편 — 희귀도 필터 + 강화 가능 우선 정렬 + 2열 카드 + "강화 가능 N개" 표시',
      '업그레이드 비용 희귀도 차등(일반<고급<희귀<전설) · 오버레이 폭격 쿨다운 2초',
      '배틀 기지를 지면에 안착 · 소환체는 책상 앞에서 적을 보고 출발 · 덱 HUD 항상 내 진영 위',
      '브루드 타이탄 밸런스(HP 절반·레이저 쿨 6초·땅파임 제거) · 생산 개미가 업그레이드로 2마리 나오던 버그 수정',
      '원거리 유닛이 적 진영을 제대로 못 맞히던 문제 수정',
    ],
    '1.2.0': [
      '💠 신규 전설 소환체 브루드 타이탄(25코스트) — 거대 요새: 근접 스톰프 + 땅 긁는 레이저 + 개미 생산, 죽을 때 잔해 벽(Lv5)',
      '마나 최대 30 + 마나 강화 10단계 세분화(HUD에 단계 게이지 표시)',
      '기지 체력 300으로 상향 · 상대 유닛도 체력바 표시',
      '여왕개미 솔져 최대 5마리 유지(죽으면 재소환)',
      '멀티 배틀 동기화 대폭 강화 — 포탑·폭격·방어막·베이스캐논·투사체·지형이 상대 화면에도 동일하게',
      '배틀 진입 시 남던 하단바 제거 · 소환체 발이 바닥에 붙게 · 밸런스 조정(포탑 데미지↑, 캐논 충전 느리게 등)',
    ],
    '1.1.0': [
      '배틀 지형 공유 — 한 명이 땅을 파거나 복구하면 양쪽 화면 모두 반영돼요',
      '마나 재조정 — 기본 충전 0.3/s, 마나 강화 0.6·0.9·1.3·1.7·2.2',
      '코스트 재조정 — 메카 개미 7, 여왕 개미 12, 메카 인간폼 15',
    ],
    '1.0.11': [
      '멀티 배틀: 상대 소환체가 쏘는 투사체가 이제 내 화면에도 보여요(메카·인간 포함 전부)',
      '멀티 배틀: 소환체가 반대로 걷던 방향 버그 수정',
      '자폭(폭탄 개미)이 공중 유닛도 타격하도록 변경',
      '무기 쿨타임 추가 — 폭격 20초·쉴드 10초·게틀링 10초(그 외는 마나만)',
      '메카 인간폼 코스트 7→9로 상향(성능 대비 밸런스)',
    ],
    '1.0.10': [
      '멀티 배틀: 소환체가 상대를 못 맞히고 땅으로 쏘던 치명적 버그 수정 — 이제 서로 제대로 교전해요',
      '카미카제(자폭)가 멀티에서 공중 유닛을 때리던 불일치 수정(솔로와 동일)',
      '상대 소환체 움직임 더 부드럽게(위치 갱신 2배 + 보간 개선)',
      '덱 HUD가 좌측 구석 대신 내 진영(내 캐릭터) 위에 뜨도록 변경',
    ],
    '1.0.9': [
      '자동 업데이트 안정화 — "업데이트 눌러도 조용히 안 되던" 문제 수정(항상 전체 파일 다운로드, 실패 시 안내)',
    ],
    '1.0.8': [
      '신규 전설 무기 💥 폭격 — 폭격기가 지나가며 폭탄 5발 투하, 착탄 지점 5초 불장판(아군도 피해!)',
      '배틀 방어 돔(쉴드): 책상 전체를 덮는 반구로 확대 + 체력 균열 연출, 터질 때 그 자리부터 적을 크게 뒤로 넉백',
      '배틀 무기는 이제 상대 기지에 데미지 X — 무기는 소환체·구조물 공격용, 기지는 소환체로만 파괴',
      '오버레이 멀티: 내 소환체가 상대 메카·인간도 공격하도록 수정(캐릭터만 때리던 문제)',
      '햄버거 메뉴에 [🧹 소환체 제거] 버튼 추가',
      '10연 소환에서 SKIP을 눌러도 전설 연출은 보여주고 결과로 넘어가요',
      '결과창에 베팅 정산 결과(획득/잃음·보유량) 표시',
      '해상도가 다른 상대도 프리셋 위치가 딱 맞게 정합',
    ],
    '1.0.7': [
      '메카·인간폼 에너지포가 소환체를 맞힐 때 충돌 연출이 나오도록 수정',
      '에너지포 관통도 통일 규칙 적용 — 자기보다 튼튼한 소환체엔 막혀서 사라짐',
    ],
    '1.0.6': [
      '업데이트 노트가 1.0.x 버전부터 안 뜨던 문제 수정 — 이제 이전 버전부터 최신까지 변경 내역을 한 번에 보여줘요',
    ],
    '1.0.5': [
      '배틀/플랫폼 그리기 모드 = 독점 입력 (바탕화면·다른 클릭 차단)',
      '미사일 유지시간 제거 — 화면 밖으로 나가거나 부딪힐 때만 사라짐',
      '멀티 배틀: 진영 위치 고정(신청자 왼쪽·수락자 오른쪽) + 상대 움직임 부드럽게',
      '초반 마나 충전 속도 상향(0.5→0.8/s) + 마나 강화 레벨 상향',
      '소환체가 쏘는 투사체도 플랫폼에 부딪히도록 수정',
    ],
    '1.0.4': [
      '배틀 진영 구분 — 소환체 머리 위 삼각형(내 편 파랑 / 상대 빨강)',
    ],
    '1.0.3': [
      '무기 설정을 컬렉션·덱과 같은 UI로 통일(희귀도 정렬·필터)',
      '무기 설정에 신규 소환체 전부 표시',
    ],
    '1.0.2': [
      '단축키 표기 수정 — 설정한 조합키(Ctrl+Alt·CapsLock 등)대로 정확히 표시',
      '멀티에서 리틀보이가 상대 화면에도 보이도록 수정',
      '무기 설정 UI 개편(슬롯 + 무기 목록)',
    ],
    '1.0.1': [
      '오버레이에서도 소환체가 배틀처럼 싸움 — 적 소환체 우선, 없으면 가까운 캐릭터 공격(원거리는 투사체 발사 등)',
    ],
    '1.0.0': [
      '⚔ 배틀 모드 정식 오픈! — 덱 편성(소환체·무기), 냥코풍 라인전, 승패 연출',
      '소환체 16종 + 5단계 업그레이드(Lv5 특수 기믹) · 가챠/컬렉션',
      '기지 터렛(자동 포격) · 베이스 캐논(버튼) · 넉백/빙결/오라 등 특수 기믹',
      '멀티 배틀 신청/수락 + 베팅(카운트/젬/부품) · 방 정보(접속자·전적)',
      '기본 덱 지급(개미 4종 + 쉴더 + 미사일)로 바로 시작 가능',
    ],
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
    summonProj.length = 0; bombs.length = 0; bombQueue.length = 0; fireZones.length = 0; bomberPlane = null; overlayIntc.length = 0; overlayMothFalls.length = 0   // 소환 투사체·폭격·요격·낙하 정리
    if (me.gatActive) setGat(false)
    me.gatBattle = false; me.gatStructUid = null; me.gatCdUntil = 0   // 배틀 게틀링 상태·재배치 쿨 초기화
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
    if (battleActive || platformMode) return   // 배틀/플랫폼 독점 모드에선 👁 투명 버튼 숨김(다른 피어도 안 보임)
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
      if (penaltyAcc % 2 === 0) { tapCount++; totalCount++; counterDirty = true; floatPenalty() }
    } else { tapCount++; totalCount++; counterDirty = true }
    renderCounter(); checkCumAch()
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
        // 배틀 중 상대가 팅김(로스터에서 사라짐) = 비자발적 이탈 → 무효·베팅 환불 후 종료
        if (battleMulti && battleActive && battlePhase !== 'result' && !seen.has(battleMulti.oppId)) { refundBattleBet('상대 접속 종료'); showToast('상대 접속이 끊겨 배틀 무효'); stopBattle() }
        // 신청/수락 대기 중 상대가 나감 → 대기 상태 정리(허공 대기 방지)
        if (battleInvite && !seen.has(battleInvite.to)) battleInvite = null
        if (battleAwaitingGo && !seen.has(battleAwaitingGo.from)) { clearAwaitingGo(); showToast('상대가 나가 매칭이 취소됐어요') }
        if (battleIncoming && !seen.has(battleIncoming.from)) closeBattleInvitePopup()
        // drop any remote entities belonging to peers who left (no lingering state)
        for (const m of [remoteMissiles, remoteShields, remoteAnts, remoteBlackholes, remoteGatlings, remoteGBullets, remoteHumans, remoteHbullets, remoteNets, remoteMechas, remoteMShells])
          for (const id of [...m.keys()]) if (!seen.has(id)) m.delete(id)
        pushState()   // reflect the new count in the settings window
      }
      else if (msg.t === 'pos') { const p = peers.get(msg.id); if (p) {
        // 프리셋 인덱스(ac,ar)가 오면 내 화면의 같은 프리셋 좌표로 배치(해상도 무관 정합). 없으면(드래그 중 등) 정규화 좌표.
        if (msg.ac != null && msg.ar != null) { const a = anchorAt(msg.ac, msg.ar), W2 = canvas.clientWidth || 1, H2 = canvas.clientHeight || 1; p.nx = a.x / W2; p.ny = a.y / H2 }
        else { p.nx = msg.nx; p.ny = msg.ny }
        p.taps = msg.taps; if (msg.hp != null) p.hp = msg.hp; p.away = !!msg.away; p.safe = !!msg.safe; if (msg.bw != null) p.bw = msg.bw; if (msg.bp != null) p.bp = msg.bp } }
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
      else if (msg.t === 'ant-hit') { if (msg.target === me.netId) { const a = ants.find((x) => x.id === msg.ant); if (a && !a.dead) {
        const nowP = performance.now()
        if (msg.slow) { a.slowUntil = nowP + (msg.slowDur || 2) * 1000; a.slowMul = 1 - msg.slow; if (a.slowStackAt == null || nowP - a.slowStackAt > (msg.slowDur || 2) * 1000 + 500) a.slowStacks = 0; a.slowStacks = (a.slowStacks || 0) + 1; a.slowStackAt = nowP; if (a.slowStacks >= 3 && !(a.freezeImmuneUntil > nowP)) { a.frozenUntil = nowP + 2000; a.slowStacks = 0; a.freezeImmuneUntil = nowP + 12000 } }   // ❄ 얼음개미 감속 + 3스택 빙결
        if (msg.frozen) a.frozenUntil = Math.max(a.frozenUntil || 0, nowP + msg.frozen * 1000)
        if (msg.kb) { a.kbUntil = nowP + 320; a.kbBack = a.dir }   // 🔨 망치 넉백: 잠깐 뒤로(진격 방향 반대)
        antTakeDmg(a, msg.dmg || 1); if (a.dead) creditKill('ant', msg.id) } } }
      else if (msg.t === 'blackhole') {
        if (msg.ttl > 0) remoteBlackholes.set(msg.id, { nx: msg.nx, ny: msg.ny, until: performance.now() + msg.ttl })
        else remoteBlackholes.delete(msg.id)
      }
      else if (msg.t === 'dig') { carveTaskbar((msg.nx || 0) * canvas.clientWidth, msg.power || 1, false) }  // shared taskbar damage
      else if (msg.t === 'sproj') { const W = canvas.clientWidth, H = canvas.clientHeight; remoteSummonShots.push({ x: (msg.nx || 0) * W, y: (msg.ny || 0) * H, vx: (msg.vx || 0) * W, vy: (msg.vy || 0) * H, ay: (msg.ay || 0) * H, kind: msg.k || 'bullet', aoe: 0, born: performance.now(), life: msg.life || 1500 }) }   // 상대 소환체 투사체 연출
      else if (msg.t === 'obomber') { deployBomber((msg.nx || 0) * canvas.clientWidth, true) }   // 상대 오버레이 폭격 연출 재현
      else if (msg.t === 'digreset') { resetTaskbarDig(false) }   // someone restored → everyone restores
      else if (msg.t === 'peace') { setPeace(!!msg.on, true) }    // dev toggled peace mode → lock/unlock weapons for me too
      // ── 멀티 배틀 ── (to === me.netId 만 처리)
      else if (msg.t === 'battle-req') { if (msg.to === me.netId && !battleActive && !battleIncoming && !battleAwaitingGo) { const p = peers.get(msg.id); showBattleInvitePopup(msg.id, (p && p.name) || '상대', msg.bet || null) } else if (msg.to === me.netId && connected()) net.send(JSON.stringify({ t: 'battle-dec', to: msg.id, reason: 'busy' })) }
      else if (msg.t === 'battle-acc') {   // 상대가 내 신청 수락 → 내가 아직 가능하면 확답(battle-go) 후 시작(side0), 아니면 busy 회신(상대 유령 배틀 방지)
        if (msg.to === me.netId && battleInvite && battleInvite.to === msg.id && !battleActive && !battleAwaitingGo) { const bet = battleInvite.bet; battleInvite = null; if (connected()) net.send(JSON.stringify({ t: 'battle-go', to: msg.id, bet })); startBattleMulti(msg.id, 0, bet) }
        else if (msg.to === me.netId && connected()) net.send(JSON.stringify({ t: 'battle-dec', to: msg.id, reason: 'busy' }))   // 이미 다른 배틀 매칭/진행 중 → 수락자 대기 해제
      }
      else if (msg.t === 'battle-go') {   // (수락자) 신청자 확답 → 이제 시작(side1). 대기중이던 매칭만 수락.
        if (msg.to === me.netId && battleAwaitingGo && battleAwaitingGo.from === msg.id && !battleActive) { const bet = battleAwaitingGo.bet; clearAwaitingGo(); startBattleMulti(msg.id, 1, bet) }
      }
      else if (msg.t === 'battle-cancel') {   // 신청자가 신청 취소 → 내 초대 팝업/수락 대기 정리
        if (msg.to === me.netId) {
          if (battleIncoming && battleIncoming.from === msg.id) { closeBattleInvitePopup(); showToast('상대가 배틀 신청을 취소했습니다') }
          if (battleAwaitingGo && battleAwaitingGo.from === msg.id) { clearAwaitingGo(); showToast('상대가 배틀 신청을 취소했습니다') }
        }
      }
      else if (msg.t === 'battle-state') { const p = peers.get(msg.id); if (p) p.inBattle = !!msg.on }   // 관전자: 원위치 유지 + "⚔ 배틀 중" 배지
      else if (msg.t === 'battle-dec') {
        if (msg.to === me.netId && battleInvite && battleInvite.to === msg.id) { battleInvite = null; showToast(msg.reason === 'busy' ? '상대가 배틀 중입니다' : '상대가 배틀을 거절했습니다') }   // (신청자) 내 신청 거절/busy
        else if (msg.to === me.netId && battleAwaitingGo && battleAwaitingGo.from === msg.id) { clearAwaitingGo(); showToast('상대가 이미 다른 배틀 중 — 매칭이 취소됐어요') }   // (수락자) 내 수락이 busy로 반려
      }
      else if (msg.t === 'battle-end') { if (battleMulti && msg.id === battleMulti.oppId && battlePhase !== 'result') { battlePhase = 'result'; battleResultAt = performance.now(); battleWin = true; seedBattleConfetti(); recordBattleWin() } }   // 상대가 패배/이탈 통지 → 내 승리
      else if (msg.t === 'bunits') { if (battleMulti && msg.id === battleMulti.oppId && msg.to === me.netId) { const prev = new Map(battleGhosts.map((g) => [g.uid, g._dispL])); battleGhosts = (msg.list || []).filter((g) => !battleNetHeldUids.has(g.uid)).map((g) => { const L = 1 - g.L; return { uid: g.uid, type: g.type, L, hp: g.hp, mhp: g.mhp || g.hp, shHp: g.shHp, frozen: g.frozen, slowed: g.slowed, _dispL: prev.has(g.uid) ? prev.get(g.uid) : L } }); battleGhostBase = msg.base != null ? msg.base : battleGhostBase; battleGhostShield = { hp: msg.bsh || 0, until: (msg.bshU || 0) > 0 ? performance.now() + msg.bshU * 1000 : 0 } } }   // 상대 유닛(미러링·표시위치 이어받아 보간) + 상대 기지 HP + 방어 돔
      else if (msg.t === 'bghit') { if (battleMulti && msg.to === me.netId && battle) { battle.hitUnit(msg.uid, msg.dmg || 0, msg.slow || 0, msg.slowDur || 0, !!msg.kb, !!msg.kbBig) } }   // 내 유닛이 맞음(상대가 통지) → 로컬 적용(권한, 넉백 플래그 · kbBig=쉴드 파열 큰 밀림)
      else if (msg.t === 'bbhit') { if (battleMulti && msg.to === me.netId && battle) { battle.hitBase(0, msg.dmg || 0) } }   // 내 기지가 맞음 → 로컬 적용
      else if (msg.t === 'bdig') { if (battleMulti && msg.to === me.netId && battleActive) carveTaskbar((msg.nx || 0) * canvas.clientWidth, msg.power || 1, false) }   // 배틀 지형 공유: 상대 파임 반영
      else if (msg.t === 'bdigreset') { if (battleMulti && msg.to === me.netId && battleActive) resetTaskbarDig(false) }   // 배틀 지형 공유: 상대가 땅 복구
      else if (msg.t === 'bbomber') { if (battleMulti && msg.to === me.netId && battleActive) deployBomber((msg.x || 0) * canvas.clientWidth, true) }   // 상대 폭격 연출 재현(데미지·파임은 별도 릴레이)
      else if (msg.t === 'bcannon') { if (battleMulti && msg.to === me.netId && battleActive) remoteCannonSweep = { at: performance.now() } }   // 상대 베이스 캐논 스윕 연출
      else if (msg.t === 'btitanlaser') { if (battleMulti && msg.to === me.netId && battleActive) { const W = canvas.clientWidth; titanLaserFx((msg.fx || 0) * W, (msg.tx || 0) * W) } }   // 상대 타이탄 레이저 연출 동일 재현
      else if (msg.t === 'bflak') { if (battleMulti && msg.to === me.netId && battleActive) spawnBattleInterceptors({ x: (msg.fx || 0) * canvas.clientWidth, salvo: msg.salvo || 4, dmg: 0, airStun: false, replay: true }) }   // 상대 대공포 요격 미사일 연출(내 로컬 공중 유닛 자동 유도, 데미지 X — bghit로 이미 받음)
      else if (msg.t === 'bmothfall') { if (battleMulti && msg.to === me.netId && battleActive) spawnMothFall((msg.fx || 0) * canvas.clientWidth, msg.vdir || 1, 1, msg.dmg || 50, !!msg.split, true) }   // 상대 폭격 나방 격추 낙하 연출(데미지 X — bghit로 이미 받음)
      else if (msg.t === 'bnetgrab') { if (battleMulti && msg.to === me.netId && battle) { const u = battle.unitByUid(msg.uid); if (u) { u.netted = true; u.frozenUntil = battle.state.t + 30 } } }   // 내 유닛이 상대 그물에 잡힘 → 정지+숨김(해제/사망은 bghit로)
      else if (msg.t === 'bshot') { if (battleMulti && msg.to === me.netId && battleActive) { const W = canvas.clientWidth, H = canvas.clientHeight; remoteBattleShots.push({ x: msg.x * W, y: msg.y * H, vx: msg.vx * W, vy: msg.vy * H, ay: (msg.ay || 0) * H, kind: msg.k || 'bullet', born: performance.now(), life: msg.life || 1500 }) } }   // 상대 투사체 연출 재현
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
        if (msg.active) remoteMechas.set(msg.id, { nx: msg.nx, ny: msg.ny, hp: msg.hp, face: msg.face || 1, shield: msg.shield || 0, form: msg.form || 0, thr: msg.thr || 0, ch: msg.ch || 0, chg: msg.chg || 0, mang: msg.mang || 0, sdep: msg.sdep || 0, snx: msg.snx, sny: msg.sny, sang: msg.sang || 0 })
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
      else if (msg.t === 'littleboy') { const lx = msg.nx * canvas.clientWidth, ly = msg.ny * canvas.clientHeight; if (!littleBoys.some((b) => Math.hypot(b.x - lx, b.y - ly) < 90 * view.scale)) spawnLittleBoy(lx, ly, false) }   // 상대 리틀보이(연출만) — 근처 중복이면 생략
      else if (msg.t === 'hbullets') { mergeRemote(remoteHbullets, msg.id, msg.list, 'nx', 'ny') }
      else if (msg.t === 'error' && msg.reason === 'room_full') { setStatus('방이 가득 찼어요'); ws.close() }
    }
    ws.onclose = () => { if (net === ws) { net = null; peers.clear(); remoteAnts.clear(); remoteBlackholes.clear(); remoteGatlings.clear(); remoteGBullets.clear(); remoteHumans.clear(); remoteHbullets.clear(); remoteNets.clear(); remoteMechas.clear(); remoteMShells.clear(); remoteDrawStroke = null; battleInvite = null; if (battleAwaitingGo) clearAwaitingGo(); if (battleIncoming) closeBattleInvitePopup(); if (platformsAreRemote) { platforms.length = 0; platformsAreRemote = false }; me.netId = undefined; roomCount = 0; setStatus('오프라인 — 혼자 연주 중') } }
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
    const card = document.createElement('div'); card.className = 'bg-card'; card.style.width = 'min(430px,92vw)'; back.appendChild(card)
    const close = () => { back.remove(); sendHotzone() }
    back.addEventListener('mousedown', (ev) => { if (ev.target === back) close() })
    card.innerHTML = `<div class="bg-head"><div class="bg-title">⚔ 무기 설정</div><button class="bg-x">✕</button></div>` +
      `<div class="bg-sub" style="margin-bottom:10px">단축키 슬롯을 고른 뒤(위) 아래 무기를 탭하면 배정돼요. 🔒 = 미획득(가챠로 획득).</div>`
    card.querySelector('.bg-x').onclick = close
    const body = document.createElement('div'); card.appendChild(body)
    // 무기 이모지/이름 (WEAPONS 라벨 '🚀 미사일' → 이모지 + 이름 분리)
    const emojiOf = (id) => (WEAPONS[id] || '❔ ').split(' ')[0]
    const nameOf = (id) => { const l = WEAPONS[id] || id; const e = emojiOf(id); return l.slice(e.length).trim() || l }
    let sel = 0   // 선택된 슬롯
    function render() {
      // 상단: 슬롯 3칸(단축키 라벨 + 배정 무기)
      const slotHtml = me.slots.map((id, i) => {
        const on = sel === i, has = id && id !== 'none'
        return `<div class="wl-slot ${on ? 'on' : ''}" data-slot="${i}" style="flex:1;min-width:0;cursor:pointer;border-radius:10px;padding:8px 6px;text-align:center;background:${on ? 'rgba(74,163,255,.16)' : '#1c2029'};border:1px solid ${on ? '#4aa3ff' : '#2b2f39'};position:relative">
          <div style="font-size:10px;color:#ffd86b;font-weight:700">${slotKeyLabel(i)}</div>
          <div style="font-size:24px;line-height:1.2;margin-top:2px">${has ? emojiOf(id) : '·'}</div>
          <div style="font-size:10px;color:#cfd4de;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${has ? nameOf(id) : '비어있음'}</div>
          ${has ? `<button class="wl-clr" data-clr="${i}" title="비우기" style="position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:50%;background:#c0392b;color:#fff;border:none;font-size:11px;cursor:pointer;line-height:1">✕</button>` : ''}
        </div>`
      }).join('')
      // 하단: 무기 그리드(none 제외)
      const cells = SLOT_CHOICES.filter((id) => id !== 'none').map((id) => {
        const usable = weaponUsable(id), inSlot = me.slots.includes(id)
        return `<div class="bg-cell ${usable ? '' : 'locked'} ${inSlot ? 'indeck' : ''}" data-wid="${id}" title="${nameOf(id)}">
          <div class="e" style="font-size:26px">${emojiOf(id)}</div><div class="n">${nameOf(id)}</div>
          ${usable ? (inSlot ? '<div class="dk">슬롯 ✓</div>' : '') : '<div class="lk">🔒</div>'}</div>`
      }).join('')
      body.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:12px">${slotHtml}</div>
        <div class="bg-rgroup" style="margin-bottom:6px">무기 · 소환체</div><div class="bg-grid">${cells}</div>`
      body.querySelectorAll('[data-slot]').forEach((el) => el.onclick = () => { sel = +el.dataset.slot; render() })
      body.querySelectorAll('[data-clr]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); assign(+b.dataset.clr, 'none') })
      body.querySelectorAll('.bg-cell[data-wid]').forEach((c) => c.onclick = () => {
        const id = c.dataset.wid
        if (!weaponUsable(id)) { showToast(`🔒 ${nameOf(id)} — 상점/가챠로 먼저 획득하세요`); return }
        assign(sel, id); sel = (sel + 1) % 3   // 배정 후 다음 슬롯으로 자동 이동
      })
    }
    function assign(i, id) { me.slots[i] = id; localStorage.setItem('slots', JSON.stringify(me.slots)); if (battleActive) buildBattleHud(); pushState(); render() }
    render()
    document.body.appendChild(back); sendHotzone()
  }

  // 카운트 표시 전환(재화 ↔ 누적)
  { const ct = document.getElementById('btn-count-toggle'); if (ct) ct.onclick = toggleCountMode }

  // ---------- 통합 햄버거 메뉴 (배틀 UI + 기존 기능 브리지) ----------
  const menuBtn = document.getElementById('btn-menu')
  if (window.BattleGachaUI && window.BattleGacha) {
    window.BattleGachaUI.setCountBridge({ get: () => tapCount, spend: (n) => { spendCoins(n) }, set: (n) => { tapCount = Math.max(0, n | 0); counterDirty = true; renderCounter() } })
    window.BattleGachaUI.setDev(isDev)
    window.__startBattle = startBattleSolo   // 배틀은 오버레이 통합(app.js)에서 시작
    window.__battleRequest = (peerId) => openBetDialog(peerId)   // 멀티 배틀 신청(베팅 선택 다이얼로그)
    window.BattleGachaUI.setDevContext({
      peers: () => [...peers.values()].map((p) => ({ id: p.id, name: p.name })),
      setPeer: (id, cur) => { if (net && connected()) net.send(JSON.stringify({ t: 'setcur', target: id, count: cur.count, gems: cur.gems, mat: cur.mat })) },
    })
    window.BattleGachaUI.setHpBridge({
      get: () => me.hp, max: CAT_HP, cost: 500,
      heal: () => { if (me.hp >= CAT_HP || !spendCoins(500)) return false; resetCatHp(); pushState(); return true },
    })
    window.BattleGachaUI.setBridges({
      weapon: () => (window.BattleGachaUI.openWeaponSlots ? window.BattleGachaUI.openWeaponSlots() : openWeaponLoadout()),   // ⚔ 무기 설정: 컬렉션 UI 재사용(희귀도 정렬·필터)
      weaponSlots: () => ({ keys: [0, 1, 2].map((i) => slotKeyLabel(i)), slots: me.slots.slice() }),   // 현재 슬롯(단축키+배정)
      setWeaponSlot: (i, id) => { me.slots[i] = id; localStorage.setItem('slots', JSON.stringify(me.slots)); if (battleActive) buildBattleHud(); pushState() },
      slotEligible: (id) => slotEligible(id),     // 슬롯에 넣을 수 있는 항목인가
      slotUsable: (id) => weaponUsable(id),       // 보유(사용 가능)한가
      achievements: () => openAchv(),            // 🏆 업적: 기존 팝업
      // 📋 방 정보: 현재 멀티방 접속자(닉네임+누적 카운트+배틀 전적) + 배틀 신청 버튼
      roomInfo: () => ({
        connected: connected(),
        me: { name: me.name || '나', count: totalCount, wins: battleWins, plays: battlePlays },
        peers: [...peers.values()].map((p) => ({ id: p.id, name: p.name || ('#' + p.id), count: p.taps || 0, wins: p.bw || 0, plays: p.bp || 0 })),
      }),
      challenge: (id) => openBetDialog(id),      // 배틀 신청(베팅 다이얼로그)
      settings: () => inputSource.openSettings(), // ⚙ 설정: 기존 설정 창
      clearSummons: () => { clearMySummons(); showToast('🧹 내 소환체·투사체 전부 제거') }, // 🧹 소환체 제거: 내가 소환한 것 일괄 정리
      getDesktopMode: () => desktopMode,                          // 🖥 바탕화면 모드 상태(토글 버튼 표시용)
      toggleDesktopMode: () => { setDesktopMode(!desktopMode); return desktopMode },   // 🖥 최상단 ↔ 맨 뒤 전환
      restoreBar: () => resetTaskbarDig(),       // 🧱 땅 복구: 파인 작업표시줄 복원(모두 함께)
      switchView: () => { try { window.bongo.toOverlay({ t: 'next-monitor' }) } catch (e) {} }, // 🖥 화면 전환: 다음 모니터
      quit: () => { try { inputSource.quit() } catch (e) {} }, // ⏻ 홍고캣 종료
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
        if (battleActive) buildBattleHud()   // 단축키 바뀌면 배틀 HUD 안내도 최신화
        pushState()
      }
    }
    else if (msg.t === 'human-key') {
      if (platformMode) { /* 그리기 모드: 조작 잠금 */ }
      else if (msg.down) {
        if (!humanKeys.has(msg.key)) {
          humanKeys.add(msg.key)
          if (msg.key === 'q') {
            if (weaponsLocked()) { /* weapons locked */ }
            else if (me.humanActive) humanAttack()                              // human attack
            else if (me.mechaActive) { me.mechaCharging = true; me.mechaChargeStart = performance.now(); me.mechaCharge = 0 }   // mecha cannon / energy charge
            else if (!me.gatActive && antMax() >= 10 && ants.filter((a) => !a.dead && !a.falling && !a.sprite).length >= 10) mergeAntsToMecha()   // 기본 개미(스프라이트 아님) 10마리일 때만 합체
          } else if (msg.key === 'r' && !weaponsLocked() && me.mechaActive && (me.mechaForm || 0) >= 0.5 && !me.mechaTransforming) fireInterceptors(performance.now())   // human-form R: interceptors
        }
      } else {
        humanKeys.delete(msg.key)
        if (msg.key === 'q') { if (me.humanActive) humanRelease(); else if (me.mechaActive && me.mechaCharging) { me.mechaCharging = false; const t = performance.now(); if (weaponsLocked()) { /* locked */ } else if ((me.mechaForm || 0) >= 0.5) fireEnergyCannon(t); else if (t >= (me.mechaShellCd || 0)) { fireMechaShell(t); me.mechaShellCd = t + MSHELL_CD } } }
      }
    }
    else if (msg.t === 'mecha-transform') { if (!platformMode && me.mechaActive) startMechaTransform(performance.now()) }
    else if (msg.t === 'fire-missile') { fireWeapon('missile') }
    else if (msg.t === 'fire-slot') {
      if (battleActive && battle) {
        // 배틀: 오버레이 슬롯 무시 → 앞 슬롯(키) 순서 = 배틀 덱 무기 순서. 키1=덱무기1, 키2=덱무기2.
        if (msg.down !== false) {
          const deck = (window.BattleGacha && window.BattleGacha.getDeck) ? window.BattleGacha.getDeck() : { weapons: [] }
          const wid = deck.weapons[(msg.slot || 1) - 1]
          if (wid) battleWeaponFire(wid)
        }
      } else if (!platformMode) {   // 그리기 모드에선 무기/능력 잠금
        const id = me.slots[(msg.slot || 1) - 1] || 'none'
        if (id === 'lightning') { if (msg.down === false) lightningRelease(); else lightningPress() }
        else if (msg.down !== false) fireWeapon(id)   // other weapons fire once on press; ignore key-up
      }
    }
    else if (msg.t === 'slots') {
      if (Array.isArray(msg.slots)) { me.slots = msg.slots.slice(0, 3); while (me.slots.length < 3) me.slots.push('none'); localStorage.setItem('slots', JSON.stringify(me.slots)); if (battleActive) buildBattleHud(); pushState() }
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
    if (platformMode) { showToast('🖌️ 플랫폼 그리기 중 — 그리기만 가능'); return }   // 그리기 모드 = 독점(다른 기능 잠금)
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
    else if (id === 'bomber') deployBomber()   // 💣 폭격: 커서 X부터 오른쪽 순차 투하
    else if (id === 'broodTitan' || (window.BattleSprites && window.BattleSprites.has(id))) summonSpriteUnit(id)   // 신규 소환체(라이플병·타이탄 등) — 커서에 소환(체력·충돌 ants 재사용). 타이탄은 스프라이트 없이 커스텀 렌더
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
  const NET_R = 40, NET_CAP = 5                         // held pouch radius + capacity (그물 담기 제한 5)
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
    if (battleActive && battle) battleNetCatch(radius)   // 배틀: 적 소환체 포획(최대 5코스트)
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
  // 배틀 그물: 반경 내 "적" 소환체를 코스트 합 최대 5까지 포획. 솔로=로컬 side1, 멀티=고스트.
  function battleNetCatch(radius) {
    let cost = me.netCaught.reduce((s, it) => s + (it.kind === 'bunit' ? (it.cost || 0) : 0), 0)
    const unitCost = (type) => (window.BattleData.UNITS[type] || {}).cost || 1
    if (battleMulti) {
      for (let i = battleGhosts.length - 1; i >= 0; i--) {
        const g = battleGhosts[i]; if (g.hp <= 0) continue
        const c = unitCost(g.type); if (cost + c > BATTLE_NET_COST_CAP) continue
        const gx = battleLaneX(g.L), gy = battleUnitFeetY(gx, (window.BattleData.UNITS[g.type] || {}).flying)
        if (Math.hypot(gx - me.netBx, gy - me.netBy) < radius) {
          battleGhosts.splice(i, 1); battleNetHeldUids.add(g.uid); cost += c   // 들고 있는 동안 bunits 재갱신에서 제외
          if (connected()) net.send(JSON.stringify({ t: 'bnetgrab', to: battleMulti.oppId, uid: g.uid }))   // 상대: 그 유닛 정지+숨김(포획 상태 동기화 — 상대 화면서 계속 전진하던 문제)
          me.netCaught.push({ kind: 'bunit', obj: { uid: g.uid, type: g.type, side: g.side, L: g.L, ghost: true }, cost: c }); spawnSpark(gx, gy)
        }
      }
    } else {
      const victims = []
      for (const u of battle.state.units) {
        if (u.side !== 1 || u.hp <= 0) continue
        const c = unitCost(u.type); if (cost + c > BATTLE_NET_COST_CAP) continue
        const ux = battleLaneX(u.L), uy = battleUnitFeetY(ux, (window.BattleData.UNITS[u.type] || {}).flying)
        if (Math.hypot(ux - me.netBx, uy - me.netBy) < radius) { victims.push(u); cost += c; spawnSpark(ux, uy) }
      }
      for (const u of victims) {   // sim 배열에서 조용히 제거(사망 이벤트 없이 붙잡아 들어올림), 스냅샷 보관
        const idx = battle.state.units.indexOf(u); if (idx >= 0) battle.state.units.splice(idx, 1)
        me.netCaught.push({ kind: 'bunit', obj: { uid: u.uid, type: u.type, side: 1, L: u.L, ghost: false, snap: u }, cost: unitCost(u.type) })
      }
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
    // 사망 조건 = 던질 때 마우스 커서가 화면 중간보다 위(상단)면 착지 시 사망(높이 던진 만큼 위험). 속도 무관.
    const dx = vx / m, dy = vy / m, flingT = m * NET_FLING, lethal = cursor.y < canvas.clientHeight * 0.5
    for (const it of me.netCaught) {
      const o = it.obj
      if (it.kind === 'human') {   // thrown in the swing direction (arc), lands → WASD resumes (or dies if hard)
        me.humanNetted = false; me.humanX = me.netBx; me.humanY = me.netBy - 2 * s
        me.humanTossVx = dx * flingT * 0.85; me.humanVY = dy * flingT * 0.85 - 3 * s; me.humanGround = false; me.humanTossKill = lethal; continue   // slight upward loft
      }
      if (it.kind === 'bunit') {   // 배틀 소환체: 쌔게(커서 상단) 던지면 사망, 살살이면 전장 복귀
        const b = o; battleNetHeldUids.delete(b.uid)
        const L = Math.max(0, Math.min(1, (me.netBx - battlePad()) / (canvas.clientWidth - 2 * battlePad())))
        if (lethal) {
          if (b.ghost) { if (connected() && battleMulti) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: b.uid, dmg: 9999, slow: 0, slowDur: 0, kb: 0 })) }
          else battleDead.push({ id: b.type, L, side: 1, born: nowP })   // 솔로: 이미 제거됨 → 사망 스프라이트
          addEffect(me.netBx, me.netBy, 2); for (let k = 0; k < 6; k++) spawnDebris(me.netBx + (Math.random() - 0.5) * 24 * s, me.netBy, 1, '#c94b46')
        } else if (!b.ghost && b.snap && battle) { b.snap.L = L; if (b.snap.hp <= 0) b.snap.hp = 1; battle.state.units.push(b.snap) }   // 솔로: 재투입(멀티는 held 해제로 다음 bunits에 복귀)
        continue
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
    else if (it.kind === 'bunit') { if (window.BattleSprites) window.BattleSprites.draw(ctx, o.type, { x, y: y + 14 * s, scale: view.scale * 1.0, facing: -1, state: 'hit', t: now / 1000 }) }   // 붙잡힌 배틀 소환체
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
    if (!wk && isOwned('human')) { me.charging = true; me.chargeKind = 'adogen'; me.chargeStart = now; me.charge = 0; return }  // 아도겐 = 인간의 기본 기능(인간 보유 시)
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
      if (battleActive && p.bfoe != null) {   // 배틀 인간 유닛의 아도겐 = 상대 side만 타격(오버레이 개미/고양이 충돌은 건너뜀)
        if (battleProjCollide(p, (p.waveR || 16 * s) * 0.6, p.hp * 0.32)) { addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); hbullets.splice(i, 1); continue }
        const rr = (p.waveR || 16 * s) * 0.9   // 아도겐 글로우
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr)
        grd.addColorStop(0, 'rgba(235,250,255,0.95)'); grd.addColorStop(0.5, 'rgba(120,200,255,0.8)'); grd.addColorStop(1, 'rgba(80,160,255,0)')
        ctx.save(); ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#eaf8ff'; ctx.beginPath(); ctx.arc(p.x, p.y, rr * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.restore()
        continue
      }
      if (inTaskbar(p.x, p.y)) { carveTaskbar(p.x, p.adogen ? p.hp * 0.32 : (p.wave ? p.hp * 0.05 : 0.1)); spawnSpark(p.x, p.y); bcBoom('hbullet', p.id, p.x, p.y, 1); hbullets.splice(i, 1); continue }   // 아도겐: dig scales with size (~40% of before); 검기: ~3× its old dent
      const energy = p.wave || p.adogen, waveR = p.waveR || 16 * s
      const hpFrac = energy && p.hp0 ? p.hp / p.hp0 : 1
      const effR = energy ? waveR * (0.45 + 0.55 * hpFrac) : waveR   // charged blast shrinks as its HP is chipped away
      const dmg = energy ? p.hp : (p.dmg || 1)                       // energy damage = current HP
      // energy blasts lose HP = the OTHER collidable's DMG per blocking hit (missile/bullet/platform), throttled
      const deplete = (amt) => { if (now < (p.hitCd || 0)) return false; p.hitCd = now + 130; addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); p.hp -= (amt || 1); return p.hp <= 0 }
      const plsw = platformSweep(p.x - p.vx, p.y - p.vy, p.x, p.y)
      if (plsw) { damagePlatform(plsw.pl, dmg); if (!energy) { spawnSpark(plsw.hx, plsw.hy); hbullets.splice(i, 1); continue } else if (deplete(1)) { hbullets.splice(i, 1); continue } }
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
    const alive = ants.filter((a) => !a.dead && !a.falling && !a.sprite)   // 기본 개미만 합체(스프라이트 유닛 제외)
    if (alive.length < 10 || antMax() < 10 || me.mechaActive || me.mechaMerging) return
    if (me.humanActive) removeHuman(); if (me.gatActive) setGat(false)   // exclusive with human/gatling
    const cx = Math.max(16 * mechaScale(), Math.min(canvas.clientWidth - 16 * mechaScale(), cursor.x))   // merge AT the cursor (player picks solid ground)
    me.mergeSnap = alive.map((a) => ({ x0: a.x, y0: a.y, step: Math.random() * 10 }))
    for (let i = ants.length - 1; i >= 0; i--) { const a = ants[i]; if (!a.sprite && !a.dead && !a.falling) ants.splice(i, 1) }   // 합체된 기본 개미만 제거 — 스프라이트 소환체는 필드에 유지
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
      if (battleActive && p.bfoe != null) {   // 배틀 유닛의 포탄 = 상대 side만 타격 + 빗나가면 땅파임(참호)
        if (battleProjCollide(p, 8 * view.scale, 1.0)) { mechaShellImpact(p); mechaShells.splice(i, 1); continue }
        drawMechaShell(p); continue
      }
      { const plsw = platformSweep(p.x - p.vx, p.y - p.vy, p.x, p.y); if (plsw) { damagePlatform(plsw.pl, MSHELL_DMG); mechaShellImpact(p); bcBoom('mshell', p.id, p.x, p.y, 3); mechaShells.splice(i, 1); continue } }   // 그려진 플랫폼에 착탄(관통 방지)
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
      // 팔·대포 조준은 소유자 커서(mang) 방향으로. 내 로컬 커서를 잠시 대체(drawMecha가 cursor로 각도 계산).
      const scx = cursor.x, scy = cursor.y; cursor.x = me.mechaX + Math.cos(m.mang || 0) * 400; cursor.y = me.mechaY + Math.sin(m.mang || 0) * 400
      drawMecha(now, false)
      cursor.x = scx; cursor.y = scy
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
      if (battleActive && p.bfoe != null) {   // 배틀 유닛의 에너지포 = 상대 side만 타격
        if (battleProjCollide(p, 9 * view.scale, 0.6)) { addEffect(p.x, p.y, 2); spawnSpark(p.x, p.y); energyShots.splice(i, 1); continue }
        drawEnergyShot(p, now); continue
      }
      { const plsw = platformSweep(p.x - p.vx, p.y - p.vy, p.x, p.y); if (plsw) { damagePlatform(plsw.pl, p.power); addEffect(plsw.hx, plsw.hy, 1); spawnSpark(plsw.hx, plsw.hy); bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue } }   // 그려진 플랫폼에 막힘(관통 방지)
      if (safeDomeBlocks(p.x, p.y)) { addEffect(p.x, p.y, 2); spawnSpark(p.x, p.y); bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue }   // peace-mode dome stops it
      // solid cats stop it (like a missile)
      let gone = false
      for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci]; if (!cat) continue; const cc = catPos[ci]; if (Math.abs(cc.x - p.x) < 52 * view.scale && Math.abs(cc.y - p.y) < 62 * view.scale) { if (!catShieldCovers(cat, cc, p.x, p.y, now)) applyCatHit(cat, p.power, now); addEffect(p.x, p.y, 2); spawnSpark(p.x, p.y); bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); gone = true; break } }
      if (gone) continue
      // punch-through vs ants / gatling / enemy missiles (power depletes by target HP; gated so it doesn't multi-hit)
      if (now >= (p.pierceCd || 0)) {
        const ah = missileHitsAnt(p.x, p.y)
        if (ah) {
          const hp = ah.hp || 1
          if (ah.local) { antTakeDmg(ah.ant, p.power); if (ah.ant.dead) addAntKill() } else if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: p.power }))
          addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y)   // 명중 임팩트 연출
          // 통합 관통 규칙: 파워 > 대상 HP면 뚫고 진행(파워 −대상HP), 아니면 충돌하고 소멸(미사일과 동일)
          if (p.power > hp) { p.power -= hp; p.pierceCd = now + 90 } else { bcBoom('mshell', p.id, p.x, p.y, 2); energyShots.splice(i, 1); continue }
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
    // 오버레이: 캐릭터 "체력" 개념 제거 — 무기에 맞아도 HP 감소·파괴(부서지는 연출) 없음.
    // 충돌 연출(피격 번쩍 hitUntil/쇼크)은 applyCatHit·'hit' 핸들러에서 이미 처리되므로 그대로 유지된다.
    // (배틀 모드의 기지 HP는 battle.state.baseHp로 완전히 별개 — 영향 없음.)
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
    setGat(true); me.gatX = cursor.x; me.gatY = cursor.y; me.gatBattle = false
    me.gatHp = GAT_HP; me.gatHeat = 0; me.gatOverUntil = 0; me.gatLastShot = 0
    me.gatAng = 0
  }
  // 배틀 전용 게틀링: 커서가 아니라 내 진영 앞 작업표시줄에 고정 배치 + 정지 구조물로 sim 등록(적이 공격·파괴 가능).
  function deployBattleGatling() {
    const now = performance.now()
    if (me.gatActive || now < (me.gatCdUntil || 0)) { showToast('🔫 게틀링 재배치 대기 중'); return }
    if (me.humanActive) removeHuman()
    if (me.mechaActive) removeMecha()
    setGat(true); me.gatBattle = true
    me.gatX = battleLaneX(GAT_BATTLE_L); me.gatY = antGroundY(me.gatX)
    me.gatHp = GAT_STRUCT_HP; me.gatHeat = 0; me.gatOverUntil = 0; me.gatLastShot = 0
    me.gatAng = battleFlip ? Math.PI : 0
    GAT_BATTLE_RANGE = 380 * view.scale
    me.gatStructUid = (battle && battle.addStructure) ? battle.addStructure({ side: 0, type: 'gatling', L: GAT_BATTLE_L, hp: GAT_STRUCT_HP }) : null
    showToast('🔫 게틀링 배치 — 다가오는 적 자동 사격')
  }
  // 배틀: 게틀링 사거리 내 가장 가까운 적(고스트/side1)의 화면 위치. 없으면 null.
  function nearestGatFoe() {
    let best = null, bd = GAT_BATTLE_RANGE || 380 * view.scale
    const foes = battleMulti ? battleGhosts : (battle ? battle.state.units.filter((u) => u.side === 1 && u.hp > 0) : [])
    for (const e of foes) {
      if (e.hp <= 0) continue
      const L = battleMulti ? (e._dispL != null ? e._dispL : e.L) : e.L
      const ex = battleLaneX(L), def = window.BattleData.UNITS[e.type] || {}
      const ey = battleUnitFeetY(ex, def.flying)
      const d = Math.hypot(ex - me.gatX, ey - me.gatY)
      if (d < bd) { bd = d; best = { x: ex, y: ey - 16 * view.scale } }
    }
    return best
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
      // 배틀 게틀링: sim 구조물 HP 동기화 + 파괴 시 제거 + 자동 조준 타겟 산출
      let battleTgt = null
      if (me.gatBattle) {
        if (battle && me.gatStructUid != null) {
          const su = battle.state.units.find((u) => u.uid === me.gatStructUid)
          if (!su) { spawnGatDestroy(me.gatX, me.gatY); setGat(false); me.gatBattle = false; me.gatStructUid = null; me.gatCdUntil = now + GAT_CD }
          else me.gatHp = su.hp
        }
        if (me.gatActive) battleTgt = (battlePhase === 'playing') ? nearestGatFoe() : null
      }
      if (me.gatActive) {
        if (me.gatBattle) { if (battleTgt) me.gatAng = Math.atan2(battleTgt.y - me.gatY, battleTgt.x - me.gatX) }   // 자동 조준(타겟 없으면 마지막 각 유지)
        else me.gatAng = Math.atan2(cursor.y - me.gatY, cursor.x - me.gatX)                                        // 오버레이: 커서 조준
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
          const firing = me.gatBattle ? !!battleTgt : humanKeys.has('q')   // 배틀=적 자동 사격 / 오버레이=Q 홀드
          if (firing) {
            me.gatHeat = Math.min(GAT_HEAT_MAX, me.gatHeat + GAT_HEAT_RATE * dt)   // builds by TIME firing, not per shot
            if (me.gatHeat >= GAT_HEAT_MAX) me.gatOverUntil = now + GAT_OVERHEAT
            if (now - me.gatLastShot >= GAT_FIRE_MS) {
              me.gatLastShot = now
              const a = me.gatAng + (Math.random() - 0.5) * 0.08, muzzle = 26 * view.scale * GAT_SCALE
              gbullets.push({ id: gbulletId++, x: me.gatX + Math.cos(me.gatAng) * muzzle, y: me.gatY + Math.sin(me.gatAng) * muzzle, vx: Math.cos(a) * GAT_BSPEED, vy: Math.sin(a) * GAT_BSPEED, born: now })
              if (gbullets.length > 200) gbullets.shift()
            }
          } else {
            me.gatHeat = Math.max(0, me.gatHeat - GAT_COOL_RATE * dt)  // cool when idle/released
          }
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
      const plB = platformSweep(p.x - p.vx, p.y - p.vy, p.x, p.y)   // 스윕: 빠른 총알이 얇은 플랫폼을 뚫지 못하게
      if (plB) { damagePlatform(plB.pl, GAT_DMG); spawnSpark(plB.hx, plB.hy); gbullets.splice(i, 1); continue }
      // 배틀 적 유닛/기지 (게틀링도 오버레이 그대로 배틀에서 작동)
      if (battleActive && battle && battlePhase === 'playing' && battleHitAt(p.x, p.y, GAT_DMG * BATTLE_W_MULT, 6 * s)) { spawnSpark(p.x, p.y); gbullets.splice(i, 1); continue }
      // local ants (몸통 히트박스 — 스프라이트 유닛은 발밑이 아닌 몸통 전체)
      let hitLocalAnt = false
      for (const an of ants) if (!an.dead && antBodyHit(p.x, p.y, an.x, an.y, an.sprite, an.size)) { antTakeDmg(an, GAT_DMG); if (an.dead) addAntKill(); hitLocalAnt = true; break }
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
  const summonProj = []        // 오버레이 소환체(원거리/광역)가 쏘는 투사체 — 적 소환체/캐릭터에 명중
  const bombs = [], bombQueue = [], fireZones = []   // 💣 폭격 무기: 낙하 폭탄 / 예약 투하 / 착탄 불장판(DoT)
  let bomberPlane = null   // ✈️ 폭격기(화면을 지나가며 폭탄 투하하는 연출)
  const BOMB_N = 5, BOMB_DROP_MS = 150, BOMB_DMG = 20, FIRE_SEC = 5, FIRE_TICK_MS = 450, FIRE_DMG = 5   // 5발·순차·착탄20+넉백·5초 불장판 5/틱(상향: 14→20, 3→5)
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
    if (ants.filter((a) => !a.dead && !a.sprite).length >= 10) return   // 기본 개미 최대 10마리(스프라이트 유닛과 별도 카운트)
    ants.push({ id: nextAntId++, x: cursor.x, y: cursor.y, vy: 0, onGround: false, hp: ANT_HP,
      dir: Math.random() < 0.5 ? -1 : 1, wanderUntil: 0, atkCd: 0, dead: false, deadAt: 0, step: Math.random() * 10 })
  }
  // 신규 소환체(스프라이트)를 오버레이에 소환 — 기본 개미와 동일한 ants[] 시스템에 편입해
  // 체력(HP)·충돌·사망·핵/그물/포탄 등 모든 상호작용을 그대로 재사용한다. (기본 규칙: 모든 소환체는 HP+충돌 보유)
  function summonSpriteUnit(id) {
    if (ants.filter((a) => !a.dead && a.sprite).length >= 5) { showToast('소환체 최대 5마리'); return }   // 기본 개미 제외 스프라이트 소환체 전부 합쳐서 최대 5마리(수동 조작 메카/인간은 별도 시스템이라 제외)
    const def = (window.BattleData && window.BattleData.UNITS[id]) || {}
    const hp = Math.max(1, Math.round((def.hp || 20) / 8))   // 오버레이용 축약 HP(개미=1 기준 스케일)
    const shMax = def.battleShield ? Math.max(1, Math.round(def.battleShield.absorb / 8)) : 0   // 쉴더·메카 자동 실드(오버레이 축약)
    ants.push({ id: nextAntId++, sprite: id, size: def.size || 1, x: cursor.x, y: cursor.y, vy: 0, onGround: false,
      hp, maxHp: hp, shHp: shMax, shMax, dir: cursor.x < canvas.clientWidth / 2 ? 1 : -1, wanderUntil: 0, atkCd: 0, dead: false, deadAt: 0, step: Math.random() * 10 })
  }

  // ---------- 오버레이 필드 유닛 (신규 소환체: BattleSprites 렌더 + 배회 AI) ----------
  // 오버레이(장난용): 커서에 소환 → 작업표시줄 위 배회. 근접형은 배회, 원거리형은 이따금 공격 모션.
  // 소환 제한: 자동형 종류 2개·합산 10마리(FIFO). (멀티 타겟 AI/전투는 이후 단계)
  const fieldUnits = []
  let nextFieldId = 1, fieldLastT = 0
  function spawnFieldUnit(id) {
    if (!(window.BattleData && window.BattleData.UNITS[id])) return
    const typeOrder = [...new Set(fieldUnits.map((u) => u.id))]
    if (!typeOrder.includes(id) && typeOrder.length >= 2) {   // 3번째 종류 → 가장 오래된 종류 제거
      const drop = typeOrder[0]
      for (let i = fieldUnits.length - 1; i >= 0; i--) if (fieldUnits[i].id === drop) fieldUnits.splice(i, 1)
    }
    const x = cursor.x
    fieldUnits.push({ uid: nextFieldId++, id, x, y: antGroundY(x), dir: x < canvas.clientWidth / 2 ? 1 : -1, animT: Math.random() * 2, state: 'walk', turnAt: 0, atkAt: performance.now() + 1500, atkUntil: 0 })
    while (fieldUnits.length > 10) fieldUnits.shift()   // 합산 10 초과 → 처음 소환한 것 제거
  }
  function stepFieldUnits(now) {
    if (!fieldUnits.length) { fieldLastT = now; return }
    const dt = Math.min(0.05, (now - (fieldLastT || now)) / 1000); fieldLastT = now
    const W = canvas.clientWidth
    for (const u of fieldUnits) {
      const def = window.BattleData.UNITS[u.id] || {}
      u.animT += dt
      if (now > u.turnAt) { u.turnAt = now + 1200 + Math.random() * 2200; if (Math.random() < 0.35) u.dir *= -1 }
      const spd = 22 + (def.speed || 0.12) * 150   // px/s (배회)
      u.x += u.dir * spd * dt
      if (u.x < 22) { u.x = 22; u.dir = 1 } else if (u.x > W - 22) { u.x = W - 22; u.dir = -1 }
      u.y = antGroundY(u.x)
      const ranged = def.atk && def.atk.type && def.atk.type !== 'none' && def.atk.type !== 'melee'
      if (ranged) { if (now > u.atkAt) { u.atkAt = now + 2600 + Math.random() * 2200; u.atkUntil = now + 520 } u.state = now < u.atkUntil ? 'attack' : 'walk' }
      else u.state = 'walk'
    }
  }
  function drawFieldUnits(now) {
    if (!window.BattleSprites || !fieldUnits.length) return
    for (const u of fieldUnits) {
      const def = window.BattleData.UNITS[u.id] || {}
      const s = view.scale * 1.3 * (def.size || 1)
      window.BattleSprites.draw(ctx, u.id, { x: u.x, y: u.y, scale: s, facing: u.dir, state: u.state, t: u.animT, flash: u.state === 'attack' })
    }
  }

  // ---------- 배틀 모드 (오버레이 통합: 실제 작업표시줄 위 · 별도 캔버스 아님) ----------
  let battleActive = false, battle = null, battleAI = null, battleLastT = 0, battleResultAt = 0
  let battleAtkAt = {}, battleDead = [], battleOpp = null, battleHud = null, battleShieldFlash = {}, battleHealFx = [], battleFalls = [], battleMothFalls = []
  // 멀티 배틀: 상대와 1v1. battleMulti = { oppId, mySide(0=신청자/1=수락자), oppName } · null이면 솔로.
  let battleMulti = null, battleInvite = null, battleIncoming = null, battleFlip = false, battleAwaitingGo = null, battleAwaitTimer = null   // battleAwaitingGo=내가 수락 후 신청자 확답(battle-go) 대기중(유령 배틀 방지 핸드셰이크)
  let battleBet = null, battleBetSettled = false   // 베팅: {cur:'count'|'gems'|'mat', amt}. 진입 시 escrow 차감, 결과 시 1회 정산.
  let battleBetResult = null   // 결과창 표시용: {cur, amt, win, bal(정산 후 보유량)}
  const BET_CUR = { count: { name: '카운트', emoji: '🪙' }, gems: { name: '젬', emoji: '💎' }, mat: { name: '강화 부품', emoji: '🔩' } }
  function betBalance(cur) { return cur === 'count' ? tapCount : cur === 'gems' ? (window.BattleGacha ? window.BattleGacha.getGems() : 0) : cur === 'mat' ? (window.BattleGacha ? window.BattleGacha.getMaterials() : 0) : 0 }
  function betAdd(cur, n) {   // n 음수=차감. 카운트=tapCount, 젬/부품=BattleGacha.
    if (cur === 'count') { tapCount = Math.max(0, tapCount + n); counterDirty = true; renderCounter() }
    else if (cur === 'gems' && window.BattleGacha) window.BattleGacha.addGems(n)
    else if (cur === 'mat' && window.BattleGacha) window.BattleGacha.addMaterials(n)
  }
  function betLabel(bet) { const c = BET_CUR[bet.cur] || {}; return `${c.emoji || ''} ${bet.amt} ${c.name || ''}` }
  function settleBattleBet(win) {   // 결과 1회 정산: 승=팟(2×) 수령(순 +amt), 패=escrow 유지(순 -amt)
    if (!battleBet || battleBetSettled) return
    battleBetSettled = true
    if (win) { betAdd(battleBet.cur, battleBet.amt * 2); showToast(`🏆 베팅 획득 +${betLabel(battleBet)}`) }
    else showToast(`💸 베팅 잃음 −${betLabel(battleBet)}`)
    battleBetResult = { cur: battleBet.cur, amt: battleBet.amt, win, bal: betBalance(battleBet.cur) }   // 결과창 표시(정산 후 보유량)
  }
  function refundBattleBet(reason) {   // 무효(상대 팅김 등): escrow 환불
    if (!battleBet || battleBetSettled) return
    battleBetSettled = true; betAdd(battleBet.cur, battleBet.amt)
    showToast(`↩ 베팅 환불(${reason || '무효'}) +${betLabel(battleBet)}`)
  }
  let battleGhosts = [], battleGhostBase = 100, bunitsLastSend = 0   // 상대(고스트) 유닛 + 상대 기지 HP
  const remoteBattleShots = []; let rbsLastT = 0   // 멀티: 상대 소환체가 쏜 투사체(연출용 · 데미지는 bghit로 별도)
  const titanLasers = []   // 💠 브루드 타이탄 땅 긁는 레이저 연출(데미지는 sim에서 처리·릴레이)
  const battleIntc = []   // 🎯 대공포 요격 미사일(유도) — 오버레이 인터셉터 비주얼 재사용. 공중 타겟만.
  // 대공포 살보 스폰: opts={ x(포구 절대X), targetUid, ghost, salvo, dmg, airStun, foe, replay }. replay=상대 화면 연출(데미지 X).
  function spawnBattleInterceptors(opts) {
    const s = view.scale, muzzleY = battleUnitFeetY(opts.x, false) - 34 * s, spd = 10 * s, salvo = opts.salvo || 3
    for (let k = 0; k < salvo; k++) {
      const a = -Math.PI / 2 + (k - (salvo - 1) / 2) * 0.22
      battleIntc.push({ x: opts.x + (Math.random() - 0.5) * 12 * s, y: muzzleY, vx: Math.cos(a) * spd * 0.5, vy: Math.sin(a) * spd, spd, born: performance.now(), life: 3200, seekAt: performance.now() + 240, dmg: opts.dmg || 0, airStun: !!opts.airStun, replay: !!opts.replay, side: opts.side == null ? 0 : opts.side })
    }
  }
  // 요격 미사일이 매 프레임 "가장 가까운 살아있는 적 공중 유닛"을 자동 탐색(투사체가 아니라 공중 소환체 타깃).
  //   replay=상대 화면 연출(피격 대상=그쪽 로컬 공중 유닛). 소유자=적 공중(멀티 고스트/솔로 side1).
  function nearestAirIntcTarget(p) {
    let best = null, bd = Infinity
    const isFly = (t) => !!(window.BattleData.UNITS[t] || {}).flying
    const consider = (ux, ref, ghost) => { const uy = battleUnitFeetY(ux, true); const d = Math.hypot(ux - p.x, uy - p.y); if (d < bd) { bd = d; best = { x: ux, y: uy, ref, ghost } } }
    if (p.replay) { for (const u of battle.state.units) { if (u.hp <= 0 || !isFly(u.type)) continue; consider(battleLaneX(u.L), u, false) } }
    else if (battleMulti) { for (const g of battleGhosts) { if (g.hp <= 0 || !isFly(g.type)) continue; consider(battleLaneX(g.L), g, true) } }
    else if (battle) { const enemy = (p.side == null ? 0 : p.side); for (const u of battle.state.units) { if (u.side === enemy || u.hp <= 0 || !isFly(u.type)) continue; consider(battleLaneX(u.L), u, false) } }   // 발사한 진영의 반대편 공중 유닛을 타겟(예전엔 side 1 하드코딩 → 상대(side1) 대공포가 자기 편을 찾다 허공으로 발사)
    return best
  }
  function stepBattleInterceptors(now) {
    const s = view.scale
    for (let i = battleIntc.length - 1; i >= 0; i--) {
      const p = battleIntc[i]
      if (now - p.born > p.life) { battleIntc.splice(i, 1); continue }
      const tg = (now >= p.seekAt && battle) ? nearestAirIntcTarget(p) : null   // 사출 직후 잠깐 상승 후 자동 유도
      if (tg) {
        const dx = tg.x - p.x, dy = tg.y - p.y, d = Math.hypot(dx, dy) || 1
        p.vx += ((dx / d) * p.spd - p.vx) * 0.24; p.vy += ((dy / d) * p.spd - p.vy) * 0.24
        if (d < 16 * s) {   // 명중
          addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y)
          if (!p.replay) {
            if (tg.ghost) { tg.ref.hp -= p.dmg; if (battleMulti && connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: tg.ref.uid, dmg: p.dmg, slow: p.airStun ? 0.9 : 0, slowDur: p.airStun ? 0.7 : 0, kb: 0 })) }   // 로컬 hp 차감=다음 미사일 재조준용, 실제는 bghit
            else { battle.hitUnit(tg.ref.uid, p.dmg); if (p.airStun && battle.state) tg.ref.frozenUntil = Math.max(tg.ref.frozenUntil || 0, battle.state.t + 0.7) }   // 낙하 스턴
          }
          battleIntc.splice(i, 1); continue
        }
      } else { p.vy += (-p.spd * 0.5 - p.vy) * 0.06; p.vx *= 0.98 }   // 타깃 없음 → 상승/부유하다 수명 소멸
      p.x += p.vx; p.y += p.vy
      drawInterceptor(p)   // 오버레이 요격 미사일 비주얼 재사용
    }
  }
  // ── 폭격 나방 격추 낙하 폭탄 ──
  const MOTH_FALL_VX = 3.4, MOTH_FALL_GRAV = 0.62, MOTH_FALL_R = 0.06   // 전진 속도·중력·폭발 반경(레인분율)
  // 격추된 폭격 나방이 전진 방향으로 낙하 → 작업표시줄 착탄 시 폭발(범위 적 유닛 타격). replay=상대 화면 연출만(데미지 X).
  function spawnMothFall(x, vdir, side, dmg, split, replay) {
    const s = view.scale
    battleMothFalls.push({ x, y: battleUnitFeetY(x, true), vx: vdir * MOTH_FALL_VX * s, vy: 0.6 * s, side: side || 0, dmg: dmg || 50, split: !!split, replay: !!replay, rot: 0, vr: vdir * 0.24, born: performance.now(), bomblet: false, rPx: MOTH_FALL_R * canvas.clientWidth })
  }
  function mothExplode(f) {
    const W = canvas.clientWidth, gy = antGroundY(f.x), rPx = f.rPx || MOTH_FALL_R * W
    addEffect(f.x, gy - 8 * view.scale, f.bomblet ? 2 : 3)
    for (let k = 0; k < (f.bomblet ? 8 : 16); k++) spawnSpark(f.x + (Math.random() - 0.5) * rPx * 1.6, gy - Math.random() * 30 * view.scale)
    if (inTaskbar(f.x, gy)) battleDig(f.x, f.bomblet ? 0.4 : 0.7)
    if (!f.replay) {   // 소유자만 데미지 적용(범위 내 적 유닛). 멀티는 고스트=bghit 릴레이, 솔로는 로컬.
      if (battleMulti && f.side === 0) {
        for (const g of battleGhosts) { if (g.hp > 0 && !(window.BattleData.UNITS[g.type] || {}).flying && Math.abs(battleLaneX(g.L) - f.x) < rPx) { if (connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: g.uid, dmg: f.dmg, slow: 0, slowDur: 0, kb: 0 })); g.hp -= f.dmg } }   // 지상 폭발 — 공중 유닛 제외
      } else if (battle) {
        for (const e of battle.state.units) { if (e.side !== f.side && e.hp > 0 && !(window.BattleData.UNITS[e.type] || {}).flying && Math.abs(battleLaneX(e.L) - f.x) < rPx) battle.hitUnit(e.uid, f.dmg, 0, 0, false) }   // 지상 폭발 — 공중 유닛 제외
      }
    }
    if (f.split && !f.bomblet) {   // Lv5: 작은 폭탄 2개 분열(위로 튀어 착탄 폭발)
      const s = view.scale
      for (const sgn of [-1, 1]) battleMothFalls.push({ x: f.x, y: gy - 42 * s, vx: sgn * 2.4 * s + f.vx * 0.25, vy: -3.2 * s, side: f.side, dmg: Math.round(f.dmg * 0.6), split: false, replay: f.replay, rot: 0, vr: sgn * 0.3, born: performance.now(), bomblet: true, rPx: rPx * 0.7 })
    }
  }
  function stepBattleMothFalls(now) {
    const s = view.scale
    for (let i = battleMothFalls.length - 1; i >= 0; i--) {
      const f = battleMothFalls[i]
      f.vy += MOTH_FALL_GRAV * s; f.x += f.vx; f.y += f.vy; f.rot += f.vr
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = `${Math.round((f.bomblet ? 17 : 28) * s)}px system-ui`; ctx.fillText(f.bomblet ? '💣' : '🦋', 0, 0)
      if (!f.bomblet) { ctx.font = `${Math.round(15 * s)}px system-ui`; ctx.fillText('💣', 0, 11 * s) }
      ctx.restore()
      if (f.y >= antGroundY(f.x)) { mothExplode(f); battleMothFalls.splice(i, 1); continue }
      if (f.x < -80 || f.x > canvas.clientWidth + 80 || now - f.born > 4000) { battleMothFalls.splice(i, 1); continue }
    }
  }
  let battleGhostShield = { hp: 0, until: 0 }   // 멀티: 상대 기지 방어 돔(상대가 bunits로 방송) — 내 화면에 표시
  let remoteCannonSweep = null   // 멀티: 상대 베이스 캐논 스윕 연출(데미지·넉백은 bghit로 별도)
  const BUNITS_MS = 50   // 고스트 위치 브로드캐스트 주기(ms). 100→50(20/s)로 상향. 더 낮추면 트래픽·직렬화 부하↑, 인터넷선 지터가 병목이라 수확 체감. 튜닝 지점.
  const battleNetHeldUids = new Set()   // 배틀 그물이 붙잡은 상대 고스트 uid(들고 있는 동안 bunits 재갱신에서 제외)
  const BATTLE_NET_COST_CAP = 5         // 그물 1회 포획 최대 소환체 코스트 합
  let unitReadyAt = {}   // 유닛별 재출격 쿨다운(냥코풍): 소환 후 일정 시간 재소환 불가
  let weaponCdUntil = {}   // 무기별 쿨다운(마나와 별개): battleCd 초. 저코스트 무기 연타 방지
  let battleDeckA = [], battleDeckB = [], battleDeckSwapped = false   // 배틀-로컬 소환체 세트 2개(각 5). 앞 세트만 소환 가능, 스왑으로 세트 통째 교체(세트 내부 배치 불변)
  function redeployCd(id) { const u = window.BattleData.UNITS[id]; return 1500 + (u ? (u.cost || 1) : 1) * 900 }   // 코스트 비례(ms): 개미 2.4s ~ 여왕 10.5s
  // 베이스 캐논(냥코): 시간에 따라 충전, 만충 시 발사 → 내 진영→상대 진영 연쇄 폭발(전원 데미지+넉백). 덱 HUD와 별도 UI.
  let battleCannon = { charge: 0 }, cannonSweep = null, battleCannonEl = null
  const CANNON_FULL_SEC = 90, CANNON_SWEEP_SEC = 0.85, CANNON_DMG = 20, CANNON_BASE_DMG = 8   // 충전 40→90초(1분30초 — 너무 자주 쓰던 것 추가 완화)
  // 기지 터렛(포탑): 각 진영 책상 위, 상대 방향. 내 진영에 근접한 적에게 자동 포물선 포탄(메카 포탄 궤도 재사용, 디자인/폭발은 별도).
  let battleTurretCd = [0, 0], battleTurretAim = [0, 0], battleTurretFire = [0, 0], battleTurretTgtL = [null, null], battleTurretShotAng = [0, 0], battleTurretTgtFly = [false, false]
  const TURRET_RANGE = 0.24, TURRET_CD = 2400, TURRET_DMG = 14, TURRET_AOE = 0.05   // 사거리 0.18→0.24: 기지를 때리는 원거리 유닛(인간 Lv5 0.221·메카인간폼 0.20·메카개미 0.19)을 포탑이 반드시 반격할 수 있게. 스나이퍼(0.34~)만 의도적으로 포탑을 아웃레인지 · 범위공격 데미지 14(반경 0.05 레인)
  const BATTLE_SHIELD_HP = 30, BATTLE_SHIELD_SEC = 10   // 쉴드 무기 = 기지 방어 돔(HP30·10초). 깨지면 근처 적 맵 중앙 넉백
  const TURRET_INSET = 62   // 포탑을 기지(고양이) 옆 책상 빈 공간(안쪽)으로 들이는 거리(px, view.scale 곱)
  function turretBaseX(side) { const bx = battleLaneX(side === 0 ? 0 : 1); return bx + (side === 0 ? 1 : -1) * TURRET_INSET * view.scale }   // 고양이 옆(상대 쪽)
  let battleSavedCarve, battleSavedBarDmg = 0
  let battlePhase = 'idle', battlePhaseAt = 0, battleWin = false, battleConfetti = []   // 'countdown' | 'playing' | 'result'
  const BATTLE_CD_MS = 3200   // 3·2·1 (각 800ms) + START(800ms)
  // 전장 좌우 여백 = 화면폭 1/9(≈양 끝에서 2번째 프리셋 c=1/c=8). 예전 고정 90px(≈화면 끝)에서 안쪽으로 당겨 전장을 좁힘(시각). 실제 템포는 speedScale로.
  function battlePad() { return canvas.clientWidth / 9 }
  const BATTLE_DIG_MUL = 0.4   // 배틀 전체 땅파임 하향 배율(모든 battleDig에 곱함) — 지형 붕괴가 과해서 전반 완화(연출만 남김)
  const BATTLE_UNIT_SCALE = 2.0   // 배틀 유닛 렌더 배율 (2.86 → ×0.7 축소). 히트박스(unitHitboxScreen)도 이 값에 연동.
  // 멀티: 신청자(side0)=화면 왼쪽 / 수락자(side1)=오른쪽으로 "절대 고정". 수락자는 battleFlip으로 좌우 반전 렌더
  // → 두 클라가 동일 절대 프레임을 공유(미사일 등 화면좌표 무기도 정합, 미러링 혼란 해소). sim은 L그대로.
  function battleLaneX(L) { const W = canvas.clientWidth, pad = battlePad(), t = battleFlip ? 1 - L : L; return pad + t * (W - 2 * pad) }
  // 유닛 발밑 Y. 지상형은 파인 지형(antGroundY)을 따라가고, 공중형은 땅 파임과 무관하게 원래 작업표시줄 라인 위로 고정.
  function battleUnitFeetY(x, flying) {
    if (flying) { const tb = taskbarRect(); return (tb ? tb.top : canvas.clientHeight) - 5 * view.scale - 64 * view.scale }   // 공중형: 지상보다 확실히 높게(34→64)
    return antGroundY(x)
  }
  // 기지 고양이가 앉아 있는 "책상 윗면" Y(화면 px). 위젯(고양이+책상+바) 안에서 책상은 BUBBLE_H+DESK_Y 위치.
  // antGroundY(작업표시줄)보다 위 → 포탑은 여기(고양이와 같은 책상)에 얹어야 함.
  function battleDeskY() {
    // 책상 받침바(BAR_VIS)의 "바닥"을 작업표시줄 윗면(usableBottom)에 딱 붙인다 → 기지가 지면 위 경계선에 안착
    // (예전엔 BAR_SPACE 34px 여백 때문에 공중에 뜬 것처럼 보였음).
    const A = window.AnimalArt, s = view.scale
    const BAR_VIS = A.CELL_H - A.BUBBLE_H - A.DESK_Y
    return Math.max(0, usableBottom() - BAR_VIS * s)
  }
  // 기지(진영) 조준 Y — 기지 고양이 몸통 높이(책상면 위 ~50px). 기지가 지면에 안착하면서 몸통이
  // 위로 올라갔으므로, 예전 antGroundY 기준 조준(땅쪽)으로 쏘면 아래를 겨눔 → 책상면 기준으로 보정.
  function baseAimY() { return battleDeskY() - 50 * view.scale }
  // 대공 가능 = 원거리(proj/aoe) 공격 유닛. 근접(melee)·자폭(suicide)·힐·무공격은 공중 못 때림([[battle-melee-no-air]]).
  function battleCanHitAir(u) { const a = u && u.atk, t = a && a.type; if (a && a.groundOnly) return false; return t === 'proj' || t === 'aoe' || t === 'suicide' || t === 'antiair' }   // groundOnly(자폭개미·저격·라이플)는 공중 불가. 대공포는 공중 전용
  // ── 소환체 디자인별 충돌박스 (스프라이트 로컬 기준: 발밑=0, 위로 h, 좌우 반폭 w). 실제 렌더 스케일을 곱해 사용.
  // 개미 이족 스프라이트는 발~머리(더듬이 포함) ≈ 42, 반폭 ≈ 15. 무기별로 조금씩 다름. 메카/인간은 자체 아트라 화면단위 별도 지정.
  const UNIT_HB_LOCAL = {
    _default: { w: 15, h: 43 }, ant: { w: 13, h: 38 },
    scout: { w: 13, h: 37 }, kamikaze: { w: 15, h: 42 }, medic: { w: 15, h: 43 },
    rifleman: { w: 16, h: 43 }, grenadier: { w: 16, h: 43 }, shielder: { w: 17, h: 45 },
    drone: { w: 18, h: 30 }, freezer: { w: 15, h: 43 }, worker: { w: 14, h: 40 },
    commander: { w: 18, h: 47 }, sniper: { w: 15, h: 45 }, boss: { w: 20, h: 46 },
    bomberMoth: { w: 24, h: 34 }, skySwarm: { w: 13, h: 22 },   // 공중 나방(넓은 날개 반폭)
    spiderling: { w: 12, h: 18 }, flakAnt: { w: 18, h: 30 },   // 새끼거미(작음) · 대공포(4족 크롤러+등 발사관)
  }
  function unitHitboxScreen(sprite, size) {   // { halfW, top } — 발밑에서 위로 top, 좌우 halfW (화면 px)
    const sz = size || 1
    if (sprite === 'mechaAnt') return { halfW: 27 * view.scale, top: 92 * view.scale }     // 자체 메카 아트(×0.7 축소 반영)
    if (sprite === 'mechaHuman') return { halfW: 30 * view.scale, top: 104 * view.scale }
    if (sprite === 'human') return { halfW: 18 * view.scale, top: 78 * view.scale }
    if (sprite === 'broodTitan') return { halfW: 93 * view.scale, top: 192 * view.scale }   // 거대 요새
    if (sprite === 'moundwall') return { halfW: 46 * view.scale, top: 40 * view.scale }      // 잔해 벽(낮고 넓음)
    const b = UNIT_HB_LOCAL[sprite] || UNIT_HB_LOCAL._default
    const s = view.scale * BATTLE_UNIT_SCALE * sz
    return { halfW: b.w * s, top: b.h * s }
  }
  // (x,y)가 발밑(fx,feetY) 기준 유닛 몸통 박스에 들어가는지. margin으로 확장(폭발 반경 등).
  function inUnitBody(x, y, fx, feetY, sprite, size, margin) {
    const hb = unitHitboxScreen(sprite, size), m = margin || 0
    return Math.abs(x - fx) < hb.halfW + m && y < feetY + 5 * view.scale + m && y > feetY - hb.top - m
  }
  function _enterBattle() {   // 솔로/멀티 공통 진입 셋업
    clearMySummons()   // 배틀 진입 = 깨끗한 상태: 오버레이 소환체·무기·터렛·메카/인간·투사체·블랙홀 전부 제거
    for (const m of [remoteMissiles, remoteShields, remoteAnts, remoteBlackholes, remoteGatlings, remoteGBullets, remoteHumans, remoteHbullets, remoteNets, remoteMechas, remoteMShells]) m.clear()   // ★ 상대(피어) 오버레이 소환체·투사체도 전부 제거 — 배틀은 내것/남것 모두 없는 깨끗한 환경에서 시작
    remoteSummonShots.length = 0
    littleBoys.length = 0; debris.length = 0; bloodStains.length = 0   // 낙하 폭탄·잔해도 정리
    battle = window.BattleSim.newBattle({ speedScale: 0.49 })   // 행군 템포: 0.44 → 0.38 → 0.49(+29%). 전장 폭을 2번째 프리셋(~78%)으로 좁힌 것과 등가 — 유닛이 더 빨리 교전(sim은 L정규화라 speedScale이 실제 템포 레버)
    battleAtkAt = {}; battleShieldFlash = {}; battleHealFx = []; battleFalls = []; battleMothFalls = []; battleDead = []; bproj.length = 0
    battleGhosts = []; battleGhostBase = battle.state.baseHpMax; bunitsLastSend = 0; unitReadyAt = {}; weaponCdUntil = {}; remoteBattleShots.length = 0; battleGhostShield = { hp: 0, until: 0 }; remoteCannonSweep = null; titanLasers.length = 0; battleIntc.length = 0
    { const dk = (window.BattleGacha && window.BattleGacha.getDeck) ? window.BattleGacha.getDeck() : {}; battleDeckA = (dk.unitsA || []).slice(0, 5); battleDeckB = (dk.unitsB || []).slice(0, 5); battleDeckSwapped = false }   // 배틀-로컬 덱 세트 2개(각 5칸)
    battleCannon = { charge: 0 }; cannonSweep = null; battleTurretCd = [0, 0]; battleTurretAim = [0, 0]; battleTurretFire = [0, 0]; battleTurretTgtL = [null, null]; buildCannonUI()
    battleResultAt = 0; battleLastT = performance.now(); battleActive = true
    battlePhase = 'countdown'; battlePhaseAt = performance.now(); battleConfetti = []   // 3·2·1·START 후 시작
    battleSavedCarve = carve ? carve.slice() : null; battleSavedBarDmg = barDamage; resetTaskbarDig(false)   // 배틀은 복원된(깨끗한) 작업표시줄로 시작
    battleBet = null; battleBetSettled = false; battleBetResult = null   // 베팅 초기화(멀티는 startBattleMulti에서 설정·escrow)
    battleFlip = false   // 기본(솔로/신청자)=왼쪽. 멀티 수락자는 startBattleMulti에서 true
    battleNetHeldUids.clear()
    { const hb = document.getElementById('hud-bar'); if (hb) hb.style.display = 'none' }   // 오버레이 하단바(카운터)는 배틀 중 숨김 — 예전 위치에 남지 않게
    buildBattleHud(); sendHotzone(); recordBattlePlay()   // 🏆 배틀 참여 업적
    if (connected()) net.send(JSON.stringify({ t: 'battle-state', on: true }))   // 관전자에게 "배틀 중"(가리기)
  }
  function startBattleSolo() {
    if (!(window.BattleSim && window.BattleData)) { showToast('배틀 모듈 로드 안 됨'); return }
    if (window.BattleGacha && window.BattleGacha.deckReady && !window.BattleGacha.deckReady()) { showToast('덱 구성을 완료하세요 — 소환체 3개 이상, 무기 1개 이상'); return }
    battleMulti = null
    _enterBattle()
    const dev = !!(window.bongo && window.bongo.isDev)
    battleAI = dev ? null : battle.makeAI(1, ['ant', 'rifleman', 'grenadier', 'mechaAnt', 'mechaHuman'].filter((id) => window.BattleData.UNITS[id]), 1.4)   // dev: 자동 소환 X(내가 테스트 HUD로 직접 소환)
    if (dev) buildDebugSpawnHud()   // 🧪 dev 솔로: 상대 진영 수동 소환 HUD
    battleOpp = Object.assign({ id: 'battleOpp', animal: 'cat', name: '상대', skin: 'gray', pattern: 'solid', hat: 'none', ear: 'pointed', eye: 'oval', mouth: 'smile', tail: 'curl', shape: {}, hp: CAT_HP }, newAnimState())
  }
  // 멀티 배틀 진입. mySide: 0=신청자, 1=수락자. 상대 고양이는 그 피어의 실제 외형으로 우측 끝에.
  function startBattleMulti(oppId, mySide, bet) {
    if (!(window.BattleSim && window.BattleData)) { showToast('배틀 모듈 로드 안 됨'); return }
    const opp = peers.get(oppId)
    battleMulti = { oppId, mySide, oppName: (opp && opp.name) || '상대' }
    battleAI = null
    _enterBattle()
    battleFlip = (mySide === 1)   // 수락자=오른쪽(좌우 반전). 신청자=왼쪽. → 두 클라 동일 절대 배치
    if (battleHud) positionHudAtBase(battleHud)   // ★ flip 확정 후 HUD를 내 진영(수락자=오른쪽) 위로 재배치 — _enterBattle이 flip=false로 왼쪽에 배치했던 것 보정
    if (bet && bet.amt > 0 && BET_CUR[bet.cur]) { battleBet = { cur: bet.cur, amt: bet.amt }; betAdd(bet.cur, -bet.amt); showToast(`💰 베팅 ${betLabel(battleBet)} 걸림`) }   // escrow 차감
    // 상대 고양이 = 그 피어 외형(없으면 기본). 렌더는 항상 "나=좌, 상대=우"로 미러링.
    battleOpp = Object.assign({ id: 'battleOpp', animal: (opp && opp.animal) || 'cat', name: battleMulti.oppName,
      skin: (opp && opp.tint) || 'gray', pattern: (opp && opp.pattern) || 'solid', hat: (opp && opp.hat) || 'none',
      ear: 'pointed', eye: 'oval', mouth: 'smile', tail: 'curl', shape: (opp && opp.shape) || {}, hp: CAT_HP }, newAnimState())
    showToast(`⚔ ${battleMulti.oppName} 님과 배틀 시작!`)
  }
  // ── 배틀 신청/수락 핸드셰이크 ──
  function sendBattleRequest(peerId, bet) {
    if (!connected()) { showToast('멀티 접속 후 신청 가능'); return }
    if (battleActive) { showToast('이미 배틀 중'); return }
    if (battleAwaitingGo) { showToast('수락한 배틀 확인 대기 중이에요'); return }   // 내가 이미 다른 배틀 수락 대기중
    if (window.BattleGacha && window.BattleGacha.deckReady && !window.BattleGacha.deckReady()) { showToast('덱 구성을 완료하세요 — 소환체 3개 이상, 무기 1개 이상'); return }
    const p = peers.get(peerId); if (!p) { showToast('상대를 찾을 수 없어요'); return }
    if (bet && bet.amt > 0) { if (!BET_CUR[bet.cur]) return; if (betBalance(bet.cur) < bet.amt) { showToast(`${BET_CUR[bet.cur].name} 잔액 부족(베팅 ${bet.amt})`); return } }
    else bet = null
    // 동시 신청은 1개만 — 이전 신청 대상이 다르면 그쪽에 취소 통지(상대 팝업 닫힘, 유령 배틀 방지)
    if (battleInvite && battleInvite.to !== peerId && connected()) net.send(JSON.stringify({ t: 'battle-cancel', to: battleInvite.to }))
    battleInvite = { to: peerId, at: performance.now(), bet }
    net.send(JSON.stringify({ t: 'battle-req', to: peerId, bet }))
    showToast(`⚔ ${p.name || '상대'} 님에게 배틀 신청${bet ? ` (베팅 ${betLabel(bet)})` : ''}… 응답 대기`)
  }
  // 내 초대 팝업을 외부(취소 수신 등)에서 닫기
  function closeBattleInvitePopup() { const el = document.querySelector('.bm-invite'); if (el) el.remove(); battleIncoming = null; sendHotzone() }
  // 수락 후 신청자 확답 대기 UI(간단 오버레이) + 타임아웃(응답 없으면 해제)
  function showAwaitingGo(fromName) {
    const old = document.querySelector('.bm-await'); if (old) old.remove()
    const back = document.createElement('div'); back.className = 'no-drag bm-await'
    back.style.cssText = 'position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.5);font-family:system-ui,"맑은 고딕",sans-serif'
    back.innerHTML = `<div style="background:linear-gradient(180deg,#1a1f28,#12151b);border:1px solid #39414f;border-radius:14px;padding:22px 26px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6);color:#e8ebf0">
      <div style="font-size:15px;font-weight:700;margin-bottom:8px">⚔ 수락 완료</div>
      <div style="font-size:13px;color:#8fa0b4"><b style="color:#8fd3ff">${fromName}</b> 님의 확인을 기다리는 중…</div></div>`
    document.body.appendChild(back); sendHotzone()
  }
  function clearAwaitingGo() { battleAwaitingGo = null; const el = document.querySelector('.bm-await'); if (el) el.remove(); if (battleAwaitTimer) { clearTimeout(battleAwaitTimer); battleAwaitTimer = null } sendHotzone() }
  // 배틀 신청 전 베팅 선택 다이얼로그(무베팅/카운트/젬/부품 + 금액) → sendBattleRequest 호출
  function openBetDialog(peerId) {
    if (!connected()) { showToast('멀티 접속 후 신청 가능'); return }
    const p = peers.get(peerId); if (!p) { showToast('상대를 찾을 수 없어요'); return }
    if (document.querySelector('.bm-bet')) return
    const back = document.createElement('div'); back.className = 'no-drag bm-bet'
    back.style.cssText = 'position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.55);font-family:system-ui,"맑은 고딕",sans-serif'
    const card = document.createElement('div')
    card.style.cssText = 'background:linear-gradient(180deg,#1a1f28,#12151b);border:1px solid #39414f;border-radius:14px;padding:18px 20px;width:min(340px,90vw);box-shadow:0 18px 50px rgba(0,0,0,.6);color:#e8ebf0'
    let cur = 'none'
    const curs = [['none', '무베팅', '—'], ['count', '🪙 카운트', betBalance('count')], ['gems', '💎 젬', betBalance('gems')], ['mat', '🔩 부품', betBalance('mat')]]
    card.innerHTML = `<div style="font-size:15px;font-weight:700;margin-bottom:4px">⚔ ${p.name || '상대'} 에게 배틀 신청</div>
      <div style="font-size:12px;color:#8fa0b4;margin-bottom:12px">베팅 재화와 금액 선택 (지면 잃고, 이기면 2배)</div>
      <div class="betcurs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
      <div class="betamtrow" style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
        <span style="font-size:12px;color:#aeb4c0">금액</span>
        <input class="betamt" type="number" min="1" value="10" style="flex:1;padding:8px;border-radius:8px;background:#242a36;color:#e8ebf0;border:1px solid #3a4150">
        <span class="betbal" style="font-size:11px;color:#8fa0b4"></span></div>
      <div style="display:flex;gap:10px"><button class="betcancel" style="flex:1;padding:10px;border-radius:9px;border:1px solid #3a4150;background:#242a36;color:#e8ebf0;cursor:pointer">취소</button>
      <button class="betgo" style="flex:1;padding:10px;border-radius:9px;border:1px solid #2f6bd8;background:#2f6bd8;color:#fff;font-weight:700;cursor:pointer">신청 ⚔</button></div>`
    back.appendChild(card); document.body.appendChild(back); sendHotzone()
    const close = () => { back.remove(); sendHotzone() }
    const cursEl = card.querySelector('.betcurs'), amtRow = card.querySelector('.betamtrow'), balEl = card.querySelector('.betbal')
    function renderCurs() {
      cursEl.innerHTML = curs.map(([k, n]) => `<button class="bg-fbtn2" data-cur="${k}" style="cursor:pointer;border:1px solid ${cur === k ? '#3f7ce8' : '#2b2f39'};background:${cur === k ? '#2f6bd8' : '#1c2029'};color:#e8ebf0;border-radius:999px;padding:5px 11px;font-size:12px">${n}</button>`).join('')
      amtRow.style.display = cur === 'none' ? 'none' : 'flex'
      if (cur !== 'none') balEl.textContent = `보유 ${betBalance(cur)}`
      cursEl.querySelectorAll('[data-cur]').forEach((b) => b.onclick = () => { cur = b.dataset.cur; renderCurs() })
    }
    renderCurs()
    card.querySelector('.betcancel').onclick = close
    card.querySelector('.betgo').onclick = () => {
      let bet = null
      if (cur !== 'none') { const amt = Math.max(1, parseInt(card.querySelector('.betamt').value, 10) || 0); if (betBalance(cur) < amt) { showToast(`${BET_CUR[cur].name} 잔액 부족`); return } bet = { cur, amt } }
      close(); sendBattleRequest(peerId, bet)
    }
  }
  function showBattleInvitePopup(fromId, fromName, bet) {
    if (document.querySelector('.bm-invite')) return
    battleIncoming = { from: fromId, name: fromName, bet: bet || null }
    const back = document.createElement('div'); back.className = 'no-drag bm-invite'
    back.style.cssText = 'position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.5);font-family:system-ui,"맑은 고딕",sans-serif'
    const card = document.createElement('div')
    card.style.cssText = 'background:linear-gradient(180deg,#1a1f28,#12151b);border:1px solid #39414f;border-radius:14px;padding:20px 22px;width:min(340px,88vw);text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6)'
    const betRow = bet && bet.amt > 0
      ? `<div style="font-size:13px;color:#ffd86b;margin-bottom:14px;background:rgba(255,210,90,.1);border:1px solid rgba(255,210,90,.3);border-radius:9px;padding:8px">💰 베팅 <b>${betLabel(bet)}</b> — 지면 잃고, 이기면 2배 획득</div>`
      : `<div style="font-size:12px;color:#8fa0b4;margin-bottom:14px">베팅 없음(연습)</div>`
    card.innerHTML = `<div style="font-size:15px;color:#cfd4de;margin-bottom:6px">⚔ 배틀 신청</div>` +
      `<div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:12px"><b style="color:#8fd3ff">${fromName}</b> 님이 배틀을 신청했습니다</div>` + betRow +
      `<div style="display:flex;gap:10px"><button class="bmno" style="flex:1;padding:11px;border-radius:9px;border:1px solid #3a4150;background:#242a36;color:#e8ebf0;font-size:14px;cursor:pointer">거절</button>` +
      `<button class="bmyes" style="flex:1;padding:11px;border-radius:9px;border:1px solid #2f6bd8;background:#2f6bd8;color:#fff;font-weight:700;font-size:14px;cursor:pointer">수락 ⚔</button></div>`
    back.appendChild(card); document.body.appendChild(back); sendHotzone()
    const close = () => { back.remove(); battleIncoming = null; sendHotzone() }
    card.querySelector('.bmno').onclick = () => { if (connected()) net.send(JSON.stringify({ t: 'battle-dec', to: fromId })); close() }
    card.querySelector('.bmyes').onclick = () => {
      if (!connected()) { close(); return }
      if (window.BattleGacha && window.BattleGacha.deckReady && !window.BattleGacha.deckReady()) { showToast('덱 구성 먼저 완료하세요'); return }
      if (bet && bet.amt > 0 && betBalance(bet.cur) < bet.amt) { showToast(`${BET_CUR[bet.cur].name} 잔액 부족 — 수락 불가`); if (connected()) net.send(JSON.stringify({ t: 'battle-dec', to: fromId, reason: 'insufficient' })); close(); return }
      if (battleInvite && connected()) { net.send(JSON.stringify({ t: 'battle-cancel', to: battleInvite.to })); battleInvite = null }   // 내가 딴 데 신청 중이었다면 취소(중복 매칭 방지)
      net.send(JSON.stringify({ t: 'battle-acc', to: fromId })); close()
      // 낙관적 즉시 시작 X → 신청자 확답(battle-go) 대기(유령 배틀 방지). 확답 오면 side1로 시작.
      battleAwaitingGo = { from: fromId, bet, at: performance.now() }
      showAwaitingGo(fromName)
      if (battleAwaitTimer) clearTimeout(battleAwaitTimer)
      battleAwaitTimer = setTimeout(() => { if (battleAwaitingGo && battleAwaitingGo.from === fromId) { clearAwaitingGo(); showToast('상대 응답이 없어 매칭이 취소됐어요') } }, 8000)
    }
  }
  // 나가기 확인 팝업 — 나가면 패배 처리(승패 판정과 연관). YES/NO.
  function confirmExitBattle() {
    if (document.querySelector('.bx-confirm')) return
    if (battlePhase === 'result') { stopBattle(); return }   // 이미 결과 연출 중이면 그냥 종료
    const back = document.createElement('div'); back.className = 'no-drag bx-confirm'
    back.style.cssText = 'position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.55);font-family:system-ui,"맑은 고딕",sans-serif'
    const card = document.createElement('div')
    card.style.cssText = 'background:linear-gradient(180deg,#1a1f28,#12151b);border:1px solid #39414f;border-radius:14px;padding:20px 22px;width:min(320px,86vw);text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6)'
    card.innerHTML = `<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:8px">정말 나가시겠습니까?</div>` +
      `<div style="font-size:13px;color:#e0a0a0;margin-bottom:16px">나가면 <b style="color:#ff8a8a">패배 처리</b> 됩니다.</div>` +
      `<div style="display:flex;gap:10px"><button class="bxno" style="flex:1;padding:10px;border-radius:9px;border:1px solid #3a4150;background:#242a36;color:#e8ebf0;font-size:14px;cursor:pointer">NO</button>` +
      `<button class="bxyes" style="flex:1;padding:10px;border-radius:9px;border:1px solid #7a2b2b;background:#3a1e1e;color:#ff9a9a;font-weight:700;font-size:14px;cursor:pointer">YES</button></div>`
    back.appendChild(card); document.body.appendChild(back); sendHotzone()
    const closeC = () => { back.remove(); sendHotzone() }
    card.querySelector('.bxno').onclick = closeC
    card.querySelector('.bxyes').onclick = () => {   // 자발적 이탈 = 패배
      closeC()
      if (battle && battlePhase !== 'result') { battlePhase = 'result'; battleResultAt = performance.now(); battleWin = false; seedBattleConfetti(); if (battleMulti && connected()) net.send(JSON.stringify({ t: 'battle-end', to: battleMulti.oppId, result: 'loser' })) }
      else stopBattle()
    }
  }
  // 베이스 캐논 UI — 덱 HUD와 별개(상단 중앙, 붉은 테마). 충전 게이지 + 만충 시 발사.
  function buildCannonUI() {
    if (battleCannonEl) battleCannonEl.remove()
    // 내 진영 포탑 상단에 얹히는 작은 "원형" 캐논 버튼. 링 게이지가 다 차면 클릭 발사(위치는 drawBattleTurret이 매 프레임 갱신).
    const el = document.createElement('div'); el.className = 'no-drag bmcfire'
    el.style.cssText = 'position:fixed;left:14px;top:200px;z-index:2147483000;width:44px;height:44px;border-radius:50%;cursor:default;user-select:none;font-family:system-ui,"맑은 고딕",sans-serif;filter:drop-shadow(0 4px 10px rgba(0,0,0,.5))'
    el.innerHTML =
      `<div class="bmcring" style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(#ffd24a 0deg, rgba(90,43,48,.55) 0deg)"></div>` +
      `<div class="bmcbtn" style="position:absolute;inset:3px;border-radius:50%;background:radial-gradient(circle at 50% 34%,#301619,#160c0e);border:1px solid #5a2b30;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">` +
      `<div style="font-size:15px;line-height:1">💥</div><div class="bmclbl" style="font-size:7px;font-weight:700;color:#ffd9c0;letter-spacing:.3px">캐논</div></div>`
    el.onclick = () => battleCannonFire()
    document.body.appendChild(el); battleCannonEl = el
  }
  // 캐논 버튼을 포탑 상단(cx, topY) 위에 중앙 정렬로 배치
  function positionCannonButton(cx, topY) {
    if (!battleCannonEl) return
    const d = battleCannonEl.offsetWidth || 44
    battleCannonEl.style.left = Math.round(cx - d / 2) + 'px'
    battleCannonEl.style.top = Math.round(topY - d) + 'px'
    battleCannonEl.style.bottom = 'auto'
  }
  function battleCannonFire() {
    if (!battle || battlePhase !== 'playing' || !battleCannon || battleCannon.charge < 1 || cannonSweep) return
    cannonSweep = { at: performance.now(), hit: new Set(), basedone: false }
    battleCannon.charge = 0
    showToast('💥 베이스 캐논 발사!')
    if (battleMulti && connected()) net.send(JSON.stringify({ t: 'bcannon', to: battleMulti.oppId }))   // 상대 화면에도 스윕 연출
  }
  function stepCannon(now, dt) {
    if (battlePhase === 'playing' && battleCannon.charge < 1) battleCannon.charge = Math.min(1, battleCannon.charge + dt / CANNON_FULL_SEC)
    if (!cannonSweep) return
    const el = (now - cannonSweep.at) / 1000, frontL = el / CANNON_SWEEP_SEC   // 0(내 진영)→1(상대 진영)
    // 연쇄 폭발: 프론트 위치에 계속 폭발 스폰(내 진영→상대 진영으로 이어짐)
    const fx = battleLaneX(Math.min(1, frontL)), fy = antGroundY(fx)
    addEffect(fx, fy - 18 * view.scale, 3); for (let k = 0; k < 3; k++) spawnDebris(fx + (Math.random() - 0.5) * 30 * view.scale, fy, 1, k % 2 ? '#ffb45a' : '#ff7d3a')
    if (inTaskbar(fx, fy)) battleDig(fx, 0.5)
    // 프론트가 지나간 적 유닛/고스트 → 데미지 + 강제 넉백(중복 방지)
    if (battleMulti) {
      for (const g of battleGhosts) { if (g.hp <= 0 || cannonSweep.hit.has(g.uid)) continue; if (g.L <= frontL) { cannonSweep.hit.add(g.uid); g.hp -= CANNON_DMG; if (connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: g.uid, dmg: CANNON_DMG, slow: 0, slowDur: 0, kb: 1 })) } }
    } else {
      for (const u of battle.state.units) { if (u.side !== 1 || u.hp <= 0 || cannonSweep.hit.has(u.uid)) continue; if (u.L <= frontL) { cannonSweep.hit.add(u.uid); battle.hitUnit(u.uid, CANNON_DMG, 0, 0, true) } }
    }
    // ★ 무기는 기지(진영)에 데미지 X — 베이스 캐논도 무기라 스윕 유닛 데미지·넉백만, 기지 타격은 없음.
    if (el > CANNON_SWEEP_SEC + 0.1) cannonSweep = null
  }
  // 기지 터렛 기본 공격: 근접한 적에게 포물선 포탄(메카 포탄 궤도) 발사
  function fireTurretShell(side, tL, flying) {
    const baseX = turretBaseX(side), face = side === 0 ? 1 : -1
    const sx = baseX + face * 30 * view.scale, sy = battleDeskY() - 40 * view.scale   // 포탑 포구(책상 위 포신 끝 근처)
    const tx = battleLaneX(tL), ty = flying ? (battleUnitFeetY(tx, true) - 8 * view.scale) : (antGroundY(tx) - 18 * view.scale)   // ★ 공중 타겟은 공중 높이 조준(예전엔 무조건 지면 → 공중 유닛 빗나감)
    const grav = 900 * view.scale                                          // stepBattleProj와 동일(초 단위)
    const T = Math.max(0.5, Math.min(1.4, Math.abs(tx - sx) / (360 * view.scale)))   // 비행 시간(초)
    const vx = (tx - sx) / T, vy = (ty - sy - 0.5 * grav * T * T) / T       // T초 뒤 (tx,ty)에 착탄하는 포물선
    battleTurretShotAng[side] = Math.atan2(vy, vx)   // 실제 발사 벡터 각도 → 포신이 이 방향(위로 쏘면 위)을 바라보게
    bproj.push({ x: sx, y: sy, vx, vy, bside: side, dmg: TURRET_DMG, pow: TURRET_DMG, kind: 'turret', kb: true, aoe: TURRET_AOE, slow: 0, slowDur: 0, born: performance.now(), life: PROJ_LIFE.turret })   // 범위 폭발 포탄
    if (battleMulti && connected()) relayShot('turret', sx, sy, vx, vy, grav)   // 상대 화면에도 포탑 포탄 보이게(연출)
  }
  // 멀티: 상대 캐논 스윕 = 상대 진영(내 화면 L=1쪽)에서 내 진영(L=0)으로 프론트 이동하며 연쇄 폭발(연출만).
  function stepRemoteCannon(now) {
    if (!remoteCannonSweep) return
    const el = (now - remoteCannonSweep.at) / 1000
    if (el > CANNON_SWEEP_SEC + 0.15) { remoteCannonSweep = null; return }
    const frontL = 1 - Math.min(1, el / CANNON_SWEEP_SEC)   // 상대 진영→내 진영(미러)
    const fx = battleLaneX(frontL), fy = antGroundY(fx)
    addEffect(fx, fy - 18 * view.scale, 3); for (let k = 0; k < 3; k++) spawnDebris(fx + (Math.random() - 0.5) * 30 * view.scale, fy, 1, k % 2 ? '#ffb45a' : '#ff7d3a')
  }
  function stepTurrets(now) {
    if (battlePhase !== 'playing' || !battle) return
    for (let side = 0; side <= 1; side++) {
      if (battleMulti && side === 1) continue   // 멀티: 상대 터렛은 상대 클라가 처리
      if (now < battleTurretCd[side]) continue
      const baseL = side === 0 ? 0 : 1
      let target = null, bd = TURRET_RANGE
      const enemies = (battleMulti && side === 0) ? battleGhosts : battle.state.units.filter((u) => u.side !== side && u.hp > 0)
      for (const e of enemies) { const d = Math.abs(e.L - baseL); if (d < bd) { bd = d; target = e } }
      if (target) { const tfly = !!(window.BattleData.UNITS[target.type] || {}).flying; fireTurretShell(side, target.L, tfly); battleTurretAim[side] = battleTurretShotAng[side]; battleTurretCd[side] = now + TURRET_CD; battleTurretFire[side] = now; battleTurretTgtL[side] = target.L; battleTurretTgtFly[side] = tfly }   // 공중 여부 전달 → 조준 Y 보정
    }
  }
  function stopBattle() {
    // 멀티: 결과 연출 없이 나가면(중도 이탈) 상대에게 패배 통지
    if (battleMulti && battlePhase !== 'result' && connected()) net.send(JSON.stringify({ t: 'battle-end', to: battleMulti.oppId, result: 'loser' }))
    if (battleCannonEl) { battleCannonEl.remove(); battleCannonEl = null } cannonSweep = null
    battleMulti = null; battleGhosts = []; battleNetHeldUids.clear(); remoteBattleShots.length = 0; battleGhostShield = { hp: 0, until: 0 }; remoteCannonSweep = null; battleIntc.length = 0; battleMothFalls = []
    if (me.gatBattle) { setGat(false); me.gatBattle = false; me.gatStructUid = null; me.gatCdUntil = 0 }   // 배틀 종료 시 배틀 게틀링 제거
    battleActive = false; battle = null; bproj.length = 0; battlePhase = 'idle'; battleConfetti = []
    { const c = document.querySelector('.bx-confirm'); if (c) c.remove() }
    if (battleSavedCarve !== undefined) { carve = battleSavedCarve; barDamage = battleSavedBarDmg || 0; carveDirty = true; battleSavedCarve = undefined }   // 원래 작업표시줄 상태 복귀
    if (battleHud) { battleHud.remove(); battleHud = null }
    if (battleDebugHud) { battleDebugHud.remove(); battleDebugHud = null }   // 🧪 테스트 소환 HUD 정리
    sendHotzone()
    { const hb = document.getElementById('hud-bar'); if (hb) hb.style.display = '' }   // 배틀 종료 → 오버레이 하단바 복원
    positionHud()
    if (connected()) net.send(JSON.stringify({ t: 'battle-state', on: false }))   // 관전자에게 "배틀 종료"
  }
  function buildBattleHud() {
    if (battleHud) battleHud.remove()
    const deck = (window.BattleGacha && window.BattleGacha.getDeck) ? window.BattleGacha.getDeck() : { units: [], weapons: [] }
    const h = document.createElement('div'); h.className = 'no-drag'
    // 내 진영 색(팀 마커·HP 게이지와 동일한 파랑)으로 테두리 → 이게 "내 진영 HUD"임을 직관적으로.
    h.style.cssText = 'position:fixed;z-index:2147483000;background:linear-gradient(180deg,#141821,#0d0f14);border:2px solid #3f7ce8;border-radius:14px;padding:8px 11px 11px;width:344px;font-family:system-ui,"맑은 고딕",sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.55), 0 0 0 1px rgba(74,163,255,.35), 0 0 14px rgba(74,163,255,.25)'
    // 덱 HUD는 항상 내 진영(고정 위치) 위쪽에 뜬다 — 저장된 드래그 위치는 무시([[multiplayer-consistency-invariant]] 내 진영 고정).
    const lbl = (t) => `<div style="font-size:10px;color:#7f8797;letter-spacing:.4px;margin:9px 0 4px">${t}</div>`
    h.innerHTML =
      `<div class="bhgrip" style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#9aa0ab;cursor:move;user-select:none;margin-bottom:7px"><span style="color:#8fc3ff;font-weight:700">🔵 내 진영 <span style="color:#7f8797;font-weight:400">· ⠿ 이동</span></span><span class="bhx" style="color:#e57373;cursor:pointer">✕ 나가기</span></div>` +
      `<div style="display:flex;gap:4px;align-items:center"><span style="font-size:10px;color:#aeb4c0;width:26px">마나</span><div class="bhsegs" style="display:flex;gap:2px;flex:1"></div><span class="bhval" style="font-size:11px;color:#cfd4de;white-space:nowrap;width:70px;text-align:right"></span></div>` +
      lbl('🐜 소환체 (앞 세트 클릭 소환 · 뒷 세트 눌러 세트 교체)') + `<div class="bhunits" style="display:flex;gap:5px"></div><div class="bhbench" style="display:flex;gap:5px;margin-top:5px;min-height:1px"></div>` +
      lbl('⚔ 무기 (단축키로 발사 · 마나 소모)') + `<div class="bhweaps" style="display:flex;gap:5px"></div>` +
      lbl('🛠 기능') + `<div class="bhfns" style="display:flex;gap:5px"></div>`
    const segs = h.querySelector('.bhsegs'); for (let i = 0; i < 10; i++) { const s = document.createElement('div'); s.style.cssText = 'flex:1;height:8px;border-radius:2px;background:rgba(255,255,255,.14)'; segs.appendChild(s) }
    const mkCard = (bg, bd) => { const b = document.createElement('div'); b.style.cssText = `flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 2px;border-radius:9px;background:${bg};border:1px solid ${bd};cursor:pointer;user-select:none`; return b }
    const uw = h.querySelector('.bhunits'), bw = h.querySelector('.bhbench')
    if (!battleDeckA.length && !battleDeckB.length) { battleDeckA = (deck.unitsA || []).slice(0, 5); battleDeckB = (deck.unitsB || []).slice(0, 5) }
    const frontSet = () => (battleDeckSwapped ? battleDeckB : battleDeckA)   // 앞(활성) 세트 = 소환 가능
    const backSet = () => (battleDeckSwapped ? battleDeckA : battleDeckB)    // 뒷 세트 = 스왑 대기(세트 통째 교체, 내부 배치 불변)
    function doSwap() { if (!backSet().length) { showToast('교체할 뒷 세트가 없어요'); return } battleDeckSwapped = !battleDeckSwapped; renderDeckRows(); updateBattleHud() }
    // 앞 세트 = 활성 소환 카드 / 뒷 세트 = 실루엣(눌러 세트 통째 교체).
    function renderDeckRows() {
      uw.innerHTML = ''; bw.innerHTML = ''
      const front = frontSet(), back = backSet()
      front.forEach((id) => {
        const u = window.BattleData.UNITS[id]; if (!u) return
        const b = mkCard('rgba(255,255,255,.06)', 'rgba(255,255,255,.14)'); b.dataset.id = id; b.title = u.name + (battleCanHitAir(u) ? ' · 대공 가능' : ' · 지상 전용(공중 못 때림)'); b.style.position = 'relative'
        const aa = battleCanHitAir(u)
          ? `<div style="position:absolute;top:2px;left:3px;font-size:9px;color:#8ff0c8;text-shadow:0 1px 2px #000;pointer-events:none" title="대공 가능">✈</div>`
          : `<div style="position:absolute;top:2px;left:3px;font-size:9px;opacity:.6;pointer-events:none" title="지상 전용(공중 못 때림)">⛰</div>`
        b.innerHTML = aa + `<div style="pointer-events:none">${window.BattleArt ? window.BattleArt.icon(id, 32) : ''}</div><div style="color:#8fd3ff;font-weight:600;font-size:11px">💧${u.cost}</div>` +
          `<div class="bhcd" style="position:absolute;inset:0;border-radius:9px;background:rgba(10,14,20,.72);display:none;align-items:center;justify-content:center;color:#cfd4de;font-size:13px;font-weight:700;pointer-events:none"></div>`
        b.onclick = () => {   // 냥코풍: 재출격 쿨다운 중이면 거부
          const now = performance.now()
          if (now < (unitReadyAt[id] || 0)) { showToast(`${u.name} 재출격 대기 ${((unitReadyAt[id] - now) / 1000).toFixed(1)}초`); return }
          if (battle && battle.spawn(0, id)) { unitReadyAt[id] = now + redeployCd(id); updateBattleHud() }
        }
        uw.appendChild(b)
      })
      if (!front.length) uw.innerHTML = '<span style="font-size:11px;color:#7f8797">이 세트에 소환체 없음</span>'
      // 뒷 세트(스왑): 세트가 있을 때만. 앞에 🔄 교체 버튼 + 실루엣들, 어디를 눌러도 세트 통째 교체.
      if (back.length) {
        const sw = mkCard('rgba(74,163,255,.14)', 'rgba(74,163,255,.4)'); sw.style.flex = '0 0 auto'; sw.style.minWidth = '38px'; sw.title = '세트 교체'
        sw.innerHTML = `<div style="pointer-events:none;font-size:15px">🔄</div><div style="pointer-events:none;color:#8fd3ff;font-size:9px">교체</div>`
        sw.onclick = doSwap; bw.appendChild(sw)
        back.forEach((id) => {
          const u = window.BattleData.UNITS[id]; if (!u) return
          const c = mkCard('rgba(255,255,255,.04)', 'rgba(255,255,255,.1)'); c.title = `${u.name} — 눌러서 세트 교체`
          c.innerHTML = `<div style="filter:grayscale(1);opacity:.5;pointer-events:none;transform:scale(.78)">${window.BattleArt ? window.BattleArt.icon(id, 30) : ''}</div>`
          c.onclick = doSwap; bw.appendChild(c)
        })
      }
    }
    renderDeckRows()
    const ww = h.querySelector('.bhweaps')
    deck.weapons.forEach((id, wi) => {
      const w = window.BattleData.WEAPONS[id]; if (!w) return
      const key = wi < keybinds.keys.length ? slotKeyLabel(wi) : null   // 배틀 덱 순서 = 앞 단축키 순서(오버레이 슬롯 무시)
      const b = mkCard('rgba(74,163,255,.12)', 'rgba(74,163,255,.38)'); b.dataset.wid = id
      b.title = key ? `${w.name} — 단축키 ${key}` : `${w.name} — (단축키 없음)`
      const keyHtml = key
        ? `<div style="color:#ffd86b;font-weight:700;font-size:10px;line-height:1.1">${key}</div>`
        : `<div style="color:#e08a8a;font-size:9px;line-height:1.1">키 없음</div>`
      b.innerHTML = `<div style="pointer-events:none">${window.BattleArt ? window.BattleArt.icon(id, 30) : ''}</div>${keyHtml}<div style="color:#8fd3ff;font-size:9px">💧${w.mana != null ? w.mana : 2}</div>`
      b.onclick = () => showToast(key ? `${w.name}: 단축키 ${key} 로 사용` : `${w.name}: 배틀 무기 슬롯 초과(단축키 없음)`)   // 클릭 발사 X — 단축키 안내만
      ww.appendChild(b)
    })
    if (!deck.weapons.length) ww.innerHTML = '<span style="font-size:11px;color:#7f8797">덱에 무기 없음</span>'
    const fw = h.querySelector('.bhfns')
    const rb = document.createElement('div'); rb.style.cssText = 'flex:1;text-align:center;padding:8px 2px;border-radius:9px;background:rgba(180,140,90,.14);border:1px solid rgba(180,140,90,.4);color:#e6d3b8;font-size:12px;cursor:pointer;user-select:none'; rb.innerHTML = '🧱 작업표시줄 복구 <span style="color:#ffd86b;font-weight:600">💧1</span>'
    rb.onclick = () => { if (battle && battle.state.mana[0] >= 1) { battle.state.mana[0] -= 1; resetTaskbarDig(false); if (battleMulti && connected() && net) net.send(JSON.stringify({ t: 'bdigreset', to: battleMulti.oppId })); updateBattleHud() } else showToast('마나 부족 (1 필요)') }
    fw.appendChild(rb)
    // ⚡ 마나 강화(냥코 일꾼레벨): 마나 지불 → 이번 판 충전속도↑. 전용 전폭 블록(단계 게이지)
    const mu = document.createElement('div'); mu.className = 'bhmanaup'; mu.style.cssText = 'margin-top:6px;padding:7px 10px;border-radius:9px;background:rgba(255,210,90,.12);border:1px solid rgba(255,210,90,.4);color:#ffe08a;font-size:11px;cursor:pointer;user-select:none'
    mu.onclick = () => { if (battle && battle.upgradeMana(0)) { updateBattleHud() } else showToast('마나 부족 또는 최대 레벨') }
    fw.after(mu)   // 기능 행(복구/DEV) 아래 전폭으로
    if (isDev) {   // 🛠 개발자 전용: 마나 풀충전(테스트용) — dev 모드에서만 노출
      const mb = document.createElement('div'); mb.style.cssText = 'flex:1;text-align:center;padding:8px 2px;border-radius:9px;background:rgba(74,163,255,.16);border:1px solid rgba(74,163,255,.45);color:#bfe3ff;font-size:12px;cursor:pointer;user-select:none'; mb.innerHTML = '🛠 마나 채우기 <span style="color:#8fd3ff;font-weight:600">DEV</span>'
      mb.onclick = () => { if (battle) { battle.state.mana[0] = battle.state.cfg.manaCap; updateBattleHud(); showToast('🛠 마나 풀충전') } }
      fw.appendChild(mb)
    }
    h.querySelector('.bhx').onclick = () => confirmExitBattle()
    const grip = h.querySelector('.bhgrip'); grip.style.touchAction = 'none'
    grip.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('bhx')) return
      const dx = e.clientX - h.offsetLeft, dy = e.clientY - h.offsetTop
      try { grip.setPointerCapture(e.pointerId) } catch (_) {}
      const mv = (ev) => {   // 화면 밖으로 못 나가게 클램프(밖으로 끌어 잃어버려 게임 진행 불가 방지)
        const hw = h.offsetWidth, hh = h.offsetHeight
        const L = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - hw))
        const T = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - hh))
        h.style.left = L + 'px'; h.style.top = T + 'px'
      }
      const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up) }   // 세션 내 임시 이동만(저장 안 함 — 재빌드 시 다시 내 진영 위로)
      grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); e.preventDefault()
    })
    document.body.appendChild(h); battleHud = h
    positionHudAtBase(h)   // 항상 내 진영(고정) 위쪽에 배치
  }
  // 🧪 dev 솔로 테스트: 상대 진영(side 1)에 마나 무시 수동 소환. 자동 소환 없이 원하는 상황만 만들어 테스트.
  let battleDebugHud = null
  function buildDebugSpawnHud() {
    if (battleDebugHud) battleDebugHud.remove()
    const d = document.createElement('div'); d.className = 'no-drag'
    d.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483000;background:rgba(60,20,24,.94);border:1px solid #7a2b2b;border-radius:10px;padding:6px 9px;display:flex;gap:5px;align-items:center;font-family:system-ui,"맑은 고딕",sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.5)'
    d.innerHTML = '<span style="font-size:10px;color:#ffb3b3;font-weight:700;margin-right:2px">🧪 상대 소환</span>'
    const units = [['ant', '개미'], ['skySwarm', '나방떼'], ['bomberMoth', '폭격나방'], ['flakAnt', '대공포'], ['broodTitan', '타이탄']]
    for (const [id, name] of units) {
      if (!(window.BattleData && window.BattleData.UNITS[id])) continue
      const b = document.createElement('button'); b.textContent = name
      b.style.cssText = 'font-size:11px;padding:5px 8px;border-radius:7px;border:1px solid #a55;background:#2a1416;color:#ffe;cursor:pointer;user-select:none'
      b.onclick = () => { if (battle && battlePhase === 'playing') { battle.spawn(1, id, { free: true }); showToast(`상대 ${name} 소환`) } else showToast('전투 시작 후 소환') }
      d.appendChild(b)
    }
    document.body.appendChild(d); battleDebugHud = d
  }
  // HUD를 내 기지(내 캐릭터) 바로 위·가로 중앙에 배치(캐릭터를 가리지 않게). 항상 호출.
  function positionHudAtBase(h) {
    const W = canvas.clientWidth, H = canvas.clientHeight, hw = h.offsetWidth || 344, hh = h.offsetHeight || 300
    const baseX = (battleActive && battle) ? battleLaneX(0) : W / 2   // battleLaneX(0) = 내 진영 캐릭터 중심(flip 반영)
    const A = window.AnimalArt
    const catTop = Math.max(0, battleDeskY() - (A.BUBBLE_H + A.DESK_Y) * view.scale)   // 내 캐릭터(책상) 상단 = 새 기지 배치 기준
    let left = baseX - hw / 2, top = catTop - hh - 14   // 캐릭터 위쪽(안 가리게)
    left = Math.max(6, Math.min(left, W - hw - 6))
    top = Math.max(12, Math.min(top, H - hh - 6))
    h.style.left = left + 'px'; h.style.top = top + 'px'
  }
  function updateBattleHud() {
    if (battleCannonEl && battleCannon) {   // 캐논 원형 링 게이지 버튼
      const full = battleCannon.charge >= 1, ring = battleCannonEl.querySelector('.bmcring'), lbl = battleCannonEl.querySelector('.bmclbl')
      const deg = Math.round(battleCannon.charge * 360)
      if (ring) ring.style.background = `conic-gradient(${full ? '#ff8a3a' : '#ffd24a'} ${deg}deg, rgba(90,43,48,.55) ${deg}deg)`
      battleCannonEl.style.cursor = full ? 'pointer' : 'default'
      battleCannonEl.style.filter = full ? 'drop-shadow(0 0 10px rgba(255,120,60,.85))' : 'drop-shadow(0 4px 10px rgba(0,0,0,.5))'
      if (lbl) lbl.textContent = full ? '발사!' : '캐논'
    }
    if (!battleHud || !battle) return
    const mana = battle.state.mana[0], buff = battle.state.manaBuff ? (battle.state.manaBuff[0] || 0) : 0
    { const cap = (battle && battle.state.cfg.manaCap) || 30, per = cap / 10; battleHud.querySelectorAll('.bhsegs div').forEach((s, i) => s.style.background = i < Math.floor(mana / per) ? '#4aa3ff' : 'rgba(255,255,255,.14)') }   // 세그먼트 10칸 = 마나캡/10 (맥스 30 → 칸당 3)
    const v = battleHud.querySelector('.bhval'); if (v) v.textContent = `${mana.toFixed(1)}/${battle.state.cfg.manaCap}` + (buff > 0 ? ` ⚡+${buff.toFixed(1)}` : '')
    const mu = battleHud.querySelector('.bhmanaup')   // ⚡ 마나 강화: 단계 게이지 + 현재 속도 + 다음 비용/효과
    if (mu && battle.manaUpInfo) {
      const info = battle.manaUpInfo(0), total = info.max || 5
      // ★ innerHTML은 레벨이 바뀔 때만 재생성(매 프레임 재생성하면 클릭 도중 자식이 파괴돼 버튼이 안 눌림). 투명도만 매 프레임.
      const sig = info.level + '/' + info.maxed
      if (mu._sig !== sig) {
        mu._sig = sig
        let segs = ''
        for (let i = 0; i < total; i++) segs += `<div style="flex:1;height:7px;border-radius:2px;background:${i < info.level ? '#ffcf3a' : 'rgba(255,255,255,.14)'};pointer-events:none"></div>`
        const head = `⚡ 마나 강화 <b>Lv.${info.level}/${total}</b> · 현재 <b style="color:#fff">${info.rate.toFixed(1)}</b>/s`
        const nextLine = info.maxed ? `<span style="color:#8ff0c8;font-weight:700">MAX</span>` : `다음 <b style="color:#ffd86b">💧${info.nextCost}</b> → <b style="color:#fff">${(info.nextRate || 0).toFixed(1)}</b>/s`
        mu.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:10.5px;pointer-events:none"><span>${head}</span><span>${nextLine}</span></div><div style="display:flex;gap:2px;pointer-events:none">${segs}</div>`
      }
      mu.style.opacity = (info.maxed || mana >= info.nextCost) ? '1' : '0.55'
    }
    const nowH = performance.now()
    battleHud.querySelectorAll('.bhunits [data-id]').forEach((b) => {
      const id = b.dataset.id, u = window.BattleData.UNITS[id]
      const cdLeft = (unitReadyAt[id] || 0) - nowH, onCd = cdLeft > 0
      const cdEl = b.querySelector('.bhcd')
      if (cdEl) { if (onCd) { cdEl.style.display = 'flex'; cdEl.textContent = (cdLeft / 1000).toFixed(1) } else cdEl.style.display = 'none' }
      b.style.opacity = onCd ? '1' : ((u && mana >= (u.cost || 1)) ? '1' : '0.4')   // 쿨 중엔 오버레이로 표시(딤은 마나부족만)
    })
    { const nowH = performance.now(); battleHud.querySelectorAll('.bhweaps [data-wid]').forEach((b) => { const w = window.BattleData.WEAPONS[b.dataset.wid]; const onCd = nowH < (weaponCdUntil[b.dataset.wid] || 0); const ok = w && mana >= (w.mana != null ? w.mana : 2) && !onCd; b.style.opacity = ok ? '1' : '0.4'; let cdEl = b.querySelector('.bhwcd'); if (onCd) { if (!cdEl) { cdEl = document.createElement('div'); cdEl.className = 'bhwcd'; cdEl.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;background:rgba(10,14,20,.55);border-radius:9px;pointer-events:none'; b.style.position = 'relative'; b.appendChild(cdEl) } cdEl.textContent = Math.ceil((weaponCdUntil[b.dataset.wid] - nowH) / 1000) } else if (cdEl) cdEl.remove() }) }
  }
  function stepBattle(now) {
    let dt = (now - (battleLastT || now)) / 1000; battleLastT = now; if (dt > 0.1) dt = 0.1
    if (battlePhase === 'result') { if (battleBet && !battleBetSettled) settleBattleBet(battleWin); if (battleResultAt && now - battleResultAt > 3000) stopBattle(); return }   // 결과 확정 → 베팅 1회 정산 + 3초 뒤 복귀
    // 카운트다운 중엔 시뮬 정지(마나·행군 없음). 화면만 배틀 뷰.
    if (battlePhase === 'countdown') { if (now - battlePhaseAt >= BATTLE_CD_MS) { battlePhase = 'playing'; battleLastT = now } return }
    if (battleAI) battleAI(dt)
    if (battleMulti) battle.setGhosts(battleGhosts)   // 멀티: 내 유닛이 상대(고스트)를 타겟하도록
    battle.step(dt)
    battleBlackholePull(now, dt)   // 🕳 블랙홀 흡입(캐릭터 제외 유닛)
    // 지상 유닛 구멍 낙하: 지형이 관통될 만큼 파이면 그 위 지상 유닛은 아래로 떨어져 제거(공중형 제외). 참호 전략.
    const fellUids = new Set()
    for (const u of battle.state.units) {
      const def = window.BattleData.UNITS[u.type] || {}
      if (def.flying || u.hp <= 0) continue
      const ux = battleLaneX(u.L)
      if (taskbarHoleAt(ux)) { fellUids.add(u.uid); battle.hitUnit(u.uid, 1e9); spawnFallFx(ux, antGroundY(ux)) }
    }
    for (const e of battle.drainEvents()) {
      if (e.type === 'hit') { battleAtkAt[e.by] = now; if (e.slamL != null) { const sx = battleLaneX(e.slamL), sy = antGroundY(sx); addEffect(sx, sy - 14 * view.scale, 2); for (let k = 0; k < 6; k++) spawnDebris(sx + (Math.random() - 0.5) * (e.slamR || 0.1) * canvas.clientWidth, sy, 1, k % 2 ? '#d9c08a' : '#b8901e') } }   // 망치 범위 슬램 충격파
      else if (e.type === 'fire') { battleAtkAt[e.by] = now; battleFire(e) }   // 원거리 → 실제 투사체 발사
      else if (e.type === 'die') {
        const ddef = window.BattleData.UNITS[e.unit] || {}
        if (fellUids.has(e.uid)) battleFalls.push({ id: e.unit, L: e.L, side: e.side, born: now, vy: 1 })
        else if (ddef.flying) {   // 공중 유닛: 격추 → 공중 높이에서 회전하며 추락 + 폭발 퍼프
          const ax = battleLaneX(e.L), ay = battleUnitFeetY(ax, true)
          battleFalls.push({ id: e.unit, L: e.L, side: e.side, born: now, vy: 0.5, air: true, rot: 0, vr: (e.side === 0 ? 1 : -1) * 0.14 })
          addEffect(ax, ay - 12 * view.scale, 2); for (let k = 0; k < 7; k++) spawnSpark(ax + (Math.random() - 0.5) * 26 * view.scale, ay - Math.random() * 22 * view.scale)
        } else battleDead.push({ id: e.unit, L: e.L, side: e.side, born: now })
        if (e.unit === 'broodTitan') { const tx = battleLaneX(e.L), ty = antGroundY(tx); addEffect(tx, ty - 40 * view.scale, 4); for (let k = 0; k < 20; k++) spawnDebris(tx + (Math.random() - 0.5) * 120 * view.scale, ty - Math.random() * 60 * view.scale, 1, k % 2 ? '#4a5836' : '#ff9d3a') }   // 타이탄 사망: 큰 붕괴 폭발
      }
      else if (e.type === 'shieldblock' || e.type === 'shieldbreak') { battleShieldFlash[e.uid] = now }   // 쉴드가 막음 → 번쩍 연출
      else if (e.type === 'heal') battleHealFx.push({ medL: e.medL, healL: e.healL, born: now })           // 메딕 힐 → 초록 십자(본인+대상)
      else if (e.type === 'boom') { const bx = battleLaneX(e.L), by = antGroundY(bx) - 20 * view.scale; addEffect(bx, by, 3); for (let k = 0; k < 12; k++) spawnSpark(bx + (Math.random() - 0.5) * (e.aoeR || 0.05) * canvas.clientWidth, by + (Math.random() - 0.5) * 30 * view.scale); if (inTaskbar(bx, antGroundY(bx))) battleDig(bx, 0.6) }   // 카미카제/폭격나방 자폭
      else if (e.type === 'mothfall') {   // 폭격 나방 격추 → 전진 방향 낙하 폭탄(소유자 계산·데미지 + 상대 연출 릴레이)
        const x = battleLaneX(e.L), vdir = (e.dir || 1) * (battleFlip ? -1 : 1)
        spawnMothFall(x, vdir, e.side, e.dmg || 50, !!e.split, false)
        if (battleMulti && e.side === 0 && connected()) net.send(JSON.stringify({ t: 'bmothfall', to: battleMulti.oppId, fx: +(x / canvas.clientWidth).toFixed(4), vdir, dmg: e.dmg || 50, split: e.split ? 1 : 0 }))
      }
      else if (e.type === 'freeze') { const fx = battleLaneX(e.L), fy = antGroundY(fx) - 22 * view.scale; for (let k = 0; k < 10; k++) spawnSpark(fx + (Math.random() - 0.5) * 30 * view.scale, fy + (Math.random() - 0.5) * 40 * view.scale) }   // 빙결 순간
      else if (e.type === 'knockback') { const kx = battleLaneX(e.L), ky = antGroundY(kx); addEffect(kx, ky - 12 * view.scale, 1); for (let k = 0; k < 4; k++) spawnSpark(kx + (Math.random() - 0.5) * 24 * view.scale, ky - Math.random() * 20 * view.scale) }   // 넉백: 먼지/충격
      else if (e.type === 'titanlaser') {   // 💠 타이탄 땅 긁는 레이저: 입 발사 빔 + 연쇄 폭발(땅파임 없음). 데미지는 sim(ghosthit)로 별도.
        const fromX = battleLaneX(e.fromL), toX = battleLaneX(e.toL)
        titanLaserFx(fromX, toX)
        if (battleMulti && connected() && e.side === 0) net.send(JSON.stringify({ t: 'btitanlaser', to: battleMulti.oppId, fx: +(fromX / canvas.clientWidth).toFixed(4), tx: +(toX / canvas.clientWidth).toFixed(4) }))   // 상대 화면 연출 동일 재현(공용 절대프레임)
      }
      else if (e.type === 'ghosthit') { if (battleMulti && connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: e.uid, dmg: e.dmg, slow: e.slow || 0, slowDur: e.slowDur || 0, kb: e.kb ? 1 : 0 })) }   // 멀티: 상대 유닛 피격 릴레이(근접/광역, 넉백 플래그)
      else if (e.type === 'basehit') { if (battleMulti && e.side === 1 && connected()) net.send(JSON.stringify({ t: 'bbhit', to: battleMulti.oppId, dmg: e.dmg })) }   // 멀티: 상대 기지 피격 릴레이(근접)
      else if (e.type === 'baseshieldbreak') {   // 방어 돔 파괴 → 파열 연출(넉백은 sim이 로컬 유닛에 적용)
        const bx = battleLaneX(e.side), by = battleDeskY()
        addEffect(bx, by - 34 * view.scale, 4); for (let k = 0; k < 18; k++) spawnSpark(bx + (Math.random() - 0.5) * 150 * view.scale, by - Math.random() * 60 * view.scale)
        if (e.side === 0) showToast('🛡 방어 돔 폭발 — 근처 적 넉백!')
        if (battleMulti && e.side === 0 && connected()) for (const g of battleGhosts) { if (g.hp > 0 && g.L < 0.5) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: g.uid, dmg: 0, slow: 0, slowDur: 0, kb: 1, kbBig: 1 })) }   // 멀티: 근처 고스트 큰 넉백 릴레이(쉴드 파열)
      }
    }
    // 멀티: 내 유닛 목록 + 기지HP 방송(스로틀 100ms)
    if (battleMulti && connected() && battlePhase === 'playing' && now - bunitsLastSend > BUNITS_MS) {
      bunitsLastSend = now
      const list = battle.state.units.map((u) => ({ uid: u.uid, type: u.type, L: +u.L.toFixed(3), hp: u.hp, mhp: u.maxHp, shHp: u.shHp || 0, frozen: (u.frozenUntil && u.frozenUntil > battle.state.t) ? 1 : 0, slowed: (u.slowUntil && u.slowUntil > battle.state.t) ? 1 : 0 }))
      const bsh = battle.state.baseShield[0], bshU = Math.max(0, battle.state.baseShieldUntil[0] - battle.state.t)   // 내 방어 돔(상대 화면에 표시용)
      net.send(JSON.stringify({ t: 'bunits', to: battleMulti.oppId, list, base: battle.state.baseHp[0], mana: +battle.state.mana[0].toFixed(1), bsh, bshU: +bshU.toFixed(2) }))
    }
    for (let i = battleHealFx.length - 1; i >= 0; i--) if (now - battleHealFx[i].born > 650) battleHealFx.splice(i, 1)
    for (let i = battleFalls.length - 1; i >= 0; i--) { const f = battleFalls[i]; f.vy += 0.8; f._y = (f._y || 0) + f.vy; if (f.air) f.rot = (f.rot || 0) + (f.vr || 0); if (f._y > canvas.clientHeight + 60) battleFalls.splice(i, 1) }   // 구멍 낙하 / 공중 격추 추락
    stepBattleProj(now, dt)
    stepCannon(now, dt)   // 베이스 캐논 충전/스윕
    stepRemoteCannon(now) // 멀티: 상대 베이스 캐논 스윕 연출
    stepTurrets(now)      // 기지 터렛 자동 포격
    for (let i = battleDead.length - 1; i >= 0; i--) if (now - battleDead[i].born > 900) battleDead.splice(i, 1)
    updateBattleHud()
    if (battleMulti) {   // 멀티: 내 기지 HP가 권한(상대가 bbhit 릴레이). 0이면 내 패배 → 상대에게 통지.
      if (battle.state.baseHp[0] <= 0 && battlePhase !== 'result') { battlePhase = 'result'; battleResultAt = now; battleWin = false; seedBattleConfetti(); if (connected()) net.send(JSON.stringify({ t: 'battle-end', to: battleMulti.oppId, result: 'loser' })) }
    } else if (battle.state.winner != null && battlePhase !== 'result') { battlePhase = 'result'; battleResultAt = now; battleWin = battle.state.winner === 0; seedBattleConfetti(); if (battleWin) recordBattleWin() }   // 솔로 승리 업적
    if (battleResultAt && now - battleResultAt > 3000) stopBattle()   // 결과 연출 3초 뒤 원래 화면 복귀
  }
  // 진영 구분 마커 — 유닛 머리 위 작은 삼각형(▼). 내편(side0)=파랑 / 상대(side1)=빨강.
  function drawTeamMarker(x, feetY, side, type, sizeMul) {
    const hb = unitHitboxScreen(type, sizeMul || 1)
    const topY = feetY - hb.top - 6 * view.scale   // 머리 위 살짝
    const col = side === 0 ? '#4aa3ff' : '#ff5a4a'
    const w = 6 * view.scale, h = 7 * view.scale
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.45)'   // 외곽 그림자(가독성)
    ctx.beginPath(); ctx.moveTo(x - w - 1, topY - h - 1); ctx.lineTo(x + w + 1, topY - h - 1); ctx.lineTo(x, topY + 1); ctx.closePath(); ctx.fill()
    ctx.fillStyle = col                  // ▼ 아래를 가리키는 삼각형(유닛 지목)
    ctx.beginPath(); ctx.moveTo(x - w, topY - h); ctx.lineTo(x + w, topY - h); ctx.lineTo(x, topY); ctx.closePath(); ctx.fill()
    ctx.restore()
  }
  // 기지 방어 돔(쉴드 무기) — 캐릭터 책상을 덮는 육각 반구. HP 비율로 손상 연출(drawHexDome 재사용).
  function drawBaseShieldDome(side, now) {
    if (!battle) return
    let hp, active
    if (battleMulti && side === 1) { hp = battleGhostShield.hp; active = hp > 0 && battleGhostShield.until > now }   // 멀티: 상대 방어 돔 = 릴레이 상태
    else { hp = battle.state.baseShield[side]; active = hp > 0 && battle.state.baseShieldUntil[side] > battle.state.t }
    if (!active) return
    const x = battleLaneX(side), cy = battleDeskY()
    const r = (CELL_W / 2) * view.scale * 1.3   // ★ 고양이만이 아니라 책상 전체(CELL_W)를 덮는 반구
    const hp01 = Math.max(0, hp / BATTLE_SHIELD_HP)
    drawHexDome(x, cy, r, hp01, now, true)
    // HP 저하 연출: 낮을수록 균열 증가(체력에 따른 연출)
    if (hp01 < 0.7) {
      const cracks = hp01 < 0.35 ? 5 : hp01 < 0.55 ? 3 : 2
      ctx.save(); ctx.beginPath(); ctx.arc(x, cy, r * 0.99, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.clip()
      ctx.strokeStyle = `rgba(255,${Math.round(90 + 90 * hp01)},${Math.round(70 * hp01)},${0.55 + 0.3 * (1 - hp01)})`; ctx.lineWidth = 1.4 * view.scale; ctx.lineJoin = 'round'
      for (let c = 0; c < cracks; c++) {
        const ang = Math.PI + (0.12 + (c + 0.5) / cracks * 0.76) * Math.PI   // 윗 반구 범위
        let px = x + Math.cos(ang) * r * 0.12, py = cy + Math.sin(ang) * r * 0.12
        ctx.beginPath(); ctx.moveTo(px, py)
        for (let k = 1; k <= 4; k++) {
          const rr = r * (0.12 + 0.86 * k / 4), aa = ang + Math.sin(c * 3.1 + k * 1.7) * 0.18
          px = x + Math.cos(aa) * rr; py = Math.min(cy, cy + Math.sin(aa) * rr)
          ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
      ctx.restore()
    }
  }
  // 💠 브루드 타이탄 — 거대 여왕 요새(가시=갑각 윤곽에서 직접 돋음, 빛나는 알주머니, 왕관, 레이저 포구)
  // opts: { walking, atkT(스톰프 후 경과ms·-1이면 없음), knocked, deathT(0..1·-1이면 없음) }
  function drawBroodTitan(x, feetY, s, facing, now, opts) {
    opts = opts || {}
    const glow = 0.6 + 0.4 * Math.abs(Math.sin(now / 500))
    const walkPh = now / 130
    const stomp = (opts.atkT != null && opts.atkT >= 0) ? Math.sin(Math.min(1, opts.atkT / 160) * Math.PI) : 0   // 스톰프: 잠깐 주저앉았다 쿵
    const dtn = (opts.deathT != null && opts.deathT >= 0) ? opts.deathT : 0                                      // 죽음: 가라앉으며 페이드
    ctx.save(); ctx.globalAlpha *= (1 - dtn * 0.9)
    ctx.translate(x, feetY + stomp * 5 * s + dtn * 24 * s)
    if (opts.knocked) ctx.translate(-facing * 6 * s, 0)   // 넉백: 뒤로 밀린 자세
    ctx.scale(facing, 1); ctx.lineJoin = 'round'
    // 다리(걷기 시 앞뒤 스윙 — 기본 개미 antLower 방식): 인접 다리 반대 위상, 앞으로 뻗을 때 살짝 듦
    ctx.strokeStyle = '#20261a'; ctx.lineWidth = 5 * s; ctx.lineCap = 'round'
    const legXs = [-34, -14, 8, 28]
    for (let i = 0; i < legXs.length; i++) {
      const lx = legXs[i], ph2 = walkPh * 6 + i * Math.PI
      const sw = opts.walking ? Math.sin(ph2) * 8 * s : 0            // 발 앞뒤 스윙
      const lift = opts.walking ? Math.max(0, Math.cos(ph2)) * 4 * s : 0   // 앞으로 뻗을 때 살짝 듦
      ctx.beginPath(); ctx.moveTo(lx * s, -30 * s); ctx.lineTo((lx - 3) * s + sw * 0.4, -15 * s); ctx.lineTo((lx - 5) * s + sw, -lift); ctx.stroke()
    }
    // 알주머니(발광)
    const g = ctx.createRadialGradient(-32 * s, -36 * s, 4 * s, -32 * s, -36 * s, 46 * s)
    g.addColorStop(0, '#ffe08a'); g.addColorStop(0.5, '#ff9d3a'); g.addColorStop(1, '#c25916')
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-32 * s, -36 * s, 46 * s, 40 * s, 0, 0, 7); ctx.fill()
    ctx.strokeStyle = '#8a3d12'; ctx.lineWidth = 1.5 * s; ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.25 * glow) + ')'
    for (const c of [[-48, -46, 6], [-32, -30, 7], [-54, -24, 5], [-20, -48, 5]]) { ctx.beginPath(); ctx.arc(c[0] * s, c[1] * s, c[2] * s, 0, 7); ctx.fill() }
    // 갑각 + 뿌리박은 가시(한 실루엣)
    ctx.fillStyle = '#2b3420'; ctx.strokeStyle = '#151a0f'; ctx.lineWidth = 1.6 * s
    ctx.beginPath(); ctx.moveTo(-62 * s, -54 * s); ctx.quadraticCurveTo(-48 * s, -86 * s, -30 * s, -86 * s)
    ctx.lineTo(-24 * s, -100 * s); ctx.lineTo(-18 * s, -84 * s); ctx.lineTo(-8 * s, -106 * s); ctx.lineTo(2 * s, -82 * s); ctx.lineTo(8 * s, -98 * s); ctx.lineTo(14 * s, -76 * s)
    ctx.quadraticCurveTo(8 * s, -64 * s, -4 * s, -62 * s); ctx.closePath(); ctx.fill(); ctx.stroke()
    // 흉부
    ctx.beginPath(); ctx.ellipse(18 * s, -42 * s, 24 * s, 28 * s, 0, 0, 7); ctx.fill(); ctx.stroke()
    // 머리
    ctx.save(); ctx.translate(48 * s, -44 * s)
    ctx.fillStyle = '#2b3420'; ctx.beginPath(); ctx.ellipse(0, 0, 20 * s, 18 * s, 0, 0, 7); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#c9a23a'; ctx.strokeStyle = '#7a5e12'; ctx.beginPath()
    ctx.moveTo(-12 * s, -14 * s); ctx.lineTo(-13 * s, -25 * s); ctx.lineTo(-5 * s, -16 * s); ctx.lineTo(0, -28 * s); ctx.lineTo(5 * s, -16 * s); ctx.lineTo(12 * s, -25 * s); ctx.lineTo(12 * s, -14 * s); ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#ff5a2a'; ctx.beginPath(); ctx.ellipse(8 * s, -2 * s, 4 * s, 5 * s, 0, 0, 7); ctx.fill()
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(8 * s, -2 * s, 1.6 * s, 0, 7); ctx.fill()
    ctx.fillStyle = '#d9d2c0'; ctx.strokeStyle = '#5a5240'; ctx.lineWidth = 1.4 * s
    ctx.beginPath(); ctx.moveTo(18 * s, 2 * s); ctx.quadraticCurveTo(34 * s, 0, 40 * s, 10 * s); ctx.quadraticCurveTo(30 * s, 7 * s, 22 * s, 11 * s); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(18 * s, 8 * s); ctx.quadraticCurveTo(34 * s, 13 * s, 38 * s, 22 * s); ctx.quadraticCurveTo(28 * s, 16 * s, 21 * s, 15 * s); ctx.closePath(); ctx.fill()
    ctx.fillStyle = 'rgba(255,58,110,' + glow + ')'; ctx.beginPath(); ctx.arc(2 * s, -15 * s, 4 * s, 0, 7); ctx.fill()
    ctx.restore()
    // 피격 플래시(HP 감소 순간 흰 번쩍) — 몸통/머리 위에 잠깐
    if (opts.hitT != null && opts.hitT >= 0) {
      ctx.globalAlpha *= Math.max(0, 1 - opts.hitT / 160) * 0.7; ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.ellipse(-32 * s, -36 * s, 46 * s, 40 * s, 0, 0, 7); ctx.fill()
      ctx.beginPath(); ctx.ellipse(18 * s, -42 * s, 24 * s, 28 * s, 0, 0, 7); ctx.fill()
      ctx.beginPath(); ctx.ellipse(48 * s, -44 * s, 20 * s, 18 * s, 0, 0, 7); ctx.fill()
    }
    ctx.restore()
  }
  // 잔해 벽(타이탄 Lv5 사망 시) — 낮고 넓은 시체산. 땅(파임 반영)에 안착.
  function drawMoundWall(x, feetY, s) {
    ctx.save(); ctx.translate(x, feetY); ctx.lineJoin = 'round'
    ctx.fillStyle = '#2b3420'; ctx.strokeStyle = '#151a0f'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(-42 * s, 2); ctx.quadraticCurveTo(-22 * s, -34 * s, 0, -30 * s); ctx.quadraticCurveTo(26 * s, -40 * s, 42 * s, 2); ctx.closePath(); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#4a5836'
    for (const b of [[-18, -30], [4, -34], [22, -28]]) { ctx.beginPath(); ctx.moveTo(b[0] * s, b[1] * s); ctx.lineTo((b[0] - 3) * s, (b[1] - 14) * s); ctx.lineTo((b[0] + 5) * s, (b[1] - 4) * s); ctx.closePath(); ctx.fill() }
    ctx.fillStyle = 'rgba(255,157,58,0.4)'; ctx.beginPath(); ctx.ellipse(-14 * s, -8 * s, 12 * s, 8 * s, 0, 0, 7); ctx.fill()
    ctx.restore()
  }
  // 💠 타이탄 레이저: 포구→땅 빔 + 땅 긁힘 띠(파임 따라감). 연쇄 폭발은 addEffect로 별도.
  // 레이저 = 접점이 시작→끝까지 쭉 긁는 스윕. 진행하며 그 자리에 얕게 파이고 폭발이 바로 따라옴.
  // owner 이벤트·수신 릴레이 양쪽이 같은 fromX/toX·타이밍으로 재생 → 연출·파임 동일.
  const TITAN_SWEEP_MS = 240
  function titanLaserFx(fromX, toX) {
    const dir = toX >= fromX ? 1 : -1
    titanLasers.push({ fromX, toX, dir, startX: fromX + dir * 30 * view.scale, born: performance.now(), dugTo: null, boomAt: null })   // 파임/폭발은 스윕 진행하며 점진 발생
  }
  function drawTitanLasers(now) {
    for (let i = titanLasers.length - 1; i >= 0; i--) {
      const t = titanLasers[i], el = now - t.born
      if (el > TITAN_SWEEP_MS + 220) { titanLasers.splice(i, 1); continue }
      const dir = t.dir, prog = Math.min(1, el / TITAN_SWEEP_MS)
      const mouthX = t.fromX + dir * 40 * view.scale, mouthY = taskbarSurfaceY(t.fromX) - 66 * view.scale
      const front = t.startX + (t.toX - t.startX) * prog   // 현재 긁는 접점
      // 접점이 지나간 자리에 바로 뒤따르는 폭발(연출 전용 — 땅파임 없음)
      if (t.boomAt == null) { t.boomAt = t.startX }
      const bstep = 38 * view.scale
      while (dir > 0 ? t.boomAt <= front : t.boomAt >= front) { addEffect(t.boomAt, taskbarSurfaceY(t.boomAt), 1); t.boomAt += dir * bstep }   // 바로 따라오는 폭발
      // 빔 그리기: 입 → 현재 접점(front). 지나간 구간은 옅은 그을림 자국.
      const fade = el > TITAN_SWEEP_MS ? Math.max(0, 1 - (el - TITAN_SWEEP_MS) / 220) : 1
      ctx.save(); ctx.lineCap = 'round'
      // 지나간 스크레이프 자국(startX→front)
      ctx.globalAlpha = 0.5 * fade; ctx.strokeStyle = 'rgba(255,90,40,0.8)'; ctx.lineWidth = 5 * view.scale
      ctx.beginPath(); const lo = Math.min(t.startX, front), hi = Math.max(t.startX, front); for (let x = lo; x <= hi; x += 8 * view.scale) { const yy = taskbarSurfaceY(x); x === lo ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy) } ctx.stroke()
      // 활성 빔: 입 → 접점
      ctx.globalAlpha = fade
      ctx.strokeStyle = 'rgba(255,58,110,0.92)'; ctx.lineWidth = 6 * view.scale; ctx.beginPath(); ctx.moveTo(mouthX, mouthY); ctx.lineTo(front, taskbarSurfaceY(front)); ctx.stroke()
      ctx.strokeStyle = 'rgba(255,243,196,0.95)'; ctx.lineWidth = 2.4 * view.scale; ctx.beginPath(); ctx.moveTo(mouthX, mouthY); ctx.lineTo(front, taskbarSurfaceY(front)); ctx.stroke()
      // 접점 섬광
      ctx.globalAlpha = fade; ctx.fillStyle = 'rgba(255,243,196,0.9)'; ctx.beginPath(); ctx.arc(front, taskbarSurfaceY(front), 6 * view.scale, 0, 7); ctx.fill()
      ctx.restore()
    }
  }
  function drawBattleUnits(now) {
    if (!battle || !window.BattleSprites) return
    const st = battle.state
    for (const u of st.units) {
      if (u.structure) continue   // 게틀링 등 구조물은 drawGatlings가 그림(여기선 충돌/타겟용으로만 존재)
      if (u.netted && u.frozenUntil > battle.state.t) continue   // 상대 그물에 잡힌 유닛 = 숨김(상대 네트 번들에 표시됨)
      let x = battleLaneX(u.L); const def = window.BattleData.UNITS[u.type] || {}
      let y = battleUnitFeetY(x, def.flying)
      const knocked = u.kbUntil && u.kbUntil > battle.state.t   // 넉백 중엔 공격 연출(총구 섬광·차지) 억제
      const facing = (u.side === 0 ? 1 : -1) * (battleFlip ? -1 : 1), atk = !knocked && battleAtkAt[u.uid] && now - battleAtkAt[u.uid] < 380   // ★ battleFlip(수락자) 반영 — 안 하면 화면상 반대로 걸음
      let s = view.scale * BATTLE_UNIT_SCALE * (def.size || 1)
      const bh = bhRenderPull(x, y, now); if (bh) { x = bh.x; y = bh.y; s *= bh.scl }   // 🕳 블랙홀 흡입: 홀 중심으로 끌려 올라가며 축소
      drawTeamMarker(x, y, u.side, u.type, def.size || 1)   // 진영 구분: 머리 위 삼각형(내편 파랑 / 상대 빨강)
      // 커맨더 오라 링(바닥, 유닛 뒤) — 주변 아군 버프 범위 표시
      if (def.aura) { const rad = def.aura.range * (canvas.clientWidth - 2 * battlePad()); ctx.save(); ctx.globalAlpha = 0.5 + 0.2 * Math.sin(now / 300); ctx.strokeStyle = 'rgba(255,210,90,.5)'; ctx.lineWidth = 2 * view.scale; ctx.beginPath(); ctx.ellipse(x, antGroundY(x), rad, rad * 0.18, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore() }
      // 메카/인간 = 기존 오버레이 아트 그대로 재사용(새로 안 만듦). 쉴드도 form별(돔/판넬) 원본 함수 재사용.
      const sh01 = u.shHp > 0 && u.shMax ? u.shHp / u.shMax : null
      if (u.type === 'mechaAnt') drawOverlayMechaAt(x, y, 0.43 * (def.size || 1.6), facing, 0, now, { walking: true, shHp01: sh01 })
      else if (u.type === 'mechaHuman') {
        // 공중형: 걷기 모션 제거 + 진행 방향으로 살짝 기울임(멈추면 복귀)
        const moving = !atk, tgtLean = moving ? facing * 0.16 : 0
        u._lean = (u._lean || 0) + (tgtLean - (u._lean || 0)) * 0.12
        // 에너지포 충전: 교전(_acting) 중이면 cdLeft 기준 0→1로 에너지볼이 커지는 연출
        const ecd = (def.atk && def.atk.cd) || 1
        const charge = (u._acting && !knocked && def.atk && def.atk.charge) ? Math.max(0, Math.min(1, 1 - (u.cdLeft || 0) / ecd)) : 0
        drawOverlayMechaAt(x, y, 0.46 * (def.size || 1.7), facing, 1, now, { walking: false, lean: u._lean, shHp01: sh01, charge })
      }
      else if (u.type === 'human') drawOverlayHumanAt(x, y, 0.80 * (def.size || 1.3), facing, now)
      else if (u.type === 'broodTitan') { if (u._lastHp != null && u.hp < u._lastHp) u._hitAt = now; u._lastHp = u.hp; const hitT = (u._hitAt && now - u._hitAt < 160) ? (now - u._hitAt) : -1; drawBroodTitan(x, y + 5 * view.scale, view.scale * 1.725, facing, now, { walking: !atk && !knocked, atkT: atk ? (now - battleAtkAt[u.uid]) : -1, knocked, hitT }) }
      else window.BattleSprites.draw(ctx, u.type, { x, y: y + 5 * view.scale, scale: s, facing, state: atk ? 'attack' : 'walk', t: u.uid * 0.37 + now / 1000, flash: atk })   // +5: 발이 표면에 닿게
      const isMecha = u.type === 'mechaAnt' || u.type === 'mechaHuman'
      // 원거리 공격 순간 총구/포구 섬광(재사용 아트 위에 얹어 "발사"가 보이게)
      const ranged = def.atk && def.atk.type && def.atk.type !== 'none' && def.atk.type !== 'melee' && def.atk.type !== 'heal'
      if (atk && ranged && now - battleAtkAt[u.uid] < 160) {
        const mz = PROJ_MUZZLE[u.type] || PROJ_MUZZLE._default, mx = x + facing * mz.x * s, my = y - mz.y * s
        ctx.fillStyle = 'rgba(255,224,140,.95)'; ctx.beginPath(); ctx.arc(mx, my, 5 * s, 0, 7); ctx.fill()
        ctx.fillStyle = 'rgba(255,157,58,.9)'; ctx.beginPath(); ctx.arc(mx + facing * 3 * s, my, 3 * s, 0, 7); ctx.fill()
      }
      // 자동 쉴드 — 메카/인간폼은 drawOverlayMechaAt 안에서 form별(돔/판넬) 원본 쉴드로 그려짐.
      // 그 외 쉴드 유닛(쉴더 등)만 여기서 반구 돔으로.
      if (u.shHp > 0 && !isMecha) drawBattleShield(x, y, s, u, now)
      if (u.shHp > 0 && isMecha) {   // 방어 순간 번쩍만 공통으로
        const fl = battleShieldFlash[u.uid] && now - battleShieldFlash[u.uid] < 220 ? 1 - (now - battleShieldFlash[u.uid]) / 220 : 0
        if (fl > 0) { ctx.save(); ctx.globalAlpha = fl * 0.8; ctx.strokeStyle = 'rgba(230,248,255,0.95)'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(x, y - 30 * s, 26 * s, 0, 7); ctx.stroke(); ctx.restore() }
      }
      // ❄ 빙결/감속 연출: 얼면 하늘색 얼음 오버레이, 느려지면 옅은 파란 물결
      const st2 = battle.state
      const frozen = u.frozenUntil && u.frozenUntil > st2.t, slowed = !frozen && u.slowUntil && u.slowUntil > st2.t
      if (frozen || slowed) {
        const hb = unitHitboxScreen(u.type, def.size)
        ctx.save(); ctx.globalAlpha = frozen ? 0.5 : 0.24
        ctx.fillStyle = frozen ? 'rgba(170,225,255,1)' : 'rgba(140,200,255,1)'
        ctx.beginPath(); ctx.roundRect(x - hb.halfW, y - hb.top, hb.halfW * 2, hb.top + 4 * view.scale, 6 * view.scale); ctx.fill()
        if (frozen) { ctx.globalAlpha = 0.85; ctx.strokeStyle = '#dff2ff'; ctx.lineWidth = 1.4 * view.scale; ctx.stroke(); ctx.fillStyle = '#eaffff'; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x + k * hb.halfW * 0.5, y - hb.top); ctx.lineTo(x + k * hb.halfW * 0.5 - 3 * view.scale, y - hb.top - 7 * view.scale); ctx.lineTo(x + k * hb.halfW * 0.5 + 3 * view.scale, y - hb.top - 7 * view.scale); ctx.closePath(); ctx.fill() } }
        ctx.restore()
      }
      const w = 24 * s, f = u.hp / u.maxHp
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - w / 2, y - 44 * s, w, 3.5)
      ctx.fillStyle = f > 0.4 ? '#7ecb7e' : '#e24b4a'; ctx.fillRect(x - w / 2, y - 44 * s, w * f, 3.5)
    }
    // 내 잔해 벽(구조물이라 위 유닛 루프에서 스킵됨) — 땅 위에 그림
    for (const u of st.units) { if (u.type === 'moundwall') { const mx = battleLaneX(u.L); drawMoundWall(mx, antGroundY(mx), view.scale * 1.1) } }
    // 멀티: 상대(고스트) 유닛 — 내 기지 쪽으로 전진. facing은 내 유닛과 반대 방향(battleFlip 반영).
    const gFacing = battleFlip ? 1 : -1   // ★ 수락자(flip)면 고스트는 오른쪽(내 기지)이 아니라... 내 유닛(-flip)의 반대 = flip?1:-1
    if (battleMulti) for (const g of battleGhosts) {
      if (g.hp <= 0) continue
      if (g._dispL == null) g._dispL = g.L; else g._dispL += (g.L - g._dispL) * 0.34   // 50ms 방송 사이 보간(버벅임 완화). 갱신 빨라져 계수 소폭↑(0.25→0.34)로 지연 감소
      if (g.type === 'moundwall') { const mx = battleLaneX(g._dispL); drawMoundWall(mx, antGroundY(mx), view.scale * 1.1); continue }   // 상대 잔해 벽(지형 위)
      const gdef = window.BattleData.UNITS[g.type] || {}; let gx = battleLaneX(g._dispL), gy = battleUnitFeetY(gx, gdef.flying)
      let gs = view.scale * BATTLE_UNIT_SCALE * (gdef.size || 1)
      const gbh = bhRenderPull(gx, gy, now); if (gbh) { gx = gbh.x; gy = gbh.y; gs *= gbh.scl }   // 🕳 상대 유닛도 블랙홀에 빨려드는 연출(공용 프레임서 계산 → 양쪽 동일)
      drawTeamMarker(gx, gy, 1, g.type, gdef.size || 1)   // 상대(고스트) = 빨강 머리 위 삼각형
      if (g.type === 'mechaAnt') drawOverlayMechaAt(gx, gy, 0.43 * (gdef.size || 1.6), gFacing, 0, now, { walking: true, shHp01: g.shHp > 0 ? 1 : null })
      else if (g.type === 'mechaHuman') drawOverlayMechaAt(gx, gy, 0.46 * (gdef.size || 1.7), gFacing, 1, now, { walking: false, shHp01: g.shHp > 0 ? 1 : null })
      else if (g.type === 'human') drawOverlayHumanAt(gx, gy, 0.80 * (gdef.size || 1.3), gFacing, now)
      else if (g.type === 'broodTitan') { if (g._lastHp != null && g.hp < g._lastHp) g._hitAt = now; g._lastHp = g.hp; const ghT = (g._hitAt && now - g._hitAt < 160) ? (now - g._hitAt) : -1; drawBroodTitan(gx, gy + 5 * view.scale, view.scale * 1.725, gFacing, now, { walking: !g.frozen, atkT: -1, knocked: false, hitT: ghT }) }
      else window.BattleSprites.draw(ctx, g.type, { x: gx, y: gy + 5 * view.scale, scale: gs, facing: gFacing, state: 'walk', t: g.uid * 0.31 + now / 1000 })   // +5: 발이 표면에 닿게
      if (g.shHp > 0 && !(g.type === 'mechaAnt' || g.type === 'mechaHuman')) drawBattleShield(gx, gy, gs, { uid: 'g' + g.uid, shHp: 1, shMax: 1 }, now)
      if (g.frozen || g.slowed) { const hb = unitHitboxScreen(g.type, gdef.size); ctx.save(); ctx.globalAlpha = g.frozen ? 0.5 : 0.24; ctx.fillStyle = g.frozen ? 'rgba(170,225,255,1)' : 'rgba(140,200,255,1)'; ctx.beginPath(); ctx.roundRect(gx - hb.halfW, gy - hb.top, hb.halfW * 2, hb.top + 4 * view.scale, 6 * view.scale); ctx.fill(); ctx.restore() }
      // 상대 유닛도 체력바 표시(내 유닛과 동일)
      { const gw = 24 * gs, gf = Math.max(0, g.hp / (g.mhp || g.hp)); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(gx - gw / 2, gy - 44 * gs, gw, 3.5); ctx.fillStyle = gf > 0.4 ? '#7ecb7e' : '#e24b4a'; ctx.fillRect(gx - gw / 2, gy - 44 * gs, gw * gf, 3.5) }
    }
    // 메딕 힐 초록 십자 — 메딕 본인 + 회복 대상 양쪽에 표시
    for (const h of battleHealFx) {
      const a = 1 - (now - h.born) / 650
      for (const L of [h.medL, h.healL]) { const hx = battleLaneX(L), hy = antGroundY(hx) - 46 * view.scale - (1 - a) * 10 * view.scale; ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = '#3ad06a'; const r = 5 * view.scale; ctx.fillRect(hx - r / 3, hy - r, r * 0.66, r * 2); ctx.fillRect(hx - r, hy - r / 3, r * 2, r * 0.66); ctx.restore() }
    }
    for (const d of battleDead) { const p = Math.min(1, (now - d.born) / 900); const dx = battleLaneX(d.L); if (d.id === 'broodTitan') drawBroodTitan(dx, antGroundY(dx), view.scale * 1.725, d.side === 0 ? 1 : -1, now, { walking: false, atkT: -1, deathT: p }); else window.BattleSprites.draw(ctx, d.id, { x: dx, y: antGroundY(dx), scale: view.scale * BATTLE_UNIT_SCALE, facing: d.side === 0 ? 1 : -1, state: 'death', t: 0, deathT: p }) }
    for (const f of battleFalls) {
      const fx = battleLaneX(f.L), sz = view.scale * BATTLE_UNIT_SCALE * (window.BattleData.UNITS[f.id] ? (window.BattleData.UNITS[f.id].size || 1) : 1)
      const base = f.air ? battleUnitFeetY(fx, true) : antGroundY(fx), fy = base + (f._y || 0)
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - (f._y || 0) / (canvas.clientHeight * 0.8))
      if (f.air) { ctx.translate(fx, fy - 18 * sz / (BATTLE_UNIT_SCALE)); ctx.rotate(f.rot || 0); ctx.translate(-fx, -(fy - 18 * sz / (BATTLE_UNIT_SCALE))) }   // 격추: 회전하며 추락
      if (f.id === 'broodTitan') drawBroodTitan(fx, fy, view.scale * 1.725, f.side === 0 ? 1 : -1, now, { walking: false, atkT: -1 })
      else window.BattleSprites.draw(ctx, f.id, { x: fx, y: fy, scale: sz, facing: f.side === 0 ? 1 : -1, state: f.air ? 'death' : 'walk', t: now / 1000, deathT: f.air ? Math.min(1, (now - f.born) / 500) : 0 })
      ctx.restore()
    }   // 구멍 낙하 / 공중 격추(회전 추락)
    drawBattleTurret(turretBaseX(0), 0, now); drawBattleTurret(turretBaseX(1), 1, now)   // 각 진영 포탑(고양이 옆 책상 위, 상대 바라봄)
    drawBattleProj(now)   // 투사체(총알·포탄·에너지·수류탄 등)
    drawTitanLasers(now)  // 💠 타이탄 땅 긁는 레이저
    stepBattleInterceptors(now)  // 🎯 대공포 요격 미사일(유도)
    // 기지 HP 바 (양 끝 고양이 위)
    drawBattleBaseHp(battleLaneX(0), 0); drawBattleBaseHp(battleLaneX(1), 1)
    drawBaseShieldDome(0, now); drawBaseShieldDome(1, now)   // 기지 방어 돔(쉴드 무기)
    drawBattleFX(now)   // 카운트다운 / 승패 연출(화면 중앙)
  }
  function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t }
  // 기지 포탑 — 냥코 베이스 대포탑 느낌(크고 묵직한 금속 캐논). 포신이 타겟을 조준해 회전 + 발사 반동·포구 화염·연기.
  function drawBattleTurret(baseX, side, now) {
    const s = view.scale * 1.8, face = side === 0 ? 1 : -1
    const by = battleDeskY()   // 고양이가 앉은 책상 윗면(작업표시줄 아님)에 안착
    const x = baseX
    const tint = antColor(side === 0 ? me.skin : ((peers.get(battleMulti && battleMulti.oppId) || {}).tint || 'gray'))
    const metal = mixHex('#8a90a0', tint, 0.35), dark = mixHex('#4a4e5a', tint, 0.3), hi = mixHex('#c9cfdb', tint, 0.35), accent = '#d94b46'
    const pivotX = x, pivotY = by - 20 * s
    // 조준: 발사 직후엔 실제 발사 벡터(위로 쏘면 위) 방향, 평상시엔 가장 가까운 적/중앙 추적.
    const fired = now - (battleTurretFire[side] || -1e9)
    let desired
    if (fired < 420) { desired = battleTurretShotAng[side] }   // 발사 연출 창: 포신 = 실제 포탄 진행 방향
    else if (battleTurretTgtL[side] != null && fired < TURRET_CD + 600) { const tx = battleLaneX(battleTurretTgtL[side]), ty = battleTurretTgtFly[side] ? (battleUnitFeetY(tx, true) - 8 * view.scale) : (antGroundY(tx) - 18 * view.scale); desired = Math.atan2(ty - pivotY, (tx - pivotX)) }   // 공중 타겟이면 포신도 위로
    else { const tx = battleLaneX(side === 0 ? 0.35 : 0.65), ty = antGroundY(tx) - 18 * view.scale; desired = Math.atan2(ty - pivotY, (tx - pivotX)) }   // 평상시 상대 쪽(아래·앞) 겨냥
    battleTurretAim[side] = lerpAngle(battleTurretAim[side] || (face >= 0 ? 0.3 : Math.PI - 0.3), desired, 0.2)
    const recoil = fired < 200 ? -(1 - fired / 200) * 6 * s : 0
    ctx.save(); ctx.lineJoin = 'round'
    ctx.fillStyle = mixHex('#2a2d35', tint, 0.2); ctx.beginPath(); ctx.ellipse(x, by + 1 * s, 17 * s, 4 * s, 0, 0, 7); ctx.fill()   // 책상 위 접지 그림자
    ctx.restore()
    ctx.save(); ctx.translate(x, by); ctx.lineJoin = 'round'
    // 받침대(사다리꼴) + 볼트
    ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-18 * s, 0); ctx.lineTo(18 * s, 0); ctx.lineTo(13 * s, -14 * s); ctx.lineTo(-13 * s, -14 * s); ctx.closePath(); ctx.fill()
    ctx.fillStyle = metal; roundRect(-14 * s, -30 * s, 28 * s, 18 * s, 5 * s); ctx.fill()   // 몸통
    ctx.fillStyle = hi; roundRect(-14 * s, -30 * s, 28 * s, 5 * s, 4 * s); ctx.fill()        // 상단 하이라이트
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(0, -21 * s, 3 * s, 0, 7); ctx.fill()    // 중앙 코어
    // 회전 포신(pivot = 돔 중심)
    ctx.save(); ctx.translate(0, -20 * s); ctx.rotate(battleTurretAim[side])
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, 11 * s, 0, 7); ctx.fill()           // 힌지 돔
    ctx.fillStyle = metal; roundRect(recoil, -6 * s, 34 * s, 12 * s, 3 * s); ctx.fill()       // 포신
    ctx.fillStyle = hi; ctx.fillRect(recoil + 2 * s, -5 * s, 30 * s, 2.5 * s)                 // 포신 라인
    ctx.fillStyle = '#22252c'; roundRect(28 * s + recoil, -7 * s, 7 * s, 14 * s, 2 * s); ctx.fill()  // 포구
    if (fired < 130) { const fl = 1 - fired / 130; ctx.fillStyle = 'rgba(255,224,140,' + (0.9 * fl) + ')'; ctx.beginPath(); ctx.arc((40 + recoil / s) * s, 0, (7 + fl * 5) * s, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,150,60,' + (0.8 * fl) + ')'; ctx.beginPath(); ctx.arc(38 * s, 0, 4 * s, 0, 7); ctx.fill() }   // 포구 화염
    ctx.restore()
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, -20 * s, 4 * s, 0, 7); ctx.fill()       // 회전축
    ctx.restore()
    // 내 진영(side0) 포탑 상단 좌표를 캐논 버튼 배치에 사용(포탑 위에 얹기)
    if (side === 0 && battleCannonEl) positionCannonButton(x, by - 34 * s)
  }
  // 자동 쉴드 시각화 = 기존 오버레이 쉴드 돔(drawHexDome) 재사용. HP 저하 색/깜빡임/벌집·림 그대로.
  function drawBattleShield(x, y, s, u, now) {
    const r = 30 * s, cyb = y - 4 * s   // 발밑 라인에 돔 바닥, 위로 몸통을 덮음
    const hp01 = u.shMax ? u.shHp / u.shMax : 1
    const fl = battleShieldFlash[u.uid] && now - battleShieldFlash[u.uid] < 220 ? 1 - (now - battleShieldFlash[u.uid]) / 220 : 0
    ctx.save()
    drawHexDome(x, cyb, r, hp01, now, true)   // ← 기존 함수 재사용
    if (fl > 0) { ctx.globalAlpha = fl; ctx.strokeStyle = 'rgba(230,248,255,0.95)'; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.arc(x, cyb, r, Math.PI, 2 * Math.PI); ctx.stroke() }   // 방어 순간 번쩍
    ctx.restore()
  }
  // ── 기존 오버레이 메카/인간 아트를 배틀 유닛으로 재사용(새 그림 X) ──
  // drawMecha/drawHuman은 me.* 전역에 묶여 있어, 값을 잠시 바꿔 그린 뒤 즉시 복구(try/finally 보장).
  // 크기는 (x,y) 기준 스케일 변환으로 조절(원본 함수 수정 없이).
  function drawOverlayMechaAt(x, y, k, facing, form, now, opts) {
    opts = opts || {}
    const walking = opts.walking !== false, lean = opts.lean || 0, sh = opts.shHp01, charge = opts.charge || 0
    const sv = { x: me.mechaX, y: me.mechaY, f: me.mechaFace, form: me.mechaForm, thr: me.mechaThrust, chg: me.mechaCharging, cg: me.mechaCharge, dep: me.mechaShieldDeploy, shp: me.mechaShieldHp, sang: me.mechaShieldAng }
    const cx = cursor.x, cy = cursor.y
    ctx.save()
    try {
      ctx.translate(x, y); ctx.scale(k, k); if (lean) ctx.rotate(lean); ctx.translate(-x, -y)   // lean = 진행 방향 기울임(공중형)
      me.mechaX = x; me.mechaY = y; me.mechaFace = facing; me.mechaForm = form; me.mechaThrust = form >= 1
      me.mechaCharging = charge > 0; me.mechaCharge = charge   // 에너지포 충전 연출(에너지볼이 커짐)
      cursor.x = x + facing * 500; cursor.y = y - 40   // 전방 조준(대포 각도용)
      drawMecha(now, walking)
      if (sh != null && sh > 0) {   // 쉴드도 기존 함수 재사용 → 개미폼=반구 돔 / 인간폼=판넬(자동 form 분기)
        me.mechaShieldDeploy = 1; me.mechaShieldHp = sh * MSHIELD_HP; me.mechaShieldAng = facing >= 0 ? 0 : Math.PI
        drawMechaShield(now)
      }
    } finally {
      me.mechaX = sv.x; me.mechaY = sv.y; me.mechaFace = sv.f; me.mechaForm = sv.form; me.mechaThrust = sv.thr; me.mechaCharging = sv.chg; me.mechaCharge = sv.cg
      me.mechaShieldDeploy = sv.dep; me.mechaShieldHp = sv.shp; me.mechaShieldAng = sv.sang
      cursor.x = cx; cursor.y = cy; ctx.restore()
    }
  }
  function drawOverlayHumanAt(x, y, k, facing, now) {
    const sv = { x: me.humanX, y: me.humanY, f: me.humanFace, w: me.humanWeapon, ch: me.charging }
    const cx = cursor.x, cy = cursor.y
    ctx.save()
    try {
      ctx.translate(x, y); ctx.scale(k, k); ctx.translate(-x, -y)
      me.humanX = x; me.humanY = y; me.humanFace = facing; me.humanWeapon = ''; me.charging = false
      cursor.x = x + facing * 500; cursor.y = y - 30
      drawHuman(now, true)
    } finally {
      me.humanX = sv.x; me.humanY = sv.y; me.humanFace = sv.f; me.humanWeapon = sv.w; me.charging = sv.ch
      cursor.x = cx; cursor.y = cy; ctx.restore()
    }
  }
  function seedBattleConfetti() {
    battleConfetti = []
    const W = canvas.clientWidth, cols = ['#4aa3ff', '#7ee0ff', '#ffd86b', '#8ff0c8', '#ff9d3a', '#ff6b8a']
    for (let i = 0; i < 90; i++) battleConfetti.push({ x: Math.random() * W, y: -Math.random() * canvas.clientHeight * 0.6, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 4, r: 3 + Math.random() * 4, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length] })
  }
  // 카운트다운(3·2·1·START) + 승/패(WIN/LOSE) 화면 중앙 연출
  function drawBattleFX(now) {
    const W = canvas.clientWidth, H = canvas.clientHeight, cx = W / 2, cy = H * 0.42, sc = Math.max(1, view.scale)
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    if (battlePhase === 'countdown') {
      const el = now - battlePhaseAt, seg = 800, i = Math.floor(el / seg)   // 0,1,2 = 3,2,1 · 3 = START
      const within = (el % seg) / seg, pop = within < 0.28 ? within / 0.28 : 1   // 0→1 팝인
      const fade = within > 0.72 ? 1 - (within - 0.72) / 0.28 : 1
      const label = i >= 3 ? 'START!' : String(3 - i)
      const big = i >= 3
      ctx.globalAlpha = Math.max(0, fade)
      const size = (big ? 82 : 130) * sc * (0.6 + 0.4 * pop)
      ctx.font = `900 ${size}px system-ui, "맑은 고딕"`
      ctx.lineWidth = 8 * sc; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(label, cx, cy)
      const g = ctx.createLinearGradient(cx, cy - size / 2, cx, cy + size / 2)
      if (big) { g.addColorStop(0, '#a8ffd0'); g.addColorStop(1, '#28c07a') } else { g.addColorStop(0, '#fff3c4'); g.addColorStop(1, '#ff9d3a') }
      ctx.fillStyle = g; ctx.fillText(label, cx, cy)
      ctx.globalAlpha = 1
    } else if (battlePhase === 'result') {
      const el = now - battleResultAt, pop = Math.min(1, el / 260)
      // 딤 배경
      ctx.fillStyle = `rgba(6,8,12,${0.34 * pop})`; ctx.fillRect(0, 0, W, H)
      // 승리 색종이
      if (battleWin) {
        for (const p of battleConfetti) {
          p.x += p.vx; p.y += p.vy; p.rot += p.vr; if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W }
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); ctx.restore()
        }
      }
      const label = battleWin ? 'WIN' : 'LOSE'
      const size = 118 * sc * (0.5 + 0.5 * pop) * (1 + 0.03 * Math.sin(el / 120))
      ctx.font = `900 ${size}px system-ui, "맑은 고딕"`
      ctx.lineWidth = 10 * sc; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(label, cx, cy)
      const g = ctx.createLinearGradient(cx, cy - size / 2, cx, cy + size / 2)
      if (battleWin) { g.addColorStop(0, '#bfe3ff'); g.addColorStop(0.5, '#4aa3ff'); g.addColorStop(1, '#2f6bd8') } else { g.addColorStop(0, '#ffb0b0'); g.addColorStop(0.5, '#e24b4a'); g.addColorStop(1, '#a52222') }
      ctx.fillStyle = g; ctx.fillText(label, cx, cy)
      ctx.font = `600 ${16 * sc}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,.85)'
      ctx.fillText(battleWin ? '🏆 승리!' : '💀 패배', cx, cy + size * 0.62)
      // 베팅 결과: 승자 +정산/보유, 패자 −베팅/보유
      if (battleBetResult) {
        const b = battleBetResult, c = BET_CUR[b.cur] || {}, fmt = (n) => n.toLocaleString()
        const line = b.win ? `${c.emoji || ''} +${fmt(b.amt)} ${c.name || ''} 획득` : `${c.emoji || ''} −${fmt(b.amt)} ${c.name || ''} 잃음`
        const y1 = cy + size * 0.62 + 26 * sc
        ctx.font = `800 ${19 * sc}px system-ui`; ctx.fillStyle = b.win ? '#7fe3a8' : '#ff8a8a'
        ctx.fillText(line, cx, y1)
        ctx.font = `600 ${14 * sc}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,.72)'
        ctx.fillText(`보유 ${c.emoji || ''} ${fmt(b.bal)}`, cx, y1 + 22 * sc)
      }
    }
    ctx.restore()
  }
  function drawBattleBaseHp(x, side) {
    const sc = Math.max(1, view.scale)
    const max = battle.state.baseHpMax
    const hp = (battleMulti && side === 1) ? battleGhostBase : battle.state.baseHp[side]   // 멀티: 상대 기지 HP는 상대 방송값(권한)
    const f = Math.max(0, hp / max)
    const mine = side === 0
    // ★ 책상 바(키보드/마우스 자리) 위에 게이지 배치 — 머리 위 X(채팅과 겹침 방지)
    const barTop = battleDeskY(), barH = 54 * view.scale
    const w = Math.min(138 * view.scale, (CELL_W - 14) * view.scale), h = 20 * view.scale, r = 6 * view.scale
    const x0 = x - w / 2, y = barTop + (barH - h) / 2
    const low = f > 0 && f < 0.25
    const blink = low ? 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 180)) : 1
    ctx.save(); ctx.globalAlpha = blink
    // 트랙
    ctx.fillStyle = 'rgba(14,16,22,.92)'; roundRect(x0, y, w, h, r); ctx.fill()
    // HP 채움(진영 색: 내편 초록 / 상대 주황–빨강)
    if (f > 0) {
      const g = ctx.createLinearGradient(x0, y, x0, y + h)
      if (mine) { g.addColorStop(0, '#38e39a'); g.addColorStop(1, '#149e6b') } else { g.addColorStop(0, '#ff8a5c'); g.addColorStop(1, '#d8481f') }
      ctx.save(); roundRect(x0, y, w, h, r); ctx.clip()
      ctx.fillStyle = g; ctx.fillRect(x0, y, w * f, h)
      ctx.fillStyle = 'rgba(255,255,255,.24)'; ctx.fillRect(x0, y, w * f, h * 0.4)
      ctx.restore()
    }
    // 테두리(진영 색)
    ctx.strokeStyle = mine ? 'rgba(140,255,200,.6)' : 'rgba(255,150,120,.6)'; ctx.lineWidth = 1.5 * sc; roundRect(x0, y, w, h, r); ctx.stroke()
    // 가운데 숫자(검은 외곽선으로 항상 잘 보이게)
    const txt = `${Math.ceil(hp)} / ${max}`
    ctx.font = `800 ${12 * sc}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.lineWidth = 3 * sc; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(txt, x, y + h / 2 + 0.5 * sc)
    ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y + h / 2 + 0.5 * sc)
    ctx.restore()
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }

  // ---------- 배틀 투사체 (오버레이 투사체 재사용: 이동·충돌·관통·땅파임) ----------
  const bproj = []
  function projKindFor(type) {
    if (type === 'mechaAnt') return 'shell'
    if (type === 'mechaHuman') return 'energy'
    if (type === 'human') return 'adogen'
    if (type === 'grenadier') return 'grenade'
    if (type === 'sniper') return 'sniper'
    if (type === 'boss') return 'shellbig'
    return 'bullet'   // rifleman/drone/freezer/scout = 게틀링 총알 크기
  }
  const PROJ_SPD = { bullet: 560, sniper: 950, shell: 400, shellbig: 340, energy: 440, adogen: 320, grenade: 300, missile: 620, turret: 380 }
  const PROJ_LIFE = { bullet: 1500, sniper: 1500, shell: 3000, shellbig: 3000, energy: 3000, adogen: 2200, grenade: 3000, missile: 3500, turret: 4000 }
  const PROJ_DIG = { bullet: 0.15, sniper: 0.2, shell: 1.2, shellbig: 1.7, energy: 0.6, adogen: 0.9, grenade: 1.5, missile: 1.8, turret: 0.7 }   // 터렛 파임 1.4→0.7(절반)
  // 총구/발사구 위치(스프라이트 로컬 좌표: x=앞쪽+, y=발밑에서 위로+). 스케일(s)·facing 적용해 실제 총구에서 발사되게.
  const PROJ_MUZZLE = { rifleman: { x: 26, y: 22 }, sniper: { x: 30, y: 22 }, grenadier: { x: 11, y: 28 }, drone: { x: 15, y: 20 }, freezer: { x: 14, y: 22 }, mechaAnt: { x: 22, y: 30 }, mechaHuman: { x: 18, y: 34 }, human: { x: 16, y: 28 }, boss: { x: 26, y: 40 }, _default: { x: 16, y: 22 } }
  // 무기(덱) 배틀 발사 — 오버레이 무기 시스템을 "그대로" 사용(캐릭터 기준 발사·커서 추적·합체·핵·리틀보이 등).
  // 마나만 배틀 코스트로 소모하고, 실제 발사는 기존 오버레이 함수를 호출한다.
  const BATTLE_W_MULT = 4   // 오버레이 무기의 파워를 배틀 유닛 HP 스케일에 맞게 증폭
  function battleWeaponFire(id) {
    const w = window.BattleData.WEAPONS[id]; if (!w || !battle) return
    if (battlePhase !== 'playing') { showToast('전투 시작 후 사용'); return }
    const cost = w.mana != null ? w.mana : 2
    if (battle.state.mana[0] < cost) { showToast(`마나 부족 (${cost} 필요)`); return }
    const nowW = performance.now()
    if (nowW < (weaponCdUntil[id] || 0)) { showToast(`${w.name} 쿨타임 ${((weaponCdUntil[id] - nowW) / 1000).toFixed(1)}초`); return }   // 무기 쿨다운(마나와 별개)
    battle.state.mana[0] -= cost; if (w.battleCd) weaponCdUntil[id] = nowW + w.battleCd * 1000; updateBattleHud()
    // 오버레이 무기 그대로 — 미사일: 캐릭터에서 발사 → 커서 추적 → 합체 → 10합체 핵 → 상대 핵과 만나면 리틀보이
    if (id === 'missile') fireHoming()
    else if (id === 'gatling') deployBattleGatling()   // 배틀: 진영 앞 고정 배치 + 자동 조준 + 구조물화
    else if (id === 'shield') { if (battle) { battle.activateBaseShield(0, BATTLE_SHIELD_HP, BATTLE_SHIELD_SEC); showToast(`🛡 기지 방어 돔 (${BATTLE_SHIELD_SEC}초·HP${BATTLE_SHIELD_HP})`) } }   // 배틀: 커서 방패 대신 기지 반구 돔
    else if (id === 'net') toggleNetAim()
    else if (id === 'blackhole') { me.bhX = cursor.x; me.bhY = cursor.y; me.bhUntil = nowW + BH_DUR; weaponCdUntil[id] = nowW + 3600000; showToast('🕳 블랙홀! (게임당 1회)') }   // 배틀: 코인/오버레이 쿨 우회(마나는 이미 차감) — 홀 직접 설정 → 유닛 흡입·릴레이
    else if (id === 'lightning') battleLightning(cursor.x)   // 배틀: 즉발 컬럼 낙뢰(지상+공중 관통 AoE + 스턴)

    else if (id === 'bomber') deployBomber()   // 💣 폭격
    else fireHoming()
  }
  // ⚡ 배틀 낙뢰: 커서 x의 좁은 세로 컬럼에 있는 적 유닛(지상+공중 관통)을 즉발 타격 + 짧은 스턴. 즉발·대공 가능이 정체성.
  const LIGHTNING_DMG = 16, LIGHTNING_STUN = 0.5, LIGHTNING_COLW = 34
  function battleLightning(x) {
    if (!battle || !battleActive) return
    const colW = LIGHTNING_COLW * view.scale, now = performance.now()
    if (battleMulti) {   // 상대(고스트) — bghit 릴레이(데미지 + 스턴=강슬로우)
      for (const g of battleGhosts) { if (g.hp <= 0) continue; const gx = battleLaneX(g.L); if (Math.abs(gx - x) < colW) { g.hp -= LIGHTNING_DMG; if (connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: g.uid, dmg: LIGHTNING_DMG, slow: 0.9, slowDur: LIGHTNING_STUN, kb: 0 })); const gy = battleUnitFeetY(gx, !!(window.BattleData.UNITS[g.type] || {}).flying); electrocuteAt(gx, gy - 16 * view.scale, 4) } }
    } else {   // 솔로 — 로컬 side1 유닛 직접
      for (const u of battle.state.units) { if (u.side !== 1 || u.hp <= 0) continue; const ux = battleLaneX(u.L); if (Math.abs(ux - x) < colW) { battle.hitUnit(u.uid, LIGHTNING_DMG); if (battle.state) u.frozenUntil = Math.max(u.frozenUntil || 0, battle.state.t + LIGHTNING_STUN); const uy = battleUnitFeetY(ux, !!(window.BattleData.UNITS[u.type] || {}).flying); electrocuteAt(ux, uy - 16 * view.scale, 4) } }
    }
    // 비주얼: 커서 위쪽 → 지면까지 낙뢰 한 줄 + 릴레이(연출 공유)
    const topY = Math.max(10 * view.scale, cursor.y - 80 * view.scale), botY = boltGroundY(x)
    spawnBolt(x, topY, botY, 4, true)
    if (connected() && net) net.send(JSON.stringify({ t: 'bolt', nx: +(x / canvas.clientWidth).toFixed(4), nyTop: +(topY / canvas.clientHeight).toFixed(4), nyBot: +(botY / canvas.clientHeight).toFixed(4), level: 4 }))
  }
  // 지정한 side(foeSide)의 유닛/기지에만 데미지. 투사체 소유 side에 따라 상대만 맞게(양측 유닛 무기 재사용 일관).
  function battleHitSide(x, y, dmg, radius, foeSide, noBase) {
    if (!battleActive || !battle || battlePhase !== 'playing') return false
    const m = (radius || 0) + 4 * view.scale   // 폭발 반경 등은 몸통 박스를 확장하는 margin으로 처리
    let hit = false
    // 멀티: 상대(foeSide 1)는 로컬 유닛이 아니라 고스트 → 고스트 타격 + bghit 릴레이(소유자가 실제 적용), 기지는 bbhit 릴레이.
    if (battleMulti && foeSide === 1) {
      for (const g of battleGhosts) {
        if (g.hp <= 0) continue
        const gx = battleLaneX(g.L), gdef = window.BattleData.UNITS[g.type] || {}
        if (inUnitBody(x, y, gx, battleUnitFeetY(gx, gdef.flying), g.type, gdef.size, m)) {
          g.hp -= dmg; if (connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: g.uid, dmg, slow: 0, slowDur: 0, kb: 0 })); hit = true
        }
      }
      const bx1 = battleLaneX(1)
      if (!noBase && Math.abs(x - bx1) <= m + 34 * view.scale && y > battleDeskY() - 90 * view.scale) { if (connected()) net.send(JSON.stringify({ t: 'bbhit', to: battleMulti.oppId, dmg })); hit = true }
      return hit
    }
    for (const u of battle.state.units) {
      if (u.side !== foeSide || u.hp <= 0) continue
      const ux = battleLaneX(u.L), def = window.BattleData.UNITS[u.type] || {}
      const feetY = battleUnitFeetY(ux, def.flying)
      if (inUnitBody(x, y, ux, feetY, u.type, def.size, m)) { battle.hitUnit(u.uid, dmg); hit = true }
    }
    const bx = battleLaneX(foeSide)   // 그 side의 기지
    // 기지 히트박스: 몸통 높이까지(battleDeskY 기준) 커버 — 지면 안착으로 몸통이 올라가 예전 antGroundY 기준은
    // 너무 낮아 조준(baseAimY)이 위로 빗나갔다. 가로도 살짝 넓힘.
    if (!noBase && Math.abs(x - bx) <= m + 34 * view.scale && y > battleDeskY() - 90 * view.scale) { battle.hitBase(foeSide, dmg); hit = true }
    return hit
  }
  // 플레이어 오버레이 무기(미사일 등)는 항상 적(side1) 타격. ★ 무기는 소환체·구조물만 공격 — 기지(진영)엔 데미지 X(noBase).
  function battleHitAt(x, y, dmg, radius) { return battleHitSide(x, y, dmg, radius, 1, true) }
  // 배틀에서 재사용하는 오버레이 유닛 투사체(메카 포탄/에너지/아도겐 등)의 충돌 — 상대 side + 빗나가면 땅파임.
  // 투사체에 p.bfoe(맞을 side)·p.bdmg(데미지)를 태그해두고 각 스텝 최상단에서 호출. 명중/땅닿음이면 true.
  function battleProjCollide(p, R, dig) {
    if (battleHitSide(p.x, p.y, p.bdmg || 6, R, p.bfoe)) return true
    if (inTaskbar(p.x, p.y)) { battleDig(p.x, dig || 1.0); return true }
    return false
  }
  // 발사 타겟 해석: ★ 멀티 고스트는 uid가 내 유닛과 겹칠 수 있으니 반드시 battleGhosts에서 찾는다(unitByUid는 내 유닛만 봄).
  // 못 찾으면 ev.toL(타겟의 마지막 레인 위치)로 폴백. 공중 타겟은 조준 Y를 높인다(땅으로 쏘던 버그 방지).
  function battleResolveTarget(ev) {
    if (ev.ghost) { const g = battleGhosts.find((x) => x.uid === ev.targetUid && x.hp > 0); if (g) return { L: (g._dispL != null ? g._dispL : g.L), flying: !!(window.BattleData.UNITS[g.type] || {}).flying, found: true } }
    else if (ev.targetUid != null) { const u = battle.unitByUid(ev.targetUid); if (u) return { L: u.L, flying: !!(window.BattleData.UNITS[u.type] || {}).flying, found: true } }
    return { L: ev.toL, flying: false, found: false }
  }
  // 배틀 유닛(메카/인간)의 공격 = 기존 오버레이 발사 함수를 그대로 호출(전역 잠시 스왑 후 복구).
  // 스폰된 투사체에 배틀 side·데미지 태그를 달아 상대만 맞게 한다.
  function battleFireOverlay(ev, which) {
    const laneX = battleLaneX(ev.fromL)
    const foe = ev.side === 0 ? 1 : 0, dmg = ev.dmg || 8
    const tg = battleResolveTarget(ev)
    const tx = battleLaneX(tg.L)
    const ty = tg.flying ? (battleUnitFeetY(tx, true) - 8 * view.scale) : (tg.found ? antGroundY(tx) - 22 * view.scale : baseAimY())   // 공중=상승 높이 / 기지=몸통 높이 조준
    const cxs = cursor.x, cys = cursor.y; cursor.x = tx; cursor.y = ty   // 타겟(상대 소환체/기지) 조준
    const now = performance.now()
    if (which === 'shell') {   // 메카개미 = 기존 포물선 대포(fireMechaShell). 궤도를 타겟에 착탄하도록 조정.
      const sv = { x: me.mechaX, y: me.mechaY, cg: me.mechaCharge, f: me.mechaFace }
      me.mechaX = laneX; me.mechaY = antGroundY(laneX) - 30 * view.scale; me.mechaCharge = 0.6
      const before = mechaShells.length; fireMechaShell(now)
      const a = MSHELL_GRAV * view.scale
      for (let k = before; k < mechaShells.length; k++) {
        const sh = mechaShells[k]; sh.bfoe = foe; sh.bdmg = dmg
        const T = Math.max(28, Math.min(82, Math.abs(tx - sh.x) / (6 * view.scale)))   // 비행 프레임(멀수록 길게 = 더 높은 포물선)
        sh.vx = (tx - sh.x) / T
        sh.vy = (ty - sh.y - 0.5 * a * T * T) / T   // T프레임 뒤 (tx,ty)에 착탄하는 포물선(적 위치 반영)
        if (battleMulti && connected()) relayShot('shell', sh.x, sh.y, sh.vx * 60, sh.vy * 60, a * 3600)   // 프레임→초 변환 시각 릴레이
      }
      me.mechaX = sv.x; me.mechaY = sv.y; me.mechaCharge = sv.cg; me.mechaFace = sv.f
    } else if (which === 'energy') {   // 메카인간폼 = 기존 에너지포(fireEnergyCannon)
      const sv = { x: me.mechaX, y: me.mechaY, cg: me.mechaCharge, f: me.mechaFace }
      me.mechaX = laneX; me.mechaY = antGroundY(laneX) - 30 * view.scale; me.mechaCharge = 1
      const before = energyShots.length; fireEnergyCannon(now)
      for (let k = before; k < energyShots.length; k++) { const p = energyShots[k]; p.bfoe = foe; p.bdmg = dmg; if (battleMulti && connected()) relayShot('energy', p.x, p.y, p.vx * 60, p.vy * 60, 0) }
      me.mechaX = sv.x; me.mechaY = sv.y; me.mechaCharge = sv.cg; me.mechaFace = sv.f
    } else {   // 인간 = 기존 아도겐(fireAdogen)
      const sv = { x: me.humanX, y: me.humanY, f: me.humanFace }
      me.humanX = laneX; me.humanY = antGroundY(laneX)
      const before = hbullets.length; fireAdogen(now, 0.6)
      for (let k = before; k < hbullets.length; k++) { const p = hbullets[k]; p.bfoe = foe; p.bdmg = dmg; if (battleMulti && connected()) relayShot('adogen', p.x, p.y, p.vx * 60, p.vy * 60, 0) }
      me.humanX = sv.x; me.humanY = sv.y; me.humanFace = sv.f
    }
    cursor.x = cxs; cursor.y = cys
  }
  // 미사일이 적 유닛/기지에 닿았는지(폭발 트리거용 근접 판정)
  function battleMissileHitsEnemy(x, y) {
    if (!battle) return false
    for (const u of battle.state.units) {
      if (u.side === 0 || u.hp <= 0) continue
      const ux = battleLaneX(u.L), def = window.BattleData.UNITS[u.type] || {}
      const feetY = battleUnitFeetY(ux, def.flying)
      if (inUnitBody(x, y, ux, feetY, u.type, def.size, 2 * view.scale)) return true
    }
    if (battleMulti) {   // ★ 멀티: 상대 소환체는 로컬이 아니라 고스트 → 여기도 스캔해야 미사일이 상대 유닛에 터진다(안 하면 관통)
      for (const g of battleGhosts) {
        if (g.hp <= 0) continue
        const gx = battleLaneX(g.L), gdef = window.BattleData.UNITS[g.type] || {}
        if (inUnitBody(x, y, gx, battleUnitFeetY(gx, gdef.flying), g.type, gdef.size, 2 * view.scale)) return true
      }
    }
    const bx = battleLaneX(1)
    if (Math.abs(x - bx) < 34 * view.scale && y > battleDeskY() - 90 * view.scale) return true   // 기지 몸통 높이 기준(지면 안착 반영)
    return false
  }
  function battleFire(ev) {
    if (ev.atkType === 'antiair') {   // 🎯 대공포: 오버레이 요격 미사일 재사용(유도) — 공중 타겟만
      spawnBattleInterceptors({ x: battleLaneX(ev.fromL), salvo: ev.salvo || 4, dmg: ev.dmg || 8, airStun: !!ev.airStun, replay: false, side: ev.side })   // 자동 유도(발사 진영의 반대편 공중 유닛 탐색)
      if (battleMulti && connected()) net.send(JSON.stringify({ t: 'bflak', to: battleMulti.oppId, fx: +(battleLaneX(ev.fromL) / canvas.clientWidth).toFixed(4), salvo: ev.salvo || 4 }))   // 상대 화면 연출(그쪽 로컬 공중 유닛 자동 유도) — 데미지는 bghit로 별도
      return
    }
    const byU = battle.unitByUid(ev.by); const type = byU ? byU.type : 'ant'; const kind = projKindFor(type)
    // 메카/인간은 "기존 오버레이 공격 함수"를 그대로 재사용(포물선 대포·에너지포·아도겐). 자작 투사체 X.
    if (type === 'mechaAnt') return battleFireOverlay(ev, 'shell')
    if (type === 'mechaHuman') return battleFireOverlay(ev, 'energy')
    if (type === 'human') return battleFireOverlay(ev, 'adogen')
    const def = window.BattleData.UNITS[type] || {}
    const s = view.scale * BATTLE_UNIT_SCALE * (def.size || 1), face = (ev.side === 0 ? 1 : -1) * (battleFlip ? -1 : 1)   // 총구 방향도 battleFlip 반영
    const mz = PROJ_MUZZLE[type] || PROJ_MUZZLE._default
    const laneX = battleLaneX(ev.fromL), feetY = battleUnitFeetY(laneX, def.flying)
    const fx = laneX + face * mz.x * s, fy = feetY - mz.y * s   // 실제 총구 위치에서 발사
    const tg = battleResolveTarget(ev)   // ★ 고스트는 battleGhosts에서(uid 충돌 방지), 공중 타겟은 상승 높이 조준
    const tx = battleLaneX(tg.L)
    const ty = tg.found ? (battleUnitFeetY(tx, tg.flying) - 20 * view.scale) : baseAimY()   // 적 몸통 / 기지=몸통 높이 조준
    const spd = PROJ_SPD[kind] * view.scale
    const atkL = (byU && byU.stats && byU.stats.atk) || def.atk || {}   // 레벨 반영 스탯(연발 Lv5 기믹 등)
    const burst = (kind === 'bullet' && atkL.burst > 1) ? atkL.burst : 1   // 라이플 3연발·Lv5 4연발 등
    const nowP = performance.now()
    const before = bproj.length
    for (let b = 0; b < burst; b++) {
      let vx, vy, bx = fx, by = fy
      if (kind === 'grenade') { const dx = tx - fx; vx = dx / 0.8; vy = -260 * view.scale }   // 포물선 던지기
      else {
        const jit = burst > 1 ? (Math.random() - 0.5) * 0.05 : 0
        const a = Math.atan2(ty - fy, tx - fx) + jit; vx = Math.cos(a) * spd; vy = Math.sin(a) * spd
        const back = b * 11 * view.scale; bx = fx - Math.cos(a) * back; by = fy - Math.sin(a) * back   // 연발 스트림(뒤로 살짝)
      }
      bproj.push({ x: bx, y: by, vx, vy, bside: ev.side, dmg: ev.dmg, pow: ev.dmg, kind, aoe: (ev.atkType === 'aoe' || kind === 'grenade') ? (ev.aoeR || 0.05) : 0, aoeMax: ev.aoeMax || 0, slow: ev.slow, slowDur: ev.slowDur, born: nowP, life: PROJ_LIFE[kind] })
    }
    // 멀티: 상대 화면에도 이 투사체가 "보이도록" 시각 릴레이(데미지는 bghit로 별도, 여긴 순수 연출).
    if (battleMulti && connected()) { const gy = (kind === 'grenade') ? 900 * view.scale : 0; for (let k = before; k < bproj.length; k++) relayBattleShot(bproj[k], kind, gy) }
  }
  // 배틀 투사체 시각 릴레이: 공용 절대 프레임(battleLaneX 산출) 화면분율 + 초당 속도로 전송 → 수신측이 자기 화면에 재현(연출용).
  // vx/vy·ayAbs는 반드시 "초 단위"(px/s, px/s²)로 넘길 것. 프레임 기준 투사체(메카/에너지/아도겐)는 호출부에서 ×60 변환.
  function relayShot(kind, x, y, vx, vy, ayAbs) {
    const W = canvas.clientWidth, H = canvas.clientHeight
    net.send(JSON.stringify({ t: 'bshot', to: battleMulti.oppId, k: kind, x: +(x / W).toFixed(4), y: +(y / H).toFixed(4), vx: +(vx / W).toFixed(5), vy: +(vy / H).toFixed(5), ay: +((ayAbs || 0) / H).toFixed(6), life: PROJ_LIFE[kind] || 2000 }))
  }
  function relayBattleShot(p, kind, ayAbs) { relayShot(kind, p.x, p.y, p.vx, p.vy, ayAbs) }   // bproj = 이미 초 단위
  // 배틀 지형 파임: 로컬 반영 + (멀티면) 상대에게만 릴레이(bdig) → 두 배틀러의 전장 지형 공유(관전자 방 전체 X).
  function battleDig(x, power) {
    power *= BATTLE_DIG_MUL   // 배틀 전체 땅파임 하향(스케일 후 릴레이 → 양쪽 동일)
    if (battleMulti && connected() && net) { carveTaskbar(x, power, false); net.send(JSON.stringify({ t: 'bdig', to: battleMulti.oppId, nx: +(x / canvas.clientWidth).toFixed(4), power })) }   // 배틀: 상대에게만
    else carveTaskbar(x, power)   // 오버레이=기본(방 전체 dig 공유) / 솔로=로컬
  }
  // 🕳 블랙홀이 배틀 유닛을 중심으로 흡입([[blackhole-rule]] 캐릭터=기지 제외, 모든 유닛 흡입).
  // 소유자권한: 각 클라가 자기 유닛만 끌어당김(홀 위치는 릴레이된 공용 절대프레임). 솔로는 state.units에 양측 다 있어 전부 흡입.
  function battleBlackholePull(now, dt) {
    if (!battle || battlePhase !== 'playing') return
    const holes = activeBlackholes(now); if (!holes.length) return
    const W = canvas.clientWidth
    const consumeR = BH_R * W * 0.32   // 중심 근처 = 소멸(오버레이처럼 빨려 사라짐)
    for (const u of battle.state.units) {
      if (u.hp <= 0 || u.structure) continue   // 구조물(고정)·죽은 유닛 제외
      const flying = !!(window.BattleData.UNITS[u.type] || {}).flying
      const ux = battleLaneX(u.L), uy = battleUnitFeetY(ux, flying) - 20 * view.scale
      for (const b of holes) {
        const dx = b.x - ux, dy = b.y - uy, d = Math.hypot(dx, dy)
        if (d >= b.r) continue
        if (d < consumeR) { spawnDustToHole(ux, uy, { x: b.x, y: b.y }); u.hp = 0; break }   // 중심 도달 → 소멸(먼지)
        // 아니면 홀 쪽으로 강하게 흡입(빙결 아이스 없이 — L을 홀 레인으로 당김)
        const t = Math.max(0, Math.min(1, (b.x - battlePad()) / (W - 2 * battlePad())))
        const holeL = battleFlip ? 1 - t : t
        const strength = (1 - d / b.r) * 3.2
        u.L += (holeL - u.L) * Math.min(1, strength * dt)
        break
      }
    }
  }
  // 🕳 배틀 유닛/고스트 렌더용 블랙홀 흡입 변위: 홀 반경 내면 중심으로 2D로 끌어올리고 축소(빨려드는 연출).
  // 공용 절대프레임(홀 위치·유닛 L 모두 공유)에서 계산 → 양쪽 화면 동일. null이면 변위 없음.
  function bhRenderPull(x, y, now) {
    const holes = activeBlackholes(now); if (!holes.length) return null
    for (const b of holes) {
      const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy)
      if (d < b.r) { const t = Math.pow(1 - d / b.r, 1.3) * 0.88; return { x: x + dx * t, y: y + dy * t, scl: 1 - t * 0.55 } }
    }
    return null
  }
  // 터렛 포탄 폭발 — 메카 스파크와 다른 연출: 큰 폭발 + 주황 파편 샤워
  function turretBoom(x, y) {
    addEffect(x, y, 3)
    for (let k = 0; k < 9; k++) spawnDebris(x + (Math.random() - 0.5) * 28 * view.scale, y - Math.random() * 14 * view.scale, 1, k % 2 ? '#ffcf6b' : '#ff7d3a')
    spawnSpark(x, y)
  }
  function stepBattleProj(now, dt) {
    const W = canvas.clientWidth, grav = 900 * view.scale
    for (let i = bproj.length - 1; i >= 0; i--) {
      const p = bproj[i]
      if (p.kind === 'grenade' || p.kind === 'turret') p.vy += grav * dt   // 포물선(수류탄·터렛)
      p.x += p.vx * dt; p.y += p.vy * dt
      let done = false
      const isTurret = p.kind === 'turret'
      // 적 유닛 충돌 (디자인별 몸통 박스)
      for (const u of battle.state.units) {
        if (u.side === p.bside || u.hp <= 0) continue
        const ux = battleLaneX(u.L), def = window.BattleData.UNITS[u.type] || {}
        const feetY = battleUnitFeetY(ux, def.flying)
        if (inUnitBody(p.x, p.y, ux, feetY, u.type, def.size, 2 * view.scale)) {
          const before = u.hp
          if (isTurret) { for (const e of battle.state.units) if (e.side !== p.bside && e.hp > 0 && Math.abs(battleLaneX(e.L) - p.x) < (p.aoe || TURRET_AOE) * W) battle.hitUnit(e.uid, p.dmg, 0, 0, true); turretBoom(p.x, p.y); done = true }   // 터렛: 착탄 지점 범위 폭발 + 전원 강제 넉백(저데미지)
          else if (p.aoe) { let cands = battle.state.units.filter((e) => e.side !== p.bside && e.hp > 0 && Math.abs(battleLaneX(e.L) - p.x) < p.aoe * W); if (p.aoeMax > 0) cands = cands.sort((a, b) => Math.abs(battleLaneX(a.L) - p.x) - Math.abs(battleLaneX(b.L) - p.x)).slice(0, p.aoeMax); for (const e of cands) battle.hitUnit(e.uid, p.dmg, p.slow, p.slowDur); addEffect(p.x, p.y, 1); done = true }   // aoeMax>0(얼음개미): 착탄 지점 최근접 N마리만 타격
          else { battle.hitUnit(u.uid, p.dmg, p.slow, p.slowDur); spawnSpark(p.x, p.y); if (p.pow > before) { p.pow -= before } else { done = true } }   // 관통: 파워 > 대상 HP면 뚫고 진행
          break
        }
      }
      if (done) { bproj.splice(i, 1); continue }
      // 멀티: 상대(고스트) 유닛 충돌 → 데미지 릴레이(소유자가 적용). 관통 없이 명중 소멸.
      if (battleMulti && p.bside === 0) {
        for (const g of battleGhosts) {
          if (g.hp <= 0) continue
          const gx = battleLaneX(g.L), gdef = window.BattleData.UNITS[g.type] || {}
          if (inUnitBody(p.x, p.y, gx, battleUnitFeetY(gx, gdef.flying), g.type, gdef.size, 2 * view.scale)) {
            if (p.aoe) { let cands = battleGhosts.filter((e) => e.hp > 0 && Math.abs(battleLaneX(e.L) - p.x) < p.aoe * W); if (p.aoeMax > 0) cands = cands.sort((a, b) => Math.abs(battleLaneX(a.L) - p.x) - Math.abs(battleLaneX(b.L) - p.x)).slice(0, p.aoeMax); for (const e of cands) { if (connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: e.uid, dmg: p.dmg, slow: p.slow || 0, slowDur: p.slowDur || 0, kb: isTurret ? 1 : 0 })); e.hp -= p.dmg }; isTurret ? turretBoom(p.x, p.y) : addEffect(p.x, p.y, 1); done = true; break }
            else { if (connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: g.uid, dmg: p.dmg, slow: p.slow || 0, slowDur: p.slowDur || 0, kb: p.kb ? 1 : 0 })); spawnSpark(p.x, p.y) }
            g.hp -= p.dmg; done = true; break
          }
        }
        if (done) { bproj.splice(i, 1); continue }
      }
      // 적 기지 충돌. 멀티는 상대 기지 = 릴레이(bbhit), 솔로는 로컬 hitBase.
      const bx = battleLaneX(p.bside === 0 ? 1 : 0)
      // ★ 기지 히트박스를 조준(baseAimY=battleDeskY-50)·battleHitSide와 통일(battleDeskY-90, 가로 34). 예전 antGroundY-92는 조준보다 낮아 전 원거리 투사체가 빗나감.
      if (Math.abs(p.x - bx) < 34 * view.scale && p.y > battleDeskY() - 90 * view.scale) {
        if (battleMulti && p.bside === 0) { if (connected()) net.send(JSON.stringify({ t: 'bbhit', to: battleMulti.oppId, dmg: p.dmg })) }
        else battle.hitBase(p.bside === 0 ? 1 : 0, p.dmg)
        if (isTurret) turretBoom(p.x, p.y); else if (p.aoe) addEffect(p.x, p.y, 1); else spawnSpark(p.x, p.y)
        bproj.splice(i, 1); continue
      }
      // 땅 충돌 → 파임 (참호 전략)
      if (inTaskbar(p.x, p.y)) { battleDig(p.x, PROJ_DIG[p.kind]); if (p.aoe || PROJ_DIG[p.kind] >= 1) addEffect(p.x, p.y, 1); else spawnSpark(p.x, p.y); bproj.splice(i, 1); continue }
      if (now - p.born > p.life || p.x < -30 || p.x > W + 30 || p.y > canvas.clientHeight + 40) bproj.splice(i, 1)
    }
  }
  function drawBattleProj(now) {
    const s = view.scale * 1.5   // 투사체 전체 확대(가시성)
    const t = (now || performance.now()) / 1000
    for (const p of bproj) drawOneProj(p, s, t)
    // 멀티: 상대 소환체 투사체(연출용) 이동 + 그리기. 충돌/데미지 없음(bghit로 이미 처리).
    if (remoteBattleShots.length) {
      const W = canvas.clientWidth, H = canvas.clientHeight
      let dt = (now - (rbsLastT || now)) / 1000; rbsLastT = now; if (dt > 0.05) dt = 0.05
      for (let i = remoteBattleShots.length - 1; i >= 0; i--) {
        const p = remoteBattleShots[i]
        p.vy += (p.ay || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt
        if (now - p.born > p.life || p.x < -40 || p.x > W + 40 || p.y > H + 60) { remoteBattleShots.splice(i, 1); continue }
        // 연출 충돌: 내 유닛/기지에 닿으면 스파크 내고 사라짐(통과 방지 · 데미지는 bghit로 이미 적용됨)
        let gone = false
        for (const u of battle.state.units) { if (u.side !== 0 || u.hp <= 0 || u.structure) continue; const ux = battleLaneX(u.L), udef = window.BattleData.UNITS[u.type] || {}; if (inUnitBody(p.x, p.y, ux, battleUnitFeetY(ux, udef.flying), u.type, udef.size, 3 * view.scale)) { p.aoe ? addEffect(p.x, p.y, 2) : spawnSpark(p.x, p.y); gone = true; break } }
        if (!gone) { const bx = battleLaneX(0); if (Math.abs(p.x - bx) < 26 * view.scale && p.y > antGroundY(bx) - 100 * view.scale) { addEffect(p.x, p.y, 1); gone = true } }
        if (gone) { remoteBattleShots.splice(i, 1); continue }
        drawOneProj(p, s, t)
      }
    } else rbsLastT = now
  }
  // 투사체 1개 그리기(배틀·오버레이 소환 공용). p.kind별 비주얼 재사용.
  function drawOneProj(p, s, t) {
    {
      const ang = Math.atan2(p.vy, p.vx), spd = Math.hypot(p.vx, p.vy) || 1
      const ux = p.vx / spd, uy = p.vy / spd   // 진행 방향 단위벡터(꼬리 그리기)
      if (p.kind === 'turret') {
        // 터렛 포탄: 검은 쇠구슬 + 불꽃 도화선 + 회전 연기 꼬리
        const R = 7 * s
        ctx.fillStyle = 'rgba(90,90,90,.28)'
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(p.x - ux * R * k, p.y - uy * R * k, R * (0.75 - k * 0.16), 0, 7); ctx.fill() }
        ctx.fillStyle = '#2a2a30'; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 7); ctx.fill()
        ctx.fillStyle = '#5a5a66'; ctx.beginPath(); ctx.arc(p.x - R * 0.35, p.y - R * 0.35, R * 0.35, 0, 7); ctx.fill()   // 하이라이트
        const fl = 0.6 + 0.4 * Math.sin(t * 30 + p.x)
        ctx.fillStyle = `rgba(255,${Math.round(160 + fl * 60)},60,.95)`; ctx.beginPath(); ctx.arc(p.x, p.y - R - 1 * s, 2.2 * s * fl, 0, 7); ctx.fill()   // 도화선 불꽃
      } else if (p.kind === 'bullet' || p.kind === 'sniper') {
        // 라이플/저격: 발광 예광탄 — 긴 트레일 + 밝은 코어
        const len = (p.kind === 'sniper' ? 26 : 15) * s, r = (p.kind === 'sniper' ? 3.4 : 2.6) * s
        const col = p.kind === 'sniper' ? '150,225,255' : '255,226,120'
        const g = ctx.createLinearGradient(p.x - ux * len, p.y - uy * len, p.x, p.y)
        g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},.85)`)
        ctx.strokeStyle = g; ctx.lineWidth = r * 1.6; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(p.x - ux * len, p.y - uy * len); ctx.lineTo(p.x, p.y); ctx.stroke()
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill()
        ctx.fillStyle = `rgba(${col},.6)`; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.1, 0, 7); ctx.fill()
      } else if (p.kind === 'shell' || p.kind === 'shellbig') {
        // 메카 포탄: 금속 탄두 + 노즈 하이라이트 + 연기 꼬리
        const R = (p.kind === 'shellbig' ? 9 : 6.5) * s
        ctx.fillStyle = 'rgba(120,120,130,.25)'
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(p.x - ux * R * k * 1.1, p.y - uy * R * k * 1.1, R * (1 - k * 0.22), 0, 7); ctx.fill() }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang)
        ctx.fillStyle = '#aeb4c0'; ctx.beginPath(); ctx.ellipse(0, 0, R * 1.3, R, 0, 0, 7); ctx.fill()
        ctx.fillStyle = '#5a6070'; ctx.beginPath(); ctx.ellipse(-R * 0.5, 0, R * 0.5, R * 0.85, 0, 0, 7); ctx.fill()
        ctx.fillStyle = '#eef1f6'; ctx.beginPath(); ctx.arc(R * 0.55, -R * 0.3, R * 0.34, 0, 7); ctx.fill()
        if (p.kind === 'shellbig') { ctx.fillStyle = '#e24b4a'; ctx.fillRect(-R * 0.15, -R, R * 0.3, R * 2) }
        ctx.restore()
      } else if (p.kind === 'energy' || p.kind === 'adogen') {
        // 에너지/아도겐: 글로우 오브 + 진동 링
        const R = (p.kind === 'adogen' ? 8 : 7) * s, col = p.kind === 'adogen' ? '130,205,255' : '150,225,255'
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 2.2)
        g.addColorStop(0, `rgba(${col},.95)`); g.addColorStop(0.5, `rgba(${col},.5)`); g.addColorStop(1, `rgba(${col},0)`)
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R * 2.2, 0, 7); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, R * 0.5, 0, 7); ctx.fill()
        ctx.strokeStyle = `rgba(${col},.9)`; ctx.lineWidth = 1.4 * s
        ctx.beginPath(); ctx.arc(p.x, p.y, R * (1.1 + 0.12 * Math.sin(t * 18 + p.x)), 0, 7); ctx.stroke()
      } else if (p.kind === 'grenade') {
        // 수류탄: 파인애플 몸통(격자) + 상단 레버/핀 + 회전 연기 꼬리
        const R = 6 * s
        ctx.fillStyle = 'rgba(90,90,90,.22)'
        for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(p.x - ux * R * k, p.y - uy * R * k, R * (0.7 - k * 0.16), 0, 7); ctx.fill() }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * 6 + p.x)
        ctx.fillStyle = '#3f6b2a'; ctx.beginPath(); ctx.ellipse(0, R * 0.15, R, R * 1.15, 0, 0, 7); ctx.fill()
        ctx.strokeStyle = 'rgba(24,44,14,.85)'; ctx.lineWidth = 0.9 * s
        for (let gx = -1; gx <= 1; gx++) { ctx.beginPath(); ctx.moveTo(gx * R * 0.5, -R); ctx.lineTo(gx * R * 0.5, R * 1.2); ctx.stroke() }
        for (let gy = -1; gy <= 1; gy++) { ctx.beginPath(); ctx.moveTo(-R, gy * R * 0.55 + R * 0.15); ctx.lineTo(R, gy * R * 0.55 + R * 0.15); ctx.stroke() }
        ctx.fillStyle = '#7a7f8a'; ctx.fillRect(-R * 0.4, -R * 1.5, R * 0.8, R * 0.5)   // 뚜껑
        ctx.strokeStyle = '#d0a94a'; ctx.lineWidth = 1.3 * s; ctx.beginPath(); ctx.moveTo(R * 0.3, -R * 1.3); ctx.lineTo(R * 1.1, -R * 0.7); ctx.stroke()   // 레버
        ctx.restore()
      } else if (p.kind === 'missile') {
        // 미사일: 큰 몸통 + 핀 + 화염 트레일
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang)
        for (let k = 1; k <= 4; k++) { ctx.fillStyle = `rgba(255,${150 + k * 20},60,${0.5 - k * 0.1})`; ctx.beginPath(); ctx.arc(-9 * s - k * 4 * s, 0, (4 - k * 0.6) * s, 0, 7); ctx.fill() }
        ctx.fillStyle = '#d7dbe1'; ctx.beginPath(); ctx.moveTo(11 * s, 0); ctx.lineTo(4 * s, -4 * s); ctx.lineTo(-8 * s, -4 * s); ctx.lineTo(-8 * s, 4 * s); ctx.lineTo(4 * s, 4 * s); ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#e24b4a'; ctx.beginPath(); ctx.moveTo(11 * s, 0); ctx.lineTo(4 * s, -4 * s); ctx.lineTo(4 * s, 4 * s); ctx.closePath(); ctx.fill()   // 빨간 노즈
        ctx.fillStyle = '#5a6070'; ctx.beginPath(); ctx.moveTo(-8 * s, -4 * s); ctx.lineTo(-12 * s, -7 * s); ctx.lineTo(-8 * s, 0); ctx.closePath(); ctx.moveTo(-8 * s, 4 * s); ctx.lineTo(-12 * s, 7 * s); ctx.lineTo(-8 * s, 0); ctx.fill()   // 핀
        ctx.restore()
      }
    }
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
  // 적 메카(메카개미 form0 = 지상, 메카인간 form1 = 공중) — 근접은 공중(form1) 못 때림
  function nearestEnemyMecha(x) {
    const W = canvas.clientWidth, H = canvas.clientHeight; let best = null, bd = Infinity
    for (const [pid, m] of remoteMechas) { const mx = m.nx * W, d = Math.abs(mx - x); if (d < bd) { bd = d; best = { pid, x: mx, y: m.ny * H - 20 * view.scale, hp: m.hp || 1, flying: m.form === 1 } } }
    return best
  }
  // 적 인간(WASD 유닛) — 지상 취급(근접 가능)
  function nearestEnemyHuman(x) {
    const W = canvas.clientWidth, H = canvas.clientHeight; let best = null, bd = Infinity
    for (const [pid, h] of remoteHumans) { const hx = h.nx * W, d = Math.abs(hx - x); if (d < bd) { bd = d; best = { pid, x: hx, y: h.ny * H - 20 * view.scale, hp: h.hp || 1, flying: false } } }
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
    if (ant.shHp > 0) { const block = Math.min(ant.shHp, dmg); ant.shHp -= block; dmg -= block; ant.hitAt = performance.now(); if (ant.shHp <= 0) spawnSpark(ant.x, ant.y - 6 * view.scale); if (dmg <= 0) return }   // 자동 실드(쉴더·메카) 먼저 흡수
    ant.hp -= dmg; ant.hitAt = performance.now(); spawnBlood(ant.x, ant.y, Math.min(dmg + 1, 3)); spawnSpark(ant.x, ant.y - 6 * view.scale)   // 피격 순간 스파크(충돌 연출)
    if (ant.hp <= 0) {
      ant.dead = true; ant.deadAt = performance.now(); spawnBlood(ant.x, ant.y, 12); addBloodStain(ant.x, ant.y, 11 * view.scale)   // death: bigger burst + lingering stain
      if (ant.sprite === 'bomberMoth' && !ant._detonated) { ant._detonated = true; const bd = (window.BattleData.UNITS.bomberMoth || {}).atk || {}; spawnOverlayMothFall(ant.x, ant.dir || 1, Math.max(1, Math.round((bd.dmg || 50) / 6))) }   // 폭격 나방 격추 → 전진 방향 낙하 폭발
    }
  }
  // 소환체의 실제 몸통 히트박스. 스프라이트 유닛은 크게(2.86×) 그려지므로 발밑 원이 아니라
  // 몸통 높이(발밑~머리)를 덮어야 미사일/총알이 몸에 맞는다(기존엔 발밑 18px만 검사 → 몸통 관통 지나감).
  function antBodyHit(x, y, ax, ay, sprite, size) {
    if (!sprite) { const rr = 12 * view.scale * (size || 1); return Math.hypot(x - ax, y - ay) < rr }   // 기본 개미: 작은 원
    return inUnitBody(x, y, ax, ay, sprite, size, 0)   // 스프라이트 유닛: 디자인별 몸통 박스(발~머리)
  }
  function missileHitsAnt(x, y) {
    for (const a of ants) if (!a.dead && antBodyHit(x, y, a.x, a.y, a.sprite, a.size)) return { local: true, ant: a, hp: a.hp }
    const now = performance.now()
    for (const [pid, rec] of remoteAnts) {
      if (now - rec.ts > 800) continue
      for (const a of rec.items.values()) {
        if (a.dead) continue
        const s = remoteAntScreenPos(pid, a); if (!s) continue
        if (antBodyHit(x, y, s.x, s.y, a.sp, a.sz)) return { local: false, pid, id: a.id, hp: a.hp || 1 }
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
      const uflying = !!(a.sprite && (window.BattleData.UNITS[a.sprite] || {}).flying)   // 공중형(드론·나방 등): 지상 대신 공중 높이에서 부유
      const OVERLAY_HOVER = 60 * view.scale, restY = uflying ? gy - OVERLAY_HOVER : gy
      if (!a.onGround) {                        // 커서에서 낙하 → 지면/플랫폼(공중형은 공중 높이)에 안착
        const prevY = a.y
        a.vy += 0.5; a.y += a.vy
        const platY = uflying ? null : platformFloorAt(a.x, a.y, prevY)               // 그려진 플랫폼 표면(공중형은 무시)
        const floor = uflying ? restY : ((platY != null && platY <= gy) ? platY : gy)  // 플랫폼이 위에 있으면 그 위에 착지
        if (a.y >= floor) { a.y = floor; a.vy = 0; a.onGround = true; a.onPlat = !uflying && (platY != null && platY <= gy) }
        drawAnt(a, now, false, myCol); continue
      }
      // ❄ 빙결: 이동·공격 정지(위치 유지) / 🔨 넉백: 잠깐 진격 반대로 밀림(공격 X)
      if (a.frozenUntil && a.frozenUntil > now) { if (uflying) a.y = restY; drawAnt(a, now, true, myCol); continue }
      if (a.kbUntil && a.kbUntil > now) { a.x -= (a.kbBack || a.dir) * 2.6; if (a.x < 8) a.x = 8; if (a.x > W - 8) a.x = W - 8; a.step += 0.3; a.y = uflying ? restY : gy; drawAnt(a, now, false, myCol); continue }
      // ── 배틀식 공격: 유닛의 battle atk 패턴대로. 타겟 우선순위 = 적 소환체 → 적 캐릭터(고양이) ──
      const udef = a.sprite ? (window.BattleData.UNITS[a.sprite] || {}) : null
      const uatk = (udef && udef.atk) ? udef.atk : { type: 'melee', dmg: (a.sprite ? 5 : 1), range: 0.02, cd: 0.6 }
      const atkType = uatk.type, cdMs = Math.max(200, (uatk.cd || 0.6) * 1000)
      const rangePx = Math.max(22 * view.scale, (uatk.range || 0.02) * W * 0.6)
      const odmg = Math.max(1, Math.round((uatk.dmg || uatk.stompDmg || 1) / 6))   // 오버레이 축약 HP 스케일에 맞춘 데미지(타이탄=스톰프 데미지)
      // 지휘 개미 오라: 주변 아군 지휘관이 있으면 +공격/이동(배틀 동일)
      let auraAtk = 0, auraSpd = 0
      for (const o of ants) { if (o.dead || o === a || o.sprite !== 'commander') continue; const oa = (window.BattleData.UNITS.commander || {}).aura; if (oa && Math.abs(o.x - a.x) <= oa.range * W) { auraAtk = Math.max(auraAtk, oa.atk || 0); auraSpd = Math.max(auraSpd, oa.speed || 0) } }
      const odmgA = Math.max(1, Math.round(odmg * (1 + auraAtk)))
      // 폭격 나방(배틀 동일): 적 소환체 무시하고 적 캐릭터로 무작정 전진 → 도달 시 자폭(광역). 격추 시 낙하는 antTakeDmg에서.
      if (a.sprite === 'bomberMoth') {
        const ec = nearestEnemyCat(a.x)
        if (ec) {
          a.dir = ec.c.x >= a.x ? 1 : -1
          if (Math.abs(ec.c.x - a.x) <= 46 * view.scale) { a._detonated = true; addEffect(a.x, a.y - 8 * view.scale, 3); summonAreaHit(a.x, a.y, (uatk.aoeR || 0.06) * W, odmgA, false); antTakeDmg(a, 99); continue }
        }
        const slowMb = (a.slowUntil && a.slowUntil > now) ? (a.slowMul || 1) : 1
        const spdB = ((udef && udef.speed) ? Math.max(0.5, udef.speed * 5) : 1.2) * slowMb
        a.x += a.dir * spdB; if (a.x < 8) { a.x = 8; a.dir = 1 } if (a.x > W - 8) { a.x = W - 8; a.dir = -1 } a.step += 0.35
        a.y = restY; drawAnt(a, now, false, myCol); continue
      }
      // 여왕 등 생산 유닛: 적 유무와 무관하게 주기적으로 아군 소환체 생산
      if (udef && udef.summon) { if (!a.prodAt) a.prodAt = now + (udef.summon.every || 5) * 1000; else if (now >= a.prodAt) { a.prodAt = now + (udef.summon.every || 5) * 1000; summonProduce(a, udef.summon.unit) } }   // 생산형(여왕=라이플·타이탄=메카개미) 오버레이도 배틀과 동일하게 생산
      // 타겟: 적 소환체(원격 ant/gatling/메카/인간) 우선, 없으면 가장 가까운 적 캐릭터.
      // ★ 메카개미·메카인간·인간도 반드시 후보에 포함(예전엔 ant/gatling만 봐서 상대가 메카/인간만 내면 캐릭터로 폴백하던 버그).
      const isMeleeAtk = (atkType === 'melee' || (uatk && uatk.groundOnly))   // 순수 근접·groundOnly(자폭개미·저격·라이플)는 지상만(공중 못 침). 타이탄은 레이저로 대공 가능 → 제외
      const cands = []
      { const e = nearestEnemyAnt(a.x); if (e) cands.push({ x: e.s.x, y: e.s.y, kind: 'rant', pid: e.pid, id: e.s.id, fly: false }) }
      { const e = nearestEnemyGatling(a.x); if (e) cands.push({ x: e.x, y: e.y, kind: 'gat', pid: e.pid, fly: false }) }
      { const e = nearestEnemyMecha(a.x); if (e) cands.push({ x: e.x, y: e.y, kind: 'mecha', pid: e.pid, fly: e.flying }) }
      { const e = nearestEnemyHuman(a.x); if (e) cands.push({ x: e.x, y: e.y, kind: 'human', pid: e.pid, fly: e.flying }) }
      let tgt = null, btd = Infinity
      // 근접/자폭은 공중(메카인간 등) 못 때림 → 후보에서 제외
      for (const c of cands) { if (isMeleeAtk && c.fly) continue; const d = Math.abs(c.x - a.x); if (d < btd) { btd = d; tgt = c } }
      // 공격 가능한 적 소환체가 없을 때만 캐릭터로 폴백 — 단 캐릭터는 책상 위(공중)라 원거리(proj/aoe)만 공격 가능.
      // 근접/자폭은 공중 캐릭터를 못 때리므로 폴백하지 않고 그냥 배회한다.
      if (!tgt && (atkType === 'proj' || atkType === 'aoe' || atkType === 'titan')) { const ec = nearestEnemyCat(a.x); if (ec) tgt = { x: ec.c.x, y: ec.c.y - 22 * view.scale, kind: 'cat', cat: ec.cat } }
      let moving = true, acting = false
      if (atkType === 'heal') {                 // 메딕: 주변 다친 아군 소환체 회복(투사체 X)
        const ally = nearestHurtAlly(a, rangePx)
        if (ally) { moving = false; acting = true; if (now >= a.atkCd) { a.atkCd = now + cdMs; a.atkFlash = now + 220; ally.hp = Math.min(ally.maxHp || ally.hp, ally.hp + Math.max(1, Math.round((uatk.heal || 3) / 6))); addEffect(ally.x, ally.y - 12 * view.scale, 1) } }
      } else if (atkType === 'antiair') {        // 대공포(배틀 동일): 공중 적만 유도 요격 미사일. 지상엔 무력 → 없으면 배회.
        const air = nearestOverlayAir(a.x)
        if (air && Math.abs(air.x - a.x) <= (uatk.range || 0.2) * W) { moving = false; acting = true; a.dir = air.x >= a.x ? 1 : -1; if (now >= a.atkCd) { a.atkCd = now + cdMs; a.atkFlash = now + 160; spawnOverlayInterceptors(a.x, a.y, uatk.salvo || 4, odmgA) } }
      } else if (tgt) {
        a.dir = tgt.x >= a.x ? 1 : -1
        const dist = Math.abs(tgt.x - a.x)
        const isMelee = (atkType === 'melee' || atkType === 'suicide')
        if (atkType === 'titan') {   // 브루드 타이탄(배틀 동일): 근접=스톰프(지상 광역), 사거리 밖이면 레이저(원거리·대공)
          const stompRpx = (uatk.stompR || 0.055) * W, laserRpx = (uatk.laserR || 0.22) * W
          if (!tgt.fly && dist <= Math.max(34 * view.scale, stompRpx)) {   // 스톰프
            moving = false; acting = true
            if (now >= a.atkCd) { a.atkCd = now + (uatk.stompCd || 1.5) * 1000; a.atkFlash = now + 220; addEffect(a.x, a.y - 8 * view.scale, 3); summonAreaHit(a.x, a.y, stompRpx, Math.max(1, Math.round((uatk.stompDmg || 34) / 6)) + (auraAtk ? 1 : 0), false) }
          } else if (dist <= laserRpx) {   // 땅 긁는 레이저(대공 가능)
            moving = false; acting = true
            if (now >= a.atkCd) { a.atkCd = now + (uatk.laserCd || 6) * 1000; a.atkFlash = now + 220; const toX = a.x + a.dir * laserRpx; titanLaserFx(a.x, toX); summonAreaHit((a.x + toX) / 2, a.y, laserRpx / 2, Math.max(1, Math.round((uatk.laserDmg || 11) / 6)) + (auraAtk ? 1 : 0), !!uatk.laserAir) }
          }
        } else if (isMelee) {                          // 근접/자폭: 접촉 사거리에서
          if (dist <= Math.max(22 * view.scale, rangePx) && Math.abs((tgt.y != null ? tgt.y : a.y) - a.y) <= 46 * view.scale) {
            moving = false; acting = true
            if (now >= a.atkCd) {
              a.atkCd = now + cdMs; a.atkFlash = now + 220
              if (atkType === 'suicide') { summonSuicide(a, odmgA); continue }   // 자폭: 광역 + 자신 사망
              else if (uatk.aoeR) summonAreaHit(tgt.x, (tgt.y != null ? tgt.y : a.y), uatk.aoeR * W, odmgA, false, { kb: uatk.kbHit ? 1 : 0 })   // 망치 개미: 범위 슬램 + 강제 넉백
              else summonMeleeHit(tgt, odmgA, a, uatk.kbHit ? 1 : 0)   // 쉴더 등 kbHit 근접은 넉백
            }
          }
        } else if (atkType !== 'none') {         // 원거리/광역: 사거리 안에서 멈춰 발사
          if (dist <= rangePx) {
            moving = false; acting = true
            if (now >= a.atkCd) { a.atkCd = now + cdMs; a.atkFlash = now + 160; spawnSummonProj(a, uatk, tgt, odmgA, atkType) }
          }
        }
      } else if (now >= a.wanderUntil) {
        a.wanderUntil = now + 700 + Math.random() * 1400; if (Math.random() < 0.35) a.dir *= -1
      }
      const slowM = (a.slowUntil && a.slowUntil > now) ? (a.slowMul || 1) : 1   // ❄ 얼음개미 감속
      const spd = ((udef && udef.speed) ? Math.max(0.5, udef.speed * 5) : 0.9) * (1 + auraSpd) * slowM   // 배틀 속도 반영 + 지휘관 오라 + 감속
      if (moving) { a.x += a.dir * spd; if (a.x < 8) { a.x = 8; a.dir = 1 } if (a.x > W - 8) { a.x = W - 8; a.dir = -1 } a.step += 0.35 }
      if (uflying) { a.y = antGroundY(a.x) - OVERLAY_HOVER }   // 공중형: 플랫폼·구멍 무시, 공중 높이 유지(현재 x 기준)
      else {
        const platY = platformFloorAt(a.x, a.y, a.y)   // 서 있는 위치에 그려진 플랫폼이 있나
        if (platY != null) { a.y = platY; a.onPlat = true }                              // 플랫폼 위 계속(따라 걷기)
        else if (a.onPlat) { a.onPlat = false; a.onGround = false; a.vy = 1; drawAnt(a, now, false, myCol); continue }   // 플랫폼 끝 → 낙하 시작
        else if (taskbarHoleAt(a.x)) { a.falling = true; a.fallVy = 1; a.fallStart = now; spawnFallFx(a.x, a.y) }   // over a hole → start falling from the surface
        else a.y = gy
      }
      drawAnt(a, now, !moving, myCol)
    }
  }
  // ── 오버레이 소환 전투 헬퍼(배틀 atk 패턴 재사용) ──
  function nearestEnemyCat(x) { let best = null, bd = Infinity; for (let i = 0; i < catPos.length; i++) { const cat = allRef[i], c = catPos[i]; if (!cat || !c || cat.id === 'me') continue; const d = Math.abs(c.x - x); if (d < bd) { bd = d; best = { cat, c } } } return best }
  function nearestHurtAlly(a, rangePx) { let best = null, bd = Infinity; for (const o of ants) { if (o === a || o.dead) continue; if ((o.maxHp || o.hp) <= o.hp) continue; const d = Math.abs(o.x - a.x); if (d <= rangePx && d < bd) { bd = d; best = o } } return best }
  function summonMeleeHit(tgt, dmg, a, kb) {
    spawnBlood(tgt.x, (tgt.y != null ? tgt.y : a.y) - 4 * view.scale, 4)
    if (tgt.kind === 'rant') { if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: tgt.pid, ant: tgt.id, dmg, kb: kb || 0 })) }
    else if (tgt.kind === 'gat') { if (connected()) net.send(JSON.stringify({ t: 'gat-hit', target: tgt.pid, dmg })) }
    else if (tgt.kind === 'mecha') { if (connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: tgt.pid, dmg })) }
    else if (tgt.kind === 'human') { if (connected()) net.send(JSON.stringify({ t: 'human-hit', target: tgt.pid, dmg, hx: +((tgt.x) / canvas.clientWidth).toFixed(4), hy: +((tgt.y) / canvas.clientHeight).toFixed(4) })) }
    else if (tgt.kind === 'cat' && tgt.cat) applyCatHit(tgt.cat, dmg, performance.now())
  }
  function summonSuicide(a, dmg) {   // 카미카제: 접촉 자폭 — 주변 적 소환체/캐릭터 광역 + 자신 사망
    const R = 60 * view.scale, now = performance.now(), W = canvas.clientWidth, H = canvas.clientHeight
    addEffect(a.x, a.y - 8 * view.scale, 3); spawnBlood(a.x, a.y, 10)
    for (const [pid, rec] of remoteAnts) { for (const e of rec.items.values()) { if (e.dead) continue; const sp = remoteAntScreenPos(pid, e); if (sp && Math.hypot(sp.x - a.x, sp.y - a.y) <= R && connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: e.id, dmg: dmg * 2 })) } }
    for (const [pid, m] of remoteMechas) { if (Math.hypot(m.nx * W - a.x, m.ny * H - a.y) <= R && connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: pid, dmg: dmg * 2 })) }
    for (const [pid, h] of remoteHumans) { if (Math.hypot(h.nx * W - a.x, h.ny * H - a.y) <= R && connected()) net.send(JSON.stringify({ t: 'human-hit', target: pid, dmg: dmg * 2, hx: +(h.nx).toFixed(4), hy: +(h.ny).toFixed(4) })) }
    for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci], c = catPos[ci]; if (!cat || !c || cat.id === 'me') continue; if (Math.hypot(c.x - a.x, c.y - a.y) <= R) applyCatHit(cat, dmg * 2, now) }
    antTakeDmg(a, 99)
  }
  // 광역 타격(스톰프·레이저·슬램·서리 공용) — 반경 R 내 적 소환체/캐릭터에 데미지(기존 hit 릴레이 재사용 → MP 정합).
  // includeAir=공중(메카 인간폼) 포함 · opts={slow,slowDur,frozen,kb,max}(개미 대상 상태이상, max=최대 타격 마릿수)
  function summonAreaHit(cx, cy, R, dmg, includeAir, opts) {
    opts = opts || {}; const now = performance.now(), W = canvas.clientWidth, H = canvas.clientHeight
    const extra = { slow: opts.slow || 0, slowDur: opts.slowDur || 0, frozen: opts.frozen || 0, kb: opts.kb || 0 }
    // 개미 대상: 반경 내 후보 수집 → (max 지정 시) 최근접 N마리만
    let antc = []
    for (const [pid, rec] of remoteAnts) for (const e of rec.items.values()) { if (e.dead) continue; const sp = remoteAntScreenPos(pid, e); if (sp && Math.hypot(sp.x - cx, sp.y - cy) <= R) antc.push({ pid, id: e.id, d: Math.hypot(sp.x - cx, sp.y - cy) }) }
    if (opts.max > 0) antc = antc.sort((p, q) => p.d - q.d).slice(0, opts.max)
    for (const t of antc) if (connected()) net.send(JSON.stringify(Object.assign({ t: 'ant-hit', target: t.pid, ant: t.id, dmg }, extra)))
    for (const [pid, m] of remoteMechas) { const fly = m.form === 1; if ((includeAir || !fly) && Math.hypot(m.nx * W - cx, m.ny * H - cy) <= R && connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: pid, dmg })) }
    for (const [pid, h] of remoteHumans) { if (Math.hypot(h.nx * W - cx, h.ny * H - cy) <= R && connected()) net.send(JSON.stringify({ t: 'human-hit', target: pid, dmg, hx: +(h.nx).toFixed(4), hy: +(h.ny).toFixed(4) })) }
    for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci], c = catPos[ci]; if (!cat || !c || cat.id === 'me') continue; if (Math.hypot(c.x - cx, c.y - cy) <= R) applyCatHit(cat, dmg, now) }
  }
  // 오버레이 공중 타겟(대공포용): 상대 공중 유닛 = 메카 인간폼(form1) + 비행 스프라이트 개미
  function nearestOverlayAir(x) {
    let best = null, bd = Infinity; const W = canvas.clientWidth, H = canvas.clientHeight
    for (const [pid, m] of remoteMechas) { if (m.form !== 1) continue; const d = Math.abs(m.nx * W - x); if (d < bd) { bd = d; best = { x: m.nx * W, y: m.ny * H - 20 * view.scale, kind: 'mecha', pid } } }
    for (const [pid, rec] of remoteAnts) { for (const e of rec.items.values()) { if (e.dead) continue; if (!(window.BattleData.UNITS[e.sp] || {}).flying) continue; const sp = remoteAntScreenPos(pid, e); if (sp) { const d = Math.abs(sp.x - x); if (d < bd) { bd = d; best = { x: sp.x, y: sp.y, kind: 'rant', pid, id: e.id } } } } }
    return best
  }
  const overlayIntc = []   // 대공포 유도 요격 미사일(오버레이)
  function spawnOverlayInterceptors(x, y, salvo, dmg) {
    const s = view.scale, spd = 10 * s
    for (let k = 0; k < salvo; k++) { const ang = -Math.PI / 2 + (k - (salvo - 1) / 2) * 0.22; overlayIntc.push({ x: x + (Math.random() - 0.5) * 12 * s, y: y - 20 * s, vx: Math.cos(ang) * spd * 0.5, vy: Math.sin(ang) * spd, spd, dmg, born: performance.now(), seekAt: performance.now() + 240, life: 3000 }) }
  }
  function stepOverlayIntc(now) {
    if (!overlayIntc.length) return
    const s = view.scale
    for (let i = overlayIntc.length - 1; i >= 0; i--) {
      const p = overlayIntc[i]
      if (now - p.born > p.life) { overlayIntc.splice(i, 1); continue }
      const tg = (now >= p.seekAt) ? nearestOverlayAir(p.x) : null
      if (tg) {
        const dx = tg.x - p.x, dy = tg.y - p.y, d = Math.hypot(dx, dy) || 1
        p.vx += ((dx / d) * p.spd - p.vx) * 0.24; p.vy += ((dy / d) * p.spd - p.vy) * 0.24
        if (d < 18 * s) { addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y); if (connected()) { if (tg.kind === 'mecha') net.send(JSON.stringify({ t: 'mecha-hit', target: tg.pid, dmg: p.dmg })); else if (tg.kind === 'rant') net.send(JSON.stringify({ t: 'ant-hit', target: tg.pid, ant: tg.id, dmg: p.dmg })) } overlayIntc.splice(i, 1); continue }
      } else { p.vy += (-p.spd * 0.5 - p.vy) * 0.06; p.vx *= 0.98 }
      p.x += p.vx; p.y += p.vy; drawInterceptor(p)
    }
  }
  const overlayMothFalls = []   // 폭격 나방 격추 낙하(오버레이)
  function spawnOverlayMothFall(x, dir, dmg) {
    const s = view.scale
    overlayMothFalls.push({ x, y: antGroundY(x) - 60 * s, vx: dir * 3.4 * s, vy: 0.6 * s, dmg: dmg || 8, rot: 0, vr: dir * 0.24, born: performance.now() })
  }
  function stepOverlayMothFalls(now) {
    if (!overlayMothFalls.length) return
    const s = view.scale
    for (let i = overlayMothFalls.length - 1; i >= 0; i--) {
      const f = overlayMothFalls[i]
      f.vy += 0.62 * s; f.x += f.vx; f.y += f.vy; f.rot += f.vr
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(24 * s)}px system-ui`; ctx.fillText('🦋', 0, 0); ctx.font = `${Math.round(13 * s)}px system-ui`; ctx.fillText('💣', 0, 10 * s); ctx.restore()
      if (f.y >= antGroundY(f.x)) { const gy = antGroundY(f.x); addEffect(f.x, gy - 6 * s, 3, 0.3); summonAreaHit(f.x, gy, 0.06 * canvas.clientWidth, f.dmg, false); overlayMothFalls.splice(i, 1); continue }
      if (f.x < -60 || f.x > canvas.clientWidth + 60 || now - f.born > 4000) overlayMothFalls.splice(i, 1)
    }
  }
  function summonProduce(a, unitId) {   // 여왕: 아군 소환체 생산
    if (ants.filter((x) => !x.dead).length >= antMax()) return
    const def = (window.BattleData && window.BattleData.UNITS[unitId]) || {}
    const hp = Math.max(1, Math.round((def.hp || 20) / 8))
    ants.push({ id: nextAntId++, sprite: unitId, size: def.size || 1, x: a.x + a.dir * 20 * view.scale, y: a.y, vy: 0, onGround: true, hp, maxHp: hp, dir: a.dir, wanderUntil: 0, atkCd: 0, dead: false, deadAt: 0, step: Math.random() * 10 })
  }
  function spawnSummonProj(a, uatk, tgt, dmg, atkType) {   // 원거리/광역 소환체가 발사(배틀 투사체 재사용)
    const kind = projKindFor(a.sprite), mz = PROJ_MUZZLE[a.sprite] || PROJ_MUZZLE._default, face = a.dir >= 0 ? 1 : -1
    const fx = a.x + face * mz.x * view.scale, fy = a.y - mz.y * view.scale
    // 적의 발밑(지면)이 아니라 몸통을 겨냥 — 안 그러면 투사체가 땅쪽으로 꽂히는 것처럼 보임(고양이 타겟은 이미 -22 반영)
    const tx = tgt.x, ty = (tgt.y != null ? tgt.y : a.y) - (tgt.kind === 'cat' ? 0 : 20 * view.scale)
    const spd = (PROJ_SPD[kind] || 500) * view.scale
    const aoe = (atkType === 'aoe') ? Math.max(20 * view.scale, (uatk.aoeR || 0.05) * canvas.clientWidth) : 0
    const burst = (kind === 'bullet' && uatk.burst > 1) ? uatk.burst : 1
    for (let b = 0; b < burst; b++) {
      let vx, vy
      if (kind === 'grenade') { const dx = tx - fx; vx = dx / 0.8; vy = -260 * view.scale }   // 포물선
      else { const jit = burst > 1 ? (Math.random() - 0.5) * 0.05 : 0, ang = Math.atan2(ty - fy, tx - fx) + jit; vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd }
      summonProj.push({ x: fx, y: fy, vx, vy, kind, dmg, aoe, slow: uatk.slow || 0, slowDur: uatk.slowDur || 0, aoeMax: uatk.aoeMax || 0, born: performance.now(), life: (PROJ_LIFE[kind] || 1500) })
      // 오버레이 MP: 상대 화면에도 이 투사체가 보이도록 시각 릴레이(데미지는 ant-hit 등으로 별도). 배틀은 bshot 사용.
      if (connected() && net && !battleActive) net.send(JSON.stringify({ t: 'sproj', nx: +(fx / canvas.clientWidth).toFixed(4), ny: +(fy / canvas.clientHeight).toFixed(4), vx: +(vx / canvas.clientWidth).toFixed(5), vy: +(vy / canvas.clientHeight).toFixed(5), k: kind, ay: kind === 'grenade' ? +((900 * view.scale) / canvas.clientHeight).toFixed(6) : 0, life: PROJ_LIFE[kind] || 1500 }))
    }
  }
  const remoteSummonShots = []; let rssLastT = 0   // 오버레이 MP: 상대 소환체가 쏜 투사체(연출용)
  function stepDrawRemoteSummonShots(now) {
    if (!remoteSummonShots.length) { rssLastT = now; return }
    const W = canvas.clientWidth, H = canvas.clientHeight, s = view.scale * 1.5, t = now / 1000
    let dt = (now - (rssLastT || now)) / 1000; rssLastT = now; if (dt > 0.05) dt = 0.05
    for (let i = remoteSummonShots.length - 1; i >= 0; i--) {
      const p = remoteSummonShots[i]
      p.vy += (p.ay || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt
      if (now - p.born > p.life || p.x < -40 || p.x > W + 40 || p.y > H + 60 || inTaskbar(p.x, p.y)) { if (inTaskbar(p.x, p.y)) addEffect(p.x, p.y, p.aoe ? 2 : 1); remoteSummonShots.splice(i, 1); continue }
      drawOneProj(p, s, t)
    }
  }
  let summonProjLastT = 0
  function stepSummonProj(now) {
    if (!summonProj.length) { summonProjLastT = now; return }
    let dt = (now - (summonProjLastT || now)) / 1000; summonProjLastT = now; if (dt > 0.05) dt = 0.05
    const W = canvas.clientWidth, grav = 900 * view.scale
    for (let i = summonProj.length - 1; i >= 0; i--) {
      const p = summonProj[i]
      if (p.kind === 'grenade') p.vy += grav * dt
      const px0 = p.x, py0 = p.y   // 이동 전 위치(플랫폼 스윕 충돌용 — 빠른 탄 관통 방지)
      p.x += p.vx * dt; p.y += p.vy * dt
      // 그려진 플랫폼 충돌 — 미사일과 동일하게 플랫폼에 맞고 깎임(통과 X)
      { const psw = platformSweep(px0, py0, p.x, p.y); if (psw) { damagePlatform(psw.pl, p.dmg || 1); addEffect(psw.hx, psw.hy, 1); spawnSpark(psw.hx, psw.hy); summonProj.splice(i, 1); continue } }
      let done = false
      // 적 소환체(원격 ant) 충돌
      for (const [pid, rec] of remoteAnts) { if (now - rec.ts > 800) continue; for (const e of rec.items.values()) { if (e.dead) continue; const sp = remoteAntScreenPos(pid, e); if (!sp) continue; if (Math.hypot(sp.x - p.x, sp.y - p.y) < 24 * view.scale) { done = true; break } } if (done) break }   // 접촉 트리거 24px(조준 몸통보정 20px보다 커야 명중 — 예전 14px라 빗나가 땅에 꽂힘)
      if (done) {
        if (p.aoe) { summonAreaHit(p.x, p.y, p.aoe, p.dmg, false, { slow: p.slow, slowDur: p.slowDur, max: p.aoeMax }); addEffect(p.x, p.y, 2, 0.2) }   // 얼음개미=서리(감속+최대3), 수류탄=광역
        else { for (const [pid, rec] of remoteAnts) { let hit = false; for (const e of rec.items.values()) { if (e.dead) continue; const sp = remoteAntScreenPos(pid, e); if (sp && Math.hypot(sp.x - p.x, sp.y - p.y) < 24 * view.scale) { if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: e.id, dmg: p.dmg })); hit = true; break } } if (hit) break } spawnSpark(p.x, p.y) }
        summonProj.splice(i, 1); continue
      }
      // 적 소환체(원격 메카/인간) 충돌 — HP 있는 유닛
      { const rr = 24 * view.scale, Hc = canvas.clientHeight   // 접촉 트리거(조준 몸통보정 커버)
        for (const [pid, m] of remoteMechas) { if (Math.hypot(m.nx * W - p.x, (m.ny * Hc - 20 * view.scale) - p.y) < rr) { if (connected()) net.send(JSON.stringify({ t: 'mecha-hit', target: pid, dmg: p.dmg })); done = true; break } }
        if (!done) for (const [pid, h] of remoteHumans) { if (Math.hypot(h.nx * W - p.x, (h.ny * Hc - 20 * view.scale) - p.y) < rr) { if (connected()) net.send(JSON.stringify({ t: 'human-hit', target: pid, dmg: p.dmg, hx: +(p.x / W).toFixed(4), hy: +(p.y / Hc).toFixed(4) })); done = true; break } }
      }
      if (done) { p.aoe ? addEffect(p.x, p.y, 2, 0.2) : spawnSpark(p.x, p.y); summonProj.splice(i, 1); continue }
      // 적 캐릭터(고양이) 충돌 — 체력 없음(피격 번쩍만)
      for (let ci = 0; ci < catPos.length; ci++) { const cat = allRef[ci], c = catPos[ci]; if (!cat || !c || cat.id === 'me') continue; if (Math.hypot(c.x - p.x, (c.y - 20 * view.scale) - p.y) < 46 * view.scale) { applyCatHit(cat, p.dmg, now); done = true; break } }
      if (done) { p.aoe ? addEffect(p.x, p.y, 2, 0.2) : spawnSpark(p.x, p.y); summonProj.splice(i, 1); continue }
      if (inTaskbar(p.x, p.y)) {   // 착지 — 수류탄(aoe)은 착탄 지점에서 광역 폭발
        if (p.aoe) summonAreaHit(p.x, p.y, p.aoe, p.dmg, false, { slow: p.slow, slowDur: p.slowDur, max: p.aoeMax })   // 착탄 광역(얼음=서리 감속)
        addEffect(p.x, p.y, p.aoe ? 2 : 1, 0.2); summonProj.splice(i, 1); continue   // 소환 투사체 착탄 땅파임 20%로
      }
      if (now - p.born > p.life || p.x < -30 || p.x > W + 30 || p.y > canvas.clientHeight + 40) summonProj.splice(i, 1)
    }
  }
  function drawSummonProj(now) { const s = view.scale * 1.5, t = now / 1000; for (const p of summonProj) drawOneProj(p, s, t) }
  // ── 💣 폭격 무기: 커서 X부터 오른쪽 30% 범위에 5발 순차 투하(하늘 낙하) → 착탄 땅파임+양측 데미지·넉백+5초 불장판 ──
  function bombRadius() { return 0.05 * canvas.clientWidth }
  const BOMBER_CD = 2000   // 오버레이 폭격 쿨다운 2초(연타 방지). 배틀은 weaponCdUntil(battleCd)로 별도 관리.
  function deployBomber(atX, visual) {   // visual=true = 상대 릴레이 재현(연출만, 데미지·파임 X — 그건 bghit/bdig로 이미 받음)
    const W = canvas.clientWidth, H = canvas.clientHeight, now = performance.now(), s = view.scale
    if (!visual && !battleActive) {   // 내가 오버레이에서 직접 쏜 경우만 쿨다운 적용(상대 재현·배틀 제외)
      if (now < (me.bomberCdUntil || 0)) { showToast(`💣 폭격 쿨타임 ${((me.bomberCdUntil - now) / 1000).toFixed(1)}초`); return }
      me.bomberCdUntil = now + BOMBER_CD
    }
    const startX = Math.max(6, Math.min(W - 6, atX != null ? atX : cursor.x)), range = W * 0.18, spacing = range / Math.max(1, BOMB_N - 1)   // 0.30→0.18: 간격/범위 축소
    const dropY = H * 0.4   // 화면 중간보다 조금 위에서 투하(맨 위 X)
    const pre = 450, dropWindow = BOMB_DROP_MS * Math.max(1, BOMB_N - 1)   // 폭격기 진입(pre) 후 투하 시작
    for (let i = 0; i < BOMB_N; i++) bombQueue.push({ x: Math.min(W - 6, startX + i * spacing), y: dropY, at: now + pre + i * BOMB_DROP_MS, _v: !!visual })
    // 폭격기: born~pre 동안 왼쪽에서 진입 → pre에 startX 도달 → dropWindow 동안 range를 지나며 폭탄 투하 → post 동안 빠져나감
    bomberPlane = { startX, range, dropWindow, pre, post: 650, born: now, y: dropY - 30 * s }
    if (!visual) showToast('✈️ 폭격기 진입! (아군도 피해 — 주의)')
    if (!visual && connected() && net) {   // 상대 화면에도 폭격기·폭탄·불장판 재현
      if (battleMulti) net.send(JSON.stringify({ t: 'bbomber', to: battleMulti.oppId, x: +(startX / W).toFixed(4) }))
      else net.send(JSON.stringify({ t: 'obomber', nx: +(startX / W).toFixed(4) }))   // 오버레이: 방 전체
    }
  }
  // 착탄/불장판 공용 범위 타격: 배틀 유닛(양측)+고스트(릴레이) + 오버레이 개미(양측). 아군 포함(프렌들리 파이어).
  // ★ 오버레이 무기 공통 광역 데미지 — x-범위 내 "모든 유닛"(개미·메카·인간, 로컬+원격)에 적용.
  //   무기는 특정 유닛류(개미)에 한정되면 안 되고 전 유닛에 동일 규칙 적용([[battle-reuses-overlay-systems]]).
  //   groundOnly=true(지면 효과, 예: 불장판)면 세로 밴드를 좁혀 공중 유닛 제외. 폭발은 반경만큼 세로도 포함.
  function overlayDamageArea(x, y, rPx, dmg, groundOnly) {
    const W = canvas.clientWidth, H = canvas.clientHeight, now = performance.now(), odmg = Math.max(1, Math.round(dmg / 6))
    const vReach = groundOnly ? 36 * view.scale : rPx   // 지면 효과=지면 밴드만(공중 제외) · 폭발=반경 세로
    const inR = (ux, uy) => Math.abs(ux - x) <= rPx && (!Number.isFinite(uy) || Math.abs(uy - y) <= vReach)
    for (const a of ants) if (!a.dead && inR(a.x, a.y)) { antTakeDmg(a, odmg); if (a.dead) addAntKill() }   // 로컬 개미류(스프라이트 유닛 포함)
    if (me.mechaActive && inR(me.mechaX, me.mechaY)) mechaTakeDmg(odmg, now)                                 // 로컬 메카(개미/인간폼)
    if (me.humanActive && inR(me.humanX, me.humanY)) humanTakeDmg(odmg, now)                                 // 로컬 인간
    if (connected() && net) {
      for (const [pid, rec] of remoteAnts) for (const e of rec.items.values()) { if (e.dead) continue; const sp = remoteAntScreenPos(pid, e); if (sp && inR(sp.x, sp.y)) net.send(JSON.stringify({ t: 'ant-hit', target: pid, ant: e.id, dmg: odmg })) }
      for (const [pid, m] of remoteMechas) if (inR(m.nx * W, m.ny * H)) net.send(JSON.stringify({ t: 'mecha-hit', target: pid, dmg: odmg }))
      for (const [pid, h] of remoteHumans) if (inR(h.nx * W, h.ny * H)) net.send(JSON.stringify({ t: 'human-hit', target: pid, dmg: odmg, hx: +(x / W).toFixed(4), hy: +(y / H).toFixed(4) }))
      for (const [pid, g] of remoteGatlings) if (inR(g.nx * W, g.ny != null ? g.ny * H : y)) net.send(JSON.stringify({ t: 'gat-hit', target: pid, dmg: odmg }))
    }
  }
  function bombHitArea(x, y, rPx, dmg, kb, groundOnly) {
    if (battleActive && battle && battlePhase === 'playing') {
      for (const u of battle.state.units) { if (u.hp <= 0) continue; if (groundOnly && (window.BattleData.UNITS[u.type] || {}).flying) continue; if (Math.abs(battleLaneX(u.L) - x) <= rPx) battle.hitUnit(u.uid, dmg, 0, 0, kb) }   // 지면 효과는 공중 배틀유닛 제외(공통 규칙)
      if (battleMulti) for (const g of battleGhosts) { if (g.hp <= 0) continue; if (groundOnly && (window.BattleData.UNITS[g.type] || {}).flying) continue; const gx = battleLaneX(g._dispL != null ? g._dispL : g.L); if (Math.abs(gx - x) <= rPx) { g.hp -= dmg; if (connected()) net.send(JSON.stringify({ t: 'bghit', to: battleMulti.oppId, uid: g.uid, dmg, slow: 0, slowDur: 0, kb: kb ? 1 : 0 })) } }
      return   // 배틀 중엔 오버레이 엔티티 없음(진입 시 정리됨)
    }
    overlayDamageArea(x, y, rPx, dmg, groundOnly)   // 오버레이: 전 유닛 공통 타격(Y 반영)
  }
  function bombImpact(x, gy, visual) {
    addEffect(x, gy - 14 * view.scale, 3); for (let k = 0; k < 8; k++) spawnDebris(x + (Math.random() - 0.5) * 40 * view.scale, gy, 1, k % 2 ? '#ffb45a' : '#ff7d3a')
    if (!visual) { battleDig(x, 1.4); bombHitArea(x, gy, bombRadius(), BOMB_DMG, true, false) }   // 소유자만 파임·데미지. 폭발=반경(저공 포함), 지면 y 기준
    fireZones.push({ x, y: gy, r: bombRadius() * 0.9, until: performance.now() + FIRE_SEC * 1000, nextTick: 0, _v: !!visual })   // 5초 불장판(지면 y 저장)
  }
  function stepBombs(now) {
    for (let i = bombQueue.length - 1; i >= 0; i--) if (now >= bombQueue[i].at) { const q = bombQueue.splice(i, 1)[0]; bombs.push({ x: q.x, y: (q.y != null ? q.y : -20 * view.scale), vy: 1.2 * view.scale, _v: q._v }) }   // 폭격기 고도에서 투하
    const grav = 0.6 * view.scale
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i]; b.vy += grav; b.y += b.vy
      const gy = antGroundY(b.x)
      if (b.y >= gy) { bombImpact(b.x, gy, b._v); bombs.splice(i, 1) }
      else if (b.y > canvas.clientHeight + 60) bombs.splice(i, 1)
    }
  }
  function stepFireZones(now) {
    for (let i = fireZones.length - 1; i >= 0; i--) {
      const z = fireZones[i]
      if (now >= z.until) { fireZones.splice(i, 1); continue }
      if (now >= (z.nextTick || 0)) { z.nextTick = now + FIRE_TICK_MS; if (!z._v) bombHitArea(z.x, z.y != null ? z.y : antGroundY(z.x), z.r, FIRE_DMG, false, true) }   // 지속 데미지(넉백 X · 지면 효과=공중 제외 · 시각 전용 존은 데미지 X)
    }
  }
  function drawFireZones(now) {
    const t = (now || performance.now()) / 1000, s = view.scale
    for (const z of fireZones) {
      const left = z.x - z.r, right = z.x + z.r, span = right - left
      const remain = (z.until - now) / 1000, fade = remain < 0.8 ? Math.max(0, remain / 0.8) : 1   // 꺼지기 직전 페이드
      const step = Math.max(4 * s, span / 22)   // 촘촘하게 샘플링(듬성듬성 방지)
      ctx.save(); ctx.lineJoin = 'round'
      let idx = 0
      for (let x = left; x <= right; x += step, idx++) {
        const gy = taskbarSurfaceY(x)                        // ★ 파임 반영된 작업표시줄 표면 경계에 정확히 붙임
        const edge = Math.max(0.22, 1 - Math.abs((x - z.x) / z.r))   // 가운데 높고 가장자리 낮게
        // 바닥 잉걸 글로우
        ctx.globalAlpha = 0.13 * fade * (0.4 + edge); ctx.fillStyle = '#ff7a2a'
        ctx.beginPath(); ctx.ellipse(x, gy + 1, step * 0.95, 5 * s, 0, 0, 7); ctx.fill()
        // 불꽃 혀 — 외곽(주황) + 내부(노랑) 2겹, 개별 플리커
        const flick = 0.55 + 0.45 * Math.sin(t * 9 + idx * 1.7) + 0.18 * Math.sin(t * 19 + idx)
        const h = (11 + 17 * edge) * s * Math.max(0.4, flick), w = (3.4 + 1.6 * edge) * s
        ctx.globalAlpha = 0.9 * fade; ctx.fillStyle = idx % 2 ? 'rgba(255,120,32,0.92)' : 'rgba(255,88,24,0.9)'
        ctx.beginPath(); ctx.moveTo(x - w, gy + 2); ctx.quadraticCurveTo(x - w * 0.4, gy - h * 0.55, x, gy - h); ctx.quadraticCurveTo(x + w * 0.4, gy - h * 0.55, x + w, gy + 2); ctx.closePath(); ctx.fill()
        ctx.globalAlpha = 0.92 * fade; ctx.fillStyle = 'rgba(255,216,120,0.95)'
        ctx.beginPath(); ctx.moveTo(x - w * 0.5, gy + 1); ctx.quadraticCurveTo(x, gy - h * 0.52, x, gy - h * 0.66); ctx.quadraticCurveTo(x, gy - h * 0.52, x + w * 0.5, gy + 1); ctx.closePath(); ctx.fill()
      }
      // 떠오르는 잉걸(스파크)
      for (let k = 0; k < 12; k++) {
        const px = z.x + Math.sin(t * 3 + k * 2.1) * z.r * 0.88, gy = taskbarSurfaceY(px)
        const ph = ((t * 42 + k * 7) % 36)
        ctx.globalAlpha = 0.72 * fade * (1 - ph / 36); ctx.fillStyle = k % 2 ? '#ffd27a' : '#ff9a3a'
        ctx.beginPath(); ctx.arc(px, gy - ph * s - 4 * s, (1.4 - ph / 36) * s + 0.7 * s, 0, 7); ctx.fill()
      }
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }
  function drawBombs(now) {
    // 리틀보이 폭탄 이미지를 재사용하되 살짝 작게(scaleMul<1). 코가 아래로 낙하.
    for (const b of bombs) drawLittleBoy(b, now, 0.5)
  }
  // ✈️ 폭격기: 왼쪽에서 진입 → 투하 구간을 지나며 폭탄 떨구고 → 오른쪽으로 빠져나감(수명 끝 자동 제거).
  function drawBomberPlane(now) {
    if (!bomberPlane) return
    const p = bomberPlane, el = now - p.born
    if (el > p.pre + p.dropWindow + p.post) { bomberPlane = null; return }
    const s = view.scale, x = p.startX + p.range * ((el - p.pre) / p.dropWindow), y = p.y
    ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'
    // 뒤로 스윕된 주익 + 꼬리날개
    ctx.fillStyle = '#3a3f4b'
    ctx.beginPath(); ctx.moveTo(2 * s, 2 * s); ctx.lineTo(-24 * s, 14 * s); ctx.lineTo(-8 * s, 2 * s); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(-26 * s, -1 * s); ctx.lineTo(-35 * s, -13 * s); ctx.lineTo(-22 * s, -1 * s); ctx.closePath(); ctx.fill()
    // 동체
    ctx.fillStyle = '#525863'; ctx.beginPath(); ctx.ellipse(0, 0, 31 * s, 7.5 * s, 0, 0, 7); ctx.fill()
    // 노즈콘(오른쪽=진행 방향)
    ctx.fillStyle = '#5f6672'; ctx.beginPath(); ctx.moveTo(31 * s, 0); ctx.lineTo(22 * s, -5 * s); ctx.lineTo(22 * s, 5 * s); ctx.closePath(); ctx.fill()
    // 하부 폭탄창 라인
    ctx.fillStyle = '#31353f'; ctx.fillRect(-11 * s, 5 * s, 22 * s, 2.6 * s)
    // 조종석 유리
    ctx.fillStyle = 'rgba(150,205,255,.8)'; ctx.beginPath(); ctx.ellipse(15 * s, -3 * s, 5 * s, 2.6 * s, 0, 0, 7); ctx.fill()
    // 엔진 배기 화염(깜빡)
    ctx.fillStyle = 'rgba(255,175,80,.55)'; ctx.beginPath(); ctx.ellipse(-31 * s - Math.abs(Math.sin(now / 45)) * 3 * s, 0, 4 * s, 2.4 * s, 0, 0, 7); ctx.fill()
    ctx.restore()
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
        drawAnt({ x: ax, y: antGroundY(ax), dir: a.dir || 1, step: now / 90, hp: a.hp, sprite: a.sp, maxHp: a.mhp, size: a.sz }, now, false, col)  // dir from owner
      }
    }
  }
  function drawAnt(a, now, fighting, color) {
    if (a.sprite === 'broodTitan') return drawBroodTitan(a.x, a.y + 5 * view.scale, view.scale * 1.275, a.dir >= 0 ? 1 : -1, now, { walking: !fighting, atkT: (a.atkFlash && now < a.atkFlash) ? (220 - (a.atkFlash - now)) : -1 })   // 거대 타이탄(오버레이도 커스텀 렌더+애니, +5 발 보정)
    if (a.sprite && window.BattleSprites && window.BattleSprites.has(a.sprite)) return drawSpriteAnt(a, now, fighting)
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
  // 스프라이트 소환체(신규 유닛)를 오버레이에 렌더 — 걷기/공격 상태 + HP 바
  function drawSpriteAnt(a, now, fighting) {
    const s = view.scale * BATTLE_UNIT_SCALE * (a.size || 1)
    const hurt = a.hitAt && now - a.hitAt < 150   // 피격 순간 빨간 플래시(충돌 연출)
    const atk = fighting || (a.atkFlash && now < a.atkFlash)
    const state = hurt ? 'hit' : (atk ? 'attack' : 'walk')
    window.BattleSprites.draw(ctx, a.sprite, { x: a.x, y: a.y + 5 * view.scale, scale: s, facing: a.dir || 1, state, t: (a.step || 0) * 0.12 + now / 1000, flash: atk })   // +5: antGroundY(-5) 보정 → 발이 표면에 닿게(기본 개미처럼)
    const mh = a.maxHp || 1
    if (a.hp < mh) {   // HP 바 (피해 입은 경우만)
      const w = 22 * view.scale, f = Math.max(0, a.hp / mh), yy = a.y - 40 * view.scale
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(a.x - w / 2, yy, w, 3.2 * view.scale)
      ctx.fillStyle = f > 0.4 ? '#7ecb7e' : '#e24b4a'; ctx.fillRect(a.x - w / 2, yy, w * f, 3.2 * view.scale)
    }
  }
  function drawAntCorpse(a, now) {
    if (a.sprite && window.BattleSprites && window.BattleSprites.has(a.sprite)) {
      const p = Math.min(1, (now - a.deadAt) / 420)
      window.BattleSprites.draw(ctx, a.sprite, { x: a.x, y: a.y + 5 * view.scale, scale: view.scale * BATTLE_UNIT_SCALE * (a.size || 1), facing: a.dir || 1, state: 'death', t: 0, deathT: p }); return
    }
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

  function addEffect(x, y, power, digMul) {
    effects.push({ x, y, born: performance.now(), dur: 520, power: power || 1 })
    if (effects.length > MAX_EFFECTS) effects.splice(0, effects.length - MAX_EFFECTS)
    if (inTaskbar(x, y)) carveTaskbar(x, (power || 1) * 0.192 * (digMul == null ? 1 : digMul))   // 폭발 착탄 크레이터. digMul로 개별 완화(소환 투사체=0.2 등)
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
    battleHitAt(x, y, power * BATTLE_W_MULT, R)   // 배틀 적 유닛/기지에도 폭발 데미지(무기 = 오버레이 그대로)
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
    // 데미지는 권한자(낮은 netId 또는 솔로)만 적용해 중복 방지.
    const authoritative = !connected() || otherPid == null || (me.netId != null && me.netId < otherPid)
    spawnLittleBoy(x, y, authoritative)
    // 상대에게도 리틀보이 방송(합체는 한쪽 클라에서만 감지 → col-dmg로 상대 나크가 사라져 상대는 못 보던 문제).
    if (connected() && net) net.send(JSON.stringify({ t: 'littleboy', nx: x / canvas.clientWidth, ny: y / canvas.clientHeight }))
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
    battleHitAt(x, y, dmg * BATTLE_W_MULT, R)   // ☢ 리틀보이/핵 → 배틀 적 유닛·기지에도 광역 데미지
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
  function drawLittleBoy(b, now, scaleMul) {   // Little Boy bomb, falling nose-down — narrow tail, FAT bulbous warhead
    const s = view.scale * 4.4 * (scaleMul || 1), x = b.x, y = b.y   // 2× the old size (scaleMul<1 = 폭격 폭탄용 축소)
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
        // 유지시간(수명) 제거 — 미사일은 화면 밖으로 나가거나 충돌할 때만 사라짐(시간 만료 X)
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
        const ah = pierceReady ? missileHitsAnt(p.x, p.y) : null   // 소환체(개미/스프라이트) — 실제 HP 기반 관통 규칙 적용
        if (ah) {
          const hp = ah.hp || 1   // 대상의 실제 HP(스프라이트 유닛은 1보다 큼)
          if (ah.local) { antTakeDmg(ah.ant, p.power); if (ah.ant.dead) addAntKill() }   // 파워만큼 데미지(즉살 99 → 규칙화)
          else if (connected()) net.send(JSON.stringify({ t: 'ant-hit', target: ah.pid, ant: ah.id, dmg: p.power }))
          addEffect(p.x, p.y, 1); spawnSpark(p.x, p.y)   // 충돌 연출
          if (p.power > hp) { p.power -= hp; p.pierceCd = now + 90 }   // 관통: 파워 > HP면 뚫고 진행(파워 감소), 아니면 명중 폭발
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
        // 배틀 적 유닛/기지에 명중 → 폭발(explode 안에서 battleHitAt로 데미지). 무기 = 오버레이 그대로.
        if (battleActive && battle && battlePhase === 'playing' && battleMissileHitsEnemy(p.x, p.y)) {
          explode(p.x, p.y, p.power); bcBoom('missile', p.mid, p.x, p.y, p.power)
          projectiles.splice(i, 1); continue
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
      net.send(JSON.stringify({ t: 'ants', list: ants.map((a) => ({ id: a.id, nx: +(a.x / NW).toFixed(4), hp: a.hp, dead: a.dead, dir: a.dir, sp: a.sprite, mhp: a.maxHp, sz: a.size })) }))
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
      net.send(JSON.stringify({ t: 'mecha', active: 1, nx: +(me.mechaX / NW).toFixed(4), ny: +(me.mechaY / NH).toFixed(4), hp: me.mechaHp, face: me.mechaFace || 1, shield: +(me.mechaShieldHp / MSHIELD_HP).toFixed(2), form: +(me.mechaForm || 0).toFixed(2), thr: me.mechaThrust ? 1 : 0, ch: me.mechaCharging ? 1 : 0, chg: +(me.mechaCharge || 0).toFixed(2), mang: +(Math.atan2(cursor.y - me.mechaY, cursor.x - me.mechaX)).toFixed(2), sdep: +(me.mechaShieldDeploy || 0).toFixed(2), snx: +((me.mechaShieldX != null ? me.mechaShieldX : me.mechaX) / NW).toFixed(4), sny: +((me.mechaShieldY != null ? me.mechaShieldY : me.mechaY) / NH).toFixed(4), sang: +(me.mechaShieldAng || 0).toFixed(2) }))   // mang = 소유자 조준 각도(내 커서 아님)
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
      // 스냅 상태(드래그 아님)면 프리셋 인덱스(ac,ar)도 함께 전송 → 해상도가 달라도 상대가 자기 화면의 '같은 프리셋'에 나를 배치(정규화 좌표만 쓰면 위젯 크기만큼 어긋남).
      const snapped = !dragging && savedAnchor && typeof savedAnchor.c === 'number'
      const ac = snapped ? savedAnchor.c : undefined, ar = snapped ? savedAnchor.r : undefined
      if (nx !== lastPos.nx || ny !== lastPos.ny || ac !== lastPos.ac || totalCount !== lastPos.taps || me.hp !== lastPos.hp || aw !== lastPos.away || sf !== lastPos.safe || now - lastPos.at > 1000) {
        net.send(JSON.stringify({ t: 'pos', nx, ny, ac, ar, taps: totalCount, hp: me.hp, away: aw, safe: sf, bw: battleWins, bp: battlePlays }))   // 상대에겐 누적 카운트 + 배틀 전적
        lastPos = { nx, ny, ac, taps: totalCount, hp: me.hp, away: aw, safe: sf, at: now }
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
  // 🖥 바탕화면 모드: 창을 항상-위 대신 맨 뒤로(업무 방해 X). 위치는 그대로 두고 z-order만 바꾼다
  // (고양이 위젯은 원래도 작업표시줄 위쪽에 있어 별도 올림 불필요).
  let desktopMode = false
  try { desktopMode = localStorage.getItem('desktopMode') === '1' } catch {}
  function setDesktopMode(on) {
    desktopMode = !!on
    try { localStorage.setItem('desktopMode', desktopMode ? '1' : '0') } catch {}
    try { window.bongo && window.bongo.setDesktopMode && window.bongo.setDesktopMode(desktopMode) } catch {}
    showToast(desktopMode ? '🖥 바탕화면 모드 — 다른 창 뒤로(바탕화면에서만 보임)' : '🔝 오버레이 모드 — 항상 위')
  }
  // 시작 시 저장된 바탕화면 모드면 메인에 창 레이어 적용 요청(z-order만; 위치 변경 없음).
  if (desktopMode) { try { window.bongo && window.bongo.setDesktopMode && window.bongo.setDesktopMode(true) } catch {} }
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
    ctx.fillText(fmtCount(taps || 0), x + barW / 2, y + h / 2 + 0.5)
    ctx.restore()
  }
  // 관전자 화면: 배틀 중인 피어 머리 위 "⚔ 배틀 중" 배지(원위치 유지, 숨기지 않음)
  function drawInBattleBadge(origin, sc, now) {
    const cx = origin.x + CELL_W * sc / 2, cy = origin.y + 18 * sc
    const pulse = 0.6 + 0.4 * Math.sin(now / 400)
    const label = '⚔ 배틀 중', bw = 96, bh = 26
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.globalAlpha = 0.85 + 0.15 * pulse
    ctx.beginPath(); ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, bh / 2)
    ctx.fillStyle = 'rgba(60,20,24,0.92)'; ctx.fill()
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(255,120,90,${0.7 + 0.3 * pulse})`; ctx.stroke()
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffcdbf'; ctx.font = 'bold 14px "Segoe UI", "Malgun Gothic", sans-serif'
    ctx.fillText(label, cx, cy + 0.5)
    ctx.restore()
  }

  // Main decides click-through by polling the real cursor against this "hotzone".
  // We just report the widget rect (+ force flag while chatting/editing).
  let chatOpenFlag = false, dragging = null
  let lastHzSend = 0, catRegenAt = 0
  function sendHotzone() {
    if (wx == null) return
    const extra = peerDimBtns.map((b) => ({ x: b.x - b.r - 2, y: b.y - b.r - 2, w: (b.r + 2) * 2, h: (b.r + 2) * 2 }))
    const exclusive = battleActive || platformMode   // 배틀/플랫폼 = 독점 입력(다른 기능·바탕화면 클릭 전부 차단)
    // 독점 모드에선 rect를 화면 전체로 → 커서가 어디에 있든 오버레이가 클릭을 잡아 바탕화면/파일 통과 차단(force와 이중 안전)
    const rect = exclusive ? { x: 0, y: 0, w: canvas.clientWidth, h: canvas.clientHeight } : { x: wx, y: wy, w: cellPxW, h: cellPxH + BAR_SPACE }
    inputSource.setHotzone({ rect, extra: exclusive ? [] : extra, force: exclusive || chatOpenFlag || editing || shopOpenFlag || achvOpenFlag || me.netAiming || me.netActive || updateNotesOpen || !!document.querySelector('.bg-back, .bm-root, .bm-bet, .bm-invite, .bx-confirm') })
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
    // (오버레이 캐릭터 체력 개념 제거 → HP 자연 회복 없음)
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

    // 배틀 모드: 내 고양이를 작업표시줄 좌측 끝으로 이동(피어 숨김·상대 고양이는 우측 끝)
    if (battleActive) {
      // 책상면(battleDeskY, 지상선)에 위젯 내부 책상(BUBBLE_H+DESK_Y)이 오도록 origin 배치 → 땅에 붙음
      const by = Math.max(0, battleDeskY() - (BUB + window.AnimalArt.DESK_Y) * scale)
      origins[0] = { x: Math.max(4, battleLaneX(0) - CELL_W / 2 * scale), y: by }
      catPos[0] = { x: origins[0].x + CELL_W / 2 * scale, y: origins[0].y + (BUB + 100) * scale }
    }

    // shield faces the cursor while active
    if (catPos[0]) me.shieldAngle = Math.atan2(cursor.y - catPos[0].y, cursor.x - catPos[0].x)

    drawSnapGrid()   // preset dots under the cats while dragging

    all.forEach((p, i) => {
      if (battleActive && p.id !== 'me') return   // 내가 배틀 중일 땐 다른 피어 숨김(상대는 battleOpp로 별도 렌더)
      ctx.save()
      if (p.id !== 'me') ctx.globalAlpha = peerAlpha(p.id)   // 👁 dim THIS opponent on my screen
      ctx.translate(origins[i].x, origins[i].y)
      ctx.scale(scale, scale)
      p.hideDeskItems = battleActive   // 배틀 중 내 기지: 책상 키보드·마우스·이름표 숨김(그 자리에 체력 게이지)
      window.AnimalArt.draw(ctx, p.animal, p, now)
      ctx.restore()
      if (p.id !== 'me' && p.taps != null) { ctx.save(); ctx.globalAlpha = peerAlpha(p.id); drawPeerCount(origins[i], p.taps); ctx.restore() }   // peer's counter (dims with 👁)
      if (p.inBattle) drawInBattleBadge(origins[i], scale, now)   // 관전자: 원위치 유지 + "⚔ 배틀 중" 표시(숨기지 않음)
    })
    if (battleActive && battleOpp) {   // 상대 고양이(우측 끝) — 솔로는 AI 더미
      const by = Math.max(0, battleDeskY() - (BUB + window.AnimalArt.DESK_Y) * scale)
      const bx = Math.min(cW - CELL_W * scale - 4, battleLaneX(1) - CELL_W / 2 * scale)
      battleOpp.hideDeskItems = true   // 상대 기지도 키보드·마우스·이름표 숨김
      ctx.save(); ctx.translate(bx, by); ctx.scale(scale, scale); window.AnimalArt.draw(ctx, 'cat', battleOpp, now); ctx.restore()
    }

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
    if (!battleActive) { ctx.save(); drawRemoteMissiles(now); ctx.restore() }   // (per-peer 👁 dim set inside each drawRemote*; save/restore contains it) — 배틀 중엔 상대 오버레이 미사일 렌더 금지
    drawDebris(now)
    stepAnts(now)
    stepSummonProj(now); drawSummonProj(now)   // 오버레이 소환체 투사체(원거리/광역 전투)
    if (!battleActive) { stepOverlayIntc(now); stepOverlayMothFalls(now) }   // 오버레이 대공포 요격 미사일 + 폭격 나방 낙하
    if (!battleActive) stepDrawRemoteSummonShots(now)             // 상대 소환체 투사체 연출(MP) — 배틀 중 금지
    stepFireZones(now); drawFireZones(now)     // 💣 폭격 불장판(DoT) — 바닥
    stepBombs(now); drawBomberPlane(now); drawBombs(now)   // ✈️ 폭격기 + 💣 낙하 폭탄
    if (!battleActive) { ctx.save(); drawRemoteAnts(now); ctx.restore() }   // 배틀 중엔 상대 오버레이 개미 렌더 금지
    stepFieldUnits(now); drawFieldUnits(now)   // 신규 소환체(오버레이)
    if (battleActive && battle) { stepBattle(now); drawBattleUnits(now) }   // 배틀 모드(오버레이 통합)
    if (battleActive && battleMothFalls.length) stepBattleMothFalls(now)   // 폭격 나방 격추 낙하 폭탄
    drawGatlings()
    stepGatling(now)
    drawGatSmoke(now)
    if (!battleActive) { ctx.save(); drawRemoteGBullets(now); ctx.restore() }   // 배틀 중 금지
    stepHbullets(now)
    stepNet(now)          // net physics + catching (positions a netted human before it draws)
    stepHuman(now)
    stepMechaMerge(now)
    stepMecha(now)
    stepMechaShells(now)
    stepEnergyShots(now)
    stepInterceptors(now)
    stepLittleBoys(now)
    if (!battleActive) {   // 배틀 중엔 상대(피어) 오버레이 인간/메카/포탄/총알/그물 전부 렌더 금지 — 깨끗한 배틀 환경
      ctx.save(); drawRemoteHumans(now); ctx.restore()
      ctx.save(); drawRemoteMechas(now); ctx.restore()
      ctx.save(); drawRemoteMShells(now); ctx.restore()
      ctx.save(); drawRemoteHbullets(now); ctx.restore()
    }
    drawNetAll(now)       // aim UI + my net pouch (on top of entities)
    if (!battleActive) { ctx.save(); drawRemoteNets(now); ctx.restore() }
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
