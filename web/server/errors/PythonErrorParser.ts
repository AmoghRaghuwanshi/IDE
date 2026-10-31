// ============================================================================
// Python Error Parser
// ============================================================================

import type { NormalizedError } from '../../src/shared/types'
import { getOfflineExplanation } from './OfflineAssistant'

/**
 * Parses Python tracebacks into normalized errors.
 *
 * Python tracebacks are multi-line. The actionable info is:
 * - The last `File "...", line N` frame (innermost in user's file)
 * - The final exception line (SyntaxError, NameError, etc.)
 */
export function parsePythonErrors(stderr: string): NormalizedError[] {
  if (!stderr || stderr.trim().length === 0) return []

  const errors: NormalizedError[] = []
  const lines = stderr.split(/\r?\n/)

  // SyntaxError format: File "main.py", line 5
  const fileLinePattern = /^\s*File\s+"(.+?)",\s+line\s+(\d+)/
  // Exception line: ExceptionType: message
  const exceptionPattern = /^(\w+(?:Error|Exception|Warning)):\s*(.*)$/

  let lastFile: string | null = null
  let lastLine: number | null = null
  let lastColumn: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track file/line references
    const fileMatch = fileLinePattern.exec(line)
    if (fileMatch) {
      lastFile = fileMatch[1]
      lastLine = parseInt(fileMatch[2], 10)
      lastColumn = null

      // Check if next line has a caret (^) indicator for column
      if (i + 2 < lines.length && lines[i + 2].trim().startsWith('^')) {
        const caretLine = lines[i + 2]
        lastColumn = caretLine.indexOf('^') + 1
      }
      continue
    }

    // Check for exception lines
    const exceptionMatch = exceptionPattern.exec(line.trim())
    if (exceptionMatch) {
      const [, exceptionType, message] = exceptionMatch
      const rawMessage = `${exceptionType}: ${message}`
      const simplified = getOfflineExplanation(rawMessage, 'python')

      if (lastFile && lastLine !== null) {
        errors.push({
          language: 'python',
          severity: 'error',
          file: lastFile,
          line: lastLine,
          column: lastColumn,
          functionContext: null,
          rawMessage,
          simplifiedMessage: simplified
        })
      } else {
        // No file context found — still report the error
        errors.push({
          language: 'python',
          severity: 'error',
          file: '<unknown>',
          line: 1,
          column: null,
          functionContext: null,
          rawMessage,
          simplifiedMessage: simplified
        })
      }
    }
  }

  // If no errors were extracted but there's content, it might be a simple
  // SyntaxError at import time or a single-line error
  if (errors.length === 0 && stderr.trim().length > 0) {
    // Try to find any SyntaxError or similar at the end
    const lastNonEmpty = lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .pop()
    if (lastNonEmpty) {
      const match = exceptionPattern.exec(lastNonEmpty)
      if (match) {
        errors.push({
          language: 'python',
          severity: 'error',
          file: '<unknown>',
          line: 1,
          column: null,
          functionContext: null,
          rawMessage: lastNonEmpty,
          simplifiedMessage: getOfflineExplanation(lastNonEmpty, 'python')
        })
      }
    }
  }

  return errors
}
