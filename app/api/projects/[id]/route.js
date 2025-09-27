import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOfflineProject } from '@/lib/offline-store'
import { readOfflineUser } from '@/lib/offline-user'
import { isUuid } from '@/lib/utils/uuid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  const supabase = createSupabaseServerClient()

  let userId = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    userId = authResult?.data?.user?.id ?? null
  }

  if (!userId) {
    const offlineUser = readOfflineUser()
    userId = offlineUser?.id ?? null
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectId = params.id
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return NextResponse.json({ error: 'Project id required' }, { status: 400 })
  }

  const offlineProject = getOfflineProject({ userId, projectId })
  if (!offlineProject) {
    // When the user id is a Supabase UUID and the project id is also UUID, we still treat it as offline only.
    if (isUuid(projectId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(offlineProject)
}
