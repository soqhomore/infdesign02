// 김 서린 창 닦기 (협동)
// 풍경(scene canvas) 위를 김(fog canvas)이 덮고, 문지른 자리를 destination-out으로 지운다.
// configureWipe로 두 가지 모양을 고른다:
//  - 기본(원래 사이트): 강변 스카이라인 전체 화면 + 60초 제한
//  - aquarium(도트판): 어두운 관람실 실루엣 + 가운데 창 너머로 실제 수조가 보임, 시간 제한 없음
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
const config = { aquarium: false, timed: true }
export function configureWipe(options) {
  Object.assign(config, options)
  if (config.aquarium) loadViewer()
}

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

// ---------- 아쿠아리움 관람실 (바깥은 실루엣, 가운데 창은 뚫려 있어 수조가 보임) ----------

const ROOM_PX = 3 // 관람실 실루엣 도트 크기
const ROOM = '#0e1b21'
const INK = '#061015'
let viewer = null // 관람객 개복치 뒷모습 (실루엣으로 칠함)

function loadViewer() {
  if (viewer) return
  const img = new Image()
  img.src = '/fish/fish-backmiddle.png'
  img.onload = () => { viewer = img }
}

// 창 위치 (화면 px, 도트 격자에 맞춤)
function windowRect() {
  const W = Math.ceil(innerWidth / ROOM_PX)
  const H = Math.ceil(innerHeight / ROOM_PX)
  const x = Math.round(W * (innerWidth < 600 ? 0.05 : 0.09))
  const y = Math.round(H * 0.17)
  return { lx: x, ly: y, lw: W - x * 2, lh: Math.round(H * 0.58), W, H }
}

function drawAquariumRoom(canvas) {
  const r = windowRect()
  canvas.width = r.W
  canvas.height = r.H
  canvas.style.width = `${r.W * ROOM_PX}px`
  canvas.style.height = `${r.H * ROOM_PX}px`
  const c = canvas.getContext('2d')
  const { lx: x, ly: y, lw: w, lh: h } = r
  c.clearRect(0, 0, r.W, r.H)
  c.fillStyle = ROOM
  c.fillRect(0, 0, r.W, r.H)

  // 창에서 새어 나온 빛이 바닥에 비침
  const floorY = y + h + Math.round((r.H - y - h) * 0.3)
  const spill = c.createLinearGradient(0, y + h, 0, r.H)
  spill.addColorStop(0, 'rgba(90, 170, 210, 0.16)')
  spill.addColorStop(1, 'rgba(90, 170, 210, 0)')
  c.fillStyle = spill
  c.beginPath()
  c.moveTo(x, y + h)
  c.lineTo(x + w, y + h)
  c.lineTo(x + w + w * 0.08, r.H)
  c.lineTo(x - w * 0.08, r.H)
  c.fill()
  c.fillStyle = 'rgba(0, 0, 0, 0.25)'
  c.fillRect(0, floorY, r.W, 1)

  // 유리창 테두리 (희미한 빛) + 창 뚫기 (모서리는 도트로 둥글게)
  c.fillStyle = 'rgba(140, 200, 220, 0.18)'
  c.fillRect(x - 1, y - 1, w + 2, h + 2)
  c.clearRect(x, y, w, h)
  c.fillStyle = ROOM
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]]) {
    c.fillRect(cx, cy, 1, 1)
    c.fillRect(cx + dx, cy, 1, 1)
    c.fillRect(cx, cy + dy, 1, 1)
  }
  // 창 안쪽 가장자리 그늘 (깊이감)
  c.fillStyle = 'rgba(4, 12, 20, 0.35)'
  c.fillRect(x, y, w, 2)
  c.fillRect(x, y, 1, h)
  c.fillRect(x + w - 1, y, 1, h)

  // 난간: 기둥 + 처진 밧줄
  c.fillStyle = INK
  const railY = y + Math.round(h * 0.8)
  const posts = 6
  const px = Array.from({ length: posts }, (_, i) => Math.round(x + w * (0.06 + (i * 0.88) / (posts - 1))))
  for (const p of px) {
    c.fillRect(p - 1, railY, 3, floorY - railY + 1)
    c.fillRect(p - 2, railY - 1, 5, 2)
  }
  for (let i = 0; i < posts - 1; i++) {
    const a = px[i], b = px[i + 1]
    for (let t = 0; t <= 1; t += 1 / (b - a)) {
      const sx = Math.round(a + (b - a) * t)
      const sy = Math.round(railY + 1 + Math.sin(Math.PI * t) * Math.min(7, h * 0.05))
      c.fillRect(sx, sy, 1, 2)
    }
  }

  // 창 앞에서 구경하는 개복치 뒷모습 실루엣
  if (viewer) {
    const vh = Math.round(Math.min(h * 0.32, 40))
    const vw = Math.round((vh * viewer.width) / viewer.height)
    const sil = document.createElement('canvas')
    sil.width = vw
    sil.height = vh
    const sc = sil.getContext('2d')
    sc.imageSmoothingEnabled = false
    sc.drawImage(viewer, 0, 0, vw, vh)
    sc.globalCompositeOperation = 'source-in'
    sc.fillStyle = INK
    sc.fillRect(0, 0, vw, vh)
    c.drawImage(sil, Math.round(x + w * 0.64 - vw / 2), floorY - vh + 2)
  }

  return { x: x * ROOM_PX, y: y * ROOM_PX, w: w * ROOM_PX, h: h * ROOM_PX }
}

