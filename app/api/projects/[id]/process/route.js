import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { parseSrt } from '@/lib/parsers/srt'
import { generateRewriteSuggestions } from '@/lib/ai/rewrite'

export const runtime = 'nodejs'

// This route is called after the initial project and file have been created.
// It handles the heavy processing of parsing the file and creating the segments.
export async function POST(req, { params }) {
  const { id: projectId } = params

  console.log('[projects/process] handler start', { projectId })

  let serverSupabase
  try {
    serverSupabase = createSupabaseServerClient()
  } catch (error) {
    console.error('Failed to initialise Supabase server client for processing route.', error)
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 })
  }

  console.log('[projects/process] created server client', { projectId })

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser()

  console.log('[projects/process] fetched user', { projectId, hasUser: Boolean(user), authError })

  if (authError) {
    console.error('Supabase auth failed while processing project:', authError)
    return NextResponse.json({ error: 'Authentication failed.' }, { status: 500 })
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const {
    data: project,
    error: projectError,
  } = await serverSupabase
    .from('projects')
    .select('id, user_id, title, source_file_path, source_file_name, status')
    .eq('id', projectId)
    .maybeSingle()

  console.log('[projects/process] fetched project', { projectId, projectExists: Boolean(project), projectError })

  if (projectError) {
    console.error('Failed to fetch project via RLS client:', projectError)
    return NextResponse.json({ error: 'Unable to load project.' }, { status: 500 })
  }

  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  }

  if (project.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseServiceClient()
    : serverSupabase

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[projects/process] SUPABASE_SERVICE_ROLE_KEY not set; using user-scoped client fallback')
  }

  const {
    data: existingSegments,
    error: existingSegmentsError,
  } = await supabase
    .from('review_segments')
    .select('id')
    .eq('project_id', project.id)
    .limit(1)

  console.log('[projects/process] existing segments check', {
    projectId,
    existingCount: Array.isArray(existingSegments) ? existingSegments.length : null,
    existingSegmentsError,
  })

  if (existingSegmentsError) {
    console.error('Failed to check existing project segments:', existingSegmentsError)
    return NextResponse.json({ error: 'Unable to verify project state.' }, { status: 500 })
  }

  if (Array.isArray(existingSegments) && existingSegments.length) {
    if (project.status !== 'review') {
      await supabase
        .from('projects')
        .update({ status: 'review' })
        .eq('id', projectId)
    }
    return NextResponse.json({ message: 'Project already processed.' })
  }

  // 1. Fetch the project details
  // 2. Download the source file from storage
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'captions'
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(project.source_file_path)

  if (downloadError) {
    console.error('[projects/process] storage download failed', { projectId, error: downloadError.message })
  } else {
    console.log('[projects/process] storage download success', { projectId })
  }

  if (downloadError) {
    await supabase.from('projects').update({ status: 'error' }).eq('id', projectId)
    return NextResponse.json({ error: downloadError.message }, { status: 500 })
  }

  // 3. Parse the file content
  let segments
  try {
    const rawText = await fileBlob.text()
    segments = parseSrt(rawText)
    console.log('[projects/process] parsed SRT', { projectId, segmentCount: segments.length })
  } catch (error) {
    await supabase.from('projects').update({ status: 'error' }).eq('id', projectId)
    return NextResponse.json({ error: error.message || 'Failed to parse SRT file' }, { status: 400 })
  }

  // 4. Generate AI suggestions when possible
  let suggestions = new Map()
  if (process.env.OPENAI_API_KEY) {
    try {
      suggestions = await generateRewriteSuggestions({
        segments,
        projectTitle: project.title || project.source_file_name,
        language: project.original_language || null,
      })
      console.log('[projects/process] AI suggestions generated', {
        projectId,
        suggestionsCount: suggestions.size,
      })
    } catch (error) {
      console.error('AI suggestion pipeline failed:', error)
      suggestions = new Map()
    }
  } else {
    console.warn('OPENAI_API_KEY is not configured. Skipping AI suggestions.')
  }

  // 5. Create segment rows for the database (AI-enhanced when available)
  const segmentRows = segments.map((segment, position) => {
    const index = Number.isFinite(segment.index) && segment.index > 0 ? segment.index : position + 1
    const aiPayload = suggestions.get(index)
    const rewrite = typeof aiPayload?.rewrite === 'string' ? aiPayload.rewrite.trim() : ''
    const original = typeof segment.originalText === 'string' ? segment.originalText : ''
    const proposedText = rewrite || original

    return {
      project_id: project.id,
      index,
      ts_start_ms: segment.tsStartMs,
      ts_end_ms: segment.tsEndMs,
      original_text: segment.originalText,
      proposed_text: proposedText,
      accepted: true,
      edited_text: proposedText,
    }
  })

  console.log('[projects/process] inserting segments', {
    projectId: project.id,
    totalSegments: segmentRows.length,
    suggestionsApplied: Array.from(suggestions.keys()),
  })

  const { error: insertSegmentsError } = await supabase
    .from('review_segments')
    .insert(segmentRows)

  if (insertSegmentsError) {
    console.error('[projects/process] insert segments failed', { projectId, error: insertSegmentsError.message })
  } else {
    console.log('[projects/process] insert segments success', { projectId })
  }

  if (insertSegmentsError) {
    await supabase.from('projects').update({ status: 'error' }).eq('id', projectId)
    return NextResponse.json({ error: insertSegmentsError.message }, { status: 500 })
  }

  // 6. Update the project status to 'review'
  const { error: updateError } = await supabase
    .from('projects')
    .update({ status: 'review', segments_count: segments.length })
    .eq('id', projectId)

  if (updateError) {
    // The project is in an inconsistent state, but it's hard to roll back.
    // The user can still access the segments, but the status is wrong.
    console.error('Failed to update project status after processing:', updateError)
  }

  console.log('[projects/process] completed', {
    projectId: project.id,
    statusUpdateError: Boolean(updateError),
  })

  return NextResponse.json({ message: 'Project processed successfully.' })
}
