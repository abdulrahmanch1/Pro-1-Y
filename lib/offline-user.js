import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

const COOKIE_NAME = 'subtitle-offline-user'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // سنة كاملة

const buildCookieOptions = () => ({
  path: '/',
  httpOnly: false,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: COOKIE_MAX_AGE,
})

export const ensureOfflineUser = () => {
  const cookieStore = cookies()
  const existing = cookieStore.get(COOKIE_NAME)?.value
  if (existing) {
    return { id: existing, isNew: false }
  }
  const id = `offline-${randomUUID()}`
  return { id, isNew: true }
}

export const readOfflineUser = () => {
  const value = cookies().get(COOKIE_NAME)?.value
  return value ? { id: value } : null
}

export const persistOfflineUserCookie = (response, offlineUser) => {
  if (!offlineUser || !offlineUser.isNew) return response
  response.cookies.set(COOKIE_NAME, offlineUser.id, buildCookieOptions())
  return response
}
