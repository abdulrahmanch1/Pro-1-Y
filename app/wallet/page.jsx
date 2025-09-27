export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation'

import WalletClient from './WalletClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import MissingSupabaseNotice from '@/components/MissingSupabaseNotice'
import { computeBalance, computePendingDebits } from '@/lib/utils/wallet'

export const metadata = { title: 'Wallet — Subtitle AI' }

export default async function WalletPage() {
  const supabase = createSupabaseServerClient()

  if (!supabase) {
    return <MissingSupabaseNotice action="manage wallet credits" />
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in?redirectTo=/wallet')
  }

  const { data: transactions = [], error } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  const balanceCents = computeBalance(transactions)
  const pendingDebitsCents = computePendingDebits(transactions)
  const availableCents = balanceCents - pendingDebitsCents

  return (
    <WalletClient
      balanceCents={balanceCents}
      availableCents={availableCents}
      pendingDebitsCents={pendingDebitsCents}
      transactions={transactions}
    />
  )
}
