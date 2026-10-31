// ============================================================================
// Shared Types — used across client and server in CodeForge Web
// ============================================================================

export type LanguageId = 'c' | 'cpp' | 'python'
export type ErrorSeverity = 'error' | 'warning' | 'note'

export interface ToolchainStatus {
  language: LanguageId
  available: boolean
  path: string | null
  version: string | null
  error?: string
}

export interface CompileOptions {
  cppStandard?: string
  extraFlags?: string[]
  optimizationLevel?: string
}

export interface DiffPatch {
  originalCode: string
  suggestedCode: string
  startLine: number
  endLine: number
  explanation: string
}

export interface NormalizedError {
  language: LanguageId
  severity: ErrorSeverity
  file: string
  line: number
  column: number | null
  functionContext: string | null
  rawMessage: string
  simplifiedMessage: string | null
  suggestedFix?: DiffPatch | null
}

export interface CompileResult {
  success: boolean
  outputPath: string | null
  errors: NormalizedError[]
  rawStderr: string
  rawStdout: string
  durationMs: number
}

export interface ExecutionSession {
  id: string
  language: LanguageId
  pid: number | null
  status: 'compiling' | 'running' | 'stopped' | 'exited' | 'timeout' | 'error'
  exitCode: number | null
  startTime: number
}

export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

export interface AppSettings {
  gccPath: string | null
  gppPath: string | null
  pythonPath: string | null
  cppStandard: string
  executionTimeoutMs: number
  theme: 'dark' | 'light'
  fontSize: number
  aiEnabled: boolean
  geminiModel: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  gccPath: null,
  gppPath: null,
  pythonPath: null,
  cppStandard: 'c++17',
  executionTimeoutMs: 30000,
  theme: 'dark',
  fontSize: 14,
  aiEnabled: true,
  geminiModel: 'gemini-2.5-flash'
}

export interface JobExecutionEvent {
  cursor: number
  type: 'stdout' | 'stderr' | 'status' | 'exit' | 'error'
  data: string
  exitCode?: number
}
