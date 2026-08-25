import { createClient } from '@supabase/supabase-js';
import { platformKind, telegramInitData } from './platform';
import type {
  CampDecorStyle,
  CampFireStyle,
  ClanCampIcon,
  ClanHeraldry,
  CosmeticKind,
  CosmeticOwner,
  CosmeticValue,
  PersonalCampIcon,
} from './cosmetics';

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

/**
 * Общая карта: точки дня, их серверные сиды и текущее окно событий одним
 * атомарным RPC. Форма проверяется в `sim/world.ts`, а не здесь: сетевой слой
 * возит данные и не должен знать игровые виды точек и событий.
 *
 * Сессия не нужна — карта одна для всех, в том числе до регистрации.
 */
export async function cloudWorldSnapshot(): Promise<unknown | null> {
  try {
    const { data, error } = await client.rpc('world_snapshot');
    return error === null && data !== null && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

/** Стабильный id вошедшего — или null, если сессии нет. */
export async function cloudUser(): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Telegram уже доказал личность при открытии Mini App. Сервер проверяет
 * подпись initData и выдаёт одноразовый Supabase magic-link token: так все
 * существующие RLS и облачные таблицы продолжают работать с auth.uid().
 */
export async function cloudTelegramSignIn(): Promise<boolean> {
  const initData = telegramInitData();
  if (initData === null) return false;
  try {
    const { data, error } = await client.functions.invoke('telegram-auth', { body: { initData } });
    if (error === null && data?.authenticated === true) return true;
    const tokenHash: unknown = data?.tokenHash;
    if (error !== null || typeof tokenHash !== 'string' || tokenHash === '') return false;
    const verified = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    return verified.error === null && verified.data.session !== null;
  } catch {
    return false;
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

/**
 * Язык игрока (§6.2.7). Живёт своей строкой в облаке, а не в блобе сейва:
 * спрашивают его на карточке регистрации — до всякого лагеря, — и «Новая
 * игра» его не стирает, потому что от смены лагеря язык не меняется.
 *
 * `null` — сессии нет или строки ещё нет. И то и другое означает одно:
 * спрашивать облако не о чем, язык берётся с устройства.
 */
export async function cloudLanguage(): Promise<'en' | 'ru' | null> {
  const uid = await userId();
  if (uid === null) return null;
  try {
    const { data } = await client
      .from('player_settings')
      .select('language')
      .eq('user_id', uid)
      .maybeSingle();
    const language: unknown = data?.language;
    return language === 'en' || language === 'ru' ? language : null;
  } catch {
    return null;
  }
}

/** Запомнить язык за аккаунтом. Молча ничего не делает без сессии. */
export async function cloudSetLanguage(language: 'en' | 'ru'): Promise<void> {
  const uid = await userId();
  if (uid === null) return;
  try {
    await client.from('player_settings').upsert({
      user_id: uid,
      language,
      updated_at: new Date().toISOString(),
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
  readonly clanId: string | null;
  readonly icon: PersonalCampIcon;
  readonly clanIcon: ClanCampIcon;
  readonly power: number;
  readonly level: number;
  readonly folk: number;
  readonly likes: number;
  readonly liked: boolean;
}

/**
 * Отдать свою строку. Замена целиком (`upsert`), а не правка полей: строка
 * маленькая и целая, и хранить в ней половину прошлого состояния незачем.
 */
export async function cloudCamp(
  row: Pick<CloudCamp, 'clan' | 'power' | 'level' | 'folk'>,
): Promise<void> {
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
    if (row.clan !== null) await client.rpc('ensure_owned_clan', { p_name: row.clan });
  } catch {
    /* см. шапку файла */
  }
}

export interface CampLikeState {
  readonly id: string;
  readonly likes: number;
  readonly liked: boolean;
}

const likeCount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

/**
 * Добавить счётчики к любым публичным строкам — в том числе к двум `sim-*`
 * лагерям, которых нет в таблице `camps`. Один агрегирующий RPC не раскрывает
 * список поставивших лайк пользователей.
 */
export async function cloudCampLikeStates<T extends { readonly id: string; readonly likes?: number; readonly liked?: boolean }>(
  rows: readonly T[],
): Promise<(T & CampLikeState)[]> {
  const fallback = rows.map((row) => ({
    ...row,
    likes: likeCount(row.likes),
    liked: row.liked === true,
  }));
  if (rows.length === 0) return fallback;
  try {
    const { data, error } = await client.rpc('camp_like_states', {
      p_camp_ids: rows.map((row) => row.id),
    });
    if (error !== null || !Array.isArray(data)) return fallback;
    const states = new Map<string, { likes: number; liked: boolean }>();
    for (const raw of data) {
      if (raw === null || typeof raw !== 'object') continue;
      const record = raw as Record<string, unknown>;
      states.set(String(record.camp_id), {
        likes: likeCount(record.likes),
        liked: record.liked === true,
      });
    }
    return fallback.map((row) => ({ ...row, ...(states.get(row.id) ?? {}) }));
  } catch {
    return fallback;
  }
}

/** Атомарно поставить или снять свой лайк и вернуть итог сервера. */
export async function cloudToggleCampLike(campId: string): Promise<CampLikeState | null> {
  const uid = await userId();
  if (uid === null || campId === uid) return null;
  try {
    const { data, error } = await client.rpc('toggle_camp_like', { p_camp_id: campId });
    if (error !== null || !Array.isArray(data) || data.length === 0) return null;
    const record = data[0] as Record<string, unknown>;
    return { id: campId, likes: likeCount(record.likes), liked: record.liked === true };
  } catch {
    return null;
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
    const [strongest, popular] = await Promise.all([
      client
        .from('camps')
        .select('user_id, clan, clan_id, camp_icon, power, level, folk, clans(camp_icon)')
        .neq('user_id', uid)
        .order('power', { ascending: false })
        .limit(limit),
      client.rpc('camp_like_leaderboard', { p_limit: limit }),
    ]);
    const parse = (r: Record<string, unknown>, idField: 'user_id' | 'camp_id'): CloudCamp => ({
      id: String(r[idField]),
      clan: typeof r.clan === 'string' && r.clan.trim() !== '' ? r.clan : null,
      clanId: typeof r.clan_id === 'string' ? r.clan_id : null,
      icon: r.camp_icon === 'watchfire' || r.camp_icon === 'horned_tent' || r.camp_icon === 'bond_beacon'
        ? r.camp_icon : 'default',
      clanIcon: (() => {
        const joined = Array.isArray(r.clans) ? r.clans[0] : r.clans;
        const icon = joined !== null && typeof joined === 'object'
          ? (joined as Record<string, unknown>).camp_icon
          : null;
        return icon === 'banner_tower' || icon === 'council_totem' ? icon : 'default';
      })(),
      power: typeof r.power === 'number' ? r.power : 0,
      level: typeof r.level === 'number' ? r.level : 0,
      folk: typeof r.folk === 'number' ? r.folk : 0,
      likes: likeCount(r.likes),
      liked: r.liked === true,
    });
    const byId = new Map<string, CloudCamp>();
    if (Array.isArray(strongest.data)) for (const row of strongest.data) {
      const parsed = parse(row as Record<string, unknown>, 'user_id');
      byId.set(parsed.id, parsed);
    }
    // Верхушка по лайкам дополняет, а не заменяет верхушку по силе: обе
    // таблицы остаются полными в пределах своего серверного лимита.
    if (popular.error === null && Array.isArray(popular.data)) for (const row of popular.data) {
      const parsed = parse(row as Record<string, unknown>, 'camp_id');
      byId.set(parsed.id, { ...parsed, ...(byId.get(parsed.id) ?? {}) });
    }
    return cloudCampLikeStates([...byId.values()]);
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

export interface BillingState {
  readonly founderPack: boolean;
  readonly personal: {
    readonly owned: boolean;
    readonly equipped: PersonalCampIcon;
    readonly fireOwned: boolean;
    readonly fire: CampFireStyle;
    readonly decorOwned: boolean;
    readonly decor: CampDecorStyle;
    readonly referralOwned: boolean;
    readonly referrals: number;
  };
  readonly clan: null | {
    readonly id: string;
    readonly name: string;
    readonly role: 'leader' | 'officer' | 'member';
    readonly owned: boolean;
    readonly equipped: ClanCampIcon;
    readonly heraldryOwned: boolean;
    readonly heraldry: ClanHeraldry;
  };
  readonly url?: string;
}

/** Права приходят с сервера: сейв и localStorage покупать ничего не умеют. */
export const cloudBillingStatus = (): Promise<BillingState | null> =>
  callFunction<BillingState>('billing', { action: 'status' });

/** Одноразовая ссылка привязывается к сессии серверным случайным claim. */
export const cloudBillingCheckout = (sku: string): Promise<BillingState | null> =>
  callFunction<BillingState>('billing', {
    action: 'checkout', sku, platform: platformKind(), telegramInitData: telegramInitData(),
  });

/** Выбор проходит через сервер: localStorage не может надеть неоплаченное. */
export const cloudBillingEquip = (
  owner: CosmeticOwner,
  kind: CosmeticKind,
  value: CosmeticValue,
): Promise<BillingState | null> => callFunction<BillingState>('billing', { action: 'equip', owner, kind, value });

/** Канонический UUID заводится после локального основания и переживает имя. */
export async function cloudEnsureClan(name: string): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('ensure_owned_clan', { p_name: name });
    return error === null && typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

export interface CloudClanInvitePreview {
  readonly clanId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly alreadyMember: boolean;
  readonly canJoin: boolean;
}

export interface CloudClanMembership {
  readonly status: 'joined' | 'already_joined';
  readonly clanId: string;
  readonly name: string;
  readonly role: 'leader' | 'officer' | 'member';
  readonly createdAt: number;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/** Return the clan's active opaque invitation token. */
export async function cloudClanInvite(): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('ensure_clan_invite');
    const row = record(data);
    return error === null && typeof row?.token === 'string' ? row.token : null;
  } catch {
    return null;
  }
}

/** Resolve only the confirmation-card fields; the token remains authoritative. */
export async function cloudClanInvitePreview(token: string): Promise<CloudClanInvitePreview | null> {
  try {
    const { data, error } = await client.rpc('preview_clan_invite', { p_token: token });
    const row = record(data);
    if (error !== null || row === null || typeof row.clanId !== 'string' || typeof row.name !== 'string' ||
        typeof row.memberCount !== 'number' || typeof row.alreadyMember !== 'boolean' ||
        typeof row.canJoin !== 'boolean') return null;
    return row as unknown as CloudClanInvitePreview;
  } catch {
    return null;
  }
}

/** Atomically join the invited clan, or return null for an invalid/conflicting link. */
export async function cloudAcceptClanInvite(token: string): Promise<CloudClanMembership | null> {
  try {
    const { data, error } = await client.rpc('accept_clan_invite', { p_token: token });
    const row = record(data);
    if (error !== null || row === null || (row.status !== 'joined' && row.status !== 'already_joined') ||
        typeof row.clanId !== 'string' || typeof row.name !== 'string' ||
        (row.role !== 'leader' && row.role !== 'officer' && row.role !== 'member') ||
        typeof row.createdAt !== 'number') return null;
    return row as unknown as CloudClanMembership;
  } catch {
    return null;
  }
}

/** Stable personal link for inviting a new account into the game. */
export async function cloudGameReferral(): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('ensure_game_referral');
    const row = record(data);
    return error === null && typeof row?.token === 'string' ? row.token : null;
  } catch {
    return null;
  }
}

/** Attribute a fresh account once; false also covers reused and self links. */
export async function cloudAcceptGameReferral(token: string): Promise<boolean | null> {
  try {
    const { data, error } = await client.rpc('accept_game_referral', { p_token: token });
    return error === null && typeof data === 'boolean' ? data : null;
  } catch {
    return null;
  }
}

/** «Новая игра» стирает и облачные следы — иначе сейв воскреснет при входе. */
export async function cloudWipe(): Promise<void> {
  const uid = await userId();
  if (uid === null) return;
  try {
    await client.from('saves').delete().eq('user_id', uid);
    await client.from('world_visits').delete().eq('user_id', uid);
    // Полученные лагерем лайки относятся к этой версии лагеря и уходят с ней.
    // Лайки, поставленные другим, — предпочтения аккаунта и переживают рестарт.
    await client.from('camp_likes').delete().eq('camp_id', uid);
    // §30.7 — строка лагеря уходит вместе с сейвом: «Новая игра» обязана
    // убрать игрока из общей таблицы, а не оставить там прежнюю силу.
    await client.from('camps').delete().eq('user_id', uid);
  } catch {
    /* см. шапку файла */
  }
}
