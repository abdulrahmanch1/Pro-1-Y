import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { serializeSegmentsToSrt } from '@/lib/parsers/srt'
import { getOfflineProject } from '@/lib/offline-store'
import { readOfflineUser, ensureOfflineUser, persistOfflineUserCookie } from '@/lib/offline-user'
import { isUuid } from '@/lib/utils/uuid'
import { EXPORT_COST_CENTS } from '@/lib/pricing'

const computeBalance = (transactions = []) =>
  transactions
    .filter((tx) => tx.status === 'succeeded')
    .reduce((acc, tx) => acc + Number(tx.amount_cents || 0), 0)

const computePendingDebits = (transactions = []) =>
  transactions
    .filter((tx) => tx.status === 'pending' && Number(tx.amount_cents || 0) < 0)
    .reduce((acc, tx) => acc + Math.abs(Number(tx.amount_cents || 0)), 0)

export async function POST(req, { params }) {
  let supabase
  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    supabase = null
    console.warn('[api/projects/:id/export] Supabase client unavailable, checking offline store.')
  }

  let user = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
  }

  const projectId = params.id

  const offlineUser = user ? { id: user.id } : readOfflineUser()
  const offlineProject = offlineUser ? getOfflineProject({ userId: offlineUser.id, projectId }) : null
  if (offlineProject) {
    const segments = Array.isArray(offlineProject.segments)
      ? [...offlineProject.segments].sort((a, b) => a.index - b.index)
      : []

    if (!segments.length) {
      return NextResponse.json({ error: 'No segments to export' }, { status: 400 })
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
    const fileBase = offlineProject.sourceFileName?.replace(/\.[^.]+$/, '') || offlineProject.title || 'export'

    const response = new NextResponse(srt, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileBase}.srt"`,
        'Content-Length': Buffer.byteLength(srt, 'utf-8').toString(),
      },
    })
    if (!offlineUser) {
      const ensured = ensureOfflineUser()
      return persistOfflineUserCookie(response, ensured)
    }
    return response
  }

  if (!supabase || !user || !isUuid(projectId)) {
    const ensured = ensureOfflineUser()
    const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return persistOfflineUserCookie(response, ensured)
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select(`
      id,
      title,
      source_file_name,
      segments:review_segments(
        id,
        index,
        ts_start_ms,
        ts_end_ms,
        original_text,
        proposed_text,
        accepted,
        edited_text
      )
    `)
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const segments = Array.isArray(project.segments)
    ? [...project.segments].sort((a, b) => a.index - b.index)
    : []

  if (!segments.length) {
    return NextResponse.json({ error: 'No segments to export' }, { status: 400 })
  }

  const exportCost = EXPORT_COST_CENTS

  const { data: walletTransactions = [], error: walletError } = await supabase
    .from('wallet_transactions')
    .select('id, amount_cents, status')
    .eq('user_id', user.id)

  if (walletError) {
    return NextResponse.json({ error: walletError.message }, { status: 500 })
  }

  const balanceCents = computeBalance(walletTransactions)

  if (balanceCents < exportCost) {
    return NextResponse.json({ error: 'Insufficient credits. Top up your wallet to export.' }, { status: 402 })
  }

  const payload = segments.map((segment) => ({
    tsStartMs: segment.ts_start_ms,
    tsEndMs: segment.ts_end_ms,
    originalText: segment.original_text,
    text: segment.accepted
      ? (segment.edited_text || segment.proposed_text || segment.original_text)
      : segment.original_text,
  }))

  const srt = serializeSegmentsToSrt(payload)
  const buffer = Buffer.from(srt, 'utf-8')
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'captions'
  const fileName = project.source_file_name?.replace(/\.[^.]+$/, '') || project.title || 'export'
  const objectPath = `${user.id}/${project.id}/exports/${Date.now()}-${fileName}.srt`

  const revertCharge = async (transactionId) => {
    if (!transactionId) return
    await supabase
      .from('wallet_transactions')
      .delete()
      .eq('id', transactionId)
  }

  const ensureSufficientAfterPending = async () => {
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
      return { ok: false, error: new Error('Insufficient credits. Top up your wallet to export.') }
    }

    return { ok: true }
  }

  // Reserve funds by creating a pending charge before writing to storage.
  const { data: pendingCharge, error: pendingError } = await supabase
    .from('wallet_transactions')
    .insert({
      user_id: user.id,
      type: 'charge',
      amount_cents: -exportCost,
      description: `Export ${fileName}.srt`,
      status: 'pending',
    })
    .select('id')
    .single()

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 })
  }

  const chargeId = pendingCharge.id

  const availability = await ensureSufficientAfterPending()
  if (!availability.ok) {
    await revertCharge(chargeId)
    const isInsufficient = availability.error?.message === 'Insufficient credits. Top up your wallet to export.'
    return NextResponse.json(
      { error: availability.error?.message || 'Unable to verify wallet balance.' },
      { status: isInsufficient ? 402 : 500 }
    )
  }

  try {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectPath, buffer, {
        cacheControl: '3600',
        contentType: 'text/plain',
        upsert: false,
      })

    if (uploadError) {
      throw Object.assign(new Error(uploadError.message), { status: uploadError.statusCode || 500 })
    }

    const { error: exportInsertError } = await supabase
      .from('exports')
      .insert({
        project_id: project.id,
        file_path: objectPath,
        type: 'srt',
      })

    if (exportInsertError) {
      throw Object.assign(new Error(exportInsertError.message), { status: 500 })
    }

    const { error: finalizeError } = await supabase
      .from('wallet_transactions')
      .update({ status: 'succeeded' })
      .eq('id', chargeId)

    if (finalizeError) {
      throw Object.assign(new Error(finalizeError.message), { status: 500 })
    }

    const { data: signedUrl, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, 60 * 10)

    if (signedError) {
      throw Object.assign(new Error(signedError.message), { status: 500 })
    }

    return NextResponse.json({ downloadUrl: signedUrl.signedUrl })
  } catch (error) {
    await revertCharge(chargeId)
    await supabase
      .from('exports')
      .delete()
      .eq('project_id', project.id)
      .eq('file_path', objectPath)
    await supabase.storage.from(bucket).remove([objectPath])
    return NextResponse.json({ error: error.message }, { status: error.status || 500 })
  }
}
