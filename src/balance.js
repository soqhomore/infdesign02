// 휴식 밸런스 투표: 항상 열려 있는 작은 아이콘 + 미니 팝업
// - 질문은 서버 없이 시계로 정함 (5분마다, 모두 같은 질문)
// - 표는 Supabase balance_votes에 upsert (한 사람당 질문마다 한 표, 누적)
// - 투표하면 'vote-updated' Broadcast → 받은 쪽은 표를 다시 불러옴
// - 내 선택은 Presence에 실어서, 수조에서 A는 왼쪽 · B는 오른쪽으로 헤엄쳐 감
import { balanceQuestions } from './data/balance.js'
import { db, sendVoteUpdated, updatePresence } from './realtime.js'

const ROTATE_MS = 300000 // 5분
const TABLE = 'balance_votes'
const AXES = [
  ['money', '돈 드는 쪽'],
  ['view', '넓은 쪽'],
  ['agency', '내가 고르는 쪽'],
]

const $ = (sel) => document.querySelector(sel)

let me = null
let onChange = () => {} // 수조 쪽에 '누가 어느 쪽인지' 다시 계산하라고 알림
const counts = { a: 0, b: 0 } // 지금 질문의 표
const myVotes = new Map() // 질문 id → 'a' | 'b' (내가 고른 것, 누적)
let shownIndex = -1
let loadError = false

export const questionIndex = (now = Date.now()) => Math.floor(now / ROTATE_MS) % balanceQuestions.length
export const currentQuestion = () => balanceQuestions[questionIndex()]

// 지금 질문에 대한 내 선택 (Presence에 실을 값)
export function myCurrentVote() {
  const q = currentQuestion()
  const c = myVotes.get(q.id)
  return c ? { q: q.id, c } : null
}

// ---------- 표 불러오기 / 투표 ----------

async function loadCurrent() {
  const q = currentQuestion()
  const client = db()
  if (!client) return render()
  const { data, error } = await client.from(TABLE).select('voter_id, choice').eq('question_id', q.id)
  loadError = Boolean(error)
  if (!error && q.id === currentQuestion().id) {
    counts.a = data.filter((r) => r.choice === 'a').length
    counts.b = data.filter((r) => r.choice === 'b').length
    const mine = data.find((r) => r.voter_id === me.id)
    if (mine) myVotes.set(q.id, mine.choice)
  }
  render()
  syncPresence()
}

async function vote(choice) {
  const q = currentQuestion()
  const prev = myVotes.get(q.id)
  if (prev === choice) return
  myVotes.set(q.id, choice)
  // 바로 반영해 보이고(낙관적), 저장 뒤 실제 표로 다시 맞춤
  if (prev) counts[prev] = Math.max(0, counts[prev] - 1)
  counts[choice]++
  render()
  syncPresence()

  const client = db()
  if (!client) return
  const { error } = await client
    .from(TABLE)
    .upsert({ question_id: q.id, voter_id: me.id, choice }, { onConflict: 'question_id,voter_id' })
  loadError = Boolean(error)
  if (!error) sendVoteUpdated({ question_id: q.id, voter_id: me.id })
  loadCurrent()
}

// 다른 사람이 투표했다는 Broadcast
export function onVoteUpdated({ question_id, voter_id }) {
  const q = currentQuestion()
  if (question_id !== q.id || voter_id === me?.id) return
  // 내가 투표한 질문에 새 표가 들어오면 살짝 알림
  if (myVotes.has(q.id)) flash()
  loadCurrent()
}

function syncPresence() {
  if (!me) return
  me.vote = myCurrentVote()
  updatePresence(me)
  onChange()
}

