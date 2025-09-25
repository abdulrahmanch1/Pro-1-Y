import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { parseSrt } from '@/lib/parsers/srt'
import { generateCaptionSuggestions } from '@/lib/ai/chatgpt'
import { ensureOfflineUser, persistOfflineUserCookie } from '@/lib/offline-user'
import { createOfflineProject } from '@/lib/offline-store'

const toBuffer = async (file) => {
  const arrayBuffer = await file.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function POST(req) {
  console.log('[api/projects] handler start')

  let supabase = null
  let supabaseAvailable = true
  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    supabaseAvailable = false
    console.warn('[api/projects] Supabase client unavailable, falling back to offline mode.', error?.message)
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
        suggestions = await generateCaptionSuggestions({
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
      const proposedText = (aiPayload?.suggestion || segment.originalText).trim()

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
      const proposedText = (aiPayload?.suggestion || segment.originalText).trim()

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

  // 1. Upload the file to storage
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, rawBuffer, {
      cacheControl: '3600',
      contentType: file.type || 'text/plain',
      upsert: false,
    })

  if (uploadError) {
    console.error('[api/projects] storage upload failed', uploadError)
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
    await supabase.storage.from(bucket).remove([objectPath])

    return fallbackToOffline({
      userId: user.id,
      overrideId: `offline-${randomUUID()}`,
      sourceFilePath: objectPath,
      message: insertProjectError.message,
    })
  }

  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)

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

      return NextResponse.json({ projectId: project.id, processed: true }, { status: 201 })
    } catch (error) {
      console.error('[api/projects] inline processing failed', error)
      await supabase.from('projects').delete().eq('id', project.id)
      await supabase.storage.from(bucket).remove([objectPath])

      return fallbackToOffline({
        userId: user.id,
        overrideId: project.id,
        sourceFilePath: objectPath,
        message: error?.message,
      })
    }
  }

  // 3. Return the project ID so the client can trigger the processing job
  return NextResponse.json({ projectId: project.id, processed: false }, { status: 201 })
}
