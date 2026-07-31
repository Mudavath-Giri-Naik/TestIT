-- Ghost AI — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).

create table if not exists sessions (
  id text primary key,
  user_id uuid default auth.uid(),
  title text,
  provider text,
  model text,
  tokens_used integer default 0,
  created_at bigint
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  session_id text references sessions(id) on delete cascade,
  user_id uuid default auth.uid(),
  role text,
  content text,
  created_at bigint
);

create table if not exists memory (
  id integer primary key check (id = 1),
  user_id uuid default auth.uid(),
  core_memory text
);

create table if not exists api_keys (
  id text primary key,
  user_id uuid default auth.uid(),
  provider text not null,
  label text not null,
  key_value text not null,
  is_active boolean default false,
  created_at bigint
);

create table if not exists app_state (
  user_id uuid primary key default auth.uid(),
  last_session_id text
);

alter table sessions  enable row level security;
alter table messages  enable row level security;
alter table memory    enable row level security;
alter table api_keys  enable row level security;
alter table app_state enable row level security;

drop policy if exists "own rows" on sessions;
drop policy if exists "own rows" on messages;
drop policy if exists "own rows" on memory;
drop policy if exists "own rows" on api_keys;
drop policy if exists "own rows" on app_state;

create policy "own rows" on sessions  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on messages  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on memory    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on api_keys  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on app_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
