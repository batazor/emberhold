import { createClient } from '@supabase/supabase-js';

/**
 * Облачная копия сейва (§6). Модуль ничего не знает о форме сохранения —
 * он возит непрозрачный blob и отметку часов. Так граница сейва остаётся
 * в `sim/save.ts`, а сеть — здесь, и слои не переплетаются.
 *
 * Игрок — аккаунт Supabase (почта и пароль): вход в меню настроек, сессия
 * живёт в хранилище и переживает перезапуск. Сам модуль в аккаунт не входит:
 * нет сессии — нет облака, и это ответ, а не ошибка.
 *
 * Каждая функция глотает сбои и отвечает «не вышло»: облако — копия,
 * а не источник, и игра обязана работать без сети ровно как работала
 * без облака вовсе.
 */

/** Публичный ключ — он и должен лежать в клиенте; права режет RLS. */
const PROJECT_URL = 'https://ynprsyzjdaheivhfcuel.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_iHoqcmW6AD4F2eAEJQ_f5Q_ctuMuSrJ';

const client = createClient(PROJECT_URL, PUBLISHABLE_KEY);

export interface CloudSave {
  readonly raw: string;
  readonly watermark: number;
}

/**
 * Отметка сервера в секундах эпохи — или null, если сети нет.
 *
 * Круг запроса учитывается пополам, как это делает NTP: между отправкой
 * и ответом прошло время, и отметка, взятая как есть, всегда отстаёт
 * на дорогу обратно. Половина — предположение о симметричности канала,
 * и оно грубое; но ошибка от него — десятки миллисекунд, а от отказа
 * учитывать круг — сотни.
 *
 * Спрашивается без сессии тоже: заставка тикает раньше входа.
 */
export async function cloudTime(): Promise<number | null> {
  try {
    const sent = Date.now();
    const { data, error } = await client.rpc('server_time');
    if (error !== null || typeof data !== 'string') return null;
    const got = Date.now();
    const server = Date.parse(data);
    if (!Number.isFinite(server)) return null;
    return (server + (got - sent) / 2) / 1000;
  } catch {
    return null;
  }
}

/** Почта вошедшего — или null, если сессии нет. */
export async function cloudUser(): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession();
    return data.session?.user.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Вход без пароля: на почту уходит ссылка, ссылка возвращает в игру уже
 * с сессией — её подхватывает сам клиент при загрузке страницы. Пароля
 * у аккаунта нет и не появится, пока не понадобится.
 *
 * `create` разводит две карточки: регистрация заводит аккаунт по новой
 * почте, вход по незнакомой — отказывает, а не заводит молча второй лагерь
 * из-за опечатки. Ответ null — «письмо отправлено», текст — что показать.
 */
export async function cloudLink(email: string, create: boolean): Promise<string | null> {
  try {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin, shouldCreateUser: create },
    });
    if (error === null) return null;
    // Тексты Supabase — английские и разные; игроку важен один факт.
    return create
      ? 'Не вышло: почта не принята или письма слишком часто'
      : 'Аккаунта с этой почтой нет — регистрация рядом';
  } catch {
    return 'Не вышло: нет сети';
  }
}

/** Сессия появилась после загрузки — по ссылке из письма в соседней вкладке. */
export function cloudOnSignIn(cb: () => void): void {
  try {
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') cb();
    });
  } catch {
    /* см. шапку файла */
  }
}

export async function cloudSignOut(): Promise<void> {
  try {
    await client.auth.signOut();
  } catch {
    /* см. шапку файла */
  }
}

async function userId(): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

export async function cloudPull(): Promise<CloudSave | null> {
  const uid = await userId();
  if (uid === null) return null;
  try {
    const { data } = await client.from('saves').select('data, watermark').eq('user_id', uid).maybeSingle();
    if (data == null) return null;
    return { raw: JSON.stringify(data.data), watermark: typeof data.watermark === 'number' ? data.watermark : 0 };
  } catch {
    return null;
  }
}

export async function cloudPush(raw: string, watermark: number): Promise<void> {
  const uid = await userId();
  if (uid === null) return;
  try {
    const data: unknown = JSON.parse(raw);
    await client.from('saves').upsert({
      user_id: uid,
      data,
      watermark,
      saved_at: new Date().toISOString(),
    });
  } catch {
    /* см. шапку файла */
  }
}

/**
 * Метки мира (§4): куда игрок ходил. Живут отдельной таблицей, а не в блобе,
 * потому что у них другой читатель — карту с чужими лагерями рисуют по строкам
 * всех игроков, а сейв-блоб открывается только хозяину. Список маленький
 * (окно богатства — часы, не годы), поэтому честная замена целиком: стереть
 * своё и записать живое.
 */
export async function cloudVisits(visits: readonly { node: number; shift: number }[]): Promise<void> {
  const uid = await userId();
  if (uid === null) return;
  try {
    await client.from('world_visits').delete().eq('user_id', uid);
    if (visits.length > 0) {
      await client.from('world_visits').insert(visits.map((v) => ({ user_id: uid, node: v.node, shift: v.shift })));
    }
  } catch {
    /* см. шапку файла */
  }
}

