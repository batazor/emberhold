import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyVkLaunchParams } from './vkLaunchParams';

const SECRET = 'vk-app-protected-key';

async function fixture(at: number, secret = SECRET, extra: Record<string, string> = {}): Promise<string> {
  const params = new URLSearchParams({
    vk_app_id: '54735735',
    vk_are_notifications_enabled: '0',
    vk_is_app_user: '1',
    vk_language: 'ru',
    vk_platform: 'desktop_web',
    vk_ts: String(at),
    vk_user_id: '777001',
  });
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(new URLSearchParams(signed).toString()));
  params.set('sign', btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''));
  for (const [key2, value] of Object.entries(extra)) params.set(key2, value);
  return params.toString();
}

test('ВК принимает только свежие параметры запуска, подписанные нашим ключом', async () => {
  const now = 1_800_000_000;
  assert.deepEqual(await verifyVkLaunchParams(await fixture(now - 30), SECRET, now), {
    id: 777001, appId: 54735735, platform: 'desktop_web', languageCode: 'ru',
  });
  // Чужой ключ — чужое приложение: подпись не сойдётся.
  assert.equal(await verifyVkLaunchParams(await fixture(now - 30, 'other-app-key'), SECRET, now), null);
  // Переигранная ссылка суточной давности.
  assert.equal(await verifyVkLaunchParams(await fixture(now - 86_401), SECRET, now), null);
  // Часы клиента вперёд больше допуска.
  assert.equal(await verifyVkLaunchParams(await fixture(now + 600), SECRET, now), null);
  assert.equal(await verifyVkLaunchParams('', SECRET, now), null);
  assert.equal(await verifyVkLaunchParams(await fixture(now - 30), '', now), null);
});

test('ВК: подменённый номер игрока подпись не переживает', async () => {
  const now = 1_800_000_000;
  const raw = await fixture(now - 30);
  assert.equal(await verifyVkLaunchParams(raw.replace('vk_user_id=777001', 'vk_user_id=777002'), SECRET, now), null);
  // Пропавшая подпись — не «пустой игрок», а отказ.
  assert.equal(await verifyVkLaunchParams(raw.replace(/&?sign=[^&]*/, ''), SECRET, now), null);
});

test('ВК: неподписанный хвост адреса проверке не мешает и в личность не попадает', async () => {
  const now = 1_800_000_000;
  // Хвост приглашения и метка перехода дописываются к адресу уже после
  // подписи — они обязаны остаться посторонними данными.
  const withTail = await fixture(now - 30, SECRET, { odr_enabled: 'true', ref: 'anything' });
  assert.deepEqual(await verifyVkLaunchParams(withTail, SECRET, now), {
    id: 777001, appId: 54735735, platform: 'desktop_web', languageCode: 'ru',
  });
});
