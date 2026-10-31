import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import Editor, { DiffEditor, OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { useEditorStore } from '../../state/editorStore'
import { useExecutionStore } from '../../state/executionStore'

// Use local monaco-editor instead of CDN (CDN is blocked by Electron CSP)
self.MonacoEnvironment = {
  getWorker: (_id, label) => {
    if (label === 'json') return new JsonWorker()
    if (['css', 'scss', 'less'].includes(label)) return new CssWorker()
    if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker()
    if (['javascript', 'typescript'].includes(label)) return new TypeScriptWorker()
    return new EditorWorker()
  }
}
loader.config({ monaco })

/** Map our severity to Monaco severity */
function toMonacoSeverity(severity: string): number {
  switch (severity) {
    case 'error':
      return 8 // MarkerSeverity.Error
    case 'warning':
      return 4 // MarkerSeverity.Warning
    case 'note':
      return 2 // MarkerSeverity.Info
    default:
      return 1 // MarkerSeverity.Hint
  }
}

/** Map our language IDs to Monaco language IDs */
function toMonacoLanguage(lang: string): string {
  switch (lang) {
    case 'c':
      return 'c'
    case 'cpp':
      return 'cpp'
    case 'python':
      return 'python'
    default:
      return 'plaintext'
  }
}

export default function MonacoEditor() {
  const [reviewNotice, setReviewNotice] = useState('')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)

  const activeFileId = useEditorStore((s) => s.activeFileId)
  const openFiles = useEditorStore((s) => s.openFiles)
  const updateContent = useEditorStore((s) => s.updateContent)
  
  const aiDiff = useEditorStore((s) => s.aiDiff)
  const acceptAiDiff = useEditorStore((s) => s.acceptAiDiff)
  const rejectAiDiff = useEditorStore((s) => s.rejectAiDiff)

  const errors = useEditorStore((s) => s.errors)
  const aiSuggestions = useEditorStore((s) => s.aiSuggestions)

  const isVisualizerVisible = useExecutionStore((s) => s.isVisualizerVisible)
  const visualizerTrace = useExecutionStore((s) => s.visualizerTrace)
  const visualizerStep = useExecutionStore((s) => s.visualizerStep)
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)

  const activeFile = openFiles.find((f) => f.id === activeFileId)
  const activeAiDiff = aiDiff && aiDiff.fileId === activeFileId ? aiDiff : null

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    editor.onDidDispose(() => {
      if (editorRef.current === editor) {
        editorRef.current = null
        decorationsRef.current = null
      }
    })

    // Define the CodeForge dark theme
    monaco.editor.defineTheme('codeforge-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff7b72' },
        { token: 'string', foreground: 'a5d6ff' },
        { token: 'number', foreground: '79c0ff' },
        { token: 'type', foreground: 'ffa657' },
        { token: 'function', foreground: 'd2a8ff' },
        { token: 'variable', foreground: 'ffa657' },
        { token: 'operator', foreground: 'ff7b72' },
        { token: 'delimiter', foreground: 'e6edf3' },
        { token: 'identifier', foreground: 'e6edf3' }
      ],
      colors: {
        'editor.background': '#0d1117',
        'editor.foreground': '#e6edf3',
        'editor.lineHighlightBackground': '#161b2280',
        'editor.selectionBackground': '#264f7840',
        'editor.inactiveSelectionBackground': '#264f7820',
        'editorLineNumber.foreground': '#6e7681',
        'editorLineNumber.activeForeground': '#e6edf3',
        'editorCursor.foreground': '#58a6ff',
        'editor.findMatchBackground': '#9e6a03aa',
        'editor.findMatchHighlightBackground': '#f2cc6044',
        'editorBracketMatch.background': '#58a6ff30',
        'editorBracketMatch.border': '#58a6ff80',
        'editorIndentGuide.background': '#21262d',
        'editorIndentGuide.activeBackground': '#30363d',
        'editorWidget.background': '#161b22',
        'editorWidget.border': '#30363d',
        'editorSuggestWidget.background': '#161b22',
        'editorSuggestWidget.border': '#30363d',
        'editorSuggestWidget.selectedBackground': '#21262d',
        'editorGutter.background': '#0d1117',
        'minimap.background': '#0d1117',
        'scrollbarSlider.background': '#30363d80',
        'scrollbarSlider.hoverBackground': '#6e768180',
        'scrollbarSlider.activeBackground': '#8b949e80'
        , 'diffEditor.insertedLineBackground': '#23863640'
        , 'diffEditor.removedLineBackground': '#da363340'
        , 'diffEditor.insertedTextBackground': '#2ea04370'
        , 'diffEditor.removedTextBackground': '#f8514970'
      }
    })
    monaco.editor.setTheme('codeforge-dark')

    // Set up keyboard shortcuts
    editor.addAction({
      id: 'codeforge-save',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        window.dispatchEvent(new CustomEvent('codeforge:save'))
      }
    })

    editor.addAction({
      id: 'codeforge-run',
      label: 'Run Code',
      keybindings: [monaco.KeyCode.F5],
      run: () => {
        window.dispatchEvent(new CustomEvent('codeforge:run'))
      }
    })
  }, [])

  // Update editor content when active file changes
  useEffect(() => {
    if (editorRef.current && activeFile) {
      const model = editorRef.current.getModel()
      if (model && model.getValue() !== activeFile.content) {
        model.setValue(activeFile.content)
      }
    }
  }, [activeFileId])

  // Listen for navigate-to-line events from ErrorsPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const { line, column } = (e as CustomEvent).detail
      if (editorRef.current && line > 0) {
        editorRef.current.revealLineInCenter(line)
        editorRef.current.setPosition({ lineNumber: line, column: column || 1 })
        editorRef.current.focus()
      }
    }
    window.addEventListener('codeforge:navigate-to-line', handler)
    return () => window.removeEventListener('codeforge:navigate-to-line', handler)
  }, [])

  // Update error markers when errors change
  useEffect(() => {
    if (!monacoRef.current || !editorRef.current) return

    const model = editorRef.current.getModel()
    if (!model) return

    const markers = errors.map((err) => ({
      severity: toMonacoSeverity(err.severity),
      message: err.simplifiedMessage || err.rawMessage,
      startLineNumber: err.line,
      startColumn: err.column || 1,
      endLineNumber: err.line,
      endColumn: err.column ? err.column + 10 : 1000,
      source: 'CodeForge'
    }))

    monacoRef.current.editor.setModelMarkers(model, 'compiler', markers)
  }, [errors])

  // Update AI suggestion markers
  useEffect(() => {
    if (!monacoRef.current || !editorRef.current) return

    const model = editorRef.current.getModel()
    if (!model) return

    const aiMarkers = aiSuggestions.map((sug) => ({
      severity: 4, // MarkerSeverity.Warning
      message: sug.message,
      startLineNumber: sug.line,
      startColumn: 1,
      endLineNumber: sug.line,
      endColumn: 1000,
      source: 'Gemini AI'
    }))

    monacoRef.current.editor.setModelMarkers(model, 'gemini', aiMarkers)
  }, [aiSuggestions])

  // Update visualizer line highlight
  useEffect(() => {
    if (!editorRef.current) return
    
    if (!decorationsRef.current) {
      decorationsRef.current = editorRef.current.createDecorationsCollection([])
    }

    if (isVisualizerVisible && visualizerTrace && visualizerTrace[visualizerStep]) {
      const step = visualizerTrace[visualizerStep]
      const line = step.line > 0 ? step.line : 1
      
      decorationsRef.current.set([{
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'visualizer-line-highlight',
          marginClassName: 'visualizer-line-margin'
        }
      }])
      
      // Reveal the line in the center
      editorRef.current.revealLineInCenter(line)
    } else {
      decorationsRef.current.clear()
    }
  }, [isVisualizerVisible, visualizerTrace, visualizerStep])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (activeFileId && value !== undefined) {
        updateContent(activeFileId, value)
      }
    },
    [activeFileId, updateContent]
  )

  const editorOptions = useMemo(() => ({
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    fontLigatures: true,
    minimap: { enabled: true, scale: 1 },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: 'off',
    padding: { top: 8 }
  } as const), [])

  if (!activeFile) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚡</div>
        <div className="empty-state-title">CodeForge</div>
        <div className="empty-state-text">
          Open a file from the sidebar or create a new file to get started.
          <br />
          <br />
          <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}>
            Ctrl+N — New File &nbsp;|&nbsp; Ctrl+O — Open File &nbsp;|&nbsp; F5 — Run
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-container" style={{ width: '100%', height: '100%', position: 'relative' }}
      onPasteCapture={(event) => {
        const text = event.clipboardData.getData('text/plain')
        if (activeAiDiff || !text.includes('\n') || !activeFile.content.trim()) return
        const instance = editorRef.current
        const model = instance?.getModel()
        const selection = instance?.getSelection()
        if (!model || !selection) return
        event.preventDefault()
        event.stopPropagation()
        // A complete program replaces the file; a snippet replaces the selection.
        const fullProgram = /^\s*#\s*include\b/m.test(text) || /^\s*(?:async\s+)?def\s+main\s*\(/m.test(text)
        const start = fullProgram ? 0 : model.getOffsetAt(selection.getStartPosition())
        const end = fullProgram ? activeFile.content.length : model.getOffsetAt(selection.getEndPosition())
        const modified = activeFile.content.slice(0, start) + text + activeFile.content.slice(end)
        if (modified === activeFile.content) { setReviewNotice('The pasted code is identical. No lines changed.'); return }
        setReviewNotice('')
        useEditorStore.getState().setAiDiff({ fileId: activeFile.id, originalContent: activeFile.content, modifiedContent: modified, isApplying: false })
      }}>
      {reviewNotice && <div role="status" style={{ position: 'absolute', top: 0, right: 20, zIndex: 101, padding: 10, background: '#161b22', color: '#e6edf3' }}>{reviewNotice}<button onClick={() => setReviewNotice('')}>Dismiss</button></div>}
      {activeAiDiff ? (
        <>
          <DiffEditor
            key={`review-${activeFile.id}`}
            originalModelPath={`codeforge-review:///${activeFile.id}/before`}
            modifiedModelPath={`codeforge-review:///${activeFile.id}/after`}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            original={activeAiDiff.originalContent}
            modified={activeAiDiff.isApplying ? activeAiDiff.originalContent : activeAiDiff.modifiedContent}
            language={toMonacoLanguage(activeFile.language)}
            theme="codeforge-dark"
            options={{
              ...editorOptions,
              renderSideBySide: false,
              useInlineViewWhenSpaceIsLimited: true,
              renderIndicators: true,
              diffWordWrap: 'on',
              originalEditable: false,
              renderOverviewRuler: true,
              ignoreTrimWhitespace: false,
              readOnly: true
            }}
            beforeMount={(api) => {
              api.editor.defineTheme('codeforge-review', {
                base: 'vs-dark', inherit: true, rules: [], colors: {
                  'editor.background': '#0d1117',
                  'diffEditor.insertedLineBackground': '#23863650',
                  'diffEditor.removedLineBackground': '#da363350',
                  'diffEditor.insertedTextBackground': '#2ea04380',
                  'diffEditor.removedTextBackground': '#f8514980'
                }
              })
            }}
            onMount={(instance, api) => {
              api.editor.setTheme('codeforge-review')
              const models = instance.getModel()
              // Monaco 0.56 requires the diff widget to detach before either
              // text model is disposed. The React wrapper disposes models first.
              instance.onDidDispose(() => queueMicrotask(() => {
                models?.original.dispose()
                models?.modified.dispose()
              }))
              const reveal = () => {
                const first = instance.getLineChanges()?.[0]
                if (first) instance.getModifiedEditor().revealLineInCenter(Math.max(1, first.modifiedStartLineNumber))
              }
              const subscription = instance.onDidUpdateDiff(reveal)
              instance.onDidDispose(() => subscription.dispose())
              reveal()
            }}
          />
          <div style={{ position: 'absolute', top: 0, right: 20, zIndex: 100, display: 'flex', gap: 16, background: '#161b22', padding: '8px 12px', fontSize: 12 }}>
            <span style={{ color: '#ff7b72' }}>Red: previous code</span>
            <span style={{ color: '#7ee787' }}>Green: proposed code</span>
            <span style={{ color: '#e6edf3' }}>Review before accepting</span>
          </div>
          <div style={{
            position: 'absolute',
            bottom: '30px',
            right: '40px',
            display: 'flex',
            gap: '12px',
            background: 'var(--bg-secondary)',
            padding: '12px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color)',
            zIndex: 100
          }}>
            {activeAiDiff.isApplying ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '16px', height: '16px', borderRadius: '50%',
                  border: '2px solid rgba(210,168,255,0.2)', borderTopColor: '#d2a8ff',
                  animation: 'spin 1s linear infinite'
                }} />
                <span style={{ color: '#d2a8ff', fontSize: '13px', fontWeight: 600 }}>
                  ✨ Merging AI Suggestions...
                </span>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : (
              <>
                <button 
                  onClick={acceptAiDiff} 
                  style={{
                    background: '#238636', color: '#fff', border: 'none', borderRadius: '6px',
                    padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                  title="Accept AI Changes"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>
                  Accept
                </button>
                <button 
                  onClick={rejectAiDiff} 
                  style={{
                    background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px',
                    padding: '6px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                  title="Reject AI Changes"
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg>
                  Reject
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <Editor
          path={activeFile.path}
          language={toMonacoLanguage(activeFile.language)}
          value={activeFile.content}
          theme="codeforge-dark"
          options={editorOptions}
          onChange={handleChange}
          onMount={handleEditorMount}
        />
      )}
    </div>
  )
}
