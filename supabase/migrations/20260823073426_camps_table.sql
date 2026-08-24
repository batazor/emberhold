-- Лагеря живых игроков (§30.7): одна строка на аккаунт, читают все.
--
-- Блоб сейва (`saves`) для этого не годится: он свой у каждого и по RLS
-- виден только хозяину. Здесь лежит ровно то, что лагерь показывает соседям,
-- и ничего сверх: имя клана, сила, уровень и сколько народу. Ни почты,
-- ни имени героя, ни координат — таблицу читают все.
create table public.camps (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- Имя клана (§30.4). null — лагерь ещё не назвался; в таблице он тогда
  -- «Лагерь без имени», и это повод завести клан, а не поломка.
  clan text,
  power integer not null default 0,
  level integer not null default 1,
  folk integer not null default 1,
  updated_at timestamptz not null default now(),
  -- Границы, а не правила: правила живут в `sim/clan.ts` и `sim/standing.ts`,
  -- здесь забор от подделанной строки. Клиент сам считает свою силу (§10.5),
  -- и пересчитать её нечем до серверной симуляции — но написать «сила
  -- миллион» он с этими рамками уже не сможет.
  constraint camps_power_range check (power >= 0 and power <= 100000),
  constraint camps_level_range check (level >= 0 and level <= 99),
  constraint camps_folk_range check (folk >= 0 and folk <= 999),
  constraint camps_clan_len check (clan is null or char_length(clan) between 2 and 24)
);

alter table public.camps enable row level security;

-- Читают все: таблица лагерей и есть общий экран (§4).
create policy "camps: read all" on public.camps for select using (true);
-- Пишет каждый только свою строку — тем же правилом, что метки мира.
create policy "camps: write own" on public.camps for insert
  with check ((select auth.uid()) = user_id);
create policy "camps: update own" on public.camps for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "camps: delete own" on public.camps for delete
  using ((select auth.uid()) = user_id);

-- Таблица читается отсортированной по силе и подрезанной по свежести.
create index camps_power_idx on public.camps (power desc);
create index camps_updated_idx on public.camps (updated_at desc);
