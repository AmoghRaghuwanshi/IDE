import type { IncomingMessage, ServerResponse } from 'http'
import healthHandler from '../api/health'
import aiChatHandler from '../api/ai/chat'
import aiMergeHandler from '../api/ai/merge'
import jobsHandler from '../api/jobs/index'
import jobGetHandler from '../api/jobs/[id]/index'
import jobInputHandler from '../api/jobs/[id]/input'
import jobEventsHandler from '../api/jobs/[id]/events'
import jobTraceHandler from '../api/jobs/[id]/trace'
import jobCancelHandler from '../api/jobs/[id]/cancel'

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url || '').split('?')[0]
  if (!url.startsWith('/api/')) return false

  try {
    if (url === '/api/health') {
      healthHandler(req, res)
      return true
    }
    if (url === '/api/ai/chat') {
      await aiChatHandler(req, res)
      return true
    }
    if (url === '/api/ai/merge') {
      await aiMergeHandler(req, res)
      return true
    }
    if (url === '/api/jobs' || url === '/api/jobs/') {
      await jobsHandler(req, res)
      return true
    }

    const match = url.match(/^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/)
    if (match) {
      const [, jobId, subAction] = match
      ;(req as any).query = { ...((req as any).query || {}), id: jobId }
      if (!subAction) {
        jobGetHandler(req, res)
        return true
      }
      if (subAction === 'input') {
        await jobInputHandler(req, res)
        return true
      }
      if (subAction === 'events') {
        jobEventsHandler(req, res)
        return true
      }
      if (subAction === 'trace') {
        jobTraceHandler(req, res)
        return true
      }
      if (subAction === 'cancel') {
        jobCancelHandler(req, res)
        return true
      }
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: false, error: 'API route not found' }))
    return true
  } catch (err: any) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }))
    return true
  }
}
