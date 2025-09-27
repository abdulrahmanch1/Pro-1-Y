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

export async function POST(req) {
  console.log('[api/projects] handler start')

  const supabase = createSupabaseServerClient()
  const supabaseAvailable = Boolean(supabase)
  if (!supabaseAvailable) {
    console.warn('[api/projects] Supabase client unavailable, falling back to offline mode.')
  }

  let user = null
  let authError = null

  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
    authError = authResult?.error ?? null
  }

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file')
  const title = formData?.get('title')?.toString()?.trim()

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'SRT file is required' }, { status: 400 })
  }

  const rawBuffer = await toBuffer(file)
  const projectTitle = title || file.name || 'Untitled project'
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'captions'
  const objectPath = user ? `${user.id}/${Date.now()}-${randomUUID()}-${file.name}` : null

  let parsedSegmentsCache = null

  const getParsedSegments = async () => {
    if (parsedSegmentsCache) return parsedSegmentsCache

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
        console.error('[api/projects] AI suggestion pipeline failed (inline).', error)
      }
    }

    parsedSegmentsCache = { baseSegments, suggestions }
    return parsedSegmentsCache
  }

  const buildSegmentRows = async (projectId) => {
    const { baseSegments, suggestions } = await getParsedSegments()
    return baseSegments.map((segment, position) => {
      const index = Number.isFinite(segment.index) && segment.index > 0 ? segment.index : position + 1
      const aiPayload = suggestions.get(index)
      const rewrite = typeof aiPayload?.rewrite === 'string' ? aiPayload.rewrite.trim() : ''
      const original = typeof segment.originalText === 'string' ? segment.originalText : ''
      const proposedText = rewrite || original

      return {
        project_id: projectId,
        index,
        ts_start_ms: segment.tsStartMs,
        ts_end_ms: segment.tsEndMs,
        original_text: segment.originalText,
        proposed_text: proposedText,
        accepted: true,
        edited_text: proposedText,
      }
    })
  }

  const buildOfflineProject = async ({ userId, overrideId, sourceFilePath }) => {
    const { baseSegments, suggestions } = await getParsedSegments()

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
        id: overrideId,
        title: projectTitle,
        status: 'review',
        sourceFileName: file.name,
        sourceFilePath,
        createdAt: new Date().toISOString(),
      },
      segments: offlineSegments,
    })
  }

  const fallbackToOffline = async ({ userId, overrideId, sourceFilePath, message }) => {
    try {
      const offline = await buildOfflineProject({ userId, overrideId, sourceFilePath })
      const payload = { projectId: offline.id, processed: true, offline: true }
      if (message) payload.warning = message
      return NextResponse.json(payload, { status: 201 })
    } catch (error) {
      console.error('[api/projects] offline fallback failed', error)
      const payload = { error: message || error?.message || 'Failed to process subtitle file.' }
      return NextResponse.json(payload, { status: 400 })
    }
  }

  const offlineResponse = async () => {
    const offlineUser = ensureOfflineUser()
    const response = await fallbackToOffline({
      userId: offlineUser.id,
      overrideId: `offline-${randomUUID()}`,
      sourceFilePath: `offline/${Date.now()}-${randomUUID()}-${file.name}`,
    })
    return persistOfflineUserCookie(response, offlineUser)
  }

  if (!supabaseAvailable || authError || !user) {
    return offlineResponse()
  }

  const uploadCostCents = UPLOAD_COST_CENTS
  let chargeId = null

  const revertCharge = async () => {
    if (!chargeId || !supabase) return
    try {
      await supabase
        .from('wallet_transactions')
        .delete()
        .eq('id', chargeId)
    } catch (error) {
      console.error('[api/projects] failed to revert upload charge', error)
    } finally {
      chargeId = null
    }
  }

  const finalizeCharge = async ({ projectId } = {}) => {
    if (!chargeId || !supabase) return
    try {
      const update = {
        status: 'succeeded',
        metadata: {
          action: 'upload',
          project_id: projectId || null,
        },
      }

      await supabase
        .from('wallet_transactions')
        .update(update)
        .eq('id', chargeId)
    } catch (error) {
      console.error('[api/projects] failed to finalize upload charge', error)
    } finally {
      chargeId = null
    }
  }

  const ensureSufficientAfterPending = async () => {
    if (!supabase || !user) {
      return { ok: false, error: new Error('Unauthorized') }
    }

    const { data: txs = [], error } = await supabase
      .from('wallet_transactions')
      .select('id, amount_cents, status')
      .eq('user_id', user.id)

    if (error) {
      return { ok: false, error }
    }

    const succeededBalance = computeBalance(txs)
    const pendingDebitTotal = computePendingDebits(txs)
    const available = succeededBalance - pendingDebitTotal

    if (available < 0) {
      return { ok: false, error: new Error('Insufficient credits. Top up your wallet to upload.') }
    }

    return { ok: true }
  }

  const { data: walletTransactions = [], error: walletError } = await supabase
    .from('wallet_transactions')
    .select('id, amount_cents, status')
    .eq('user_id', user.id)

  if (walletError) {
    return NextResponse.json({ error: walletError.message }, { status: 500 })
  }

  const balanceCents = computeBalance(walletTransactions)
  if (balanceCents < uploadCostCents) {
    return NextResponse.json({ error: 'Insufficient credits. Top up your wallet to upload.' }, { status: 402 })
  }

  const { data: pendingCharge, error: pendingError } = await supabase
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

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 })
  }

  chargeId = pendingCharge.id

  const availability = await ensureSufficientAfterPending()
  if (!availability.ok) {
    await revertCharge()
    const isInsufficient = availability.error?.message?.includes('Insufficient credits')
    return NextResponse.json(
      { error: availability.error?.message || 'Unable to verify wallet balance.' },
      { status: isInsufficient ? 402 : 500 },
    )
  }

  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  let storageClient = hasServiceRole ? createSupabaseServiceClient() : supabase
  if (hasServiceRole && !storageClient) {
    console.warn('[api/projects] Service-role client unavailable; falling back to user-scoped client for storage uploads')
    storageClient = supabase
  }

  const { error: uploadError } = await storageClient.storage
    .from(bucket)
    .upload(objectPath, rawBuffer, {
      cacheControl: '3600',
      contentType: file.type || 'text/plain',
      upsert: false,
    })

  if (uploadError) {
    console.error('[api/projects] storage upload failed', uploadError)
    await revertCharge()
    return fallbackToOffline({
      userId: user.id,
      overrideId: `offline-${randomUUID()}`,
      sourceFilePath: `offline/${Date.now()}-${randomUUID()}-${file.name}`,
      message: uploadError.message,
    })
  }

  // 2. Create the project record with a 'processing' status using the authenticated user session
  const { data: project, error: insertProjectError } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      title: projectTitle,
      status: 'processing',
      source_file_path: objectPath,
      source_file_name: file.name,
      segments_count: 0,
    })
    .select('id')
    .single()

  if (insertProjectError) {
    await revertCharge()
    await storageClient.storage.from(bucket).remove([objectPath])

    return fallbackToOffline({
      userId: user.id,
      overrideId: `offline-${randomUUID()}`,
      sourceFilePath: objectPath,
      message: insertProjectError.message,
    })
  }

  if (!hasServiceRole) {
    try {
      const segmentRows = await buildSegmentRows(project.id)

      const { error: insertSegmentsError } = await supabase
        .from('review_segments')
        .insert(segmentRows)

      if (insertSegmentsError) {
        throw insertSegmentsError
      }

      const { error: updateProjectError } = await supabase
        .from('projects')
        .update({ status: 'review', segments_count: segmentRows.length })
        .eq('id', project.id)

      if (updateProjectError) {
        throw updateProjectError
      }

      await finalizeCharge({ projectId: project.id })
      return NextResponse.json({ projectId: project.id, processed: true }, { status: 201 })
    } catch (error) {
      console.error('[api/projects] inline processing failed', error)
      await supabase.from('projects').delete().eq('id', project.id)
      await supabase.storage.from(bucket).remove([objectPath])

      await revertCharge()
      return fallbackToOffline({
        userId: user.id,
        overrideId: project.id,
        sourceFilePath: objectPath,
        message: error?.message,
      })
    }
  }

  // 3. Return the project ID so the client can trigger the processing job
  await finalizeCharge({ projectId: project.id })
  return NextResponse.json({ projectId: project.id, processed: false }, { status: 201 })
}
