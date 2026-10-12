// 김 서린 창 닦기 (협동)
// 풍경(scene canvas) 위를 김(fog canvas)이 덮고, 문지른 자리를 destination-out으로 지운다.
// 닦은 시각을 낮은 해상도 격자에 기록해 두고, 매 프레임 그 격자로 '지울 마스크'를 만들어
// 김을 다시 그린다 → 시간이 지나면 김이 천천히 다시 서림. 같은 격자로 걷힌 비율도 계산.

const DURATION_MS = 60000
const GOAL = 0.7 // 70% 걷히면 성공
const GRID_W = 120 // 격자 가로 칸 수 (세로는 화면 비율대로)
const BRUSH = 0.075 // 붓 반지름 = 화면 짧은 변 × 이 값
const FADE_MS = 4000 // 김이 다시 서리는 데 걸리는 시간
// 닦은 뒤 김이 다시 서리기 시작할 때까지 버티는 시간. 사람이 적으면 길게 줘서 혼자서도 깰 수 있게.
const HOLD_MS = { 1: 8000, 2: 5000 }
const HOLD_MS_MANY = 3000
const SEND_EVERY_MS = 100 // 문지른 좌표를 모아서 보내는 간격
const RESULT_MS = 4500

const $ = (sel) => document.querySelector(sel)

let game = null

// ---------- 풍경: 강변 스카이라인 (작게 그려서 픽셀 느낌으로 확대) ----------

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function drawScene(canvas) {
  const W = 320
  const H = Math.max(180, Math.round((W * innerHeight) / innerWidth))
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')
  const rand = seeded(7) // 모두 같은 풍경
  const horizon = Math.round(H * 0.62)

  // 하늘 (해질녘)
  const sky = c.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#7f9ed6')
  sky.addColorStop(0.55, '#e9b8cf')
  sky.addColorStop(1, '#ffd7a6')
  c.fillStyle = sky
  c.fillRect(0, 0, W, horizon)

  // 해
  c.fillStyle = '#fff1c9'
  c.beginPath()
  c.arc(W * 0.7, horizon - 18, 14, 0, Math.PI * 2)
  c.fill()

  // 별 몇 개
  c.fillStyle = 'rgba(255,255,255,0.8)'
  for (let i = 0; i < 18; i++) c.fillRect(Math.floor(rand() * W), Math.floor(rand() * horizon * 0.4), 1, 1)

  // 빌딩: 먼 줄 → 가까운 줄
  const layers = [
    { color: '#b49ac4', min: 18, max: 46, lit: 0.08 },
    { color: '#6d6fa3', min: 10, max: 70, lit: 0.22 },
  ]
  const buildings = []
  for (const layer of layers) {
    let x = -4
    while (x < W) {
      const w = 8 + Math.floor(rand() * 16)
      const h = layer.min + Math.floor(rand() * (layer.max - layer.min))
      buildings.push({ x, w, h, layer })
      x += w + Math.floor(rand() * 3)
    }
  }
  // 타워 하나
  const tx = Math.round(W * 0.28)
  for (const b of buildings) {
    c.fillStyle = b.layer.color
    c.fillRect(b.x, horizon - b.h, b.w, b.h)
    c.fillStyle = '#ffe8a3'
    for (let y = horizon - b.h + 3; y < horizon - 2; y += 4) {
      for (let x = b.x + 2; x < b.x + b.w - 2; x += 3) {
        if (rand() < b.layer.lit) c.fillRect(x, y, 1, 2)
      }
    }
  }
  c.fillStyle = '#5b5c8f'
  c.fillRect(tx - 1, horizon - 92, 3, 92)
  c.fillRect(tx - 4, horizon - 70, 9, 6)
  c.fillStyle = '#ff9fb8'
  c.fillRect(tx, horizon - 96, 1, 4)

  // 강
  const river = c.createLinearGradient(0, horizon, 0, H)
  river.addColorStop(0, '#8d8fc4')
  river.addColorStop(1, '#4f5f99')
  c.fillStyle = river
  c.fillRect(0, horizon, W, H - horizon)

  // 물에 비친 빌딩 (뒤집어서 흐리게)
  c.save()
  c.globalAlpha = 0.25
  c.translate(0, horizon * 2)
  c.scale(1, -1)
  for (const b of buildings) {
    c.fillStyle = b.layer.color
    c.fillRect(b.x, horizon - b.h * 0.7, b.w, b.h * 0.7)
  }
  c.restore()

  // 물결 반짝임
  for (let i = 0; i < 70; i++) {
    const y = horizon + 3 + Math.floor(rand() * (H - horizon - 3))
    c.fillStyle = rand() < 0.5 ? 'rgba(255,215,166,0.55)' : 'rgba(255,255,255,0.35)'
    c.fillRect(Math.floor(rand() * W), y, 3 + Math.floor(rand() * 8), 1)
  }

  // 다리
  const by = horizon + Math.round((H - horizon) * 0.18)
  c.fillStyle = '#3f4378'
  c.fillRect(0, by, W, 3)
  for (let x = 6; x < W; x += 26) c.fillRect(x, by + 3, 3, 10)
  c.fillStyle = '#ffd36e'
  for (let x = 2; x < W; x += 6) c.fillRect(x, by - 1, 1, 1)
}

