// Bongo Friends relay server — small rooms joined by code.
// Relays only anonymous input pulses ({ kind: 'key' | 'mouse' }); key identity never reaches the wire.
const { WebSocketServer } = require('ws')

const PORT = process.env.PORT || 8787
const MAX_ROOM_SIZE = 12

const wss = new WebSocketServer({ port: PORT })
const rooms = new Map() // code -> Map<id, { ws, name, animal }>

let nextId = 1

function roster(code) {
  const room = rooms.get(code)
  if (!room) return []
  return [...room.entries()].map(([id, p]) => ({ id, name: p.name, animal: p.animal, skin: p.skin, pattern: p.pattern, hat: p.hat, shape: p.shape }))
}

function broadcast(code, msg, exceptId = null) {
  const room = rooms.get(code)
  if (!room) return
  const data = JSON.stringify(msg)
  for (const [id, p] of room) {
    if (id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(data)
  }
}

wss.on('connection', (ws, req) => {
  const id = nextId++
  let joinedRoom = null
  // The client running on the SAME machine as the server (loopback) is the HOST — they get all
  // weapons unlocked. Remote friends connect from other IPs, so they can't fake it.
  const raw = (req && req.socket && req.socket.remoteAddress) || ''
  const addr = raw.replace(/^::ffff:/, '')   // normalize IPv4-mapped IPv6 (::ffff:127.0.0.1 → 127.0.0.1)
  const isHost = addr === '::1' || addr === '127.0.0.1' || addr.startsWith('127.')
  console.log(`[conn ${id}] from ${raw || '(unknown)'} -> host=${isHost}`)

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.t === 'join' && typeof msg.room === 'string' && !joinedRoom) {
      const code = msg.room.trim().toUpperCase().slice(0, 16)
      if (!code) return
      if (!rooms.has(code)) rooms.set(code, new Map())
      const room = rooms.get(code)
      if (room.size >= MAX_ROOM_SIZE) {
        ws.send(JSON.stringify({ t: 'error', reason: 'room_full' }))
        return
      }
      room.set(id, {
        ws,
        name: String(msg.name || '???').slice(0, 20),
        animal: String(msg.animal || 'cat').slice(0, 12),
        skin: String(msg.skin || 'default').slice(0, 12),
        pattern: String(msg.pattern || 'solid').slice(0, 12),
        hat: String(msg.hat || 'none').slice(0, 12),
        shape: String(msg.shape || '').slice(0, 48)
      })
      joinedRoom = code
      ws.send(JSON.stringify({ t: 'joined', id, room: code, max: MAX_ROOM_SIZE, host: isHost }))
      broadcast(code, { t: 'roster', peers: roster(code) })
      console.log(`[room ${code}] +${id} (${room.size} in room)`)
      return
    }

    if (!joinedRoom) return
    const room = rooms.get(joinedRoom)
    const me = room && room.get(id)
    if (!me) return

    if (msg.t === 'pos') {
      broadcast(joinedRoom, { t: 'pos', id, nx: msg.nx, ny: msg.ny, taps: msg.taps, hp: msg.hp, away: msg.away, safe: msg.safe, bw: msg.bw, bp: msg.bp }, id)
    } else if (msg.t === 'pulse' && (msg.kind === 'key' || msg.kind === 'mouse')) {
      broadcast(joinedRoom, { t: 'pulse', id, kind: msg.kind }, id)
    } else if (msg.t === 'throw') {
      const now = Date.now()
      if (now - (me.lastThrow || 0) < 300) return // cooldown
      me.lastThrow = now
      broadcast(joinedRoom, { t: 'throw', id, kind: String(msg.kind || 'missile').slice(0, 12) }, id)
    } else if (msg.t === 'missiles' && Array.isArray(msg.list)) {
      // live missile positions (relative to the thrower's cat) so peers can render/collide
      broadcast(joinedRoom, { t: 'missiles', id, list: msg.list.slice(0, 8) }, id)
    } else if (msg.t === 'hit') {
      broadcast(joinedRoom, { t: 'hit', id, target: msg.target, power: msg.power, shock: msg.shock }, id)
    } else if (msg.t === 'shield') {
      broadcast(joinedRoom, { t: 'shield', id, angle: msg.angle, ttl: msg.ttl, hp: msg.hp, max: msg.max, broke: !!msg.broke }, id)
    } else if (msg.t === 'shield-hit') {
      broadcast(joinedRoom, { t: 'shield-hit', id, target: msg.target, power: msg.power }, id)
    } else if (msg.t === 'ants' && Array.isArray(msg.list)) {
      broadcast(joinedRoom, { t: 'ants', id, list: msg.list.slice(0, 5) }, id)
    } else if (msg.t === 'ant-hit') {
      broadcast(joinedRoom, { t: 'ant-hit', id, target: msg.target, ant: msg.ant, dmg: msg.dmg }, id)
    } else if (msg.t === 'blackhole') {
      broadcast(joinedRoom, { t: 'blackhole', id, nx: msg.nx, ny: msg.ny, ttl: msg.ttl }, id)
    } else if (msg.t === 'dig') {
      broadcast(joinedRoom, { t: 'dig', id, nx: msg.nx, power: msg.power }, id)
    } else if (msg.t === 'digreset') {
      broadcast(joinedRoom, { t: 'digreset', id }, id)
    } else if (msg.t === 'gatling') {
      broadcast(joinedRoom, { t: 'gatling', id, active: msg.active, nx: msg.nx, ny: msg.ny, hp: msg.hp, ang: msg.ang }, id)
    } else if (msg.t === 'gbullets' && Array.isArray(msg.list)) {
      broadcast(joinedRoom, { t: 'gbullets', id, list: msg.list.slice(0, 40) }, id)
    } else if (msg.t === 'gat-hit') {
      broadcast(joinedRoom, { t: 'gat-hit', id, target: msg.target, dmg: msg.dmg }, id)
    } else if (msg.t === 'mecha-hit') {
      broadcast(joinedRoom, { t: 'mecha-hit', id, target: msg.target, dmg: msg.dmg }, id)
    } else if (msg.t === 'human-hit') {
      broadcast(joinedRoom, { t: 'human-hit', id, target: msg.target, dmg: msg.dmg, hx: msg.hx, hy: msg.hy }, id)
    } else if (msg.t === 'kill') {
      broadcast(joinedRoom, { t: 'kill', id, kind: msg.kind, by: msg.by, amt: msg.amt }, id)   // credit a destroy to the killer
    } else if (msg.t === 'human') {
      broadcast(joinedRoom, { t: 'human', id, active: msg.active, nx: msg.nx, ny: msg.ny, hp: msg.hp, weapon: msg.weapon, face: msg.face }, id)
    } else if (msg.t === 'mecha') {
      broadcast(joinedRoom, { t: 'mecha', id, active: msg.active, nx: msg.nx, ny: msg.ny, hp: msg.hp, face: msg.face, shield: msg.shield, form: msg.form, thr: msg.thr, ch: msg.ch, chg: msg.chg, mang: msg.mang, sdep: msg.sdep, snx: msg.snx, sny: msg.sny, sang: msg.sang }, id)
    } else if (msg.t === 'mecha-transform') {
      broadcast(joinedRoom, { t: 'mecha-transform', id }, id)
    } else if (msg.t === 'mshells' && Array.isArray(msg.list)) {
      broadcast(joinedRoom, { t: 'mshells', id, list: msg.list.slice(0, 48) }, id)
    } else if (msg.t === 'net') {
      broadcast(joinedRoom, { t: 'net', id, active: msg.active, ph: msg.ph, ax: msg.ax, ay: msg.ay, bx: msg.bx, by: msg.by, sp: msg.sp, items: Array.isArray(msg.items) ? msg.items.slice(0, 12) : [], n: msg.n }, id)
    } else if (msg.t === 'capture') {
      broadcast(joinedRoom, { t: 'capture', id, target: msg.target, kind: msg.kind, eid: msg.eid }, id)   // net stole a peer's collidable
    } else if (msg.t === 'col-dmg') {
      broadcast(joinedRoom, { t: 'col-dmg', id, target: msg.target, kind: msg.kind, eid: msg.eid, dmg: msg.dmg }, id)   // interceptor/collidable damaged a peer's projectile
    } else if (msg.t === 'boom') {
      broadcast(joinedRoom, { t: 'boom', id, chan: msg.chan, eid: msg.eid, nx: msg.nx, ny: msg.ny, pw: msg.pw }, id)   // a projectile was destroyed — everyone shows the same blast
    } else if (msg.t === 'littleboy') {
      broadcast(joinedRoom, { t: 'littleboy', id, nx: msg.nx, ny: msg.ny }, id)   // two nukes fused into a Little Boy at (nx,ny)
    } else if (msg.t === 'healall') {
      broadcast(joinedRoom, { t: 'healall', id }, id)   // dev restored everyone's cat HP
    } else if (msg.t === 'setcur') {
      broadcast(joinedRoom, { t: 'setcur', id, target: msg.target, count: msg.count, gems: msg.gems, mat: msg.mat }, id)   // dev set a user's currency
    } else if (msg.t === 'peace') {
      broadcast(joinedRoom, { t: 'peace', id, on: msg.on }, id)   // dev toggled peace mode (weapons locked for all)
    } else if (msg.t === 'hbullets' && Array.isArray(msg.list)) {
      broadcast(joinedRoom, { t: 'hbullets', id, list: msg.list.slice(0, 30) }, id)
    } else if (msg.t === 'bolt') {
      broadcast(joinedRoom, { t: 'bolt', id, nx: msg.nx, nyTop: msg.nyTop, nyBot: msg.nyBot, level: msg.level }, id)
    } else if (msg.t === 'platforms' && Array.isArray(msg.list)) {
      broadcast(joinedRoom, { t: 'platforms', id, list: msg.list.slice(0, 40) }, id)   // host → peers (authoritative floor list)
    } else if (msg.t === 'platdraw' && Array.isArray(msg.p)) {
      broadcast(joinedRoom, { t: 'platdraw', id, p: msg.p.slice(0, 800) }, id)          // host → peers (live stroke preview)
    } else if (msg.t === 'plathp' && Array.isArray(msg.ups)) {
      broadcast(joinedRoom, { t: 'plathp', id, ups: msg.ups.slice(0, 40) }, id)          // host → peers (platform HP deltas)
    } else if (msg.t === 'plat-hit') {
      broadcast(joinedRoom, { t: 'plat-hit', id, pid: msg.pid, dmg: msg.dmg }, id)        // peer → host (report a platform hit)
    // ── 멀티 배틀 (1v1) ── 대부분 target(to) 지정, 클라가 to===me.netId로 필터
    } else if (msg.t === 'battle-req') {
      broadcast(joinedRoom, { t: 'battle-req', id, to: msg.to, bet: msg.bet || null }, id)   // 신청(+베팅)
    } else if (msg.t === 'battle-acc') {
      broadcast(joinedRoom, { t: 'battle-acc', id, to: msg.to }, id)                          // 수락
    } else if (msg.t === 'bmothfall') {
      broadcast(joinedRoom, { t: 'bmothfall', id, to: msg.to, fx: msg.fx || 0, vdir: msg.vdir || 1, dmg: msg.dmg || 50, split: msg.split || 0 }, id)   // 폭격 나방 격추 낙하 연출
    } else if (msg.t === 'battle-go') {
      broadcast(joinedRoom, { t: 'battle-go', id, to: msg.to, bet: msg.bet || null }, id)     // 신청자 확답(핸드셰이크) → 수락자 side1 시작
    } else if (msg.t === 'battle-cancel') {
      broadcast(joinedRoom, { t: 'battle-cancel', id, to: msg.to }, id)                        // 신청 취소(초대 팝업/수락 대기 정리)
    } else if (msg.t === 'battle-dec') {
      broadcast(joinedRoom, { t: 'battle-dec', id, to: msg.to, reason: msg.reason || '' }, id) // 거절/취소
    } else if (msg.t === 'battle-end') {
      broadcast(joinedRoom, { t: 'battle-end', id, to: msg.to, result: msg.result }, id)      // 종료/이탈(승패)
    } else if (msg.t === 'battle-state') {
      broadcast(joinedRoom, { t: 'battle-state', id, on: !!msg.on, opp: msg.opp || null }, id) // 배틀 참여 상태(관전자 가리기용)
    } else if (msg.t === 'bunits' && Array.isArray(msg.list)) {
      broadcast(joinedRoom, { t: 'bunits', id, to: msg.to, list: msg.list.slice(0, 60), base: msg.base, mana: msg.mana, bsh: msg.bsh, bshU: msg.bshU }, id)  // 내 유닛 목록+기지HP+방어돔 방송
    } else if (msg.t === 'bghit') {
      broadcast(joinedRoom, { t: 'bghit', id, to: msg.to, uid: msg.uid, dmg: msg.dmg, slow: msg.slow, slowDur: msg.slowDur, kb: msg.kb, kbBig: msg.kbBig }, id) // 상대 유닛 피격(소유자 적용, kbBig=쉴드 파열 큰 넉백)
    } else if (msg.t === 'bbhit') {
      broadcast(joinedRoom, { t: 'bbhit', id, to: msg.to, dmg: msg.dmg }, id)                 // 상대 기지 피격(소유자 적용)
    // ── 배틀/오버레이 연출·지형 릴레이(전부 상대 화면에도 동일하게 보이게) ──
    } else if (msg.t === 'bshot') {
      broadcast(joinedRoom, { t: 'bshot', id, to: msg.to, k: msg.k, x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, ay: msg.ay, life: msg.life }, id)   // 배틀 유닛 투사체 연출
    } else if (msg.t === 'bbomber') {
      broadcast(joinedRoom, { t: 'bbomber', id, to: msg.to, x: msg.x }, id)                   // 배틀 폭격 연출
    } else if (msg.t === 'obomber') {
      broadcast(joinedRoom, { t: 'obomber', id, nx: msg.nx }, id)                             // 오버레이 폭격 연출(방 전체)
    } else if (msg.t === 'bdig') {
      broadcast(joinedRoom, { t: 'bdig', id, to: msg.to, nx: msg.nx, power: msg.power }, id)  // 배틀 지형 파임(상대만)
    } else if (msg.t === 'bdigreset') {
      broadcast(joinedRoom, { t: 'bdigreset', id, to: msg.to }, id)                           // 배틀 땅 복구(상대)
    } else if (msg.t === 'bcannon') {
      broadcast(joinedRoom, { t: 'bcannon', id, to: msg.to }, id)                             // 베이스 캐논 스윕 연출
    } else if (msg.t === 'btitanlaser') {
      broadcast(joinedRoom, { t: 'btitanlaser', id, to: msg.to, fx: msg.fx, tx: msg.tx }, id) // 타이탄 레이저 연출
    } else if (msg.t === 'bnetgrab') {
      broadcast(joinedRoom, { t: 'bnetgrab', id, to: msg.to, uid: msg.uid }, id)              // 그물 포획(상대 유닛 정지+숨김)
    } else if (msg.t === 'bflak') {
      broadcast(joinedRoom, { t: 'bflak', id, to: msg.to, uid: msg.uid, fx: msg.fx, salvo: msg.salvo }, id)  // 대공포 요격 미사일 연출
    } else if (msg.t === 'sproj') {
      broadcast(joinedRoom, { t: 'sproj', id, nx: msg.nx, ny: msg.ny, vx: msg.vx, vy: msg.vy, k: msg.k, ay: msg.ay, life: msg.life }, id)   // 오버레이 소환체 투사체 연출
    } else if (msg.t === 'chat' && typeof msg.text === 'string') {
      const now = Date.now()
      if (now - (me.lastChat || 0) < 400) return // spam guard
      const text = msg.text.trim().slice(0, 80)
      if (!text) return
      me.lastChat = now
      broadcast(joinedRoom, { t: 'chat', id, text }, id)
    } else if (msg.t === 'update') {
      if (typeof msg.name === 'string') me.name = msg.name.slice(0, 20)
      if (typeof msg.animal === 'string') me.animal = msg.animal.slice(0, 12)
      if (typeof msg.skin === 'string') me.skin = msg.skin.slice(0, 12)
      if (typeof msg.pattern === 'string') me.pattern = msg.pattern.slice(0, 12)
      if (typeof msg.hat === 'string') me.hat = msg.hat.slice(0, 12)
      if (typeof msg.shape === 'string') me.shape = msg.shape.slice(0, 48)
      broadcast(joinedRoom, { t: 'roster', peers: roster(joinedRoom) })
    }
  })

  ws.on('close', () => {
    if (!joinedRoom) return
    const room = rooms.get(joinedRoom)
    if (!room) return
    room.delete(id)
    console.log(`[room ${joinedRoom}] -${id} (${room.size} in room)`)
    if (room.size === 0) rooms.delete(joinedRoom)
    else broadcast(joinedRoom, { t: 'roster', peers: roster(joinedRoom) })
  })
})

console.log(`Bongo Friends relay listening on ws://0.0.0.0:${PORT}`)
