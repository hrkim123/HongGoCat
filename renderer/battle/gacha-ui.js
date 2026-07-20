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
  let hpBridge = null   // { get, max, cost, heal } — 앱이 제공(체력 리셋)
  function setHpBridge(b) { hpBridge = b }
  // 호스트 앱에 팝업 열림/닫힘 통지(오버레이 hotzone 갱신용)
  function hostSync() { try { if (window.__bgModalChanged) window.__bgModalChanged() } catch (e) {} }
  function mount(back) { document.body.appendChild(back); hostSync() }

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

  const DESC = {
    ant: '기본 근접 물량 소환체', rifleman: '3연발 원거리 사격', grenadier: '수류탄 광역 공격',
    shielder: '방패로 앞을 막는 탱커(공격 없음)', mechaAnt: '개미 대포를 쏘는 중장 딜탱', mechaHuman: '공중 부양·고화력 최상위',
    missile: '커서 유도 폭발 · 합치면 핵', shield: '커서 방향 방패로 탄 막기', net: '발사체를 잡아 되던지기',
    gatling: '커서 방향 연사 터렛', human: 'WASD 이동 · 무기 장착 전투', lightning: '커서→작업표시줄 낙뢰',
    adogen: '기 모아 쏘는 기공파', blackhole: '주변 물체를 빨아들여 소멸(배틀 1회)',
  }
  // 상세 설명(? 버튼 팝업용) — 충실히 작성
  const INFO = {
    ant: '작업 표시줄 위를 기어다니는 기본 근접 소환체. 체력·공격력은 낮지만 코스트 1로 물량으로 밀어붙이기 좋다. 상대 소환체를 만나면 물어뜯어 공격한다. 오버레이에선 여러 마리가 돌아다니다 10마리가 모이면 메카 개미로 합체한다.',
    rifleman: '총을 든 개미 병사. 일정 사거리 밖에서 3연발로 사격해 안전하게 딜을 넣는다. 근접전에 약하니 앞에 탱커(쉴더)를 세워주면 좋다. 업그레이드 최대 시 4연발이 된다.',
    grenadier: '수류탄을 던지는 개미 병사. 착탄 지점 범위에 광역 피해를 줘 뭉쳐 오는 적 물량에 강하다. 단발 위력은 좋지만 쿨타임이 길다. 업그레이드 시 착탄 지점에 화염 장판(지속 피해)이 남는다.',
    shielder: '방패를 든 개미 탱커. 공격은 못 하지만 전방을 막아 아군을 보호한다. 총 10의 피해를 막으면 방패가 부서진다. 딜러 앞에 세워 라인을 유지하는 용도. 업그레이드 시 흡수량이 늘고, 파괴될 때 주변 아군에게 잠깐 보호막을 준다.',
    mechaAnt: '개미 10마리가 합체한 중장 기체. 높은 체력으로 버티며 개미 대포를 빠르게 연사한다. 코스트가 높지만 라인의 중심을 잡아준다. 업그레이드 시 대포를 2연사한다.',
    mechaHuman: '메카 개미의 인간형(건담) 변신. 발밑 부스터로 바닥에서 살짝 떠 전진하는 공중 타입이라 땅에 파인 구멍을 무시하고 지나간다. 최고 수준의 체력·화력을 가진 결전 병기. 업그레이드 시 부스터 대시로 순간 접근한다.',
    missile: '커서를 따라가 명중 시 폭발하는 유도 미사일. 여러 발이 겹치면 합쳐져 더 커지고, 10발이 합쳐지면 ☢핵이 된다. 왼쪽 클릭으로 마지막 방향으로 3배 가속. 자신보다 약한 대상(개미·게틀링 등)은 관통하며 그만큼 파워가 깎여 작아진다.',
    shield: '커서 방향에 10초간 방패를 세워 날아오는 미사일·탄을 막는다. 체력 10 — 맞을수록 금이 가다 깨지고 3초 쿨타임. 공격이 아닌 방어/생존용이다.',
    net: '활처럼 당겨 발사하는 그물. 펼쳐지며 범위 안의 발사체(상대 것 포함: 미사일·개미·총알 등)를 잡아 가둔다. 잡은 뒤 커서에 매달아 휘두르다 다시 클릭하면 그 방향으로 사출한다(미사일은 재점화). 단, 메카·인간·터렛 본체는 잡지 못한다.',
    gatling: '책상 위에 고정 소환하는 터렛. Q를 누르는 동안 커서 방향으로 연사한다. 약 2초 사격하면 과열되어 3초간 멈춘다. 체력 10, 총알당 소량 피해. 지속 견제와 라인 방어에 좋다.',
    human: 'WASD로 직접 조종하는 인간 소환체(W 점프·S 급강하). E 홀드로 커서 방향 방패, Q로 공격(맨손 주먹 / 주운 무기 / 아도겐 충전). 바닥에 가끔 떨어지는 칼·권총·라이플·바주카를 주워 장착할 수 있다.',
    lightning: '커서 위치에서 작업 표시줄 방향으로 번개가 내리꽂힌다. Q를 누르는 동안 충전(최대 5단계 — 색이 노랑→보라로, 범위·피해가 커짐). 경로에서 처음 만나는 대상에서 끊겨 감전·타격하고, 없으면 바닥까지 내려가 땅을 판다.',
    adogen: '맨손 인간이 왼쪽 클릭을 꾹 눌러 기를 모으고 놓으면 커서 방향으로 기공파를 발사한다. 충전량에 따라 크기·체력·피해가 커진다(최대 5단계). 미사일·탄과 부딪치면 서로 깎이고, 클수록 땅도 크게 판다.',
    blackhole: '커서에 10초간 블랙홀을 소환한다(쿨 60초). 화면 전체에서 캐릭터를 제외한 모든 물체(미사일·개미·총알·터렛·포탄 등)를 중심으로 빨아들여 소멸시킨다 — 가까울수록 강하게. 배틀 모드에선 한 게임에 1번만 쓸 수 있다.',
  }
  function statLine(e) {
    if (e.cat === 'weapon') return e.mana != null ? `무기 · 마나 ${e.mana}` : '무기 · 오버레이'
    const a = e.atk || {}
    const atk = a.type === 'melee' ? `근접 ${a.dmg}` : a.type === 'proj' ? `원거리 ${a.dmg}${a.burst ? ' ×' + a.burst + '연발' : ''}`
      : a.type === 'aoe' ? `광역 ${a.dmg}` : a.type === 'none' ? '공격 없음' : ''
    return `코스트 ${e.cost} · HP ${e.hp} · ${atk}${e.flying ? ' · 공중' : ''}`
  }
  function openInfo(id) {
    const e = (D.UNITS[id] ? { id, ...D.UNITS[id] } : { id, ...D.WEAPONS[id] })
    const info = D.RARITY[e.rarity] || D.RARITY.common
    const back = document.createElement('div'); back.className = 'bg-back'
    const card = document.createElement('div'); card.className = 'bg-card'; card.style.width = 'min(400px,92vw)'; back.appendChild(card)
    const close = () => { back.remove(); hostSync() }
    back.addEventListener('mousedown', (ev) => { if (ev.target === back) close() })
    const up = window.BattleUpgrade
    card.innerHTML = `<div class="bg-head"><div class="bg-title">${e.name}</div><button class="bg-x">✕</button></div>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px">
        <div style="width:96px;height:96px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${info.color}18;border:1px solid ${info.color}">${iconFor(e, 84)}</div>
        <div style="flex:1;min-width:0">
          <span class="bg-badge" style="background:${info.color}22;color:${info.color};border:1px solid ${info.color}66">${info.name}</span>
          <div class="bg-sub" style="margin-top:8px">${statLine(e)}</div>
          ${up && up.spec(id) ? `<div class="bg-sub" style="margin-top:4px;color:#9aa0ab">⬆ ${up.effectSummary(id)}</div>` : ''}
        </div>
      </div>
      <div style="font-size:13px;line-height:1.7;color:#dfe3ea">${INFO[id] || DESC[id] || ''}</div>`
    card.querySelector('.bg-x').onclick = close
    mount(back)
  }
  function iconFor(e, size) {
    // 개미 베이스 + 유닛별 액세서리 SVG(art.js). 로드 안 됐으면 이모지 폴백.
    if (window.BattleArt) return window.BattleArt.icon(e, size || 30)
    const m = { mechaAnt: '🤖', mechaHuman: '🦾', shielder: '🛡', rifleman: '🐜', grenadier: '🐜', ant: '🐜', missile: '🚀', gatling: '🔫' }
    return `<span style="font-size:${Math.round((size || 30) * 0.9)}px">${m[e.id] || '🐜'}</span>`
  }

  function makeBack(onClose) {
    const back = document.createElement('div'); back.className = 'bg-back'
    back.addEventListener('mousedown', (ev) => { if (ev.target === back) { close() } })
    function close() { back.remove(); hostSync(); if (onClose) onClose() }
    return { back, close }
  }

  // 큰 숫자 축약: 10,000 이상 → k, 1,000,000 이상 → m
  function fmtNum(n) {
    n = Math.floor(n || 0)
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm'
    if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'
    return String(n)
  }
  function walletRow() {
    const w = document.createElement('div'); w.className = 'bg-wallet'
    const cnt = countBridge ? countBridge.get() : 0
    w.innerHTML = `<div class="bg-chip" title="카운트">🪙 <b class="w-cnt">${fmtNum(cnt)}</b></div>
                   <div class="bg-chip" title="젬">💎 <b class="w-gem">${fmtNum(G.getGems())}</b></div>
                   <div class="bg-chip" title="강화 부품">🔩 <b class="w-mat">${fmtNum(G.getMaterials())}</b></div>`
    return w
  }
  function refreshWallet(root) {
    const c = root.querySelector('.w-cnt'), g = root.querySelector('.w-gem'), m = root.querySelector('.w-mat')
    if (c) c.textContent = fmtNum(countBridge ? countBridge.get() : 0)
    if (g) g.textContent = fmtNum(G.getGems()); if (m) m.textContent = fmtNum(G.getMaterials())
  }

  // ── 가챠 팝업 ───────────────────────────────────────────────────────────
  function openGacha() {
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `
      <div class="bg-head"><div class="bg-title">🎰 소환</div><button class="bg-x">✕</button></div>`
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

    mount(back)
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
    reveal.innerHTML = `<div class="bg-emoji">${iconFor(res.entry, 56)}</div>
      <div class="bg-name">${res.entry.name}</div>
      <div class="bg-badge" style="background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}66">${res.rarity.name}</div>
      <div class="bg-sub">${res.dup ? `중복 · 🔩 강화 부품 +${res.material}` : '✨ 신규 획득!'}</div>`
    stage.appendChild(reveal)
    setTimeout(() => reveal.classList.add('show'), delay)
  }

  // 추가 스타일(덱/필터/메뉴) 1회 주입
  function ensureStyle2() {
    if (document.getElementById('bg-gacha-style2')) return
    const st = document.createElement('style'); st.id = 'bg-gacha-style2'
    st.textContent = `
    .bg-deck{background:#12151b;border:1px solid #2b2f39;border-radius:10px;padding:10px;margin-bottom:12px}
    .bg-deck h4{margin:0 0 6px;font-size:12px;color:#aeb4c0;font-weight:600}
    .bg-slots{display:flex;gap:6px;flex-wrap:wrap}
    .bg-slot{width:52px;height:52px;border-radius:9px;border:1px dashed #3a4150;background:#191d25;display:flex;align-items:center;justify-content:center;position:relative}
    .bg-slot.filled{border-style:solid}
    .bg-slot .rm{position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;background:#c0392b;color:#fff;font-size:11px;border:none;cursor:pointer;line-height:1}
    .bg-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
    .bg-fbtn{cursor:pointer;border:1px solid #2b2f39;background:#1c2029;color:#cfd4de;border-radius:999px;padding:4px 11px;font-size:12px}
    .bg-fbtn.on{background:#2f6bd8;border-color:#3f7ce8;color:#fff}
    .bg-cell{cursor:pointer;position:relative}
    .bg-cell.indeck{outline:2px solid #4aa3ff;outline-offset:-1px}
    .bg-help{position:absolute;top:3px;right:3px;width:16px;height:16px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(20,24,30,.75);color:#cfd4de;font-size:11px;line-height:1;cursor:pointer;z-index:2}
    .bg-help:hover{background:#2f6bd8;color:#fff}
    .bg-cell .dk{font-size:9px;margin-top:1px;color:#8fd3ff}
    .bg-up{display:flex;align-items:center;gap:10px;background:#1c2029;border:1px solid #2b2f39;border-radius:10px;padding:8px 10px;margin-bottom:6px}
    .bg-up .ui{flex:1;min-width:0}
    .bg-up .un{font-size:13px;color:#e8ebf0}
    .bg-up .ue{font-size:11px;color:#9aa0ab;margin-top:2px}
    .bg-up .ul{font-size:12px;color:#ffcf3a;white-space:nowrap}
    `
    document.head.appendChild(st)
  }

  // ── 컬렉션 UI (상단 덱 편성 + 필터 + 하단 컬렉션) ────────────────────────
  function openCollection() {
    ensureStyle2()
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">📚 컬렉션 · 덱 편성</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close
    const body = document.createElement('div'); card.appendChild(body)

    let fCat = 'unit', fRar = 'all'   // 기본: 소환체 카테고리, 전체 희귀도
    const lim = G.deckLimits()
    const RORDER = ['legend', 'rare', 'uncommon', 'common']

    function cellHtml(e) {
      const info = D.RARITY[e.rarity], indeck = G.inDeck(e.id)
      const tag = e.cat === 'weapon' ? '무기' : `코스트 ${e.cost}`
      return `<div class="bg-cell ${e.owned ? '' : 'locked'} ${indeck ? 'indeck' : ''}" data-id="${e.id}" title="${e.name} [${info.name}]" style="border-color:${e.owned ? info.color : '#2b2f39'};background:${e.owned ? info.color + '18' : '#1c2029'}">
        <button class="bg-help" data-help="${e.id}" title="설명">?</button>
        <div class="e">${iconFor(e, 36)}</div><div class="n">${e.name}</div>` +
        (e.owned ? `<div class="lv">${tag} · Lv.${e.level}</div>${indeck ? '<div class="dk">덱 ✓</div>' : ''}` : `<div class="lk">🔒 미획득</div>`) + `</div>`
    }

    function render() {
      const deck = G.getDeck()
      const unitSlots = Array.from({ length: lim.units }, (_, i) => deck.units[i] || null)
      const wpnSlots = Array.from({ length: lim.weapons }, (_, i) => deck.weapons[i] || null)
      const slotHtml = (id) => id
        ? `<div class="bg-slot filled" title="${(D.UNITS[id] || D.WEAPONS[id]).name}">${iconFor(id, 34)}<button class="rm" data-rm="${id}">✕</button></div>`
        : `<div class="bg-slot"></div>`
      const catBtns = [['unit', '🐜 소환체'], ['weapon', '⚔ 무기']]
        .map(([k, n]) => `<button class="bg-fbtn ${fCat === k ? 'on' : ''}" data-fc="${k}">${n}</button>`).join('')
      const rarBtns = [['all', '전체'], ['common', '일반'], ['uncommon', '고급'], ['rare', '희귀'], ['legend', '전설']]
        .map(([k, n]) => `<button class="bg-fbtn ${fRar === k ? 'on' : ''}" data-fr="${k}" style="${fRar === k && k !== 'all' ? 'border-color:' + D.RARITY[k].color : ''}">${n}</button>`).join('')

      const items = G.catalog().filter((e) => e.cat === fCat)
      let listHtml
      if (fRar === 'all') {
        listHtml = RORDER.map((rk) => {
          const info = D.RARITY[rk], gi = items.filter((e) => e.rarity === rk)
          if (!gi.length) return ''
          return `<div class="bg-rgroup" style="color:${info.color};font-weight:600;margin-top:10px">${info.name} · ${gi.filter((i) => i.owned).length}/${gi.length}</div>` +
            `<div class="bg-grid">${gi.map(cellHtml).join('')}</div>`
        }).join('')
      } else {
        const gi = items.filter((e) => e.rarity === fRar)
        listHtml = gi.length ? `<div class="bg-grid">${gi.map(cellHtml).join('')}</div>` : '<div class="bg-sub">해당 희귀도 없음</div>'
      }

      body.innerHTML = `
        <div class="bg-deck"><h4>배틀 덱 — 소환체 ${deck.units.length}/${lim.units} · 무기 ${deck.weapons.length}/${lim.weapons}</h4>
          <div class="bg-slots" style="margin-bottom:6px">${unitSlots.map(slotHtml).join('')}</div>
          <div class="bg-slots">${wpnSlots.map(slotHtml).join('')}</div>
        </div>
        <div class="bg-filters">${catBtns}</div>
        <div class="bg-filters">${rarBtns}</div>
        ${listHtml}`

      body.querySelectorAll('[data-fc]').forEach((b) => b.onclick = () => { fCat = b.dataset.fc; render() })
      body.querySelectorAll('[data-fr]').forEach((b) => b.onclick = () => { fRar = b.dataset.fr; render() })
      body.querySelectorAll('[data-rm]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); G.toggleDeck(b.dataset.rm); render() })
      body.querySelectorAll('[data-help]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); openInfo(b.dataset.help) })
      body.querySelectorAll('.bg-cell[data-id]').forEach((c) => c.onclick = () => {
        const id = c.dataset.id; if (!G.isOwned(id)) return
        const r = G.toggleDeck(id); if (!r.ok && r.reason === 'full') flashMsg(card, '덱이 가득 찼어요')
        render()
      })
    }
    render()
    mount(back)
  }

  function flashMsg(card, msg) {
    const t = document.createElement('div'); t.textContent = msg
    t.style.cssText = 'position:absolute;left:50%;top:12px;transform:translateX(-50%);background:#c0392b;color:#fff;padding:6px 12px;border-radius:8px;font-size:12px;z-index:5'
    card.style.position = 'relative'; card.appendChild(t); setTimeout(() => t.remove(), 1200)
  }

  // ── 상점 UI (재화 + 젬 구매 + 업그레이드) ────────────────────────────────
  function openShop() {
    ensureStyle2()
    const U = window.BattleUpgrade
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">🛒 상점</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close
    const body = document.createElement('div'); card.appendChild(body)

    function render() {
      const cnt = countBridge ? countBridge.get() : 0
      const buyRow = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <div class="bg-chip" style="flex:1">💎 젬 구매 — ${D.GEM.countPerGem.toLocaleString()} 카운트 = 💎1</div>
        <button class="bg-btn primary" id="buygem" ${cnt < D.GEM.countPerGem ? 'disabled' : ''}>💎1 구매</button></div>`
      let hpRow = ''
      if (hpBridge) {
        const hp = Math.round(hpBridge.get() * 10) / 10, full = hp >= hpBridge.max, canHeal = !full && cnt >= hpBridge.cost
        hpRow = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
          <div class="bg-chip" style="flex:1">🩹 체력 리셋 — HP ${hp}/${hpBridge.max}</div>
          ${full ? '<span class="bg-fbtn" style="cursor:default">가득</span>' : `<button class="bg-btn" id="healhp" ${canHeal ? '' : 'disabled'}>🪙${hpBridge.cost.toLocaleString()}</button>`}</div>`
      }
      let ups = ''
      if (U) {
        const owned = G.catalog().filter((e) => e.owned && U.spec(e.id))
        ups = owned.map((e) => {
          const lv = G.getLevel(e.id), cost = U.costToNext(e.id), can = U.canUpgrade(e.id)
          const btn = cost == null ? `<span class="bg-fbtn" style="cursor:default">MAX</span>`
            : `<button class="bg-btn" data-up="${e.id}" ${can ? '' : 'disabled'}>강화 🔩${cost}</button>`
          return `<div class="bg-up"><div style="width:34px">${iconFor(e, 30)}</div>
            <div class="ui"><div class="un">${e.name} <span class="ul">Lv.${lv}/${U.maxLevel()}</span></div>
            <div class="ue">${U.effectSummary(e.id)}</div></div>${btn}</div>`
        }).join('')
      }
      body.innerHTML = walletRow().outerHTML + buyRow + hpRow +
        `<div class="bg-rgroup" style="margin:6px 0">🔩 업그레이드</div>${ups || '<div class="bg-sub">보유한 소환체/무기가 없어요</div>'}`

      const bg = body.querySelector('#buygem')
      if (bg) bg.onclick = () => { if (countBridge && countBridge.get() >= D.GEM.countPerGem) { countBridge.spend(D.GEM.countPerGem); G.addGems(1); render() } }
      const hb = body.querySelector('#healhp')
      if (hb) hb.onclick = () => { if (hpBridge && hpBridge.heal()) render() }
      body.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { if (U) { U.upgrade(b.dataset.up); render() } })
    }
    render()
    mount(back)
  }

  // ── 개발자 재화 패널 ─────────────────────────────────────────────────────
  let dev = false
  function setDev(b) { dev = !!b }
  let devCtx = null   // { peers:()=>[{id,name}], setPeer:(id,{count,gems,mat}) }
  function setDevContext(c) { devCtx = c }

  function openDevPanel() {
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">🛠️ 개발자 — 재화 설정</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close
    const body = document.createElement('div'); card.appendChild(body)

    function curRow(label, getVal, applyFn) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px'
      row.innerHTML = `<span style="flex:1;font-size:13px;color:#cfd4de">${label}</span>`
      const inp = document.createElement('input'); inp.type = 'number'; inp.value = getVal(); inp.style.cssText = 'width:110px;padding:6px;border-radius:8px;background:#242a36;color:#e8ebf0;border:1px solid #3a4150'
      const btn = document.createElement('button'); btn.className = 'bg-btn'; btn.textContent = '설정'
      btn.onclick = () => { applyFn(parseInt(inp.value, 10) || 0) }
      row.append(inp, btn); return row
    }

    function render() {
      body.innerHTML = ''
      const meBox = document.createElement('div'); meBox.className = 'bg-deck'
      meBox.innerHTML = '<h4>내 재화</h4>'
      meBox.appendChild(curRow('🪙 카운트', () => (countBridge ? countBridge.get() : 0), (v) => { if (countBridge && countBridge.set) countBridge.set(v); render() }))
      meBox.appendChild(curRow('💎 젬', () => G.getGems(), (v) => { G.setGems(v); render() }))
      meBox.appendChild(curRow('🔩 강화 부품', () => G.getMaterials(), (v) => { G.setMaterials(v); render() }))
      body.appendChild(meBox)

      const peers = devCtx && devCtx.peers ? devCtx.peers() : []
      const pBox = document.createElement('div'); pBox.className = 'bg-deck'
      pBox.innerHTML = `<h4>접속 유저 재화 (멀티) — ${peers.length}명</h4>`
      if (!peers.length) { pBox.innerHTML += '<div class="bg-sub">접속한 다른 유저가 없어요</div>' }
      peers.forEach((p) => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:5px;align-items:center;margin-bottom:6px;flex-wrap:wrap'
        row.innerHTML = `<span style="flex:1 0 100%;font-size:12px;color:#e8ebf0">${p.name || ('#' + p.id)}</span>`
        const mk = (ph) => { const i = document.createElement('input'); i.type = 'number'; i.placeholder = ph; i.style.cssText = 'width:64px;padding:5px;border-radius:7px;background:#242a36;color:#e8ebf0;border:1px solid #3a4150;font-size:12px'; return i }
        const ic = mk('🪙'), ig = mk('💎'), im = mk('🔩')
        const b = document.createElement('button'); b.className = 'bg-btn'; b.textContent = '전송'
        b.onclick = () => {
          const cur = {}
          if (ic.value !== '') cur.count = parseInt(ic.value, 10) || 0
          if (ig.value !== '') cur.gems = parseInt(ig.value, 10) || 0
          if (im.value !== '') cur.mat = parseInt(im.value, 10) || 0
          if (devCtx && devCtx.setPeer) devCtx.setPeer(p.id, cur)
          flashMsg(card, `${p.name || p.id} 재화 전송`)
        }
        row.append(ic, ig, im, b); pBox.appendChild(row)
      })
      body.appendChild(pBox)
    }
    render()
    mount(back)
  }

  // ── 햄버거 통합 메뉴 ─────────────────────────────────────────────────────
  let bridges = {}
  function setBridges(b) { bridges = Object.assign(bridges, b || {}) }
  function openMenu() {
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; card.style.width = 'min(300px,90vw)'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">☰ 메뉴</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close
    const items = [
      ['🛒 상점', () => openShop()],
      ['🎰 소환', () => openGacha()],
      ['📚 컬렉션 · 덱', () => openCollection()],
      ['⚔ 무기 설정', () => (bridges.weapon ? bridges.weapon() : flashMsg(card, '무기 설정 연결 예정'))],
      ['🏆 업적', () => (bridges.achievements ? bridges.achievements() : flashMsg(card, '업적 연결 예정'))],
      ['⚙ 설정', () => (bridges.settings ? bridges.settings() : flashMsg(card, '설정 연결 예정'))],
    ]
    if (dev) items.push(['🛠️ 개발자 (재화)', () => openDevPanel()])
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px'
    items.forEach(([label, fn]) => { const b = document.createElement('button'); b.className = 'bg-btn'; b.textContent = label; b.style.textAlign = 'left'; b.onclick = () => { close(); fn() }; wrap.appendChild(b) })
    card.appendChild(wrap)
    mount(back)
  }

  window.BattleGachaUI = { openGacha, openCollection, openShop, openMenu, openDevPanel, setCountBridge, setHpBridge, setBridges, setDev, setDevContext }
})()
