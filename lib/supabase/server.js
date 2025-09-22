import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

const invariant = (value, message) => {
  if (!value) throw new Error(message)
  return value
}

export const createSupabaseServerClient = () => {
  const url = invariant(process.env.NEXT_PUBLIC_SUPABASE_URL, 'Missing NEXT_PUBLIC_SUPABASE_URL')
  const anon = invariant(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const cookieStore = cookies()

  return createServerClient(url, anon, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value
      },
      set(name, value, options) {
        cookieStore.set({ name, value, ...options })
      },
      remove(name, options) {
        cookieStore.set({ name, value: '', ...options })
      },
    },
  })
}
