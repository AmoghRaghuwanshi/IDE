import type { IncomingMessage, ServerResponse } from 'http'
import { jobStore } from '../../../server/jobStore'
import { getOrCreateSessionId } from '../../../server/auth'

function extractJobId(req: IncomingMessage): string {
  const queryId = (req as any).query?.id
  if (queryId) return String(queryId)
  const parts = (req.url || '').split('?')[0].split('/')
  const idx = parts.indexOf('jobs')
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : ''
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
    return
  }

  const jobId = extractJobId(req)
  const sessionId = getOrCreateSessionId(req, res)

  try {
    const success = jobStore.cancel(jobId, sessionId)
    res.statusCode = success ? 200 : 404
    res.end(JSON.stringify({ success }))
  } catch (err: any) {
    res.statusCode = err.statusCode || 500
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
}
