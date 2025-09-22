'use client'

import { useMemo, useState } from 'react'

import { createSupabaseBrowserClient } from '@/lib/supabase/browser'

export default function ForgotPasswordClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabaseMissing = !supabase

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSent(false)
    setError(null)
    setLoading(true)

    if (!supabase) {
      setError('Supabase environment variables are not configured. See README.md to connect Supabase.')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSent(true)
  }

  return (
    <section className="section center" style={{minHeight:'60vh'}}>
      <div className="auth-card" style={{maxWidth:'520px'}}>
        <span className="tag">Reset</span>
        <h2>Need a new password?</h2>
        <p>Enter the email tied to your creator account. We’ll send you a secure link to get back in.</p>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label className="label" htmlFor="reset-email">Email</label>
            <input
              id="reset-email"
              className="input"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
          {sent ? (
            <div className="alert alert-success">
              <span>Check your inbox for the reset link.</span>
            </div>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={loading || supabaseMissing}>
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
          <p style={{textAlign:'center'}}>
            Remembered it? <a href="/auth/sign-in">Back to sign in</a>
          </p>
        </form>
      </div>
    </section>
  )
}
