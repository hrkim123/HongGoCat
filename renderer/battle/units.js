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
  const RARITY = {
    common:   { key: 'common',   name: '일반', weight: 45, color: '#b8c0cc', anim: 'flash'   },
    uncommon: { key: 'uncommon', name: '고급', weight: 40, color: '#4aa3ff', anim: 'beam'    },
    rare:     { key: 'rare',     name: '희귀', weight: 13, color: '#b06bff', anim: 'swirl'   },
    legend:   { key: 'legend',   name: '전설', weight:  2, color: '#ffcf3a', anim: 'burst'   },
  }

  // ── 가챠 재화(💎 젬) ───────────────────────────────────────────────────────
  const GEM = { countPerGem: 10000, pullCost: 1 } // 카운트 10,000 → 💎1, 1회 뽑기 = 💎1

  // ── 강화 재료(중복 획득 시 지급) ───────────────────────────────────────────
  // 가챠에서 "이미 보유한" 소환체/무기가 또 나오면, 그 대신 강화 재료를 지급.
  // 이 재료로 유닛/무기를 업그레이드(구체 내용은 추후 전달). 이름은 임시.
  const UPGRADE = { name: '강화 부품', emoji: '🔩', perDuplicate: 1 }

  // ── 덱에 넣는 소환체 (cat:'unit') ──────────────────────────────────────────
  // starter:true = 기본 지급(가챠 풀 제외). rarity 키는 RARITY 참고.
  const UNITS = {
    ant: {
      name: '개미', cat: 'unit', rarity: 'common', starter: true, cost: 1, hp: 20,
      speed: 0.18, atk: { type: 'melee', dmg: 5, range: 0.02, cd: 0.6 },
      art: 'ant', size: 1.0, // 기본 근접 물량
    },
    rifleman: {
      name: '라이플 솔저', cat: 'unit', rarity: 'common', cost: 2, hp: 22,
      speed: 0.13, atk: { type: 'proj', dmg: 4, range: 0.22, cd: 1.2, burst: 3, projSpeed: 1.4 },
      art: 'ant-soldier', size: 1.0, // 개미 병사(총). 기본 원거리
    },
    grenadier: {
      name: '수류탄 솔저', cat: 'unit', rarity: 'common', cost: 3, hp: 26,
      speed: 0.11, atk: { type: 'aoe', dmg: 8, range: 0.20, cd: 1.8, aoeR: 0.06, arc: true },
      art: 'ant-soldier', size: 1.0, // 개미 병사(수류탄). 범위 딜
    },
    shielder: {
      name: '쉴더', cat: 'unit', rarity: 'uncommon', cost: 2, hp: 40,
      speed: 0.10, atk: { type: 'none' }, shield: { absorb: 10 },
      art: 'ant-shield', size: 1.2, // 방패 든 개미. 탱커(공격 없음)
    },
    mechaAnt: {
      name: '메카 개미', cat: 'unit', rarity: 'rare', cost: 5, hp: 80,
      speed: 0.09, atk: { type: 'proj', dmg: 12, range: 0.30, cd: 0.5 },
      art: 'mecha', size: 1.6, // 기존 메카 그림 재사용, 개미 대포
    },
    mechaHuman: {
      name: '메카 인간폼', cat: 'unit', rarity: 'legend', cost: 7, hp: 120,
      speed: 0.12, atk: { type: 'proj', dmg: 15, range: 0.28, cd: 0.7 },
      art: 'human', size: 1.7, flying: true, // 공중 타입: 구멍 무시. 발밑 부스터 상시 분사 + 바닥에서 살짝 뜬 채 전진
    },
  }

  // ── 무기 (cat:'weapon') — 덱 불필요, 배틀 중 마나 코스트로 사용 ─────────────
  // 기존 무기 체계 재활용. 획득은 가챠로 전환 예정(카운트 구매 폐지). starter는 기본 지급.
  const WEAPONS = {
    missile: { name: '미사일', cat: 'weapon', rarity: 'common', starter: true, mana: 0.5, merge: true }, // 합체 유지
    gatling: { name: '게틀링건', cat: 'weapon', rarity: 'uncommon', mana: 7, place: 'base-fixed', aim: 'cursor' },
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
