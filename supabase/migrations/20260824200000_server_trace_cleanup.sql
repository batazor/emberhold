-- Ограниченная история серверных следов (§28.5).
--
-- Это не игровые таймеры и не состояние игрока. `sorties`, сейвы, лагеря,
-- телеметрия и награды намеренно не входят: удалить их по возрасту означало
-- бы изменить игру, а не подмести технические строки.

-- Существующие ключи начинаются с user_id, а уборка режет только по времени.
-- Свои индексы не дают ежедневному DELETE обходить таблицу целиком.
do $indexes$
begin
  if pg_catalog.to_regclass('public.world_visits') is not null then
    execute 'create index if not exists world_visits_shift_cleanup_idx '
      || 'on public.world_visits (shift)';
  end if;
  if pg_catalog.to_regclass('public.wheel_spins') is not null then
    execute 'create index if not exists wheel_spins_day_cleanup_idx '
      || 'on public.wheel_spins (day)';
  end if;
end;
$indexes$;

create or replace function public.cleanup_server_traces(
  p_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Смена мира — 40 минут. 72 смены = ровно 48 часов.
  v_shift bigint := floor(extract(epoch from p_at) / 2400.0)::bigint;
  v_day integer := floor(extract(epoch from p_at) / 86400.0)::integer;
  v_visits integer := 0;
  v_spins integer := 0;
  v_cron_runs integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('emberhold-server-trace-cleanup', 0)
  );

  -- В старой истории проекта первые таблицы применялись мимо файлов миграций.
  -- Проверка существования оставляет `supabase db reset` пригодным даже до
  -- восстановления тех файлов; в живой базе обе ветки выполняются.
  if pg_catalog.to_regclass('public.world_visits') is not null then
    execute 'delete from public.world_visits where shift < $1'
      using v_shift - 72;
    get diagnostics v_visits = row_count;
  end if;

  -- Суточный замок нужен текущему дню. Две недели — запас для разбора сбоев,
  -- разницы часовых поясов и незавершённого запроса, но не вечный журнал.
  if pg_catalog.to_regclass('public.wheel_spins') is not null then
    execute 'delete from public.wheel_spins where day < $1'
      using v_day - 14;
    get diagnostics v_spins = row_count;
  end if;

  -- Минутный world job создаёт 1440 записей в сутки. Семь дней сохраняют
  -- достаточно истории для диагностики, не превращая журнал в архив.
  if pg_catalog.to_regclass('cron.job_run_details') is not null then
    execute $cleanup$
      delete from cron.job_run_details
       where coalesce(end_time, start_time) < $1
    $cleanup$ using p_at - interval '7 days';
    get diagnostics v_cron_runs = row_count;
  end if;

  return pg_catalog.jsonb_build_object(
    'world_visits', v_visits,
    'wheel_spins', v_spins,
    'cron_runs', v_cron_runs
  );
end;
$$;

revoke all on function public.cleanup_server_traces(timestamptz) from public;

-- Повторное применение миграции не создаёт второй job с тем же смыслом.
do $job$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'emberhold-server-trace-cleanup'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'emberhold-server-trace-cleanup',
    '17 3 * * *',
    $cron$select public.cleanup_server_traces();$cron$
  );
end;
$job$;

-- Первая уборка не ждёт следующей ночи; результат остаётся в выводе миграции.
select public.cleanup_server_traces();
