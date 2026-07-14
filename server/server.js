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
  return [...room.entries()].map(([id, p]) => ({ id, name: p.name, animal: p.animal, skin: p.skin, pattern: p.pattern, hat: p.hat }))
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
  const addr = (req && req.socket && req.socket.remoteAddress) || ''
  const isHost = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'

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
        hat: String(msg.hat || 'none').slice(0, 12)
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
      broadcast(joinedRoom, { t: 'pos', id, nx: msg.nx, ny: msg.ny, taps: msg.taps }, id)
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
      broadcast(joinedRoom, { t: 'hit', id, target: msg.target, power: msg.power }, id)
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
