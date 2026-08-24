-- Общая карта мира. Клиентская раздача остаётся запасным вариантом без сети,
-- но для подключённых игроков источник истины теперь один: этот снимок БД.
--
-- Регион меняется на границе суток UTC. События живут по шесть часов — это
-- те же девять смен по 40 минут, что и `EVENT_WINDOW_SHIFTS` в sim/events.ts.
-- pg_cron не переключает строки флагом: он заранее создаёт сегодняшний и
-- завтрашний день, а активный снимок выбирается серверными часами. Поэтому
-- даже задержавшийся запуск задания не оставляет карту между состояниями.

create extension if not exists pg_cron;

create table public.world_days (
  day integer primary key,
  generated_at timestamptz not null default clock_timestamp()
);

create table public.world_nodes (
  day integer not null references public.world_days (day) on delete cascade,
  node_id integer not null,
  name text not null,
  x double precision not null,
  y double precision not null,
  tier smallint not null,
  kind text not null,
  seed bigint not null,
  primary key (day, node_id),
  constraint world_nodes_id_range check (node_id between 0 and 34),
  constraint world_nodes_name_len check (char_length(name) between 1 and 64),
  constraint world_nodes_x_range check (x > 0.02 and x < 0.98),
  constraint world_nodes_y_range check (y > 0.02 and y < 0.98),
  constraint world_nodes_tier_range check (tier between 0 and 3),
  constraint world_nodes_kind check (kind in (
    'вылазка', 'замок', 'замок минотавра', 'кладбище', 'тропа', 'призы'
  )),
  constraint world_nodes_seed_range check (seed between 0 and 4294967295)
);

create table public.world_events (
  day integer not null,
  node_id integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- null — тоже сгенерированный результат: обычное окно без события.
  event_id text,
  primary key (day, node_id, starts_at),
  foreign key (day, node_id)
    references public.world_nodes (day, node_id) on delete cascade,
  constraint world_events_window check (ends_at = starts_at + interval '6 hours'),
  constraint world_events_kind check (
    event_id is null or event_id in ('storm', 'collapse', 'quiet', 'vein')
  )
);

create index world_events_active_idx
  on public.world_events (starts_at, ends_at);

alter table public.world_days enable row level security;
alter table public.world_nodes enable row level security;
alter table public.world_events enable row level security;

-- Прямого чтения нет: только один RPC отдаёт согласованный снимок, не три
-- запроса, которые могут попасть по разные стороны смены события.
revoke all on public.world_days from anon, authenticated;
revoke all on public.world_nodes from anon, authenticated;
revoke all on public.world_events from anon, authenticated;

