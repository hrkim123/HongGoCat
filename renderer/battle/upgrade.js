// renderer/battle/upgrade.js — 업그레이드 스펙 + 로직
// Max Lv 5. 비용 = 🔩 강화 부품, 곡선 [1,2,3,5](1→2..4→5), 풀강 11.
// 소환체 = 레벨당 스탯↑ + Lv5 추가 기믹(사이드그레이드: 파워크립 대신 역할 심화).
// 무기 = 데미지 중심. window.BattleGacha(레벨·부품)에 의존.
// computeUnitStats: 배틀 시뮬이 쓰는 "실효 스탯"을 레벨 반영해 산출(단일 진실원).
//   → base(units.js)를 통째로 clone 후 수치 스케일 + 기믹 플래그. sim은 D.UNITS 대신 이 값을 사용.
(function () {
  'use strict'
  if (!window.BattleData || !window.BattleGacha) { console.error('[battle/upgrade] BattleData/BattleGacha 필요'); return }
  const D = window.BattleData, G = window.BattleGacha

  const MAX = 5
  const COST = [1, 2, 3, 5] // index: 현재레벨-1 (Lv1→2 = COST[0])

  // 레벨당 배수/효과 + Lv5 기믹. *Per 값은 (lvl-1) 곱. 기믹은 lvl>=at 에서 발동.
  // gk = 기믹 종류(sim/computeUnitStats가 해석하는 플래그). 파워크립이 아니라 "역할 심화" 사이드그레이드 지향.
  const SPEC = {
    // ── 소환체 ──────────────────────────────────────────────────────────────
    ant:        { kind: 'unit', hpPer: 0.12, dmgPer: 0.08, gimmick: { at: 5, gk: 'spawn2',  text: '소환 시 2기(물량)' } },
    scout:      { kind: 'unit', hpPer: 0.10, dmgPer: 0.10, spdPer: 0.06, gimmick: { at: 5, gk: 'kbHit', text: '공격 시 강제 넉백(교란)' } },
    rifleman:   { kind: 'unit', dmgPer: 0.10, gimmick: { at: 5, gk: 'burst4', text: '4연발(3→4)' } },
    grenadier:  { kind: 'unit', dmgPer: 0.10, gimmick: { at: 5, gk: 'aoe15', text: '폭발 범위 대폭↑(×1.5)' } },
    shielder:   { kind: 'unit', hpPer: 0.06, shieldPer: 5, gimmick: { at: 5, gk: 'shcd', text: '쉴드 재충전 4→2초' } },
    mechaAnt:   { kind: 'unit', hpPer: 0.10, dmgPer: 0.10, shieldPer: 4, gimmick: { at: 5, gk: 'cd70', text: '대포 연사 속도↑(cd ×0.7)' } },
    mechaHuman: { kind: 'unit', hpPer: 0.10, dmgPer: 0.10, shieldPer: 4, gimmick: { at: 5, gk: 'charge60', text: '충전 시간 단축(1.0→0.6초)' } },
    human:      { kind: 'unit', hpPer: 0.08, dmgPer: 0.10, gimmick: { at: 5, gk: 'range30', text: '아도겐 사거리 +30%' } },
    kamikaze:   { kind: 'unit', hpPer: 0.08, dmgPer: 0.12, gimmick: { at: 5, gk: 'aoe14', text: '자폭 범위·위력↑(×1.4)' } },
    medic:      { kind: 'unit', hpPer: 0.08, healPer: 0.14, gimmick: { at: 5, gk: 'healAoe', text: '범위 힐(주변 아군 동시)' } },
    drone:      { kind: 'unit', hpPer: 0.08, dmgPer: 0.10, gimmick: { at: 5, gk: 'burst2', text: '2연발' } },
    freezer:    { kind: 'unit', hpPer: 0.08, slowPer: 0.06, gimmick: { at: 5, gk: 'slow75', text: '강력 둔화(50→75%)' } },
    worker:     { kind: 'unit', hpPer: 0.10, aoePer: 0.06, gimmick: { at: 5, gk: 'stun', text: '슬램 명중 시 0.4초 스턴' } },
    commander:  { kind: 'unit', hpPer: 0.08, dmgPer: 0.08, gimmick: { at: 5, gk: 'auraUp', text: '오라 강화(+20→+35%)·범위↑' } },
    sniper:     { kind: 'unit', dmgPer: 0.12, gimmick: { at: 5, gk: 'range40', text: '초장거리 +40%' } },
    boss:       { kind: 'unit', hpPer: 0.10, gimmick: { at: 5, gk: 'summon3', text: '소환 간격 5→3초' } },
    // ── 무기 ────────────────────────────────────────────────────────────────
    missile:    { kind: 'weapon', dmgPer: 0.10, gimmick: { at: 5, text: '합체 임계 완화(핵 쉬움)' }, note: 'Lv3·5 동시발사 +1' },
    gatling:    { kind: 'weapon', dmgPer: 0.08, ratePer: 0.05, gimmick: { at: 5, text: '관통 +1' } },
    lightning:  { kind: 'weapon', chargePer: 1, note: '최대 충전단계 +1/레벨' },
    blackhole:  { kind: 'weapon', radiusPer: 0.08, note: '반경·지속 +8%/레벨 · 배틀 1게임 1회' },
    net:        { kind: 'weapon', catchPer: 1, note: '포획 수/범위 +1' },
    adogen:     { kind: 'weapon', dmgPer: 0.10, gimmick: { at: 5, text: '관통' } },
  }

  function maxLevel() { return MAX }
  function spec(id) { return SPEC[id] || null }
  function costToNext(id) { const lv = G.getLevel(id); if (!lv || lv >= MAX) return null; return COST[lv - 1] }
  function canUpgrade(id) { const c = costToNext(id); return c != null && G.getMaterials() >= c }

  function upgrade(id) {
    const c = costToNext(id); if (c == null) return { ok: false, reason: 'max' }
    if (G.getMaterials() < c) return { ok: false, reason: 'material' }
    if (!G.spendMaterials(c)) return { ok: false, reason: 'material' }
    const lv = G.getLevel(id); G.setLevel(id, lv + 1)
    return { ok: true, level: lv + 1 }
  }

  // 실효 유닛 스탯(배틀 시뮬용). base 통째 clone → 레벨 스케일 + Lv5 기믹 플래그.
  function computeUnitStats(id) {
    const base = D.UNITS[id]; if (!base) return null
    const lv = Math.max(1, G.getLevel(id) || 1), sp = SPEC[id] || {}
    const n = lv - 1
    const hp = Math.round(base.hp * (1 + (sp.hpPer || 0) * n))
    const speed = +(base.speed * (1 + (sp.spdPer || 0) * n)).toFixed(4)
    const out = {
      id, level: lv, hp, speed,
      name: base.name, cat: base.cat, rarity: base.rarity, cost: base.cost,
      art: base.art, size: base.size, flying: !!base.flying,
      support: !!base.support, suicide: !!base.suicide,
      kb: base.kb, manaBuff: base.manaBuff,
      atk: base.atk ? Object.assign({}, base.atk) : { type: 'none' },
    }
    const a = out.atk
    if (a.dmg && sp.dmgPer) a.dmg = +(a.dmg * (1 + sp.dmgPer * n)).toFixed(2)
    if (a.heal && sp.healPer) a.heal = +(a.heal * (1 + sp.healPer * n)).toFixed(2)
    if (a.slow && sp.slowPer) a.slow = +Math.min(0.9, a.slow * (1 + sp.slowPer * n)).toFixed(3)
    if (a.aoeR && sp.aoePer) a.aoeR = +(a.aoeR * (1 + sp.aoePer * n)).toFixed(4)
    // 자동 쉴드(쉴더·메카): absorb는 레벨당 +shieldPer
    if (base.battleShield) out.battleShield = { absorb: base.battleShield.absorb + (sp.shieldPer || 0) * n, cooldown: base.battleShield.cooldown }
    // 오라(커맨더)
    if (base.aura) out.aura = Object.assign({}, base.aura)
    // 생산(여왕)
    if (base.summon) out.summon = Object.assign({}, base.summon)

    // ── Lv5 기믹 ──
    const gk = (sp.gimmick && lv >= sp.gimmick.at) ? sp.gimmick.gk : null
    out.gimmick = (sp.gimmick && lv >= sp.gimmick.at) ? sp.gimmick.text : null
    if (gk === 'spawn2') out.spawnCount = 2
    else if (gk === 'kbHit') a.kbHit = true
    else if (gk === 'burst4') a.burst = 4
    else if (gk === 'burst2') a.burst = 2
    else if (gk === 'aoe15') a.aoeR = +((a.aoeR || 0.06) * 1.5).toFixed(4)
    else if (gk === 'aoe14') { a.aoeR = +((a.aoeR || 0.05) * 1.4).toFixed(4); if (a.dmg) a.dmg = +(a.dmg * 1.2).toFixed(2) }
    else if (gk === 'shcd' && out.battleShield) out.battleShield.cooldown = 2
    else if (gk === 'cd70' && a.cd) a.cd = +(a.cd * 0.7).toFixed(3)
    else if (gk === 'charge60' && a.charge) { a.charge = 0.6; a.cd = 0.6 }
    else if (gk === 'range30' && a.range) a.range = +(a.range * 1.3).toFixed(4)
    else if (gk === 'range40' && a.range) a.range = +(a.range * 1.4).toFixed(4)
    else if (gk === 'healAoe') a.healAoe = true
    else if (gk === 'slow75') { a.slow = 0.75; a.slowDur = (a.slowDur || 2) + 0.5 }
    else if (gk === 'stun') a.stun = 0.4
    else if (gk === 'auraUp' && out.aura) { out.aura.atk = 0.35; out.aura.speed = 0.35; out.aura.range = +(out.aura.range * 1.3).toFixed(4) }
    else if (gk === 'summon3' && out.summon) out.summon.every = 3
    return out
  }

  // UI 표시용: 현재 효과 요약 문자열
  function effectSummary(id) {
    const sp = SPEC[id]; if (!sp) return ''
    const lv = G.getLevel(id) || 0, parts = []
    if (sp.hpPer) parts.push(`HP +${Math.round(sp.hpPer * 100)}%/Lv`)
    if (sp.dmgPer) parts.push(`데미지 +${Math.round(sp.dmgPer * 100)}%/Lv`)
    if (sp.healPer) parts.push(`힐 +${Math.round(sp.healPer * 100)}%/Lv`)
    if (sp.spdPer) parts.push(`속도 +${Math.round(sp.spdPer * 100)}%/Lv`)
    if (sp.shieldPer) parts.push(`쉴드 +${sp.shieldPer}/Lv`)
    if (sp.aoePer) parts.push(`범위 +${Math.round(sp.aoePer * 100)}%/Lv`)
    if (sp.slowPer) parts.push(`둔화 +${Math.round(sp.slowPer * 100)}%/Lv`)
    if (sp.ratePer) parts.push(`연사 +${Math.round(sp.ratePer * 100)}%/Lv`)
    if (sp.chargePer) parts.push(`충전 +${sp.chargePer}/Lv`)
    if (sp.radiusPer) parts.push(`반경 +${Math.round(sp.radiusPer * 100)}%/Lv`)
    if (sp.catchPer) parts.push(`포획 +${sp.catchPer}/Lv`)
    let s = parts.join(' · ')
    if (sp.gimmick) s += `${s ? ' / ' : ''}Lv${sp.gimmick.at}: ${sp.gimmick.text}${lv >= sp.gimmick.at ? ' ✅' : ''}`
    if (sp.note) s += ` (${sp.note})`
    return s
  }

  window.BattleUpgrade = { maxLevel, spec, costToNext, canUpgrade, upgrade, computeUnitStats, effectSummary, COST }
})()
