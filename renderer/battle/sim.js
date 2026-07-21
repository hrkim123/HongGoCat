// renderer/battle/sim.js — 배틀 모드 전투 시뮬레이터 코어 (렌더/멀티와 분리)
// 좌표는 레인비율 L∈[0,1] (0=side0 기지, 1=side1 기지). 속도/사거리도 L 단위.
// 순수 로직: 마나·유닛 전진/타겟/공격/사망·기지 HP·승패. 렌더 없음.
// 멀티에서는 각자 "자기 유닛"만 이 시뮬로 돌리고 결과를 릴레이(추후 mode.js). 솔로 테스트는 양측 로컬 시뮬 + 간단 AI.
(function () {
  'use strict'
  if (!window.BattleData) { console.error('[battle/sim] BattleData 필요'); return }
  const D = window.BattleData
  const U = window.BattleUpgrade

  const DEFAULTS = { baseHp: 100, manaCap: 10, manaRegen: 0.5, baseRange: 0.03, speedScale: 1 }

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
      const startL = (opts && opts.atL != null) ? clamp(opts.atL, 0, 1) : (side === 0 ? 0 : 1)   // atL: 특정 위치 소환(여왕 앞 등)
      const chargeCd = s.atk && s.atk.charge ? (s.atk.cd || 1) : 0   // 충전형은 첫 발도 충전부터(cdLeft를 cd로 초기화)
      const u = { uid: uidSeq++, side, type, L: startL, dir: side === 0 ? 1 : -1, hp, maxHp: hp, stats: s, cdLeft: chargeCd }
      if (base.battleShield) { u.shMax = base.battleShield.absorb; u.shHp = u.shMax; u.shHitAt = -1e9; u.shCooldown = base.battleShield.cooldown } // 자동 쉴드
      if (base.summon) u.summonCd = base.summon.every || 4   // 생산형(여왕): 소환 타이머
      st.units.push(u)
      st.events.push({ type: 'spawn', uid: u.uid, side, unit: type })
      return true
    }

    function nearestEnemy(u) {
      let best = null, bd = Infinity
      for (const e of st.units) { if (e.side === u.side || e.hp <= 0) continue; const d = Math.abs(e.L - u.L); if (d < bd) { bd = d; best = e } }
      return { e: best, d: bd }
    }
    // 서포트 유닛 앞쪽(적 방향)에 있는 "가장 가까운 전투 아군"의 L. 없으면 null → 서포트는 그 뒤에서 대기·전진.
    function nearestCombatAllyAhead(u) {
      let best = null
      for (const e of st.units) {
        if (e === u || e.side !== u.side || e.hp <= 0) continue
        const ed = D.UNITS[e.type]; if (ed && ed.support) continue   // 서포트끼리는 프론트라인으로 안 침
        const ahead = u.side === 0 ? e.L > u.L : e.L < u.L
        if (!ahead) continue
        if (best == null || (u.side === 0 ? e.L < best : e.L > best)) best = e.L   // 가장 가까운(바로 앞) 아군
      }
      return best
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

    function nearestAllyHurt(u, range) {   // 메딕: 사거리 내 체력 깎인 아군(자기 제외)
      let best = null, bd = Infinity
      for (const e of st.units) { if (e.side !== u.side || e === u || e.hp <= 0 || e.hp >= e.maxHp) continue; const d = Math.abs(e.L - u.L); if (d <= range && d < bd) { bd = d; best = e } }
      return best
    }
    function step(dt) {
      if (st.winner != null) return
      st.t += dt
      // 마나 (기본 회복 + 일개미(워커) 버프: 살아있는 워커 1마리당 +manaBuff/s)
      st.manaBuff = [0, 0]
      for (const u of st.units) { if (u.hp <= 0) continue; const mb = D.UNITS[u.type] && D.UNITS[u.type].manaBuff; if (mb) st.manaBuff[u.side] += mb }
      for (let s = 0; s < 2; s++) st.mana[s] = clamp(st.mana[s] + (cfg.manaRegen + st.manaBuff[s]) * dt, 0, cfg.manaCap)

      // 지휘 개미 오라: 살아있는 커맨더 주변(같은 side) 아군 공격/속도 버프(최대치 적용, 중첩 X)
      for (const u of st.units) { u._auraAtk = 0; u._auraSpd = 0 }
      for (const c of st.units) {
        if (c.hp <= 0) continue; const cd = D.UNITS[c.type]; const aura = cd && cd.aura; if (!aura) continue
        for (const u of st.units) { if (u.side !== c.side || u.hp <= 0) continue; if (Math.abs(u.L - c.L) <= aura.range) { u._auraAtk = Math.max(u._auraAtk, aura.atk || 0); u._auraSpd = Math.max(u._auraSpd, aura.speed || 0) } }
      }

      for (const u of st.units) {
        if (u.hp <= 0) continue
        if (u.shMax != null && u.shHp < u.shMax && st.t - u.shHitAt >= u.shCooldown) u.shHp = u.shMax // 피격 없이 cooldown초 지나야 재충전
        if (u.frozenUntil && u.frozenUntil > st.t) continue   // ❄ 빙결: 이동·공격 정지
        const range = (u.stats.atk && u.stats.atk.range) || 0.02
        const enemyBaseL = u.side === 0 ? 1 : 0
        const { e: tgt, d: td } = nearestEnemy(u)
        const distBase = Math.abs(u.L - enemyBaseL)
        const atkType = u.stats.atk && u.stats.atk.type
        const hasAtk = atkType && atkType !== 'none'
        let acting = false

        if (atkType === 'heal') {   // 메딕: 아군 회복(투사체 X). 초록 십자 = 본인+대상.
          const ally = nearestAllyHurt(u, range)
          if (ally) {
            acting = true; u.cdLeft -= dt
            if (u.cdLeft <= 0) { u.cdLeft = u.stats.atk.cd || 1; const heal = u.stats.atk.heal || 3; ally.hp = Math.min(ally.maxHp, ally.hp + heal); st.events.push({ type: 'heal', by: u.uid, target: ally.uid, medL: u.L, healL: ally.L, side: u.side }) }
          }
        } else if (atkType === 'suicide') {   // 카미카제: 적/기지 접촉 시 자폭(광역) + 자신 사망
          const inTgt = tgt && td <= range, inBase = distBase <= Math.max(range, cfg.baseRange)
          if (inTgt || inBase) {
            const aoe = u.stats.atk.aoeR || 0.05, dmg = u.stats.atk.dmg || 1
            for (const e of st.units) { if (e.side !== u.side && e.hp > 0 && Math.abs(e.L - u.L) <= aoe) applyDamage(e, dmg, u.side) }
            if (inBase && !inTgt) { const es = u.side === 0 ? 1 : 0; st.baseHp[es] = Math.max(0, st.baseHp[es] - dmg) }
            st.events.push({ type: 'boom', uid: u.uid, L: u.L, side: u.side, aoeR: aoe })
            st.events.push({ type: 'die', uid: u.uid, side: u.side, L: u.L, unit: u.type })
            u.hp = 0; continue
          }
        } else if (hasAtk) {
          const isMelee = atkType === 'melee'
          const inTgt = tgt && td <= range
          const inBase = distBase <= Math.max(range, cfg.baseRange) && !inTgt
          if (inTgt || inBase) {
            acting = true
            u.cdLeft -= dt
            if (u.cdLeft <= 0) {
              u.cdLeft = u.stats.atk.cd || 1
              const dmg = Math.round((u.stats.atk.dmg || 1) * (1 + (u._auraAtk || 0)))   // 오라 공격 버프
              if (isMelee) {   // 근접: 즉시(접촉)
                if (inTgt) { applyDamage(tgt, dmg, u.side); st.events.push({ type: 'hit', by: u.uid, target: tgt.uid, dmg }) }
                else { const es = u.side === 0 ? 1 : 0; st.baseHp[es] = Math.max(0, st.baseHp[es] - dmg); st.events.push({ type: 'basehit', side: es, dmg }) }
              } else {   // 원거리: 실제 투사체 발사(컨트롤러가 처리)
                st.events.push({ type: 'fire', by: u.uid, side: u.side, fromL: u.L, dir: u.dir, dmg, atkType, aoeR: u.stats.atk.aoeR || 0, slow: u.stats.atk.slow || 0, slowDur: u.stats.atk.slowDur || 0, targetUid: inTgt ? tgt.uid : null, toL: inTgt ? tgt.L : (u.side === 0 ? 1 : 0) })
              }
            }
          }
        }

        u._acting = acting   // 교전/조준 중(렌더에서 충전 연출 판단용)
        const baseDef = D.UNITS[u.type]
        // 생산형(여왕 개미): summonCd마다 지정 유닛을 바로 앞에 소환
        if (baseDef && baseDef.summon && u.summonCd != null) {
          u.summonCd -= dt
          if (u.summonCd <= 0) { u.summonCd = baseDef.summon.every || 4; spawn(u.side, baseDef.summon.unit, { free: true, atL: clamp(u.L + u.dir * 0.03, 0, 1) }) }
        }

        // 이동: 오라 속도 버프 + 감속(slow). 근접 교전/사격 중엔 정지.
        const blocked = tgt && td <= Math.max(range, 0.02)
        const slowMul = (u.slowUntil && u.slowUntil > st.t) ? (u.slowMul || 1) : 1
        const spdMul = (1 + (u._auraSpd || 0)) * slowMul
        let allowMove = !acting && !blocked
        if (allowMove && baseDef && baseDef.support) {   // 서포트: 앞선 전투 아군을 추월하지 않고 뒤에서 대기·전진
          const frontL = nearestCombatAllyAhead(u)
          if (frontL != null) { const gap = 0.05, limit = u.side === 0 ? frontL - gap : frontL + gap; if (u.side === 0 ? u.L >= limit : u.L <= limit) allowMove = false }
        }
        if (allowMove) u.L = clamp(u.L + u.dir * u.stats.speed * (cfg.speedScale || 1) * spdMul * dt, 0, 1)
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

    // 컨트롤러(오버레이 투사체)가 명중 시 호출 — 쉴드/사망은 여기서 처리
    function hitUnit(uid, dmg, slow, slowDur) {
      const u = st.units.find((x) => x.uid === uid); if (!u || u.hp <= 0) return
      applyDamage(u, dmg)
      if (slow) {
        u.slowUntil = st.t + (slowDur || 1); u.slowMul = 1 - slow
        // ❄ 빙결 스택: 감속 5회 누적 → 2초 빙결 정지 → 이후 10초 빙결 면역(그 동안은 감속만)
        if (!(u.freezeImmuneUntil && u.freezeImmuneUntil > st.t)) {
          if (u.slowStackAt == null || st.t - u.slowStackAt > (slowDur || 2) + 0.5) u.slowStacks = 0   // 누적 창 밖이면 리셋
          u.slowStacks = (u.slowStacks || 0) + 1; u.slowStackAt = st.t
          if (u.slowStacks >= 5) { u.frozenUntil = st.t + 2; u.slowStacks = 0; u.freezeImmuneUntil = st.t + 2 + 10; st.events.push({ type: 'freeze', uid: u.uid, L: u.L, side: u.side }) }
        }
      }
    }
    function hitBase(side, dmg) { st.baseHp[side] = Math.max(0, st.baseHp[side] - dmg) }   // 승패는 step에서 판정
    function unitByUid(uid) { return st.units.find((x) => x.uid === uid) }

    return { state: st, spawn, step, makeAI, drainEvents, hitUnit, hitBase, unitByUid }
  }

  window.BattleSim = { newBattle }
})()