// ---------- 김 ----------

function makeFogTexture(w, h) {
  const t = document.createElement('canvas')
  t.width = w
  t.height = h
  const c = t.getContext('2d')
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#eef2f8')
  g.addColorStop(1, '#dfe6f1')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)
  // 뭉게뭉게 얼룩
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const r = 40 + Math.random() * 120
    const blob = c.createRadialGradient(x, y, 0, x, y, r)
    blob.addColorStop(0, 'rgba(255,255,255,0.45)')
    blob.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = blob
    c.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // 물방울
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const r = 1 + Math.random() * 3
    c.fillStyle = 'rgba(160,175,205,0.35)'
    c.beginPath()
    c.arc(x, y, r, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.8)'
    c.fillRect(x - r / 3, y - r / 2, 1, 1)
  }
  return t
}

function resize() {
  if (!game) return
  drawScene($('#wipe-scene'))
  const fog = $('#wipe-fog')
  fog.width = innerWidth
  fog.height = innerHeight
  game.fogTexture = makeFogTexture(innerWidth, innerHeight)
}

// 정규화 좌표(0~1)의 선분을 따라 격자에 '닦은 시각'을 찍는다
function stamp(x1, y1, x2, y2, now) {
  const { gw, gh, wiped } = game
  const r = (BRUSH * Math.min(innerWidth, innerHeight) * gw) / innerWidth // 칸 단위 반지름
  const ax = x1 * gw, ay = y1 * gh, bx = x2 * gw, by = y2 * gh
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r / 2)))
  for (let s = 0; s <= steps; s++) {
    const cx = ax + ((bx - ax) * s) / steps
    const cy = ay + ((by - ay) * s) / steps
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(gh - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(gw - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) wiped[y * gw + x] = now
      }
    }
  }
}

function applyStrokes(strokes, now) {
  for (const s of strokes) {
    if (s.length === 2) stamp(s[0], s[1], s[0], s[1], now)
    for (let i = 2; i < s.length; i += 2) stamp(s[i - 2], s[i - 1], s[i], s[i + 1], now)
  }
}

// 매 프레임: 격자 → 마스크 → 김 다시 그리기, 걷힌 비율 계산
function frame() {
  if (!game || game.done) return
  const now = Date.now()
  const { gw, gh, wiped, hold, mask, maskData } = game
  const px = maskData.data
  let clear = 0
  for (let i = 0; i < gw * gh; i++) {
    const age = now - wiped[i]
    const a = age < hold ? 1 : Math.max(0, 1 - (age - hold) / FADE_MS) // 1 = 완전히 닦임
    px[i * 4 + 3] = a * 255
    if (a > 0.5) clear++
  }
  mask.getContext('2d').putImageData(maskData, 0, 0)

  const fog = $('#wipe-fog')
  const c = fog.getContext('2d')
  c.globalCompositeOperation = 'source-over'
  c.clearRect(0, 0, fog.width, fog.height)
  c.drawImage(game.fogTexture, 0, 0, fog.width, fog.height)
  c.globalCompositeOperation = 'destination-out'
  c.imageSmoothingEnabled = true
  c.drawImage(mask, 0, 0, fog.width, fog.height)

  game.ratio = clear / (gw * gh)
  renderHud(now)

  if (game.ratio >= GOAL) {
    const msg = { type: 'wipe-done', gameId: game.gameId }
    game.send(msg)
    finish(true)
    return
  }
  requestAnimationFrame(frame)
}

// ---------- 입력 (마우스·터치·펜 모두 pointer 이벤트, 여러 손가락 가능) ----------

function pointFromEvent(e) {
  return [+(e.clientX / innerWidth).toFixed(3), +(e.clientY / innerHeight).toFixed(3)]
}

function onDown(e) {
  if (!game || game.done) return
  e.preventDefault()
  try {
    e.currentTarget.setPointerCapture(e.pointerId) // 손가락이 캔버스 밖으로 나가도 계속 닦이게
  } catch {}
  const p = pointFromEvent(e)
  game.active.set(e.pointerId, p)
  game.outbox.push([...p])
  game.open.set(e.pointerId, game.outbox[game.outbox.length - 1])
  stamp(p[0], p[1], p[0], p[1], Date.now())
}

