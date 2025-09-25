'use client'
import React from 'react'

export default function ThemeToggle({ onThemeChange } = {}) {
  const [ready, setReady] = React.useState(false)
  const [theme, setTheme] = React.useState('dark')
  const timeoutRef = React.useRef(null)
  React.useEffect(() => {
    // The theme is now set by ThemeScript, so we just read the current theme from
    // the DOM to ensure the toggle button's state is in sync.
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(currentTheme);
    if (typeof onThemeChange === 'function') {
      onThemeChange(currentTheme);
    }
    setReady(true);
  }, [onThemeChange])
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
    if (typeof onThemeChange === 'function') {
      onThemeChange(next)
    }
    document.documentElement.classList.add('theme-switching')
    window.clearTimeout(timeoutRef.current || undefined)
    timeoutRef.current = window.setTimeout(() => {
      document.documentElement.classList.remove('theme-switching')
    }, 900)
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
