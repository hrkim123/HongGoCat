// renderer/battle/art.js — 소환체/무기 아이콘 아트 (SVG, 절차적 변형)
// 전 유닛 "개미" 베이스 + 유닛별 액세서리로 조금씩 다르게. 컬렉션/가챠 UI용.
//  window.BattleArt.icon(entryOrId, sizePx) -> SVG 문자열
(function () {
  'use strict'

  // 공통 개미 몸통(측면, 오른쪽 바라봄). c=몸 색, headSquare=메카용 각진 머리
  function ant(c, headSquare) {
    const legs = `<path d="M20 29 L14 40 M24 30 L21 41 M27 30 L30 40" stroke="#3a2817" stroke-width="1.6" stroke-linecap="round" fill="none"/>`
    const abdomen = `<ellipse cx="13" cy="29" rx="9" ry="7" fill="${c}"/>`
    const thorax = `<ellipse cx="24" cy="29" rx="5.5" ry="5.5" fill="${c}"/>`
    const head = headSquare
      ? `<rect x="30" y="21" width="8.5" height="8.5" rx="1.6" fill="${c}"/>`
      : `<circle cx="34" cy="25" r="5" fill="${c}"/>`
    const antennae = `<path d="M35 22 L41 14 M32 21 L35 13" stroke="#3a2817" stroke-width="1.3" stroke-linecap="round" fill="none"/>`
    const eye = `<circle cx="35.5" cy="24" r="1.2" fill="#fff"/>`
    return legs + abdomen + thorax + head + antennae + eye
  }

  const ART = {
    // ── 유닛 (개미 컨셉) ──
    ant: () => ant('#7a5230'),
    rifleman: () => ant('#6f5a34') +
      `<rect x="19" y="33.5" width="24" height="3.2" rx="1" fill="#2f2f2f"/>` +
      `<rect x="18" y="31" width="6" height="4" rx="1" fill="#4a3524"/>` +
      `<rect x="41" y="34" width="4" height="2" rx="1" fill="#555"/>`,
    grenadier: () => ant('#5f6b3a') +
      `<rect x="39.4" y="28.6" width="3.2" height="3" rx="0.6" fill="#555"/>` +
      `<circle cx="41" cy="34.5" r="4.4" fill="#3f6b2a" stroke="#294d1a" stroke-width="1"/>` +
      `<path d="M39 33 h4 M41 32 v4" stroke="#294d1a" stroke-width="0.8"/>`,
    shielder: () => ant('#6a4a2c') +
      `<rect x="37" y="16" width="7.5" height="26" rx="3.6" fill="#3a72c0" stroke="#8fb8f0" stroke-width="1.2"/>` +
      `<line x1="40.7" y1="20" x2="40.7" y2="38" stroke="#bcd6f7" stroke-width="1"/>`,
    mechaAnt: () => `<rect x="24" y="16.5" width="17" height="4" rx="1.2" fill="#5a6070"/>` +
      `<line x1="34" y1="20" x2="34" y2="11" stroke="#5a6070" stroke-width="1.6"/>` +
      `<circle cx="34" cy="10" r="1.6" fill="#e24b4a"/>` +
      ant('#8a90a0', true) +
      `<line x1="8" y1="27" x2="18" y2="27" stroke="#5a6070" stroke-width="0.8"/>` +
      `<circle cx="35.6" cy="24.5" r="1.3" fill="#e24b4a"/>`,
    // 메카 인간폼: 공중형 — 이족 로봇 + 발밑 부스터 화염(살짝 부양)
    mechaHuman: () =>
      `<g fill="#8a90a0" stroke="#5a6070" stroke-width="1">` +
      `<rect x="19" y="8" width="10" height="7" rx="2.2"/>` +
      `<rect x="17" y="15" width="14" height="13" rx="2.4"/>` +
      `<rect x="12.5" y="16" width="4.5" height="10" rx="2"/>` +
      `<rect x="31" y="16" width="4.5" height="10" rx="2"/>` +
      `<rect x="19" y="28" width="4.2" height="8" rx="1.6"/>` +
      `<rect x="25" y="28" width="4.2" height="8" rx="1.6"/>` +
      `</g>` +
      `<rect x="20.5" y="10.5" width="7" height="2.4" rx="1" fill="#7fd3ff"/>` +
      `<path d="M19 36 Q21.1 45 23.2 36 Z" fill="#ff9d3a"/>` +
      `<path d="M25 36 Q27.1 45 29.2 36 Z" fill="#ff9d3a"/>` +
      `<path d="M20.2 36 Q21.1 41.5 22 36 Z" fill="#ffe08a"/>` +
      `<path d="M26.2 36 Q27.1 41.5 28 36 Z" fill="#ffe08a"/>`,
    // 인간(스틱 파이터) — 배틀: 아도겐 원거리
    human: () =>
      `<circle cx="24" cy="13" r="4.6" fill="#e0b088"/>` +
      `<rect x="20.4" y="17.5" width="7.2" height="13" rx="3" fill="#4a6a9a"/>` +
      `<line x1="21" y1="20" x2="14" y2="27" stroke="#4a6a9a" stroke-width="3.2" stroke-linecap="round"/>` +
      `<line x1="27" y1="20" x2="34" y2="25" stroke="#4a6a9a" stroke-width="3.2" stroke-linecap="round"/>` +
      `<circle cx="36" cy="24.5" r="3.2" fill="rgba(120,200,255,.85)"/>` +
      `<line x1="22" y1="30" x2="19" y2="40" stroke="#33456a" stroke-width="3.2" stroke-linecap="round"/>` +
      `<line x1="26" y1="30" x2="29" y2="40" stroke="#33456a" stroke-width="3.2" stroke-linecap="round"/>`,

    // ── 무기 ──
    missile: () =>
      `<path d="M14 20 L36 20 Q45 24 36 28 L14 28 Z" fill="#d0d4da"/>` +
      `<path d="M36 20 Q45 24 36 28 Z" fill="#e24b4a"/>` +
      `<rect x="13" y="19.2" width="4" height="9.6" fill="#b04030"/>` +
      `<path d="M14 20 L7 15 L14 23 Z" fill="#c53a2f"/>` +
      `<path d="M14 28 L7 33 L14 25 Z" fill="#c53a2f"/>` +
      `<path d="M13 22 L3 24 L13 26 Z" fill="#ff9d3a"/>`,
    gatling: () =>
      `<g fill="#6a7080" stroke="#454b59" stroke-width="0.8">` +
      `<rect x="23" y="19" width="7" height="11" rx="2"/>` +
      `<rect x="29" y="20.5" width="16" height="2.4" rx="1"/>` +
      `<rect x="29" y="23.6" width="16" height="2.4" rx="1"/>` +
      `<rect x="29" y="26.7" width="16" height="2.4" rx="1"/>` +
      `<rect x="20" y="30" width="12" height="3.4" rx="1.2"/>` +
      `</g>` +
      `<circle cx="26.5" cy="24.5" r="3.2" fill="#8a90a0" stroke="#454b59" stroke-width="0.8"/>`,
    // 폭격: 하늘에서 떨어지는 폭탄 2발 + 낙하 궤적 + 바닥 착탄 화염
    bomber: () =>
      `<path d="M13 6 L15.5 15 M22 4 L20 13 M31 10 L31.5 21" stroke="rgba(255,180,90,.55)" stroke-width="1.5" stroke-linecap="round" fill="none"/>` +
      `<g stroke="#3a3d24" stroke-width="0.8">` +
      `<ellipse cx="18" cy="29" rx="5" ry="7" fill="#6b7043"/>` +
      `<rect x="15.6" y="18" width="4.8" height="7" rx="1.5" fill="#565b34"/>` +
      `<path d="M16 17 L12.5 12.5 L16 19 Z" fill="#4a4e2c"/><path d="M20 17 L23.5 12.5 L20 19 Z" fill="#4a4e2c"/>` +
      `<ellipse cx="32" cy="35" rx="4" ry="5.6" fill="#6b7043"/>` +
      `<rect x="30" y="26.5" width="4" height="5.6" rx="1.2" fill="#565b34"/>` +
      `</g>` +
      `<path d="M15 44 Q18 36 21 44 Q24 37 27 44 Q30 38 33 44 Z" fill="#ff7d3a"/>` +
      `<path d="M18 44 Q20 39 22 44 Q25 40 28 44 Z" fill="#ffd27a"/>`,
  }

  const EMOJI = { ant: '🐜', rifleman: '🐜', grenadier: '🐜', shielder: '🛡', mechaAnt: '🤖', mechaHuman: '🦾',
    missile: '🚀', gatling: '🔫', shield: '🛡', net: '🕸️', human: '🕺', lightning: '⚡', adogen: '🔵', blackhole: '🕳',
    scout: '🐜', kamikaze: '💣', medic: '🩹', drone: '🐝', freezer: '❄️', worker: '🐜', commander: '🚩', sniper: '🎯', boss: '👑', bomber: '💥', broodTitan: '💠' }

  // 실제 배틀 스프라이트가 있는 유닛은 그 리소스를 렌더해 아이콘으로(이족보행 등 실제 모습 일치)
  function spriteImg(id, px) {
    try {
      const cv = document.createElement('canvas'); cv.width = px; cv.height = px
      const g = cv.getContext('2d')
      window.BattleSprites.draw(g, id, { x: px / 2, y: px * 0.9, scale: px / 50, state: 'idle', t: 0, facing: 1 })
      return `<img src="${cv.toDataURL()}" width="${px}" height="${px}" style="display:inline-block;vertical-align:middle">`
    } catch (_) { return null }
  }
  function icon(e, size) {
    const id = typeof e === 'string' ? e : (e && e.id)
    const px = size || 30
    if (window.BattleSprites && window.BattleSprites.has && window.BattleSprites.has(id)) { const im = spriteImg(id, px); if (im) return im }
    const inner = ART[id] ? ART[id]() : null
    if (inner) return `<svg viewBox="0 0 48 48" width="${px}" height="${px}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle">${inner}</svg>`
    return `<span style="font-size:${Math.round(px * 0.9)}px;line-height:1">${EMOJI[id] || '🐜'}</span>`
  }

  window.BattleArt = { icon }
})()
