// Supabase Realtime: Presence(접속자 개복치) + Broadcast(채팅 말풍선, 게임 제안, 투표 갱신)
// DB 테이블은 휴식 밸런스 투표(balance_votes)만 쓴다 → db()
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasKeys = Boolean(URL && KEY && !URL.includes('xxxx'))

let channel = null
let client = null
let lastTracked = '' // 마지막으로 알린 내 정보 (바뀐 게 없으면 다시 안 보냄)

// Supabase 클라이언트는 하나만 (키가 없으면 null → 혼자 모드)
export function db() {
  if (!hasKeys) return null
  client ??= createClient(URL, KEY)
  return client
}

// 다른 사람에게 보이는 내 정보 (hue: 개복치 색, joinedAt: 들어온 시각 — 도트판에서만 씀)
function presenceOf(me) {
  // vote: 지금 질문에 고른 쪽 { q: 질문 id, c: 'a' | 'b' } (안 골랐으면 null)
  return { id: me.id, name: me.name, x: me.x, y: me.y, hue: me.hue, joinedAt: me.joinedAt, vote: me.vote ?? null }
}

export function connect(me, { onSync, onChat, onGame, onVote, onStatus }) {
  if (!hasKeys) {
    onStatus('offline')
    return
  }

  channel = db().channel('sunfish-tank', {
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
    .on('broadcast', { event: 'vote-updated' }, ({ payload }) => onVote?.(payload))
    .subscribe(async (status, err) => {
      // 실패 원인은 콘솔에 자세히 (err.cause에 서버가 준 이유가 들어 있는 경우가 많음)
      if (err) console.warn('[realtime]', status, err)
      onStatus(status)
      if (status === 'SUBSCRIBED') {
        // (다시) 연결되면 내 정보를 꼭 다시 알림
        lastTracked = JSON.stringify(presenceOf(me))
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
// Presence는 초당 보낼 수 있는 양이 정해져 있어서, 실제로 바뀐 게 있을 때만 보낸다
export function updatePresence(me) {
  if (!channel) return
  const next = JSON.stringify(presenceOf(me))
  if (next === lastTracked) return
  lastTracked = next
  channel.track(presenceOf(me))
}

// 투표했다고 알리기 → 받은 브라우저는 그 질문의 표를 다시 불러옴
export function sendVoteUpdated(payload) {
  if (!channel) return
  channel.send({ type: 'broadcast', event: 'vote-updated', payload })
}
