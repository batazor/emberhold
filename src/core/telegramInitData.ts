/** Серверная проверка подписи Telegram Mini App, без DOM и SDK. */

export interface VerifiedTelegramUser {
  readonly id: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly username: string | null;
  readonly languageCode: string | null;
}

const encoder = new TextEncoder();

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', imported, encoder.encode(value));
}

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/**
 * Возвращает только поля, прошедшие HMAC-проверку. `initDataUnsafe` на клиенте
 * намеренно не участвует: имя и id становятся личностью лишь после подписи.
 */
export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowSeconds = Date.now() / 1000,
  maxAgeSeconds = 86_400,
): Promise<VerifiedTelegramUser | null> {
  if (initData === '' || botToken === '') return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (receivedHash === null || !/^[0-9a-f]{64}$/i.test(receivedHash) || !Number.isFinite(authDate)) return null;
  if (authDate > nowSeconds + 300 || nowSeconds - authDate > maxAgeSeconds) return null;

  const rows: string[] = [];
  for (const [key, value] of params) if (key !== 'hash') rows.push(`${key}=${value}`);
  rows.sort();
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const expected = hex(await hmac(secret, rows.join('\n')));
  if (!sameText(expected, receivedHash.toLowerCase())) return null;

  let raw: unknown;
  try { raw = JSON.parse(params.get('user') ?? ''); } catch { return null; }
  if (raw === null || typeof raw !== 'object') return null;
  const user = raw as Record<string, unknown>;
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return {
    id: user.id,
    firstName: typeof user.first_name === 'string' ? user.first_name.slice(0, 128) : '',
    lastName: typeof user.last_name === 'string' ? user.last_name.slice(0, 128) : '',
    username: typeof user.username === 'string' ? user.username.slice(0, 64) : null,
    languageCode: typeof user.language_code === 'string' ? user.language_code.slice(0, 16) : null,
  };
}

