// Supabase Realtime: Presence(접속자 개복치) + Broadcast(채팅 말풍선, 게임 제안)
// DB 테이블은 쓰지 않는다.
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasKeys = Boolean(URL && KEY && !URL.includes('xxxx'))

let channel = null

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
        await channel.track({ id: me.id, name: me.name, x: me.x, y: me.y })
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
