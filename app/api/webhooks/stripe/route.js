import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { stripe } from '@/lib/stripe';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function handleCheckoutSessionCompleted(session) {
  const supabase = createSupabaseServiceClient();
  const { metadata = {} } = session;
  const userId = metadata.userId;
  const amountCents = Number(metadata.amountCents);

  if (!userId || !Number.isFinite(amountCents) || amountCents <= 0) {
    console.error('Webhook received with missing metadata:', session.id);
    return NextResponse.json({ error: 'Missing metadata in webhook' }, { status: 400 });
  }

  // Prevent double crediting if Stripe retries the webhook.
  const { data: existingTx, error: fetchError } = await supabase
    .from('wallet_transactions')
    .select('id, status')
    .eq('external_ref', session.id)
    .maybeSingle();

  if (fetchError) {
    console.error('Failed to check existing wallet transaction:', fetchError);
    return NextResponse.json({ error: 'Unable to verify transaction state.' }, { status: 500 });
  }

  if (existingTx) {
    if (existingTx.status !== 'succeeded') {
      await supabase
        .from('wallet_transactions')
        .update({ status: 'succeeded' })
        .eq('id', existingTx.id);
    }
    return NextResponse.json({ received: true });
  }

  const { error } = await supabase.from('wallet_transactions').insert({
    user_id: userId,
    type: 'top_up',
    amount_cents: amountCents,
    description: 'Stripe top-up',
    status: 'succeeded',
    external_ref: session.id, // Store Stripe session ID for reference
    metadata: {
      payment_intent: session.payment_intent,
    },
  });

  if (error) {
    console.error('Failed to insert transaction after successful payment:', error);
    // Here you might want to add alerting for manual intervention.
    return NextResponse.json({ error: 'Failed to update wallet.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

export async function POST(req) {
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook secret is not configured.' }, { status: 500 });
  }

  const body = await req.text();
  const signature = headers().get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.warn('Stripe webhook signature verification failed.', err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutSessionCompleted(event.data.object);
    // You can add other event types here as needed
    // case 'payment_intent.succeeded':
    //   break;
    default:
      console.log(`Unhandled Stripe event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
