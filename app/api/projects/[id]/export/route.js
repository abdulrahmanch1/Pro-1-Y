import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { serializeSegmentsToSrt } from '@/lib/parsers/srt'
import { getOfflineProject } from '@/lib/offline-store'
import { readOfflineUser, ensureOfflineUser, persistOfflineUserCookie } from '@/lib/offline-user'
import { computeBalance, computePendingDebits } from '@/lib/utils/wallet'
import { EXPORT_COST_CENTS } from '@/lib/pricing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const createWalletClient = (supabase) => {
  if (!supabase) return null
  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseServiceClient() : null
  return serviceClient || supabase
}

const loadWalletTransactions = async ({ client, userId }) => {
  const { data, error } = await client
    .from('wallet_transactions')
    .select('id, amount_cents, status')
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
  return data || []
}

export async function POST(_req, { params }) {
  const supabase = createSupabaseServerClient()

  let user = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
  }

  let offlineUser = null
  let userId = user?.id ?? null
  if (!userId) {
    offlineUser = readOfflineUser() || ensureOfflineUser()
    userId = offlineUser.id
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectId = params.id
  const project = getOfflineProject({ userId, projectId })
  if (!project) {
    const response = NextResponse.json({ error: 'Not found' }, { status: 404 })
    return offlineUser && offlineUser.isNew ? persistOfflineUserCookie(response, offlineUser) : response
  }

  const segments = Array.isArray(project.segments)
    ? [...project.segments].sort((a, b) => a.index - b.index)
    : []

  if (!segments.length) {
    const response = NextResponse.json({ error: 'No segments to export' }, { status: 400 })
    return offlineUser && offlineUser.isNew ? persistOfflineUserCookie(response, offlineUser) : response
  }

  const payload = segments.map((segment) => ({
    tsStartMs: segment.tsStartMs,
    tsEndMs: segment.tsEndMs,
    originalText: segment.originalText,
    text: segment.accepted
      ? (segment.editedText || segment.proposedText || segment.originalText)
      : segment.originalText,
  }))

  const srt = serializeSegmentsToSrt(payload)
  const fileBase = project.sourceFileName?.replace(/\.[^.]+$/, '') || project.title || 'export'
  const fileName = `${fileBase}.srt`

  if (!user) {
    const response = new NextResponse(srt, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': Buffer.byteLength(srt, 'utf-8').toString(),
      },
    })
    return offlineUser && offlineUser.isNew ? persistOfflineUserCookie(response, offlineUser) : response
  }

  const walletClient = createWalletClient(supabase)
  if (!walletClient) {
    return NextResponse.json({ error: 'Supabase credentials are not configured.' }, { status: 500 })
  }

  let chargeId = null

  const rollbackCharge = async () => {
    if (!chargeId) return
    try {
      await walletClient
        .from('wallet_transactions')
        .delete()
        .eq('id', chargeId)
        .eq('user_id', user.id)
    } catch (error) {
      console.error('[api/projects/export] failed to revert export charge', error)
    } finally {
      chargeId = null
    }
  }

  try {
    const transactions = await loadWalletTransactions({ client: walletClient, userId: user.id })
    const balanceCents = computeBalance(transactions)
    const exportCost = EXPORT_COST_CENTS

    if (balanceCents < exportCost) {
      return NextResponse.json({ error: 'Insufficient credits. Top up your wallet to export.' }, { status: 402 })
    }

    const { data: pendingCharge, error } = await walletClient
      .from('wallet_transactions')
      .insert({
        user_id: user.id,
        type: 'charge',
        amount_cents: -exportCost,
        description: `Export ${fileName}`,
        status: 'pending',
      })
      .select('id')
      .single()

    if (error) {
      throw new Error(error.message)
    }

    chargeId = pendingCharge.id

    const refreshed = await loadWalletTransactions({ client: walletClient, userId: user.id })
    const available = computeBalance(refreshed) - computePendingDebits(refreshed)
    if (available < 0) {
      await rollbackCharge()
      return NextResponse.json({ error: 'Insufficient credits. Top up your wallet to export.' }, { status: 402 })
    }

    const { error: finalizeError } = await walletClient
      .from('wallet_transactions')
      .update({ status: 'succeeded' })
      .eq('id', chargeId)
      .eq('user_id', user.id)

    if (finalizeError) {
      throw new Error(finalizeError.message)
    }

    chargeId = null

    return NextResponse.json({
      fileName,
      content: srt,
    })
  } catch (error) {
    console.error('[api/projects/export] request failed', error)
    await rollbackCharge()
    return NextResponse.json({ error: error.message || 'Export failed. Try again.' }, { status: 500 })
  }
}
