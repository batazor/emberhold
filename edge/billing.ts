import { createClient } from 'jsr:@supabase/supabase-js@2';

const PERSONAL_SKU = 'camp_marks_personal_01';
const CLAN_SKU = 'camp_marks_clan_01';

const CATALOG = {
  [PERSONAL_SKU]: {
    owner: 'player',
    paymentLink: 'https://buy.stripe.com/test_aFa3cw5qtb4G9sMaIt1VK01',
  },
  [CLAN_SKU]: {
    owner: 'clan',
    paymentLink: 'https://buy.stripe.com/test_fZu28s4mp6Oq20k9Ep1VK02',
  },
} as const;

const PERSONAL_ICONS = ['default', 'watchfire', 'horned_tent'] as const;
const CLAN_ICONS = ['default', 'banner_tower', 'council_totem'] as const;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });

type Db = ReturnType<typeof createClient>;

interface ClanMembership {
  readonly clan_id: string;
  readonly role: 'leader' | 'officer' | 'member';
}

async function membership(db: Db, userId: string): Promise<ClanMembership | null> {
  const { data, error } = await db
    .from('clan_memberships')
    .select('clan_id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error !== null || data === null) return null;
  return data as ClanMembership;
}

async function billingState(db: Db, userId: string): Promise<unknown> {
  const member = await membership(db, userId);
  const [playerPacks, settings, clan, clanPacks] = await Promise.all([
    db.from('player_entitlements').select('sku').eq('user_id', userId),
    db.from('player_cosmetic_settings').select('camp_icon').eq('user_id', userId).maybeSingle(),
    member === null
      ? Promise.resolve({ data: null, error: null })
      : db.from('clans').select('id, name, camp_icon').eq('id', member.clan_id).maybeSingle(),
    member === null
      ? Promise.resolve({ data: [], error: null })
      : db.from('clan_entitlements').select('sku').eq('clan_id', member.clan_id),
  ]);
  if (playerPacks.error !== null || settings.error !== null || clan.error !== null || clanPacks.error !== null) {
    throw new Error('cannot read billing state');
  }
  const playerSkus = new Set((playerPacks.data ?? []).map((row: { sku: string }) => row.sku));
  const clanSkus = new Set((clanPacks.data ?? []).map((row: { sku: string }) => row.sku));
  const clanRow = clan.data as { id: string; name: string; camp_icon: string } | null;
  return {
    founderPack: playerSkus.has('founder_pack'),
    personal: {
      owned: playerSkus.has(PERSONAL_SKU),
      equipped: settings.data?.camp_icon ?? 'default',
    },
    clan: member === null || clanRow === null ? null : {
      id: clanRow.id,
      name: clanRow.name,
      role: member.role,
      owned: clanSkus.has(CLAN_SKU),
      equipped: clanRow.camp_icon,
    },
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const auth = req.headers.get('Authorization') ?? '';
  const { data: got } = await db.auth.getUser(auth.replace('Bearer ', ''));
  const user = got?.user;
  if (user == null) return json({ error: 'нет сессии' }, 401);

  let body: { action?: string; sku?: string; owner?: string; icon?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'не разобрать запрос' }, 400);
  }

  try {
    if (body.action === 'status') return json(await billingState(db, user.id));

    if (body.action === 'equip') {
      if (body.owner === 'player') {
        if (!PERSONAL_ICONS.includes(body.icon as typeof PERSONAL_ICONS[number])) {
          return json({ error: 'неизвестная иконка' }, 400);
        }
        if (body.icon !== 'default') {
          const { data } = await db.from('player_entitlements').select('sku')
            .eq('user_id', user.id).eq('sku', PERSONAL_SKU).maybeSingle();
          if (data === null) return json({ error: 'набор не принадлежит игроку' }, 403);
        }
        const { error } = await db.from('player_cosmetic_settings').upsert({
          user_id: user.id,
          camp_icon: body.icon,
          updated_at: new Date().toISOString(),
        });
        if (error !== null) throw error;
        return json(await billingState(db, user.id));
      }

      if (body.owner === 'clan') {
        if (!CLAN_ICONS.includes(body.icon as typeof CLAN_ICONS[number])) {
          return json({ error: 'неизвестная иконка' }, 400);
        }
        const member = await membership(db, user.id);
        if (member === null || (member.role !== 'leader' && member.role !== 'officer')) {
          return json({ error: 'выбирать знак может глава или офицер' }, 403);
        }
        if (body.icon !== 'default') {
          const { data } = await db.from('clan_entitlements').select('sku')
            .eq('clan_id', member.clan_id).eq('sku', CLAN_SKU).maybeSingle();
          if (data === null) return json({ error: 'набор не принадлежит клану' }, 403);
        }
        const { error } = await db.from('clans').update({ camp_icon: body.icon })
          .eq('id', member.clan_id);
        if (error !== null) throw error;
        return json(await billingState(db, user.id));
      }
      return json({ error: 'неизвестный владелец' }, 400);
    }

    if (body.action !== 'checkout') return json({ error: 'неизвестное действие' }, 400);
    const item = body.sku === PERSONAL_SKU || body.sku === CLAN_SKU ? CATALOG[body.sku] : null;
    if (item === null) return json({ error: 'неизвестный товар' }, 400);

    let targetId = user.id;
    if (item.owner === 'player') {
      const { data } = await db.from('player_entitlements').select('sku')
        .eq('user_id', user.id).eq('sku', body.sku).maybeSingle();
      if (data !== null) return json(await billingState(db, user.id));
    } else {
      const member = await membership(db, user.id);
      if (member === null) return json({ error: 'сначала создайте клан' }, 409);
      targetId = member.clan_id;
      const { data } = await db.from('clan_entitlements').select('sku')
        .eq('clan_id', targetId).eq('sku', body.sku).maybeSingle();
      if (data !== null) return json(await billingState(db, user.id));
    }

    const token = crypto.randomUUID();
    const { error } = await db.from('stripe_checkout_claims').insert({
      token,
      user_id: user.id,
      sku: body.sku,
      target_type: item.owner,
      target_id: targetId,
    });
    if (error !== null) throw error;

    const url = new URL(item.paymentLink);
    url.searchParams.set('client_reference_id', token);
    return json({ ...(await billingState(db, user.id) as object), url: url.toString() });
  } catch {
    return json({ error: 'операция магазина не выполнена' }, 500);
  }
});
