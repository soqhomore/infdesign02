// Supabase Realtime: Presence(접속자 개복치) + Broadcast(채팅 말풍선, 게임 제안)
// DB 테이블은 쓰지 않는다.
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasKeys = Boolean(URL && KEY && !URL.includes('xxxx'))

let channel = null

// 다른 사람에게 보이는 내 정보 (hue: 개복치 색, 도트판에서만 씀)
function presenceOf(me) {
  return { id: me.id, name: me.name, x: me.x, y: me.y, hue: me.hue }
}

export function connect(me, { onSync, onChat, onGame, onStatus }) {
  if (!hasKeys) {
    onStatus('offline')
    return
  }

  const supabase = createClient(URL, KEY)
  channel = supabase.channel('sunfish-tank', {
    config: {
      presence: { key: me.id },
      broadcast: { self: false },
    },
  })

  channel
    .on('presence', { event: 'sync' }, () => {
      // presenceState: { [key]: [{ id, name, x, y, ... }] }
      const people = Object.values(channel.presenceState()).map((list) => list[0])
      onSync(people)
    })
    .on('broadcast', { event: 'chat' }, ({ payload }) => onChat(payload))
    .on('broadcast', { event: 'game' }, ({ payload }) => onGame(payload))
    .subscribe(async (status) => {
      onStatus(status)
      if (status === 'SUBSCRIBED') {
        await channel.track(presenceOf(me))
      }
    })
}

export function sendChat(id, text) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'chat', payload: { id, text } })
}

export function sendGame(payload) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'game', payload })
}

// 닉네임·색을 바꿨을 때 다시 알리기 → 다른 사람 화면의 presence sync로 반영됨
export function updatePresence(me) {
  if (!channel) return
  channel.track(presenceOf(me))
}
