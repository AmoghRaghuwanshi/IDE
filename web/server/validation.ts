import type { LanguageId } from '../src/shared/types'

export const MAX_SOURCE_BYTES = 200 * 1024 // 200 KB
export const MAX_STDIN_BYTES = 64 * 1024   // 64 KB
export const MAX_OUTPUT_BYTES = 250 * 1024  // 250 KB
export const MAX_TRACE_STEPS = 2000

const ALLOWED_LANGUAGES: Set<string> = new Set(['c', 'cpp', 'python'])
const ALLOWED_CPP_STANDARDS: Set<string> = new Set(['c++11', 'c++14', 'c++17', 'c++20'])

export function sanitizeSourceName(name: string, language: LanguageId): string {
  const base = name.replace(/[^a-zA-Z0-9_.-]/g, '_')
  const clean = base.replace(/^\.+/, '') || 'main'
  if (language === 'python' && !clean.endsWith('.py')) return `${clean}.py`
  if (language === 'c' && !clean.endsWith('.c')) return `${clean}.c`
  if (language === 'cpp' && !clean.endsWith('.cpp')) return `${clean}.cpp`
  return clean
}

export function validateJobRequest(body: any): { valid: boolean; error?: string; data?: any } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.' }
  }

  const { language, sourceName, sourceCode, cppStandard, mode, stdin } = body

  if (!language || !ALLOWED_LANGUAGES.has(language)) {
    return { valid: false, error: `Invalid language '${language}'. Supported: c, cpp, python.` }
  }

  if (typeof sourceCode !== 'string' || sourceCode.length === 0) {
    return { valid: false, error: 'Source code must be a non-empty string.' }
  }

  if (Buffer.byteLength(sourceCode, 'utf-8') > MAX_SOURCE_BYTES) {
    return { valid: false, error: `Source code exceeds maximum allowed size of ${MAX_SOURCE_BYTES / 1024}KB.` }
  }

  if (stdin !== undefined && (typeof stdin !== 'string' || Buffer.byteLength(stdin, 'utf-8') > MAX_STDIN_BYTES)) {
    return { valid: false, error: `Standard input exceeds maximum allowed size of ${MAX_STDIN_BYTES / 1024}KB.` }
  }

  if (cppStandard && !ALLOWED_CPP_STANDARDS.has(cppStandard)) {
    return { valid: false, error: `Unsupported C++ standard '${cppStandard}'. Supported: c++11, c++14, c++17, c++20.` }
  }

  const cleanMode = mode === 'trace' ? 'trace' : 'run'
  const cleanName = sanitizeSourceName(typeof sourceName === 'string' ? sourceName : 'main', language)

  return {
    valid: true,
    data: {
      language: language as LanguageId,
      sourceName: cleanName,
      sourceCode,
      cppStandard: cppStandard || 'c++17',
      mode: cleanMode,
      stdin: typeof stdin === 'string' ? stdin : ''
    }
  }
}
