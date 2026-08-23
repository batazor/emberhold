import { createClient } from 'jsr:@supabase/supabase-js@2';
import { mulberry32 } from '../src/core/rng';
import { dayAt, nodeSeed } from '../src/sim/world';

/**
 * Колесо призов на сервере.
 *
 * Приз и раньше не был случайным: он выпадает из сида дня и места (§4),
 * то есть подобрать себе исход нельзя — можно только выбрать точку на карте,
 * и это законный ход. Небесплатным был **замок**: «крутили сегодня» лежало
 * в сейве игрока полем `wheelDay`, и правка сейва давала сколько угодно
 * прокруток в сутки.
 *
 * Поэтому здесь ровно две вещи, и обе про замок: **день считается серверными
 * часами**, а отметка о прокрутке ложится в таблицу, куда клиенту не писать.
 * Сам приз функция считает тем же кодом (`mulberry32`, тот же сид) — не ради
 * недоверия к клиенту, а чтобы ответ приходил из одного места: две формулы
 * разошлись бы молча, и разошлись бы в тот день, когда кто-то поправит одну.
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

  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { global: { headers: { Authorization: auth } } },
  );
  const { data: got } = await db.auth.getUser(auth.replace('Bearer ', ''));
  const user = got?.user;
  if (user == null) return json({ error: 'нет сессии' }, 401);

  let body: { node?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'не разобрать запрос' }, 400);
  }
  const node = body.node;
  if (typeof node !== 'number' || !Number.isFinite(node) || node < 0) {
    return json({ error: 'нет места' }, 400);
  }

  // День — серверный. Клиент его не присылает вовсе: присланный день и есть
  // тот самый замок, который открывается правкой.
  const now = Date.now() / 1000;
  const day = dayAt(now);
  // Сид места считается здесь же из дня и номера: прислать сид значило бы
  // отдать выбор приза обратно клиенту.
  const seed = nodeSeed(day, Math.floor(node));
  const crystals = 1 + Math.floor(mulberry32(seed ^ 0x5b1e)() * 10);

  // Замок — уникальность (user_id, day) в самой таблице, а не проверка
  // перед вставкой: между «посмотрели» и «записали» помещается вторая
  // вкладка, и ровно так суточные замки и обходят.
  const { error } = await db
    .from('wheel_spins')
    .insert({ user_id: user.id, day, crystals });
  if (error !== null) {
    // Уже крутили сегодня — отдаётся тот же приз, что и в первый раз:
    // игрок, у которого оборвалась сеть, обязан получить своё, а не отказ.
    const { data: had } = await db
      .from('wheel_spins')
      .select('crystals')
      .eq('user_id', user.id)
      .eq('day', day)
      .maybeSingle();
    if (had != null) return json({ crystals: had.crystals, day, repeat: true });
    return json({ error: 'не записать прокрутку' }, 500);
  }

  return json({ crystals, day });
});
