-- §9: телеметрия игры. Событие кладётся как есть — целиком в jsonb плюс
-- вынутые наружу колонки, по которым его будут искать. Ни одной вьюхи,
-- ни одного агрегата: считать будет внешний инструмент, и заводить здесь
-- вторую арифметику рядом с sim/telemetry.ts значило бы разойтись с ней молча.
create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Сессия: одна вкладка от загрузки до закрытия. Без неё «сессия» пришлось бы
  -- склеивать по времени, а это уже толкование, а не запись.
  session uuid not null,
  -- Вид события: 'raid_end', 'build_start' и прочие 18 из sim/telemetry.ts.
  t text not null,
  -- Часы игры (§6, секунды эпохи) — то, чем событие датировано внутри.
  at double precision not null,
  -- Часы сервера. Врозь с `at` намеренно: расхождение между ними само
  -- по себе данные — по нему видно клиента, чьё время не сходится.
  server_at timestamptz not null default now(),
  data jsonb not null
);

-- Порядок запросов будущего инструмента: «что происходило за окно времени»
-- и «что делал этот игрок». Оба индекса — под них, а не про запас.
create index events_server_at_idx on public.events (server_at desc);
create index events_user_at_idx on public.events (user_id, server_at desc);
create index events_kind_idx on public.events (t, server_at desc);

alter table public.events enable row level security;

-- Пишет игрок только за себя. Чтения нет ни у кого: разбор идёт снаружи,
-- сервисным ключом, и открывать чужие события клиенту незачем.
create policy "events: write own" on public.events
  for insert with check ((select auth.uid()) = user_id);;
