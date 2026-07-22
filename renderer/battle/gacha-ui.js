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
    /* 10연 소환: SKIP · 진행 카운터 · 결과 그리드 */
    .bg-skip{position:absolute;top:8px;right:12px;z-index:6;font-size:13px;font-weight:600;letter-spacing:.5px;color:#cfd4de;cursor:pointer;user-select:none;opacity:.8;transition:opacity .15s,transform .15s;text-shadow:0 1px 3px rgba(0,0,0,.6)}
    .bg-skip:hover{opacity:1;transform:translateX(2px);color:#fff}
    .bg-pullcount{position:absolute;top:8px;left:12px;z-index:6;font-size:12px;color:#8fa0b4;user-select:none;text-shadow:0 1px 3px rgba(0,0,0,.6)}
    .bg-pull-grid{display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(2,1fr);gap:6px;width:100%;height:100%;padding:8px;box-sizing:border-box;animation:bgFade2 .4s ease-out}
    @keyframes bgFade2{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
    .bg-pull-cell{border-radius:9px;border:1.5px solid #2b2f39;background:#161a21;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:2px;min-width:0;position:relative;overflow:hidden}
    .bg-pull-cell.isnew{box-shadow:0 0 0 1px rgba(255,255,255,.12) inset}
    .bg-pull-cell .newtag{position:absolute;top:2px;right:3px;font-size:8px;font-weight:700;color:#ffe08a}
    .bg-pull-ic{line-height:1}
    .bg-pull-nm{font-size:10px;color:#e8ebf0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bg-pull-bd{font-size:9px;font-weight:700}
    .bg-pull-sub{font-size:9px;color:#9aa0ab}
    `
    document.head.appendChild(st)
  }

  const DESC = {
    ant: '기본 근접 물량 소환체', rifleman: '3연발 원거리 사격', grenadier: '수류탄 광역 공격',
    shielder: '방패로 앞을 막는 탱커(공격 없음)', mechaAnt: '개미 대포를 쏘는 중장 딜탱', mechaHuman: '공중 부양·고화력 최상위',
    missile: '커서 유도 폭발 · 합치면 핵', shield: '커서 방향 방패로 탄 막기', net: '발사체를 잡아 되던지기',
    gatling: '커서 방향 연사 터렛', human: 'WASD 이동 · 무기 장착 전투', lightning: '커서→작업표시줄 낙뢰',
    adogen: '기 모아 쏘는 기공파', blackhole: '주변 물체를 빨아들여 소멸(배틀 1회)',
    scout: '빠르고 약한 고속 근접 러셔', kamikaze: '접근 후 자폭 광역', medic: '주변 아군을 회복하는 서포터',
    drone: '공중 비행 원거리(지상 근접 무시)', freezer: '적을 둔화시키는 얼음 원거리', worker: '정지형·마나 회복(배틀 경제)',
    commander: '주변 아군 강화 오라 지휘관', sniper: '초장거리 고데미지 저격', boss: '거대 광역 결전 병기',
    broodTitan: '거대 요새 — 근접 스톰프 + 땅 긁는 레이저 + 개미 생산',
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
    human: '배틀 모드에선 자동으로 전진하며 아도겐(기공파)을 쏘는 원거리 소환체. 오버레이에선 WASD로 직접 조종(W 점프·S 급강하), E 홀드로 방패, Q로 공격(맨손/주운 무기/아도겐 충전), 바닥의 칼·권총·라이플·바주카를 주워 장착할 수 있다.',
    lightning: '커서 위치에서 작업 표시줄 방향으로 번개가 내리꽂힌다. Q를 누르는 동안 충전(최대 5단계 — 색이 노랑→보라로, 범위·피해가 커짐). 경로에서 처음 만나는 대상에서 끊겨 감전·타격하고, 없으면 바닥까지 내려가 땅을 판다.',
    adogen: '맨손 인간이 왼쪽 클릭을 꾹 눌러 기를 모으고 놓으면 커서 방향으로 기공파를 발사한다. 충전량에 따라 크기·체력·피해가 커진다(최대 5단계). 미사일·탄과 부딪치면 서로 깎이고, 클수록 땅도 크게 판다.',
    blackhole: '커서에 10초간 블랙홀을 소환한다(쿨 60초). 화면 전체에서 캐릭터를 제외한 모든 물체(미사일·개미·총알·터렛·포탄 등)를 중심으로 빨아들여 소멸시킨다 — 가까울수록 강하게. 배틀 모드에선 한 게임에 1번만 쓸 수 있다.',
    scout: '몸집이 작고 체력은 낮지만 매우 빠른 정찰 개미. 코스트 1로 값싸게 뽑아 초반 압박이나 상대 후방 견제에 쓴다. 배틀에선 빠르게 전진해 라인을 흔들고, 오버레이에선 잽싸게 배회한다.',
    kamikaze: '등에 폭탄을 짊어진 자폭 개미. 적에게 접근하면 터지며 주변에 큰 광역 피해를 준다(1회성). 뭉친 적이나 단단한 유닛을 한 번에 정리하는 용도. 도화선이 타들어가는 연출.',
    medic: '주변 아군 소환체의 체력을 회복시키는 의무병 개미. 직접 공격은 없고, 딜러·탱커 뒤에 두면 라인 유지력이 크게 오른다. 오버레이에선 내 소환체들을 돌보며 배회.',
    drone: '날개로 공중을 나는 말벌 드론. 공중 타입이라 땅의 구멍을 무시하고, 지상 근접 유닛의 공격을 받지 않는다(원거리·대공에만 피격). 원거리로 견제한다.',
    freezer: '얼음 탄을 쏘는 개미. 명중 시 대상의 이동 속도를 일정 시간 늦춘다(둔화). 데미지는 낮지만 상대 진격을 지연시켜 아군에게 시간을 벌어준다.',
    worker: '전투는 안 하지만 배틀에서 정지한 채 마나 회복을 늘려주는 일개미(1마리당 +0.1/s). 경제로 굴려 고코스트 유닛을 빨리 뽑는 전략용. 오버레이에선 그냥 배회한다.',
    commander: '주변 아군에게 공격력·이동속도 버프 오라를 주는 지휘 개미. 본인도 어느 정도 싸우며, 물량 유닛과 함께 두면 라인 전체가 강해진다.',
    sniper: '초장거리에서 강력한 한 방을 쏘는 저격 개미. 체력이 매우 낮아 지켜줘야 하지만, 사거리 밖에서 안전하게 고데미지를 넣어 탱커·쉴드를 뚫는 데 유리하다.',
    boss: '거대한 여왕 개미. 최고 코스트(10)·초고체력·광역 공격의 결전 병기. 마나를 오래 모아야 뽑을 수 있지만 전황을 뒤집는 한 방이 된다.',
    broodTitan: '걸어다니는 성벽 — 코스트 25·초고체력·초저속의 거대 요새 여왕. 근처 적은 스톰프로 짓밟고(강제 넉백), 중거리 적은 땅을 긁는 레이저로 쓸어버린다(공중 제외). 전진하며 알주머니로 개미를 계속 출산. Lv5에선 죽을 때 잔해 벽이 생겨 라인을 몇 초간 막는다.',
  }
  function statLine(e) {
    if (e.cat === 'weapon') return e.mana != null ? `무기 · 마나 ${e.mana}` : '무기 · 오버레이'
    const a = e.atk || {}
    const atk = a.type === 'melee' ? `근접 ${a.dmg}` : a.type === 'proj' ? `원거리 ${a.dmg}${a.burst ? ' ×' + a.burst + '연발' : ''}`
      : a.type === 'aoe' ? `광역 ${a.dmg}` : a.type === 'none' ? '공격 없음' : ''
    const air = (a.type === 'proj' || a.type === 'aoe') ? ' · ✈대공' : (a.type === 'melee' || a.type === 'suicide') ? ' · ⛰지상전용' : ''
    return `코스트 ${e.cost} · HP ${e.hp} · ${atk}${e.flying ? ' · 공중' : ''}${air}`
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
    const pull10Cost = D.GEM.pullCost * 10
    const pull10Btn = document.createElement('button'); pull10Btn.className = 'bg-btn primary'; pull10Btn.textContent = `10연 소환 (💎${pull10Cost})`
    const exBtn = document.createElement('button'); exBtn.className = 'bg-btn'; exBtn.textContent = `카운트 ${D.GEM.countPerGem.toLocaleString()} → 💎1`
    const colBtn = document.createElement('button'); colBtn.className = 'bg-btn'; colBtn.textContent = '📚 컬렉션'
    const rateBtn = document.createElement('button'); rateBtn.className = 'bg-btn'; rateBtn.textContent = '🎲 확률'
    rateBtn.onclick = () => openRates()
    controls.append(pullBtn, pull10Btn, exBtn, colBtn, rateBtn); card.appendChild(controls)

    let rolling = false
    function syncButtons() {
      pullBtn.disabled = rolling || G.getGems() < D.GEM.pullCost
      pull10Btn.disabled = rolling || G.getGems() < pull10Cost
      exBtn.disabled = rolling || !(countBridge && countBridge.get() >= D.GEM.countPerGem)
    }
    syncButtons()

    pullBtn.onclick = () => {
      const res = G.roll(); if (!res) { syncButtons(); return }
      refreshWallet(wallet); syncButtons()
      playReveal(stage, res)
    }
    pull10Btn.onclick = () => {
      if (G.getGems() < pull10Cost) { syncButtons(); return }
      const results = []
      for (let i = 0; i < 10; i++) { const r = G.roll(); if (!r) break; results.push(r) }
      if (!results.length) { syncButtons(); return }
      refreshWallet(wallet)
      rolling = true; syncButtons()
      playReveal10(stage, results, () => { rolling = false; syncButtons() })
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

  // 10연 소환: 개별 연출을 순차 재생 + SKIP. 단, 전설이 포함돼 있으면 SKIP을 눌러도
  // 아직 안 본 전설 연출은 마저 보여주고(전설급만) 결과 그리드로 넘어간다. onDone 호출 시 버튼 재활성.
  function revealWait(res) { const anim = res.rarity.anim; return (anim === 'flash' ? 260 : anim === 'beam' ? 420 : anim === 'swirl' ? 620 : 780) + 820 }
  function playReveal10(stage, results, onDone) {
    let idx = 0, timer = null, done = false, phase = 'seq'   // seq: 전체 순차 / legend: SKIP 후 전설만
    const skip = document.createElement('div'); skip.className = 'bg-skip'; skip.textContent = 'SKIP ⏭'
    function toGrid() {
      if (done) return; done = true
      if (timer) { clearTimeout(timer); timer = null }
      showResultGrid(stage, results)
      if (onDone) onDone()
    }
    function stepOne() {
      if (done || phase !== 'seq') return
      if (idx >= results.length) { toGrid(); return }
      const res = results[idx++]
      playReveal(stage, res)               // stage 를 비우고 이번 결과 연출
      stage.appendChild(skip)              // SKIP 다시 부착(연출 위)
      const cnt = document.createElement('div'); cnt.className = 'bg-pullcount'; cnt.textContent = `${idx} / ${results.length}`; stage.appendChild(cnt)
      timer = setTimeout(stepOne, revealWait(res))
    }
    // SKIP: 전설 연출 중 다시 누르면 즉시 결과. 순차 중이면 아직 안 본 전설만 마저 재생 후 결과.
    function onSkip() {
      if (done) return
      if (phase === 'legend') { toGrid(); return }
      if (timer) { clearTimeout(timer); timer = null }
      const legs = results.slice(idx).filter((r) => r.entry && r.entry.rarity === 'legend')   // 아직 안 본 전설
      if (!legs.length) { toGrid(); return }
      phase = 'legend'
      let li = 0
      function nextLeg() {
        if (done) return
        if (li >= legs.length) { toGrid(); return }
        const res = legs[li++]
        playReveal(stage, res); stage.appendChild(skip)
        const tag = document.createElement('div'); tag.className = 'bg-pullcount'; tag.textContent = `✨ 전설 ${li} / ${legs.length}`; stage.appendChild(tag)
        timer = setTimeout(nextLeg, revealWait(res))
      }
      nextLeg()
    }
    skip.onclick = onSkip
    stepOne()
  }

  // 10개 획득 결과를 상단 5 / 하단 5 그리드로 한 번에 표시
  function showResultGrid(stage, results) {
    stage.innerHTML = ''
    const grid = document.createElement('div'); grid.className = 'bg-pull-grid'
    results.forEach((res) => {
      const col = res.rarity.color
      const cell = document.createElement('div'); cell.className = 'bg-pull-cell' + (res.dup ? '' : ' isnew')
      cell.style.borderColor = col + '88'
      cell.innerHTML =
        (res.dup ? '' : '<div class="newtag">NEW</div>') +
        `<div class="bg-pull-ic">${iconFor(res.entry, 30)}</div>` +
        `<div class="bg-pull-nm">${res.entry.name}</div>` +
        `<div class="bg-pull-bd" style="color:${col}">${res.rarity.name}</div>` +
        `<div class="bg-pull-sub">${res.dup ? `🔩+${res.material}` : '✨ 신규'}</div>`
      grid.appendChild(cell)
    })
    stage.appendChild(grid)
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
    .bg-upgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .bg-upc{display:flex;flex-direction:column;gap:5px;background:#1c2029;border:1px solid #2b2f39;border-radius:10px;padding:9px 10px}
    .bg-upc.can{border-color:#3f7ce8;box-shadow:0 0 0 1px rgba(63,124,232,.45)}
    .bg-upc.max{opacity:.62}
    .bg-upc .top{display:flex;align-items:center;gap:7px}
    .bg-upc .top .ic{font-size:22px;line-height:1}
    .bg-upc .nm{flex:1;min-width:0;font-size:12px;color:#e8ebf0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bg-upc .lv{font-size:10px;color:#ffcf3a;white-space:nowrap}
    .bg-upc .dots{font-size:10px;letter-spacing:2px;line-height:1}
    .bg-upc .ue{font-size:10px;color:#9aa0ab;line-height:1.3;min-height:26px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .bg-upc .act{margin-top:auto}
    .bg-upc .act .bg-btn,.bg-upc .act .maxlbl{width:100%;box-sizing:border-box;text-align:center}
    .bg-upc .maxlbl{display:block;font-size:11px;color:#8fd3ff;padding:5px 0;border:1px solid #2b2f39;border-radius:8px}
    .bg-dsub{font-size:10px;color:#8fd3ff;margin:1px 0 3px}
    .bg-wbox{border-top:1px solid #2b2f39;margin-top:8px;padding-top:7px}
    .bg-slot.wslot{border-color:#3f7ce8;background:#141c2a}
    .bg-slot.filled.wslot{background:rgba(74,163,255,.16)}
    `
    document.head.appendChild(st)
  }

  // ── 소환 확률 팝업 (희귀도 태그별 + 개별 확률) ──────────────────────────
  function openRates() {
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">🎲 소환 확률</div><button class="bg-x">✕</button></div>` +
      `<div class="bg-sub" style="margin-bottom:8px">희귀도(tier) 확률로 먼저 뽑고, 같은 등급 안에서는 균등 분배</div>`
    card.querySelector('.bg-x').onclick = close
    const pool = D.gachaPool()
    const order = ['legend', 'rare', 'uncommon', 'common']
    order.forEach((rk) => {
      const info = D.RARITY[rk], items = pool.filter((e) => e.rarity === rk)
      if (!items.length) return
      const per = info.weight / items.length
      const h = document.createElement('div'); h.className = 'bg-rgroup'
      h.style.cssText = 'display:flex;justify-content:space-between;margin-top:10px'
      h.innerHTML = `<span style="color:${info.color};font-weight:600">${info.name}</span><span style="color:${info.color}">${info.weight}%</span>`
      card.appendChild(h)
      items.forEach((e) => {
        const row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 2px;border-bottom:1px solid #23272f'
        row.innerHTML = `<span style="width:26px;text-align:center">${iconFor(e, 22)}</span><span style="flex:1;font-size:13px;color:#e8ebf0">${e.name}</span><span style="font-size:12px;color:#9aa0ab">${(per < 1 ? per.toFixed(2) : per.toFixed(1))}%</span>`
        card.appendChild(row)
      })
    })
    mount(back)
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
      const slotHtml = (id, kind) => id
        ? `<div class="bg-slot filled ${kind === 'w' ? 'wslot' : ''}" title="${(D.UNITS[id] || D.WEAPONS[id]).name}">${iconFor(id, 34)}<button class="rm" data-rm="${id}">✕</button></div>`
        : `<div class="bg-slot ${kind === 'w' ? 'wslot' : ''}"></div>`
      const front = unitSlots.slice(0, 5), back = unitSlots.slice(5, 10)
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
          <div class="bg-dsub">🐜 소환체 · 앞줄(활성)</div>
          <div class="bg-slots" style="margin-bottom:5px">${front.map((id) => slotHtml(id, 'u')).join('')}</div>
          <div class="bg-dsub">🐜 소환체 · 뒷줄(벤치 — 배틀 중 스왑)</div>
          <div class="bg-slots" style="margin-bottom:8px">${back.map((id) => slotHtml(id, 'u')).join('')}</div>
          <div class="bg-wbox"><div class="bg-dsub" style="color:#9fd3ff">⚔ 무기</div>
          <div class="bg-slots">${wpnSlots.map((id) => slotHtml(id, 'w')).join('')}</div></div>
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
    let upCat = 'unit'   // 업그레이드 카테고리 필터(소환체/무기)
    let upRar = 'all'    // 희귀도 필터 — 종류 많아짐 대비
    const RRANK = { legend: 0, rare: 1, uncommon: 2, common: 3 }

    function render() {
      const cnt = countBridge ? countBridge.get() : 0
      const buyRow = `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <div class="bg-chip" style="flex:1">💎 젬 구매 — ${D.GEM.countPerGem.toLocaleString()} 카운트 = 💎1</div>
        <button class="bg-btn primary" id="buygem" ${cnt < D.GEM.countPerGem ? 'disabled' : ''}>💎1 구매</button></div>`
      const hpRow = ''   // 오버레이 캐릭터 체력 개념 제거 → 체력 리셋 상품 삭제
      const catBtns = [['unit', '🐜 소환체'], ['weapon', '⚔ 무기']]
        .map(([k, n]) => `<button class="bg-fbtn ${upCat === k ? 'on' : ''}" data-uc="${k}">${n}</button>`).join('')
      const rarBtns = [['all', '전체'], ['common', '일반'], ['uncommon', '고급'], ['rare', '희귀'], ['legend', '전설']]
        .map(([k, n]) => `<button class="bg-fbtn ${upRar === k ? 'on' : ''}" data-ur="${k}" style="${upRar === k && k !== 'all' ? 'border-color:' + D.RARITY[k].color : ''}">${n}</button>`).join('')

      let ups = '', canCount = 0
      if (U) {
        let owned = G.catalog().filter((e) => e.owned && U.spec(e.id) && e.cat === upCat)
        if (upRar !== 'all') owned = owned.filter((e) => e.rarity === upRar)
        // 정렬: 지금 강화 가능(부품 충분) → 강화 여지 있음(부품 부족) → MAX. 동순위는 희귀도(전설 먼저)·이름.
        const stateOf = (e) => { const c = U.costToNext(e.id); if (c == null) return 2; return U.canUpgrade(e.id) ? 0 : 1 }
        owned.sort((a, b) => stateOf(a) - stateOf(b) || (RRANK[a.rarity] - RRANK[b.rarity]) || a.name.localeCompare(b.name))
        canCount = owned.filter((e) => U.canUpgrade(e.id)).length
        ups = owned.map((e) => {
          const lv = G.getLevel(e.id), cost = U.costToNext(e.id), can = U.canUpgrade(e.id), max = cost == null
          const info = D.RARITY[e.rarity]
          const dots = Array.from({ length: U.maxLevel() }, (_, i) => i < lv ? '●' : '○').join('')
          const act = max ? `<span class="maxlbl">MAX</span>`
            : `<button class="bg-btn" data-up="${e.id}" ${can ? '' : 'disabled'}>강화 🔩${cost}</button>`
          return `<div class="bg-upc ${can ? 'can' : ''} ${max ? 'max' : ''}" style="border-left:3px solid ${info.color}">
            <div class="top"><span class="ic">${iconFor(e, 24)}</span><span class="nm">${e.name}</span><span class="lv">Lv.${lv}/${U.maxLevel()}</span></div>
            <div class="dots" style="color:${info.color}">${dots}</div>
            <div class="ue">${U.effectSummary(e.id)}</div>
            <div class="act">${act}</div></div>`
        }).join('')
      }
      const badge = `<span class="bg-fbtn" style="cursor:default;font-size:11px;padding:2px 9px;${canCount ? 'background:#2f6bd8;border-color:#3f7ce8;color:#fff' : ''}">강화 가능 ${canCount}개</span>`
      body.innerHTML = walletRow().outerHTML + buyRow + hpRow +
        `<div class="bg-rgroup" style="margin:6px 0;display:flex;align-items:center;gap:8px">🔩 업그레이드 ${badge}</div>` +
        `<div class="bg-filters" style="margin-bottom:6px">${catBtns}</div>` +
        `<div class="bg-filters" style="margin-bottom:8px">${rarBtns}</div>` +
        `${ups ? `<div class="bg-upgrid">${ups}</div>` : `<div class="bg-sub">해당하는 ${upCat === 'weapon' ? '무기' : '소환체'}가 없어요</div>`}`

      const bg = body.querySelector('#buygem')
      if (bg) bg.onclick = () => { if (countBridge && countBridge.get() >= D.GEM.countPerGem) { countBridge.spend(D.GEM.countPerGem); G.addGems(1); render() } }
      body.querySelectorAll('[data-uc]').forEach((b) => b.onclick = () => { upCat = b.dataset.uc; render() })
      body.querySelectorAll('[data-ur]').forEach((b) => b.onclick = () => { upRar = b.dataset.ur; render() })
      body.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { if (U) { U.upgrade(b.dataset.up); render() } })
    }
    render()
    mount(back)
  }

  // ── 스프라이트 미리보기 (dev·앱 실렌더 확인) ────────────────────────────
  function openSpritePreview() {
    if (!window.BattleSprites) return
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; card.style.width = 'min(520px,94vw)'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">🎨 스프라이트 미리보기</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close
    const cv = document.createElement('canvas'); cv.width = 480; cv.height = 300; cv.style.cssText = 'width:100%;background:#1b1d22;border-radius:8px'; card.appendChild(cv)
    const g = cv.getContext('2d')
    const units = ['rifleman', 'grenadier', 'shielder', 'scout', 'kamikaze', 'medic']
    const seq = ['walk', 'attack', 'hit', 'death']
    let t0 = null
    function loop(ts) {
      if (!document.body.contains(back)) return   // 닫히면 정지
      if (t0 == null) t0 = ts
      const t = (ts - t0) / 1000
      g.clearRect(0, 0, cv.width, cv.height)
      units.forEach((u, i) => { const cx = 44 + i * 72; g.strokeStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.moveTo(cx - 26, 120); g.lineTo(cx + 32, 120); g.stroke(); window.BattleSprites.draw(g, u, { x: cx, y: 120, scale: 2.0, state: 'walk', t: t + i * 0.13 }) })
      const st = seq[Math.floor(t / 1.2) % 4], lt = t % 1.2
      units.forEach((u, i) => { const cx = 44 + i * 72; g.strokeStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.moveTo(cx - 26, 250); g.lineTo(cx + 32, 250); g.stroke(); window.BattleSprites.draw(g, u, { x: cx, y: 250, scale: 2.2, state: st, t: lt, flash: st === 'attack', deathT: st === 'death' ? Math.min(1, lt / 1.1) : 0 }) })
      g.fillStyle = '#9aa0ab'; g.font = '11px system-ui'; g.fillText('걷기', 6, 60); g.fillText(st, 6, 190)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
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
      if (window.__startBattle || window.BattleMode) {
        const tb = document.createElement('button'); tb.className = 'bg-btn primary'; tb.textContent = '⚔ 솔로 배틀 테스트'
        tb.style.cssText = 'width:100%;margin-bottom:8px'
        tb.onclick = () => { close(); (window.__startBattle ? window.__startBattle() : window.BattleMode.startSolo()) }
        body.appendChild(tb)
      }
      if (window.BattleSprites) {
        const sb = document.createElement('button'); sb.className = 'bg-btn'; sb.textContent = '🎨 스프라이트 미리보기'
        sb.style.cssText = 'width:100%;margin-bottom:10px'
        sb.onclick = () => { close(); openSpritePreview() }
        body.appendChild(sb)
      }
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
        const nameRow = document.createElement('div'); nameRow.style.cssText = 'flex:1 0 100%;display:flex;align-items:center;gap:6px'
        nameRow.innerHTML = `<span style="flex:1;font-size:12px;color:#e8ebf0">${p.name || ('#' + p.id)}</span>`
        const chal = document.createElement('button'); chal.className = 'bg-btn'; chal.textContent = '⚔ 배틀 신청'; chal.style.cssText = 'padding:5px 9px;font-size:12px;background:#2f6bd8;border-color:#3f7ce8'
        chal.onclick = () => { if (window.__battleRequest) window.__battleRequest(p.id); close() }
        nameRow.appendChild(chal); row.appendChild(nameRow)
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

  // ── 무기 설정(오버레이 단축키 슬롯) — 컬렉션 UI 재사용(희귀도 그룹·필터·아이콘·? 설명) ──
  function catEntry(id) { return D.UNITS[id] ? { id, ...D.UNITS[id] } : (D.WEAPONS[id] ? { id, ...D.WEAPONS[id] } : { id, name: id, rarity: 'common' }) }
  function openWeaponSlots() {
    ensureStyle2()
    const B = bridges
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">⚔ 무기 설정 · 단축키 슬롯</div><button class="bg-x">✕</button></div>` +
      `<div class="bg-sub" style="margin-bottom:8px">슬롯을 고른 뒤(위) 아래에서 무기/소환체를 탭하면 그 단축키에 배정돼요. 🔒 = 미획득.</div>`
    card.querySelector('.bg-x').onclick = close
    const body = document.createElement('div'); card.appendChild(body)
    let fCat = 'weapon', fRar = 'all', sel = 0
    const RORDER = ['legend', 'rare', 'uncommon', 'common']
    function cellHtml(e, slots, keys) {
      const info = D.RARITY[e.rarity] || D.RARITY.common, si = slots.indexOf(e.id), inSlot = si >= 0
      const tag = e.cat === 'weapon' ? '무기' : `코스트 ${e.cost}`
      return `<div class="bg-cell ${e.owned ? '' : 'locked'} ${inSlot ? 'indeck' : ''}" data-id="${e.id}" title="${e.name}" style="border-color:${e.owned ? info.color : '#2b2f39'};background:${e.owned ? info.color + '18' : '#1c2029'}">
        <button class="bg-help" data-help="${e.id}" title="설명">?</button>
        <div class="e">${iconFor(e, 36)}</div><div class="n">${e.name}</div>` +
        (e.owned ? `<div class="lv">${tag}</div>${inSlot ? `<div class="dk">${keys[si]}</div>` : ''}` : `<div class="lk">🔒 미획득</div>`) + `</div>`
    }
    function render() {
      const st = (B.weaponSlots ? B.weaponSlots() : { keys: ['', '', ''], slots: ['none', 'none', 'none'] })
      const slots = st.slots, keys = st.keys
      // 상단: 단축키 슬롯 3칸
      const slotChips = slots.map((id, i) => {
        const has = id && id !== 'none', e = has ? catEntry(id) : null, on = sel === i
        return `<div class="wl-slot ${on ? 'on' : ''}" data-slot="${i}" style="flex:1;min-width:0;cursor:pointer;border-radius:10px;padding:7px 5px;text-align:center;background:${on ? 'rgba(74,163,255,.16)' : '#1c2029'};border:1px solid ${on ? '#4aa3ff' : '#2b2f39'};position:relative">
          <div style="font-size:10px;color:#ffd86b;font-weight:700">${keys[i] || '-'}</div>
          <div style="height:30px;display:flex;align-items:center;justify-content:center;margin-top:2px">${has ? iconFor(e, 28) : '<span style="color:#5f6b7a;font-size:20px">·</span>'}</div>
          <div style="font-size:10px;color:#cfd4de;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${has ? e.name : '비어있음'}</div>
          ${has ? `<button class="wl-clr" data-clr="${i}" title="비우기" style="position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:50%;background:#c0392b;color:#fff;border:none;font-size:11px;cursor:pointer;line-height:1">✕</button>` : ''}
        </div>`
      }).join('')
      const catBtns = [['weapon', '⚔ 무기'], ['unit', '🐜 소환체']]
        .map(([k, n]) => `<button class="bg-fbtn ${fCat === k ? 'on' : ''}" data-fc="${k}">${n}</button>`).join('')
      const rarBtns = [['all', '전체'], ['common', '일반'], ['uncommon', '고급'], ['rare', '희귀'], ['legend', '전설']]
        .map(([k, n]) => `<button class="bg-fbtn ${fRar === k ? 'on' : ''}" data-fr="${k}" style="${fRar === k && k !== 'all' ? 'border-color:' + D.RARITY[k].color : ''}">${n}</button>`).join('')
      const items = G.catalog().filter((e) => e.cat === fCat && (!B.slotEligible || B.slotEligible(e.id)))
      let listHtml
      if (fRar === 'all') {
        listHtml = RORDER.map((rk) => { const info = D.RARITY[rk], gi = items.filter((e) => e.rarity === rk); if (!gi.length) return ''
          return `<div class="bg-rgroup" style="color:${info.color};font-weight:600;margin-top:10px">${info.name} · ${gi.filter((i) => i.owned).length}/${gi.length}</div><div class="bg-grid">${gi.map((e) => cellHtml(e, slots, keys)).join('')}</div>` }).join('')
      } else { const gi = items.filter((e) => e.rarity === fRar); listHtml = gi.length ? `<div class="bg-grid">${gi.map((e) => cellHtml(e, slots, keys)).join('')}</div>` : '<div class="bg-sub">해당 희귀도 없음</div>' }
      body.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:10px">${slotChips}</div>
        <div class="bg-filters">${catBtns}</div><div class="bg-filters">${rarBtns}</div>${listHtml}`
      body.querySelectorAll('[data-slot]').forEach((el) => el.onclick = () => { sel = +el.dataset.slot; render() })
      body.querySelectorAll('[data-clr]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); if (B.setWeaponSlot) B.setWeaponSlot(+b.dataset.clr, 'none'); render() })
      body.querySelectorAll('[data-fc]').forEach((b) => b.onclick = () => { fCat = b.dataset.fc; render() })
      body.querySelectorAll('[data-fr]').forEach((b) => b.onclick = () => { fRar = b.dataset.fr; render() })
      body.querySelectorAll('[data-help]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); openInfo(b.dataset.help) })
      body.querySelectorAll('.bg-cell[data-id]').forEach((c) => c.onclick = () => {
        const id = c.dataset.id
        if (B.slotUsable && !B.slotUsable(id)) { flashMsg(card, '🔒 미획득 — 가챠/상점에서 먼저 획득'); return }
        if (B.setWeaponSlot) B.setWeaponSlot(sel, id); sel = (sel + 1) % 3; render()
      })
    }
    render(); mount(back)
  }

  // ── 방 정보(멀티 접속자 목록 + 배틀 신청) ────────────────────────────────
  function openRoomInfo() {
    const { back, close } = makeBack()
    const card = document.createElement('div'); card.className = 'bg-card'; card.style.width = 'min(420px,92vw)'; back.appendChild(card)
    card.innerHTML = `<div class="bg-head"><div class="bg-title">📋 방 정보</div><button class="bg-x">✕</button></div>`
    card.querySelector('.bg-x').onclick = close
    const body = document.createElement('div'); card.appendChild(body)
    function rec(w, p) { const l = Math.max(0, (p || 0) - (w || 0)); return `${w || 0}승 ${l}패` }
    function row(e, isMe) {
      const r = document.createElement('div')
      r.style.cssText = `display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:${isMe ? 'rgba(74,163,255,.1)' : '#1c2029'};border:1px solid ${isMe ? '#3f7ce8' : '#2b2f39'};margin-bottom:6px`
      r.innerHTML = `<div style="flex:1;min-width:0">
          <div style="font-size:14px;color:#e8ebf0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.name}${isMe ? ' <span style="color:#8fd3ff;font-size:11px">(나)</span>' : ''}</div>
          <div style="font-size:11px;color:#9aa0ab;margin-top:2px">🪙 ${fmtNum(e.count)} · ⚔ ${rec(e.wins, e.plays)}</div>
        </div>`
      if (!isMe) { const b = document.createElement('button'); b.className = 'bg-btn'; b.textContent = '⚔ 배틀 신청'; b.style.cssText = 'padding:8px 12px;font-size:13px;background:#2f6bd8;border-color:#3f7ce8;white-space:nowrap'; b.onclick = () => { close(); if (bridges.challenge) bridges.challenge(e.id) }; r.appendChild(b) }
      return r
    }
    function render() {
      const info = bridges.roomInfo ? bridges.roomInfo() : null
      body.innerHTML = ''
      if (!info || !info.connected) { body.innerHTML = '<div class="bg-sub">멀티에 접속되어 있지 않아요. 방에 접속하면 참가자가 표시됩니다.</div>'; return }
      body.appendChild(row(info.me, true))
      if (!info.peers.length) { const d = document.createElement('div'); d.className = 'bg-sub'; d.style.marginTop = '4px'; d.textContent = '접속한 다른 유저가 없어요'; body.appendChild(d) }
      else { const h = document.createElement('div'); h.className = 'bg-rgroup'; h.textContent = `상대 ${info.peers.length}명 — ⚔로 배틀 신청(베팅 선택)`; body.appendChild(h); info.peers.forEach((p) => body.appendChild(row(p, false))) }
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
      ['📋 방 정보', () => openRoomInfo()],
      ['⚙ 설정', () => (bridges.settings ? bridges.settings() : flashMsg(card, '설정 연결 예정'))],
    ]
    if (dev) items.push(['🛠️ 개발자 (재화)', () => openDevPanel()])
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px'
    items.forEach(([label, fn]) => { const b = document.createElement('button'); b.className = 'bg-btn'; b.textContent = label; b.style.textAlign = 'left'; b.onclick = () => { close(); fn() }; wrap.appendChild(b) })
    // 액션 행(위): [소환체 제거] — 왼쪽부터 채우고 한 줄을 다 쓰진 않음(버튼 추가 여지)
    const arow = document.createElement('div'); arow.style.cssText = 'display:flex;gap:6px;margin-top:6px'
    const clr = document.createElement('button'); clr.className = 'bg-btn'; clr.textContent = '🧹 소환체 제거'
    clr.style.cssText = 'padding:9px 12px;font-size:13px;flex:0 0 auto'
    clr.onclick = () => { if (bridges.clearSummons) bridges.clearSummons(); close() }
    arow.appendChild(clr)
    wrap.appendChild(arow)
    // 하단 자주 쓰는 기능 행: [땅 복구] [화면 전환] [종료(위험 색)]
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;margin-top:6px'
    const restore = document.createElement('button'); restore.className = 'bg-btn'; restore.textContent = '🧱 땅 복구'
    restore.style.cssText = 'flex:1;padding:9px 4px;font-size:13px'
    restore.onclick = () => { if (bridges.restoreBar) bridges.restoreBar(); close() }
    const view = document.createElement('button'); view.className = 'bg-btn'; view.textContent = '🖥 화면 전환'
    view.style.cssText = 'flex:1;padding:9px 4px;font-size:13px'
    view.onclick = () => { if (bridges.switchView) bridges.switchView(); close() }
    const quit = document.createElement('button'); quit.className = 'bg-btn'; quit.textContent = '⏻ 종료'
    quit.style.cssText = 'flex:1;padding:9px 4px;font-size:13px;border-color:#7a2b2b;background:#3a1e1e;color:#ff9a9a'
    quit.onclick = () => { if (bridges.quit) bridges.quit(); else close() }
    row.append(restore, view, quit)
    wrap.appendChild(row)
    card.appendChild(wrap)
    mount(back)
  }

  window.BattleGachaUI = { openGacha, openCollection, openShop, openMenu, openRoomInfo, openWeaponSlots, openDevPanel, openSpritePreview, setCountBridge, setHpBridge, setBridges, setDev, setDevContext }
})()
