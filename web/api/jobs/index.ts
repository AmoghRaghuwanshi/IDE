import type { IncomingMessage, ServerResponse } from 'http'
import { validateJobRequest } from '../../server/validation'
import { jobStore } from '../../server/jobStore'
import { runJob } from '../../server/runner'
import { executionLimiter } from '../../server/rateLimit'
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
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
    return
  }

  const sessionId = getOrCreateSessionId(req, res)
  if (!executionLimiter.consume(sessionId)) {
    res.statusCode = 429
    res.end(JSON.stringify({ success: false, error: 'Execution limit exceeded. Please wait a moment.' }))
    return
  }

  const body = await parseBody(req)
  const validation = validateJobRequest(body)
  if (!validation.valid || !validation.data) {
    res.statusCode = 400
    res.end(JSON.stringify({ success: false, error: validation.error }))
    return
  }

  const job = jobStore.create(sessionId, validation.data)

  // Start job execution asynchronously
  runJob(job.id).catch(err => {
    jobStore.setStatus(job.id, 'error', 1, err.message)
    jobStore.appendEvent(job.id, 'error', `Uncaught runner error: ${err.message}\n`)
  })

  res.statusCode = 201
  res.end(JSON.stringify({
    success: true,
    jobId: job.id,
    status: job.status
  }))
}
