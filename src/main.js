import { addFish, removeFish, fishIds, showBubble, setFainted } from './sunfish.js'
import { connect, sendChat, sendGame } from './realtime.js'
import { initGame, onGameMessage, onPresence } from './game.js'

const $ = (sel) => document.querySelector(sel)
const tank = $('#tank')
const statusEl = $('#status')

// 떠오르는 거품 장식
function makeBubbles() {
  const wrap = $('#bubbles')
  for (let i = 0; i < 18; i++) {
    const b = document.createElement('span')
    const size = 6 + Math.random() * 18
    b.style.width = b.style.height = `${size}px`
    b.style.left = `${Math.random() * 100}%`
    b.style.animationDuration = `${10 + Math.random() * 14}s`
    b.style.animationDelay = `${-Math.random() * 20}s`
    wrap.appendChild(b)
  }
}
makeBubbles()

function setStatus(text) {
  statusEl.textContent = text
  statusEl.classList.toggle('hidden', !text)
}

let me = null

$('#enter-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const name = $('#name-input').value.trim().slice(0, 12)
  if (!name) return

  me = {
    id: crypto.randomUUID(),
    name,
    x: 10 + Math.random() * 80,
    y: 18 + Math.random() * 52,
  }

  $('#enter').classList.add('hidden')
  $('#chat-form').classList.remove('hidden')
  $('#chat-input').focus()

  addFish(tank, me, true)
  initGame(me, sendGame, { setFainted })

  connect(me, {
    onSync(people) {
      const present = new Set(people.map((p) => p.id))
      for (const p of people) {
        if (p.id !== me.id) addFish(tank, p, false)
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
      if (status === 'offline') setStatus('.env에 Supabase 키를 넣으면 다른 사람과 함께 놀 수 있어요 (지금은 혼자 모드)')
      else if (status === 'SUBSCRIBED') setStatus('')
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setStatus('실시간 연결이 끊겼어요 · 다시 연결하는 중…')
    },
  })
})

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const input = $('#chat-input')
  const text = input.value.trim().slice(0, 60)
  if (!text || !me) return
  showBubble(me.id, text)
  sendChat(me.id, text)
  input.value = ''
})
