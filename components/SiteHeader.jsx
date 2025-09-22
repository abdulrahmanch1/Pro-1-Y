'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { useSupabaseSession } from '@/hooks/useSupabaseSession'

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const router = useRouter()
  const { session, supabase } = useSupabaseSession()

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 720) setMenuOpen(false)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const navItems = useMemo(() => {
    const base = [
      { href: '/review', label: 'Review' },
      { href: '/wallet', label: 'Wallet' },
    ]
    if (!session) base.push({ href: '/auth/sign-in', label: 'Sign in' })
    return base
  }, [session])

  const toggleMenu = () => setMenuOpen(prev => !prev)
  const closeMenu = () => setMenuOpen(false)

  const signOut = async () => {
    if (!supabase) {
      console.warn('Supabase is not configured. Unable to sign out.')
      return
    }
    await supabase.auth.signOut()
    router.refresh()
    closeMenu()
  }

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <div className="navbar-start">
          <Link href="/" className="brand" onClick={closeMenu}>
            <span className="brand-burst" aria-hidden />
            <span>Subtitle AI</span>
          </Link>
          <button
            type="button"
            className={menuOpen ? 'nav-toggle is-active' : 'nav-toggle'}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={toggleMenu}
          >
            <span className="sr-only">Toggle navigation</span>
            <span aria-hidden data-line="top" />
            <span aria-hidden data-line="middle" />
            <span aria-hidden data-line="bottom" />
          </button>
        </div>
        <nav
          id="primary-nav"
          className={menuOpen ? 'nav-links is-open' : 'nav-links'}
          aria-label="Primary"
        >
          {navItems.map(item => (
            <Link key={item.href} href={item.href} onClick={closeMenu}>
              {item.label}
            </Link>
          ))}
          {session ? (
            <button type="button" className="nav-link" onClick={signOut}>
              Sign out
            </button>
          ) : null}
        </nav>
        <div className="navbar-cta">
          <Link className="btn btn-primary" href="/upload" onClick={closeMenu}>
            Launch app
          </Link>
        </div>
      </div>
    </header>
  )
}
