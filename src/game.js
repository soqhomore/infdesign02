// 게임 제안: 제안 → 10초 참여 모집 → 참여자만 같은 시각에 시작
// 시작 시각(startAt)은 제안 메시지에 담아 Broadcast로 공유한다.
// 멍때리기: 준비 3초 뒤부터 입력이 감지되면 기절(Broadcast), 마지막 한 마리가 승리
// 창 닦기: wipe.js
import { startWipe, onWipeMessage, onWipePresence } from './wipe.js'

export const GAMES = {
  zone: '아무것도 하지 않기 대결하자', // (예전 이름: 멍때리기)
  wipe: '시야를 넓히자', // (예전 이름: 김 서린 창 닦기)
}
const INVITE_MS = 10000
const GRACE_MS = 3000 // 멍때리기 준비 시간 (입력해도 기절 안 함)
const SETTLE_MS = 1000 // 마지막 기절 뒤 거의 동시에 온 기절 메시지를 기다리는 시간
const RESULT_MS = 5000 // 결과 보여주는 시간
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel']

const $ = (sel) => document.querySelector(sel)

let me = null
let setFainted = () => {} // 개복치를 그리는 쪽(sunfish.js 또는 pool.js)에서 넘겨받음
let send = () => {}
let current = null // { gameId, game, hostId, hostName, startAt, players: Map(id -> name), joined, phase, fainted: Map(id -> at), left: Set }
let timer = null

// 65초 → '1분 5초'
function fmt(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(sec / 60)
  return m ? `${m}분 ${sec % 60}초` : `${sec}초`
}

// 65초 → '1:05'
function clock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

// 받침 있으면 '이', 없으면 '가'
function subj(name) {
  const code = name.charCodeAt(name.length - 1) - 0xac00
  if (code < 0 || code > 11171) return `${name}가`
  return code % 28 ? `${name}이` : `${name}가`
}

export function initGame(myself, sendFn, fishApi) {
  me = myself
  send = sendFn
  setFainted = fishApi.setFainted

  $('#game-btn').addEventListener('click', () => {
    if (current) return
    $('#game-picker').classList.toggle('hidden')
  })
  for (const btn of document.querySelectorAll('#game-picker [data-game]')) {
    btn.addEventListener('click', () => {
      $('#game-picker').classList.add('hidden')
      propose(btn.dataset.game)
    })
  }
  $('#game-picker-cancel').addEventListener('click', () => $('#game-picker').classList.add('hidden'))
  $('#game-join').addEventListener('click', join)
  $('#game-rank-close')?.addEventListener('click', hideRanking)
  for (const type of INPUT_EVENTS) window.addEventListener(type, onZoneInput, { passive: true })
}

function propose(game) {
  if (current) return
  const msg = {
    type: 'propose',
    gameId: crypto.randomUUID(),
    game,
    hostId: me.id,
    hostName: me.name,
    startAt: Date.now() + INVITE_MS,
  }
  send(msg)
  onGameMessage(msg)
  join() // 제안한 사람은 자동 참여
}

function join() {
  if (!current || current.joined || current.phase !== 'invite') return
  current.joined = true
  const msg = { type: 'join', gameId: current.gameId, id: me.id, name: me.name }
  send(msg)
  onGameMessage(msg)
}

export function onGameMessage(msg) {
  if (msg.type === 'propose') {
    if (current) {
      // 이미 게임 중이면 무시. 동시에 두 제안이 오면 먼저 시작하는 쪽으로 모두 맞춘다.
      if (current.phase !== 'invite') return
      if (current.startAt < msg.startAt) return
      if (current.startAt === msg.startAt && current.gameId < msg.gameId) return
    }
    current = {
      gameId: msg.gameId,
      game: msg.game,
      hostId: msg.hostId,
      hostName: msg.hostName,
      startAt: msg.startAt,
      players: new Map(),
      joined: false,
      phase: 'invite',
    }
    $('#game-picker').classList.add('hidden')
    showBanner()
  } else if (msg.type === 'join') {
    if (!current || current.gameId !== msg.gameId || current.phase !== 'invite') return
    current.players.set(msg.id, msg.name)
    render()
  } else if (msg.type === 'faint') {
    if (!current || current.gameId !== msg.gameId || current.phase !== 'playing') return
    faint(msg.id, msg.at)
  } else if (msg.type === 'wipe' || msg.type === 'wipe-done' || msg.type === 'wipe-leave') {
    if (!current || current.gameId !== msg.gameId) return
    onWipeMessage(msg)
  }
}

