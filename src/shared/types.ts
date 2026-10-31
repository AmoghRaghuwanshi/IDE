// ============================================================================
// Shared Types — used by both Main and Renderer processes
// ============================================================================

/** Supported language identifiers */
export type LanguageId = 'c' | 'cpp' | 'python'

/** Error severity levels */
export type ErrorSeverity = 'error' | 'warning' | 'note'

/** Status of a toolchain for a specific language */
export interface ToolchainStatus {
  language: LanguageId
  available: boolean
  path: string | null
  version: string | null
  error?: string
}

/** Options passed to a compiler adapter */
export interface CompileOptions {
  cppStandard?: string // e.g. 'c++17', 'c++20'
  extraFlags?: string[]
  optimizationLevel?: string
}

/** Result of a compilation attempt */
export interface CompileResult {
  success: boolean
  outputPath: string | null
  errors: NormalizedError[]
  rawStderr: string
  rawStdout: string
  durationMs: number
}

/** A normalized, language-agnostic error/warning */
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

/** A patch for AI-suggested fixes */
export interface DiffPatch {
  originalCode: string
  suggestedCode: string
  startLine: number
  endLine: number
  explanation: string
}

/** Execution session state */
export interface ExecutionSession {
  id: string
  language: LanguageId
  pid: number | null
  status: 'compiling' | 'running' | 'stopped' | 'exited' | 'timeout' | 'error'
  exitCode: number | null
  startTime: number
}

/** Events emitted from PTY to renderer */
export interface PtyDataEvent {
  sessionId: string
  data: string
}

export interface PtyExitEvent {
  sessionId: string
  exitCode: number
}

export interface PtyErrorEvent {
  sessionId: string
  error: string
}

/** File tree node */
export interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

/** Settings stored in the app */
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

/** Default settings */
export const DEFAULT_SETTINGS: AppSettings = {
  gccPath: null,
  gppPath: null,
  pythonPath: null,
  cppStandard: 'c++17',
  executionTimeoutMs: 60000,
  theme: 'dark',
  fontSize: 14,
  aiEnabled: false,
  geminiModel: null
}

// ============================================================================
// IPC Channel Definitions — typed contract between main and renderer
// ============================================================================

/** All IPC channels used in the app */
export const IPC_CHANNELS = {
  // Compiler
  DETECT_TOOLCHAIN: 'compiler:detect-toolchain',
  COMPILE_AND_RUN: 'compiler:compile-and-run',
  COMPILE_ONLY: 'compiler:compile-only',

  // Execution
  EXECUTION_STOP: 'execution:stop',
  EXECUTION_INPUT: 'execution:input',
  EXECUTION_RESIZE: 'execution:resize',
  EXECUTION_DATA: 'execution:data',
  EXECUTION_EXIT: 'execution:exit',
  EXECUTION_ERROR: 'execution:error',
  EXECUTION_STATUS: 'execution:status',
  VISUALIZER_START: 'execution:visualizer-start',
  VISUALIZER_CHUNK: 'execution:visualizer-chunk',
  VISUALIZER_INPUT: 'execution:visualizer-input',

  // File system
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_CREATE: 'file:create',
  FILE_SAVE_AS: 'file:save-as',
  FILE_LIST_DIR: 'file:list-dir',
  FILE_SELECT_DIR: 'file:select-dir',
  FILE_SELECT_FILE: 'file:select-file',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // AI (future)
  AI_CHAT: 'ai:chat',
  AI_SUGGEST_FIX: 'ai:suggest-fix'
} as const
