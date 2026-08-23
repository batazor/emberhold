import { createClient } from 'jsr:@supabase/supabase-js@2';
import { reportOf, sortieSeconds } from '../src/sim/sortie';
import type { Sortie } from '../src/sim/sortie';
import type { HeroState } from '../src/sim/heroes';

/**
 * Отправка §26 на сервере.
 *
 * Раздел с самого начала писался под этот переезд: билет хранит **вход,
 * а не итог** — «проверить сервер может только то, что умеет пересчитать
 * сам». Здесь это и происходит: клиент отдаёт билет на выходе и приходит
 * за отчётом, когда срок вышел. Добычу называет сервер.
 *
 * Считает он **тем же кодом**, что и клиент: `reportOf` приезжает сюда
 * сборкой из `src/sim`, а не переписывается на второй язык. Это не удача,
 * а следствие правила `scripts/arch.ts`: симуляция не знает про three и DOM,
 * поэтому идёт в Deno как есть. Вторая реализация разошлась бы с первой
 * молча — и разошлась бы именно в бою, где это заметит игрок, а не мы.
 *
 * Чего функция **не** делает: не проверяет сам билет. Уровень героя,
 * снаряжение и уровень Кухни приходят от клиента и могут быть завышены —
 * это §6 целиком (проверка сейва), отдельная работа. Здесь закрыто ровно
 * одно: **исход похода и его срок больше не назначает игрок.**
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Клиент со своим токеном: RLS остаётся включённой, и функция не может
  // тронуть чужую строку, даже если её об этом попросят.
  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { global: { headers: { Authorization: auth } } },
  );
  const { data: got } = await db.auth.getUser(auth.replace('Bearer ', ''));
  const user = got?.user;
  if (user == null) return json({ error: 'нет сессии' }, 401);

  let body: { action?: string; ticket?: Sortie; hero?: HeroState };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'не разобрать запрос' }, 400);
  }

  if (body.action === 'start') {
    const ticket = body.ticket;
    const hero = body.hero;
    if (ticket == null || hero == null) return json({ error: 'нет билета' }, 400);
    // Срок назначает сервер, а не билет: `endsAt` в билете посчитан часами
    // клиента, и доверять ему — значит вернуть ровно ту дыру, ради которой
    // всё это затеяно.
    const seconds = sortieSeconds(ticket.tier);
    const endsAt = new Date(Date.now() + seconds * 1000).toISOString();
    // Один слот на игрока: вторая отправка поверх открытой — не «две
    // отправки», а потерянная первая, и молчать об этом нельзя.
    const { data: open } = await db.from('sorties').select('user_id').eq('user_id', user.id);
    if (open != null && open.length > 0) return json({ error: 'отряд уже в пути' }, 409);
    const { error } = await db
      .from('sorties')
      .insert({ user_id: user.id, ticket, hero, ends_at: endsAt });
    if (error !== null) return json({ error: 'не записать билет' }, 500);
    return json({ endsAt: Date.parse(endsAt) / 1000 });
  }

  if (body.action === 'claim') {
    const { data: row } = await db
      .from('sorties')
      .select('ticket, hero, ends_at')
      .eq('user_id', user.id)
      .maybeSingle();
    if (row == null) return json({ error: 'отряд никуда не уходил' }, 404);
    const endsAt = Date.parse(row.ends_at);
    if (Date.now() < endsAt) {
      return json({ error: 'отряд ещё в пути', leftSec: (endsAt - Date.now()) / 1000 }, 425);
    }
    // Отчёт считается тем же кодом, что и на клиенте, и по тому же билету:
    // расхождение здесь означало бы разные версии правил, а не жульничество.
    const report = reportOf(row.ticket as Sortie, row.hero as HeroState);
    // Билет гасится до ответа: повторный запрос обязан получить «никуда
    // не уходил», а не вторую добычу. Порядок именно такой — упавшая
    // сеть отнимет отчёт, но не удвоит его.
    await db.from('sorties').delete().eq('user_id', user.id);
    return json({ report });
  }

  return json({ error: 'неизвестное действие' }, 400);
});