// 접속자 목록이 바뀔 때: 나간 사람은 참여자에서 빼거나(모집 중) 기절 처리(게임 중)
export function onPresence(presentIds) {
  if (!current) return
  const present = new Set(presentIds)
  for (const id of current.players.keys()) {
    if (present.has(id) || id === me.id) continue
    if (current.phase === 'invite') current.players.delete(id)
    else if (current.game === 'zone' && current.phase === 'playing') {
      current.left.add(id) // 순위에 '나감'으로 표시
      faint(id, Date.now())
    }
  }
  if (current.game === 'wipe' && current.phase === 'playing') onWipePresence(presentIds)
  render()
}

function showBanner() {
  $('#game-btn').disabled = true
  $('#game-banner').classList.remove('hidden')
  clearInterval(timer)
  timer = setInterval(update, 100)
  render()
}

function update() {
  if (!current) return
  if (current.phase === 'invite' && Date.now() >= current.startAt) {
    $('#game-banner').classList.add('hidden')
    if (!current.players.size) clear()
    else if (current.game === 'zone') startZone()
    else {
      clearInterval(timer)
      startWipe({
        gameId: current.gameId,
        startAt: current.startAt,
        joined: current.joined,
        players: [...current.players.keys()],
        meId: me.id,
        send,
        onFinish: clear,
      })
    }
    if (current) current.phase = 'playing'
    return
  }
  render()
}

function render() {
  if (!current) return
  const left = Math.max(0, current.startAt - Date.now())
  const name = GAMES[current.game]

  if (current.phase === 'invite') {
    const isHost = current.hostId === me.id
    $('#game-banner-text').textContent = isHost
      ? `'${name}'고 했어요`
      : `${subj(current.hostName)} '${name}'고 해요`
    $('#game-banner-sub').textContent = `${current.players.size}명 참여 · ${Math.ceil(left / 1000)}초 뒤 시작`
    $('#game-join').classList.toggle('hidden', current.joined)
    $('#game-joined').classList.toggle('hidden', !current.joined)
    $('#game-banner-bar').style.transform = `scaleX(${left / INVITE_MS})`
  } else if (current.game === 'zone' && current.phase === 'playing') {
    renderZone()
  }
}

// ---------- 멍때리기 ----------

// 참여자든 구경꾼이든 모두 같은 화면(수조)에서 진행 상황을 본다
function startZone() {
  current.phase = 'playing'
  current.fainted = new Map()
  current.left = new Set()
  current.endTimer = null
  $('#zone-hud-title').textContent = GAMES.zone
  if (current.joined) {
    // 채팅을 치면 기절하니까 입력창을 숨긴다
    document.activeElement?.blur()
    $('#chat-form').classList.add('hidden')
  }
  $('#zone-hud').classList.remove('hidden')
  clearInterval(timer)
  timer = setInterval(render, 200)
  render()
}

function onZoneInput() {
  if (!current || current.game !== 'zone' || current.phase !== 'playing' || !current.joined) return
  if (current.fainted.has(me.id) || current.endTimer) return
  if (Date.now() < current.startAt + GRACE_MS) return
  const msg = { type: 'faint', gameId: current.gameId, id: me.id, at: Date.now() }
  send(msg)
  onGameMessage(msg)
}

function faint(id, at) {
  if (!current.players.has(id) || current.fainted.has(id)) return
  current.fainted.set(id, at)
  setFainted(id, true)
  if (id === me.id) $('#chat-form').classList.remove('hidden') // 기절하면 다시 채팅 가능
  render()

  const alive = [...current.players.keys()].filter((p) => !current.fainted.has(p))
  const over = current.players.size === 1 ? alive.length === 0 : alive.length <= 1
  if (over && !current.endTimer) current.endTimer = setTimeout(finishZone, SETTLE_MS)
}

