import { createClient } from '@supabase/supabase-js'

let serviceClient

const invariant = (value, message) => {
  if (!value) throw new Error(message)
  return value
}

export const createSupabaseServiceClient = () => {
  if (!serviceClient) {
    serviceClient = createClient(
      invariant(process.env.NEXT_PUBLIC_SUPABASE_URL, 'Missing NEXT_PUBLIC_SUPABASE_URL'),
      invariant(process.env.SUPABASE_SERVICE_ROLE_KEY, 'Missing SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: { persistSession: false },
      }
    )
  }
  return serviceClient
}