/**
 * Чужие метки — все, кроме своих: ими богатство локации тратится наравне
 * со своими (§30.6). Позван из `main`, оттуда же и фильтруется окном
 * (`liveVisits`): просроченная строка, которую не подмёл крон (§28), обязана
 * отваливаться на чтении, а не портить сегодняшнюю карту.
 */
export async function cloudNeighbours(): Promise<{ user: string; node: number; shift: number }[]> {
  const uid = await userId();
  if (uid === null) return [];
  try {
    const { data } = await client.from('world_visits').select('user_id, node, shift').neq('user_id', uid);
    if (!Array.isArray(data)) return [];
    return data
      .filter((r) => typeof r.node === 'number' && typeof r.shift === 'number')
      .map((r) => ({ user: String(r.user_id), node: r.node, shift: r.shift }));
  } catch {
    return [];
  }
}

/**
 * Лагерь соседа в общей таблице (§30.7). Ровно то, что лагерь показывает
 * другим, и ничего сверх: имя клана, сила, уровень и сколько народу.
 *
 * Идентификатор здесь — не для показа: имён и почт в таблице нет вовсе,
 * а `id` нужен единственному месту, которому нужен, — чтобы место лагеря
 * на карте не прыгало от одного чтения к другому.
 */
export interface CloudCamp {
  readonly id: string;
  readonly clan: string | null;
  readonly power: number;
  readonly level: number;
  readonly folk: number;
}

/**
 * Отдать свою строку. Замена целиком (`upsert`), а не правка полей: строка
 * маленькая и целая, и хранить в ней половину прошлого состояния незачем.
 */
export async function cloudCamp(row: Omit<CloudCamp, 'id'>): Promise<void> {
  const uid = await userId();
  if (uid === null) return;
  try {
    await client.from('camps').upsert({
      user_id: uid,
      clan: row.clan,
      power: Math.max(0, Math.round(row.power)),
      level: Math.max(0, Math.round(row.level)),
      folk: Math.max(0, Math.round(row.folk)),
      updated_at: new Date().toISOString(),
    });
  } catch {
    /* см. шапку файла */
  }
}

/**
 * Чужие лагеря — все, кроме своего. Своя строка приходит не отсюда,
 * а из своего же лагеря: она считается на месте и всегда свежее той,
 * что успела доехать до сервера.
 *
 * Подрезано по силе и по числу: таблица — экран, а не выгрузка, и читать
 * тысячу строк, чтобы показать десяток, значит платить за то, чего никто
 * не увидит. Кого подрезали, `standings` говорит вслух.
 */
export async function cloudCamps(limit = 50): Promise<CloudCamp[]> {
  const uid = await userId();
  if (uid === null) return [];
  try {
    const { data } = await client
      .from('camps')
      .select('user_id, clan, power, level, folk')
      .neq('user_id', uid)
      .order('power', { ascending: false })
      .limit(limit);
    if (!Array.isArray(data)) return [];
    return data.map((r) => ({
      id: String(r.user_id),
      clan: typeof r.clan === 'string' && r.clan.trim() !== '' ? r.clan : null,
      power: typeof r.power === 'number' ? r.power : 0,
      level: typeof r.level === 'number' ? r.level : 0,
      folk: typeof r.folk === 'number' ? r.folk : 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Серверные функции (§6). Отвечают `null`, когда сети или сессии нет, —
 * и это не ошибка, а ответ: игра доигрывает сама, ровно как играла до облака.
 */
async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error !== null) return null;
    return data as T;
  } catch {
    return null;
  }
}

/**
 * §26 — билет уходит на сервер, и срок назначает он же. Клиент отвечает
 * временем возвращения: своё, посчитанное его часами, он не навязывает.
 */
export const cloudSortieStart = (ticket: unknown, hero: unknown): Promise<{ endsAt: number } | null> =>
  callFunction<{ endsAt: number }>('sortie', { action: 'start', ticket, hero });

/**
 * Отчёт о походе. Считает сервер тем же кодом, что лежит в `sim/sortie.ts`,
 * — расхождение здесь означало бы разные версии правил, а не обман.
 */
export const cloudSortieClaim = <T>(): Promise<{ report: T } | null> =>
  callFunction<{ report: T }>('sortie', { action: 'claim' });

/**
 * Колесо призов. Сервер владеет суточным замком: день считается его часами,
 * а отметка о прокрутке лежит там, куда клиенту не писать.
 */
export const cloudWheel = (node: number): Promise<{ crystals: number; day: number; repeat?: boolean } | null> =>
  callFunction<{ crystals: number; day: number; repeat?: boolean }>('wheel', { node });

/** «Новая игра» стирает и облачные следы — иначе сейв воскреснет при входе. */
export async function cloudWipe(): Promise<void> {
  const uid = await userId();
  if (uid === null) return;
  try {
    await client.from('saves').delete().eq('user_id', uid);
    await client.from('world_visits').delete().eq('user_id', uid);
    // §30.7 — строка лагеря уходит вместе с сейвом: «Новая игра» обязана
    // убрать игрока из общей таблицы, а не оставить там прежнюю силу.
    await client.from('camps').delete().eq('user_id', uid);
  } catch {
    /* см. шапку файла */
  }
}
