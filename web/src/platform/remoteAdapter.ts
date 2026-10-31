// ============================================================================
// Remote API Adapter — HTTP client for Execution, Visualization, and AI
// ============================================================================

import type { IPlatformAdapter, FileDraft } from './types'
import { BrowserStorage, exportFileToDisk, promptLocalFile } from './browserAdapter'
import type { LanguageId, ToolchainStatus, NormalizedError, JobExecutionEvent } from '../shared/types'
import type { NormalizedVisualizerStep } from '../shared/visualizer'

export class RemotePlatformAdapter implements IPlatformAdapter {
  private apiBase: string

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
    // For browser folder upload, we can trigger directory chooser
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
    try {
      const res = await fetch(`${this.apiBase}/api/health`)
      if (!res.ok) throw new Error(`Health check returned status ${res.status}`)
      const data = await res.json()
      return data.toolchains || {
        c: { language: 'c', available: true, path: 'cloud-runner', version: 'GCC' },
        cpp: { language: 'cpp', available: true, path: 'cloud-runner', version: 'G++' },
        python: { language: 'python', available: true, path: 'cloud-runner', version: 'Python 3' }
      }
    } catch {
      return {
        c: { language: 'c', available: true, path: 'cloud-runner', version: 'GCC' },
        cpp: { language: 'cpp', available: true, path: 'cloud-runner', version: 'G++' },
        python: { language: 'python', available: true, path: 'cloud-runner', version: 'Python 3' }
      }
    }
  }

  // Job creation (Run / Trace)
  async createJob(args: {
    language: LanguageId
    sourceName: string
    sourceCode: string
    cppStandard?: string
    mode: 'run' | 'trace'
    stdin?: string
  }): Promise<{ success: boolean; jobId?: string; errors?: NormalizedError[]; error?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        return {
          success: false,
          errors: data.errors,
          error: data.error || `Server returned ${res.status}`
        }
      }
      return {
        success: true,
        jobId: data.jobId,
        errors: data.errors
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to submit execution job' }
    }
  }

  // Interactive standard input
  async sendJobInput(jobId: string, data: string, seq?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/api/jobs/${encodeURIComponent(jobId)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, seq })
      })
      const json = await res.json()
      return { success: res.ok && json.success, error: json.error }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send stdin' }
    }
  }

  // Stop job
  async stopJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST'
      })
      const json = await res.json()
      return { success: res.ok && json.success, error: json.error }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to cancel job' }
    }
  }

  // Poll output events
  async pollJobEvents(jobId: string, afterCursor: number): Promise<{
    events: JobExecutionEvent[]
    nextCursor: number
    isRunning: boolean
    status: string
    exitCode?: number
  }> {
    try {
      const res = await fetch(`${this.apiBase}/api/jobs/${encodeURIComponent(jobId)}/events?after=${afterCursor}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch {
      return {
        events: [],
        nextCursor: afterCursor,
        isRunning: false,
        status: 'error'
      }
    }
  }

  // Fetch complete visualization trace
  async fetchJobTrace(jobId: string): Promise<{ success: boolean; trace?: NormalizedVisualizerStep[]; error?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/api/jobs/${encodeURIComponent(jobId)}/trace`)
      const json = await res.json()
      if (!res.ok || !json.success) {
        return { success: false, error: json.error || `Trace request failed with status ${res.status}` }
      }
      return { success: true, trace: json.trace }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to retrieve visualization trace' }
    }
  }

  // AI Chat via server-side endpoint (API key remains strictly on server)
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
    try {
      const res = await fetch(`${this.apiBase}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      })
      const json = await res.json()
      return {
        success: res.ok && json.success,
        text: json.text,
        error: json.error || (!res.ok ? `Server error ${res.status}` : undefined)
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to reach AI service' }
    }
  }

  // AI Full-File Merge via server-side endpoint
  async aiMergeCode(args: {
    currentContent: string
    snippet: string
    language: string
    fileId: string
  }): Promise<{ success: boolean; mergedContent?: string; error?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/api/ai/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      })
      const json = await res.json()
      return {
        success: res.ok && json.success,
        mergedContent: json.mergedContent,
        error: json.error || (!res.ok ? `Server error ${res.status}` : undefined)
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to merge AI suggestion' }
    }
  }
}

export const platform: IPlatformAdapter = new RemotePlatformAdapter()
