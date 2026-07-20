// renderer/battle/sprites.js — 소환체 절차적 캔버스 스프라이트 (오버레이·배틀 공용)
// 상태별 애니메이션: idle / walk / attack / hit / death. 개미 베이스 + 유닛별 특징.
// BattleSprites.draw(ctx, id, o) — o: { x, y(발밑), scale, facing(1|-1), state, t(초), flash, deathT(0~1) }
(function () {
  'use strict'
  const TAU = Math.PI * 2
  function ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, TAU); c.fill() }
  function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill() }
  function star(c, x, y, r) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) } c.closePath(); c.fill() }
  function rpath(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath() }

  // ── 공용 개미 이족보행 하체+몸통 (translate 적용, caller가 restore) ──
  function antLower(c, o, opt) {
    const st = o.state || 'idle', ph = o.t || 0
    const body = opt.body, bodyD = opt.bodyD
    const walk = st === 'walk', atk = st === 'attack'
    const bob = walk ? Math.abs(Math.sin(ph * 7)) * 1.6 : Math.sin(ph * 2.2) * 0.6
    const swing = walk ? Math.sin(ph * 7) * 5 : 0
    const recoil = (atk && opt.recoil) ? -2.2 * (0.5 + 0.5 * Math.sin(ph * 30)) : 0
    c.save(); c.translate(recoil, -bob)
    c.strokeStyle = bodyD; c.lineWidth = 2.4; c.lineCap = 'round'
    c.beginPath(); c.moveTo(-1, -13); c.lineTo(-1 - swing, -0.5); c.stroke()
    c.beginPath(); c.moveTo(3, -13); c.lineTo(3 + swing, -0.5); c.stroke()
    c.lineWidth = 3
    c.beginPath(); c.moveTo(-1 - swing, -0.5); c.lineTo(2 - swing, -0.5); c.stroke()
    c.beginPath(); c.moveTo(3 + swing, -0.5); c.lineTo(6 + swing, -0.5); c.stroke()
    c.fillStyle = body; ell(c, -3, -19, 7, 8.4, -0.3); ell(c, 3, -26, 5, 5.5)
    return { ph, walk, atk, bob, swing }
  }
  // 머리+눈+더듬이 (+옵션: helmet/goggles/medcap) — antLower와 같은 프레임에서 호출
  function antUpper(c, opt) {
    const body = opt.body, bodyD = opt.bodyD
    c.fillStyle = body; circ(c, 6, -33, 5)
    c.fillStyle = '#fff'; circ(c, 8.2, -33.5, 1.4); c.fillStyle = '#222'; circ(c, 8.8, -33.5, 0.7)
    c.strokeStyle = bodyD; c.lineWidth = 1; c.beginPath(); c.moveTo(8, -36); c.lineTo(13, -41); c.stroke()
    if (opt.helmet) { c.fillStyle = opt.helmet; c.beginPath(); c.arc(6, -35, 6.4, Math.PI, 0); c.closePath(); c.fill(); c.fillRect(-0.5, -35, 14, 2.4); c.fillStyle = opt.helmetD || '#333'; c.fillRect(-0.5, -33.4, 14, 1) }
    if (opt.goggles) { c.fillStyle = '#2b2b2b'; c.fillRect(3, -34.8, 7.5, 2.6); c.fillStyle = '#7fd3ff'; c.fillRect(6.6, -34.4, 2.6, 1.8) }
    if (opt.medcap) { c.fillStyle = '#fff'; c.beginPath(); c.arc(6, -35, 6, Math.PI, 0); c.closePath(); c.fill(); c.fillRect(-0.5, -35, 13, 2); c.fillStyle = '#e24b4a'; c.fillRect(4.6, -36.6, 3, 1); c.fillRect(5.6, -37.6, 1, 3) }
  }

  // ── 유닛별 ──
  function drawRifleman(c, o) {
    const f = antLower(c, o, { body: '#6f5a34', bodyD: '#4a3a1f', recoil: true })
    c.strokeStyle = '#6f5a34'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(3, -25); c.lineTo(11, -22); c.stroke()
    c.save(); c.translate(11, -23); c.fillStyle = '#2b2b2b'; c.fillRect(-5, -1.6, 7, 3.2); c.fillRect(2, -1.1, 15, 2.2); c.fillStyle = '#3a3a3a'; c.fillRect(0, 0.5, 3.5, 4); c.restore()
    antUpper(c, { body: '#6f5a34', bodyD: '#4a3a1f', helmet: '#48583a', helmetD: '#33402a' })
    if (f.atk && (o.flash || Math.floor(f.ph * 22) % 4 === 0)) { c.fillStyle = '#ffe08a'; star(c, 28, -22, 4.5); c.fillStyle = '#ff9d3a'; star(c, 28, -22, 2.4) }
    c.restore()
  }
  function drawGrenadier(c, o) {
    const f = antLower(c, o, { body: '#5f6b3a', bodyD: '#3a4522' })
    const wind = f.atk ? Math.max(0, Math.sin(f.ph * 9)) : 0   // 던지기 와인드업
    const hx = 9 - wind * 3, hy = -28 - wind * 6
    c.strokeStyle = '#5f6b3a'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(3, -25); c.lineTo(hx, hy); c.stroke()
    c.fillStyle = '#3f6b2a'; circ(c, hx + 1, hy - 1, 3.2); c.fillStyle = '#2a4a1a'; c.fillRect(hx - 0.5, hy - 5.5, 3, 2)
    antUpper(c, { body: '#5f6b3a', bodyD: '#3a4522', helmet: '#3a4a2a', helmetD: '#28381e' })
    if (f.atk && wind < 0.2 && Math.floor(f.ph * 4) % 2 === 0) { c.fillStyle = '#3f6b2a'; circ(c, 22 + (f.ph % 0.5) * 24, -34, 2.6) }  // 던져진 수류탄
    c.restore()
  }
  function drawShielder(c, o) {
    antLower(c, o, { body: '#6a4a2c', bodyD: '#402a15' })
    antUpper(c, { body: '#6a4a2c', bodyD: '#402a15' })
    // 전방 대형 방패(육각 힌트)
    c.save(); c.translate(11, -19)
    c.fillStyle = '#3a72c0'; rpath(c, -3, -15, 8, 30, 4); c.fill(); c.strokeStyle = '#8fb8f0'; c.lineWidth = 1.6; c.stroke()
    c.strokeStyle = '#bcd6f7'; c.lineWidth = 1; c.beginPath(); c.moveTo(1, -12); c.lineTo(1, 12); c.stroke()
    c.restore()
    c.restore()
  }
  function drawScout(c, o) {
    antLower(c, o, { body: '#9a7238', bodyD: '#66491f' })
    antUpper(c, { body: '#9a7238', bodyD: '#66491f', goggles: true })
    c.restore()
  }
  function drawKamikaze(c, o) {
    antLower(c, o, { body: '#7a3a2a', bodyD: '#4a1f14' })
    // 등에 폭탄 + 도화선 스파크
    c.fillStyle = '#222'; circ(c, -6, -24, 5); c.fillStyle = '#444'; circ(c, -7.5, -25.5, 1.5)
    c.strokeStyle = '#888'; c.lineWidth = 1; c.beginPath(); c.moveTo(-6, -29); c.lineTo(-8, -33); c.stroke()
    const spark = Math.floor((o.t || 0) * 12) % 2 === 0
    c.fillStyle = spark ? '#ffe08a' : '#ff7d3a'; circ(c, -8, -33.5, 1.8)
    antUpper(c, { body: '#7a3a2a', bodyD: '#4a1f14' })
    c.restore()
  }
  function drawMedic(c, o) {
    antLower(c, o, { body: '#e3e7ee', bodyD: '#9aa0ab' })
    // 옆구리 구급팩(적십자)
    c.fillStyle = '#fff'; rpath(c, -10, -23, 6, 7, 1.4); c.fill(); c.strokeStyle = '#e24b4a'; c.lineWidth = 0.9; c.stroke()
    c.fillStyle = '#e24b4a'; c.fillRect(-7.5, -21, 1, 3); c.fillRect(-8.5, -20, 3, 1)
    antUpper(c, { body: '#e3e7ee', bodyD: '#9aa0ab', medcap: true })
    if (o.state === 'attack') { const yy = -40 - (((o.t || 0) * 22) % 14); c.fillStyle = 'rgba(120,220,140,0.95)'; c.fillRect(4, yy, 1.8, 5.4); c.fillRect(2.2, yy + 1.8, 5.4, 1.8) }  // 회복 십자
    c.restore()
  }
  // 기본 개미(사족 크롤러) — 'ant' + 미구현 폴백
  function drawAntBasic(c, o) {
    const ph = o.t || 0, sw = o.state === 'walk' ? Math.sin(ph * 8) * 3 : 0
    const body = '#7a5230', bodyD = '#4a3018'
    c.strokeStyle = bodyD; c.lineWidth = 1.6; c.lineCap = 'round'
    c.beginPath(); c.moveTo(-4, -6); c.lineTo(-6 - sw, 0); c.moveTo(0, -6); c.lineTo(-1, 0); c.moveTo(4, -6); c.lineTo(6 + sw, 0); c.stroke()
    c.fillStyle = body; ell(c, -6, -8, 6, 5); ell(c, 0, -8, 4, 4); circ(c, 6, -9, 3.5)
    c.strokeStyle = bodyD; c.lineWidth = 0.9; c.beginPath(); c.moveTo(8, -11); c.lineTo(12, -15); c.stroke()
    c.fillStyle = '#fff'; circ(c, 7.5, -9.5, 1)
  }

  const DRAW = {
    rifleman: drawRifleman, grenadier: drawGrenadier, shielder: drawShielder,
    scout: drawScout, kamikaze: drawKamikaze, medic: drawMedic,
    ant: drawAntBasic,
    // TODO: drone, freezer, sniper, commander, worker, boss (다음 배치)
    _default: drawAntBasic,
  }

  function draw(ctx, id, o) {
    ctx.save()
    ctx.translate(o.x || 0, o.y || 0)
    const f = o.facing === -1 ? -1 : 1, s = o.scale || 1
    ctx.scale(f * s, s)
    if (o.state === 'death') { const p = Math.min(1, o.deathT || 0); ctx.globalAlpha = Math.max(0, 1 - p); ctx.rotate(p * 1.3); ctx.translate(0, p * 4) }
    ;(DRAW[id] || DRAW._default)(ctx, o)
    if (o.state === 'hit') { ctx.globalAlpha = 0.4; ctx.fillStyle = '#ff4d4d'; ell(ctx, 0, -20, 12, 17) }
    ctx.restore()
  }

  window.BattleSprites = { draw, has: (id) => !!DRAW[id] && DRAW[id] !== DRAW._default }
})()
