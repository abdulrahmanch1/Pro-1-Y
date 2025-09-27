import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { mapProjectRow } from '@/lib/api/project-transforms'
import { getOfflineProject } from '@/lib/offline-store'
import { readOfflineUser } from '@/lib/offline-user'
import { isUuid } from '@/lib/utils/uuid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req, { params }) {
  const supabase = createSupabaseServerClient()
  if (!supabase) {
    console.warn('[api/projects/:id] Supabase client unavailable, checking offline store.')
  }

  let user = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
  }

  const projectId = params.id
  if (supabase && user && isUuid(projectId)) {
    const { data: project, error } = await supabase
      .from('projects')
      .select(`
        id,
        title,
        status,
        source_file_name,
        source_file_path,
        created_at,
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
      console.error('[api/projects/:id] failed to fetch project', error)
    } else if (project) {
      const segmentCount = Array.isArray(project?.segments) ? project.segments.length : 0
      console.log('[api/projects/:id] returning project', { projectId, segmentCount, status: project?.status })
      return NextResponse.json(mapProjectRow(project))
    }
  }

  const offlineUser = user ? { id: user.id } : readOfflineUser()
  if (!offlineUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const offline = getOfflineProject({ userId: offlineUser.id, projectId })
  if (!offline) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(offline)
}