function renderZone() {
  const now = Date.now()
  const total = current.players.size
  const alive = total - current.fainted.size
  const prep = current.startAt + GRACE_MS - now
  const meIn = current.joined && !current.fainted.has(me.id)

  $('#zone-hud-time').textContent = clock(now - current.startAt)
  $('#zone-hud-count').textContent = `남은 개복치 ${alive}/${total}`
  $('#zone-hud-msg').textContent =
    prep > 0 ? `준비… ${Math.ceil(prep / 1000)}초 뒤부터 움직이면 기절!`
    : meIn ? '가만히… 마우스도 키보드도 건드리지 마세요'
    : current.joined ? '기절했어요 💫 구경 중'
    : '구경 중'
}

function finishZone() {
  if (!current) return
  clearInterval(timer)
  const ats = [...current.fainted.values()]
  const endAt = Math.max(...ats)
  let text
  if (current.players.size === 1) {
    const [name] = current.players.values()
    text = `${name} ${fmt(endAt - current.startAt)} 쉼`
  } else {
    const alive = [...current.players.keys()].filter((p) => !current.fainted.has(p))
    // 마지막 둘이 거의 동시에 기절했으면 더 늦게 기절한 쪽이 승리
    const winner = alive[0] ?? [...current.fainted].sort((a, b) => b[1] - a[1])[0][0]
    text = `${current.players.get(winner)} 승리, ${fmt(endAt - current.startAt)} 쉼`
  }

  $('#zone-hud').classList.add('hidden')
  // 순위표 자리가 있는 화면(도트판)이면 순위표로, 아니면 결과 한 줄만
  if ($('#game-rank')) showRanking(text)
  else {
    $('#game-result-text').textContent = text
    $('#game-result').classList.remove('hidden')
  }

  const ids = [...current.players.keys()]
  current.phase = 'result'
  setTimeout(() => {
    $('#game-result').classList.add('hidden')
    for (const id of ids) setFainted(id, false)
    $('#chat-form').classList.remove('hidden')
    clear()
  }, RESULT_MS)
}

// 지금 게임 중인 개복치 (투표 쪽으로 헤엄치기에서 뺌)
export function playingIds() {
  if (!current || current.phase === 'invite') return new Set()
  return new Set(current.players.keys())
}

// ---------- 멍때리기 순위 ----------
const RANK_MS = 15000
let rankTimer = null

// 끝까지 안 기절한 사람이 1위, 나머지는 늦게 기절한 순. 같은 순간 기절이면 같은 순위
function ranking() {
  const { players, fainted, left, startAt } = current
  const endAt = Math.max(...fainted.values())
  const rows = [...players].map(([id, name]) => ({
    id,
    name,
    at: fainted.has(id) ? fainted.get(id) : Infinity,
    rested: (fainted.has(id) ? fainted.get(id) : endAt) - startAt,
    tag: !fainted.has(id) ? '승리' : left.has(id) ? '나감' : '기절',
  }))
  rows.sort((a, b) => b.at - a.at)
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].at === r.at ? rows[i - 1].rank : i + 1
  })
  // 혼자 했거나 둘이 거의 동시에 기절해서 '승리'가 없으면 1위를 승리로
  if (players.size > 1 && !rows.some((r) => r.tag === '승리')) rows[0].tag = '승리'
  if (players.size === 1) rows[0].tag = '혼자 쉼'
  return rows
}

function showRanking(headline) {
  const card = $('#game-rank')
  $('#game-rank-title').textContent = headline
  const list = $('#game-rank-list')
  list.replaceChildren(...ranking().map((r) => {
    const li = document.createElement('li')
    li.className = r.id === me.id ? 'me' : ''
    const rank = document.createElement('span')
    rank.className = 'rank-no'
    rank.textContent = `${r.rank}위`
    const name = document.createElement('span')
    name.className = 'rank-name'
    name.textContent = r.id === me.id ? `${r.name} (나)` : r.name
    const time = document.createElement('span')
    time.className = 'rank-time'
    time.textContent = fmt(r.rested)
    const tag = document.createElement('span')
    tag.className = `rank-tag ${r.tag === '승리' ? 'win' : ''}`
    tag.textContent = r.tag
    li.append(rank, name, time, tag)
    return li
  }))
  card.classList.remove('hidden')
  clearTimeout(rankTimer)
  rankTimer = setTimeout(hideRanking, RANK_MS)
}

function hideRanking() {
  clearTimeout(rankTimer)
  $('#game-rank')?.classList.add('hidden')
}

function clear() {
  clearInterval(timer)
  current = null
  $('#game-btn').disabled = false
}
