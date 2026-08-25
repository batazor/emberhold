import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyTelegramInitData } from '../src/core/telegramInitData';

const PERSONAL_SKU = 'camp_marks_personal_01';
const CLAN_SKU = 'camp_marks_clan_01';
const FIRE_SKU = 'campfire_rites_01';
const DECOR_SKU = 'camp_decor_watch_01';
const HERALDRY_SKU = 'clan_heraldry_01';

const CATALOG = {
  [PERSONAL_SKU]: {
    owner: 'player',
    paymentLink: 'https://buy.stripe.com/test_aFa3cw5qtb4G9sMaIt1VK01',
    stars: 150, title: 'Знаки лагеря', description: 'Два постоянных знака для вашего лагеря',
  },
  [CLAN_SKU]: {
    owner: 'clan',
    paymentLink: 'https://buy.stripe.com/test_fZu28s4mp6Oq20k9Ep1VK02',
    stars: 250, title: 'Знаки клана', description: 'Два постоянных знака для лагеря клана',
  },
  [FIRE_SKU]: {
    owner: 'player',
    paymentLink: 'https://buy.stripe.com/test_00wcN6aKNegSfRa03P1VK03',
    stars: 100, title: 'Обряды костра', description: 'Два постоянных облика пламени',
  },
  [DECOR_SKU]: {
    owner: 'player',
    paymentLink: 'https://buy.stripe.com/test_9B69AUbOR0q28oIeYJ1VK05',
    stars: 150, title: 'Дозорный двор', description: 'Два постоянных набора декора лагеря',
  },
  [HERALDRY_SKU]: {
    owner: 'clan',
    paymentLink: 'https://buy.stripe.com/test_fZu9AU9GJc8K20kg2N1VK04',
    stars: 200, title: 'Геральдика клана', description: 'Два постоянных герба для вашего клана',
  },
} as const;

const PERSONAL_ICONS = ['default', 'watchfire', 'horned_tent'] as const;
const CLAN_ICONS = ['default', 'banner_tower', 'council_totem'] as const;
const FIRE_STYLES = ['standard', 'ghostfire', 'witchfire'] as const;
const DECOR_STYLES = ['none', 'wayfarer', 'sentinel'] as const;
const HERALDRY = ['plain', 'raven', 'sun'] as const;

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
    db.from('player_cosmetic_settings').select('camp_icon, fire_style, decor_style').eq('user_id', userId).maybeSingle(),
    member === null
      ? Promise.resolve({ data: null, error: null })
      : db.from('clans').select('id, name, camp_icon, heraldry').eq('id', member.clan_id).maybeSingle(),
    member === null
      ? Promise.resolve({ data: [], error: null })
      : db.from('clan_entitlements').select('sku').eq('clan_id', member.clan_id),
  ]);
  if (playerPacks.error !== null || settings.error !== null || clan.error !== null || clanPacks.error !== null) {
    throw new Error('cannot read billing state');
  }
  const playerSkus = new Set((playerPacks.data ?? []).map((row: { sku: string }) => row.sku));
  const clanSkus = new Set((clanPacks.data ?? []).map((row: { sku: string }) => row.sku));
  const clanRow = clan.data as { id: string; name: string; camp_icon: string; heraldry: string } | null;
  return {
    founderPack: playerSkus.has('founder_pack'),
    personal: {
      owned: playerSkus.has(PERSONAL_SKU),
      equipped: settings.data?.camp_icon ?? 'default',
      fireOwned: playerSkus.has(FIRE_SKU),
      fire: settings.data?.fire_style ?? 'standard',
      decorOwned: playerSkus.has(DECOR_SKU),
      decor: settings.data?.decor_style ?? 'none',
    },
    clan: member === null || clanRow === null ? null : {
      id: clanRow.id,
      name: clanRow.name,
      role: member.role,
      owned: clanSkus.has(CLAN_SKU),
      equipped: clanRow.camp_icon,
      heraldryOwned: clanSkus.has(HERALDRY_SKU),
      heraldry: clanRow.heraldry,
    },
  };
}

type CatalogItem = typeof CATALOG[keyof typeof CATALOG];

