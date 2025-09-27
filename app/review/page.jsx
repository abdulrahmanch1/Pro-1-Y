export const dynamic = 'force-dynamic';
import Link from 'next/link'
import { redirect } from 'next/navigation'

import ReviewClient from './ReviewClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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
  const supabase = createSupabaseServerClient()

  let user = null
  if (supabase) {
    const authResult = await supabase.auth.getUser()
    user = authResult?.data?.user ?? null
  }

  const offlineUser = readOfflineUser()

  if (supabase && !user && !offlineUser) {
    redirect('/auth/sign-in?redirectTo=/review')
  }

  const userId = user?.id ?? offlineUser?.id

  if (!userId) {
    return <MissingSupabaseNotice action="review captions" />
  }

  const projectId = searchParams?.projectId
  let project = null

  if (typeof projectId === 'string' && projectId.length) {
    project = getOfflineProject({ userId, projectId })
  }

  if (!project) {
    const offlineProjects = listOfflineProjects({ userId })
    if (offlineProjects.length) {
      const sorted = offlineProjects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      project = sorted[0]
    }
  }

  if (!project) {
    if (!supabase && !offlineUser) {
      return <MissingSupabaseNotice action="review captions" />
    }
    return emptyState()
  }

  return <ReviewClient project={project} />
}
