import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { LanguageId, ToolchainStatus, NormalizedError } from '../shared/types'

/** Typed API exposed to the renderer via contextBridge */
const api = {
  // ---- Compiler / Execution ----
  detectToolchain: (): Promise<Record<LanguageId, ToolchainStatus>> =>
    ipcRenderer.invoke(IPC_CHANNELS.DETECT_TOOLCHAIN),

  compileAndRun: (args: {
    language: LanguageId
    sourceCode: string
    sourceName: string
    cppStandard?: string
    input?: string
  }): Promise<{
    success: boolean
    sessionId?: string
    errors: NormalizedError[]
    rawStderr: string
    durationMs: number
  }> => ipcRenderer.invoke(IPC_CHANNELS.COMPILE_AND_RUN, args),

  compileOnly: (args: {
    language: LanguageId
    sourceCode: string
    sourceName: string
    cppStandard?: string
  }): Promise<{
    success: boolean
    errors: NormalizedError[]
    rawStderr: string
    durationMs: number
  }> => ipcRenderer.invoke(IPC_CHANNELS.COMPILE_ONLY, args),

  startVisualizer: (args: {
    language: LanguageId
    sourceCode: string
    sourceName: string
    input?: string
  }): Promise<{
    success: boolean
    trace?: any[]
    error?: string
  }> => ipcRenderer.invoke(IPC_CHANNELS.VISUALIZER_START, args),

  // ---- Execution Control ----
  stopExecution: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTION_STOP, sessionId),

  sendInput: (sessionId: string, data: string): void =>
    ipcRenderer.send(IPC_CHANNELS.EXECUTION_INPUT, { sessionId, data }),

  resizePty: (sessionId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC_CHANNELS.EXECUTION_RESIZE, { sessionId, cols, rows }),

  // ---- Execution Events (main → renderer) ----
  onExecutionData: (
    callback: (data: { sessionId: string; data: string }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; data: string }): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.EXECUTION_DATA, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXECUTION_DATA, handler)
  },

  onExecutionExit: (
    callback: (data: { sessionId: string; exitCode: number }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; exitCode: number }): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.EXECUTION_EXIT, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXECUTION_EXIT, handler)
  },

  onExecutionStatus: (
    callback: (data: { status: string; exitCode?: number; sessionId?: string }) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; exitCode?: number; sessionId?: string }): void => callback(data)
    ipcRenderer.on(IPC_CHANNELS.EXECUTION_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXECUTION_STATUS, handler)
  },

  // ---- File System ----
  readFile: (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, filePath),

  writeFile: (
    filePath: string,
    content: string
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, { filePath, content }),

  listDir: (
    dirPath: string
  ): Promise<{
    success: boolean
    nodes: Array<{ name: string; path: string; isDirectory: boolean }>
    error?: string
  }> => ipcRenderer.invoke(IPC_CHANNELS.FILE_LIST_DIR, dirPath),

  selectDirectory: (): Promise<{ success: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SELECT_DIR),

  selectFile: (): Promise<{ success: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SELECT_FILE),

  createFile: (
    dirPath: string,
    fileName: string,
    content: string
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_CREATE, { dirPath, fileName, content }),

  saveAs: (
    content: string,
    defaultName?: string
  ): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE_AS, { content, defaultName }),

  // ---- Settings ----
  getSettings: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),

  // ---- AI Chat ----
  aiChat: (args: {
    apiKeys: string[]
    prompt: string
  }): Promise<{ success: boolean; text?: string; error?: string; keyIndex?: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.AI_CHAT, args),
  aiMergeCode: (args: { apiKeys: string[]; currentContent: string; snippet: string; language: string }): Promise<{ success: boolean; mergedContent?: string; error?: string }> =>
    ipcRenderer.invoke('ai:merge-code', args)
}

// Expose the typed API to the renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (fallback for non-isolated context)
  window.api = api
}
