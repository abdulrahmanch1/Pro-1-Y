import { createClient } from '@supabase/supabase-js'

let serviceClient

const readServiceEnv = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRole) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[supabase/service] Service-role env vars are not configured. Returning null client.')
    }
    return null
  }
  return { url, serviceRole }
}

export const createSupabaseServiceClient = () => {
  if (serviceClient) return serviceClient

  const credentials = readServiceEnv()
  if (!credentials) return null

  serviceClient = createClient(credentials.url, credentials.serviceRole, {
    auth: { persistSession: false },
  })

  return serviceClient
}
