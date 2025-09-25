export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation'

import WalletClient from './WalletClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import MissingSupabaseNotice from '@/components/MissingSupabaseNotice'

export const metadata = { title: 'Wallet — Subtitle AI' }

const balanceFromTransactions = (transactions = []) =>
  transactions
    .filter((tx) => tx.status === 'succeeded')
    .reduce((acc, tx) => acc + Number(tx.amount_cents || 0), 0)

export default async function WalletPage() {
  let supabase

  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    console.error(error)
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

  const balanceCents = balanceFromTransactions(transactions)

  return (
    <WalletClient
      balanceCents={balanceCents}
      transactions={transactions}
    />
  )
}