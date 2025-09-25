'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createSupabaseBrowserClient } from '@/lib/supabase/browser'

export default function SignUpClient() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const supabaseMissing = !supabase

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError(null)
    if (!supabase) {
      setError('Supabase environment variables are not configured. See README.md to connect Supabase.')
      return
    }
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/verify`,
        data: {
          full_name: name,
        },
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSent(true)
    router.push('/auth/verify')
  }

  const handleGoogle = async () => {
    setError(null)
    if (!supabase) {
      setError('Supabase environment variables are not configured. See README.md to connect Supabase.')
      return
    }
    const redirectUrl = new URL('/auth/callback', window.location.origin)
    redirectUrl.searchParams.set('redirect', '/upload')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl.toString(),
      },
    })

    if (error) setError(error.message)
  }

  return (
    <section className="section auth-shell">
      <div className="auth-card">
        <span className="tag tag--primary">Create account</span>
        <h2>Unlock AI-assisted captioning in seconds.</h2>
        <p>Sign up to build your personal caption workspace with Supabase-backed sync.</p>
        <form className="stack" onSubmit={handleSubmit}>
          <div className="field">
            <label className="label" htmlFor="signup-name">Name</label>
            <input
              id="signup-name"
              className="input"
              type="text"
              placeholder="Alex Creator"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              className="input"
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="signup-pass">Password</label>
            <input
              id="signup-pass"
              className="input"
              type="password"
              required
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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
              <span>Check your email to confirm your account.</span>
            </div>
          ) : null}
          <button className="btn btn-primary auth-btn" type="submit" disabled={loading || supabaseMissing}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
          <div className="divider">Or continue with</div>
          <button className="btn btn-outline auth-btn auth-provider-btn" type="button" onClick={handleGoogle} disabled={supabaseMissing}>
            <svg
              aria-hidden="true"
              focusable="false"
              width="18"
              height="18"
              viewBox="0 0 18 18"
            >
              <path fill="#EA4335" d="M9 3.48c1.69 0 2.84.73 3.49 1.35l2.55-2.49C13.66.89 11.58 0 9 0 5.48 0 2.44 2.02.96 4.96l2.98 2.32C4.51 5.02 6.55 3.48 9 3.48z" />
              <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.18-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.79 2.73v2.26h2.88c1.69-1.56 2.71-3.87 2.71-6.63z" />
              <path fill="#FBBC05" d="M3.94 10.28a5.51 5.51 0 0 1-.29-1.78c0-.62.11-1.22.29-1.78V4.44H1.01A9 9 0 0 0 0 8.5C0 10.1.39 11.6 1.01 12.56l2.93-2.28z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.48-.8 5.97-2.17l-2.88-2.26c-.8.54-1.83.87-3.09.87-2.45 0-4.49-1.54-5.23-3.66L.96 12.56C2.44 15.5 5.48 18 9 18z" />
              <path fill="none" d="M0 0h18v18H0z" />
            </svg>
            <span>Sign up with Google</span>
          </button>
          <p style={{textAlign:'center'}}>Already have an account? <a href="/auth/sign-in">Sign in</a></p>
        </form>
      </div>
      <aside className="auth-side">
        <span className="tag">What’s next</span>
        <h3>Tomorrow’s Supabase wiring</h3>
        <p>Supabase auth stores your wallet balance, review queues, and AI preferences securely.</p>
        <ul className="stack" style={{color:'var(--text-primary)', listStyle:'disc', paddingInlineStart:'1.2rem'}}>
          <li>Email verification with branded confirmation screen.</li>
          <li>Google one-tap sign in for creators on the go.</li>
          <li>Workspace invites for teams and agencies.</li>
        </ul>
      </aside>
    </section>
  )
}
