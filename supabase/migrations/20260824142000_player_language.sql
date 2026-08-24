-- Язык игрока: одна строка на аккаунт, читает только хозяин.
--
-- **Почему не в `camps`.** Ту таблицу читают все (§30.7) — она и есть общий
-- экран соседей. Язык к соседям отношения не имеет, и класть настройку
-- аккаунта в мировую витрину значило бы раздавать её всем ради одной колонки.
--
-- **Почему не в блобе сейва.** Блоб открывается в игре и только после
-- загрузки; язык нужен раньше — на карточке входа, до всякого лагеря.
-- Вдобавок сейв стирается «Новой игрой», а язык от смены лагеря не меняется.
--
-- **Почему отдельная таблица, а не колонка `auth.users`.** Схему авторизации
-- Supabase держит за собой; своя таблица с внешним ключом — тот же приём,
-- каким уже сделаны `saves` и `camps`.
create table public.player_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Языки перечислены здесь, а не только в клиенте: третий язык обязан
  -- появиться правкой схемы, а не молчаливой строкой из чужого запроса.
  language text not null check (language in ('en', 'ru')),
  updated_at timestamptz not null default now()
);

alter table public.player_settings enable row level security;

-- Своя строка и только своя: настройка — не витрина.
create policy "player_settings: read own" on public.player_settings for select
  using ((select auth.uid()) = user_id);
create policy "player_settings: write own" on public.player_settings for insert
  with check ((select auth.uid()) = user_id);
create policy "player_settings: update own" on public.player_settings for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "player_settings: delete own" on public.player_settings for delete
  using ((select auth.uid()) = user_id);