function resize() {
  if (!game) return
  const scene = $('#wipe-scene')
  if (config.aquarium) {
    game.win = drawAquariumRoom(scene)
  } else {
    scene.style.width = scene.style.height = ''
    drawScene(scene)
    game.win = { x: 0, y: 0, w: innerWidth, h: innerHeight }
  }
  const fog = $('#wipe-fog')
  fog.width = innerWidth
  fog.height = innerHeight
  game.fogTexture = makeFogTexture(Math.round(game.win.w), Math.round(game.win.h))
}

// 정규화 좌표(창 기준 0~1)의 선분을 따라 격자에 '닦은 시각'을 찍는다
function stamp(x1, y1, x2, y2, now) {
  const { gw, gh, wiped, win } = game
  const r = (BRUSH * Math.min(win.w, win.h) * gw) / win.w // 칸 단위 반지름
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
  if (!game || game.done || game.left) return
  const now = Date.now()
  const { gw, gh, wiped, hold, mask, maskData, win } = game
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
  c.drawImage(game.fogTexture, win.x, win.y, win.w, win.h)
  c.globalCompositeOperation = 'destination-out'
  c.imageSmoothingEnabled = true
  c.drawImage(mask, win.x, win.y, win.w, win.h)

  game.ratio = clear / (gw * gh)
  renderHud(now)

  if (game.ratio >= GOAL) {
    game.send({ type: 'wipe-done', gameId: game.gameId })
    finish(true)
    return
  }
  requestAnimationFrame(frame)
}

// ---------- 입력 (마우스·터치·펜 모두 pointer 이벤트, 여러 손가락 가능) ----------

// 창 기준 0~1 좌표. 창 밖이면 null
function pointFromEvent(e) {
  const { win } = game
  const x = (e.clientX - win.x) / win.w
  const y = (e.clientY - win.y) / win.h
  if (x < 0 || y < 0 || x > 1 || y > 1) return null
  return [+x.toFixed(3), +y.toFixed(3)]
}

function onDown(e) {
  if (!game || game.done || game.left) return
  e.preventDefault()
  try {
    e.currentTarget.setPointerCapture(e.pointerId) // 손가락이 캔버스 밖으로 나가도 계속 닦이게
  } catch {}
  const p = pointFromEvent(e)
  if (!p) return
  game.active.set(e.pointerId, p)
  game.outbox.push([...p])
  game.open.set(e.pointerId, game.outbox[game.outbox.length - 1])
  stamp(p[0], p[1], p[0], p[1], Date.now())
}

