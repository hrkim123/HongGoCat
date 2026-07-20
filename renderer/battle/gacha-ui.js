// renderer/battle/gacha-ui.js — 가챠 팝업 + 컬렉션 UI + 희귀도별 연출
// window.BattleData + window.BattleGacha 에 의존. DOM/스타일 자체 주입.
//  - openGacha(): 소환 팝업(1회 뽑기, 희귀도별 연출, 중복 시 강화 부품)
//  - openCollection(): 전체 소환체/무기 컬렉션(미획득 딤, 획득 활성 + 업그레이드 수치)
//  - setCountBridge({get, spend}): 카운트→젬 교환용(없으면 교환 버튼 비활성)
(function () {
  'use strict'
  if (!window.BattleData || !window.BattleGacha) { console.error('[battle/gacha-ui] BattleData/BattleGacha 필요'); return }
  const D = window.BattleData, G = window.BattleGacha

  let countBridge = null
  function setCountBridge(b) { countBridge = b }

  // ── 스타일 1회 주입 ─────────────────────────────────────────────────────
  const STYLE_ID = 'bg-gacha-style'
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID
    st.textContent = `
    .bg-back{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.62);font-family:system-ui,'맑은 고딕',sans-serif}
    .bg-card{width:min(560px,92vw);max-height:88vh;overflow:auto;background:#171a20;border:1px solid #2b2f39;border-radius:16px;padding:18px 20px;color:#e8ebf0;box-shadow:0 18px 60px rgba(0,0,0,.5)}
    .bg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
    .bg-title{font-size:18px;font-weight:600}
    .bg-x{cursor:pointer;border:none;background:#242832;color:#cfd4de;width:30px;height:30px;border-radius:8px;font-size:16px}
    .bg-wallet{display:flex;gap:10px;margin-bottom:14px}
    .bg-chip{flex:1;background:#1f232c;border:1px solid #2b2f39;border-radius:10px;padding:8px 12px;font-size:13px;color:#cfd4de}
    .bg-chip b{color:#fff;font-size:16px;font-weight:600}
    .bg-btn{cursor:pointer;border:1px solid #3a4150;background:#242a36;color:#e8ebf0;border-radius:10px;padding:10px 14px;font-size:14px}
    .bg-btn:hover{background:#2c3342}
    .bg-btn:disabled{opacity:.45;cursor:default}
    .bg-btn.primary{background:#2f6bd8;border-color:#3f7ce8}
    .bg-btn.primary:hover{background:#3775e6}
    .bg-stage{height:190px;border-radius:12px;background:#0f1218;border:1px solid #232833;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;margin-bottom:12px}
    .bg-card-reveal{position:relative;z-index:3;text-align:center;transform:scale(.6);opacity:0;transition:transform .35s cubic-bezier(.2,1.3,.4,1),opacity .35s}
    .bg-card-reveal.show{transform:scale(1);opacity:1}
    .bg-emoji{font-size:52px;line-height:1}
    .bg-name{font-size:18px;font-weight:600;margin-top:6px}
    .bg-badge{display:inline-block;margin-top:6px;font-size:12px;padding:3px 10px;border-radius:999px;font-weight:600}
    .bg-sub{font-size:12px;color:#aeb4c0;margin-top:6px}
    .bg-fx{position:absolute;inset:0;z-index:1}
    .bg-flash{position:absolute;inset:0;background:#fff;opacity:0;animation:bgFlash .5s ease-out}
    @keyframes bgFlash{0%{opacity:0}20%{opacity:.85}100%{opacity:0}}
    .bg-beam{position:absolute;left:50%;top:-10%;width:120px;height:130%;transform:translateX(-50%) rotate(0);background:linear-gradient(180deg,rgba(74,163,255,0) 0%,rgba(74,163,255,.55) 50%,rgba(74,163,255,0) 100%);filter:blur(2px);animation:bgBeam .7s ease-out}
    @keyframes bgBeam{0%{opacity:0;height:0}40%{opacity:1;height:130%}100%{opacity:0}}
    .bg-swirl{position:absolute;left:50%;top:50%;width:260px;height:260px;margin:-130px 0 0 -130px;border-radius:50%;border:3px dashed rgba(176,107,255,.7);animation:bgSpin 1s linear,bgFade 1s ease-out}
    .bg-swirl.two{width:180px;height:180px;margin:-90px 0 0 -90px;border-color:rgba(210,150,255,.6);animation:bgSpinR 1s linear,bgFade 1s ease-out}
    @keyframes bgSpin{to{transform:rotate(360deg)}}
    @keyframes bgSpinR{to{transform:rotate(-360deg)}}
    @keyframes bgFade{0%{opacity:0}30%{opacity:1}100%{opacity:0}}
    .bg-burst{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:radial-gradient(circle,#fff 0%,#ffe08a 40%,#ff9d3a 70%,rgba(255,120,40,0) 72%);animation:bgBurst .9s ease-out}
    @keyframes bgBurst{0%{transform:scale(1);opacity:0}20%{opacity:1}100%{transform:scale(46);opacity:0}}
    .bg-ray{position:absolute;left:50%;top:50%;width:3px;height:150px;transform-origin:top center;background:linear-gradient(180deg,rgba(255,215,120,.9),rgba(255,215,120,0));animation:bgRay 1s ease-out}
    @keyframes bgRay{0%{opacity:0;height:0}30%{opacity:.9;height:150px}100%{opacity:0}}
    .bg-shake{animation:bgShake .5s ease}
    @keyframes bgShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-6px,3px)}40%{transform:translate(5px,-4px)}60%{transform:translate(-4px,-2px)}80%{transform:translate(3px,4px)}}
    .bg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
    .bg-rgroup{margin-top:8px;font-size:12px;color:#aeb4c0}
    .bg-cell{border-radius:10px;border:1px solid #2b2f39;background:#1c2029;padding:8px 6px;text-align:center}
    .bg-cell.locked{opacity:.32;filter:grayscale(.7)}
    .bg-cell .e{font-size:26px;line-height:1}
    .bg-cell .n{font-size:11px;margin-top:3px;color:#e8ebf0}
    .bg-cell .lv{font-size:10px;margin-top:2px;color:#9fd3ff}
    .bg-cell .lk{font-size:10px;margin-top:2px;color:#7f8797}
    `
    document.head.appendChild(st)
  }

  function iconFor(e) {
    // 무기는 WEAPONS 라벨에 이모지가 있음. 유닛은 개미 컨셉이라 기본 🐜, 특수 표기.
    const m = { mechaAnt: '🤖', mechaHuman: '🦾', shielder: '🛡', rifleman: '🐜', grenadier: '🐜', ant: '🐜' }
    if (e.cat === 'weapon') { const lbl = (D.WEAPONS[e.id] || {}).name || ''; const mt = lbl.match(/\p{Emoji}/u); if (mt) return mt[0] }
    return m[e.id] || '🐜'
  }

  function makeBack(onClose) {
    const back = document.createElement('div'); back.className = 'bg-back'
    back.addEventListener('mousedown', (ev) => { if (ev.target === back) { close() } })
    function close() { back.remove(); if (onClose) onClose() }
    return { back, close }
  }

  function walletRow() {
    const w = document.createElement('div'); w.className = 'bg-wallet'
    w.innerHTML = `<div class="bg-chip">💎 젬 <b class="w-gem">${G.getGems()}</b></div>
                   <div class="bg-chip">🔩 강화 부품 <b class="w-mat">${G.getMaterials()}</b></div>`
    return w
  }
  function refreshWallet(root) {
    const g = root.querySelector('.w-gem'), m = root.querySelector('.w-mat')
    if (g) g.textContent = G.getGems(); if (m) m.textContent = G.getMaterials()
  }

  // ── 가챠 팝업 ───────────────────────────────────────────────────────────
  function openGacha() {
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `
      <div class="bg-head"><div class="bg-title">🎰 소환 (가챠)</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close
    const wallet = walletRow(); card.appendChild(wallet)

    const stage = document.createElement('div'); stage.className = 'bg-stage'
    stage.innerHTML = `<div class="bg-sub" style="color:#5f6b7a">💎 젬으로 1회 소환</div>`
    card.appendChild(stage)

    const controls = document.createElement('div'); controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap'
    const pullBtn = document.createElement('button'); pullBtn.className = 'bg-btn primary'; pullBtn.textContent = `소환 (💎${D.GEM.pullCost})`
    const exBtn = document.createElement('button'); exBtn.className = 'bg-btn'; exBtn.textContent = `카운트 ${D.GEM.countPerGem.toLocaleString()} → 💎1`
    const colBtn = document.createElement('button'); colBtn.className = 'bg-btn'; colBtn.textContent = '📚 컬렉션'
    controls.append(pullBtn, exBtn, colBtn); card.appendChild(controls)

    function syncButtons() {
      pullBtn.disabled = G.getGems() < D.GEM.pullCost
      exBtn.disabled = !(countBridge && countBridge.get() >= D.GEM.countPerGem)
    }
    syncButtons()

    pullBtn.onclick = () => {
      const res = G.roll(); if (!res) { syncButtons(); return }
      refreshWallet(wallet); syncButtons()
      playReveal(stage, res)
    }
    exBtn.onclick = () => {
      if (!(countBridge && countBridge.get() >= D.GEM.countPerGem)) return
      countBridge.spend(D.GEM.countPerGem); G.addGems(1)
      refreshWallet(wallet); syncButtons()
    }
    colBtn.onclick = () => openCollection()

    document.body.appendChild(back)
  }

  // 희귀도별 연출 → 카드 공개
  function playReveal(stage, res) {
    stage.innerHTML = ''
    const anim = res.rarity.anim
    const fx = document.createElement('div'); fx.className = 'bg-fx'; stage.appendChild(fx)
    if (anim === 'flash') { fx.innerHTML = `<div class="bg-flash"></div>` }
    else if (anim === 'beam') { fx.innerHTML = `<div class="bg-beam"></div><div class="bg-flash" style="animation-duration:.7s"></div>` }
    else if (anim === 'swirl') { fx.innerHTML = `<div class="bg-swirl"></div><div class="bg-swirl two"></div>` }
    else if (anim === 'burst') {
      let rays = ''; for (let i = 0; i < 12; i++) rays += `<div class="bg-ray" style="transform:rotate(${i * 30}deg);animation-delay:${i * .02}s"></div>`
      fx.innerHTML = `<div class="bg-burst"></div>${rays}<div class="bg-emoji" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:.25;font-size:120px">🐜</div>`
      stage.classList.add('bg-shake'); setTimeout(() => stage.classList.remove('bg-shake'), 520)
    }
    const delay = anim === 'flash' ? 260 : anim === 'beam' ? 420 : anim === 'swirl' ? 620 : 780
    const reveal = document.createElement('div'); reveal.className = 'bg-card-reveal'
    const badgeColor = res.rarity.color
    reveal.innerHTML = `<div class="bg-emoji">${iconFor(res.entry)}</div>
      <div class="bg-name">${res.entry.name}</div>
      <div class="bg-badge" style="background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}66">${res.rarity.name}</div>
      <div class="bg-sub">${res.dup ? `중복 · 🔩 강화 부품 +${res.material}` : '✨ 신규 획득!'}</div>`
    stage.appendChild(reveal)
    setTimeout(() => reveal.classList.add('show'), delay)
  }

  // ── 컬렉션 UI ───────────────────────────────────────────────────────────
  function openCollection() {
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">📚 컬렉션</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close

    const order = ['legend', 'rare', 'uncommon', 'common']
    const all = G.catalog()
    order.forEach((rk) => {
      const info = D.RARITY[rk]; const items = all.filter((e) => e.rarity === rk)
      if (!items.length) return
      const h = document.createElement('div'); h.className = 'bg-rgroup'
      h.innerHTML = `<span style="color:${info.color};font-weight:600">${info.name}</span> · ${items.filter((i) => i.owned).length}/${items.length}`
      card.appendChild(h)
      const grid = document.createElement('div'); grid.className = 'bg-grid'
      items.forEach((e) => {
        const cell = document.createElement('div'); cell.className = 'bg-cell' + (e.owned ? '' : ' locked')
        cell.style.borderColor = e.owned ? info.color + '66' : '#2b2f39'
        const tag = e.cat === 'weapon' ? '무기' : `코스트 ${e.cost}`
        cell.innerHTML = `<div class="e">${iconFor(e)}</div><div class="n">${e.name}</div>` +
          (e.owned ? `<div class="lv">${tag} · Lv.${e.level}</div>` : `<div class="lk">🔒 미획득</div>`)
        grid.appendChild(cell)
      })
      card.appendChild(grid)
    })
    document.body.appendChild(back)
  }

  window.BattleGachaUI = { openGacha, openCollection, setCountBridge }
})()
