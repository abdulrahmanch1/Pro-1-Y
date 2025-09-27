import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { computeBalance, computePendingDebits } from '@/lib/utils/wallet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase credentials are not configured.' }, { status: 500 })
  }

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
  const pendingDebitsCents = computePendingDebits(transactions)
  const availableCents = balanceCents - pendingDebitsCents
  return NextResponse.json({
    balanceCents,
    balance: balanceCents / 100,
    pendingDebitsCents,
    pendingDebits: pendingDebitsCents / 100,
    availableCents,
    available: availableCents / 100,
    transactions,
  })
}
