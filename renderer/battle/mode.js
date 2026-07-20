// renderer/battle/mode.js — 배틀 모드 컨트롤러 (렌더 + HUD + 솔로 테스트)
// sim.js(전투 코어) 위에 캔버스 렌더 + HUD(마나/덱/기지 HP) + 루프. 자체 오버레이라 하버스/앱 공용.
// 솔로 테스트: 상대를 간단 AI로. (멀티 매치 흐름/릴레이는 이후 확장)
(function () {
  'use strict'
  const D = window.BattleData, S = window.BattleSim
  if (!D || !S) { console.error('[battle/mode] BattleData/BattleSim 필요'); return }
  const G = window.BattleGacha

  let root = null, cv = null, ctx = null, hud = null, raf = null
  let B = null, ai = null, running = false, lastT = 0
  let myDeck = [], sideMe = 0, resultShown = false

  const PAD = 70            // 좌우 기지 여백(px)
  const COL = { 0: '#1D9E75', 1: '#D85A30' }   // 내 편 teal / 상대 coral
  const COL_D = { 0: '#0f6e56', 1: '#993c1d' }

  function ensureStyle() {
    if (document.getElementById('bm-style')) return
    const st = document.createElement('style'); st.id = 'bm-style'
    st.textContent = `
    .bm-root{position:fixed;inset:0;z-index:2147482000;background:rgba(6,8,12,.42);font-family:system-ui,'맑은 고딕',sans-serif;overflow:hidden}
    .bm-cv{position:absolute;inset:0;width:100%;height:100%}
    .bm-top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;z-index:2}
    .bm-pot{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#e8ebf0;font-size:13px;padding:5px 12px;border-radius:999px}
    .bm-exit{background:#242a36;border:1px solid #3a4150;color:#cfd4de;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px}
    .bm-hud{position:absolute;left:0;right:0;bottom:0;padding:10px 14px;background:rgba(8,10,14,.72);border-top:1px solid rgba(255,255,255,.12);z-index:2}
    .bm-mana{display:flex;align-items:center;gap:8px;margin-bottom:9px}
    .bm-mana .seg{flex:1;height:10px;border-radius:2px;background:rgba(255,255,255,.14)}
    .bm-mana .seg.on{background:#4aa3ff}
    .bm-deck{display:flex;gap:6px}
    .bm-card{flex:1;text-align:center;padding:8px 2px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#e8ebf0;font-size:12px;cursor:pointer;user-select:none}
    .bm-card:hover{background:rgba(255,255,255,.13)}
    .bm-card.cant{opacity:.4;cursor:default}
    .bm-card .c{color:#8fd3ff;font-weight:600}
    .bm-result{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:rgba(0,0,0,.55);z-index:3;color:#fff}
    .bm-result .big{font-size:44px;font-weight:800}
    `
    document.head.appendChild(st)
  }

  function toast(msg) {
    ensureStyle()
    const t = document.createElement('div')
    t.style.cssText = 'position:fixed;left:50%;top:20%;transform:translateX(-50%);z-index:2147483600;background:#c0392b;color:#fff;padding:10px 16px;border-radius:10px;font-family:system-ui,"맑은 고딕",sans-serif;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.4)'
    t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200)
  }

  function startSolo(opts) {
    opts = opts || {}
    ensureStyle()
    stop()
    // 덱 완성 조건(소환체 ≥3, 무기 ≥1) 필수
    if (G && G.deckReady && !G.deckReady()) { toast('덱 구성을 완료하세요 — 소환체 3개 이상, 무기 1개 이상'); return }
    let deckUnits = (G && G.getDeck) ? G.getDeck().units.slice() : []
    if (!deckUnits.length) deckUnits = ['ant', 'rifleman', 'grenadier', 'shielder', 'mechaAnt']
    myDeck = deckUnits
    sideMe = 0
    resultShown = false

    B = S.newBattle({})
    const aiDeck = ['ant', 'rifleman', 'grenadier', 'mechaAnt', 'mechaHuman'].filter((id) => D.UNITS[id])
    ai = B.makeAI(1, aiDeck, 1.4)

    buildDom()
    running = true; lastT = performance.now()
    raf = requestAnimationFrame(loop)
  }

  function buildDom() {
    root = document.createElement('div'); root.className = 'bm-root'
    cv = document.createElement('canvas'); cv.className = 'bm-cv'; root.appendChild(cv)
    ctx = cv.getContext('2d')

    const top = document.createElement('div'); top.className = 'bm-top'
    top.innerHTML = `<span class="bm-pot">⚔ 솔로 배틀 테스트</span>`
    const exit = document.createElement('button'); exit.className = 'bm-exit'; exit.textContent = '나가기'
    exit.onclick = () => stop(); top.appendChild(exit); root.appendChild(top)

    hud = document.createElement('div'); hud.className = 'bm-hud'
    const mana = document.createElement('div'); mana.className = 'bm-mana'
    mana.innerHTML = `<span style="font-size:11px;color:#aeb4c0;width:34px">마나</span><div class="segs" style="display:flex;gap:3px;flex:1"></div><span class="mval" style="font-size:11px;color:#cfd4de;width:44px;text-align:right"></span>`
    const segs = mana.querySelector('.segs')
    for (let i = 0; i < 10; i++) { const s = document.createElement('div'); s.className = 'seg'; segs.appendChild(s) }
    hud.appendChild(mana)
    const deck = document.createElement('div'); deck.className = 'bm-deck'
    myDeck.forEach((id) => {
      const u = D.UNITS[id]; if (!u) return
      const c = document.createElement('div'); c.className = 'bm-card'; c.dataset.id = id
      c.innerHTML = `${u.name}<br><span class="c">${u.cost}</span>`
      c.onclick = () => { if (B.spawn(sideMe, id)) syncHud() }
      deck.appendChild(c)
    })
    hud.appendChild(deck)
    root.appendChild(hud)
    document.body.appendChild(root)
    resize()
    window.addEventListener('resize', resize)
    if (window.__bgModalChanged) window.__bgModalChanged()
  }

  function resize() {
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.floor(cv.clientWidth * dpr); cv.height = Math.floor(cv.clientHeight * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf), raf = null
    window.removeEventListener('resize', resize)
    if (root) { root.remove(); root = null }
    if (window.__bgModalChanged) window.__bgModalChanged()
  }

  function loop(now) {
    if (!running) return
    let dt = (now - lastT) / 1000; lastT = now
    if (dt > 0.1) dt = 0.1                    // 큰 프레임 튐 방지
    if (ai) ai(dt); B.step(dt)
    B.drainEvents()
    render(); syncHud()
    if (B.state.winner != null && !resultShown) showResult()
    raf = requestAnimationFrame(loop)
  }

  // L(0..1) → 화면 X. 내가 side0이면 L=0이 내 기지(왼쪽).
  function laneX(L) {
    const W = cv.clientWidth
    const l = sideMe === 0 ? L : 1 - L
    return PAD + l * (W - 2 * PAD)
  }

  function render() {
    const W = cv.clientWidth, H = cv.clientHeight
    ctx.clearRect(0, 0, W, H)
    const laneY = H - 150
    // 레인
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(PAD, laneY); ctx.lineTo(W - PAD, laneY); ctx.stroke()
    // 기지 (내 쪽 = 화면 좌, 상대 = 우)
    drawBase(laneX(0), laneY, 0)
    drawBase(laneX(1), laneY, 1)
    // 유닛
    for (const u of B.state.units) {
      const x = laneX(u.L), r = 10 + (u.stats && u.stats.hp ? Math.min(10, u.stats.hp / 12) : 4)
      const y = u.stats && u.stats.flying ? laneY - 34 : laneY - r
      ctx.fillStyle = COL[u.side]
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'
      ctx.fillText(u.type === 'mechaHuman' ? '🦾' : u.type === 'mechaAnt' ? '🤖' : '🐜', x, y + 3)
      // hp bar
      const w = r * 2, hpf = u.hp / u.maxHp
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - r, y - r - 7, w, 3)
      ctx.fillStyle = hpf > 0.4 ? '#7ecb7e' : '#e24b4a'; ctx.fillRect(x - r, y - r - 7, w * hpf, 3)
    }
  }

  function drawBase(x, laneY, side) {
    const w = 34, h = 66
    ctx.fillStyle = COL_D[side]; ctx.strokeStyle = COL[side]; ctx.lineWidth = 2
    ctx.fillRect(x - w / 2, laneY - h, w, h); ctx.strokeRect(x - w / 2, laneY - h, w, h)
    // HP bar
    const hp = B.state.baseHp[side], max = B.state.baseHpMax, f = Math.max(0, hp / max)
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x - w / 2, laneY - h - 12, w, 6)
    ctx.fillStyle = side === sideMe ? '#1D9E75' : '#D85A30'; ctx.fillRect(x - w / 2, laneY - h - 12, w * f, 6)
    ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'
    ctx.fillText(Math.ceil(hp), x, laneY - h - 16)
  }

  function syncHud() {
    if (!hud) return
    const mana = B.state.mana[sideMe]
    const segs = hud.querySelectorAll('.bm-mana .seg')
    segs.forEach((s, i) => s.classList.toggle('on', i < Math.floor(mana)))
    const buff = B.state.manaBuff ? (B.state.manaBuff[sideMe] || 0) : 0
    const mv = hud.querySelector('.mval'); if (mv) mv.textContent = `${mana.toFixed(1)}/${B.state.cfg.manaCap}` + (buff > 0 ? ` ⚡+${buff.toFixed(1)}/s` : '')
    hud.querySelectorAll('.bm-card').forEach((c) => {
      const u = D.UNITS[c.dataset.id]; c.classList.toggle('cant', !u || mana < (u.cost || 1))
    })
  }

  function showResult() {
    resultShown = true
    const win = B.state.winner === sideMe
    const r = document.createElement('div'); r.className = 'bm-result'
    r.innerHTML = `<div class="big" style="color:${win ? '#7ecb7e' : '#e24b4a'}">${win ? '승리!' : '패배'}</div><div style="font-size:14px;color:#cfd4de">3초 후 종료</div>`
    root.appendChild(r)
    setTimeout(() => stop(), 3000)
  }

  // 디버그(하버스/프리뷰가 rAF를 안 돌릴 때 수동 진행 검증용)
  function _debugFrame(dt) { if (!B) return; if (ai) ai(dt || 0.1); B.step(dt || 0.1); B.drainEvents(); render(); syncHud(); if (B.state.winner != null && !resultShown) showResult() }
  function _state() { return B && B.state }

  window.BattleMode = { startSolo, stop, isRunning: () => running, _debugFrame, _state }
})()
