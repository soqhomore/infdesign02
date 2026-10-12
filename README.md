# 개복치 수조 🐟

Vite + 바닐라 JS + Supabase Realtime(Presence / Broadcast). DB 테이블은 쓰지 않아요.

## 실행

```bash
npm install
npm run dev
```

`.env`를 고친 뒤에는 `npm run dev`를 껐다가 다시 켜야 반영돼요.

## Supabase 키 받는 곳

1. https://supabase.com 가입 → **New project** (DB 비밀번호는 아무거나, Region은 Northeast Asia (Seoul) 추천)
2. 프로젝트가 만들어지면 왼쪽 아래 ⚙️ **Project Settings → API** (화면에 따라 **Data API** / **API Keys**)
   - **Project URL** → `.env`의 `VITE_SUPABASE_URL`
   - **anon public** 키 (또는 `sb_publishable_...` Publishable key) → `.env`의 `VITE_SUPABASE_ANON_KEY`
   - ⚠️ `service_role` / `secret` 키는 절대 넣지 마세요.
3. 테이블은 만들 필요 없어요. Realtime 설정(**Realtime → Settings**)에서 public 채널 접근이 허용돼 있는지만 확인 (기본값 허용).

키가 비어 있으면 화면 위에 "혼자 모드" 안내가 뜨고, 내 개복치와 말풍선만 동작해요.

## Figma MCP 연결 (토큰 적는 곳: `.mcp.json`)

1. Figma → 좌상단 계정 메뉴 → **Settings → Security → Personal access tokens → Generate new token**
   (권한: File content **Read**)
2. `.mcp.json`의 `FIGMA_API_KEY` 값에 토큰 붙여넣기
3. Claude Code를 이 폴더에서 다시 시작 → 프로젝트 MCP 서버 사용 승인 → `/mcp`에서 `figma` 연결 확인

`.mcp.json`은 `.gitignore`에 들어 있어서 토큰이 깃에 올라가지 않아요.
참고: Claude Code에 설치된 공식 Figma 플러그인을 쓰면 토큰 없이 `/mcp`에서 로그인(OAuth)만 해도 돼요.

## 파일

- `src/main.js` – 입장, 채팅 입력
- `src/realtime.js` – Supabase 채널 (Presence = 접속자 개복치, Broadcast = 말풍선·게임 제안·기절·문지른 좌표)
- `src/game.js` – 게임 제안: 고르기 → 10초 참여 모집 배너 → 참여자만 같은 시각(startAt)에 시작
  - 멍때리기: 준비 3초 뒤 입력(마우스·클릭·키·터치·휠)이 감지되면 기절 → Broadcast, 마지막 한 마리 승리
- `src/wipe.js` – 김 서린 창 닦기(협동): 강변 풍경 위 김 canvas를 문질러 지움(destination-out), 좌표 Broadcast, 김 다시 서림, 70% 성공 / 60초 실패
  - 난이도 조절: 파일 위쪽 `GOAL`, `BRUSH`, `HOLD_MS`, `FADE_MS`
- `src/sunfish.js` – 픽셀 개복치(헤엄·말하기·눈깜빡·돌아보기·한바퀴·눕기, 접속자별 색/방향), 말풍선(4초)
- `src/style.css` – 파스텔 물속 배경, 흔들림 애니메이션
- `fishimage/` – 픽셀 개복치 원본 이미지 (쓰는 프레임은 `public/fish/`에 복사돼 있음)
