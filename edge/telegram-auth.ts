import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyTelegramInitData } from '../src/core/telegramInitData';

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
  let body: { initData?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'invalid request' }, 400); }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  const identity = typeof body.initData === 'string'
    ? await verifyTelegramInitData(body.initData, botToken)
    : null;
  if (identity === null) return json({ error: 'invalid Telegram identity', code: 'invalid_init_data' }, 401);

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  try {
    let { data: mapped } = await db.from('telegram_identities')
      .select('user_id').eq('telegram_id', identity.id).maybeSingle();
    let userId: string;
    let email: string;
    let tokenHash: string;
    if (mapped !== null) {
      userId = String(mapped.user_id);
      const currentToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
      const current = currentToken === '' ? null : (await db.auth.getUser(currentToken)).data.user;
      if (current?.id === userId) return json({ authenticated: true });
      const account = await db.auth.admin.getUserById(userId);
      email = account.data.user?.email ?? '';
      if (email === '') throw new Error('Telegram account has no email identity');
      const link = await db.auth.admin.generateLink({ type: 'magiclink', email });
      tokenHash = link.data?.properties?.hashed_token ?? '';
      if (link.error !== null || tokenHash === '') throw link.error ?? new Error('cannot mint Telegram session');
    }
    else {
      email = `telegram.${identity.id}@users.emberhold.invalid`;
      // One admin call creates the private auth identity when needed and mints
      // its one-time session token. The old createUser + generateLink pair
      // could leave a user behind without a telegram_identities row.
      const link = await db.auth.admin.generateLink({
        type: 'magiclink', email, options: { data: {
          provider: 'telegram', telegram_id: identity.id,
          first_name: identity.firstName, last_name: identity.lastName,
          username: identity.username,
        } },
      });
      tokenHash = link.data?.properties?.hashed_token ?? '';
      const linkedUser = link.data?.user;
      if (link.error !== null || linkedUser === null || linkedUser === undefined || tokenHash === '') {
        throw link.error ?? new Error('cannot create Telegram session');
      }
      userId = linkedUser.id;
      const { error } = await db.from('telegram_identities').insert({
        telegram_id: identity.id, user_id: userId, username: identity.username,
        first_name: identity.firstName, last_name: identity.lastName,
        language_code: identity.languageCode,
      });
      if (error !== null) {
        // Two simultaneous first launches may both mint the same private user.
        const raced = await db.from('telegram_identities')
          .select('user_id').eq('telegram_id', identity.id).maybeSingle();
        if (raced.data?.user_id !== userId) throw error;
      }
    }

    await db.from('telegram_identities').update({
      username: identity.username, first_name: identity.firstName,
      last_name: identity.lastName, language_code: identity.languageCode,
      last_seen_at: new Date().toISOString(),
    }).eq('telegram_id', identity.id).eq('user_id', userId);

    return json({ tokenHash });
  } catch (error) {
    console.error('telegram-auth exchange failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'Telegram sign-in failed', code: 'session_exchange_failed' }, 500);
  }
});
