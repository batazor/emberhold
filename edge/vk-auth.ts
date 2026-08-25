import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyVkLaunchParams } from '../src/core/vkLaunchParams';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
});

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body: { launchParams?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'invalid request' }, 400); }

  const secret = Deno.env.get('VK_APP_SECRET') ?? '';
  const identity = typeof body.launchParams === 'string'
    ? await verifyVkLaunchParams(body.launchParams, secret)
    : null;
  if (identity === null) return json({ error: 'invalid VK identity', code: 'invalid_launch_params' }, 401);

  // Подпись уже привязала параметры к нашему защищённому ключу; сверка
  // номера приложения — вторая застёжка на случай, когда ключ однажды
  // окажется общим для нескольких приложений.
  const expectedApp = Number(Deno.env.get('VK_APP_ID') ?? '0');
  if (Number.isFinite(expectedApp) && expectedApp > 0 && identity.appId !== expectedApp) {
    return json({ error: 'invalid VK identity', code: 'foreign_app' }, 401);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  try {
    const { data: mapped } = await db.from('vk_identities')
      .select('user_id').eq('vk_id', identity.id).maybeSingle();
    let userId: string;
    let tokenHash: string;
    if (mapped !== null) {
      userId = String(mapped.user_id);
      const currentToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
      const current = currentToken === '' ? null : (await db.auth.getUser(currentToken)).data.user;
      if (current?.id === userId) return json({ authenticated: true });
      const account = await db.auth.admin.getUserById(userId);
      const email = account.data.user?.email ?? '';
      if (email === '') throw new Error('VK account has no email identity');
      const link = await db.auth.admin.generateLink({ type: 'magiclink', email });
      tokenHash = link.data?.properties?.hashed_token ?? '';
      if (link.error !== null || tokenHash === '') throw link.error ?? new Error('cannot mint VK session');
    }
    else {
      // Один админский вызов и заводит скрытую личность, и чеканит её
      // одноразовый токен: пара createUser + generateLink умеет оставить
      // пользователя без строки в vk_identities.
      const link = await db.auth.admin.generateLink({
        type: 'magiclink',
        email: `vk.${identity.id}@users.emberhold.invalid`,
        options: { data: { provider: 'vk', vk_id: identity.id, platform: identity.platform } },
      });
      tokenHash = link.data?.properties?.hashed_token ?? '';
      const linkedUser = link.data?.user;
      if (link.error !== null || linkedUser === null || linkedUser === undefined || tokenHash === '') {
        throw link.error ?? new Error('cannot create VK session');
      }
      userId = linkedUser.id;
      const { error } = await db.from('vk_identities').insert({
        vk_id: identity.id, user_id: userId,
        platform: identity.platform, language_code: identity.languageCode,
      });
      if (error !== null) {
        // Два одновременных первых запуска могут отчеканить одного и того же
        // скрытого пользователя дважды.
        const raced = await db.from('vk_identities')
          .select('user_id').eq('vk_id', identity.id).maybeSingle();
        if (raced.data?.user_id !== userId) throw error;
      }
    }

    await db.from('vk_identities').update({
      platform: identity.platform, language_code: identity.languageCode,
      last_seen_at: new Date().toISOString(),
    }).eq('vk_id', identity.id).eq('user_id', userId);

    return json({ tokenHash });
  } catch (error) {
    console.error('vk-auth exchange failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'VK sign-in failed', code: 'session_exchange_failed' }, 500);
  }
});
