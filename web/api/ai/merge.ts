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
  const { currentContent, snippet, language } = body

  if (!currentContent || !snippet) {
    res.statusCode = 400
    res.end(JSON.stringify({ success: false, error: 'currentContent and snippet are required.' }))
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

  const prompt = `You are a source code merging assistant.
Given the original source code and a suggested replacement snippet, produce the complete, updated source file with the snippet accurately merged.

Rules:
1. Return ONLY the complete updated source code inside a single markdown code block (e.g. \`\`\`${language} ... \`\`\`).
2. Do not include any explanations, greetings, or conversational text.
3. Preserve all surrounding code, includes, and structure that does not need changing.

Original Code:
\`\`\`${language}
${currentContent}
\`\`\`

Suggested Snippet / Fix:
\`\`\`${language}
${snippet}
\`\`\`
`

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
      })
    })

    const data = await geminiRes.json()
    if (!geminiRes.ok) {
      res.statusCode = geminiRes.status
      res.end(JSON.stringify({ success: false, error: data.error?.message || 'Gemini API error' }))
      return
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const codeMatch = text.match(/```(?:\w+)?\s*\n([\s\S]*?)```/)
    const mergedContent = codeMatch ? codeMatch[1].trim() : text.trim()

    res.statusCode = 200
    res.end(JSON.stringify({ success: true, mergedContent }))
  } catch (err: any) {
    res.statusCode = 500
    res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }))
  }
}
