import type { IncomingMessage, ServerResponse } from 'http'
import { buildChatPrompt, askGemini } from '../../server/gemini'
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
    res.end(JSON.stringify({ success: false, error: 'AI request limit reached. Please wait a minute.' }))
    return
  }

  const body = await parseBody(req)
  const prompt = body.prompt || ''
  if (!prompt || typeof prompt !== 'string') {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: false, error: 'Prompt is required.' }))
    return
  }

  const fullPrompt = buildChatPrompt(prompt, body.context)
  const result = await askGemini(fullPrompt)

  res.statusCode = result.success ? 200 : 500
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(result))
}
