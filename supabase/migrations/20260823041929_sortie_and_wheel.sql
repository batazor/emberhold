-- §26: отправка отряда. Билет живёт на сервере, потому что сервер и считает
-- исход: клиент, считающий свою добычу сам, — это не поход, а объявление.
-- Строка одна на игрока: слот отправки в игре тоже один.
create table public.sorties (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Билет целиком, как его собрал `ticketOf`: вход, а не итог (§26.2).
  ticket jsonb not null,
  -- Герой на момент выхода: поход считается им, а не тем, кем он стал потом.
  hero jsonb not null,
  -- Когда вернётся. Часы серверные — в этом половина смысла затеи.
  ends_at timestamptz not null,
  started_at timestamptz not null default now()
);

alter table public.sorties enable row level security;
-- Читать свой билет клиенту можно: по нему рисуется «отряд в пути».
-- Писать — нельзя ничем, кроме функции: иначе билет подделывается напрямую.
create policy "sorties: read own" on public.sorties
  for select using ((select auth.uid()) = user_id);

-- Колесо призов. Замок суточный, и до сих пор он лежал в сейве игрока —
-- то есть игрок сам решал, крутил он сегодня или нет.
create table public.wheel_spins (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- День мира (§4), а не календарный: сутки игры считаются от своей эпохи.
  day integer not null,
  crystals integer not null,
  spun_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.wheel_spins enable row level security;
create policy "wheel: read own" on public.wheel_spins
  for select using ((select auth.uid()) = user_id);;
