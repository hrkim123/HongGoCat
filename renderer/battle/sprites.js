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
  function drawDrone(c, o) {   // 말벌 드론(공중) — 다리 X. 둥근 몸통 + 파닥이는 작은 날개 + 침. 이동 시 빠르게 파닥.
    const ph = o.t || 0, cy = -12 + Math.sin(ph * 3) * 1.5   // 몸통 중심(상하 부유)
    const fq = o.state === 'idle' ? 16 : 36, beat = Math.sin(ph * fq)   // 위·아래 양방향 파닥(자연스럽게)
    c.save(); c.strokeStyle = '#bfe6ff'; c.lineWidth = 0.6
    for (const [off, a] of [[0.07, 0.32], [-0.07, 0.62]]) {   // 뒤(흐림)·앞(밝음) 두 겹 = 빠른 날갯짓 잔상
      c.globalAlpha = a; c.fillStyle = '#dff4ff'
      c.save(); c.translate(2, cy - 5); c.rotate(0.2 + beat * 0.75 + off)
      c.beginPath(); c.ellipse(-7, 0, 9.5, 3.3, 0, 0, TAU); c.fill(); c.stroke(); c.restore()
    }
    c.restore()
    c.fillStyle = '#2a2114'; c.beginPath(); c.moveTo(-12, cy + 2); c.lineTo(-18, cy + 4); c.lineTo(-12, cy - 1); c.closePath(); c.fill()   // 침(꼬리)
    c.fillStyle = '#e0a72a'; ell(c, -6, cy + 1, 9, 7, 0)   // 둥근 복부
    c.strokeStyle = '#2a2114'; c.lineWidth = 1.5; for (const dx of [-9, -6, -3]) { c.beginPath(); c.moveTo(dx, cy - 4); c.lineTo(dx, cy + 6); c.stroke() }   // 줄무늬
    c.fillStyle = '#c78f1e'; circ(c, 3, cy, 4.5)   // 흉부
    c.fillStyle = '#3a2a14'; circ(c, 9, cy - 1, 3.6)   // 머리
    c.fillStyle = '#fff'; circ(c, 10.6, cy - 1.5, 1.2); c.fillStyle = '#111'; circ(c, 11.1, cy - 1.5, 0.6)   // 눈
    c.strokeStyle = '#2a2114'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(10, cy - 4); c.lineTo(13, cy - 8); c.stroke()   // 더듬이
    if (o.state === 'attack' && (o.flash || Math.floor(ph * 20) % 3 === 0)) { c.fillStyle = '#ffe08a'; circ(c, 12, cy - 1, 2) }
  }
  function drawFreezer(c, o) {   // 얼음 개미 — 하늘색 몸 + 등 얼음결정 + 서리 총
    const f = antLower(c, o, { body: '#8fd0e8', bodyD: '#4a8aa8', recoil: true })
    c.fillStyle = '#dff4ff'; c.strokeStyle = '#a8e0ff'; c.lineWidth = 0.8
    for (const dx of [-9, -6, -3]) { c.beginPath(); c.moveTo(dx, -22); c.lineTo(dx - 2, -30); c.lineTo(dx + 2, -30); c.closePath(); c.fill(); c.stroke() }   // 얼음 결정
    c.strokeStyle = '#5a9ab8'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(3, -25); c.lineTo(11, -22); c.stroke()   // 서리 총
    c.fillStyle = '#bfefff'; circ(c, 13, -22, 2.6)
    antUpper(c, { body: '#8fd0e8', bodyD: '#4a8aa8' })
    if (f.atk && (o.flash || Math.floor((o.t || 0) * 20) % 3 === 0)) { c.fillStyle = '#eafcff'; star(c, 16, -22, 3.4) }
    c.restore()
  }
  function drawWorker(c, o) {   // 망치 개미 — 큰 망치를 들고 내려쳐 넉백. 노란 안전모.
    const f = antLower(c, o, { body: '#a8792e', bodyD: '#6a4a18' })
    // 망치: 공격 시 위로 들었다(와인드업) 내려침
    const swing = f.atk ? Math.sin((f.ph || 0) * 9) : 0        // -1..1
    const up = f.atk ? Math.max(0, swing) : 0.3                // 들어올림
    const hx = 10, hy = -26 - up * 10                          // 손 위치
    c.strokeStyle = '#6a4a18'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(3, -25); c.lineTo(hx, hy); c.stroke()   // 팔
    c.strokeStyle = '#7a5a2a'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + 3, hy - 12); c.stroke()   // 자루
    c.fillStyle = '#8a8f9a'; c.strokeStyle = '#4a4e5a'; c.lineWidth = 1; rpath(c, hx - 3, hy - 18, 12, 8, 2); c.fill(); c.stroke()   // 망치 머리
    c.fillStyle = '#c9cfdb'; c.fillRect(hx - 2, hy - 16, 3, 4)   // 하이라이트
    antUpper(c, { body: '#a8792e', bodyD: '#6a4a18', helmet: '#f2c53a', helmetD: '#b8901e' })
    if (f.atk && swing < -0.4) { c.fillStyle = 'rgba(255,235,150,0.9)'; star(c, 20, -20, 4) }   // 내려친 순간 충격
    c.restore()
  }
  function drawCommander(c, o) {   // 지휘 개미 — 붉은 깃발 + 견장 + 지휘모
    antLower(c, o, { body: '#5a4030', bodyD: '#33241a' })
    c.fillStyle = '#e6c34a'; c.fillRect(-2, -27, 5, 2)   // 견장
    c.strokeStyle = '#8a6a3a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(2, -24); c.lineTo(6, -42); c.stroke()   // 깃대
    const fl = Math.sin((o.t || 0) * 5) * 2
    c.fillStyle = '#d0402f'; c.beginPath(); c.moveTo(6, -42); c.quadraticCurveTo(13 + fl, -40, 18, -38); c.quadraticCurveTo(13, -36, 6, -35); c.closePath(); c.fill()
    c.fillStyle = '#f2d23a'; star(c, 11, -38.5, 1.8)
    antUpper(c, { body: '#5a4030', bodyD: '#33241a', helmet: '#3a4a6a', helmetD: '#28324a' })
    c.restore()
  }
  function drawSniper(c, o) {   // 저격 개미 — 긴 저격총 + 스코프 글린트
    const f = antLower(c, o, { body: '#4a5a3a', bodyD: '#2a3420', recoil: true })
    c.strokeStyle = '#2b2b2b'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(1, -25); c.lineTo(24, -21); c.stroke()   // 긴 총열
    c.fillStyle = '#1a1a1a'; c.fillRect(22, -22.6, 4, 2.8)   // 총구
    c.fillStyle = '#3a3a3a'; rpath(c, 6, -29.5, 8, 3, 1); c.fill()   // 스코프
    const glint = Math.floor((o.t || 0) * 6) % 4 === 0
    c.fillStyle = glint ? '#bfe8ff' : '#6a8a9a'; circ(c, 13, -28, 1.4)
    antUpper(c, { body: '#4a5a3a', bodyD: '#2a3420', goggles: true })
    if (f.atk && (o.flash || Math.floor(f.ph * 18) % 5 === 0)) { c.fillStyle = '#fff'; star(c, 28, -21, 5); c.fillStyle = '#ffd86b'; star(c, 28, -21, 2.6) }
    c.restore()
  }
  function drawBoss(c, o) {   // 여왕 개미 — 왕관 + 거대 복부 + 위엄
    antLower(c, o, { body: '#6a2a4a', bodyD: '#3a1428' })
    c.fillStyle = '#7a3050'; ell(c, -8, -19, 13, 11, -0.2)   // 거대 복부
    c.strokeStyle = '#c86a90'; c.lineWidth = 1
    for (const yy of [-23, -19, -15]) { c.beginPath(); c.moveTo(-18, yy); c.lineTo(2, yy); c.stroke() }
    antUpper(c, { body: '#6a2a4a', bodyD: '#3a1428' })
    c.fillStyle = '#f2d23a'; c.beginPath(); c.moveTo(1.5, -38.5); c.lineTo(3, -44); c.lineTo(5, -40); c.lineTo(6.5, -45); c.lineTo(8, -40); c.lineTo(10, -44); c.lineTo(11, -38.5); c.closePath(); c.fill()   // 왕관
    c.fillStyle = '#e24b6a'; circ(c, 6, -41, 1.1)
    c.restore()
  }
  function drawBomberMoth(c, o) {   // 폭격 나방(공중) — 넓은 나방 날개 + 아래 매단 폭탄. 지상/기지 폭격기. 드론(말벌)과 실루엣 구분.
    const ph = o.t || 0, cy = -14 + Math.sin(ph * 2.4) * 1.8
    const atk = o.state === 'attack'
    const wingUp = 0.5 + Math.sin(ph * (o.state === 'idle' ? 5 : 12)) * 0.5
    function wing(sgn, bright) {
      c.save(); c.translate(2, cy); c.rotate(sgn * (0.5 + wingUp * 0.6))
      c.globalAlpha = bright ? 0.92 : 0.6
      c.fillStyle = '#b3a4d0'; c.strokeStyle = '#6e5f96'; c.lineWidth = 1.4
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-22, sgn * 4, -26, sgn * 17); c.quadraticCurveTo(-11, sgn * 16, 0, 0); c.closePath(); c.fill(); c.stroke()
      c.fillStyle = '#3a2f52'; circ(c, -16, sgn * 11, 3.2); c.fillStyle = '#e6d9ff'; circ(c, -16, sgn * 11, 1.3)
      c.restore()
    }
    wing(-1, false); wing(1, false)   // 뒤 날개(흐리게)
    c.globalAlpha = 1
    c.fillStyle = '#6a577e'; ell(c, -6, cy, 8, 5)   // 복부(솜털)
    c.strokeStyle = '#47385c'; c.lineWidth = 0.9; for (const dx of [-9, -6, -3]) { c.beginPath(); c.moveTo(dx, cy - 4); c.lineTo(dx, cy + 4); c.stroke() }
    c.fillStyle = '#7a6790'; ell(c, 2, cy, 5, 5)    // 흉부
    c.fillStyle = '#5a4a6e'; circ(c, 8, cy - 1, 3.5)   // 머리
    c.fillStyle = '#fff'; circ(c, 9.6, cy - 1.4, 1.2); c.fillStyle = '#111'; circ(c, 10.1, cy - 1.4, 0.6)
    c.strokeStyle = '#3a2f52'; c.lineWidth = 1; for (const k of [0, 1]) { c.beginPath(); c.moveTo(9, cy - 4); c.quadraticCurveTo(13, cy - 11, 12 + k * 3, cy - 14); c.stroke() }   // 깃털 더듬이
    wing(-1, true); wing(1, true)   // 앞 날개(밝게)
    c.globalAlpha = 1
    c.strokeStyle = '#47385c'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-3, cy + 4); c.lineTo(-3, cy + 8); c.stroke()
    c.fillStyle = '#2a2b32'; circ(c, -3, cy + 11, 4.6)   // 폭탄
    c.fillStyle = '#f5c21a'; c.beginPath(); c.moveTo(-7, cy + 13); c.lineTo(-9.5, cy + 16); c.lineTo(-5, cy + 14); c.closePath(); c.fill()   // 꼬리날개
    const spark = Math.floor(ph * 12) % 2 === 0
    c.fillStyle = spark ? '#ffe08a' : '#ff7d3a'; circ(c, -3, cy + 6, 1.4)   // 도화선 스파크
    if (atk && (o.flash || Math.floor(ph * 16) % 3 === 0)) { c.fillStyle = '#ffd27a'; circ(c, -3, cy + 13, 3) }
  }
  function drawSkySwarm(c, o) {   // 나방 떼(공중) — 작은 나방 1마리(스웜=여러 마리 소환). 빠른 파닥.
    const ph = o.t || 0, cy = -11 + Math.sin(ph * 3) * 1.4
    const flap = Math.abs(Math.sin(ph * 22))
    c.globalAlpha = 0.82; c.fillStyle = '#d6def0'; c.strokeStyle = '#9aa6c0'; c.lineWidth = 0.8
    for (const sgn of [-1, 1]) { c.save(); c.translate(1, cy); c.rotate(sgn * (0.4 + flap * 0.7)); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-9, sgn * 2, -12, sgn * 8); c.quadraticCurveTo(-4, sgn * 7, 0, 0); c.closePath(); c.fill(); c.stroke(); c.restore() }
    c.globalAlpha = 1
    c.fillStyle = '#8b93a8'; ell(c, -3, cy, 4.5, 3)   // 몸통
    c.fillStyle = '#5e6678'; circ(c, 3, cy - 0.5, 2.4)   // 머리
    c.fillStyle = '#fff'; circ(c, 4.2, cy - 1, 0.9); c.fillStyle = '#111'; circ(c, 4.5, cy - 1, 0.45)
    c.strokeStyle = '#5e6678'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(4, cy - 3); c.lineTo(6, cy - 6); c.stroke()
    if (o.state === 'attack' && (o.flash || Math.floor(ph * 18) % 3 === 0)) { c.fillStyle = '#cfe0ff'; circ(c, 6, cy - 0.5, 1.5) }
  }
  function drawSpiderling(c, o) {   // 새끼거미(지상 스웜 1마리) — 둥근 청록 몸 + 8다리 + 큰 눈. 개미와 실루엣 확실히 구분.
    const ph = o.t || 0, walk = o.state === 'walk'
    const body = '#2ea88a', bodyD = '#0d3b31'
    const bob = walk ? Math.abs(Math.sin(ph * 15)) * 1.6 : Math.sin(ph * 2) * 0.5   // 종종걸음 바운스
    const cy = -8 - bob
    c.strokeStyle = bodyD; c.lineWidth = 1.6; c.lineCap = 'round'
    for (const s2 of [-1, 1]) for (let li = 0; li < 4; li++) {   // 4다리 × 좌우, 다리별 위상차 스키터
      const lift = walk ? Math.max(0, Math.sin(ph * 15 + li * 1.5 + (s2 > 0 ? Math.PI : 0))) : 0
      const kneeX = s2 * (5 + li * 2), kneeY = cy - 2 + li * 1.4
      const footX = s2 * (9 + li * 3) - s2 * lift * 3, footY = -lift * 3.5   // 들어올려 앞으로 딛음
      c.beginPath(); c.moveTo(0, cy + 1); c.lineTo(kneeX, kneeY); c.lineTo(footX, footY); c.stroke()
    }
    c.fillStyle = body; ell(c, -4, cy, 7, 6)   // 배
    c.globalAlpha = 0.6; c.fillStyle = '#8ef0d0'; ell(c, -5, cy + 2, 4, 3); c.globalAlpha = 1
    c.fillStyle = '#33b795'; circ(c, 5, cy - 1, 4.5)   // 머리(cephalothorax)
    c.fillStyle = '#fff'; circ(c, 7, cy - 3, 1.9); c.fillStyle = '#12312a'; circ(c, 7.5, cy - 3, 0.95)
    c.fillStyle = '#fff'; circ(c, 5.6, cy + 1, 1.3); c.fillStyle = '#12312a'; circ(c, 6, cy + 1, 0.65)
    c.fillStyle = '#12312a'; circ(c, 3, cy - 3, 0.7); circ(c, 2.4, cy + 1.5, 0.6)   // 작은 눈
    c.strokeStyle = bodyD; c.lineWidth = 1.1; c.beginPath(); c.moveTo(8, cy + 2); c.lineTo(10, cy + 5); c.stroke()   // 송곳니
  }
  function drawFlakAnt(c, o) {   // 대공포 개미 — 4족(6다리) 크롤러 개미 + 등에 다련장 미사일포(MLRS). 위로만 사격.
    const ph = o.t || 0, walk = o.state === 'walk', atk = o.state === 'attack'
    const body = '#6f7d93', bodyD = '#3f4756'
    const bob = walk ? Math.abs(Math.sin(ph * 10)) * 1.2 : 0, cy = -10 - bob
    // 다리 3쌍(크롤러) — 위상차 걸음
    c.strokeStyle = bodyD; c.lineWidth = 2.4; c.lineCap = 'round'
    const legX = [-9, -2, 5]
    for (let i = 0; i < 3; i++) { const sw = walk ? Math.sin(ph * 10 + i * 2.1) * 3.2 : 0
      c.beginPath(); c.moveTo(legX[i], cy + 4); c.lineTo(legX[i] - 5 + sw, 0); c.stroke() }
    // 몸통: 복부 + 흉부 + 머리
    c.fillStyle = body; ell(c, -9, cy, 10, 7); ell(c, 0, cy, 6.5, 6)
    c.fillStyle = '#8996ac'; circ(c, 9, cy - 1, 4.6)   // 머리
    c.strokeStyle = bodyD; c.lineWidth = 1; c.beginPath(); c.moveTo(11, cy - 4); c.lineTo(16, cy - 9); c.moveTo(12, cy - 2); c.lineTo(17, cy - 6); c.stroke()   // 더듬이
    c.fillStyle = '#fff'; circ(c, 11, cy - 1, 1.5); c.fillStyle = '#12212e'; circ(c, 11.7, cy - 1, 0.75)   // 눈
    // 다련장 미사일포(등 위 박스 + 발사관 6개, 위-앞으로 기울임)
    c.save(); c.translate(-6, cy - 7); c.rotate(-0.42)
    c.fillStyle = '#4a5568'; c.strokeStyle = '#20242c'; c.lineWidth = 1.5; rpath(c, -9, -9, 18, 13, 2.5); c.fill(); c.stroke()   // 발사관 박스
    c.fillStyle = '#20242c'; for (let r = 0; r < 2; r++) for (let t = 0; t < 3; t++) circ(c, -5.5 + t * 5.5, -5.5 + r * 6, 2)   // 발사관 6공
    c.fillStyle = '#f5c21a'; c.fillRect(-9, 4, 18, 2.6); c.fillStyle = '#20242c'; for (let k = 0; k < 4; k++) c.fillRect(-7 + k * 4.6, 4, 1.6, 2.6)   // 경고 줄무늬
    if (atk && (o.flash || Math.floor(ph * 20) % 3 === 0)) { c.fillStyle = '#ffe08a'; for (let t = 0; t < 3; t++) { star(c, -5.5 + t * 5.5, -11, 2.6) } }   // 발사관 섬광
    c.restore()
  }
  // 기본 개미(사족 크롤러) — 'ant' 고유 디자인 + 미구현 _default 폴백. (각 유닛 디자인은 서로 달라도 됨)
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
    drone: drawDrone, freezer: drawFreezer, worker: drawWorker,
    commander: drawCommander, sniper: drawSniper, boss: drawBoss,
    bomberMoth: drawBomberMoth, skySwarm: drawSkySwarm,
    spiderling: drawSpiderling, flakAnt: drawFlakAnt,
    ant: drawAntBasic,
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
