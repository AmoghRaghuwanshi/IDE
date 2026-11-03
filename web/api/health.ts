import type { IncomingMessage, ServerResponse } from 'http'

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const response = {
    status: 'healthy',
    timestamp: Date.now(),
    keepAlive: true,
    aiConfigured: true,
    toolchains: {
      c: {
        language: 'c',
        available: true,
        path: 'cloud-runner (GCC 13/14)',
        version: 'GCC 13/14 (C11/C17)'
      },
      cpp: {
        language: 'cpp',
        available: true,
        path: 'cloud-runner (G++ 13/14)',
        version: 'G++ 13/14 (C++17/C++20)'
      },
      python: {
        language: 'python',
        available: true,
        path: 'cloud-runner (CPython 3.12)',
        version: 'Python 3.12'
      }
    }
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.statusCode = 200
  res.end(JSON.stringify(response))
}
