// renderer/battle/units.js — 배틀 모드 유닛/무기 데이터 (Phase 1)
// 하드코딩 대신 "데이터"로 정의한다. 유닛 추가 = 여기 한 줄 추가.
// 속도(speed)/사거리(range)/범위(aoeR)/투사체속도(projSpeed)는 전부 "레인비율" 단위(0~1).
//   예) speed:0.15 = 초당 레인 폭의 15% 이동 → 화면 해상도와 무관하게 횡단 "시간"이 동일.
// 자세한 규칙은 docs/battle-mode.md 참고.
(function () {
  'use strict'

  // ── 덱에 넣는 소환체 (cat:'unit', 가챠로 획득) ─────────────────────────────
  const UNITS = {
    ant: {
      name: '개미', cat: 'unit', rarity: 'basic', owned: true, cost: 1, hp: 20,
      speed: 0.18, atk: { type: 'melee', dmg: 5, range: 0.02, cd: 0.6 },
      art: 'ant', size: 1.0,
    },
    shielder: {
      name: '쉴더', cat: 'unit', rarity: 'R', cost: 2, hp: 40,
      speed: 0.10, atk: { type: 'none' }, shield: { absorb: 10 }, // 10뎀 막고 파괴, 공격 없음
      art: 'shielder', size: 1.2,
    },
    rifleman: {
      name: '라이플 솔저', cat: 'unit', rarity: 'R', cost: 2, hp: 22,
      speed: 0.13, atk: { type: 'proj', dmg: 4, range: 0.22, cd: 1.2, burst: 3, projSpeed: 1.4 }, // 3연발
      art: 'soldier', size: 1.0,
    },
    grenadier: {
      name: '수류탄 솔저', cat: 'unit', rarity: 'SR', cost: 3, hp: 26,
      speed: 0.11, atk: { type: 'aoe', dmg: 8, range: 0.20, cd: 1.8, aoeR: 0.06, arc: true }, // 포물선 범위
      art: 'soldier', size: 1.0,
    },
    mechaAnt: {
      name: '메카 개미', cat: 'unit', rarity: 'SR', cost: 5, hp: 80,
      speed: 0.09, atk: { type: 'proj', dmg: 12, range: 0.30, cd: 0.5 },
      art: 'mecha', size: 1.6, // 기존 메카 그림 재사용, 개미 대포
    },
    mechaHuman: {
      name: '메카 인간폼', cat: 'unit', rarity: 'SSR', cost: 7, hp: 120,
      speed: 0.12, atk: { type: 'proj', dmg: 15, range: 0.28, cd: 0.7 },
      art: 'human', size: 1.7, // 기존 인간폼 그림 재사용
    },
  }

  // ── 덱 불필요 · 카운트로 구매한 유저면 누구나 · 마나 코스트로 사용 ──────────
  const WEAPONS = {
    gatling: { name: '게틀링건', cat: 'weapon', mana: 7, place: 'base-fixed', aim: 'cursor' }, // 책상 위 고정, 커서 방향
    missile: { name: '미사일', cat: 'weapon', mana: 0.5, merge: true }, // 지금 로직/합체 유지
  }

  // ── 가챠 레어도 가중치 (Phase 2에서 사용) ──────────────────────────────────
  // 합이 100이 되도록. basic(개미)은 기본 지급이라 풀에서 제외 후보.
  const RARITY_WEIGHT = { basic: 0, R: 60, SR: 30, SSR: 10 }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────────
  function unitList() { return Object.keys(UNITS).map((id) => ({ id, ...UNITS[id] })) }
  function weaponList() { return Object.keys(WEAPONS).map((id) => ({ id, ...WEAPONS[id] })) }
  // 가챠 풀 = 레어도 가중치 > 0 인 유닛들
  function gachaPool() { return unitList().filter((u) => (RARITY_WEIGHT[u.rarity] || 0) > 0) }

  window.BattleData = { UNITS, WEAPONS, RARITY_WEIGHT, unitList, weaponList, gachaPool }
})()
