import type { LanguageId, ToolchainStatus, NormalizedError } from '../shared/types'

declare global {
  interface Window {
    api: {
      // Compiler / Execution
      detectToolchain: () => Promise<Record<LanguageId, ToolchainStatus>>
      compileAndRun: (args: {
        language: LanguageId
        sourceCode: string
        sourceName: string
        cppStandard?: string
        input?: string
      }) => Promise<{
        success: boolean
        sessionId?: string
        errors: NormalizedError[]
        rawStderr: string
        durationMs: number
      }>
      compileOnly: (args: {
        language: LanguageId
        sourceCode: string
        sourceName: string
        cppStandard?: string
      }) => Promise<{
        success: boolean
        errors: NormalizedError[]
        rawStderr: string
        durationMs: number
      }>

      startVisualizer: (args: {
        language: LanguageId
        sourceCode: string
        sourceName: string
        input?: string
      }) => Promise<{
        success: boolean
        trace?: any[]
        error?: string
      }>

      // Execution Control
      stopExecution: (sessionId: string) => Promise<{ success: boolean }>
      sendInput: (sessionId: string, data: string) => void
      resizePty: (sessionId: string, cols: number, rows: number) => void

      // Execution Events
      onExecutionData: (
        callback: (data: { sessionId: string; data: string }) => void
      ) => () => void
      onExecutionExit: (
        callback: (data: { sessionId: string; exitCode: number }) => void
      ) => () => void
      onExecutionStatus: (
        callback: (data: { status: string; exitCode?: number; sessionId?: string }) => void
      ) => () => void

      // File System
      readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
      writeFile: (
        filePath: string,
        content: string
      ) => Promise<{ success: boolean; error?: string }>
      listDir: (
        dirPath: string
      ) => Promise<{
        success: boolean
        nodes: Array<{ name: string; path: string; isDirectory: boolean }>
        error?: string
      }>
      selectDirectory: () => Promise<{ success: boolean; path?: string }>
      selectFile: () => Promise<{ success: boolean; path?: string }>
      createFile: (
        dirPath: string,
        fileName: string,
        content: string
      ) => Promise<{ success: boolean; path?: string; error?: string }>
      saveAs: (
        content: string,
        defaultName?: string
      ) => Promise<{ success: boolean; path?: string; error?: string }>

      // Settings
      getSettings: () => Promise<Record<string, unknown>>

      // AI Chat
      aiChat: (args: {
        apiKeys: string[]
        prompt: string
      }) => Promise<{ success: boolean; text?: string; error?: string; keyIndex?: number }>
      
      aiMergeCode: (args: {
        apiKeys: string[]
        currentContent: string
        snippet: string
        language: string
      }) => Promise<{ success: boolean; mergedContent?: string; error?: string }>
    }
  }
}
