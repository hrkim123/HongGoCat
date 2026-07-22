// renderer/battle/sim.js — 배틀 모드 전투 시뮬레이터 코어 (렌더/멀티와 분리)
// 좌표는 레인비율 L∈[0,1] (0=side0 기지, 1=side1 기지). 속도/사거리도 L 단위.
// 순수 로직: 마나·유닛 전진/타겟/공격/사망·기지 HP·승패. 렌더 없음.
// 멀티에서는 각자 "자기 유닛"만 이 시뮬로 돌리고 결과를 릴레이(추후 mode.js). 솔로 테스트는 양측 로컬 시뮬 + 간단 AI.
(function () {
  'use strict'
  if (!window.BattleData) { console.error('[battle/sim] BattleData 필요'); return }
  const D = window.BattleData
  const U = window.BattleUpgrade

  const DEFAULTS = { baseHp: 300, manaCap: 30, manaRegen: 0.3, baseRange: 0.03, speedScale: 1 }   // 기지 HP 300, 맥스 마나 30(고코스트 결전 유닛 대응), 기본 충전 0.3/s
  const KB_DUR = 0.30, KB_BACK = 0.09, KB_CD = 0.7   // 넉백: 0.30초간 살짝 뒤로(냥코풍 짧은 홉) + 재넉백 최소 간격 0.7s(락 방지)
  // 마나 강화(냥코 일꾼레벨): 마나 지불→이번 판 충전속도↑(판 끝나면 초기화). 기본 0.5/s, 강화 체감 소폭 상향.
  const MANA_LEVELS = [{ cost: 6, rate: 0.6 }, { cost: 9, rate: 0.9 }, { cost: 12, rate: 1.3 }, { cost: 16, rate: 1.7 }, { cost: 20, rate: 2.2 }]

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
      manaRate: [cfg.manaRegen, cfg.manaRegen], manaLevel: [0, 0],   // 마나 강화 레벨/충전속도(판별)
      baseHp: [cfg.baseHp, cfg.baseHp],
      baseHpMax: cfg.baseHp,
      baseShield: [0, 0], baseShieldUntil: [0, 0],   // 기지 방어 돔(쉴드 무기): HP·만료시각. 활성 중엔 기지 데미지 흡수, 깨지면 넉백 이벤트
      units: [],
      ghosts: [],             // 멀티: 상대(고스트) 유닛 [{uid,type,L,hp}] — 내 유닛의 타겟/이동 기준(데미지는 릴레이)
      winner: null,           // 0 | 1 | null
      cfg,
      events: [],             // {type:'spawn'|'hit'|'die'|'basehit'|'ghosthit', ...} — 렌더/릴레이가 소비
    }
    function setGhosts(list) { st.ghosts = list || [] }

    // side: 0 или 1. type: unit id. 반환: 성공 여부(마나)
    function spawn(side, type, opts) {
      if (st.winner != null) return false
      const base = D.UNITS[type]; if (!base) return false
      const cost = base.cost || 1
      if (!(opts && opts.free) && st.mana[side] < cost) return false
      if (!(opts && opts.free)) st.mana[side] -= cost
      const s = statsFor(type)
      const sh = s.battleShield || null   // 자동 쉴드(레벨 반영). 실효 HP엔 미포함(별도 게이지)
      const hp = s.hp + (s.shield ? s.shield.absorb : 0)   // (구)shield는 실효 HP로 단순화
      const startL = (opts && opts.atL != null) ? clamp(opts.atL, 0, 1) : (side === 0 ? 0 : 1)   // atL: 특정 위치 소환(여왕 앞 등)
      const chargeCd = s.atk && s.atk.charge ? (s.atk.cd || 1) : 0   // 충전형은 첫 발도 충전부터(cdLeft를 cd로 초기화)
      const u = { uid: uidSeq++, side, type, L: startL, dir: side === 0 ? 1 : -1, hp, maxHp: hp, stats: s, cdLeft: chargeCd }
      if (sh) { u.shMax = sh.absorb; u.shHp = u.shMax; u.shHitAt = -1e9; u.shCooldown = sh.cooldown } // 자동 쉴드(레벨 반영)
      if (s.summon) u.summonCd = s.summon.every || 4   // 생산형(여왕): 소환 타이머(레벨 반영)
      // 넉백(냥코풍): kb회수만큼 HP 임계에서 뒤로 밀림. 임계 = maxHp*k/(kb+1) 내림차순.
      const kb = s.kb != null ? s.kb : 2   // 기본 2회. 탱커/보스는 낮게(데이터에서 지정)
      u.kbList = []; for (let k = kb; k >= 1; k--) u.kbList.push(hp * k / (kb + 1))
      st.units.push(u)
      st.events.push({ type: 'spawn', uid: u.uid, side, unit: type })
      // Lv5 기믹 물량(개미): 같은 코스트로 추가 1기(무료). 약간 뒤(같은 진영 방향)에 소환.
      if (s.spawnCount > 1 && !(opts && opts._extra)) {
        for (let k = 1; k < s.spawnCount; k++) spawn(side, type, { free: true, _extra: true, atL: clamp(startL - u.dir * 0.02 * k, 0, 1) })
      }
      return true
    }

    // 대상이 공중인가(유닛=stats.flying, 고스트=데이터). 근접/자폭은 공중을 타격/타겟 불가(기본 규칙: 근접은 대공 X).
    function isFlying(e) { return !!(e && (e.flying || (e.stats && e.stats.flying) || (D.UNITS[e.type] && D.UNITS[e.type].flying))) }
    function isMeleeType(u) { const t = u.stats && u.stats.atk && u.stats.atk.type; return t === 'melee' || t === 'suicide' }
    function canHit(u, e) { const t = u.stats && u.stats.atk && u.stats.atk.type; return !(t === 'melee' && isFlying(e)) }   // 순수 근접만 공중 불가(자폭은 공중도 타격 가능)
    function nearestEnemy(u) {
      let best = null, bd = Infinity, ghost = false
      for (const e of st.units) { if (e.side === u.side || e.hp <= 0 || !canHit(u, e)) continue; const d = Math.abs(e.L - u.L); if (d < bd) { bd = d; best = e; ghost = false } }
      for (const g of st.ghosts) { if (g.hp <= 0 || !canHit(u, g)) continue; const d = Math.abs(g.L - u.L); if (d < bd) { bd = d; best = g; ghost = true } }   // 멀티: 상대 고스트도 타겟
      return { e: best, d: bd, ghost }
    }
    // 가장 가까운 지상(비공중) 적과의 거리(타이탄 스톰프/레이저용 — 공중 무시)
    function nearestGroundEnemy(u) {
      let bd = Infinity
      for (const e of st.units) { if (e.side === u.side || e.hp <= 0 || isFlying(e)) continue; const d = Math.abs(e.L - u.L); if (d < bd) bd = d }
      for (const g of st.ghosts) { if (g.hp <= 0 || isFlying(g)) continue; const d = Math.abs(g.L - u.L); if (d < bd) bd = d }
      return bd === Infinity ? null : bd
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

    function applyKb(target, force, opts) {   // 강제 넉백(임계 무관). force=true면 재넉백 쿨(KB_CD)도 무시(망치개미: 매 공격 넉백). opts={back,dur}로 세기/시간 지정(쉴드 파열 등 큰 밀림).
      if (target.hp <= 0 || target.structure) return   // 구조물(게틀링 등)은 넉백 안 됨(고정)
      if (target.frozenUntil && target.frozenUntil > st.t) return   // 빙결 중엔 넉백 X
      if (!force && target.kbCdUntil && target.kbCdUntil > st.t) return
      target.kbUntil = st.t + ((opts && opts.dur) || KB_DUR); target.kbCdUntil = st.t + KB_CD; target.kbBack = (opts && opts.back) || 0
      if (target.stats && target.stats.atk && target.stats.atk.cd) target.cdLeft = target.stats.atk.cd   // CC: 진행 중 공격/조준 취소 + 재장전(넉백 풀린 뒤 다시 cd 채워야 발사)
      st.events.push({ type: 'knockback', uid: target.uid, L: target.L, side: target.side })
    }
    function upgradeMana(side) {   // 마나 강화 1레벨(마나 지불). 성공 시 true.
      const lv = st.manaLevel[side]; if (lv >= MANA_LEVELS.length) return false
      const step = MANA_LEVELS[lv]; if (st.mana[side] < step.cost) return false
      st.mana[side] -= step.cost; st.manaLevel[side] = lv + 1; st.manaRate[side] = step.rate; return true
    }
    function manaUpInfo(side) { const lv = st.manaLevel[side], maxed = lv >= MANA_LEVELS.length; return { level: lv, maxed, nextCost: maxed ? null : MANA_LEVELS[lv].cost, rate: st.manaRate[side] } }
    function applyDamage(target, dmg, killerSide) {
      if (target.shMax != null) target.shHitAt = st.t   // 피격 → 재충전 타이머 리셋(교전 중 재생 방지)
      // 자동 쉴드: 남아있으면 먼저 흡수
      if (target.shHp != null && target.shHp > 0) {
        const block = Math.min(target.shHp, dmg); target.shHp -= block; dmg -= block
        if (target.shHp <= 0) st.events.push({ type: 'shieldbreak', uid: target.uid, L: target.L, side: target.side })
        if (dmg <= 0) { st.events.push({ type: 'shieldblock', uid: target.uid, L: target.L, side: target.side }); return }
      }
      target.hp -= dmg
      // 넉백: 남은 HP가 다음 임계 이하로 내려가면(가능한 만큼) 뒤로 밀림. 얼거나 죽으면 스킵.
      if (target.hp > 0 && target.kbList && target.kbList.length && !(target.frozenUntil && target.frozenUntil > st.t)) {
        let bumped = false
        while (target.kbList.length && target.hp <= target.kbList[0]) { target.kbList.shift(); bumped = true }
        if (bumped) applyKb(target, false)   // 임계 넉백도 공통 처리(공격 쿨 리셋 포함)
      }
      if (target.hp <= 0) {
        target.hp = 0; st.events.push({ type: 'die', uid: target.uid, side: target.side, L: target.L, unit: target.type })
        // 브루드 타이탄 Lv5: 죽을 때 잔해 벽(HP 구조물) 생성 → 몇 초간 라인 저지(소프트 블록). 구조물은 bunits로 상대에게도 방송됨.
        if (target.type === 'broodTitan' && target.stats && target.stats.deathMound) {
          const mUid = addStructure({ side: target.side, type: 'moundwall', hp: 140, L: target.L })
          const mu = st.units.find((x) => x.uid === mUid); if (mu) mu.decayAt = st.t + 8
        }
      }
    }

    function nearestAllyHurt(u, range) {   // 메딕: 사거리 내 체력 깎인 아군(자기 제외)
      let best = null, bd = Infinity
      for (const e of st.units) { if (e.side !== u.side || e === u || e.hp <= 0 || e.hp >= e.maxHp) continue; const d = Math.abs(e.L - u.L); if (d <= range && d < bd) { bd = d; best = e } }
      return best
    }
    function step(dt) {
      if (st.winner != null) return
      st.t += dt
      // 방어 돔: 깨지든 시간이 다 되든 "마지막엔 팡" — 시간 만료도 파열 이벤트 + 넉백으로 처리.
      for (let s = 0; s < 2; s++) {
        if (st.baseShield[s] > 0 && st.baseShieldUntil[s] <= st.t) { st.baseShield[s] = 0; st.baseShieldUntil[s] = 0; st.events.push({ type: 'baseshieldbreak', side: s }); baseShieldBreakKnockback(s) }
      }
      // 마나 (기본 회복 + 일개미(워커) 버프: 살아있는 워커 1마리당 +manaBuff/s)
      st.manaBuff = [0, 0]
      for (const u of st.units) { if (u.hp <= 0) continue; const mb = D.UNITS[u.type] && D.UNITS[u.type].manaBuff; if (mb) st.manaBuff[u.side] += mb }
      for (let s = 0; s < 2; s++) st.mana[s] = clamp(st.mana[s] + (st.manaRate[s] + st.manaBuff[s]) * dt, 0, cfg.manaCap)   // 강화 레벨 반영

      // 지휘 개미 오라: 살아있는 커맨더 주변(같은 side) 아군 공격/속도 버프(최대치 적용, 중첩 X)
      for (const u of st.units) { u._auraAtk = 0; u._auraSpd = 0 }
      for (const c of st.units) {
        if (c.hp <= 0) continue; const aura = (c.stats && c.stats.aura) || (D.UNITS[c.type] && D.UNITS[c.type].aura); if (!aura) continue
        for (const u of st.units) { if (u.side !== c.side || u.hp <= 0) continue; if (Math.abs(u.L - c.L) <= aura.range) { u._auraAtk = Math.max(u._auraAtk, aura.atk || 0); u._auraSpd = Math.max(u._auraSpd, aura.speed || 0) } }
      }

      for (const u of st.units) {
        if (u.hp <= 0) continue
        if (u.shMax != null && u.shHp < u.shMax && st.t - u.shHitAt >= u.shCooldown) u.shHp = u.shMax // 피격 없이 cooldown초 지나야 재충전
        if (u.frozenUntil && u.frozenUntil > st.t) continue   // ❄ 빙결: 이동·공격 정지
        if (u.kbUntil && u.kbUntil > st.t) { u.L = clamp(u.L - u.dir * (u.kbBack || KB_BACK) * dt, 0, 1); continue }   // 넉백: 뒤로 밀리는 동안 공격 X (kbBack 지정 시 큰 밀림)
        const range = (u.stats.atk && u.stats.atk.range) || 0.02
        const enemyBaseL = u.side === 0 ? 1 : 0
        const { e: tgt, d: td, ghost: tgtGhost } = nearestEnemy(u)
        const distBase = Math.abs(u.L - enemyBaseL)
        const atkType = u.stats.atk && u.stats.atk.type
        const hasAtk = atkType && atkType !== 'none'
        let acting = false

        if (atkType === 'heal') {   // 메딕: 아군 회복(투사체 X). 초록 십자 = 본인+대상.
          const ally = nearestAllyHurt(u, range)
          if (ally) {
            acting = true; u.cdLeft -= dt
            if (u.cdLeft <= 0) {
              u.cdLeft = u.stats.atk.cd || 1; const heal = u.stats.atk.heal || 3
              if (u.stats.atk.healAoe) {   // Lv5: 범위 힐 — 사거리 내 다친 아군 전원
                for (const e of st.units) { if (e.side === u.side && e.hp > 0 && e.hp < e.maxHp && Math.abs(e.L - u.L) <= range) { e.hp = Math.min(e.maxHp, e.hp + heal); st.events.push({ type: 'heal', by: u.uid, target: e.uid, medL: u.L, healL: e.L, side: u.side }) } }
              } else { ally.hp = Math.min(ally.maxHp, ally.hp + heal); st.events.push({ type: 'heal', by: u.uid, target: ally.uid, medL: u.L, healL: ally.L, side: u.side }) }
            }
          }
        } else if (atkType === 'suicide') {   // 카미카제: 적/기지 접촉 시 자폭(광역) + 자신 사망
          const inTgt = tgt && td <= range, inBase = distBase <= Math.max(range, cfg.baseRange)
          if (inTgt || inBase) {
            const aoe = u.stats.atk.aoeR || 0.05, dmg = u.stats.atk.dmg || 1
            for (const e of st.units) { if (e.side !== u.side && e.hp > 0 && Math.abs(e.L - u.L) <= aoe) applyDamage(e, dmg, u.side) }   // 자폭은 공중 포함 광역 타격
            for (const g of st.ghosts) { if (g.hp > 0 && Math.abs(g.L - u.L) <= aoe) st.events.push({ type: 'ghosthit', uid: g.uid, dmg }) }   // 멀티: 고스트 광역 피격 릴레이(공중 포함)
            if (inBase && !inTgt) { const es = u.side === 0 ? 1 : 0; damageBase(es, dmg) }
            st.events.push({ type: 'boom', uid: u.uid, L: u.L, side: u.side, aoeR: aoe })
            st.events.push({ type: 'die', uid: u.uid, side: u.side, L: u.L, unit: u.type })
            u.hp = 0; continue
          }
        } else if (atkType === 'titan') {   // 브루드 타이탄: 근접=스톰프(짓밟기+넉백) / 원거리=땅 긁는 레이저(공중 제외). 근접 우선.
          const a = u.stats.atk, stompR = a.stompR || 0.055, laserR = a.laserR || 0.22
          const gd = nearestGroundEnemy(u)   // 가장 가까운 지상 적과의 거리(공중 제외)
          const es = u.side === 0 ? 1 : 0
          if ((gd != null && gd <= stompR) || distBase <= stompR) {   // ① 스톰프 존
            acting = true; u.cdLeft -= dt
            if (u.cdLeft <= 0) {
              u.cdLeft = a.stompCd || 1.5
              const dmg = Math.round((a.stompDmg || 30) * (1 + (u._auraAtk || 0)))
              for (const e of st.units) if (e.side !== u.side && e.hp > 0 && !isFlying(e) && Math.abs(e.L - u.L) <= stompR) { applyDamage(e, dmg, u.side); applyKb(e, true) }
              for (const g of st.ghosts) if (g.hp > 0 && !isFlying(g) && Math.abs(g.L - u.L) <= stompR) st.events.push({ type: 'ghosthit', uid: g.uid, dmg, kb: true })
              if (distBase <= stompR) damageBase(es, dmg)
              st.events.push({ type: 'hit', by: u.uid, dmg, slamL: u.L, slamR: stompR })   // 스톰프 충격 연출
            }
          } else if ((gd != null && gd <= laserR) || distBase <= laserR) {   // ② 레이저 존(스톰프 존 비었을 때만)
            acting = true; u._laserCd = (u._laserCd || 0) - dt
            if (u._laserCd <= 0) {
              u._laserCd = a.laserCd || 2.4
              const dmg = Math.round((a.laserDmg || 11) * (1 + (u._auraAtk || 0)))
              const toL = clamp(u.L + u.dir * laserR, 0, 1), lo = Math.min(u.L, toL), hi = Math.max(u.L, toL)
              for (const e of st.units) if (e.side !== u.side && e.hp > 0 && !isFlying(e) && e.L >= lo && e.L <= hi) applyDamage(e, dmg, u.side)
              for (const g of st.ghosts) if (g.hp > 0 && !isFlying(g) && g.L >= lo && g.L <= hi) st.events.push({ type: 'ghosthit', uid: g.uid, dmg })
              if (distBase <= laserR) damageBase(es, Math.round(dmg * 0.6))   // 레이저가 기지도 긁음(소량)
              st.events.push({ type: 'titanlaser', side: u.side, fromL: u.L, toL })   // 레이저 연출(+연쇄 폭발)
            }
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
              if (isMelee) {   // 근접: 즉시(접촉). kbHit=명중 시 강제 넉백(망치개미), aoeR=범위 슬램(주변 전원)
                const kbHit = !!u.stats.atk.kbHit, slamR = u.stats.atk.aoeR || 0, stun = u.stats.atk.stun || 0
                if (inTgt) {
                  if (slamR > 0) {   // 범위 슬램: 주변 적 전원 타격 + (kbHit면) 매번 강제 넉백 + (stun이면) 스턴
                    for (const e of st.units) if (e.side !== u.side && e.hp > 0 && !isFlying(e) && Math.abs(e.L - u.L) <= slamR) { applyDamage(e, dmg, u.side); if (kbHit) applyKb(e, true); if (stun) e.frozenUntil = Math.max(e.frozenUntil || 0, st.t + stun) }
                    for (const g of st.ghosts) if (g.hp > 0 && !isFlying(g) && Math.abs(g.L - u.L) <= slamR) st.events.push({ type: 'ghosthit', uid: g.uid, dmg, kb: kbHit })
                    st.events.push({ type: 'hit', by: u.uid, target: tgt.uid, dmg, slamL: u.L, slamR })
                  } else if (tgtGhost) st.events.push({ type: 'ghosthit', uid: tgt.uid, dmg, kb: kbHit })
                  else { applyDamage(tgt, dmg, u.side); if (kbHit) applyKb(tgt, true); if (stun) tgt.frozenUntil = Math.max(tgt.frozenUntil || 0, st.t + stun); st.events.push({ type: 'hit', by: u.uid, target: tgt.uid, dmg }) }
                } else { const es = u.side === 0 ? 1 : 0; damageBase(es, dmg) }
              } else {   // 원거리: 실제 투사체 발사(컨트롤러가 처리). ghost=true면 명중 시 릴레이.
                st.events.push({ type: 'fire', by: u.uid, side: u.side, fromL: u.L, dir: u.dir, dmg, atkType, aoeR: u.stats.atk.aoeR || 0, slow: u.stats.atk.slow || 0, slowDur: u.stats.atk.slowDur || 0, targetUid: inTgt ? tgt.uid : null, toL: inTgt ? tgt.L : (u.side === 0 ? 1 : 0), ghost: !!(inTgt && tgtGhost) })
              }
            }
          }
        }

        u._acting = acting   // 교전/조준 중(렌더에서 충전 연출 판단용)
        const baseDef = D.UNITS[u.type]
        // 생산형(여왕 개미): summonCd마다 지정 유닛을 바로 앞에 소환(소환 간격은 레벨 반영)
        const sumDef = (u.stats && u.stats.summon) || (baseDef && baseDef.summon)
        if (sumDef && u.summonCd != null) {
          u.summonCd -= dt
          if (u.summonCd <= 0) { u.summonCd = sumDef.every || 4; spawn(u.side, sumDef.unit, { free: true, atL: clamp(u.L + u.dir * 0.03, 0, 1) }) }
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

      // 시간 만료 구조물(잔해 벽 등) 소멸
      for (const u of st.units) if (u.decayAt && st.t >= u.decayAt) u.hp = 0
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
    function hitUnit(uid, dmg, slow, slowDur, forceKb, kbBig) {
      const u = st.units.find((x) => x.uid === uid); if (!u || u.hp <= 0) return
      applyDamage(u, dmg)
      if (forceKb) applyKb(u, !!kbBig, kbBig ? { back: 1.4, dur: 0.6 } : undefined)   // 캐논/워커 강제 넉백 · kbBig=쉴드 파열 큰 밀림
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
    // 기지 데미지 단일 경로: 방어 돔(쉴드) 활성 중이면 흡수, 깨지면 넉백. 아니면 baseHp 감소.
    function damageBase(side, dmg) {
      if (st.baseShield[side] > 0 && st.baseShieldUntil[side] > st.t) {
        st.baseShield[side] -= dmg
        if (st.baseShield[side] <= 0) { st.baseShield[side] = 0; st.baseShieldUntil[side] = 0; st.events.push({ type: 'baseshieldbreak', side }); baseShieldBreakKnockback(side) }
        return   // 쉴드가 흡수 → 기지 HP 무피해
      }
      st.baseHp[side] = Math.max(0, st.baseHp[side] - dmg); st.events.push({ type: 'basehit', side, dmg })
    }
    // 돔이 깨질 때: 그 진영 절반(내 쪽)에 들어온 적 소환체를 맵 중앙(L 0.5)까지 크게 넉백 + CC.
    function baseShieldBreakKnockback(side) {
      for (const e of st.units) {
        if (e.side === side || e.hp <= 0) continue
        const onOurHalf = side === 0 ? e.L < 0.5 : e.L > 0.5
        if (!onOurHalf) continue
        applyKb(e, true, { back: 1.4, dur: 0.6 })   // ★ 중앙 순간이동 X — 쉴드 터진 그 자리부터 크게·길게 뒤로 밀림
      }
    }
    function activateBaseShield(side, hp, durSec) { st.baseShield[side] = hp; st.baseShieldUntil[side] = st.t + (durSec || 10) }
    function hitBase(side, dmg) { damageBase(side, dmg) }   // 외부(캐논·릴레이)도 동일 경로(쉴드 반영)
    function unitByUid(uid) { return st.units.find((x) => x.uid === uid) }
    // 정지 구조물(게틀링 등): HP만 갖고 이동0·공격0. 적이 타겟·공격하고 파괴 가능(bunits로 방송돼 멀티도 동일). 발사는 컨트롤러가 처리.
    function addStructure(cfg) {
      cfg = cfg || {}
      const side = cfg.side || 0, hp = cfg.hp || 30
      const u = { uid: uidSeq++, side, type: cfg.type || 'structure', L: clamp(cfg.L || 0, 0, 1), dir: side === 0 ? 1 : -1, hp, maxHp: hp, stats: { id: cfg.type, speed: 0, atk: { type: 'none' }, flying: false }, cdLeft: 0, kbList: [], structure: true }
      st.units.push(u)
      st.events.push({ type: 'spawn', uid: u.uid, side, unit: u.type })
      return u.uid
    }

    return { state: st, spawn, step, makeAI, drainEvents, hitUnit, hitBase, unitByUid, setGhosts, upgradeMana, manaUpInfo, addStructure, activateBaseShield }
  }

  window.BattleSim = { newBattle }
})()
