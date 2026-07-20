// renderer/battle/sim.js — 배틀 모드 전투 시뮬레이터 코어 (렌더/멀티와 분리)
// 좌표는 레인비율 L∈[0,1] (0=side0 기지, 1=side1 기지). 속도/사거리도 L 단위.
// 순수 로직: 마나·유닛 전진/타겟/공격/사망·기지 HP·승패. 렌더 없음.
// 멀티에서는 각자 "자기 유닛"만 이 시뮬로 돌리고 결과를 릴레이(추후 mode.js). 솔로 테스트는 양측 로컬 시뮬 + 간단 AI.
(function () {
  'use strict'
  if (!window.BattleData) { console.error('[battle/sim] BattleData 필요'); return }
  const D = window.BattleData
  const U = window.BattleUpgrade

  const DEFAULTS = { baseHp: 100, manaCap: 10, manaRegen: 0.5, baseRange: 0.03 }

  function statsFor(type) {
    if (U && U.computeUnitStats) { const s = U.computeUnitStats(type); if (s) return s }
    const b = D.UNITS[type]
    return b ? { id: type, hp: b.hp, speed: b.speed, atk: Object.assign({}, b.atk), flying: !!b.flying, shield: b.shield } : null
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v }

  function newBattle(cfg) {
    cfg = Object.assign({}, DEFAULTS, cfg || {})
    let uidSeq = 1
    const st = {
      t: 0,
      mana: [0, 0],
      baseHp: [cfg.baseHp, cfg.baseHp],
      baseHpMax: cfg.baseHp,
      units: [],
      winner: null,           // 0 | 1 | null
      cfg,
      events: [],             // {type:'spawn'|'hit'|'die'|'basehit', ...} — 렌더/릴레이가 소비
    }

    // side: 0 или 1. type: unit id. 반환: 성공 여부(마나)
    function spawn(side, type, opts) {
      if (st.winner != null) return false
      const base = D.UNITS[type]; if (!base) return false
      const cost = base.cost || 1
      if (!(opts && opts.free) && st.mana[side] < cost) return false
      if (!(opts && opts.free)) st.mana[side] -= cost
      const s = statsFor(type)
      const hp = s.hp + (s.shield ? s.shield.absorb : 0)   // 쉴드는 실효 HP로 단순화
      const u = { uid: uidSeq++, side, type, L: side === 0 ? 0 : 1, dir: side === 0 ? 1 : -1, hp, maxHp: hp, stats: s, cdLeft: 0 }
      if (base.battleShield) { u.shMax = base.battleShield.absorb; u.shHp = u.shMax; u.shHitAt = -1e9; u.shCooldown = base.battleShield.cooldown } // 자동 쉴드
      st.units.push(u)
      st.events.push({ type: 'spawn', uid: u.uid, side, unit: type })
      return true
    }

    function nearestEnemy(u) {
      let best = null, bd = Infinity
      for (const e of st.units) { if (e.side === u.side || e.hp <= 0) continue; const d = Math.abs(e.L - u.L); if (d < bd) { bd = d; best = e } }
      return { e: best, d: bd }
    }

    function applyDamage(target, dmg, killerSide) {
      if (target.shMax != null) target.shHitAt = st.t   // 피격 → 재충전 타이머 리셋(교전 중 재생 방지)
      // 자동 쉴드: 남아있으면 먼저 흡수
      if (target.shHp != null && target.shHp > 0) {
        const block = Math.min(target.shHp, dmg); target.shHp -= block; dmg -= block
        if (target.shHp <= 0) st.events.push({ type: 'shieldbreak', uid: target.uid, L: target.L, side: target.side })
        if (dmg <= 0) { st.events.push({ type: 'shieldblock', uid: target.uid, L: target.L, side: target.side }); return }
      }
      target.hp -= dmg
      if (target.hp <= 0) { target.hp = 0; st.events.push({ type: 'die', uid: target.uid, side: target.side, L: target.L, unit: target.type }) }
    }

    function step(dt) {
      if (st.winner != null) return
      st.t += dt
      // 마나 (기본 회복 + 일개미(워커) 버프: 살아있는 워커 1마리당 +manaBuff/s)
      st.manaBuff = [0, 0]
      for (const u of st.units) { if (u.hp <= 0) continue; const mb = D.UNITS[u.type] && D.UNITS[u.type].manaBuff; if (mb) st.manaBuff[u.side] += mb }
      for (let s = 0; s < 2; s++) st.mana[s] = clamp(st.mana[s] + (cfg.manaRegen + st.manaBuff[s]) * dt, 0, cfg.manaCap)

      for (const u of st.units) {
        if (u.hp <= 0) continue
        if (u.shMax != null && u.shHp < u.shMax && st.t - u.shHitAt >= u.shCooldown) u.shHp = u.shMax // 피격 없이 cooldown초 지나야 재충전(교전 중 재생 X)
        const range = (u.stats.atk && u.stats.atk.range) || 0.02
        const enemyBaseL = u.side === 0 ? 1 : 0
        const { e: tgt, d: td } = nearestEnemy(u)
        const distBase = Math.abs(u.L - enemyBaseL)
        const hasAtk = u.stats.atk && u.stats.atk.type && u.stats.atk.type !== 'none'
        let acting = false

        if (hasAtk) {
          if (tgt && td <= range) {
            acting = true
            u.cdLeft -= dt
            if (u.cdLeft <= 0) {
              u.cdLeft = u.stats.atk.cd || 1
              const dmg = u.stats.atk.dmg || 1
              if (u.stats.atk.type === 'aoe') {   // 광역: 타겟 주변 aoeR 내 전부
                const r = u.stats.atk.aoeR || 0.05
                for (const e of st.units) if (e.side !== u.side && e.hp > 0 && Math.abs(e.L - tgt.L) <= r) applyDamage(e, dmg, u.side)
              } else { applyDamage(tgt, dmg, u.side) }
              st.events.push({ type: 'hit', by: u.uid, target: tgt.uid, dmg })
            }
          } else if (distBase <= Math.max(range, cfg.baseRange) && !(tgt && td <= range)) {
            acting = true
            u.cdLeft -= dt
            if (u.cdLeft <= 0) {
              u.cdLeft = u.stats.atk.cd || 1
              const dmg = u.stats.atk.dmg || 1
              const es = u.side === 0 ? 1 : 0
              st.baseHp[es] = Math.max(0, st.baseHp[es] - dmg)
              st.events.push({ type: 'basehit', side: es, dmg })
            }
          }
        }

        // 근접 유닛이 적과 접촉하면 멈춰 교전(전진 X). 그 외엔 전진.
        const blocked = tgt && td <= Math.max(range, 0.02)
        if (!acting && !blocked) u.L = clamp(u.L + u.dir * u.stats.speed * dt, 0, 1)
      }

      // 사망 제거
      st.units = st.units.filter((u) => u.hp > 0)

      // 승패
      if (st.baseHp[0] <= 0) st.winner = 1
      else if (st.baseHp[1] <= 0) st.winner = 0
    }

    // 솔로 테스트용 간단 AI: 주기적으로 덱에서 살 수 있는 유닛을 무작위 소환
    function makeAI(side, deck, everySec) {
      let acc = 0
      return function aiStep(dt, rnd) {
        if (st.winner != null) return
        acc += dt
        if (acc < (everySec || 1.4)) return
        acc = 0
        const affordable = deck.filter((id) => D.UNITS[id] && (D.UNITS[id].cost || 1) <= st.mana[side])
        if (!affordable.length) return
        const pick = affordable[Math.floor((rnd || Math.random)() * affordable.length)]
        spawn(side, pick)
      }
    }

    function drainEvents() { const e = st.events; st.events = []; return e }

    return { state: st, spawn, step, makeAI, drainEvents }
  }

  window.BattleSim = { newBattle }
})()
