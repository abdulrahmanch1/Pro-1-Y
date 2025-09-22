import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { mapProjectRow } from '@/lib/api/project-transforms'

export async function GET(req, { params }) {
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(mapProjectRow(project))
}
