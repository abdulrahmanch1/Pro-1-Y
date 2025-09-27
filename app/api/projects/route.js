import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { parseSrt } from '@/lib/parsers/srt'
import { generateRewriteSuggestions } from '@/lib/ai/rewrite'
import { ensureOfflineUser, persistOfflineUserCookie } from '@/lib/offline-user'
import { createOfflineProject } from '@/lib/offline-store'
import { UPLOAD_COST_CENTS } from '@/lib/pricing'
import { computeBalance, computePendingDebits } from '@/lib/utils/wallet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const toBuffer = async (file) => {
  const arrayBuffer = await file.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

const buildOfflineProject = async ({
  userId,
  projectId,
  projectTitle,
  file,
  parsedSegments,
}) => {
  const { baseSegments, suggestions } = parsedSegments

  const offlineSegments = baseSegments.map((segment, position) => {
    const index = Number.isFinite(segment.index) && segment.index > 0 ? segment.index : position + 1
    const aiPayload = suggestions.get(index)
    const rewrite = typeof aiPayload?.rewrite === 'string' ? aiPayload.rewrite.trim() : ''
    const original = typeof segment.originalText === 'string' ? segment.originalText : ''
    const proposedText = rewrite || original

    return {
      id: `offline-${randomUUID()}`,
      index,
      tsStartMs: segment.tsStartMs,
      tsEndMs: segment.tsEndMs,
      originalText: segment.originalText,
      proposedText,
      accepted: true,
      editedText: proposedText,
    }
  })

  return createOfflineProject({
    userId,
    project: {
      id: projectId,
      title: projectTitle,
      status: 'review',
      sourceFileName: file.name,
      sourceFilePath: `local://${projectId}`,
      createdAt: new Date().toISOString(),
    },
    segments: offlineSegments,
  })
}

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

export async function POST(req) {
  const supabase = createSupabaseServerClient()

  let user = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
  }

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file')
  const title = formData?.get('title')?.toString()?.trim()

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'SRT file is required' }, { status: 400 })
  }

  const rawBuffer = await toBuffer(file)
  const projectTitle = title || file.name || 'Untitled project'

  const parsedSegments = await (async () => {
    const rawText = rawBuffer.toString('utf-8')
    const baseSegments = parseSrt(rawText)

    let suggestions = new Map()
    if (process.env.OPENAI_API_KEY) {
      try {
        suggestions = await generateRewriteSuggestions({
          segments: baseSegments,
          projectTitle,
          language: null,
        })
      } catch (error) {
        console.error('[api/projects] AI suggestion pipeline failed.', error)
      }
    }

    return { baseSegments, suggestions }
  })()

  const projectId = `project-${randomUUID()}`
  const uploadCostCents = UPLOAD_COST_CENTS
  let chargeId = null
  const walletClient = user ? createWalletClient(supabase) : null

  const rollbackCharge = async () => {
    if (!chargeId || !walletClient || !user) return
    try {
      await walletClient
        .from('wallet_transactions')
        .delete()
        .eq('id', chargeId)
        .eq('user_id', user.id)
    } catch (error) {
      console.error('[api/projects] failed to revert upload charge', error)
    } finally {
      chargeId = null
    }
  }

  const finalizeCharge = async () => {
    if (!chargeId || !walletClient || !user) return
    try {
      await walletClient
        .from('wallet_transactions')
        .update({ status: 'succeeded' })
        .eq('id', chargeId)
        .eq('user_id', user.id)
    } catch (error) {
      console.error('[api/projects] failed to finalize upload charge', error)
    } finally {
      chargeId = null
    }
  }

  try {
    if (user && walletClient) {
      const transactions = await loadWalletTransactions({ client: walletClient, userId: user.id })
      const balanceCents = computeBalance(transactions)

      if (balanceCents < uploadCostCents) {
        return NextResponse.json({ error: 'Insufficient credits. Top up your wallet to upload.' }, { status: 402 })
      }

      const { data: pendingCharge, error } = await walletClient
        .from('wallet_transactions')
        .insert({
          user_id: user.id,
          type: 'charge',
          amount_cents: -uploadCostCents,
          description: `Upload ${file.name}`,
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
        return NextResponse.json({ error: 'Insufficient credits. Top up your wallet to upload.' }, { status: 402 })
      }
    }

    const targetUser = user ? { id: user.id, isNew: false } : ensureOfflineUser()
    const offlineProject = await buildOfflineProject({
      userId: targetUser.id,
      projectId,
      projectTitle,
      file,
      parsedSegments,
    })

    const responsePayload = {
      projectId: offlineProject.id,
      processed: true,
      offline: true,
    }

    if (user) {
      await finalizeCharge()
      return NextResponse.json(responsePayload, { status: 201 })
    }

    const response = NextResponse.json(responsePayload, { status: 201 })
    return persistOfflineUserCookie(response, targetUser)
  } catch (error) {
    console.error('[api/projects] request failed', error)
    await rollbackCharge()

    if (!user) {
      const offlineUser = ensureOfflineUser()
      const fallbackResponse = NextResponse.json({ error: error.message || 'Failed to process subtitle file.' }, { status: 400 })
      return persistOfflineUserCookie(fallbackResponse, offlineUser)
    }

    return NextResponse.json({ error: error.message || 'Failed to process subtitle file.' }, { status: 500 })
  }
}
