-- Life OS 云端自动同步：在 Supabase SQL Editor 中执行一次
-- 打开：https://supabase.com/dashboard/project/qgjmouupwzyfvxoyiyxm/sql/new

create table if not exists public.lifeos_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.lifeos_state enable row level security;

drop policy if exists "read own lifeos state" on public.lifeos_state;
create policy "read own lifeos state"
on public.lifeos_state for select
using (auth.uid() = user_id);

drop policy if exists "insert own lifeos state" on public.lifeos_state;
create policy "insert own lifeos state"
on public.lifeos_state for insert
with check (auth.uid() = user_id);

drop policy if exists "update own lifeos state" on public.lifeos_state;
create policy "update own lifeos state"
on public.lifeos_state for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

revoke all on public.lifeos_state from anon;
grant select, insert, update on public.lifeos_state to authenticated;
