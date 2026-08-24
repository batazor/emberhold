-- §6: сейв — единый сериализуемый blob. Сервер хранит его как есть,
-- по строке на пользователя; пересчёт и валидация — дело будущего сервера.
create table public.saves (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  watermark double precision not null default 0,
  saved_at timestamptz not null default now()
);

alter table public.saves enable row level security;

create policy "own save: read" on public.saves
  for select using ((select auth.uid()) = user_id);
create policy "own save: insert" on public.saves
  for insert with check ((select auth.uid()) = user_id);
create policy "own save: update" on public.saves
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own save: delete" on public.saves
  for delete using ((select auth.uid()) = user_id);;
