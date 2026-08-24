create table public.player_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  language text not null check (language in ('en', 'ru')),
  updated_at timestamptz not null default now()
);

alter table public.player_settings enable row level security;

create policy "player_settings: read own" on public.player_settings for select
  using ((select auth.uid()) = user_id);
create policy "player_settings: write own" on public.player_settings for insert
  with check ((select auth.uid()) = user_id);
create policy "player_settings: update own" on public.player_settings for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "player_settings: delete own" on public.player_settings for delete
  using ((select auth.uid()) = user_id);;
