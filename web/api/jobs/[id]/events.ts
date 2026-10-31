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

  const url = new URL(req.url || '', 'http://localhost')
  const afterCursor = parseInt(url.searchParams.get('after') || '0', 10) || 0

  try {
    const job = jobStore.get(jobId, sessionId)
    if (!job) {
      res.statusCode = 404
      res.end(JSON.stringify({ success: false, error: 'Job not found' }))
      return
    }

    const filtered = job.events.filter(e => e.cursor > afterCursor)
    const nextCursor = filtered.length > 0 ? filtered[filtered.length - 1].cursor : afterCursor
    const isRunning = job.status === 'running' || job.status === 'compiling' || job.status === 'queued'

    res.statusCode = 200
    res.end(JSON.stringify({
      events: filtered,
      nextCursor,
      isRunning,
      status: job.status,
      exitCode: job.exitCode
    }))
  } catch (err: any) {
    res.statusCode = err.statusCode || 500
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
}
