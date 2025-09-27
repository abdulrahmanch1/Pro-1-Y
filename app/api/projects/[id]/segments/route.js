import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOfflineProject, updateOfflineSegments } from '@/lib/offline-store'
import { ensureOfflineUser, persistOfflineUserCookie, readOfflineUser } from '@/lib/offline-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req, { params }) {
  const supabase = createSupabaseServerClient()

  let userId = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    userId = authResult?.data?.user?.id ?? null
  }

  let offlineUser = null
  if (!userId) {
    offlineUser = ensureOfflineUser()
    userId = offlineUser.id
  }

  const projectId = params.id
  const { updates } = await req.json().catch(() => ({ updates: [] }))

  if (!Array.isArray(updates) || updates.length === 0) {
    const response = NextResponse.json({ error: 'No updates supplied' }, { status: 400 })
    return offlineUser ? persistOfflineUserCookie(response, offlineUser) : response
  }

  const normalizedUpdates = updates
    .map((item) => {
      const payload = { id: item.id }
      if (typeof item.accepted === 'boolean') payload.accepted = item.accepted
      if (typeof item.editedText === 'string') payload.editedText = item.editedText
      if (typeof item.proposedText === 'string') payload.proposedText = item.proposedText
      return payload
    })
    .filter((row) => row.id && (row.accepted !== undefined || row.editedText !== undefined || row.proposedText !== undefined))

  if (!normalizedUpdates.length) {
    const response = NextResponse.json({ error: 'No valid updates supplied' }, { status: 400 })
    return offlineUser ? persistOfflineUserCookie(response, offlineUser) : response
  }

  const project = getOfflineProject({ userId, projectId })
  if (!project) {
    const response = NextResponse.json({ error: 'Not found' }, { status: 404 })
    return offlineUser ? persistOfflineUserCookie(response, offlineUser) : response
  }

  const applied = updateOfflineSegments({ userId, projectId, updates: normalizedUpdates }) || []
  const response = NextResponse.json({ segments: applied })

  if (offlineUser && offlineUser.isNew) {
    return persistOfflineUserCookie(response, offlineUser)
  }

  return response
}
