-- §4: мир один на всех (SEED в клиенте), в базе — только дельты игроков.
-- Визиты лежат отдельно от сейв-блоба, потому что у них другой читатель:
-- сейв читает только хозяин, а метки на карте — все, кто вошёл.
create table public.world_visits (
  user_id uuid not null references auth.users (id) on delete cascade,
  node integer not null,
  shift bigint not null,
  primary key (user_id, node, shift)
);

alter table public.world_visits enable row level security;

-- Читают все вошедшие: ради этого таблица и существует.
create policy "visits: read all" on public.world_visits
  for select to authenticated using (true);
create policy "visits: write own" on public.world_visits
  for insert with check ((select auth.uid()) = user_id);
create policy "visits: delete own" on public.world_visits
  for delete using ((select auth.uid()) = user_id);;
