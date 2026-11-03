// ============================================================================
// Remote API Adapter — Direct Cloud Execution, Trace Visualizer & Gemini BYOK
// ============================================================================

import type { IPlatformAdapter, FileDraft } from './types'
import { BrowserStorage, exportFileToDisk, promptLocalFile } from './browserAdapter'
import type { LanguageId, ToolchainStatus, NormalizedError, JobExecutionEvent } from '../shared/types'
import type { NormalizedVisualizerStep } from '../shared/visualizer'
import { parseGccErrors, parsePythonErrors } from '../shared/errorParsers'
import { normalizeVisualizationTrace } from '../shared/traceNormalizer'
import { useAiKeyStore } from '../state/aiKeyStore'
import { useAdminStore } from '../state/adminStore'

interface ActiveCloudJob {
  id: string
  language: LanguageId
  sourceName: string
  sourceCode: string
  mode: 'run' | 'trace'
  status: 'compiling' | 'running' | 'exited' | 'error'
  events: JobExecutionEvent[]
  exitCode?: number
  errors?: NormalizedError[]
  trace?: NormalizedVisualizerStep[]
  cancelled: boolean
  cursorCounter: number
}

// Safely parse JSON from fetch responses without crashing on HTML or plain-text error pages
async function safeParseResponse(res: Response): Promise<{ ok: boolean; data: any; rawText: string }> {
  try {
    const rawText = await res.text()
    try {
      const data = JSON.parse(rawText)
      return { ok: res.ok, data, rawText }
    } catch {
      return { ok: false, data: null, rawText }
    }
  } catch (err: any) {
    return { ok: false, data: null, rawText: err.message || 'Network error' }
  }
}

export class RemotePlatformAdapter implements IPlatformAdapter {
  private apiBase: string
  private activeJobs = new Map<string, ActiveCloudJob>()

  constructor(apiBase = '') {
    this.apiBase = apiBase
  }

  // File persistence & drafts
  async saveDraft(draft: FileDraft): Promise<void> {
    await BrowserStorage.saveDraft(draft)
  }

  async removeDraft(fileId: string): Promise<void> {
    await BrowserStorage.removeDraft(fileId)
  }

  async loadAllDrafts(): Promise<FileDraft[]> {
    return await BrowserStorage.loadAllDrafts()
  }

  async exportFile(name: string, content: string): Promise<{ success: boolean; name?: string; error?: string }> {
    return await exportFileToDisk(name, content)
  }

  async openLocalFile(): Promise<{ success: boolean; name?: string; content?: string; language?: LanguageId; error?: string }> {
    return await promptLocalFile()
  }

  async openLocalFolder(): Promise<{ success: boolean; files?: Array<{ name: string; content: string; language: LanguageId }>; error?: string }> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      ;(input as any).webkitdirectory = true
      input.style.display = 'none'

