import { Suspense } from 'react'
import SignInClient from './SignInClient'

export const metadata = { title: 'Sign in — Subtitle AI' }

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInClient />
    </Suspense>
  )
}