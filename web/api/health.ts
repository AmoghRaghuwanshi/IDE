import type { IncomingMessage, ServerResponse } from 'http'
import { resolveToolchain } from '../server/runner'
import { getGeminiApiKey } from '../server/gemini'

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const toolchain = resolveToolchain()
  const apiKey = getGeminiApiKey()

  const response = {
    status: 'healthy',
    timestamp: Date.now(),
    aiConfigured: !!apiKey,
    toolchains: {
      c: {
        language: 'c',
        available: !!toolchain.gcc,
        path: toolchain.gcc,
        version: toolchain.gcc ? 'GCC (C11/C17)' : null
      },
      cpp: {
        language: 'cpp',
        available: !!toolchain.gpp,
        path: toolchain.gpp,
        version: toolchain.gpp ? 'G++ (C++17/C++20)' : null
      },
      python: {
        language: 'python',
        available: true,
        path: toolchain.python,
        version: 'Python 3'
      }
    }
  }

  res.setHeader('Content-Type', 'application/json')
  res.statusCode = 200
  res.end(JSON.stringify(response))
}
