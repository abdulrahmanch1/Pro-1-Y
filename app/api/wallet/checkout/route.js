import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(req) {
  let supabase;
  try {
    supabase = createSupabaseServerClient();
  } catch (e) {
    return NextResponse.json({ error: 'Supabase credentials are not configured.' }, { status: 500 });
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const amount = Number(body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number.' }, { status: 400 });
  }

  const amountCents = Math.round(amount * 100);
  const origin = req.headers.get('origin') || 'http://localhost:3000';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Subtitle AI Wallet Top-up',
              description: `Add $${amount.toFixed(2)} to your wallet.`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      // We pass the user ID and the top-up amount in the metadata
      // so we can fulfill the order in the webhook.
      metadata: {
        userId: user.id,
        amountCents: amountCents.toString(),
      },
      success_url: `${origin}/wallet?payment_success=true`,
      cancel_url: `${origin}/wallet?payment_canceled=true`,
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe session creation failed:', error);
    return NextResponse.json({ error: 'Failed to create Stripe session.' }, { status: 500 });
  }
}
