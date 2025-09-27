import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { mapSegmentRow } from '@/lib/api/project-transforms'
import { getOfflineProject, updateOfflineSegments } from '@/lib/offline-store'
import { ensureOfflineUser, persistOfflineUserCookie, readOfflineUser } from '@/lib/offline-user'
import { isUuid } from '@/lib/utils/uuid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req, { params }) {
  const supabase = createSupabaseServerClient()
  if (!supabase) {
    console.warn('[api/projects/:id/segments] Supabase client unavailable, using offline store.')
  }

  let user = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
  }

  const projectId = params.id
  const { updates } = await req.json().catch(() => ({ updates: [] }))

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: 'No updates supplied' }, { status: 400 })
  }

  const normalizedUpdates = updates
    .map((item) => {
      const payload = {
        id: item.id,
      }

      if (typeof item.accepted === 'boolean') {
        payload.accepted = item.accepted
      }
      if (typeof item.editedText === 'string') {
        payload.editedText = item.editedText
      }
      if (typeof item.proposedText === 'string') {
        payload.proposedText = item.proposedText
      }

      return payload
    })
    .filter((row) => row.id && (row.accepted !== undefined || row.editedText !== undefined || row.proposedText !== undefined))

  if (!normalizedUpdates.length) {
    return NextResponse.json({ error: 'No valid updates supplied' }, { status: 400 })
  }

  const offlineUser = user ? { id: user.id } : readOfflineUser()
  const offlineProject = offlineUser ? getOfflineProject({ userId: offlineUser.id, projectId }) : null
  if (offlineProject) {
    const targetUser = offlineUser ?? ensureOfflineUser()
    const applied = updateOfflineSegments({ userId: targetUser.id, projectId, updates: normalizedUpdates }) || []
    const response = NextResponse.json({ segments: applied })
    return persistOfflineUserCookie(response, targetUser)
  }

  if (!supabase || !user || !isUuid(projectId)) {
    const offlineUserContext = ensureOfflineUser()
    const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return persistOfflineUserCookie(response, offlineUserContext)
  }

  const {
    data: ownedProject,
    error: ownershipError,
  } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (ownershipError) {
    return NextResponse.json({ error: ownershipError.message }, { status: 500 })
  }

  if (!ownedProject) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseServiceClient() : null
  const dataClient = serviceClient || supabase

  const rowsToUpdate = normalizedUpdates
    .map((row) => {
      const { id, accepted, editedText, proposedText } = row
      const update = {}

      if (accepted !== undefined) update.accepted = accepted
      if (editedText !== undefined) update.edited_text = editedText
      if (proposedText !== undefined) update.proposed_text = proposedText

      return { id, ...update }
    })
    .filter((row) => Object.keys(row).length > 1)

  if (!rowsToUpdate.length) {
    return NextResponse.json({ error: 'No valid updates supplied' }, { status: 400 })
  }

  const updateIds = rowsToUpdate.map((row) => row.id)

  const { data: existingRows = [], error: existingError } = await dataClient
    .from('review_segments')
    .select('id, index')
    .eq('project_id', projectId)
    .in('id', updateIds)

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const existingMap = new Map(existingRows.map((row) => [row.id, row.index]))
  const filteredRows = rowsToUpdate
    .filter((row) => existingMap.has(row.id))
    .map((row) => ({ ...row, project_id: projectId, index: existingMap.get(row.id) }))

  if (!filteredRows.length) {
    return NextResponse.json({ error: 'No matching segments found for update' }, { status: 404 })
  }

  const results = []

  for (const row of filteredRows) {
    const { id, project_id, index, ...update } = row
    const { data, error } = await dataClient
      .from('review_segments')
      .update(update)
      .eq('id', id)
      .eq('project_id', projectId)
      .select('id, index, ts_start_ms, ts_end_ms, original_text, proposed_text, accepted, edited_text')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data) {
      results.push(mapSegmentRow(data))
    }
  }

  return NextResponse.json({ segments: results })
}
