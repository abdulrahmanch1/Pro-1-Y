import { createBrowserClient } from '@supabase/ssr'

let browserClient

const readSupabaseEnv = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  return { url, anon }
}

export const createSupabaseBrowserClient = () => {
  if (browserClient) return browserClient

  const credentials = readSupabaseEnv()

  if (!credentials) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        'Supabase environment variables are not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable auth.'
      )
    }
    return null
  }

  browserClient = createBrowserClient(credentials.url, credentials.anon)
  return browserClient
}