// ---------- '더보기': 10개 질문 전체 누적으로 본 쉼의 경향 ----------
async function loadSummary() {
  const el = $('#balance-summary')
  const client = db()
  let rows = []
  if (client) {
    const { data, error } = await client.from(TABLE).select('question_id, choice')
    if (!error) rows = data
  } else {
    rows = [...myVotes].map(([question_id, choice]) => ({ question_id, choice }))
  }
  const parts = []
  for (const [tag, label] of AXES) {
    let hit = 0
    let total = 0
    for (const q of balanceQuestions) {
      const inA = q.a.tags.includes(tag)
      const inB = q.b.tags.includes(tag)
      if (inA === inB) continue // 한쪽에만 태그가 있는 질문만
      const side = inA ? 'a' : 'b'
      for (const r of rows) {
        if (r.question_id !== q.id) continue
        total++
        if (r.choice === side) hit++
      }
    }
    if (total) parts.push(`${label} ${Math.round((hit / total) * 100)}%`)
  }
  el.textContent = parts.length ? `수조 사람들의 쉼 · ${parts.join(' · ')}` : '수조 사람들의 쉼 · 아직 표가 없어요'
}

// ---------- 화면 ----------

function render() {
  const q = currentQuestion()
  const mine = myVotes.get(q.id)
  $('#balance-category').textContent = q.category
  for (const side of ['a', 'b']) {
    const btn = $(`#balance-${side}`)
    btn.textContent = q[side].text
    btn.setAttribute('aria-pressed', String(mine === side))
  }
  const result = $('#balance-result')
  result.classList.toggle('hidden', !mine)
  if (mine) {
    const total = counts.a + counts.b
    const pa = total ? Math.round((counts.a / total) * 100) : 0
    $('#balance-bar').style.width = `${pa}%`
    $('#balance-count').textContent = `A ${counts.a}표 · ${pa}%  |  B ${counts.b}표 · ${total ? 100 - pa : 0}%`
  }
  $('#balance-note').classList.toggle('hidden', !loadError && Boolean(db()))
  $('#balance-note').textContent = db() ? '표를 저장하지 못했어요 (투표 테이블 확인 필요)' : '혼자 모드라 표가 이 화면에만 남아요'
  updateBadge()
}

function tickRemaining() {
  const left = ROTATE_MS - (Date.now() % ROTATE_MS)
  const sec = Math.ceil(left / 1000)
  $('#balance-left').textContent = `다음 질문까지 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  // 질문이 바뀌면: 다시 불러오고, 수조의 개복치들은 흩어짐
  const idx = questionIndex()
  if (idx !== shownIndex) {
    const first = shownIndex === -1
    shownIndex = idx
    counts.a = counts.b = 0
    render()
    loadCurrent()
    syncPresence()
    if (!first) flash()
  }
}

// ---------- 아이콘: 깜빡임 + 점 배지 ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const FLASH_MS = 2700
let badgeUntil = 0
// 점 배지: 아직 투표 안 한 질문이면 계속, 아니면 알림(깜빡임) 동안만
function updateBadge() {
  const unvoted = !myVotes.has(currentQuestion().id)
  $('#balance-btn').classList.toggle('badge', unvoted || Date.now() < badgeUntil)
}
function flash() {
  badgeUntil = Date.now() + FLASH_MS
  updateBadge()
  setTimeout(updateBadge, FLASH_MS + 50)
  if (reduceMotion) return
  const btn = $('#balance-btn')
  btn.classList.remove('flash')
  void btn.offsetWidth // 애니메이션 다시 시작
  btn.classList.add('flash')
}

// ---------- 팝업 열고 닫기 ----------
function open(on) {
  $('#balance-pop').classList.toggle('hidden', !on)
  $('#balance-btn').setAttribute('aria-expanded', String(on))
}

export function initBalance(myself, { onSidesChange }) {
  me = myself
  onChange = onSidesChange
  const btn = $('#balance-btn')
  const pop = $('#balance-pop')
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    open(pop.classList.contains('hidden'))
  })
  addEventListener('pointerdown', (e) => {
    if (!pop.classList.contains('hidden') && !pop.contains(e.target) && !btn.contains(e.target)) open(false)
  })
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') open(false)
  })
  $('#balance-a').addEventListener('click', () => vote('a'))
  $('#balance-b').addEventListener('click', () => vote('b'))
  $('#balance-more').addEventListener('click', () => {
    const more = $('#balance-more-text')
    const show = more.classList.contains('hidden')
    more.classList.toggle('hidden', !show)
    $('#balance-more').textContent = show ? '접기' : '더보기'
    if (show) loadSummary()
  })

  btn.classList.remove('hidden')
  tickRemaining()
  setInterval(tickRemaining, 1000)
  flash() // 처음 들어왔을 때
}
