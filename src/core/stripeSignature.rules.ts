import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { verifyStripeSignature } from './stripeSignature';

const signed = (payload: string, at: number, secret: string): string =>
  createHmac('sha256', secret).update(`${at}.${payload}`).digest('hex');

test('Stripe webhook accepts the intact payload in the replay window', async () => {
  const payload = '{"id":"evt_test"}';
  const secret = 'whsec_test';
  const at = 1_700_000_000;
  assert.equal(
    await verifyStripeSignature(payload, `t=${at},v1=${signed(payload, at, secret)}`, secret, at + 30),
    true,
  );
});

test('Stripe webhook rejects changed, stale, and malformed signatures', async () => {
  const payload = '{"id":"evt_test"}';
  const secret = 'whsec_test';
  const at = 1_700_000_000;
  const header = `t=${at},v1=${signed(payload, at, secret)}`;
  assert.equal(await verifyStripeSignature(`${payload} `, header, secret, at), false);
  assert.equal(await verifyStripeSignature(payload, header, secret, at + 301), false);
  assert.equal(await verifyStripeSignature(payload, 'nonsense', secret, at), false);
});