async function telegramInvoice(
  db: Db,
  userId: string,
  sku: keyof typeof CATALOG,
  item: CatalogItem,
  targetId: string,
  initData: unknown,
): Promise<string | null> {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  const identity = typeof initData === 'string'
    ? await verifyTelegramInitData(initData, botToken)
    : null;
  if (identity === null) return null;
  const { data: mapped } = await db.from('telegram_identities').select('user_id')
    .eq('telegram_id', identity.id).eq('user_id', userId).maybeSingle();
  if (mapped === null) return null;

  const token = crypto.randomUUID();
  const { error: claimError } = await db.from('telegram_checkout_claims').insert({
    token, user_id: userId, sku, target_type: item.owner,
    target_id: targetId, stars: item.stars,
  });
  if (claimError !== null) throw claimError;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: item.title, description: item.description, payload: token,
      provider_token: '', currency: 'XTR', prices: [{ label: item.title, amount: item.stars }],
    }),
  });
  const result = await response.json() as { ok?: unknown; result?: unknown };
  if (!response.ok || result.ok !== true || typeof result.result !== 'string') {
    await db.from('telegram_checkout_claims').delete().eq('token', token);
    return null;
  }
  return result.result;
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

  let body: {
    action?: string; sku?: string; owner?: string; kind?: string; value?: string;
    platform?: string; telegramInitData?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'не разобрать запрос' }, 400);
  }

  try {
    if (body.action === 'status') return json(await billingState(db, user.id));

    if (body.action === 'equip') {
      if (body.owner === 'player') {
        const choice = body.kind === 'personal-icon'
          ? { values: PERSONAL_ICONS as readonly string[], free: 'default', sku: PERSONAL_SKU, column: 'camp_icon' }
          : body.kind === 'fire'
            ? { values: FIRE_STYLES as readonly string[], free: 'standard', sku: FIRE_SKU, column: 'fire_style' }
            : body.kind === 'decor'
              ? { values: DECOR_STYLES as readonly string[], free: 'none', sku: DECOR_SKU, column: 'decor_style' }
              : null;
        if (choice === null || typeof body.value !== 'string' || !choice.values.includes(body.value)) {
          return json({ error: 'неизвестное оформление' }, 400);
        }
        if (body.value !== choice.free) {
          const { data } = await db.from('player_entitlements').select('sku')
            .eq('user_id', user.id).eq('sku', choice.sku).maybeSingle();
          if (data === null) return json({ error: 'набор не принадлежит игроку' }, 403);
        }
        const { error } = await db.from('player_cosmetic_settings').upsert({
          user_id: user.id,
          [choice.column]: body.value,
          updated_at: new Date().toISOString(),
        });
        if (error !== null) throw error;
        return json(await billingState(db, user.id));
      }

      if (body.owner === 'clan') {
        const choice = body.kind === 'clan-icon'
          ? { values: CLAN_ICONS as readonly string[], free: 'default', sku: CLAN_SKU, column: 'camp_icon' }
          : body.kind === 'heraldry'
            ? { values: HERALDRY as readonly string[], free: 'plain', sku: HERALDRY_SKU, column: 'heraldry' }
            : null;
        if (choice === null || typeof body.value !== 'string' || !choice.values.includes(body.value)) {
          return json({ error: 'неизвестное оформление' }, 400);
        }
        const member = await membership(db, user.id);
        if (member === null || (member.role !== 'leader' && member.role !== 'officer')) {
          return json({ error: 'выбирать оформление может глава или офицер' }, 403);
        }
        if (body.value !== choice.free) {
          const { data } = await db.from('clan_entitlements').select('sku')
            .eq('clan_id', member.clan_id).eq('sku', choice.sku).maybeSingle();
          if (data === null) return json({ error: 'набор не принадлежит клану' }, 403);
        }
        const { error } = await db.from('clans').update({ [choice.column]: body.value })
          .eq('id', member.clan_id);
        if (error !== null) throw error;
        return json(await billingState(db, user.id));
      }
      return json({ error: 'неизвестный владелец' }, 400);
    }

    if (body.action !== 'checkout') return json({ error: 'неизвестное действие' }, 400);
    const sku = typeof body.sku === 'string' && body.sku in CATALOG
      ? body.sku as keyof typeof CATALOG
      : null;
    if (sku === null) return json({ error: 'неизвестный товар' }, 400);
    const item = CATALOG[sku];

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

    if (body.platform === 'telegram') {
      const url = await telegramInvoice(db, user.id, sku, item, targetId, body.telegramInitData);
      if (url === null) return json({ error: 'Telegram checkout unavailable' }, 403);
      return json({ ...(await billingState(db, user.id) as object), url });
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
