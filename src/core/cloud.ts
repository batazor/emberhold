import { createClient } from '@supabase/supabase-js';

/**
 * Облачная копия сейва (§6). Модуль ничего не знает о форме сохранения —
 * он возит непрозрачный blob и отметку часов. Так граница сейва остаётся
 * в `sim/save.ts`, а сеть — здесь, и слои не переплетаются.
 *
 * Игрок — анонимная сессия Supabase: браузер получает свой userId при
 * первом входе и держит его в хранилище. Аккаунтов в v0 нет, привязка
 * почты — отдельная механика, когда понадобится.
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
 * Сессия — существующая или свежая анонимная. Анонимный вход может быть
 * выключен в проекте: тогда облака нет, и это ответ, а не ошибка.
 */
async function userId(): Promise<string | null> {
  try {
    const existing = await client.auth.getSession();
    const have = existing.data.session?.user.id;
    if (have !== undefined) return have;
    const fresh = await client.auth.signInAnonymously();
    return fresh.data.session?.user.id ?? null;
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

/** «Новая игра» стирает и облачную строку — иначе сейв воскреснет при входе. */
export async function cloudWipe(): Promise<void> {
  const uid = await userId();
  if (uid === null) return;
  try {
    await client.from('saves').delete().eq('user_id', uid);
  } catch {
    /* см. шапку файла */
  }
}
