import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'

export const SESSION_COOKIE_NAME = 'cf_session'

export function getOrCreateSessionId(req: IncomingMessage, res?: ServerResponse): string {
  const cookieHeader = req.headers.cookie || ''
  const cookies = parseCookies(cookieHeader)
  let sessionId = cookies[SESSION_COOKIE_NAME]

  if (!sessionId || sessionId.length < 16) {
    sessionId = randomUUID()
    if (res && !res.headersSent) {
      const isProd = process.env.NODE_ENV === 'production'
      const cookieValue = `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${isProd ? '; Secure' : ''}`
      res.setHeader('Set-Cookie', cookieValue)
    }
  }

  return sessionId
}

export function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  const pairs = header.split(';')
  for (const pair of pairs) {
    const idx = pair.indexOf('=')
    if (idx > 0) {
      const key = pair.slice(0, idx).trim()
      const val = pair.slice(idx + 1).trim()
      result[key] = decodeURIComponent(val)
    }
  }
  return result
}
