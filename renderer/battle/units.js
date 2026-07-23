// renderer/battle/units.js — 배틀 모드 유닛/무기 데이터 (Phase 1)
// 하드코딩 대신 "데이터"로 정의한다. 유닛 추가 = 여기 한 줄 추가.
// 속도(speed)/사거리(range)/범위(aoeR)/투사체속도(projSpeed)는 전부 "레인비율" 단위(0~1).
//   예) speed:0.15 = 초당 레인 폭의 15% 이동 → 화면 해상도와 무관하게 횡단 "시간"이 동일.
// 이동은 냥코대전쟁식: 소환 후 상대 진영으로 자동 전진(플레이어가 이동 컨트롤 X).
//   → 데미지/HP 낮고 속도만 빠른 "러셔" 같은 아키타입도 성립.
// 디자인 컨셉: 전 유닛 "개미" 테마(냥코가 전부 고양이인 것처럼).
// 자세한 규칙/밸런스 표는 docs/battle-mode.md 참고.
(function () {
  'use strict'

  // ── 희귀도 체계 (일반 < 고급 < 희귀 < 전설) ────────────────────────────────
  // weight = 1회 뽑기 "희귀도(tier)" 선택 확률(합 100). tier를 고른 뒤 그 안에서는 균등 분배(엔빵)
  //   → 같은 희귀도에 항목이 늘면 개별 확률 = weight ÷ 개수 로 자동 분배.
  // anim = 희귀도별 가챠 연출 키.
  // dup = 중복 획득 시 지급 강화 재료(등급별 차등)
  const RARITY = {
    common:   { key: 'common',   name: '일반', weight: 45, color: '#e8ecf2', anim: 'flash', dup: 1 }, // 흰색
    uncommon: { key: 'uncommon', name: '고급', weight: 40, color: '#4ec36a', anim: 'beam',  dup: 2 }, // 녹색
    rare:     { key: 'rare',     name: '희귀', weight: 13, color: '#c98bff', anim: 'swirl', dup: 3 }, // 밝은 보라
    legend:   { key: 'legend',   name: '전설', weight:  2, color: '#ff9d3a', anim: 'burst', dup: 5 }, // 주황
  }

  // ── 가챠 재화(💎 젬) ───────────────────────────────────────────────────────
  const GEM = { countPerGem: 10000, pullCost: 1 } // 카운트 10,000 → 💎1, 1회 뽑기 = 💎1

  // ── 강화 재료(중복 획득 시 지급) ───────────────────────────────────────────
  // 가챠에서 "이미 보유한" 소환체/무기가 또 나오면, 그 대신 강화 재료를 지급.
  // 이 재료로 유닛/무기를 업그레이드(구체 내용은 추후 전달). 이름은 임시.
  const UPGRADE = { name: '강화 부품', emoji: '🔩', perDuplicate: 1 }

  // ── 덱에 넣는 소환체 (cat:'unit') ──────────────────────────────────────────
  // starter:true = 기본 지급(가챠 풀 제외). rarity 키는 RARITY 참고.
  // ── 밸런스 v2 (2026-07-21) ── PvP 기준. 코스트=파워. 순수 딜러 DPS≈코스트×2~3, 탱커/유틸은 대신 실효HP·효과.
  // DPS = dmg×(burst||1)/cd. 실효HP = hp + battleShield.absorb. 사거리(range)·속도는 레인비율.
  const UNITS = {
    ant: {
      name: '개미', cat: 'unit', rarity: 'common', starter: true, cost: 1, hp: 48,
      speed: 0.18, atk: { type: 'melee', dmg: 5, range: 0.02, cd: 0.6 }, kb: 1,
      art: 'ant', size: 1.0, // 기본 근접 물량 (근접 8.3dps). HP↑·넉백↓(근접 이점) — 과효율 완화 58→48
    },
    rifleman: {
      name: '라이플 솔저', cat: 'unit', rarity: 'common', cost: 2, hp: 24,
      speed: 0.13, atk: { type: 'proj', dmg: 4, range: 0.16, cd: 1.3, burst: 3, projSpeed: 1.4 },
      art: 'ant-soldier', size: 1.0, // 3연발×4 = cd1.3당 12 (≈9.2dps). 기본 원거리(사거리 축소 0.22→0.16)
    },
    grenadier: {
      name: '수류탄 솔저', cat: 'unit', rarity: 'common', cost: 3, hp: 28,
      speed: 0.11, atk: { type: 'aoe', dmg: 6, range: 0.15, cd: 1.8, aoeR: 0.09, arc: true },
      art: 'ant-soldier', size: 1.0, // 범위 딜러: 넓은 착탄 범위(0.06→0.09) 대신 단발 데미지 낮춤(9→6)
    },
    shielder: {
      name: '쉴더', cat: 'unit', rarity: 'uncommon', cost: 2, hp: 80,
      speed: 0.10, atk: { type: 'melee', dmg: 1, range: 0.03, cd: 2.0, kbHit: true }, kb: 1, // 방패 밀치기: 저데미지지만 명중 시 앞 적 넉백(라인 저지 탱커)
      battleShield: { absorb: 30, cooldown: 4 }, // 실효HP 110(hp80+쉴드30). 앞면 자동 쉴드(30 흡수·4s 무피격 시 재충전)
      art: 'ant-shield', size: 1.2,
    },
    mechaAnt: {
      name: '메카 개미', cat: 'unit', rarity: 'rare', cost: 7, hp: 85,
      speed: 0.09, atk: { type: 'proj', dmg: 12, range: 0.19, cd: 1.1 }, kb: 1, // 대포 연사 완화(0.5→1.1) = ≈10.9dps. 실효HP 100 (사거리 0.26→0.19)
      battleShield: { absorb: 15, cooldown: 5 },
      art: 'mecha', size: 1.6, // 기존 메카 아트·포물선 대포 재사용
    },
    mechaHuman: {
      name: '메카 인간폼', cat: 'unit', rarity: 'legend', cost: 15, hp: 120,
      speed: 0.12, atk: { type: 'proj', dmg: 15, range: 0.20, cd: 1.05, charge: 1.0 }, kb: 1, // 에너지포 = 1초 충전 후 최대 빔(오버레이 ECANNON_MS 동일). ≈14dps (사거리 0.28→0.20)
      battleShield: { absorb: 16, cooldown: 6 }, // 공중 면역이 이미 큰 생존기 → 실드 20→16(코스트 7→9 상향과 함께 밸런스). 여왕(10) 근처의 결전급으로 재조정

      art: 'human', size: 1.7, flying: true, // 공중 타입(구멍 무시). 기존 건담폼 아트·에너지포 재사용
    },
    human: {
      name: '인간', cat: 'unit', rarity: 'rare', cost: 4, hp: 48,
      speed: 0.12, atk: { type: 'proj', dmg: 10, range: 0.17, cd: 1.0 }, // 10dps 브루저(아도겐, 사거리 0.24→0.17)
      art: 'human', size: 1.3,
    },
    // ── 신규 소환체 (밸런스 v2) ──
    scout: {
      name: '정찰 개미', cat: 'unit', rarity: 'common', cost: 1, hp: 36,
      speed: 0.34, atk: { type: 'melee', dmg: 4, range: 0.02, cd: 0.5 }, kb: 0, siegeMul: 2.5, art: 'scout', size: 0.9,
      // 기지 침투 러셔: 초고속 + 기지 공성 특화(일반 근접 1.7배 대비 2.5배)로 무방비 기지를 빠르게 공략. 대신 저HP·저뎀이라 방어선엔 무력(라인전 X, 순수 러시). 개미=만능 라인 / 정찰=순수 러시로 차별.
    },
    kamikaze: {
      name: '폭탄 개미', cat: 'unit', rarity: 'uncommon', cost: 3, hp: 42,
      speed: 0.24, atk: { type: 'suicide', dmg: 28, aoeR: 0.05, range: 0.03, cd: 0.1 }, suicide: true, kb: 1, art: 'kamikaze', size: 1.1, // 1회성 자폭(근접계=공중 미타격·HP↑·넉백↓)
    },
    medic: {
      name: '의무 개미', cat: 'unit', rarity: 'uncommon', cost: 3, hp: 26,
      speed: 0.10, atk: { type: 'heal', heal: 5, range: 0.10, cd: 1.2 }, support: true, art: 'medic', size: 1.0, // 아군 회복. 서포트: 아군 뒤에서 대기·전진
    },
    drone: {
      name: '말벌 드론', cat: 'unit', rarity: 'uncommon', cost: 3, hp: 30,
      speed: 0.16, atk: { type: 'proj', dmg: 6, range: 0.16, cd: 1.0 }, flying: true, art: 'drone', size: 1.0, // 공중 견제(6dps, 사거리 0.22→0.16)
    },
    freezer: {
      name: '얼음 개미', cat: 'unit', rarity: 'rare', cost: 3, hp: 40,
      speed: 0.11, atk: { type: 'aoe', dmg: 6, range: 0.16, cd: 1.5, aoeR: 0.05, slow: 0.55, slowDur: 2.2 }, art: 'freezer', size: 1.0, // 군집 컨트롤러: 광역 서리(범위 전원 55% 감속) — 뭉친 물량을 통째로 늦추고 빙결(3스택)
    },
    worker: {
      name: '망치 개미', cat: 'unit', rarity: 'uncommon', cost: 3, hp: 62,
      speed: 0.10, atk: { type: 'melee', dmg: 2, range: 0.06, cd: 1.6, aoeR: 0.10, kbHit: true }, kb: 1, art: 'worker', size: 1.1, // 큰 망치 범위 슬램(HP↑·넉백↓): 저뎀이지만 매 공격 범위 내 적 전원 강제 넉백(느린 cd로 밸런스). 물량 저지·시간벌기

    },
    commander: {
      name: '지휘 개미', cat: 'unit', rarity: 'rare', cost: 6, hp: 95,
      speed: 0.10, atk: { type: 'proj', dmg: 5, range: 0.16, cd: 1.2 }, kb: 1, aura: { range: 0.18, atk: 0.2, speed: 0.2 }, art: 'commander', size: 1.4, // 원거리 지휘관: 후방에서 약한 사격(4dps)하며 +20% 오라. 근접이라 앞으로 나가 죽던 것 → 원거리로 뒤에서 버프 유지(오라 범위 0.18로 넓혀 전선까지 커버)
    },
    sniper: {
      name: '저격 개미', cat: 'unit', rarity: 'rare', cost: 5, hp: 18,
      speed: 0.08, atk: { type: 'proj', dmg: 22, range: 0.34, cd: 2.6 }, art: 'sniper', size: 1.0, // 초장거리 유리대포(8.5dps, 사거리 0.42→0.34 · 여전히 최장)
    },
    boss: {
      name: '여왕 개미', cat: 'unit', rarity: 'legend', cost: 12, hp: 200,
      speed: 0.06, atk: { type: 'none' }, support: true, kb: 0,
      // 규칙: 본인 전투력이 중요치 않은 유닛(생산·서포트)은 자체 HP를 낮게 → 보호받아야 하는 후방 유닛. (320→200)
      summon: { unit: 'rifleman', every: 5, cap: 5 }, // 5초마다 라이플 솔저 1마리(직접 공격 X). 최대 5마리 유지(죽으면 재소환)
      art: 'boss', size: 2.0,
    },
    broodTitan: {
      name: '브루드 타이탄', cat: 'unit', rarity: 'legend', cost: 25, hp: 300,
      speed: 0.04, kb: 0,   // 걸어다니는 성벽: 고 HP·초저속·넉백 면역(강제만). (사기 밸런스 → 600→300)
      // 커스텀 이중 공격(sim에서 titan 타입 처리): 근접=스톰프(짓밟기 광역+넉백), 원거리=땅 긁는 레이저(공중 제외)
      // 레이저는 대공 가능(공중 유닛 사격) · 스톰프는 지상 근접
      atk: { type: 'titan', stompDmg: 34, stompR: 0.055, stompCd: 1.5, laserDmg: 11, laserR: 0.22, laserCd: 6.0, laserAir: true },
      summon: { unit: 'mechaAnt', every: 13 },   // 병기 공장: 13초마다 메카 개미(base 스탯) 생산. 오버레이에선 메카개미가 수동 조작이라 이 생산 비활성(app.js)
      art: 'broodTitan', size: 3.9,   // 코스트값 하는 거대 크기(2.6→3.9, ×1.5)
    },
    // ── 공중 축 확장 (대공 픽률 근거) ──
    bomberMoth: {
      name: '폭격 나방', cat: 'unit', rarity: 'rare', cost: 6, hp: 70,
      speed: 0.09, atk: { type: 'aoe', dmg: 14, range: 0.11, cd: 1.7, aoeR: 0.05, strafe: true }, kb: 1,
      flying: true, art: 'bomberMoth', size: 1.5, // strafe: 멈추지 않고 기지로 전진하며 지나가는 길에 폭탄 투하(지상 유닛+기지). 근접이 못 건드림 → 대공으로만 저지(안티-거북이 공성)
    },
    skySwarm: {
      name: '나방 떼', cat: 'unit', rarity: 'uncommon', cost: 5, hp: 24,
      speed: 0.17, atk: { type: 'proj', dmg: 4, range: 0.10, cd: 0.9 }, kb: 0,
      flying: true, swarm: 3, art: 'skySwarm', size: 0.85, // 1회 소환에 저HP 공중 3마리. 광역 대공 강제(공중 물량)
    },
    // ── 지상 스웜 ──
    spiderling: {
      name: '새끼거미 떼', cat: 'unit', rarity: 'uncommon', cost: 3, hp: 16,
      speed: 0.28, atk: { type: 'melee', dmg: 3, range: 0.02, cd: 0.6 }, kb: 0,
      swarm: 4, art: 'spiderling', size: 0.85, // 1회 소환에 저HP 지상 4마리, 고속. 물량 라인 유지. 광역에 약(카운터 존재)
    },
    // ── 대공 전문(요격 미사일) ──
    flakAnt: {
      name: '대공포 개미', cat: 'unit', rarity: 'rare', cost: 4, hp: 70,
      speed: 0.11, atk: { type: 'antiair', dmg: 8, range: 0.20, cd: 1.2, salvo: 4, airOnly: true }, kb: 1,
      art: 'flakAnt', size: 1.1, // 공대공 전용(지상·기지 공격 불가) — 유도 요격 미사일 살보. 사거리 0.17→0.20(메카 인간폼 0.20과 동급, 마주 요격 가능). 공중엔 확실한 카운터, 지상엔 무력(보호 필요)
    },
  }

  // ── 무기 (cat:'weapon') — 가챠로 획득. 오버레이(재미용)에서도 사용. battle:true = 배틀 덱 가능.
  // 획득은 가챠로 전환(카운트 구매 폐지). starter는 기본 지급. rarity는 docs/battle-mode.md 표.
  const WEAPONS = {
    missile:   { name: '미사일', cat: 'weapon', rarity: 'common',   starter: true, battle: true, mana: 0.5, merge: true }, // 쿨 없음(합체 플레이)
    shield:    { name: '쉴드',   cat: 'weapon', rarity: 'common', battle: true, mana: 5, battleCd: 10 },   // 배틀: 기지 방어 돔(HP30·10초). 쿨 10초
    net:       { name: '그물',   cat: 'weapon', rarity: 'uncommon', battle: true, mana: 6 },   // 쿨 없음
    gatling:   { name: '게틀링건', cat: 'weapon', rarity: 'uncommon', battle: true, mana: 7, place: 'base-fixed', aim: 'cursor', battleCd: 10 },   // 구조물 배치. 쿨 10초
    lightning: { name: '낙뢰',   cat: 'weapon', rarity: 'rare', battle: true, mana: 5, battleCd: 4 },   // 배틀: 즉발 컬럼 낙뢰(지상+공중 관통 AoE + 스턴). 마나 5·쿨 4초
    blackhole: { name: '블랙홀', cat: 'weapon', rarity: 'legend', battle: true, mana: 20 }, // 배틀: 마나 20, 1게임 1회(자체 제한). 캐릭터 제외 모든 유닛 흡입
    bomber:    { name: '폭격',   cat: 'weapon', rarity: 'legend', battle: true, mana: 9, battleCd: 60 },   // 배틀: 5발 순차 투하 + 5초 불장판. 쿨 60초(배틀서 워낙 강해 상향)
    // (인간은 유닛으로 이동, 아도겐은 인간의 기본 기능으로 편입 — 무기 목록에서 제외)
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────────
  function unitList() { return Object.keys(UNITS).map((id) => ({ id, ...UNITS[id] })) }
  function weaponList() { return Object.keys(WEAPONS).map((id) => ({ id, ...WEAPONS[id] })) }
  // 가챠 풀 = 기본지급(starter) 제외한 유닛+무기 전체
  function gachaPool() {
    return [...unitList(), ...weaponList()].filter((e) => !e.starter && (RARITY[e.rarity]?.weight || 0) > 0)
  }
  function countToGems(count) { return Math.floor(count / GEM.countPerGem) }

  window.BattleData = { RARITY, GEM, UPGRADE, UNITS, WEAPONS, unitList, weaponList, gachaPool, countToGems }
})()
