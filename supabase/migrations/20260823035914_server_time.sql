-- Время таймеров (§6). Часы клиента в онлайне не источник правды: стройка,
-- лечение, отправка §26 и колесо призов идут по таймерам, и перевод
-- системных часов вперёд — это бесплатное время. Отдаётся отметка сервера,
-- а клиент привязывает к ней свой монотонный счётчик.
create or replace function public.server_time()
  returns timestamptz
  language sql
  stable
  security definer
  set search_path = ''
as $$ select now() $$;

-- Время нужно и до входа: заставка тикает раньше сессии.
grant execute on function public.server_time() to anon, authenticated;;
