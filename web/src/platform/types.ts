// ============================================================================
// Platform Abstraction Interface — Isolates Browser vs Desktop Capabilities
// ============================================================================

import type { LanguageId, ToolchainStatus, NormalizedError, JobExecutionEvent } from '../shared/types'
import type { NormalizedVisualizerStep } from '../shared/visualizer'

export interface FileDraft {
  id: string
  name: string
  language: LanguageId
  content: string
  savedAt: number
}

export interface IPlatformAdapter {
  // File Storage & Draft Persistence (Browser-safe)
  saveDraft(file: FileDraft): Promise<void>
  removeDraft(fileId: string): Promise<void>
  loadAllDrafts(): Promise<FileDraft[]>
  exportFile(name: string, content: string): Promise<{ success: boolean; name?: string; error?: string }>
  openLocalFile(): Promise<{ success: boolean; name?: string; content?: string; language?: LanguageId; error?: string }>
  openLocalFolder(): Promise<{ success: boolean; files?: Array<{ name: string; content: string; language: LanguageId }>; error?: string }>

  // Execution & Toolchain
  detectToolchain(): Promise<Record<LanguageId, ToolchainStatus>>
  createJob(args: {
    language: LanguageId
    sourceName: string
    sourceCode: string
    cppStandard?: string
    mode: 'run' | 'trace'
    stdin?: string
  }): Promise<{
    success: boolean
    jobId?: string
    errors?: NormalizedError[]
    error?: string
  }>
  sendJobInput(jobId: string, data: string, seq?: number): Promise<{ success: boolean; error?: string }>
  stopJob(jobId: string): Promise<{ success: boolean; error?: string }>
  pollJobEvents(jobId: string, afterCursor: number): Promise<{
    events: JobExecutionEvent[]
    nextCursor: number
    isRunning: boolean
    status: string
    exitCode?: number
  }>
  fetchJobTrace(jobId: string): Promise<{
    success: boolean
    trace?: NormalizedVisualizerStep[]
    error?: string
  }>

  // AI Services (via server endpoints, zero browser API key exposure)
  aiChat(args: {
    prompt: string
    context?: {
      fileName?: string
      language?: LanguageId
      sourceCode?: string
      line?: number
      error?: string
      output?: string
    }
  }): Promise<{ success: boolean; text?: string; error?: string }>

  aiMergeCode(args: {
    currentContent: string
    snippet: string
    language: string
    fileId: string
  }): Promise<{ success: boolean; mergedContent?: string; error?: string }>
}