function onMove(e) {
  if (!game || game.done || !game.active.has(e.pointerId)) return
  e.preventDefault()
  const last = game.active.get(e.pointerId)
  const p = pointFromEvent(e)
  stamp(last[0], last[1], p[0], p[1], Date.now())
  game.active.set(e.pointerId, p)
  let stroke = game.open.get(e.pointerId)
  if (!stroke) {
    // 방금 보낸 묶음 다음부터는 마지막 점에서 이어 그리기
    stroke = [...last]
    game.outbox.push(stroke)
    game.open.set(e.pointerId, stroke)
  }
  stroke.push(...p)
}

function onUp(e) {
  if (!game) return
  game.active.delete(e.pointerId)
  game.open.delete(e.pointerId)
}

function flush() {
  if (!game || game.done || !game.outbox.length) return
  game.send({ type: 'wipe', gameId: game.gameId, strokes: game.outbox })
  game.outbox = []
  game.open.clear()
}

// ---------- 진행 / 결과 ----------

function renderHud(now) {
  const left = Math.max(0, game.startAt + DURATION_MS - now)
  const sec = Math.ceil(left / 1000)
  $('#zone-hud-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  if (game.joined) {
    $('#zone-hud-count').textContent = `걷힌 김 ${Math.floor(game.ratio * 100)}% / ${GOAL * 100}%`
    $('#zone-hud-msg').textContent = '문질러서 김을 닦아요 · 같이 닦으면 더 빨라요'
  } else {
    $('#zone-hud-count').textContent = `${game.playerCount}명이 닦는 중`
    $('#zone-hud-msg').textContent = '구경 중'
  }
}

export function startWipe({ gameId, startAt, joined, playerCount, send, onFinish }) {
  const gw = GRID_W
  const gh = Math.max(1, Math.round((GRID_W * innerHeight) / innerWidth))
  const mask = document.createElement('canvas')
  mask.width = gw
  mask.height = gh
  const maskData = mask.getContext('2d').createImageData(gw, gh)

  game = {
    gameId, startAt, joined, playerCount, send, onFinish,
    gw, gh, mask, maskData,
    wiped: new Float64Array(gw * gh).fill(-Infinity),
    hold: HOLD_MS[playerCount] ?? HOLD_MS_MANY,
    ratio: 0,
    active: new Map(), // pointerId -> 마지막 점
    open: new Map(), // pointerId -> 아직 안 보낸 stroke
    outbox: [],
    done: false,
  }

  $('#zone-hud-title').textContent = '김 서린 창 닦기'
  $('#zone-hud').classList.remove('hidden')
  game.endTimer = setTimeout(() => finish(false), Math.max(0, startAt + DURATION_MS - Date.now()))

  if (joined) {
    document.activeElement?.blur()
    $('#chat-form').classList.add('hidden')
    const stage = $('#wipe-stage')
    stage.classList.remove('hidden', 'clear')
    resize()
    addEventListener('resize', resize)
    const fog = $('#wipe-fog')
    fog.addEventListener('pointerdown', onDown)
    fog.addEventListener('pointermove', onMove)
    fog.addEventListener('pointerup', onUp)
    fog.addEventListener('pointercancel', onUp)
    game.sendTimer = setInterval(flush, SEND_EVERY_MS)
    requestAnimationFrame(frame)
  } else {
    game.hudTimer = setInterval(() => renderHud(Date.now()), 250)
    renderHud(Date.now())
  }
}

export function onWipeMessage(msg) {
  if (!game || game.gameId !== msg.gameId || game.done) return
  if (msg.type === 'wipe' && game.joined) applyStrokes(msg.strokes, Date.now())
  else if (msg.type === 'wipe-done') finish(true)
}

function finish(success) {
  if (!game || game.done) return
  flush()
  game.done = true
  clearTimeout(game.endTimer)
  clearInterval(game.sendTimer)
  clearInterval(game.hudTimer)
  $('#zone-hud').classList.add('hidden')

  const stage = $('#wipe-stage')
  if (success) {
    // 풍경 완전히 열기 (구경꾼도 같이 봄)
    if (stage.classList.contains('hidden')) {
      stage.classList.remove('hidden')
      drawScene($('#wipe-scene'))
      $('#wipe-fog').getContext('2d').clearRect(0, 0, innerWidth, innerHeight)
    }
    stage.classList.add('clear')
  }
  $('#game-result-text').textContent = success ? '이 풍경 0원' : '시야가 좁았다'
  $('#game-result').classList.remove('hidden')

  const { onFinish } = game
  setTimeout(() => {
    $('#game-result').classList.add('hidden')
    stage.classList.add('hidden')
    stage.classList.remove('clear')
    removeEventListener('resize', resize)
    $('#chat-form').classList.remove('hidden')
    game = null
    onFinish()
  }, RESULT_MS)
}
