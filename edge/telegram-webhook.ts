import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
});

interface PreCheckoutQuery {
  readonly id?: unknown;
  readonly from?: { readonly id?: unknown };
  readonly currency?: unknown;
  readonly total_amount?: unknown;
  readonly invoice_payload?: unknown;
}
interface SuccessfulPayment {
  readonly currency?: unknown;
  readonly total_amount?: unknown;
  readonly invoice_payload?: unknown;
  readonly telegram_payment_charge_id?: unknown;
  readonly provider_payment_charge_id?: unknown;
}
interface TelegramUpdate {
  readonly pre_checkout_query?: PreCheckoutQuery;
  readonly message?: {
    readonly from?: { readonly id?: unknown };
    readonly successful_payment?: SuccessfulPayment;
  };
}

async function botCall(token: string, method: string, body: unknown): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return response.ok;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  if (expectedSecret === '' || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== expectedSecret) {
    return json({ error: 'invalid secret' }, 401);
  }
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  let update: TelegramUpdate;
  try { update = await req.json(); } catch { return json({ error: 'invalid update' }, 400); }
  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const query = update.pre_checkout_query;
  if (query !== undefined && typeof query.id === 'string') {
    const token = typeof query.invoice_payload === 'string' ? query.invoice_payload : '';
    const { data: claim } = await db.from('telegram_checkout_claims')
      .select('user_id, stars, expires_at, used_at').eq('token', token).maybeSingle();
    const { data: payer } = claim === null ? { data: null }
      : await db.from('telegram_identities').select('telegram_id')
        .eq('user_id', claim.user_id).maybeSingle();
    const valid = claim !== null && claim.used_at === null
      && Date.parse(String(claim.expires_at)) > Date.now()
      && query.currency === 'XTR' && query.total_amount === claim.stars
      && payer?.telegram_id === query.from?.id;
    const answered = await botCall(botToken, 'answerPreCheckoutQuery', valid
      ? { pre_checkout_query_id: query.id, ok: true }
      : { pre_checkout_query_id: query.id, ok: false, error_message: 'Покупка устарела. Откройте магазин ещё раз.' });
    return answered ? json({ ok: true }) : json({ error: 'cannot answer checkout' }, 502);
  }

  const payment = update.message?.successful_payment;
  if (payment !== undefined) {
    if (
      payment.currency !== 'XTR' || typeof payment.total_amount !== 'number'
      || typeof payment.invoice_payload !== 'string'
      || typeof payment.telegram_payment_charge_id !== 'string'
      || typeof update.message?.from?.id !== 'number'
    ) return json({ error: 'invalid payment' }, 400);
    const { error } = await db.rpc('grant_telegram_entitlement', {
      p_claim_token: payment.invoice_payload,
      p_telegram_charge_id: payment.telegram_payment_charge_id,
      p_provider_charge_id: typeof payment.provider_payment_charge_id === 'string'
        ? payment.provider_payment_charge_id : null,
      p_stars: payment.total_amount,
      p_telegram_id: update.message?.from?.id,
    });
    if (error !== null) return json({ error: 'fulfillment failed' }, 500);
  }
  return json({ ok: true });
});
