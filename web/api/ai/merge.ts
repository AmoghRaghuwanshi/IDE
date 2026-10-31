import type { IncomingMessage, ServerResponse } from 'http'
import { mergeCodeSuggestion } from '../../server/gemini'
import { aiLimiter } from '../../server/rateLimit'
import { getOrCreateSessionId } from '../../server/auth'

async function parseBody(req: IncomingMessage): Promise<any> {
  if ((req as any).body) return (req as any).body
  return new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
    })
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
    return
  }

  const sessionId = getOrCreateSessionId(req, res)
  if (!aiLimiter.consume(sessionId)) {
    res.statusCode = 429
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: false, error: 'AI rate limit exceeded.' }))
    return
  }

  const body = await parseBody(req)
  const { currentContent, snippet, language } = body

  if (!currentContent || !snippet) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: false, error: 'currentContent and snippet are required.' }))
    return
  }

  const result = await mergeCodeSuggestion({
    currentContent,
    snippet,
    language: language || 'plaintext'
  })

  res.statusCode = result.success ? 200 : 500
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(result))
}
