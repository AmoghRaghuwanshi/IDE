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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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
  const { language, sourceCode, sourceName, mode, stdin } = body

  if (!sourceCode || typeof sourceCode !== 'string') {
    res.statusCode = 400
    res.end(JSON.stringify({ success: false, error: 'sourceCode is required.' }))
    return
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Forward execution to Wandbox cloud runner
  try {
    const compiler =
      language === 'c' ? 'gcc-head-c' : language === 'cpp' ? 'gcc-head' : 'cpython-3.12.7'
    const options = language === 'cpp' ? 'warning,c++20' : language === 'c' ? 'warning,c11' : ''

    const wandboxRes = await fetch('https://wandbox.org/api/compile.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler,
        code: sourceCode,
        stdin: stdin || '',
        options
      })
    })

    const data = await wandboxRes.json()

    res.statusCode = 200
    res.end(JSON.stringify({
      success: true,
      jobId,
      status: data.status === '0' ? 'exited' : 'error',
      compiler_error: data.compiler_error,
      program_output: data.program_output,
      program_error: data.program_error,
      exitCode: parseInt(data.status || '0', 10)
    }))
  } catch (err: any) {
    res.statusCode = 200
    res.end(JSON.stringify({
      success: false,
      jobId,
      error: err.message || 'Execution failed'
    }))
  }
}
