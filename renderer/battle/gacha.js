// renderer/battle/gacha.js — 배틀 모드 가챠 로직 + 영속(localStorage)
// 순수 로직만(UI 없음). window.BattleData(units.js)에 의존.
//  - 재화: 💎 젬(뽑기), 🔩 강화 부품(중복 시 지급)
//  - 뽑기: 1회, 희귀도 가중치로 tier 선택 후 tier 내 균등
//  - 중복: 강화 부품 +UPGRADE.perDuplicate
//  - 카운트 치환: countPerGem(=10,000) 당 젬 1 (카운트 차감은 통합 레이어가 담당)
(function () {
  'use strict'
  if (!window.BattleData) { console.error('[battle/gacha] BattleData(units.js) 먼저 로드 필요'); return }
  const D = window.BattleData
  const K = { gems: 'hgbattle.gems', mat: 'hgbattle.mat', owned: 'hgbattle.owned', lvl: 'hgbattle.lvl' }

  function loadNum(k) { const n = parseInt(localStorage.getItem(k) || '0', 10); return Number.isFinite(n) ? n : 0 }
  function loadObj(k) { try { const o = JSON.parse(localStorage.getItem(k) || '{}'); return o && typeof o === 'object' ? o : {} } catch { return {} } }

  let gems = loadNum(K.gems)
  let materials = loadNum(K.mat)
  let owned = loadObj(K.owned)   // { id: true }
  let levels = loadObj(K.lvl)    // { id: n }  (업그레이드 수치, 내용 추후. 기본 1)

  // 기본지급(starter)은 처음부터 보유로 seed
  ;[...D.unitList(), ...D.weaponList()].forEach((e) => {
    if (e.starter && !owned[e.id]) { owned[e.id] = true; if (!levels[e.id]) levels[e.id] = 1 }
  })
  saveOwned()

  function saveGems() { localStorage.setItem(K.gems, String(gems)) }
  function saveMat() { localStorage.setItem(K.mat, String(materials)) }
  function saveOwned() { localStorage.setItem(K.owned, JSON.stringify(owned)); localStorage.setItem(K.lvl, JSON.stringify(levels)) }

  function getGems() { return gems }
  function getMaterials() { return materials }
  function isOwned(id) { return !!owned[id] }
  function getLevel(id) { return levels[id] || 0 }

  function addGems(n) { gems = Math.max(0, gems + (n | 0)); saveGems(); return gems }
  function addMaterials(n) { materials = Math.max(0, materials + (n | 0)); saveMat(); return materials }

  // 카운트 amount 로 만들 수 있는 젬 수(차감/적립은 호출측). 남는 카운트는 버리지 않도록 정수 젬만 반환.
  function gemsFromCount(count) { return D.countToGems(count) }

  // 전체 목록(유닛+무기) — 컬렉션 UI용. rarity 메타 병합.
  function catalog() {
    return [...D.unitList(), ...D.weaponList()].map((e) => ({
      ...e, rarityInfo: D.RARITY[e.rarity] || D.RARITY.common,
      owned: !!owned[e.id], level: levels[e.id] || 0,
    }))
  }

  // 가중 tier 선택
  function pickRarityKey() {
    const tiers = Object.values(D.RARITY).filter((r) => r.weight > 0)
    const total = tiers.reduce((s, r) => s + r.weight, 0)
    let x = _rand() * total
    for (const r of tiers) { x -= r.weight; if (x <= 0) return r.key }
    return tiers[tiers.length - 1].key
  }

  // 결정적 랜덤(테스트 시 주입 가능). 기본은 Math.random.
  let _rand = Math.random
  function setRandom(fn) { _rand = typeof fn === 'function' ? fn : Math.random }

  // 1회 뽑기. 젬 부족이면 null.
  function roll() {
    if (gems < D.GEM.pullCost) return null
    gems -= D.GEM.pullCost; saveGems()

    const pool = D.gachaPool()
    let rk = pickRarityKey()
    let bucket = pool.filter((e) => e.rarity === rk)
    if (!bucket.length) { bucket = pool; rk = null }   // 해당 tier 비면 전체에서
    const entry = bucket[Math.floor(_rand() * bucket.length)]
    const rarity = D.RARITY[entry.rarity] || D.RARITY.common

    const dup = !!owned[entry.id]
    let gained = 0
    if (dup) { gained = D.UPGRADE.perDuplicate; addMaterials(gained) }
    else { owned[entry.id] = true; if (!levels[entry.id]) levels[entry.id] = 1; saveOwned() }

    return { id: entry.id, entry, rarity, dup, material: gained }
  }

  // 개발용 리셋(테스트 편의). 실제 앱의 1회 초기화 마이그레이션과는 별개.
  function _devReset() {
    gems = 0; materials = 0; owned = {}; levels = {}
    ;[...D.unitList(), ...D.weaponList()].forEach((e) => { if (e.starter) { owned[e.id] = true; levels[e.id] = 1 } })
    saveGems(); saveMat(); saveOwned()
  }

  window.BattleGacha = {
    getGems, getMaterials, isOwned, getLevel, addGems, addMaterials,
    gemsFromCount, catalog, roll, setRandom, _devReset,
  }
})()
