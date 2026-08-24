import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyStripeSignature } from '../src/core/stripeSignature';

const CATALOG = {
  founder_pack: {
    owner: 'player',
    paymentLink: 'plink_1U80UkIXdGzLW8Kp2aoj7bE0',
    amount: 499,
    currency: 'usd',
  },
  camp_marks_personal_01: {
    owner: 'player',
    paymentLink: 'plink_1U80zaIXdGzLW8KpmJoKRAMC',
    amount: 299,
    currency: 'usd',
  },
  camp_marks_clan_01: {
    owner: 'clan',
    paymentLink: 'plink_1U80zbIXdGzLW8KpzruW4ygP',
    amount: 499,
    currency: 'usd',
  },
} as const;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });

interface CheckoutSession {
  readonly id?: unknown;
  readonly amount_total?: unknown;
  readonly client_reference_id?: unknown;
  readonly currency?: unknown;
  readonly livemode?: unknown;
  readonly metadata?: unknown;
  readonly payment_intent?: unknown;
  readonly payment_link?: unknown;
  readonly payment_status?: unknown;
}

interface StripeEvent {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly livemode?: unknown;
  readonly data?: { readonly object?: CheckoutSession };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const payload = await req.text();
  const signature = req.headers.get('Stripe-Signature') ?? '';
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (secret === '' || !(await verifyStripeSignature(payload, signature, secret))) {
    return json({ error: 'invalid signature' }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (event.livemode !== false) return json({ error: 'live events are disabled' }, 400);
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return json({ received: true });
  }

  const session = event.data?.object;
  const metadata = session?.metadata;
  const amountTotal = session?.amount_total;
  const currency = session?.currency;
  const sku = metadata !== null && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>).sku
    : null;
  const item = typeof sku === 'string' && sku in CATALOG
    ? CATALOG[sku as keyof typeof CATALOG]
    : null;
  if (
    typeof event.id !== 'string' ||
    typeof event.type !== 'string' ||
    session?.livemode !== false ||
    session.payment_status !== 'paid' ||
    item === null ||
    session.payment_link !== item.paymentLink ||
    amountTotal !== item.amount ||
    currency !== item.currency ||
    typeof session.id !== 'string' ||
    typeof session.client_reference_id !== 'string'
  ) {
    return json({ error: 'checkout does not match the catalog' }, 400);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const { data, error } = await db.rpc('grant_paid_entitlement', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_checkout_session_id: session.id,
    p_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    p_payment_link_id: item.paymentLink,
    p_claim_token: session.client_reference_id,
    p_sku: sku,
    // Adaptive Pricing changes presentment_details, while Checkout keeps the
    // catalog amount and currency here for strict fulfillment validation.
    p_amount_total: item.amount,
    p_currency: item.currency,
  });
  if (error !== null) return json({ error: 'fulfillment failed' }, 500);
  return json({ received: true, granted: data === true });
});
