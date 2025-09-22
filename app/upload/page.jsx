import { redirect } from 'next/navigation'

import UploadClient from './UploadClient'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import MissingSupabaseNotice from '@/components/MissingSupabaseNotice'

export const metadata = { title: 'Upload — Subtitle AI' }

export default async function UploadPage() {
  let supabase

  try {
    supabase = createSupabaseServerClient()
  } catch (error) {
    console.error(error)
    return <MissingSupabaseNotice action="upload captions" />
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in?redirectTo=/upload')
  }

  return <UploadClient />
}
