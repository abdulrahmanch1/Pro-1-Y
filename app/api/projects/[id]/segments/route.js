import { NextResponse } from 'next/server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { mapSegmentRow } from '@/lib/api/project-transforms'

export async function PATCH(req, { params }) {
  const supabase = createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectId = params.id
  const { updates } = await req.json().catch(() => ({ updates: [] }))

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: 'No updates supplied' }, { status: 400 })
  }

  const payload = updates.map((item) => ({
    id: item.id,
    accepted: typeof item.accepted === 'boolean' ? item.accepted : undefined,
    edited_text: typeof item.editedText === 'string' ? item.editedText : undefined,
    proposed_text: typeof item.proposedText === 'string' ? item.proposedText : undefined,
  }))

  const applied = []
  for (const row of payload) {
    const update = Object.fromEntries(
      Object.entries(row).filter(([_, value]) => value !== undefined)
    )

    if (!update.id) continue

    const { data, error } = await supabase
      .from('review_segments')
      .update(update)
      .eq('id', update.id)
      .eq('project_id', projectId)
      .select('id, accepted, edited_text, proposed_text')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data) applied.push(mapSegmentRow(data))
  }

  return NextResponse.json({ segments: applied })
}
