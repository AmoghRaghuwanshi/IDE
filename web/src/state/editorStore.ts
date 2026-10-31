import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LanguageId, NormalizedError } from '../shared/types'

export interface OpenFile {
  id: string
  path: string
  name: string
  language: LanguageId
  content: string
  savedContent: string
  isDirty: boolean
}

interface EditorState {
  openFiles: OpenFile[]
  activeFileId: string | null
  workingDirectory: string | null
  errors: NormalizedError[]
  aiSuggestions: { line: number; message: string }[]
  aiDiff: { fileId: string; originalContent: string; modifiedContent: string; isApplying: boolean } | null

  openFile: (path: string, name: string, content: string) => void
  closeFile: (id: string) => void
  setActiveFile: (id: string) => void
  updateContent: (id: string, content: string) => void
  markSaved: (id: string, content: string) => void
  setWorkingDirectory: (dir: string) => void
  setErrors: (errors: NormalizedError[]) => void
  clearErrors: () => void
  setAiSuggestions: (suggestions: { line: number; message: string }[]) => void
  clearAiSuggestions: () => void
  createNewFile: (language: LanguageId) => void
  setAiDiff: (diff: { fileId: string; originalContent: string; modifiedContent: string; isApplying: boolean } | null) => void
  acceptAiDiff: () => void
  rejectAiDiff: () => void
}

let newFileCounter = 0

function syncFileCounter(openFiles: OpenFile[]): void {
  for (const f of openFiles) {
    const match = f.name.match(/^untitled(\d+)/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num >= newFileCounter) newFileCounter = num
    }
  }
}

function detectLanguage(filename: string): LanguageId {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hxx':
      return 'cpp'
    case 'py':
      return 'python'
    default:
      return 'c'
  }
}

function languageExtension(lang: LanguageId): string {
  switch (lang) {
    case 'c':
      return '.c'
    case 'cpp':
      return '.cpp'
    case 'python':
      return '.py'
  }
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      openFiles: [],
      activeFileId: null,
      workingDirectory: null,
      errors: [],
      aiSuggestions: [],
      aiDiff: null,

      openFile: (path: string, name: string, content: string) => {
        const state = get()
        const existing = state.openFiles.find((f) => f.path === path || f.name === name)
        if (existing) {
          set({ activeFileId: existing.id })
          return
        }
        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const language = detectLanguage(name)
        const newFile: OpenFile = {
          id,
          path,
          name,
          language,
          content,
          savedContent: content,
          isDirty: false
        }
        set({
          openFiles: [...state.openFiles, newFile],
          activeFileId: id
        })
      },

      closeFile: (id: string) => {
        const state = get()
        const filtered = state.openFiles.filter((f) => f.id !== id)
        let newActiveId = state.activeFileId
        if (state.activeFileId === id) {
          const idx = state.openFiles.findIndex((f) => f.id === id)
          if (filtered.length > 0) {
            newActiveId = filtered[Math.min(idx, filtered.length - 1)].id
          } else {
            newActiveId = null
          }
        }
        set({ openFiles: filtered, activeFileId: newActiveId, aiDiff: state.aiDiff?.fileId === id ? null : state.aiDiff })
      },

      setActiveFile: (id: string) => set({ activeFileId: id, aiDiff: null }),

      updateContent: (id: string, content: string) => {
        set((state) => {
          const aiSuggestions = state.aiSuggestions.length > 0 ? [] : state.aiSuggestions
          return {
            openFiles: state.openFiles.map((f) =>
              f.id === id ? { ...f, content, isDirty: content !== f.savedContent } : f
            ),
            aiSuggestions,
            aiDiff: state.aiDiff?.fileId === id ? null : state.aiDiff
          }
        })
      },

      markSaved: (id: string, content: string) => {
        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.id === id ? { ...f, savedContent: content, isDirty: false } : f
          )
        }))
      },

      setWorkingDirectory: (dir: string) => set({ workingDirectory: dir }),

      setErrors: (errors: NormalizedError[]) => set({ errors }),

      clearErrors: () => set({ errors: [] }),

      setAiSuggestions: (aiSuggestions) => set({ aiSuggestions }),
      
      clearAiSuggestions: () => set({ aiSuggestions: [] }),

      createNewFile: (language: LanguageId) => {
        newFileCounter++
        const name = `untitled${newFileCounter}${languageExtension(language)}`
        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        
        let initialContent = ''
        if (language === 'python') {
          initialContent = 'def main():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    main()\n'
        } else if (language === 'c') {
          initialContent = '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}\n'
        } else if (language === 'cpp') {
          initialContent = '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n'
        }

        const newFile: OpenFile = {
          id,
          name,
          path: `untitled:///${name}`,
          language,
          content: initialContent,
          savedContent: '',
          isDirty: true
        }

        set((state) => ({
          openFiles: [...state.openFiles, newFile],
          activeFileId: id
        }))
      },

      setAiDiff: (diff) => {
        const state = get()
        if (diff) {
          const file = state.openFiles.find(item => item.id === diff.fileId)
          if (!file || state.activeFileId !== diff.fileId || file.content !== diff.originalContent) return
          if (!diff.isApplying && (!diff.modifiedContent.trim() || diff.modifiedContent === diff.originalContent)) {
            set({ aiDiff: null })
            return
          }
        }
        set({ aiDiff: diff })
      },

      acceptAiDiff: () => {
        const state = get()
        if (!state.aiDiff || state.aiDiff.isApplying || !state.activeFileId) return
        const target = state.openFiles.find((file) => file.id === state.aiDiff!.fileId)
        if (!target || state.activeFileId !== state.aiDiff.fileId || target.content !== state.aiDiff.originalContent) {
          set({ aiDiff: null })
          return
        }

        set((state) => ({
          openFiles: state.openFiles.map((f) =>
            f.id === state.aiDiff!.fileId ? { ...f, content: state.aiDiff!.modifiedContent, isDirty: state.aiDiff!.modifiedContent !== f.savedContent } : f
          ),
          aiDiff: null
        }))
      },

      rejectAiDiff: () => set({ aiDiff: null })
    }),
    {
      name: 'codeforge-web-editor-storage',
      partialize: (state) => ({
        openFiles: state.openFiles,
        activeFileId: state.activeFileId,
        workingDirectory: state.workingDirectory
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            syncFileCounter(state.openFiles)
          }
        }
      }
    }
  )
)
