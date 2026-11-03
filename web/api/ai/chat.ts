import type { IncomingMessage, ServerResponse } from 'http'

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
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gemini-api-key')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
    return
  }

  const body = await parseBody(req)
  const prompt = body.prompt || ''
  if (!prompt || typeof prompt !== 'string') {
    res.statusCode = 400
    res.end(JSON.stringify({ success: false, error: 'Prompt is required.' }))
    return
  }

  const apiKey = (req.headers['x-gemini-api-key'] as string) || body.apiKey || process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.statusCode = 400
    res.end(JSON.stringify({
      success: false,
      error: 'No Gemini API key provided. Please configure your API key in the AI Keys menu.'
    }))
    return
  }

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
      })
    })

    const data = await geminiRes.json()
    if (!geminiRes.ok) {
      res.statusCode = geminiRes.status
      res.end(JSON.stringify({ success: false, error: data.error?.message || 'Gemini API error' }))
      return
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    res.statusCode = 200
    res.end(JSON.stringify({ success: true, text }))
  } catch (err: any) {
    res.statusCode = 500
    res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }))
  }
}
