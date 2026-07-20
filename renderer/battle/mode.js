// renderer/battle/mode.js — 배틀 모드 컨트롤러 (렌더 + HUD + 솔로 테스트)
// sim.js(전투 코어) 위에 렌더: 작업표시줄 레인 + 양끝 고양이 기지 + BattleSprites 유닛 + 캐릭터 위 HUD(드래그).
// 예시 이미지 방향. 솔로 테스트(상대=간단 AI). 멀티 매치흐름/릴레이는 이후.
(function () {
  'use strict'
  const D = window.BattleData, S = window.BattleSim
  if (!D || !S) { console.error('[battle/mode] BattleData/BattleSim 필요'); return }
  const G = window.BattleGacha

  let root = null, cv = null, ctx = null, hud = null, raf = null
  let B = null, ai = null, running = false, lastT = 0
  let myDeck = [], sideMe = 0, resultShown = false
  let attackAt = {}, deadSprites = []   // uid→마지막 공격시각 / 사망 연출

  const PAD = 80
  const COL = { 0: '#1D9E75', 1: '#D85A30' }, COLD = { 0: '#0f6e56', 1: '#993c1d' }

  function ensureStyle() {
    if (document.getElementById('bm-style')) return
    const st = document.createElement('style'); st.id = 'bm-style'
    st.textContent = `
    .bm-root{position:fixed;inset:0;z-index:2147482000;background:rgba(6,8,12,.42);font-family:system-ui,'맑은 고딕',sans-serif;overflow:hidden}
    .bm-cv{position:absolute;inset:0;width:100%;height:100%}
    .bm-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;z-index:2}
    .bm-pot{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#e8ebf0;font-size:13px;padding:5px 12px;border-radius:999px}
    .bm-exit{background:#242a36;border:1px solid #3a4150;color:#cfd4de;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px}
    .bm-hud{position:absolute;z-index:3;background:rgba(8,10,14,.82);border:1px solid #2b2f39;border-radius:12px;padding:8px 10px;width:300px}
    .bm-grip{font-size:11px;color:#7f8797;cursor:move;margin-bottom:6px;user-select:none}
    .bm-mana{display:flex;align-items:center;gap:7px;margin-bottom:8px}
    .bm-mana .seg{flex:1;height:9px;border-radius:2px;background:rgba(255,255,255,.14)}
    .bm-mana .seg.on{background:#4aa3ff}
    .bm-mana .mval{font-size:11px;color:#cfd4de;white-space:nowrap}
    .bm-deck{display:flex;gap:5px}
    .bm-card{flex:1;text-align:center;padding:6px 2px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#e8ebf0;font-size:11px;cursor:pointer;user-select:none}
    .bm-card:hover{background:rgba(255,255,255,.14)}
    .bm-card.cant{opacity:.4;cursor:default}
    .bm-card .c{color:#8fd3ff;font-weight:600}
    .bm-result{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:rgba(0,0,0,.55);z-index:4;color:#fff}
    .bm-result .big{font-size:46px;font-weight:800}
    `
    document.head.appendChild(st)
  }

  function toast(msg) {
    ensureStyle()
    const t = document.createElement('div')
    t.style.cssText = 'position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:2147483600;background:#c0392b;color:#fff;padding:10px 16px;border-radius:10px;font-family:system-ui,"맑은 고딕",sans-serif;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.4)'
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200)
  }

  function startSolo() {
    ensureStyle(); stop()
    if (G && G.deckReady && !G.deckReady()) { toast('덱 구성을 완료하세요 — 소환체 3개 이상, 무기 1개 이상'); return }
    myDeck = (G && G.getDeck) ? G.getDeck().units.slice() : []
    if (!myDeck.length) myDeck = ['ant', 'rifleman', 'grenadier', 'shielder', 'mechaAnt']
    sideMe = 0; resultShown = false; attackAt = {}; deadSprites = []
    B = S.newBattle({})
    ai = B.makeAI(1, ['ant', 'rifleman', 'grenadier', 'mechaAnt', 'mechaHuman'].filter((id) => D.UNITS[id]), 1.4)
    buildDom()
    running = true; lastT = performance.now(); raf = requestAnimationFrame(loop)
  }

  function buildDom() {
    root = document.createElement('div'); root.className = 'bm-root'
    cv = document.createElement('canvas'); cv.className = 'bm-cv'; root.appendChild(cv); ctx = cv.getContext('2d')
    const top = document.createElement('div'); top.className = 'bm-top'
    top.innerHTML = `<span class="bm-pot">⚔ 솔로 배틀 테스트</span>`
    const exit = document.createElement('button'); exit.className = 'bm-exit'; exit.textContent = '나가기'; exit.onclick = () => stop(); top.appendChild(exit); root.appendChild(top)

    hud = document.createElement('div'); hud.className = 'bm-hud'
    const grip = document.createElement('div'); grip.className = 'bm-grip'; grip.textContent = '⠿ 마나 · 덱 (드래그 이동)'
    const mana = document.createElement('div'); mana.className = 'bm-mana'
    mana.innerHTML = `<div class="segs" style="display:flex;gap:3px;flex:1"></div><span class="mval"></span>`
    for (let i = 0; i < 10; i++) { const s = document.createElement('div'); s.className = 'seg'; mana.querySelector('.segs').appendChild(s) }
    const deck = document.createElement('div'); deck.className = 'bm-deck'
    myDeck.forEach((id) => { const u = D.UNITS[id]; if (!u) return; const c = document.createElement('div'); c.className = 'bm-card'; c.dataset.id = id; c.innerHTML = `${u.name}<br><span class="c">${u.cost}</span>`; c.onclick = () => { if (B.spawn(sideMe, id)) syncHud() }; deck.appendChild(c) })
    hud.append(grip, mana, deck); root.appendChild(hud)
    makeDraggable(hud, grip)

    document.body.appendChild(root); resize(); window.addEventListener('resize', resize)
    // HUD 기본 위치: 내 고양이(좌) 위
    const pos = JSON.parse(localStorage.getItem('bm.hudpos') || 'null')
    if (pos) { hud.style.left = pos.x + 'px'; hud.style.top = pos.y + 'px' }
    else { hud.style.left = (PAD - 20) + 'px'; hud.style.top = Math.max(20, cv.clientHeight - 96 - 200) + 'px' }
    if (window.__bgModalChanged) window.__bgModalChanged()
  }

  function makeDraggable(el, handle) {
    let dx = 0, dy = 0, on = false
    handle.addEventListener('mousedown', (e) => { on = true; dx = e.clientX - el.offsetLeft; dy = e.clientY - el.offsetTop; e.preventDefault() })
    window.addEventListener('mousemove', (e) => { if (!on) return; el.style.left = (e.clientX - dx) + 'px'; el.style.top = (e.clientY - dy) + 'px' })
    window.addEventListener('mouseup', () => { if (!on) return; on = false; localStorage.setItem('bm.hudpos', JSON.stringify({ x: el.offsetLeft, y: el.offsetTop })) })
  }

  function resize() { if (!cv) return; const dpr = window.devicePixelRatio || 1; cv.width = Math.floor(cv.clientWidth * dpr); cv.height = Math.floor(cv.clientHeight * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0) }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf), raf = null; window.removeEventListener('resize', resize); if (root) { root.remove(); root = null }; if (window.__bgModalChanged) window.__bgModalChanged() }

  function loop(now) {
    if (!running) return
    let dt = (now - lastT) / 1000; lastT = now; if (dt > 0.1) dt = 0.1
    if (ai) ai(dt); B.step(dt)
    for (const e of B.drainEvents()) {
      if (e.type === 'hit') attackAt[e.by] = now
      else if (e.type === 'die') deadSprites.push({ id: e.unit, L: e.L, side: e.side, born: now })
    }
    for (let i = deadSprites.length - 1; i >= 0; i--) if (now - deadSprites[i].born > 900) deadSprites.splice(i, 1)
    render(now); syncHud()
    if (B.state.winner != null && !resultShown) showResult()
    raf = requestAnimationFrame(loop)
  }

  function laneX(L) { const W = cv.clientWidth; const l = sideMe === 0 ? L : 1 - L; return PAD + l * (W - 2 * PAD) }

  function render(now) {
    const W = cv.clientWidth, H = cv.clientHeight, laneY = H - 96
    ctx.clearRect(0, 0, W, H)
    // 레인(작업표시줄 느낌)
    ctx.fillStyle = 'rgba(10,13,18,.55)'; ctx.fillRect(0, laneY, W, H - laneY)
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, laneY); ctx.lineTo(W, laneY); ctx.stroke()
    // 기지 고양이
    drawBaseCat(laneX(0), laneY, 0)
    drawBaseCat(laneX(1), laneY, 1)
    // 유닛
    for (const u of B.state.units) {
      const x = laneX(u.L), def = D.UNITS[u.type] || {}
      const facing = (u.side === sideMe) ? 1 : -1
      const atk = attackAt[u.uid] && now - attackAt[u.uid] < 380
      const y = def.flying ? laneY - 30 : laneY
      const sc = 2.0 * (def.size || 1)
      if (window.BattleSprites) window.BattleSprites.draw(ctx, u.type, { x, y, scale: sc, facing, state: atk ? 'attack' : 'walk', t: (u.uid * 0.37 + now / 1000), flash: atk })
      // 쉴드 표시(자동 쉴드 남아있으면 돔 힌트)
      if (u.shHp > 0) { ctx.strokeStyle = 'rgba(120,200,255,.7)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y - 20 * sc / 2, 16 * (def.size || 1), Math.PI, 0); ctx.stroke() }
      // hp bar
      const w = 26 * (def.size || 1), f = u.hp / u.maxHp
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - w / 2, y - 46 * (def.size || 1), w, 4)
      ctx.fillStyle = f > 0.4 ? '#7ecb7e' : '#e24b4a'; ctx.fillRect(x - w / 2, y - 46 * (def.size || 1), w * f, 4)
    }
    // 사망 연출
    for (const d of deadSprites) { const p = Math.min(1, (now - d.born) / 900); if (window.BattleSprites) window.BattleSprites.draw(ctx, d.id, { x: laneX(d.L), y: laneY, scale: 2.0, facing: d.side === sideMe ? 1 : -1, state: 'death', t: 0, deathT: p }) }
  }

  function drawBaseCat(x, laneY, side) {
    const s = 1.4, y = laneY
    // 책상
    ctx.fillStyle = '#3a3a44'; ctx.fillRect(x - 26, y - 6, 52, 10)
    // 고양이 머리
    ctx.fillStyle = side === sideMe ? '#f0ead8' : '#f0ddd0'
    ctx.beginPath(); ctx.arc(x, y - 30, 18 * s / 1.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.moveTo(x - 14, y - 40); ctx.lineTo(x - 8, y - 54); ctx.lineTo(x - 2, y - 40); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(x + 14, y - 40); ctx.lineTo(x + 8, y - 54); ctx.lineTo(x + 2, y - 40); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(x - 6, y - 30, 2.4, 0, Math.PI * 2); ctx.arc(x + 6, y - 30, 2.4, 0, Math.PI * 2); ctx.fill()
    // 기지 HP 바
    const hp = B.state.baseHp[side], max = B.state.baseHpMax, f = Math.max(0, hp / max)
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - 24, y - 64, 48, 7)
    ctx.fillStyle = COL[side]; ctx.fillRect(x - 24, y - 64, 48 * f, 7)
    ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText((side === sideMe ? '내 기지 ' : '상대 ') + Math.ceil(hp), x, y - 68)
  }

  function syncHud() {
    if (!hud) return
    const mana = B.state.mana[sideMe], buff = B.state.manaBuff ? (B.state.manaBuff[sideMe] || 0) : 0
    hud.querySelectorAll('.bm-mana .seg').forEach((s, i) => s.classList.toggle('on', i < Math.floor(mana)))
    const mv = hud.querySelector('.mval'); if (mv) mv.textContent = `${mana.toFixed(1)}/${B.state.cfg.manaCap}` + (buff > 0 ? ` ⚡+${buff.toFixed(1)}` : '')
    hud.querySelectorAll('.bm-card').forEach((c) => { const u = D.UNITS[c.dataset.id]; c.classList.toggle('cant', !u || mana < (u.cost || 1)) })
  }

  function showResult() {
    resultShown = true
    const win = B.state.winner === sideMe
    const r = document.createElement('div'); r.className = 'bm-result'
    r.innerHTML = `<div class="big" style="color:${win ? '#7ecb7e' : '#e24b4a'}">${win ? '승리!' : '패배'}</div><div style="font-size:14px;color:#cfd4de">3초 후 종료</div>`
    root.appendChild(r); setTimeout(() => stop(), 3000)
  }

  function _debugFrame(dt) { if (!B) return; if (ai) ai(dt || 0.1); B.step(dt || 0.1); for (const e of B.drainEvents()) { if (e.type === 'hit') attackAt[e.by] = performance.now(); else if (e.type === 'die') deadSprites.push({ id: e.unit, L: e.L, side: e.side, born: performance.now() }) } render(performance.now()); syncHud(); if (B.state.winner != null && !resultShown) showResult() }
  function _state() { return B && B.state }
  window.BattleMode = { startSolo, stop, isRunning: () => running, _debugFrame, _state }
})()
