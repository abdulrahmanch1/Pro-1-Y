"use client"
import React from 'react'

export default function ThemeToggle({ onThemeChange }) {
  const [ready, setReady] = React.useState(false)
  const [theme, setTheme] = React.useState('dark')
  const timeoutRef = React.useRef(null)
  React.useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('theme') : null
    const initial = saved || 'dark'
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
    onThemeChange?.(initial)
    setReady(true)
  }, [])
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    document.documentElement.classList.add('theme-switching')
    window.clearTimeout(timeoutRef.current || undefined)
    timeoutRef.current = window.setTimeout(() => {
      document.documentElement.classList.remove('theme-switching')
    }, 900)
    onThemeChange?.(next)
  }
  React.useEffect(() => () => {
    window.clearTimeout(timeoutRef.current || undefined)
    document.documentElement.classList.remove('theme-switching')
  }, [])
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  const icon = theme === 'dark' ? '🌞' : '🌙'

  return (
    <button
      aria-label={label}
      className="theme-toggle"
      onClick={toggle}
      style={{opacity: ready ? 1 : 0, pointerEvents: ready ? 'auto' : 'none'}}
      title={label}
    >
      <span aria-hidden>{icon}</span>
    </button>
  )
}
