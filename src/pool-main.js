// 도트 수조판 개복치 수조: 입장, 채팅, 게임은 원래 사이트(main.js)와 같은 구조.
// 개복치 그리기만 sunfish.js 대신 pool.js(셰이더)를 쓴다.
import { addFish, updateFish, removeFish, fishIds, showBubble, setFainted, setNight, setSide, HUES, swatchColor } from './pool.js'
import { connect, sendChat, sendGame, updatePresence } from './realtime.js'
import { initGame, onGameMessage, onPresence, playingIds } from './game.js'
import { initBalance, onVoteUpdated, currentQuestion } from './balance.js'
import { configureWipe } from './wipe.js'

// 창 닦기: 아쿠아리움 관람실 모양, 시간 제한 없음
configureWipe({ aquarium: true, timed: false })

const $ = (sel) => document.querySelector(sel)
const layer = $('#tank') // 이름표·말풍선이 들어가는 곳
const statusEl = $('#status')

function setStatus(text) {
  statusEl.textContent = text
  statusEl.classList.toggle('hidden', !text)
}

// ---------- HUD: 접속 시간 · 지금 시각 ----------
const startedAt = Date.now()
const pad = (n) => String(n).padStart(2, '0')
function tickHud() {
  const sec = Math.floor((Date.now() - startedAt) / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  $('#hud-uptime').textContent = h ? `${h}:${pad(m)}:${pad(sec % 60)}` : `${pad(m)}:${pad(sec % 60)}`
  const now = new Date()
  const hh = now.getHours()
  $('#hud-ampm').textContent = hh < 12 ? 'AM' : 'PM'
  $('#hud-time').textContent = `${hh % 12 || 12}:${pad(now.getMinutes())}`
}
tickHud()
setInterval(tickHud, 1000)

// ---------- 이 브라우저에 기억해 두는 설정 (닉네임·색·물) ----------
const PREFS_KEY = 'sunfish-pool-prefs'
const WATER_IDS = ['px', 'speed', 'dither', 'pal', 'light']
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}
  } catch {
    return {}
  }
}
const prefs = loadPrefs()
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {}
}

// ---------- 입장 ----------
let me = null

$('#enter-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const name = $('#name-input').value.trim().slice(0, 12)
  if (!name) return

  // 개복치 고유 id는 이 브라우저에 기억 (밸런스 투표에서 '한 사람 한 표'의 기준)
  prefs.fishId ??= crypto.randomUUID()
  me = { id: prefs.fishId, name, x: 50, y: 50, hue: prefs.hue, joinedAt: Date.now(), vote: null }
  prefs.name = name
  savePrefs()
  $('#nick-input').value = name

  $('#enter').classList.add('hidden')
  $('#chat-form').classList.remove('hidden')
  $('#hud-name').textContent = name
  $('#chat-input').focus()

  addFish(layer, me, true)
  initGame(me, sendGame, { setFainted })
  initBalance(me, { onSidesChange: updateSides })
  setInterval(updateSides, 1000) // 질문이 바뀌거나 게임이 시작·끝나면 반영

  connect(me, {
    onSync(people) {
      const present = new Set(people.map((p) => p.id))
      peopleVotes.clear()
      for (const p of people) {
        if (p.id === me.id) continue
        peopleVotes.set(p.id, p.vote)
        addFish(layer, p, false)
        updateFish(p.id, p) // 이미 있던 개복치면 닉네임·색 바뀐 것 반영
      }
      for (const id of fishIds()) {
        if (id !== me.id && !present.has(id)) removeFish(id)
      }
      onPresence([...present])
      updateSides()
    },
    onChat({ id, text }) {
      showBubble(id, text)
    },
    onGame: onGameMessage,
    onVote: onVoteUpdated,
    onStatus(status) {
      if (status === 'offline') setStatus('혼자 모드 · .env에 Supabase 키를 넣으면 같이 놀 수 있어요')
      else if (status === 'SUBSCRIBED') setStatus('')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setStatus('실시간 연결에 실패했어요')
    },
  })
})

