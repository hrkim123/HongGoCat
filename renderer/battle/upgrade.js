// renderer/battle/upgrade.js — 업그레이드 스펙 + 로직
// Max Lv 5. 비용 = 🔩 강화 부품, 곡선 [1,2,3,5](1→2..4→5), 풀강 11.
// 소환체=레벨당 스탯↑(+일부 Lv5 기믹), 무기=데미지 중심.
// window.BattleGacha(레벨·부품)에 의존. computeUnitStats로 배틀에서 실효 스탯 산출.
(function () {
  'use strict'
  if (!window.BattleData || !window.BattleGacha) { console.error('[battle/upgrade] BattleData/BattleGacha 필요'); return }
  const D = window.BattleData, G = window.BattleGacha

  const MAX = 5
  const COST = [1, 2, 3, 5] // index: 현재레벨-1 (Lv1→2 = COST[0])

  // 레벨당 배수/효과 + Lv5 기믹 설명. mul은 (lvl-1) 곱.
  const SPEC = {
    // 소환체
    ant:        { kind: 'unit', hpPer: 0.15, gimmick: { at: 5, text: '소환 시 2기(물량)' } },
    rifleman:   { kind: 'unit', dmgPer: 0.12, gimmick: { at: 5, text: '4연발(3→4)' } },
    grenadier:  { kind: 'unit', dmgPer: 0.12, gimmick: { at: 5, text: '착탄 화염 장판(도트)' } },
    shielder:   { kind: 'unit', shieldPer: 4, gimmick: { at: 5, text: '파괴 시 주변 아군 2초 보호막' } },
    mechaAnt:   { kind: 'unit', hpPer: 0.10, dmgPer: 0.10, gimmick: { at: 5, text: '대포 2연사' } },
    mechaHuman: { kind: 'unit', hpPer: 0.10, dmgPer: 0.10, gimmick: { at: 5, text: '부스터 대시(순간 접근)' } },
    // 무기
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

  // 실효 유닛 스탯(배틀 시뮬용). 레벨 반영 + 기믹 플래그.
  function computeUnitStats(id) {
    const base = D.UNITS[id]; if (!base) return null
    const lv = Math.max(1, G.getLevel(id) || 1), sp = SPEC[id] || {}
    const n = lv - 1
    const hp = Math.round(base.hp * (1 + (sp.hpPer || 0) * n))
    const out = { id, level: lv, hp, speed: base.speed, atk: Object.assign({}, base.atk), flying: !!base.flying }
    if (out.atk && sp.dmgPer && out.atk.dmg) out.atk.dmg = +(out.atk.dmg * (1 + sp.dmgPer * n)).toFixed(2)
    if (base.shield) { out.shield = { absorb: base.shield.absorb + (sp.shieldPer || 0) * n } }
    // 기믹
    out.gimmick = (sp.gimmick && lv >= sp.gimmick.at) ? sp.gimmick.text : null
    if (id === 'ant' && out.gimmick) out.spawnCount = 2
    if (id === 'rifleman' && out.gimmick && out.atk) out.atk.burst = 4
    return out
  }

  // UI 표시용: 현재 효과 요약 문자열
  function effectSummary(id) {
    const sp = SPEC[id]; if (!sp) return ''
    const lv = G.getLevel(id) || 0, parts = []
    if (sp.hpPer) parts.push(`HP +${Math.round(sp.hpPer * 100)}%/Lv`)
    if (sp.dmgPer) parts.push(`데미지 +${Math.round(sp.dmgPer * 100)}%/Lv`)
    if (sp.shieldPer) parts.push(`쉴드 +${sp.shieldPer}/Lv`)
    if (sp.ratePer) parts.push(`연사 +${Math.round(sp.ratePer * 100)}%/Lv`)
    if (sp.chargePer) parts.push(`충전 +${sp.chargePer}/Lv`)
    if (sp.radiusPer) parts.push(`반경 +${Math.round(sp.radiusPer * 100)}%/Lv`)
    if (sp.catchPer) parts.push(`포획 +${sp.catchPer}/Lv`)
    let s = parts.join(' · ')
    if (sp.gimmick) s += ` / Lv${sp.gimmick.at}: ${sp.gimmick.text}${lv >= sp.gimmick.at ? ' ✅' : ''}`
    if (sp.note) s += ` (${sp.note})`
    return s
  }

  window.BattleUpgrade = { maxLevel, spec, costToNext, canUpgrade, upgrade, computeUnitStats, effectSummary, COST }
})()
