// Cute bongo-cat, vector drawn. Cat only.
// Public API: draw / CELL_W / CELL_H / SLAP_MS / SKINS / HATS / PATTERNS / anchors / DEFAULT_FEAT
(function () {
  const LINE = '#43404c'
  const CAT = { body: '#fbfbfd', belly: '#ffffff', ear: '#fbfbfd', earIn: '#ffc2d1' }

  const CELL_W = 240
  const BUBBLE_H = 10
  const DESK_Y = 152
  const BAR_VIS = 54
  const CELL_H = BUBBLE_H + DESK_Y + BAR_VIS
  const SLAP_MS = 140

  const SKINS = {
    default: null, cream: '#f3e2c2', gray: '#b9bec8', brown: '#c79a6d',
    black: '#5a5762', orange: '#f0b27a', pink: '#f7bcd0', mint: '#b6e3d4', lavender: '#d0c2ec'
  }
  const HATS = ['none', 'beanie', 'party', 'crown', 'tophat', 'cap']
  const PATTERNS = ['solid', 'tabby', 'tuxedo', 'spotted', 'point']

  // per-feature position nudges the user can drag in edit mode
  const DEFAULT_FEAT = { earDX: 0, earDY: 0, eyeDX: 0, eyeDY: 0, tailDX: 0, tailDY: 0 }

  // ---------- color helpers ----------
  function parseColor(c) {
    if (c[0] === '#') {
      let h = c.slice(1)
      if (h.length === 3) h = h.split('').map(x => x + x).join('')
      const n = parseInt(h, 16)
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    }
    const m = c.match(/rgba?\(([^)]+)\)/)
    if (m) { const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2] } }
    return { r: 250, g: 250, b: 252 }
  }
  function shade(color, amt) {
    const { r, g, b } = parseColor(color)
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt)
    const mix = (c) => Math.round(c + (t - c) * p)
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`
  }

  // ---------- primitives ----------
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r) }
  function ink(ctx, fill, lw) {
    if (fill) { ctx.fillStyle = fill; ctx.fill() }
    ctx.strokeStyle = LINE; ctx.lineWidth = lw || 3; ctx.lineJoin = 'round'; ctx.stroke()
  }
  function volume(ctx, base, x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.4, r * 0.1, x, y, r * 1.05)
    g.addColorStop(0, shade(base, 0.16)); g.addColorStop(0.6, base); g.addColorStop(1, shade(base, -0.10))
    return g
  }
  function slapProgress(lastSlap, now) {
    if (!lastSlap) return 0
    const e = now - lastSlap
    if (e >= SLAP_MS) return 0
    const t = e / SLAP_MS
    return t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7
  }
  function furPalette(tint) {
    if (!tint || tint === 'default' || !SKINS[tint]) return CAT
    const c = SKINS[tint]
    return { body: c, belly: shade(c, 0.55), ear: c, earIn: CAT.earIn }
  }
  function feat(state) { return Object.assign({}, DEFAULT_FEAT, state.feat || {}) }
  function bobAt(now, seed) { return Math.sin(now / 950 + (seed || 0)) * 1.4 }

  function drawStar(ctx, x, y, r, rot, color) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot)
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      const a2 = a + Math.PI / 5
      ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45)
    }
    ctx.closePath()
    ctx.fillStyle = color || '#ffd451'; ctx.fill()
    ctx.strokeStyle = 'rgba(120,90,20,0.6)'; ctx.lineWidth = 1; ctx.stroke()
    ctx.restore()
  }
  function drawDizzyStars(ctx, cx, cy, now) {
    for (let k = 0; k < 3; k++) {
      const a = now / 210 + k * 2.094
      drawStar(ctx, cx + Math.cos(a) * 22, cy + Math.sin(a) * 7, 5, now / 120 + k, '#ffd451')
    }
  }

  // ---------- coat patterns ----------
  function patternBody(ctx, pattern, pal, cx, deskY, bob) {
    if (!pattern || pattern === 'solid') return
    ctx.save()
    ctx.beginPath(); ctx.ellipse(cx, deskY + 10 + bob * 0.4, 58, 54, 0, 0, Math.PI * 2); ctx.clip()
    const dark = shade(pal.body, -0.28)
    if (pattern === 'tabby') {
      ctx.strokeStyle = dark; ctx.lineWidth = 6; ctx.lineCap = 'round'
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath()
        ctx.moveTo(cx - 40, deskY - 6 + i * 16)
        ctx.quadraticCurveTo(cx, deskY + 2 + i * 16, cx + 40, deskY - 6 + i * 16)
        ctx.stroke()
      }
    } else if (pattern === 'tuxedo') {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.ellipse(cx, deskY + 14, 26, 34, 0, 0, Math.PI * 2); ctx.fill()
    } else if (pattern === 'spotted') {
      ctx.fillStyle = dark
      for (const [dx, dy] of [[-28, -6], [22, 4], [-6, 18], [30, -14]]) {
        ctx.beginPath(); ctx.ellipse(cx + dx, deskY + dy, 7, 6, 0, 0, Math.PI * 2); ctx.fill()
      }
    } else if (pattern === 'point') {
      ctx.fillStyle = shade(pal.body, -0.22); ctx.globalAlpha = 0.5
      ctx.beginPath(); ctx.ellipse(cx, deskY + 40, 60, 30, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  function patternHead(ctx, pattern, pal, cx, hy) {
    if (!pattern || pattern === 'solid') return
    ctx.save()
    ctx.beginPath(); ctx.ellipse(cx, hy, 50, 44, 0, 0, Math.PI * 2); ctx.clip()
    const dark = shade(pal.body, -0.28)
    if (pattern === 'tabby') {
      ctx.strokeStyle = dark; ctx.lineWidth = 4; ctx.lineCap = 'round'
      for (const dx of [-7, 0, 7]) { // forehead "M"
        ctx.beginPath(); ctx.moveTo(cx + dx, hy - 40); ctx.lineTo(cx + dx * 1.5, hy - 22); ctx.stroke()
      }
      for (const s of [-1, 1]) { // cheek stripes
        ctx.beginPath(); ctx.moveTo(cx + s * 34, hy - 6); ctx.lineTo(cx + s * 48, hy - 2); ctx.stroke()
      }
    } else if (pattern === 'tuxedo') {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath(); ctx.ellipse(cx, hy + 14, 26, 20, 0, 0, Math.PI * 2); ctx.fill()
    } else if (pattern === 'spotted') {
      ctx.fillStyle = dark
      for (const [dx, dy] of [[-24, -14], [26, -8]]) {
        ctx.beginPath(); ctx.ellipse(cx + dx, hy + dy, 6, 5, 0, 0, Math.PI * 2); ctx.fill()
      }
    } else if (pattern === 'point') {
      ctx.fillStyle = shade(pal.body, -0.24)
      ctx.beginPath(); ctx.ellipse(cx, hy + 10, 24, 18, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  // ---------- hats ----------
  function drawHat(ctx, hat, cx, topY) {
    if (!hat || hat === 'none') return
    ctx.save(); ctx.lineJoin = 'round'
    if (hat === 'beanie') {
      ctx.beginPath(); ctx.arc(cx, topY + 6, 32, Math.PI, Math.PI * 2); ink(ctx, '#e0607a', 2.5)
      rr(ctx, cx - 33, topY + 3, 66, 10, 5); ink(ctx, '#fbf1e6', 2.5)
      ctx.beginPath(); ctx.arc(cx, topY - 26, 7, 0, Math.PI * 2); ink(ctx, '#fbf1e6', 2.5)
    } else if (hat === 'party') {
      ctx.beginPath(); ctx.moveTo(cx, topY - 40); ctx.lineTo(cx - 24, topY + 6); ctx.lineTo(cx + 24, topY + 6); ctx.closePath(); ink(ctx, '#6c8cff', 2.5)
      ctx.fillStyle = '#ffd166'
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx - 9 + i * 9, topY - 16 + i * 11, 3.2, 0, Math.PI * 2); ctx.fill() }
      ctx.beginPath(); ctx.arc(cx, topY - 42, 6, 0, Math.PI * 2); ink(ctx, '#ffd166', 2.5)
    } else if (hat === 'crown') {
      ctx.beginPath()
      ctx.moveTo(cx - 28, topY + 6); ctx.lineTo(cx - 28, topY - 12); ctx.lineTo(cx - 14, topY - 1)
      ctx.lineTo(cx, topY - 18); ctx.lineTo(cx + 14, topY - 1); ctx.lineTo(cx + 28, topY - 12); ctx.lineTo(cx + 28, topY + 6); ctx.closePath(); ink(ctx, '#ffcf47', 2.5)
      ctx.fillStyle = '#ff7eb0'
      for (const dx of [-14, 0, 14]) { ctx.beginPath(); ctx.arc(cx + dx, topY - 1, 3, 0, Math.PI * 2); ctx.fill() }
    } else if (hat === 'tophat') {
      rr(ctx, cx - 32, topY + 2, 64, 9, 4); ink(ctx, '#3a3742', 2.5)
      rr(ctx, cx - 20, topY - 32, 40, 38, 4); ink(ctx, '#3a3742', 2.5)
      ctx.fillStyle = '#e0607a'; rr(ctx, cx - 20, topY - 5, 40, 8, 0); ctx.fill()
    } else if (hat === 'cap') {
      ctx.beginPath(); ctx.arc(cx, topY + 4, 28, Math.PI, Math.PI * 2); ink(ctx, '#37b18d', 2.5)
      ctx.beginPath(); ctx.ellipse(cx + 20, topY + 6, 20, 7, 0, Math.PI, Math.PI * 2); ink(ctx, '#37b18d', 2.5)
      ctx.beginPath(); ctx.arc(cx, topY - 24, 4, 0, Math.PI * 2); ink(ctx, '#2a8a6c', 2)
    }
    ctx.restore()
  }

  // ---------- speech bubble ----------
  function wrapText(ctx, text, maxWidth, maxLines) {
    const words = text.split(/\s+/); const lines = []; let cur = ''
    for (const word of words) {
      let w = word
      while (ctx.measureText(w).width > maxWidth) {
        let cut = w.length - 1
        while (cut > 1 && ctx.measureText((cur ? cur + ' ' : '') + w.slice(0, cut)).width > maxWidth) cut--
        lines.push((cur ? cur + ' ' : '') + w.slice(0, cut)); cur = ''; w = w.slice(cut)
      }
      const attempt = cur ? cur + ' ' + w : w
      if (ctx.measureText(attempt).width <= maxWidth) cur = attempt
      else { lines.push(cur); cur = w }
    }
    if (cur) lines.push(cur)
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '') + '…' }
    return lines
  }
  function drawBubble(ctx, text, cx, headTopY, now, until) {
    const alpha = Math.max(0, Math.min(1, (until - now) / 400))
    ctx.save(); ctx.globalAlpha = alpha
    ctx.font = '600 16px "Segoe UI", "Malgun Gothic", sans-serif'
    const lines = wrapText(ctx, text, 190, 2); const lineH = 20
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 26
    const h = lines.length * lineH + 14
    const x = Math.max(4, Math.min(cx - w / 2, 236 - w)); const y = headTopY - h - 14  // sit just above the head
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(60,55,70,0.25)'; ctx.lineWidth = 1.5
    rr(ctx, x, y, w, h, 12); ctx.fill(); ctx.stroke()
    const tailTip = Math.min(headTopY - 2, y + h + 10)
    ctx.beginPath(); ctx.moveTo(cx - 8, y + h - 1); ctx.lineTo(cx, tailTip); ctx.lineTo(cx + 8, y + h - 1); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#33313a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const cyB = y + h / 2  // vertically center the text block inside the bubble
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, cyB + (i - (lines.length - 1) / 2) * lineH))
    ctx.restore()
  }

  // feature anchor points (cell-local coords, y includes the BUBBLE_H offset)
  function anchors(state, now) {
    const f = feat(state)
    const cx = 120
    const bob = bobAt(now, state.seed)
    const hy = 84 + bob
    return {
      ears: { x: cx + 34 + f.earDX, y: BUBBLE_H + hy - 56 + f.earDY },
      eyes: { x: cx + 15 + f.eyeDX, y: BUBBLE_H + hy + 3 + f.eyeDY },
      tail: { x: cx + 80 + f.tailDX, y: BUBBLE_H + (DESK_Y - 58) + f.tailDY }
    }
  }

  // ---------- main ----------
  function draw(ctx, _animal, state, now) {
    ctx.save()
    ctx.translate(0, BUBBLE_H)
    const pal = furPalette(state.tint)
    const f = feat(state)
    const cx = 120
    const deskY = DESK_Y
    const pattern = state.pattern || 'solid'

    const pL = slapProgress(state.lastLeft, now)
    const pR = slapProgress(state.lastRight, now)
    const pM = slapProgress(state.lastMouse, now)
    const bob = bobAt(now, state.seed)
    const hy = 84 + bob
    const active = Math.max(pL, pR, pM)

    // hit reaction — shake the whole widget while recovering
    const hit = !!(state.hitUntil && now < state.hitUntil)
    if (hit) {
      const amp = Math.min(7, (state.hitUntil - now) / 70)
      ctx.translate(Math.sin(now / 28) * amp, 0)
    }

    // contact shadow
    ctx.fillStyle = 'rgba(40,30,25,0.14)'
    ctx.beginPath(); ctx.ellipse(cx, deskY + 3, 66, 10, 0, 0, Math.PI * 2); ctx.fill()

    // tail (behind body) — nudgeable
    ctx.save()
    ctx.translate(f.tailDX, f.tailDY)
    ctx.lineCap = 'round'
    const tailWag = Math.sin(now / 700 + 1) * 6
    ctx.strokeStyle = LINE; ctx.lineWidth = 15
    ctx.beginPath(); ctx.moveTo(cx + 44, deskY - 4); ctx.quadraticCurveTo(cx + 88, deskY - 22, cx + 80 + tailWag, deskY - 58); ctx.stroke()
    ctx.strokeStyle = pal.body; ctx.lineWidth = 11
    ctx.beginPath(); ctx.moveTo(cx + 44, deskY - 4); ctx.quadraticCurveTo(cx + 88, deskY - 22, cx + 80 + tailWag, deskY - 58); ctx.stroke()
    ctx.restore()

    // body
    ctx.beginPath(); ctx.ellipse(cx, deskY + 10 + bob * 0.4, 58, 54, 0, 0, Math.PI * 2)
    ink(ctx, volume(ctx, pal.body, cx, deskY - 18, 76), 3)
    patternBody(ctx, pattern, pal, cx, deskY, bob)

    // head group
    ctx.save()
    // ears — nudgeable
    for (const s of [-1, 1]) {
      ctx.save()
      ctx.translate(s * f.earDX, f.earDY)
      ctx.beginPath()
      ctx.moveTo(cx + s * 16, hy - 30)
      ctx.quadraticCurveTo(cx + s * 34, hy - 60, cx + s * 45, hy - 24)
      ctx.quadraticCurveTo(cx + s * 30, hy - 22, cx + s * 16, hy - 30)
      ctx.closePath(); ink(ctx, pal.ear, 3)
      ctx.fillStyle = pal.earIn
      ctx.beginPath()
      ctx.moveTo(cx + s * 22, hy - 30)
      ctx.quadraticCurveTo(cx + s * 33, hy - 48, cx + s * 39, hy - 27)
      ctx.quadraticCurveTo(cx + s * 30, hy - 26, cx + s * 22, hy - 30)
      ctx.closePath(); ctx.fill()
      ctx.restore()
    }

    // head base
    ctx.beginPath(); ctx.ellipse(cx, hy, 50, 44, 0, 0, Math.PI * 2)
    ink(ctx, volume(ctx, pal.body, cx, hy - 6, 54), 3)
    patternHead(ctx, pattern, pal, cx, hy)

    // gloss
    ctx.fillStyle = 'rgba(255,255,255,0.30)'
    ctx.beginPath(); ctx.ellipse(cx - 17, hy - 18, 13, 8, -0.5, 0, Math.PI * 2); ctx.fill()

    // blush
    for (const s of [-1, 1]) {
      const bx = cx + s * 27, by = hy + 12
      const g = ctx.createRadialGradient(bx, by, 1, bx, by, 11)
      g.addColorStop(0, 'rgba(255,150,175,0.85)'); g.addColorStop(1, 'rgba(255,150,175,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, by, 11, 7, 0, 0, Math.PI * 2); ctx.fill()
    }

    // eyes — nudgeable; natural blink
    const blinking = state.blinkUntil && now < state.blinkUntil
    const eyeY = hy + 3 + f.eyeDY
    for (const s of [-1, 1]) {
      const ex = cx + s * (15 + f.eyeDX)
      if (hit) {
        // dizzy "X" eyes
        ctx.strokeStyle = LINE; ctx.lineWidth = 3; ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(ex - 5, eyeY - 5); ctx.lineTo(ex + 5, eyeY + 5)
        ctx.moveTo(ex + 5, eyeY - 5); ctx.lineTo(ex - 5, eyeY + 5)
        ctx.stroke()
      } else if (blinking) {
        ctx.strokeStyle = LINE; ctx.lineWidth = 3; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.arc(ex, eyeY, 6, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke()
      } else {
        ctx.fillStyle = LINE; ctx.beginPath(); ctx.ellipse(ex, eyeY, 6, 7.5, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(ex - 2, eyeY - 3, 2.1, 0, Math.PI * 2); ctx.fill()
      }
    }

    // nose + mouth
    ctx.fillStyle = '#e58aa3'
    ctx.beginPath(); ctx.moveTo(cx - 3.5, hy + 12); ctx.lineTo(cx + 3.5, hy + 12); ctx.lineTo(cx, hy + 15.5); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.8; ctx.lineCap = 'round'
    if (active > 0.4) {
      ctx.fillStyle = '#e07d95'; ctx.beginPath(); ctx.ellipse(cx, hy + 19, 4.5, 3 + active * 2, 0, 0, Math.PI * 2); ctx.fill(); ink(ctx, null, 1.6)
    } else {
      ctx.beginPath(); ctx.arc(cx - 3.5, hy + 17, 3.5, 0.1 * Math.PI, 0.9 * Math.PI); ctx.arc(cx + 3.5, hy + 17, 3.5, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke()
    }

    // whiskers
    ctx.strokeStyle = 'rgba(70,64,80,0.45)'; ctx.lineWidth = 1.3
    for (const s of [-1, 1]) {
      for (const dy of [-1, 4]) {
        ctx.beginPath(); ctx.moveTo(cx + s * 30, hy + 9 + dy); ctx.lineTo(cx + s * 52, hy + 6 + dy * 1.7); ctx.stroke()
      }
    }

    drawHat(ctx, state.hat, cx, hy - 36)
    if (hit) drawDizzyStars(ctx, cx, hy - 52, now)
    ctx.restore()

    // bottom bar
    const barGrad = ctx.createLinearGradient(0, deskY, 0, deskY + BAR_VIS)
    barGrad.addColorStop(0, '#f0d7b0'); barGrad.addColorStop(1, '#e0bd8b')
    ctx.fillStyle = barGrad; ctx.fillRect(0, deskY, CELL_W, BAR_VIS + 4)
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(0, deskY, CELL_W, 3)
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(0, deskY + 3, CELL_W, 2)

    // keyboard (slightly larger)
    const kbX = cx - 52, kbW = 104, kbY = deskY + 4, kbH = 20
    rr(ctx, kbX, kbY, kbW, kbH, 5); ink(ctx, '#4a4e5a', 2)
    ctx.fillStyle = '#6b7080'
    const cols = 8, rows = 3, pad = 5, gap = 2.2
    const kw = (kbW - pad * 2 - gap * (cols - 1)) / cols
    const kh = (kbH - pad * 2 - gap * (rows - 1)) / rows
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) { rr(ctx, kbX + pad + k * (kw + gap), kbY + pad + r * (kh + gap), kw, kh, 1.6); ctx.fill() }

    // mouse
    const mouseX = cx + 74, mj = pM * 2
    ctx.beginPath(); ctx.ellipse(mouseX + mj, deskY + 26, 10, 14, 0, 0, Math.PI * 2); ink(ctx, '#eceef4', 2)
    ctx.strokeStyle = '#c2c5d0'; ctx.lineWidth = 1.1
    ctx.beginPath(); ctx.moveTo(mouseX + mj, deskY + 15); ctx.lineTo(mouseX + mj, deskY + 22); ctx.stroke()

    // paws
    const restUp = deskY - 10, kbHit = deskY + 10, mouseHit = deskY + 17
    function pawPad(px, py, pressed) {
      ctx.fillStyle = 'rgba(40,30,25,0.10)'; ctx.beginPath(); ctx.ellipse(px, deskY + 30, 11, 3.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(px, py, 11, 9, 0, 0, Math.PI * 2); ink(ctx, volume(ctx, pal.belly, px, py - 2, 11), 2.5)
      ctx.strokeStyle = 'rgba(70,64,80,0.35)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(px - 3, py - 6); ctx.lineTo(px - 3, py - 1); ctx.moveTo(px + 3, py - 6); ctx.lineTo(px + 3, py - 1); ctx.stroke()
      if (pressed) { ctx.strokeStyle = 'rgba(120,120,140,0.4)'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(px, py + 4, 13, 0, Math.PI * 2); ctx.stroke() }
    }
    pawPad(cx - 22, restUp + (kbHit - restUp) * pL, pL > 0.8)
    if (pM > pR) {
      const px = cx + 22 + (mouseX - (cx + 22)) * Math.min(1, pM * 1.4)
      pawPad(px, restUp + (mouseHit - restUp) * pM, pM > 0.8)
    } else {
      pawPad(cx + 22, restUp + (kbHit - restUp) * pR, pR > 0.8)
    }

    // nameplate — a small dark plate on the front strip of the desk (readable, off the keyboard)
    if (state.name) {
      ctx.font = '700 17px "Segoe UI", "Malgun Gothic", sans-serif'
      const tw = ctx.measureText(state.name).width
      const ph = 22, pw = Math.min(168, Math.max(44, tw + 22))
      const nx = cx - pw / 2, ny = deskY + BAR_VIS - ph - 1
      rr(ctx, nx, ny, pw, ph, 9)
      ctx.fillStyle = 'rgba(38,30,26,0.92)'; ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.stroke()
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffe9c7'; ctx.fillText(state.name, cx, ny + ph / 2 + 0.5)
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    }

    ctx.restore()

    if (state.bubbleText && now < state.bubbleUntil) {
      drawBubble(ctx, state.bubbleText, cx, BUBBLE_H + hy - 46, now, state.bubbleUntil)
    }
  }

  window.AnimalArt = { draw, anchors, CELL_W, CELL_H, BUBBLE_H, DESK_Y, SLAP_MS, SKINS, HATS, PATTERNS, DEFAULT_FEAT }
})()