      input.onchange = async () => {
        const fileList = input.files
        if (!fileList || fileList.length === 0) {
          resolve({ success: false })
          return
        }
        const files: Array<{ name: string; content: string; language: LanguageId }> = []
        for (let i = 0; i < fileList.length; i++) {
          const f = fileList[i]
          const ext = f.name.split('.').pop()?.toLowerCase()
          if (['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'py'].includes(ext || '')) {
            try {
              const text = await f.text()
              const lang: LanguageId = ext === 'c' ? 'c' : ext === 'py' ? 'python' : 'cpp'
              files.push({ name: f.name, content: text, language: lang })
            } catch {
              /* ignore unreadable file */
            }
          }
        }
        resolve({ success: true, files })
        document.body.removeChild(input)
      }

      input.oncancel = () => {
        resolve({ success: false })
        document.body.removeChild(input)
      }

      document.body.appendChild(input)
      input.click()
    })
  }

  // Toolchain detection
  async detectToolchain(): Promise<Record<LanguageId, ToolchainStatus>> {
    return {
      c: { language: 'c', available: true, path: 'cloud-runner (GCC 14)', version: 'GCC (C11/C17)' },
      cpp: { language: 'cpp', available: true, path: 'cloud-runner (G++ 14)', version: 'G++ (C++17/C++20)' },
      python: { language: 'python', available: true, path: 'cloud-runner (Python 3.12)', version: 'Python 3.12' }
    }
  }

  // Helper to push execution events to a job
  private pushEvent(job: ActiveCloudJob, type: 'stdout' | 'stderr' | 'status' | 'exit' | 'error', data: string): void {
    job.cursorCounter++
    job.events.push({
      cursor: job.cursorCounter,
      type,
      data
    })
  }

  // Job creation (Run / Trace) via Cloud Runner
  async createJob(args: {
    language: LanguageId
    sourceName: string
    sourceCode: string
    cppStandard?: string
    mode: 'run' | 'trace'
    stdin?: string
  }): Promise<{ success: boolean; jobId?: string; errors?: NormalizedError[]; error?: string }> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    
    const job: ActiveCloudJob = {
      id: jobId,
      language: args.language,
      sourceName: args.sourceName,
      sourceCode: args.sourceCode,
      mode: args.mode,
      status: 'compiling',
      events: [],
      cursorCounter: 0,
      cancelled: false
    }

    this.activeJobs.set(jobId, job)

    if (args.mode === 'trace') {
      // Execute trace recording asynchronously
      this.executeTraceJob(job, args).catch((err) => {
        this.pushEvent(job, 'error', `\r\nTrace generation error: ${err.message}\r\n`)
        job.status = 'error'
      })

      return {
        success: true,
        jobId
      }
    }

    // mode === 'run'
    this.pushEvent(job, 'status', `\x1b[36m[Compiling & running ${args.sourceName} (${args.language.toUpperCase()})...]\x1b[0m\r\n`)

    // Start execution asynchronously
    this.executeRunJob(job, args)

    return {
      success: true,
      jobId
    }
  }

  // Cloud execution runner for Run mode
  private async executeRunJob(
    job: ActiveCloudJob,
    args: { language: LanguageId; sourceName: string; sourceCode: string; stdin?: string }
  ): Promise<void> {
    try {
      const compiler =
        args.language === 'c'
          ? 'gcc-head-c'
          : args.language === 'cpp'
          ? 'gcc-head'
          : 'cpython-3.12.7'

      const options =
        args.language === 'cpp'
          ? 'warning,c++20'
          : args.language === 'c'
          ? 'warning,c11'
          : ''

      job.status = 'running'

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 35_000)

      const res = await fetch('https://wandbox.org/api/compile.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiler,
          code: args.sourceCode,
          stdin: args.stdin || '',
          options
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (job.cancelled) return

      const parsed = await safeParseResponse(res)
      if (!parsed.ok || !parsed.data) {
        job.status = 'error'
        job.exitCode = 1
        const errMsg = parsed.rawText.slice(0, 300) || `Runner returned HTTP ${res.status}`
        this.pushEvent(job, 'error', `\r\n\x1b[31m[Execution error: ${errMsg}]\x1b[0m\r\n`)
        return
      }

      const data = parsed.data

      // Check for C/C++ compiler errors
      if (args.language !== 'python' && data.compiler_error && data.status !== '0') {
        const gccErrors = parseGccErrors(data.compiler_error, args.language)
        job.errors = gccErrors
        job.status = 'error'
        job.exitCode = 1

        this.pushEvent(job, 'error', `\x1b[31m${data.compiler_error}\x1b[0m\r\n`)
        this.pushEvent(job, 'status', `\r\n\x1b[90m[Compilation failed with exit code 1]\x1b[0m\r\n`)
        return
      }

      // Check compiler warnings (if compiled successfully)
      if (data.compiler_error) {
        this.pushEvent(job, 'stdout', `\x1b[33m${data.compiler_error}\x1b[0m\r\n`)
      }

      // Program stdout
      if (data.program_output) {
        this.pushEvent(job, 'stdout', data.program_output)
      }

      // Program stderr
      if (data.program_error) {
        this.pushEvent(job, 'stderr', data.program_error)

        // Parse Python tracebacks into friendly error items
        if (args.language === 'python' && data.status !== '0') {
          const pyErrors = parsePythonErrors(data.program_error)
          if (pyErrors.length > 0) {
            job.errors = pyErrors
          }
        }
      }

      const exitCode = parseInt(data.status ?? '0', 10) || 0
      job.exitCode = exitCode
      job.status = exitCode === 0 ? 'exited' : 'error'

      this.pushEvent(job, 'status', `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
    } catch (err: any) {
      if (job.cancelled) return
      job.status = 'error'
      job.exitCode = 1
      const isTimeout = err.name === 'AbortError'
      const msg = isTimeout ? 'Execution timed out after 35 seconds.' : err.message || 'Execution failed.'
      this.pushEvent(job, 'error', `\r\n\x1b[31m[Error: ${msg}]\x1b[0m\r\n`)
    }
  }

  // Trace recorder for the Execution Visualizer
  private async executeTraceJob(
    job: ActiveCloudJob,
    args: { language: LanguageId; sourceName: string; sourceCode: string; stdin?: string }
  ): Promise<void> {
    job.status = 'running'

    if (args.language === 'python') {
      // Instrument Python code with sys.settrace to capture exact variable frames
      const tracerScript = `
import sys, json, types

raw_steps = []

def snapshot(frame):
    res = {}
    for k, v in list(frame.f_locals.items()):
        if not k.startswith('__') and not isinstance(v, (types.ModuleType, types.FunctionType, type)):
            try: res[k] = repr(v)[:200]
            except: res[k] = str(v)[:200]
    return res

def trace_calls(frame, event, arg):
    if event == 'line' and frame.f_code.co_filename == 'main.py':
        raw_steps.append({
            'line': frame.f_lineno,
            'function': frame.f_code.co_name,
            'locals': snapshot(frame)
        })
    return trace_calls

user_code = ${JSON.stringify(args.sourceCode)}
compiled = compile(user_code, 'main.py', 'exec')
glob = {'__name__': '__main__'}

sys.settrace(trace_calls)
try:
    exec(compiled, glob)
finally:
    sys.settrace(None)
    print('---TRACE_DATA_START---')
    print(json.dumps(raw_steps))
    print('---TRACE_DATA_END---')
`

      try {
        const res = await fetch('https://wandbox.org/api/compile.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            compiler: 'cpython-3.12.7',
            code: tracerScript,
            stdin: args.stdin || ''
          })
        })

        const parsed = await safeParseResponse(res)
        const stdout = parsed.data?.program_output || ''
        const markerStart = stdout.indexOf('---TRACE_DATA_START---')
        const markerEnd = stdout.indexOf('---TRACE_DATA_END---')

        if (markerStart !== -1 && markerEnd !== -1) {
          const jsonStr = stdout.slice(markerStart + '---TRACE_DATA_START---'.length, markerEnd).trim()
          const rawSteps = JSON.parse(jsonStr)
          job.trace = normalizeVisualizationTrace(rawSteps, args.sourceCode, 'python', args.stdin || '')
        }
      } catch (err: any) {
        console.warn('Python tracing failed:', err)
      }
    }

    // Fallback or C/C++ trace generation
    if (!job.trace || job.trace.length === 0) {
      // Generate step entries from source lines
      const lines = args.sourceCode.split(/\r?\n/)
      const fallbackSteps: Record<string, unknown>[] = []
      
      lines.forEach((line, idx) => {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('/*')) {
          fallbackSteps.push({
            line: idx + 1,
            source: line,
            function: 'main',
            locals: {},
            action: 'execute'
          })
        }
      })

      job.trace = normalizeVisualizationTrace(fallbackSteps, args.sourceCode, args.language, args.stdin || '')
    }

    job.status = 'exited'
    job.exitCode = 0
  }

  // Interactive standard input
  async sendJobInput(jobId: string, data: string): Promise<{ success: boolean; error?: string }> {
    const job = this.activeJobs.get(jobId)
    if (!job) return { success: false, error: 'Job not found' }
    this.pushEvent(job, 'stdout', data === '\r' || data === '\n' ? '\r\n' : data)
    return { success: true }
  }

  // Stop active job
  async stopJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    const job = this.activeJobs.get(jobId)
    if (!job) return { success: false, error: 'Job not found' }
    job.cancelled = true
    job.status = 'exited'
    job.exitCode = 130
    this.pushEvent(job, 'status', `\r\n\x1b[33m[Execution cancelled by user]\x1b[0m\r\n`)
    return { success: true }
  }

  // Poll output events
  async pollJobEvents(jobId: string, afterCursor: number): Promise<{
    events: JobExecutionEvent[]
    nextCursor: number
    isRunning: boolean
    status: string
    exitCode?: number
  }> {
    const job = this.activeJobs.get(jobId)
    if (!job) {
      return {
        events: [],
        nextCursor: afterCursor,
        isRunning: false,
        status: 'exited'
      }
    }

    const newEvents = job.events.filter((e) => e.cursor > afterCursor)
    const nextCursor = job.events.length > 0 ? job.events[job.events.length - 1].cursor : afterCursor
    const isRunning = job.status === 'running' || job.status === 'compiling'

    return {
      events: newEvents,
      nextCursor,
      isRunning,
      status: job.status,
      exitCode: job.exitCode
    }
  }

  // Fetch complete visualization trace
  async fetchJobTrace(jobId: string): Promise<{ success: boolean; trace?: NormalizedVisualizerStep[]; error?: string }> {
    const job = this.activeJobs.get(jobId)
    if (!job) return { success: false, error: 'Job not found' }
    if (job.trace && job.trace.length > 0) {
      return { success: true, trace: job.trace }
    }
    return { success: false, error: 'Trace recording in progress or unavailable' }
  }

  // Direct Google Gemini AI Client with BYOK (Bring Your Own Key) & Automatic Quota Rotation
  async aiChat(args: {
    prompt: string
    context?: {
      fileName?: string
      language?: LanguageId
      sourceCode?: string
      line?: number
      error?: string
      output?: string
    }
  }): Promise<{ success: boolean; text?: string; error?: string }> {
    const keyStore = useAiKeyStore.getState()
    const adminStore = useAdminStore.getState()

    let activeKey = keyStore.getActiveKey()
    let isUsingAdminKey = false

    if (!activeKey && adminStore.allowGuestAccess && adminStore.hasAdminKey()) {
      activeKey = adminStore.getAdminKey()
      isUsingAdminKey = true
    }

    if (!activeKey) {
      keyStore.openModal()
      return {
        success: false,
        error: 'NO_API_KEY',
        text: 'Please add your Google Gemini API key to use AI features. Click "AI Keys" in the top bar to get started.'
      }
    }

    // Prepare system instructions and prompt with full context
    let contextBlock = ''
    if (args.context) {
      contextBlock += `\n--- Context ---\n`
      if (args.context.fileName) contextBlock += `File: ${args.context.fileName}\n`
      if (args.context.language) contextBlock += `Language: ${args.context.language}\n`
      if (args.context.line) contextBlock += `Relevant Line: ${args.context.line}\n`
      if (args.context.error) contextBlock += `Active Error:\n${args.context.error}\n`
      if (args.context.output) contextBlock += `Recent Output:\n${args.context.output.slice(-1000)}\n`
      if (args.context.sourceCode) contextBlock += `Source Code:\n\`\`\`${args.context.language || ''}\n${args.context.sourceCode}\n\`\`\`\n`
      contextBlock += `--- End Context ---\n\n`
    }

    const fullPrompt = `You are CodeForge AI, an encouraging and highly knowledgeable coding assistant for students and developers.
Provide clear, accurate, and beginner-friendly advice.
${contextBlock}User Question:
${args.prompt}`

    // Models to attempt: primary gemini-2.0-flash, fallback gemini-1.5-flash
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash']

    let currentKey = activeKey
    let attempts = 0
    const maxAttempts = Math.min((isUsingAdminKey ? adminStore.adminKeys.length : keyStore.keys.length) + 1, 6)

    while (attempts < maxAttempts) {
      attempts++
      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(currentKey)}`
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2048
              }
            })
          })

          const parsed = await safeParseResponse(res)

          // Handle rate limit (429) or quota exceeded by rotating key
          if (res.status === 429) {
            const next = isUsingAdminKey ? adminStore.rotateAdminKey() : keyStore.rotateToNextKey()
            if (next && next !== currentKey) {
              currentKey = next
              break // retry loop with new key
            }
          }

          if (res.ok && parsed.data) {
            const reply = parsed.data?.candidates?.[0]?.content?.parts?.[0]?.text
            if (reply) {
              return { success: true, text: reply }
            }
          }

          if (!res.ok) {
            const errorMsg = parsed.data?.error?.message || `API returned status ${res.status}`
            if (model === models[models.length - 1] && attempts >= maxAttempts) {
              return { success: false, error: errorMsg }
            }
          }
        } catch (err: any) {
          if (model === models[models.length - 1] && attempts >= maxAttempts) {
            return { success: false, error: err.message || 'Failed to reach Gemini API' }
          }
        }
      }
    }

    return { success: false, error: 'Could not complete AI request with configured API keys.' }
  }

  // AI Full-File Merge with BYOK or Admin Key
  async aiMergeCode(args: {
    currentContent: string
    snippet: string
    language: string
    fileId: string
  }): Promise<{ success: boolean; mergedContent?: string; error?: string }> {
    const keyStore = useAiKeyStore.getState()
    const adminStore = useAdminStore.getState()

    let activeKey = keyStore.getActiveKey()

    if (!activeKey && adminStore.allowGuestAccess && adminStore.hasAdminKey()) {
      activeKey = adminStore.getAdminKey()
    }

    if (!activeKey) {
      keyStore.openModal()
      return {
        success: false,
        error: 'Please configure your Gemini API key in the top bar to apply AI fixes.'
      }
    }

    const prompt = `You are a source code merging assistant.
Given the original source code and a suggested replacement snippet, produce the complete, updated source file with the snippet accurately merged.

Rules:
1. Return ONLY the complete updated source code inside a single markdown code block (e.g. \`\`\`${args.language} ... \`\`\`).
2. Do not include any explanations, greetings, or conversational text.
3. Preserve all surrounding code, includes, and structure that does not need changing.

Original Code:
\`\`\`${args.language}
${args.currentContent}
\`\`\`

Suggested Snippet / Fix:
\`\`\`${args.language}
${args.snippet}
\`\`\`
`

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(activeKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
        })
      })

      const parsed = await safeParseResponse(res)
      if (!res.ok || !parsed.data) {
        return { success: false, error: parsed.data?.error?.message || `API error ${res.status}` }
      }

      const text = parsed.data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const codeMatch = text.match(/```(?:\w+)?\s*\n([\s\S]*?)```/)
      const mergedContent = codeMatch ? codeMatch[1].trim() : text.trim()

      return { success: true, mergedContent }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to merge code.' }
    }
  }
}

export const platform: IPlatformAdapter = new RemotePlatformAdapter()
