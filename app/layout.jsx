import './globals.css'
import React from 'react'
import SiteHeader from '../components/SiteHeader'
import ThemeDock from '../components/ThemeDock'

export const metadata = {
  title: 'Subtitle AI — Clean up SRT/VTT with AI',
  description: 'Upload SRT/VTT, review AI suggestions, accept or edit, and download polished captions.',
}

// ThemeToggle moved to a dedicated client component

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark">
      <body>
        <div className="page-frame">
          <SiteHeader />
          <main className="container">{children}</main>
          <footer className="container footer">
            <div className="flex-between">
              <span>&copy; {new Date().getFullYear()} Subtitle AI. Crafted for creators.</span>
              <div className="pill-row">
                <a href="#">Privacy</a>
                <a href="#">Terms</a>
                <a href="#">Support</a>
              </div>
            </div>
          </footer>
        </div>
        <ThemeDock />
      </body>
    </html>
  )
}
