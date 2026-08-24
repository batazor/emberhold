-- Лайки публичных лагерей: один аккаунт может отметить один лагерь один раз.
--
-- `camp_id` намеренно text, а не внешний ключ на `camps.user_id`. В разработке
-- на карте живут два стабильных демонстрационных лагеря без строк в auth.users;
-- их id (`sim-*`) должен получать те же настоящие лайки, что UUID живых
-- игроков. Несуществующий id ничего не показывает в клиенте и потому не может
-- попасть в лидерборд реальных лагерей.
create table public.camp_likes (
  camp_id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (camp_id, user_id),
  constraint camp_likes_id_len check (char_length(camp_id) between 1 and 128),
  constraint camp_likes_not_self check (camp_id <> user_id::text)
);

alter table public.camp_likes enable row level security;

-- Сырые строки лайков не являются публичным списком пользователей. Игрок
-- видит свои реакции, а общие числа читает только через агрегирующие функции.
create policy "camp_likes: read own" on public.camp_likes for select
  using ((select auth.uid()) = user_id);
create policy "camp_likes: write own" on public.camp_likes for insert
  with check ((select auth.uid()) = user_id and camp_id <> (select auth.uid())::text);
create policy "camp_likes: delete own or received" on public.camp_likes for delete
  using ((select auth.uid()) = user_id or camp_id = (select auth.uid())::text);

create index camp_likes_user_idx on public.camp_likes (user_id);

-- Состояние нескольких карточек одним запросом. SECURITY DEFINER здесь нужен
-- ровно затем, чтобы посчитать все строки, не раскрывая их user_id через RLS.
create or replace function public.camp_like_states(p_camp_ids text[])
returns table (camp_id text, likes bigint, liked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select requested.camp_id,
         count(reaction.user_id)::bigint as likes,
         coalesce(bool_or(reaction.user_id = (select auth.uid())), false) as liked
    from unnest(coalesce(p_camp_ids, array[]::text[])) as requested(camp_id)
    left join public.camp_likes as reaction on reaction.camp_id = requested.camp_id
   where char_length(requested.camp_id) between 1 and 128
   group by requested.camp_id;
$$;

-- Переключение атомарно: два быстрых тапа не могут оставить две строки,
-- а клиент получает авторитетный итоговый счётчик после операции.
create or replace function public.toggle_camp_like(p_camp_id text)
returns table (liked boolean, likes bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_liked boolean;
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_camp_id is null or char_length(p_camp_id) not between 1 and 128 then
    raise exception 'Invalid camp id' using errcode = '22023';
  end if;
  if p_camp_id = v_user_id::text then
    raise exception 'A camp cannot like itself' using errcode = '22023';
  end if;

  delete from public.camp_likes
   where camp_id = p_camp_id and user_id = v_user_id;
  if found then
    v_liked := false;
  else
    insert into public.camp_likes (camp_id, user_id)
    values (p_camp_id, v_user_id)
    on conflict do nothing;
    v_liked := true;
  end if;

  return query
    select v_liked, count(*)::bigint
      from public.camp_likes
     where camp_id = p_camp_id;
end;
$$;

-- Серверная верхушка нужна отдельно от таблицы по силе: иначе лагерь с
-- большим числом лайков мог бы не попасть в первые 50 по силе и исчезнуть
-- из собственного лидерборда.
create or replace function public.camp_like_leaderboard(p_limit integer default 50)
returns table (
  camp_id text,
  clan text,
  power integer,
  level integer,
  folk integer,
  likes bigint,
  liked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select camp.user_id::text as camp_id,
         camp.clan,
         camp.power,
         camp.level,
         camp.folk,
         count(reaction.user_id)::bigint as likes,
         coalesce(bool_or(reaction.user_id = (select auth.uid())), false) as liked
    from public.camps as camp
    left join public.camp_likes as reaction on reaction.camp_id = camp.user_id::text
   where camp.user_id <> (select auth.uid())
   group by camp.user_id, camp.clan, camp.power, camp.level, camp.folk
   order by count(reaction.user_id) desc, camp.power desc, camp.user_id
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.camp_like_states(text[]) from public;
revoke all on function public.toggle_camp_like(text) from public;
revoke all on function public.camp_like_leaderboard(integer) from public;
grant execute on function public.camp_like_states(text[]) to anon, authenticated;
grant execute on function public.toggle_camp_like(text) to authenticated;
grant execute on function public.camp_like_leaderboard(integer) to authenticated;
