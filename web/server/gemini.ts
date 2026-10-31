// ============================================================================
// Server-Side Gemini AI Service
// Keeps API keys strictly confidential on the server.
// ============================================================================

import type { LanguageId } from '../src/shared/types'

const GEMINI_REQUEST_TIMEOUT_MS = 25_000

export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY || ''
  return key.trim().length > 0 ? key.trim() : null
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash'
}

function cleanModelCode(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  const fenced = text.match(/^```(?:[\w+#.-]+)?\s*\r?\n([\s\S]*?)\r?\n```$/)
  return (fenced ? fenced[1] : text).trim()
}

export interface ChatContext {
  fileName?: string
  language?: LanguageId
  sourceCode?: string
  line?: number
  error?: string
  output?: string
}

export function buildChatPrompt(userPrompt: string, context?: ChatContext): string {
  if (!context) return userPrompt

  const parts: string[] = []
  parts.push(`You are an encouraging, beginner-friendly coding assistant for students learning ${context.language ? context.language.toUpperCase() : 'programming'}.`)
  parts.push(`Give concise, clear answers in plain English. Avoid overwhelming jargon.\n`)

  if (context.fileName) {
    parts.push(`Active File: ${context.fileName} (${context.language || 'plaintext'})`)
  }

  if (context.sourceCode) {
    const lines = context.sourceCode.split(/\r?\n/)
    // If a specific line is highlighted, include surrounding 25 lines
    if (context.line && context.line > 0 && context.line <= lines.length) {
      const start = Math.max(0, context.line - 25)
      const end = Math.min(lines.length, context.line + 25)
      const snippet = lines.slice(start, end).map((l, i) => `${start + i + 1} | ${l}`).join('\n')
      parts.push(`Relevant Code Section (lines ${start + 1}-${end}):\n\`\`\`\n${snippet}\n\`\`\``)
    } else {
      // Default to first 150 lines
      const snippet = lines.slice(0, 150).map((l, i) => `${i + 1} | ${l}`).join('\n')
      parts.push(`Current Code (first ${Math.min(lines.length, 150)} lines):\n\`\`\`\n${snippet}\n\`\`\``)
    }
  }

  if (context.error) {
    parts.push(`Compiler Diagnostic / Runtime Error:\n${context.error}`)
  }

  if (context.output) {
    const truncatedOutput = context.output.slice(-1000)
    parts.push(`Program Terminal Output (last 1000 chars):\n${truncatedOutput}`)
  }

  parts.push(`Student Question: ${userPrompt}`)
  return parts.join('\n\n')
}

export async function askGemini(prompt: string): Promise<{ success: boolean; text?: string; error?: string }> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    return {
      success: false,
      error: 'Gemini AI key is not configured on this server. Code execution, debugging, and visualization are fully functional without it.'
    }
  }

  const modelName = getGeminiModel()
  try {
    const { GoogleGenAI } = await import('@google/genai')
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS }
    })

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })

    const reply = response.text || ''
    return { success: true, text: reply }
  } catch (err: any) {
    const msg = err.message || String(err)
    if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
      return { success: false, error: 'Gemini request rate limit reached. Please wait a moment before trying again.' }
    }
    if (/404|NOT_FOUND|not supported/i.test(msg)) {
      return { success: false, error: `Configured Gemini model (${modelName}) was not found or is unavailable.` }
    }
    if (/deadline|timed out|timeout/i.test(msg)) {
      return { success: false, error: 'The AI request timed out. Please try asking a shorter question.' }
    }
    return { success: false, error: `AI request failed: ${msg}` }
  }
}

export async function mergeCodeSuggestion(args: {
  currentContent: string
  snippet: string
  language: string
}): Promise<{ success: boolean; mergedContent?: string; error?: string }> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    return { success: false, error: 'AI key not configured on server.' }
  }

  const prompt = `You are a precision code editor. A student is working on a ${args.language} program.
Merge the suggested code snippet into the current file.
Return the COMPLETE, updated program with the changes correctly integrated.
Do not omit existing code with comments like "...rest of code...".
Output ONLY the final merged code inside a single \`\`\` code block. No explanations, greetings, or conversational remarks.

Current File:
\`\`\`${args.language}
${args.currentContent}
\`\`\`

Suggested Snippet to Integrate:
\`\`\`${args.language}
${args.snippet}
\`\`\`
`

  const res = await askGemini(prompt)
  if (!res.success || !res.text) {
    return { success: false, error: res.error || 'Failed to merge code' }
  }

  const merged = cleanModelCode(res.text)
  return { success: true, mergedContent: merged }
}
