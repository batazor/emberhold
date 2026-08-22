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

/** Почта вошедшего — или null, если сессии нет. */
export async function cloudUser(): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession();
    return data.session?.user.email ?? null;
  } catch {
    return null;
  }
}

/** Вход. Отвечает null при успехе, иначе — текст для строки под формой. */
export async function cloudSignIn(email: string, password: string): Promise<string | null> {
  try {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error === null) return null;
    // Тексты Supabase — английские и разные; игроку важен один факт.
    return 'Не вышло: проверьте почту и пароль';
  } catch {
    return 'Не вышло: нет сети';
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
