-- 휴식 밸런스 투표 테이블 (Supabase → SQL Editor에 붙여넣고 Run)
create table if not exists public.balance_votes (
  question_id int  not null,
  voter_id    text not null,
  choice      text not null check (choice in ('a', 'b')),
  updated_at  timestamptz not null default now(),
  primary key (question_id, voter_id)
);

-- 로그인 없이(anon 키로) 읽고, 넣고, 바꿀 수 있게. 지우기는 막음
alter table public.balance_votes enable row level security;
create policy "balance votes: read"   on public.balance_votes for select to anon using (true);
create policy "balance votes: insert" on public.balance_votes for insert to anon with check (true);
create policy "balance votes: update" on public.balance_votes for update to anon using (true) with check (true);
