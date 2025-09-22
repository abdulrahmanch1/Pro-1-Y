import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { parseSrt } from '@/lib/parsers/srt'

const toBuffer = async (file) => {
  const arrayBuffer = await file.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function POST(req) {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('file')
  const title = formData?.get('title')?.toString()?.trim()

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'SRT file is required' }, { status: 400 })
  }

  const rawBuffer = await toBuffer(file)
  const rawText = rawBuffer.toString('utf-8')

  let segments
  try {
    segments = parseSrt(rawText)
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to parse SRT file' }, { status: 400 })
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'captions'
  const objectPath = `${user.id}/${Date.now()}-${randomUUID()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, rawBuffer, {
      cacheControl: '3600',
      contentType: file.type || 'text/plain',
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: uploadError.statusCode || 500 })
  }

  const { data: project, error: insertProjectError } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      title: title || file.name || 'Untitled project',
      status: 'review',
      source_file_path: objectPath,
      source_file_name: file.name,
      segments_count: segments.length,
    })
    .select('id')
    .single()

  if (insertProjectError) {
    return NextResponse.json({ error: insertProjectError.message }, { status: 500 })
  }

  const segmentRows = segments.map((segment, index) => ({
    project_id: project.id,
    index: index + 1,
    ts_start_ms: segment.tsStartMs,
    ts_end_ms: segment.tsEndMs,
    original_text: segment.originalText,
    proposed_text: segment.originalText,
    accepted: true,
    edited_text: segment.originalText,
  }))

  const { error: insertSegmentsError } = await supabase
    .from('review_segments')
    .insert(segmentRows)

  if (insertSegmentsError) {
    return NextResponse.json({ error: insertSegmentsError.message }, { status: 500 })
  }

  return NextResponse.json({ projectId: project.id }, { status: 201 })
}