create or replace function public.world_ensure_day(p_day integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Четыре клетки заняты вечными лагерями фракций (`CAMP_CELLS` в world.ts).
  v_cells integer[];
  v_names text[];
  v_special_kinds text[] := array[
    'замок', 'замок минотавра', 'кладбище', 'тропа', 'призы'
  ];
  v_special_labels text[] := array[
    'Замок', 'Замок минотавра', 'Кладбище', 'Тропа', 'Колесо'
  ];
  v_special_counts integer[];
  v_special_total integer;
  v_raids integer;
  v_node integer := 0;
  v_cell integer;
  v_col integer;
  v_row integer;
  v_x double precision;
  v_y double precision;
  v_seed bigint;
  v_kind text;
  v_label text;
  v_count integer;
  v_i integer;
  v_j integer;
  v_window integer;
  v_event text;
begin
  if p_day < 0 then
    raise exception 'Invalid world day' using errcode = '22023';
  end if;

  insert into public.world_days (day) values (p_day)
  on conflict do nothing;
  if not found then return; end if;

  select array_agg(cell order by random())
    into v_cells
    from generate_series(0, 34) as cells(cell)
   where cell <> all (array[0, 12, 14, 22]);

  select array_agg(name order by random())
    into v_names
    from unnest(array[
      'Низина', 'Обвал у брода', 'Сухое русло', 'Распадок',
      'Крайние ямы', 'Гарь', 'Осыпь', 'Кривой отвал',
      'Провал', 'Просевший тракт', 'Мокрый карьер', 'Чёрный шурф',
      'Дальняя штольня', 'Каменный мешок', 'Ржавый ключ', 'Второе дно',
      'Белая пустошь', 'Глухая штольня', 'Волчья яма', 'Старый спуск',
      'Косой лог', 'Битый камень', 'Тихий брод', 'Овражья пасть',
      'Гнилой мост', 'Слепой поворот', 'Верхний забой', 'Мёрзлый склон',
      'Пустая выработка', 'Сыпучий борт', 'Заваленный ход', 'Клин'
    ]::text[]) as names(name);

  -- Особые места разыгрываются первыми, чтобы ни один обязательный вид не
  -- исчез, когда выпали одновременно людный день и много прогулочных точек.
  v_special_counts := array[
    1 + floor(random() * 3)::integer,
    1,
    1 + floor(random() * 3)::integer,
    1 + floor(random() * 2)::integer,
    1
  ];
  select sum(n) into v_special_total from unnest(v_special_counts) as counts(n);
  v_raids := least(16 + floor(random() * 7)::integer, cardinality(v_cells) - v_special_total);

  for v_i in 1..v_raids loop
    v_cell := v_cells[v_node + 1];
    v_col := v_cell % 7;
    v_row := v_cell / 7;
    v_x := (v_col + 0.5) / 7.0 + (random() - 0.5) / 7.0 / 2.2;
    v_y := 0.08 + ((v_row + 0.5) / 5.0) * 0.76 + (random() - 0.5) / 5.0 / 2.6;
    v_seed := floor(random() * 4294967296.0)::bigint;
    insert into public.world_nodes (day, node_id, name, x, y, tier, kind, seed)
    values (
      p_day, v_node, v_names[v_node + 1], v_x, v_y,
      floor(random() * 4)::smallint, 'вылазка', v_seed
    );
    v_node := v_node + 1;
  end loop;

  for v_i in 1..cardinality(v_special_kinds) loop
    v_kind := v_special_kinds[v_i];
    v_label := v_special_labels[v_i];
    v_count := v_special_counts[v_i];
    for v_j in 1..v_count loop
      v_cell := v_cells[v_node + 1];
      v_col := v_cell % 7;
      v_row := v_cell / 7;
      v_x := (v_col + 0.5) / 7.0 + (random() - 0.5) / 7.0 / 2.2;
      v_y := 0.08 + ((v_row + 0.5) / 5.0) * 0.76 + (random() - 0.5) / 5.0 / 2.6;
      v_seed := floor(random() * 4294967296.0)::bigint;
      insert into public.world_nodes (day, node_id, name, x, y, tier, kind, seed)
      values (
        p_day, v_node, v_label || ' «' || v_names[v_node + 1] || '»',
        v_x, v_y, 0, v_kind, v_seed
      );
      v_node := v_node + 1;
    end loop;
  end loop;

  -- Все четыре окна создаются вместе с регионом. Активным их делает не
  -- UPDATE от cron, а серверное время в world_snapshot().
  for v_node in
    select node_id
      from public.world_nodes
     where day = p_day and kind = 'вылазка'
     order by node_id
  loop
    for v_window in 0..3 loop
      if random() < 0.25 then
        v_event := (array['storm', 'collapse', 'quiet', 'vein'])[1 + floor(random() * 4)::integer];
      else
        v_event := null;
      end if;
      insert into public.world_events (day, node_id, starts_at, ends_at, event_id)
      values (
        p_day,
        v_node,
        to_timestamp(p_day::double precision * 86400.0 + v_window * 21600.0),
        to_timestamp(p_day::double precision * 86400.0 + (v_window + 1) * 21600.0),
        v_event
      );
    end loop;
  end loop;
end;
$$;

create or replace function public.world_maintain(p_at timestamptz default clock_timestamp())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day integer := floor(extract(epoch from p_at) / 86400.0)::integer;
begin
  -- Ручной запуск, RPC и cron могут встретиться: раздаёт только один.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('emberhold-world', 0));
  perform public.world_ensure_day(v_day);
  perform public.world_ensure_day(v_day + 1);

  -- Два прошлых дня нужны коротким операциям, начатым до полуночи; дальше
  -- история карты не является игровым состоянием и удаляется каскадом.
  delete from public.world_days where day < v_day - 2;
end;
$$;

create or replace function public.world_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := clock_timestamp();
  v_epoch double precision := extract(epoch from v_at);
  v_day integer := floor(v_epoch / 86400.0)::integer;
  v_window_epoch double precision := floor(v_epoch / 21600.0) * 21600.0;
  v_result jsonb;
begin
  -- Cron держит данные тёплыми. Запись на каждом чтении не нужна; вызов
  -- закрывает только первый запуск и восстановление после паузы планировщика.
  if not exists (select 1 from public.world_days where day = v_day) then
    perform public.world_maintain(v_at);
  end if;

  select jsonb_build_object(
    'day', v_day,
    'generated_at', extract(epoch from days.generated_at),
    'event_from', v_window_epoch,
    'event_until', v_window_epoch + 21600.0,
    'nodes', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', nodes.node_id,
        'name', nodes.name,
        'x', nodes.x,
        'y', nodes.y,
        'tier', nodes.tier,
        'kind', nodes.kind,
        'seed', nodes.seed,
        'event', events.event_id
      ) order by nodes.node_id
    ), '[]'::jsonb)
  )
    into v_result
    from public.world_days as days
    join public.world_nodes as nodes on nodes.day = days.day
    left join public.world_events as events
      on events.day = nodes.day
     and events.node_id = nodes.node_id
     and events.starts_at = to_timestamp(v_window_epoch)
   where days.day = v_day
   group by days.day, days.generated_at;

  return v_result;
end;
$$;

revoke all on function public.world_ensure_day(integer) from public;
revoke all on function public.world_maintain(timestamptz) from public;
revoke all on function public.world_snapshot() from public;
grant execute on function public.world_snapshot() to anon, authenticated;

-- Снимок готов сразу после миграции; cron затем поддерживает его раз в минуту.
select public.world_maintain();

do $job$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'emberhold-world-maintain'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'emberhold-world-maintain',
    '* * * * *',
    $cron$select public.world_maintain();$cron$
  );
end;
$job$;
