'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ThemeToggle from './ThemeToggle'

export default function ThemeDock() {
  const [mounted, setMounted] = useState(false)
  const [portalNode, setPortalNode] = useState(null)
  const [theme, setTheme] = useState('dark')
  const [themeReady, setThemeReady] = useState(false)

  useEffect(() => {
    setPortalNode(document.body)
    setMounted(true)
  }, [])

  const handleThemeChange = (value) => {
    setTheme(value)
    setThemeReady(true)
  }

  const modeLabel = themeReady ? (theme === 'dark' ? 'Dark mode' : 'Light mode') : 'Loading…'

  if (!mounted || !portalNode) return null

  return createPortal(
    <div className="theme-toggle-dock" role="complementary" aria-label="Theme switcher">
      <div className="theme-toggle-dock__text" aria-hidden={!themeReady}>
        <span className="theme-toggle-dock__label">Theme</span>
        <span className="theme-toggle-dock__mode">{modeLabel}</span>
      </div>
      <ThemeToggle onThemeChange={handleThemeChange} />
    </div>,
    portalNode
  )
}
