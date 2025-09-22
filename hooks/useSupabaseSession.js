'use client'

import { useEffect, useRef, useState } from 'react'

import { createSupabaseBrowserClient } from '@/lib/supabase/browser'

export const useSupabaseSession = () => {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const supabaseRef = useRef(null)

  useEffect(() => {
    const client = createSupabaseBrowserClient()

    if (!client) {
      setError(new Error('Supabase environment variables are not configured.'))
      setLoading(false)
      return
    }

    supabaseRef.current = client

    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setError(error)
        setSession(data?.session ?? null)
        setLoading(false)
      })
      .catch((err) => {
        setError(err)
        setLoading(false)
      })

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return { session, loading, error, supabase: supabaseRef.current }
}
