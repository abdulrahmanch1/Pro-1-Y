export const dynamic = 'force-dynamic';
import Link from 'next/link'
import { redirect } from 'next/navigation'

import ReviewClient from './ReviewClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { mapProjectRow } from '@/lib/api/project-transforms'
import MissingSupabaseNotice from '@/components/MissingSupabaseNotice'

export const metadata = { title: 'Review — Subtitle AI' }

const emptyState = () => (
  <section className="section">
    <div className="section-header">
      <span className="eyebrow">Review</span>
      <h2>No projects yet.</h2>
      <p>Upload an SRT/VTT file and we’ll parse it into reviewable segments instantly.</p>
    </div>
    <div className="card" style={{marginTop:'2rem'}}>
      <p>You have no review sessions yet. Start by uploading your first caption file.</p>
      <div className="flex" style={{marginTop:'1rem'}}>
        <Link className="btn btn-primary" href="/upload">Upload captions</Link>
      </div>
    </div>
  </section>
)

export default async function ReviewPage({ searchParams }) {
  let supabase

  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    console.error(error)
    return <MissingSupabaseNotice action="review captions" />
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in?redirectTo=/review')
  }

  const projectId = searchParams?.projectId
  let projectQuery = supabase
    .from('projects')
    .select(`
      id,
      title,
      status,
      created_at,
      source_file_name,
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
    .eq('user_id', user.id)

  if (projectId) {
    projectQuery = projectQuery.eq('id', projectId)
  } else {
    projectQuery = projectQuery.order('created_at', { ascending: false }).limit(1)
  }

  const { data: projects, error } = await projectQuery

  if (error) {
    throw error
  }

  const projectRow = Array.isArray(projects) ? projects[0] : projects

  if (!projectRow) {
    return emptyState()
  }

  const project = mapProjectRow(projectRow)
  return <ReviewClient project={project} />
}