// ---------- 밸런스 투표 → 수조: A는 왼쪽, B는 오른쪽 (게임 중인 개복치는 빼고) ----------
const peopleVotes = new Map() // 다른 사람 id → { q, c } (Presence에서)
function updateSides() {
  if (!me) return
  const q = currentQuestion().id
  const playing = playingIds()
  for (const id of fishIds()) {
    const v = id === me.id ? me.vote : peopleVotes.get(id)
    setSide(id, !playing.has(id) && v && v.q === q ? v.c : null)
  }
}

// ---------- 채팅 ----------
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const input = $('#chat-input')
  const text = input.value.trim().slice(0, 60)
  if (!text || !me) return
  showBubble(me.id, text)
  sendChat(me.id, text)
  input.value = ''
})

// ---------- 우상단 설정: 닉네임 · 개복치 색 · 물 ----------
const settingsBtn = $('#settings-btn')
const settings = $('#settings')
function openSettings(open) {
  settings.classList.toggle('hidden', !open)
  settingsBtn.setAttribute('aria-expanded', String(open))
}
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  openSettings(settings.classList.contains('hidden'))
})
// 바깥을 누르거나 Esc면 닫기
addEventListener('pointerdown', (e) => {
  if (!settings.classList.contains('hidden') && !settings.contains(e.target) && !settingsBtn.contains(e.target)) openSettings(false)
})
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openSettings(false)
})

// 닉네임
if (prefs.name) $('#name-input').value = prefs.name
$('#nick-input').value = prefs.name || ''
$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const name = $('#nick-input').value.trim().slice(0, 12)
  if (!name) return
  prefs.name = name
  savePrefs()
  if (!me) {
    $('#name-input').value = name // 입장 전이면 입장 칸에 채워 두기
    return
  }
  me.name = name
  $('#hud-name').textContent = name
  updateFish(me.id, { name, hue: me.hue })
  updatePresence(me)
})

// 개복치 색
const swatches = $('#swatches')
function renderSwatches() {
  swatches.replaceChildren(...HUES.map((deg, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.style.background = swatchColor(deg)
    b.setAttribute('aria-label', `색 ${i + 1}`)
    b.setAttribute('aria-pressed', String(prefs.hue === deg))
    b.addEventListener('click', () => {
      prefs.hue = deg
      savePrefs()
      renderSwatches()
      if (!me) return
      me.hue = deg
      updateFish(me.id, { hue: deg })
      updatePresence(me)
    })
    return b
  }))
}
renderSwatches()

// 물: 바꾼 값 기억했다가 다음에 들어와도 그대로
for (const id of WATER_IDS) {
  const el = document.getElementById(id)
  const saved = prefs.water?.[id]
  if (saved !== undefined) {
    if (el.type === 'checkbox') el.checked = saved
    else el.value = saved
    el.dispatchEvent(new Event('input'))
  }
  el.addEventListener('input', () => {
    prefs.water = { ...prefs.water, [id]: el.type === 'checkbox' ? el.checked : el.value }
    savePrefs()
  })
}

// ---------- 밤 모드: 자동(오후엔 밤) · 낮 · 밤 ----------
function applyTheme(instant = false) {
  const mode = prefs.theme || 'auto'
  const isNight = mode === 'night' || (mode === 'auto' && new Date().getHours() >= 12)
  document.documentElement.dataset.theme = isNight ? 'night' : 'day'
  setNight(isNight, instant)
  for (const b of document.querySelectorAll('#theme-mode button')) {
    b.setAttribute('aria-checked', String(b.dataset.mode === mode))
  }
}
for (const b of document.querySelectorAll('#theme-mode button')) {
  b.addEventListener('click', () => {
    prefs.theme = b.dataset.mode
    savePrefs()
    applyTheme()
  })
}
applyTheme(true)
setInterval(applyTheme, 30000) // 자동일 때 정오가 지나면 알아서 바뀜
