// renderer/battle/sprites.js — 소환체 절차적 캔버스 스프라이트 (오버레이·배틀 공용)
// 상태별 애니메이션: idle / walk / attack / hit / death. 개미 베이스 + 유닛별 특징.
// BattleSprites.draw(ctx, id, o) — o: { x, y(발밑), scale, facing(1|-1), state, t(초), flash, deathT(0~1) }
(function () {
  'use strict'
  const TAU = Math.PI * 2
  function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fill() }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill() }
  function star(ctx, x, y, r) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) } ctx.closePath(); ctx.fill() }

  // ── 솔저 개미 (라이플): 군모 + 라이플 + 이족보행 ──
  function drawSoldier(ctx, o, opt) {
    opt = opt || {}
    const st = o.state || 'idle', ph = o.t || 0
    const body = opt.body || '#6f5a34', bodyD = opt.bodyD || '#4a3a1f'
    const helmet = opt.helmet || '#48583a', helmetD = opt.helmetD || '#33402a'
    const gun = '#2b2b2b'
    const walk = st === 'walk', atk = st === 'attack', hit = st === 'hit'
    const bob = walk ? Math.abs(Math.sin(ph * 7)) * 1.6 : Math.sin(ph * 2.2) * 0.6
    const swing = walk ? Math.sin(ph * 7) * 5 : 0
    const recoil = atk ? -2.2 * (0.5 + 0.5 * Math.sin(ph * 30)) : 0

    ctx.save()
    ctx.translate(recoil, -bob)

    // 다리 (이족보행)
    ctx.strokeStyle = bodyD; ctx.lineWidth = 2.4; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-1, -13); ctx.lineTo(-1 - swing, -0.5); ctx.stroke()      // 뒷다리
    ctx.beginPath(); ctx.moveTo(3, -13); ctx.lineTo(3 + swing, -0.5); ctx.stroke()        // 앞다리
    // 발
    ctx.strokeStyle = bodyD; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(-1 - swing, -0.5); ctx.lineTo(2 - swing, -0.5); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(3 + swing, -0.5); ctx.lineTo(6 + swing, -0.5); ctx.stroke()

    // 몸통 (개미 마디)
    ctx.fillStyle = body
    ell(ctx, -3, -19, 7.5, 9, -0.3)   // 배(abdomen)
    ell(ctx, 3, -26, 5, 5.5)          // 가슴(thorax)
    ctx.fillStyle = bodyD; ell(ctx, -3, -19, 7.5, 9, -0.3) // 살짝 음영 재사용 방지용 — skip
    ctx.fillStyle = body; ell(ctx, -3, -19, 7, 8.4, -0.3)

    // 팔 + 라이플 (앞)
    ctx.strokeStyle = body; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(3, -25); ctx.lineTo(11, -22); ctx.stroke()
    ctx.save(); ctx.translate(11, -23)
    ctx.fillStyle = gun
    ctx.fillRect(-5, -1.6, 7, 3.2)     // 개머리판
    ctx.fillRect(2, -1.1, 15, 2.2)     // 총열
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, 0.5, 3.5, 4)   // 탄창
    ctx.restore()

    // 머리 + 눈
    ctx.fillStyle = body; circ(ctx, 6, -33, 5)
    ctx.fillStyle = '#fff'; circ(ctx, 8.2, -33.5, 1.4)
    ctx.fillStyle = '#222'; circ(ctx, 8.8, -33.5, 0.7)
    // 더듬이
    ctx.strokeStyle = bodyD; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(8, -36); ctx.lineTo(13, -41); ctx.stroke()
    // 군모 (돔 + 챙)
    ctx.fillStyle = helmet; ctx.beginPath(); ctx.arc(6, -35, 6.4, Math.PI, 0); ctx.closePath(); ctx.fill()
    ctx.fillRect(-0.5, -35, 14, 2.4)
    ctx.fillStyle = helmetD; ctx.fillRect(-0.5, -33.4, 14, 1)

    // 총구 화염 (공격)
    if (atk && (o.flash || Math.floor(ph * 22) % 4 === 0)) { ctx.fillStyle = '#ffe08a'; star(ctx, 28, -22, 4.5); ctx.fillStyle = '#ff9d3a'; star(ctx, 28, -22, 2.4) }

    ctx.restore()

    // 피격 플래시(빨강 오버레이)
    if (hit) { ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#ff4d4d'; ell(ctx, 0, -22 - bob, 12, 16); ctx.restore() }
  }

  // ── 기본 개미 (미구현 유닛 폴백) ──
  function drawAntBasic(ctx, o) {
    const ph = o.t || 0, sw = o.state === 'walk' ? Math.sin(ph * 8) * 3 : 0
    const body = '#7a5230', bodyD = '#4a3018'
    ctx.strokeStyle = bodyD; ctx.lineWidth = 1.6; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(-6 - sw, 0); ctx.moveTo(0, -6); ctx.lineTo(-1, 0); ctx.moveTo(4, -6); ctx.lineTo(6 + sw, 0); ctx.stroke()
    ctx.fillStyle = body; ell(ctx, -6, -8, 6, 5); ell(ctx, 0, -8, 4, 4); circ(ctx, 6, -9, 3.5)
    ctx.strokeStyle = bodyD; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(8, -11); ctx.lineTo(12, -15); ctx.stroke()
    ctx.fillStyle = '#fff'; circ(ctx, 7.5, -9.5, 1)
    if (o.state === 'hit') { ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = '#ff4d4d'; ell(ctx, -1, -8, 9, 7); ctx.restore() }
  }

  const DRAW = {
    rifleman: (ctx, o) => drawSoldier(ctx, o, { body: '#6f5a34', helmet: '#48583a' }),
    // 이후 종별 추가: grenadier, shielder, medic, kamikaze, drone, freezer, sniper, commander, boss ...
    _default: drawAntBasic,
  }

  function draw(ctx, id, o) {
    ctx.save()
    ctx.translate(o.x || 0, o.y || 0)
    const f = o.facing === -1 ? -1 : 1, s = o.scale || 1
    ctx.scale(f * s, s)
    if (o.state === 'death') { const p = Math.min(1, o.deathT || 0); ctx.globalAlpha = Math.max(0, 1 - p); ctx.rotate(p * 1.3); ctx.translate(0, p * 4) }
    ;(DRAW[id] || DRAW._default)(ctx, o)
    ctx.restore()
  }

  window.BattleSprites = { draw, has: (id) => !!DRAW[id] }
})()
