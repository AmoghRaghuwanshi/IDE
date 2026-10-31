// ============================================================================
// GCC/G++ Error Parser
// ============================================================================

import type { NormalizedError, LanguageId } from '../../shared/types'
import { getOfflineExplanation } from './OfflineAssistant'

/**
 * Parses GCC/G++ (and Clang-compatible) error output into normalized errors.
 *
 * Standard GCC format: path/to/file.c:12:5: error: expected ';' before 'return'
 * Also handles multi-line notes and "In function '...'" context lines.
 */
export function parseGccErrors(
  stderr: string,
  language: LanguageId,
  options?: { sourceName?: string }
): NormalizedError[] {
  if (!stderr || stderr.trim().length === 0) return []

  const errors: NormalizedError[] = []
  const lines = stderr.split(/\r?\n/)

  // Main error/warning/note pattern
  const mainPattern = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/
  // Function context pattern
  const funcPattern = /^(.+?):\s+In function\s+'(.+?)':/
  // Linker error pattern
  const linkerPattern = /^(.+?):?\s*undefined reference to\s+'(.+?)'/

  let currentFunction: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Check for function context
    const funcMatch = funcPattern.exec(line)
    if (funcMatch) {
      currentFunction = funcMatch[2]
      continue
    }

    // Check for main error/warning/note
    const mainMatch = mainPattern.exec(line)
    if (mainMatch) {
      const [, file, lineNum, colNum, severity, message] = mainMatch
      const rawMessage = message.trim()
      const simplified = getOfflineExplanation(rawMessage, language)

      errors.push({
        language,
        severity: severity as 'error' | 'warning' | 'note',
        file: file.trim(),
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
        functionContext: currentFunction,
        rawMessage,
        simplifiedMessage: simplified
      })
      continue
    }

    // Check for linker errors
    const linkerMatch = linkerPattern.exec(line)
    if (linkerMatch) {
      errors.push({
        language,
        severity: 'error',
        file: linkerMatch[1].trim(),
        line: 0,
        column: null,
        functionContext: null,
        rawMessage: `undefined reference to '${linkerMatch[2]}'`,
        simplifiedMessage: `The function or variable '${linkerMatch[2]}' is used but not defined. Check that you've included the right file or library.`
      })
    }
  }

  // Filter out noisy standard library errors if sourceName is provided
  return errors.filter(e => {
    // If we have a sourceName, ensure the error comes from our source file.
    // Also explicitly ignore common MSYS2/GCC standard library paths.
    const isStdLib = e.file.includes('msys64') || e.file.includes('ucrt64') || e.file.includes('mingw64') || e.file.includes('c++')
    
    if (options?.sourceName) {
      if (e.file.endsWith(options.sourceName) && !isStdLib) {
        return true
      }
      return false
    }
    
    // If no sourceName, at least filter out the standard library noise
    return !isStdLib
  })
}