function onMove(e) {
  if (!game || game.done || game.left) return
  e.preventDefault()
  const p = pointFromEvent(e)
  const last = game.active.get(e.pointerId)
  if (!p) {
    // 창 밖으로 나가면 그 획은 끊음
    game.active.delete(e.pointerId)
    game.open.delete(e.pointerId)
    return
  }
  if (!last) {
    if (e.buttons || e.pointerType !== 'mouse') onDown(e) // 누른 채로 창 안에 다시 들어옴
    return
  }
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

// 시간 제한 없는 판: 시야가 넓어질수록 휴식의 질이 올라간다
const REST_LEVELS = [
  [0, '흐릿', '김이 잔뜩 서렸어요. 천천히 닦아 볼까요'],
  [0.15, '조금', '조금씩 보이기 시작해요. 숨이 한결 편해져요'],
  [0.35, '편안', '시야가 넓어질수록 휴식의 질이 올라가요'],
  [0.55, '깊은 쉼', '거의 다 왔어요. 마음까지 맑아지는 중'],
]
const restLevel = (ratio) => REST_LEVELS.filter(([min]) => ratio >= min).pop()

function renderHud(now) {
  if (config.timed) {
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
    return
  }
  if (game.joined) {
    const [, word, line] = restLevel(game.ratio)
    $('#zone-hud-time').textContent = word
    $('#zone-hud-count').textContent = `시야 ${Math.floor((game.ratio / GOAL) * 100)}%`
    $('#zone-hud-msg').textContent = line
  } else {
    $('#zone-hud-time').textContent = '쉬는 중'
    $('#zone-hud-count').textContent = `${game.players.size}명이 창을 닦는 중`
    $('#zone-hud-msg').textContent = '구경 중'
  }
}

export function startWipe({ gameId, startAt, joined, players, meId, send, onFinish }) {
  const playerCount = players.length
  const win0 = config.aquarium ? (() => { const r = windowRect(); return { w: r.lw, h: r.lh } })() : { w: innerWidth, h: innerHeight }
  const gw = GRID_W
  const gh = Math.max(1, Math.round((GRID_W * win0.h) / win0.w))
  const mask = document.createElement('canvas')
  mask.width = gw
  mask.height = gh
  const maskData = mask.getContext('2d').createImageData(gw, gh)

  game = {
    gameId, startAt, joined, playerCount, send, onFinish,
    me: meId,
    players: new Set(players), // 아직 닦고 있는 사람
    gw, gh, mask, maskData,
    wiped: new Float64Array(gw * gh).fill(-Infinity),
    hold: HOLD_MS[playerCount] ?? HOLD_MS_MANY,
    ratio: 0,
    active: new Map(), // pointerId -> 마지막 점
    open: new Map(), // pointerId -> 아직 안 보낸 stroke
    outbox: [],
    done: false,
    left: false,
  }

  $('#zone-hud-title').textContent = '시야를 넓히자'
  $('#zone-hud').classList.remove('hidden')
  if (config.timed) game.endTimer = setTimeout(() => finish(false), Math.max(0, startAt + DURATION_MS - Date.now()))

  if (joined) {
    document.activeElement?.blur()
    $('#chat-form').classList.add('hidden')
    const stage = $('#wipe-stage')
    stage.classList.remove('hidden', 'clear')
    stage.classList.toggle('aquarium', config.aquarium)
    resize()
    addEventListener('resize', resize)
    const fog = $('#wipe-fog')
    fog.addEventListener('pointerdown', onDown)
    fog.addEventListener('pointermove', onMove)
    fog.addEventListener('pointerup', onUp)
    fog.addEventListener('pointercancel', onUp)
    game.sendTimer = setInterval(flush, SEND_EVERY_MS)
    if (!config.timed) {
      // 시간 제한이 없으니 그만두는 버튼
      const leave = document.createElement('button')
      leave.type = 'button'
      leave.className = 'wipe-leave'
      leave.textContent = '그만 쉬기'
      leave.addEventListener('click', leaveWipe)
      stage.append(leave)
      game.leaveBtn = leave
    }
    requestAnimationFrame(frame)
  } else {
    game.hudTimer = setInterval(() => renderHud(Date.now()), 250)
    renderHud(Date.now())
  }
}

export function onWipeMessage(msg) {
  if (!game || game.gameId !== msg.gameId || game.done) return
  if (msg.type === 'wipe' && game.joined && !game.left) applyStrokes(msg.strokes, Date.now())
  else if (msg.type === 'wipe-done') finish(true)
  else if (msg.type === 'wipe-leave') dropPlayer(msg.id)
}

// 접속을 끊고 나간 참여자도 그만둔 걸로
export function onWipePresence(presentIds) {
  if (!game || game.done) return
  const present = new Set(presentIds)
  // 나는 빼고 본다 (막 연결됐을 때 접속자 목록에 내가 아직 안 올라와 있을 수 있음)
  for (const id of [...game.players]) if (id !== game.me && !present.has(id)) dropPlayer(id)
}

function dropPlayer(id) {
  game.players.delete(id)
  // 닦는 사람이 아무도 안 남으면 조용히 끝 (구경꾼도 수조로)
  if (!game.players.size) endQuietly('다 같이 충분히 쉬었어요')
}

function leaveWipe() {
  if (!game || game.done) return
  game.send({ type: 'wipe-leave', gameId: game.gameId, id: game.me })
  game.left = true
  game.players.delete(game.me)
  endQuietly('충분히 쉬었어요')
}

function cleanupStage() {
  const stage = $('#wipe-stage')
  stage.classList.add('hidden')
  stage.classList.remove('clear')
  game.leaveBtn?.remove()
  removeEventListener('resize', resize)
  $('#chat-form').classList.remove('hidden')
}

function endQuietly(text) {
  flush()
  game.done = true
  clearInterval(game.sendTimer)
  clearInterval(game.hudTimer)
  $('#zone-hud').classList.add('hidden')
  cleanupStage()
  $('#game-result-text').textContent = text
  $('#game-result').classList.remove('hidden')
  const { onFinish } = game
  game = null
  onFinish()
  setTimeout(() => $('#game-result').classList.add('hidden'), 2000)
}

function finish(success) {
  if (!game || game.done) return
  flush()
  game.done = true
  clearTimeout(game.endTimer)
  clearInterval(game.sendTimer)
  clearInterval(game.hudTimer)
  $('#zone-hud').classList.add('hidden')
  game.leaveBtn?.remove()

  const stage = $('#wipe-stage')
  if (success) {
    // 창 완전히 열기 (구경꾼도 같이 봄)
    if (stage.classList.contains('hidden')) {
      stage.classList.remove('hidden')
      stage.classList.toggle('aquarium', config.aquarium)
      resize()
      $('#wipe-fog').getContext('2d').clearRect(0, 0, innerWidth, innerHeight)
    }
    stage.classList.add('clear')
  }
  const successText = config.aquarium ? '시야가 활짝 · 휴식의 질 최고' : '이 풍경 0원'
  $('#game-result-text').textContent = success ? successText : '시야가 좁았다'
  $('#game-result').classList.remove('hidden')

  setTimeout(() => {
    $('#game-result').classList.add('hidden')
    cleanupStage()
    const { onFinish } = game
    game = null
    onFinish()
  }, RESULT_MS)
}
