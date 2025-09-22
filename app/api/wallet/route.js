import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'

const computeBalance = (transactions = []) =>
  transactions
    .filter((tx) => tx.status === 'succeeded')
    .reduce((acc, tx) => acc + Number(tx.amount_cents || 0), 0)

export async function GET() {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: transactions = [], error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const balanceCents = computeBalance(transactions)
  return NextResponse.json({
    balanceCents,
    balance: balanceCents / 100,
    transactions,
  })
}

export async function POST(req) {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const amount = Number(body.amount)
  const description = body.description?.toString()?.trim() || 'Top up'

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be greater than zero.' }, { status: 400 })
  }

  const amountCents = Math.round(amount * 100)

  const { data, error } = await supabase
    .from('wallet_transactions')
    .insert({
      user_id: user.id,
      type: 'top_up',
      amount_cents: amountCents,
      description,
      status: 'succeeded',
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ transaction: data })
}
