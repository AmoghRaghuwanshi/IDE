import { create } from 'zustand'
import type { ToolchainStatus, LanguageId } from '../../../shared/types'
import type { RunSnapshot } from '../../../shared/visualizer'

export type ExecutionStatus =
  | 'idle'
  | 'compiling'
  | 'running'
  | 'stopped'
  | 'exited'
  | 'timeout'
  | 'error'

interface ExecutionState {
  // State
  status: ExecutionStatus
  sessionId: string | null
  exitCode: number | null
  compilationOutput: string
  isTerminalVisible: boolean
  toolchainStatus: Record<LanguageId, ToolchainStatus | null>
  activeBottomTab: 'output' | 'errors'
  recordedInput: string
  recordedOutput: string
  runSnapshot: RunSnapshot | null
  visualizerSource: RunSnapshot | null
  isVisualizing: boolean
  setRunSnapshot: (snapshot: RunSnapshot) => void
  setVisualizerSource: (snapshot: RunSnapshot) => void
  setIsVisualizing: (value: boolean) => void

  // Actions
  setStatus: (status: ExecutionStatus) => void
  setSessionId: (id: string | null) => void
  setExitCode: (code: number | null) => void
  setCompilationOutput: (output: string) => void
  appendCompilationOutput: (output: string) => void
  setTerminalVisible: (visible: boolean) => void
  setToolchainStatus: (lang: LanguageId, status: ToolchainStatus) => void
  setActiveBottomTab: (tab: 'output' | 'errors') => void
  appendRecordedInput: (input: string) => void
  clearRecordedInput: () => void
  appendRecordedOutput: (output: string) => void
  clearRecordedOutput: () => void
  
  // Visualizer
  isVisualizerVisible: boolean
  visualizerTrace: any[] | null
  visualizerStep: number
  setVisualizerVisible: (visible: boolean) => void
  setVisualizerTrace: (trace: any[] | null) => void
  appendVisualizerTrace: (chunks: any[]) => void
  setVisualizerStep: (step: number | ((prev: number) => number)) => void

  reset: () => void
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  status: 'idle',
  sessionId: null,
  exitCode: null,
  compilationOutput: '',
  isTerminalVisible: true,
  toolchainStatus: { c: null, cpp: null, python: null },
  activeBottomTab: 'output',
  recordedInput: '',
  recordedOutput: '',
  runSnapshot: null,
  visualizerSource: null,
  isVisualizing: false,
  setRunSnapshot: (runSnapshot) => set({ runSnapshot }),
  setVisualizerSource: (visualizerSource) => set({ visualizerSource }),
  setIsVisualizing: (isVisualizing) => set({ isVisualizing }),
  
  isVisualizerVisible: false,
  visualizerTrace: null,
  visualizerStep: 0,

  setStatus: (status) => set({ status }),
  setSessionId: (sessionId) => set({ sessionId }),
  setExitCode: (exitCode) => set({ exitCode }),
  setCompilationOutput: (compilationOutput) => set({ compilationOutput }),
  appendCompilationOutput: (output) =>
    set((state) => ({ compilationOutput: state.compilationOutput + output })),
  setTerminalVisible: (isTerminalVisible) => set({ isTerminalVisible }),
  setToolchainStatus: (lang, status) =>
    set((state) => ({
      toolchainStatus: { ...state.toolchainStatus, [lang]: status }
    })),
  setActiveBottomTab: (activeBottomTab) => set({ activeBottomTab }),
  appendRecordedInput: (input) => set((state) => ({ recordedInput: state.recordedInput + input })),
  clearRecordedInput: () => set({ recordedInput: '' }),
  appendRecordedOutput: (output) => set((state) => ({ recordedOutput: state.recordedOutput + output })),
  clearRecordedOutput: () => set({ recordedOutput: '' }),
  
  setVisualizerVisible: (visible) => set({ isVisualizerVisible: visible }),
  setVisualizerTrace: (trace) => set({ visualizerTrace: trace, visualizerStep: 0 }),
  appendVisualizerTrace: (chunks) => set((state) => {
    if (!state.visualizerTrace) return { visualizerTrace: chunks }
    return { visualizerTrace: [...state.visualizerTrace, ...chunks] }
  }),
  setVisualizerStep: (step) =>
    set((state) => ({
      visualizerStep: typeof step === 'function' ? step(state.visualizerStep) : step
    })),

  reset: () =>
    set({
      status: 'idle',
      sessionId: null,
      exitCode: null,
      compilationOutput: '',
      recordedInput: '',
      recordedOutput: '',
      visualizerTrace: null,
      visualizerStep: 0
    })
}))
