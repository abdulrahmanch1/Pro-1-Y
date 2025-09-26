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
        try {
          cookieStore.set({ name, value, ...options })
        } catch (error) {
          // Next.js only allows mutating cookies inside route handlers or server actions.
          // In other runtimes (e.g. server components) we gracefully no-op.
          if (process.env.NODE_ENV === 'development') {
            console.warn('[supabase] Ignoring cookie.set in non-mutable context:', error?.message)
          }
        }
      },
      remove(name, options) {
        try {
          cookieStore.set({ name, value: '', ...options })
        } catch (error) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[supabase] Ignoring cookie.remove in non-mutable context:', error?.message)
          }
        }
      },
    },
  })
}
