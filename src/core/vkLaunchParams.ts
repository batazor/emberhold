/** Серверная проверка подписи запуска мини-приложения ВКонтакте, без DOM и SDK. */

export interface VerifiedVkUser {
  readonly id: number;
  readonly appId: number;
  readonly platform: string | null;
  readonly languageCode: string | null;
}

const encoder = new TextEncoder();

/** base64url без выравнивания — в этом виде ВК присылает подпись. */
const base64url = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/**
 * Подписью накрыты только параметры с приставкой `vk_`, отсортированные по
 * имени. Всё прочее в адресе — чужое: хвост приглашения, метки переходов,
 * что угодно, дописанное по дороге. Поэтому личность собирается **только**
 * из подписанной части, а остальное не влияет ни на проверку, ни на ответ.
 *
 * Ключ здесь — защищённый ключ приложения. Он же привязывает параметры к
 * нашему приложению: подпись, выданная для чужого, нашим ключом не сойдётся.
 */
export async function verifyVkLaunchParams(
  search: string,
  secret: string,
  nowSeconds = Date.now() / 1000,
  maxAgeSeconds = 86_400,
): Promise<VerifiedVkUser | null> {
  if (search === '' || secret === '') return null;
  const params = new URLSearchParams(search);
  const received = params.get('sign');
  if (received === null || !/^[A-Za-z0-9_-]{20,120}$/.test(received)) return null;

  const signed = [...params].filter(([key]) => key.startsWith('vk_')).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (signed.length === 0) return null;

  const timestamp = Number(params.get('vk_ts'));
  if (!Number.isFinite(timestamp)) return null;
  // Тот же допуск, что у Telegram: чуть вперёд — разъехавшиеся часы клиента,
  // слишком назад — переигранная ссылка.
  if (timestamp > nowSeconds + 300 || nowSeconds - timestamp > maxAgeSeconds) return null;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const value = new URLSearchParams(signed).toString();
  const expected = base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  if (!sameText(expected, received)) return null;

  const id = Number(params.get('vk_user_id'));
  const appId = Number(params.get('vk_app_id'));
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(appId) || appId <= 0) return null;
  return {
    id,
    appId,
    platform: params.get('vk_platform')?.slice(0, 32) ?? null,
    languageCode: params.get('vk_language')?.slice(0, 16) ?? null,
  };
}
