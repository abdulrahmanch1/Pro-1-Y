import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { serializeSegmentsToSrt } from '@/lib/parsers/srt'

const computeBalance = (transactions = []) =>
  transactions
    .filter((tx) => tx.status === 'succeeded')
    .reduce((acc, tx) => acc + Number(tx.amount_cents || 0), 0)

export async function POST(req, { params }) {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectId = params.id
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

  const { data: walletTransactions = [], error: walletError } = await supabase
    .from('wallet_transactions')
    .select('amount_cents, status')
    .eq('user_id', user.id)

  if (walletError) {
    return NextResponse.json({ error: walletError.message }, { status: 500 })
  }

  const balanceCents = computeBalance(walletTransactions)
  const exportCost = 100

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

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, buffer, {
      cacheControl: '3600',
      contentType: 'text/plain',
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: uploadError.statusCode || 500 })
  }

  await supabase
    .from('exports')
    .insert({
      project_id: project.id,
      file_path: objectPath,
      type: 'srt',
    })

  // Charge $1 per export (mock) by inserting a wallet transaction
  await supabase
    .from('wallet_transactions')
    .insert({
      user_id: user.id,
      type: 'charge',
      amount_cents: -exportCost,
      description: `Export ${fileName}.srt`,
      status: 'succeeded',
    })

  const { data: signedUrl, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, 60 * 10)

  if (signedError) {
    return NextResponse.json({ error: signedError.message }, { status: 500 })
  }

  return NextResponse.json({ downloadUrl: signedUrl.signedUrl })
}
