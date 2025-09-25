export const dynamic = 'force-dynamic';
import Link from 'next/link'
import { redirect } from 'next/navigation'

import ReviewClient from './ReviewClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { mapProjectRow } from '@/lib/api/project-transforms'
import MissingSupabaseNotice from '@/components/MissingSupabaseNotice'
import { getOfflineProject, listOfflineProjects } from '@/lib/offline-store'
import { readOfflineUser } from '@/lib/offline-user'

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
    supabase = null
    console.warn('[review/page] Supabase client unavailable. Falling back to offline mode.', error?.message)
  }

  let user = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
  }

  const offlineUser = readOfflineUser()

  if (supabase && !user && !offlineUser) {
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

  let projects
  let error

  if (supabase && user) {
    try {
      const response = await projectQuery
      projects = response.data
      error = response.error
    } catch (err) {
      error = err
    }
  }

  if (error) {
    console.error('[review/page] failed to fetch project', error)
  }

  if (!projects || (Array.isArray(projects) && projects.length === 0)) {
    if (projectId) {
      const offlineProject = getOfflineProject({ userId: (user?.id) || offlineUser?.id, projectId })
      if (offlineProject) {
        return <ReviewClient project={offlineProject} />
      }
    } else {
      const offlineProjects = listOfflineProjects({ userId: (user?.id) || offlineUser?.id })
      if (offlineProjects.length) {
        const sorted = offlineProjects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        return <ReviewClient project={sorted[0]} />
      }
    }

    if (!supabase) {
      return <MissingSupabaseNotice action="review captions" />
    }

    return emptyState()
  }

  const projectRow = Array.isArray(projects) ? projects[0] : projects
  if (!projectRow) {
    return emptyState()
  }

  const project = mapProjectRow(projectRow)
  return <ReviewClient project={project} />
}
