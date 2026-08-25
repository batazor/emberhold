import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTelegramInitData } from './telegramInitData';

const encoder = new TextEncoder();
const asHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

async function sign(value: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const secret = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  const dataKey = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return asHex(await crypto.subtle.sign('HMAC', dataKey, encoder.encode(value)));
}

async function fixture(at: number, token = '123456:telegram-test-token'): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(at),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: 123456789, first_name: 'Ada', username: 'ember_ada', language_code: 'ru' }),
  });
  const rows = [...params].map(([key, value]) => `${key}=${value}`).sort().join('\n');
  params.set('hash', await sign(rows, token));
  return params.toString();
}

test('Telegram initData принимает только свежую подписанную личность', async () => {
  const now = 1_800_000_000;
  const token = '123456:telegram-test-token';
  const data = await fixture(now - 30, token);
  assert.deepEqual(await verifyTelegramInitData(data, token, now), {
    id: 123456789, firstName: 'Ada', lastName: '', username: 'ember_ada', languageCode: 'ru',
  });
  assert.equal(await verifyTelegramInitData(data.replace('Ada', 'Eve'), token, now), null);
  assert.equal(await verifyTelegramInitData(await fixture(now - 86_401, token), token, now), null);
});

