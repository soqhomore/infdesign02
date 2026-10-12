// 도트 수조판 개복치 수조: 입장, 채팅, 게임은 원래 사이트(main.js)와 같은 구조.
// 개복치 그리기만 sunfish.js 대신 pool.js(셰이더)를 쓴다.
import { addFish, removeFish, fishIds, showBubble, setFainted } from './pool.js'
import { connect, sendChat, sendGame } from './realtime.js'
import { initGame, onGameMessage, onPresence } from './game.js'

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

// ---------- 입장 ----------
let me = null

$('#enter-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const name = $('#name-input').value.trim().slice(0, 12)
  if (!name) return

  me = { id: crypto.randomUUID(), name, x: 50, y: 50 }

  $('#enter').classList.add('hidden')
  $('#chat-form').classList.remove('hidden')
  $('#hud-name').textContent = name
  $('#chat-input').focus()

  addFish(layer, me, true)
  initGame(me, sendGame, { setFainted })

  connect(me, {
    onSync(people) {
      const present = new Set(people.map((p) => p.id))
      for (const p of people) {
        if (p.id !== me.id) addFish(layer, p, false)
      }
      for (const id of fishIds()) {
        if (id !== me.id && !present.has(id)) removeFish(id)
      }
      onPresence([...present])
    },
    onChat({ id, text }) {
      showBubble(id, text)
    },
    onGame: onGameMessage,
    onStatus(status) {
      if (status === 'offline') setStatus('혼자 모드 · .env에 Supabase 키를 넣으면 같이 놀 수 있어요')
      else if (status === 'SUBSCRIBED') setStatus('')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setStatus('실시간 연결에 실패했어요')
    },
  })
})

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
