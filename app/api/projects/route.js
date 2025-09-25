import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { createSupabaseServerClient } from '@/lib/supabase/server'

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
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'captions'
  const objectPath = `${user.id}/${Date.now()}-${randomUUID()}-${file.name}`

  // 1. Upload the file to storage
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

  // 2. Create the project record with a 'processing' status
  const { data: project, error: insertProjectError } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      title: title || file.name || 'Untitled project',
      status: 'processing', // Set status to processing
      source_file_path: objectPath,
      source_file_name: file.name,
      segments_count: 0, // Will be updated by the processing route
    })
    .select('id')
    .single()

  if (insertProjectError) {
    // If creating the project fails, clean up the uploaded file
    await supabase.storage.from(bucket).remove([objectPath])
    return NextResponse.json({ error: insertProjectError.message }, { status: 500 })
  }

  // 3. Return the project ID so the client can trigger the processing job
  return NextResponse.json({ projectId: project.id }, { status: 201 })
}
