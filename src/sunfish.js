// 픽셀 개복치 이미지 + 말풍선 표시

// 원본 이미지는 파란색. 접속자마다 색조를 돌려서 구분한다.
const HUES = [0, -40, 40, 90, 140, 180, -140, -90]
const BUBBLE_MS = 4000
const SCALE = 0.55 // 원본 픽셀 크기 대비 표시 배율

// 프레임: [파일, 원본 너비]  (전부 왼쪽을 보는 그림, 오른쪽은 좌우반전)
const FRAMES = {
  swim1: ['/fish/fish-left01.png', 257],
  swim2: ['/fish/fish-left02.png', 235],
  talk: ['/fish/fish-left-mouthopen.png', 217],
  blink: ['/fish/fish-left-eyesclosed.png', 210],
  front: ['/fish/fish-middle.png', 214],
  back: ['/fish/fish-backmiddle.png', 206],
  backleft: ['/fish/fish-backleft.png', 203],
  backright: ['/fish/fish-backright.png', 202],
  lay: ['/fish/fish-laying.png', 253],
  faint: ['/fish/fish-back-upsidedown.png', 214],
}

// 가끔 하는 동작. 한 단계 = [프레임, 틱 수(1틱=0.3초), 반대로 뒤집어 보일지]
// turnAround: 끝나면 보는 방향이 바뀜
const ACTIONS = [
  // 정면을 보고 반대쪽으로 돌아섬
  { weight: 4, turnAround: true, steps: [['front', 2, false]] },
  // 한 바퀴 빙글 (왼쪽 → 정면 → 오른쪽 → 뒤 → 왼쪽)
  { weight: 2, steps: [['front', 1, false], ['swim1', 1, true], ['backright', 1, false], ['back', 1, false], ['backleft', 1, false]] },
  // 옆으로 드러누워 쉬기
  { weight: 2, steps: [['lay', 12, false]] },
]
const ACTION_CHANCE = 0.012 // 틱마다 동작을 시작할 확률 (평균 25초에 한 번)

function pickAction() {
  let r = Math.random() * ACTIONS.reduce((n, a) => n + a.weight, 0)
  for (const a of ACTIONS) if ((r -= a.weight) < 0) return a
  return ACTIONS[0]
}
for (const [src] of Object.values(FRAMES)) new Image().src = src // 미리 불러오기

const fishes = new Map() // id -> { el, body, img, flipped, action, fainted, bubble, timer, talking, blinkUntil }

// id로 값을 정해서 모든 접속자 화면에서 같은 색·방향이 나오게 함
function hashOf(id) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  // 아래 비트가 한쪽으로 쏠리지 않게 섞기
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

function setFrame(img, name, mirrored) {
  img.classList.toggle('flip', mirrored)
  if (img.dataset.frame === name) return
  const [src, w] = FRAMES[name]
  img.dataset.frame = name
  img.src = src
  img.style.width = `${Math.round(w * SCALE)}px`
}

// 진행 중인 동작의 현재 프레임을 돌려주고 한 틱 진행. 끝나면 null
function stepAction(f) {
  const a = f.action
  const [frame, ticks, mirror] = a.def.steps[a.step]
  const result = [frame, f.flipped !== mirror]
  if (++a.t >= ticks) {
    a.t = 0
    if (++a.step >= a.def.steps.length) {
      if (a.def.turnAround) f.flipped = !f.flipped
      f.action = null
    }
  }
  return result
}

// 모든 개복치를 같은 박자로 갱신: 헤엄(지느러미 두 프레임), 말할 때 입 뻐끔, 가끔 눈 깜빡·돌아보기·눕기
let tick = 0
setInterval(() => {
  tick++
  const now = Date.now()
  for (const f of fishes.values()) {
    if (!f.blinkUntil && Math.random() < 0.03) f.blinkUntil = now + 250
    if (f.blinkUntil && now > f.blinkUntil) f.blinkUntil = 0

    if (f.fainted) {
      setFrame(f.img, 'faint', false)
      continue
    }
    if (!f.action && !f.talking && Math.random() < ACTION_CHANCE) {
      f.action = { def: pickAction(), step: 0, t: 0 }
    }

    let frame = tick % 2 ? 'swim1' : 'swim2'
    let mirrored = f.flipped
    if (f.talking) frame = tick % 2 ? 'talk' : 'swim1'
    else if (f.action) [frame, mirrored] = stepAction(f)
    else if (f.blinkUntil) frame = 'blink'
    setFrame(f.img, frame, mirrored)
  }
}, 300)

export function addFish(tank, { id, name, x, y }, isMe) {
  if (fishes.has(id)) return
  const el = document.createElement('div')
  el.className = 'fish' + (isMe ? ' me' : '')
  el.style.left = `${x}%`
  el.style.top = `${y}%`
  // 개체마다 흔들림 박자를 다르게
  el.style.setProperty('--bob-dur', `${4 + Math.random() * 2}s`)
  el.style.setProperty('--bob-delay', `${-Math.random() * 4}s`)

  const body = document.createElement('div')
  body.className = 'fish-body'
  const h = hashOf(id)
  const img = document.createElement('img')
  const flipped = Boolean(h & 8)
  img.className = 'sunfish-img'
  img.alt = ''
  img.draggable = false
  img.style.filter = `hue-rotate(${HUES[h % HUES.length]}deg)`
  setFrame(img, 'swim1', flipped)
  // 프레임마다 그림 크기가 달라도 이름표가 들썩이지 않게 높이 고정
  const box = document.createElement('div')
  box.className = 'sunfish-box'
  box.appendChild(img)
  body.appendChild(box)

  const label = document.createElement('div')
  label.className = 'fish-name'
  label.textContent = isMe ? `${name} (나)` : name

  body.appendChild(label)
  el.appendChild(body)
  tank.appendChild(el)
  fishes.set(id, { el, body, img, flipped, action: null, fainted: false, bubble: null, timer: null, talking: false, blinkUntil: 0 })
}

export function removeFish(id) {
  const f = fishes.get(id)
  if (!f) return
  fishes.delete(id)
  clearTimeout(f.timer)
  f.el.classList.add('leaving')
  setTimeout(() => f.el.remove(), 600)
}

// 멍때리기에서 움직이면 뒤집혀 기절
export function setFainted(id, fainted) {
  const f = fishes.get(id)
  if (!f) return
  f.fainted = fainted
  f.action = null
  f.el.classList.toggle('fainted', fainted)
  setFrame(f.img, fainted ? 'faint' : 'swim1', fainted ? false : f.flipped)
}

export function fishIds() {
  return [...fishes.keys()]
}

export function showBubble(id, text) {
  const f = fishes.get(id)
  if (!f) return
  if (f.bubble) f.bubble.remove()
  clearTimeout(f.timer)

  const bubble = document.createElement('div')
  bubble.className = 'speech'
  bubble.textContent = String(text).slice(0, 60)
  f.body.appendChild(bubble)
  f.bubble = bubble
  f.talking = true
  // 말할 땐 하던 동작을 멈추고 원래 방향으로 (돌아서는 중이었다면 돌아선 걸로)
  if (f.action?.def.turnAround) f.flipped = !f.flipped
  f.action = null

  f.timer = setTimeout(() => {
    bubble.classList.add('fade')
    f.talking = false
    setTimeout(() => {
      bubble.remove()
      if (f.bubble === bubble) f.bubble = null
    }, 400)
  }, BUBBLE_MS)
}
