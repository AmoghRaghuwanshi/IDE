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
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
    return
  }

  const jobId = extractJobId(req)
  const sessionId = getOrCreateSessionId(req, res)

  try {
    const job = jobStore.get(jobId, sessionId)
    if (!job) {
      res.statusCode = 404
      res.end(JSON.stringify({ success: false, error: 'Job not found' }))
      return
    }

    if (job.status !== 'running') {
      res.statusCode = 400
      res.end(JSON.stringify({ success: false, error: `Cannot send input to job in '${job.status}' status.` }))
      return
    }

    const body = await parseBody(req)
    const data = typeof body.data === 'string' ? body.data : ''
    if (job.runnerHandle) {
      job.runnerHandle.writeStdin(data)
    }

    res.statusCode = 200
    res.end(JSON.stringify({ success: true }))
  } catch (err: any) {
    res.statusCode = err.statusCode || 500
    res.end(JSON.stringify({ success: false, error: err.message }))
  }
}
