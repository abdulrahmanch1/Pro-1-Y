'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createSupabaseBrowserClient } from '@/lib/supabase/browser'

export default function ResetPasswordClient() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabaseMissing = !supabase

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setError(null)
    if (!supabase) {
      setError('Supabase environment variables are not configured. See README.md to connect Supabase.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSuccess(true)
    setTimeout(() => {
      router.push('/auth/sign-in')
    }, 1500)
  }

  return (
    <section className="section center" style={{minHeight:'60vh'}}>
      <div className="auth-card" style={{maxWidth:'520px'}}>
        <span className="tag tag--primary">Security</span>
        <h2>Create your new password.</h2>
        <p>Make it strong with at least 8 characters, numbers, and a unique vibe that fits your creator brand.</p>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label className="label" htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              required
              placeholder="••••••••"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          {error ? (
            <div className="alert alert-error">
              <span>{error}</span>
            </div>
          ) : null}
          {!error && supabaseMissing ? (
            <div className="alert alert-error">
              <span>Supabase is not configured. Update `.env.local` using `.env.example`.</span>
            </div>
          ) : null}
          {success ? (
            <div className="alert alert-success">
              <span>Password updated. Redirecting…</span>
            </div>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={loading || supabaseMissing}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
          <p style={{textAlign:'center'}}>
            Back to <a href="/auth/sign-in">sign in</a>
          </p>
        </form>
      </div>
    </section>
  )
}
