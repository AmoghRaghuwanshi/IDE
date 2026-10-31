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
  const jobId = extractJobId(req)
  const sessionId = getOrCreateSessionId(req, res)

  try {
    const job = jobStore.get(jobId, sessionId)
    if (!job) {
      res.statusCode = 404
      res.end(JSON.stringify({ success: false, error: 'Job not found' }))
      return
    }

    if (job.status === 'running' || job.status === 'queued') {
      res.statusCode = 202
      res.end(JSON.stringify({ success: false, error: 'Trace is still in progress.' }))
      return
    }

    if (!job.trace || job.trace.length === 0) {
      res.statusCode = 200
      res.end(JSON.stringify({
        success: false,
        error: job.error || 'No execution trace steps were captured for this program.'
      }))
      return
    }

    res.statusCode = 200
    res.end(JSON.stringify({
      success: true,
      trace: job.trace
    }))
  } catch (err: any) {
    res.statusCode = err.statusCode || 500
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
}
