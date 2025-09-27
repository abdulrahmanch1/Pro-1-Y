import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

const readSupabaseEnv = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[supabase/server] Supabase env vars are not configured. Returning null client.')
    }
    return null
  }
  return { url, anon }
}

export const createSupabaseServerClient = () => {
  const credentials = readSupabaseEnv()
  if (!credentials) return null

  const cookieStore = cookies()

  return createServerClient(credentials.url, credentials.anon, {
    cookies: {
      get(name) {
        return cookieStore.get(name)?.value
      },
      set(name, value, options) {
        try {
          cookieStore.set({ name, value, ...options })
        } catch (error) {
          // Next.js only allows mutating cookies inside route handlers or server actions.
          // In other runtimes (e.g. server components) we just no-op.
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
