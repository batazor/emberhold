/**
 * Проверка подписи Stripe без SDK: Edge Function получает исходную строку
 * тела, а не уже разобранный JSON. Иначе даже безобидная пересборка пробелов
 * меняет HMAC и настоящая подпись перестаёт сходиться.
 */
const hexBytes = (hex: string): Uint8Array | null => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!;
  return difference === 0;
};

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<boolean> {
  const fields = header.split(',');
  const timestamp = fields
    .find((field) => field.startsWith('t='))
    ?.slice(2);
  const signatures = fields
    .filter((field) => field.startsWith('v1='))
    .map((field) => hexBytes(field.slice(3)))
    .filter((value): value is Uint8Array => value !== null);
  const at = Number(timestamp);
  if (!Number.isSafeInteger(at) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - at) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${at}.${payload}`)),
  );
  return signatures.some((signature) => equalBytes(digest, signature));
}
