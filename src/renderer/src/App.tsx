import { useEffect, useCallback, useState } from 'react'
import MonacoEditor from './components/Editor/MonacoEditor'
import EditorTabs from './components/Editor/EditorTabs'
import FileTree from './components/Sidebar/FileTree'
import BottomPanel from './components/BottomPanel/BottomPanel'
import SetupAssistant from './components/SetupAssistant/SetupAssistant'
import { useEditorStore } from './state/editorStore'
import { useExecutionStore } from './state/executionStore'
import VisualizerPanel from './components/Visualizer/VisualizerPanel'
import ChatbotPanel from './components/Chatbot/ChatbotPanel'
import type { LanguageId } from '../../shared/types'
import { normalizeTerminalInput } from '../../shared/terminalInput'

function LanguageBadge({ language }: { language: LanguageId }) {
  const labels: Record<LanguageId, string> = { c: 'C', cpp: 'C++', python: 'Python' }
  return <span className={`language-badge ${language}`}>{labels[language]}</span>
}

function StatusDot() {
  const status = useExecutionStore((s) => s.status)

  switch (status) {
    case 'running':
      return <span className="statusbar-dot running" title="Running" />
    case 'compiling':
      return <span className="statusbar-dot warning" title="Compiling" />
    case 'error':
    case 'timeout':
      return <span className="statusbar-dot error" title="Error" />
    case 'exited':
      return <span className="statusbar-dot success" title="Exited" />
    default:
      return <span className="statusbar-dot" style={{ background: 'var(--text-tertiary)' }} title="Idle" />
  }
}

export default function App() {
  const openFiles = useEditorStore((s) => s.openFiles)
  const activeFileId = useEditorStore((s) => s.activeFileId)
  const markSaved = useEditorStore((s) => s.markSaved)
  const setErrors = useEditorStore((s) => s.setErrors)
  const clearErrors = useEditorStore((s) => s.clearErrors)
  const setAiSuggestions = useEditorStore((s) => s.setAiSuggestions)
  const clearAiSuggestions = useEditorStore((s) => s.clearAiSuggestions)
  const createNewFile = useEditorStore((s) => s.createNewFile)
  const openFile = useEditorStore((s) => s.openFile)
  const setWorkingDirectory = useEditorStore((s) => s.setWorkingDirectory)

  const status = useExecutionStore((s) => s.status)
  const setStatus = useExecutionStore((s) => s.setStatus)
  const sessionId = useExecutionStore((s) => s.sessionId)
  const setSessionId = useExecutionStore((s) => s.setSessionId)
  const setActiveBottomTab = useExecutionStore((s) => s.setActiveBottomTab)
  const setVisualizerVisible = useExecutionStore((s) => s.setVisualizerVisible)
  const setVisualizerTrace = useExecutionStore((s) => s.setVisualizerTrace)
  const reset = useExecutionStore((s) => s.reset)
  const clearRecordedInput = useExecutionStore((s) => s.clearRecordedInput)
  const recordedInput = useExecutionStore((s) => s.recordedInput)

  const [showNewMenu, setShowNewMenu] = useState(false)
  const [showChatbot, setShowChatbot] = useState(false)
  const [showSetup, setShowSetup] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(280)
  const [lastRunSuccess, setLastRunSuccess] = useState(false)

  const activeFile = openFiles.find((f) => f.id === activeFileId)

  // ---- Auto-create a starter file on first launch ----
  useEffect(() => {
    if (openFiles.length === 0) {
      createNewFile('python')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Handle save as ----
  const handleSaveAs = useCallback(async () => {
    if (!activeFile) return
    const result = await window.api.saveAs(activeFile.content, activeFile.name)
    if (result.success && result.path) {
      // Re-open the file at its new path so editorStore tracks it properly
      const name = result.path.split(/[\\/]/).pop() || activeFile.name
      // Update the existing file entry in-place
      markSaved(activeFile.id, activeFile.content)
      // We also need to update the path/name — use openFile + close trick:
      // Actually, let's just update via the store directly
      useEditorStore.setState((state) => ({
        openFiles: state.openFiles.map((f) =>
          f.id === activeFile.id
            ? { ...f, path: result.path!, name, savedContent: activeFile.content, isDirty: false }
            : f
        )
      }))
    }
  }, [activeFile, markSaved])

  // ---- Handle save ----
  const handleSave = useCallback(async () => {
    if (!activeFile) return

    if (activeFile.path) {
      // File already has a path — save directly
      const result = await window.api.writeFile(activeFile.path, activeFile.content)
      if (result.success) {
        markSaved(activeFile.id, activeFile.content)
      }
    } else {
      // No path — trigger Save As dialog
      await handleSaveAs()
    }
  }, [activeFile, markSaved, handleSaveAs])

  // ---- Handle run ----
  const handleRun = useCallback(async () => {
    if (!activeFile) return
    if (status === 'running' || status === 'compiling') return

    clearErrors()
    clearAiSuggestions()
    clearRecordedInput()
    reset()
    useExecutionStore.getState().setRunSnapshot({ fileId: activeFile.id, name: activeFile.name, language: activeFile.language, content: activeFile.content })
    setActiveBottomTab('output')
    setLastRunSuccess(false)

    const result = await window.api.compileAndRun({
      language: activeFile.language,
      sourceCode: activeFile.content,
      sourceName: activeFile.name
    })

    if (result.success && result.sessionId) {
      setSessionId(result.sessionId)
      setStatus('running')
      setLastRunSuccess(true)
    } else {
      setStatus('error')
      setLastRunSuccess(false)
      if (result.errors && result.errors.length > 0) {
        setErrors(result.errors)
        setActiveBottomTab('errors')
        
        // Use AI to explain the error inline
        try {
          const rawKeys = localStorage.getItem('codeforge_gemini_keys')
          const parsedKeys: unknown = rawKeys ? JSON.parse(rawKeys) : []
          const apiKeys = Array.isArray(parsedKeys)
            ? parsedKeys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
            : []
          if (apiKeys.length > 0) {
            const firstError = result.errors[0]
            if (firstError.line > 0) {
              const errorLineContent = activeFile.content.split(/\r?\n/)[firstError.line - 1] || ''
              const prompt = `Analyze this compilation error for a ${activeFile.language} file:
Error: ${firstError.rawMessage}
Code Line ${firstError.line}, Column ${firstError.column || 1}: ${errorLineContent}

Reply with only a concise explanation of the error and the exact fix for that line. Do not repeat the full file or return unrelated code.`
              
              window.api.aiChat({ apiKeys, prompt }).then(res => {
                if (res.success && res.text) {
                  setAiSuggestions([{
                    line: firstError.line,
                    message: `✨ AI: ${res.text.trim()}`
                  }])
                }
              }).catch(() => {})
            }
          }
        } catch (e) {
          console.error('Failed to run AI diagnostic:', e)
        }
      }
    }
  }, [activeFile, status, clearErrors, clearAiSuggestions, reset, setActiveBottomTab, setSessionId, setStatus, setErrors, setAiSuggestions])

  // ---- Handle visualize click (one-shot: collects complete trace) ----
  const handleVisualize = useCallback(async () => {
    if (!activeFile) return
    const execution = useExecutionStore.getState()
    const snapshot = execution.runSnapshot
    if (execution.isVisualizing || status === 'running' || status === 'compiling') return
    if (!snapshot || snapshot.fileId !== activeFile.id || snapshot.content !== activeFile.content) {
      setErrors([{ language: activeFile.language, severity: 'error', file: activeFile.name, line: 0, column: null, functionContext: null,
        rawMessage: 'Run this version of the file first, then open Visualize to replay its input.', simplifiedMessage: 'Run this version of the file first, then open Visualize to replay its input.' }])
      setActiveBottomTab('errors')
      return
    }
    execution.setVisualizerSource(snapshot)
    execution.setIsVisualizing(true)
    
    clearAiSuggestions()
    setVisualizerTrace(null)
    setVisualizerVisible(true)

    try {
      const result = await window.api.startVisualizer({
        language: activeFile.language,
        sourceCode: activeFile.content,
        sourceName: activeFile.name,
        input: normalizeTerminalInput(recordedInput)
      })

      if (result.success && result.trace && result.trace.length > 0) {
        // Got the complete trace — set it and show the visualizer
        setVisualizerTrace(result.trace)
      } else {
        // Failed — show error, close visualizer
        setVisualizerTrace([{ event: 'exception', action: 'exception', line: 0, locals: {}, stdout: '', error: result.error || 'No execution steps were captured.' }])
        setErrors([{
          language: activeFile.language,
          severity: 'error',
          file: activeFile.name,
          line: 0,
          column: null,
          functionContext: null,
          rawMessage: result.error || 'Visualization produced no trace steps.',
          simplifiedMessage: result.error || 'Visualizer failed. Make sure your code runs correctly first (click Run).'
        }])
        setActiveBottomTab('errors')
      }
    } catch (e: any) {
      setVisualizerTrace([{ event: 'exception', action: 'exception', line: 0, locals: {}, stdout: '', error: e.message || String(e) }])
      setErrors([{
        language: activeFile.language,
        severity: 'error',
        file: activeFile.name,
        line: 0,
        column: null,
        functionContext: null,
        rawMessage: e.message || String(e),
        simplifiedMessage: e.message || 'Visualizer backend error. Try restarting the app.'
      }])
      setActiveBottomTab('errors')
    } finally {
      useExecutionStore.getState().setIsVisualizing(false)
    }
  }, [activeFile, status, recordedInput, clearAiSuggestions, setVisualizerTrace, setVisualizerVisible, setErrors, setActiveBottomTab])

  // ---- Handle stop ----
  const handleStop = useCallback(async () => {
    if (sessionId) {
      await window.api.stopExecution(sessionId)
      setStatus('stopped')
      setSessionId(null)
    }
  }, [sessionId, setStatus, setSessionId])

  // ---- Handle open file ----
  const handleOpenFile = useCallback(async () => {
    const result = await window.api.selectFile()
    if (result.success && result.path) {
      const name = result.path.split(/[\\/]/).pop() || 'unknown'
      const fileResult = await window.api.readFile(result.path)
      if (fileResult.success && fileResult.content !== undefined) {
        openFile(result.path, name, fileResult.content)
      }
    }
  }, [openFile])

  // ---- Handle open folder ----
  const handleOpenFolder = useCallback(async () => {
    const result = await window.api.selectDirectory()
    if (result.success && result.path) {
      setWorkingDirectory(result.path)
    }
  }, [setWorkingDirectory])

  // ---- Listen for keyboard shortcuts ----
  useEffect(() => {
    const onSave = (): void => { handleSave() }
    const onRun = (): void => { handleRun() }

    window.addEventListener('codeforge:save', onSave)
    window.addEventListener('codeforge:run', onRun)

    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        handleSaveAs()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'F5') {
        e.preventDefault()
        handleRun()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        setShowNewMenu(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault()
        handleOpenFile()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('codeforge:save', onSave)
      window.removeEventListener('codeforge:run', onRun)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [handleSave, handleSaveAs, handleRun, handleOpenFile])

  // ---- Listen for execution status changes from main process ----
  useEffect(() => {
    const cleanup = window.api.onExecutionStatus(({ status: newStatus }) => {
      if (newStatus === 'exited') {
        setStatus('exited')
        setSessionId(null)
      } else if (newStatus === 'timeout') {
        setStatus('timeout')
        setSessionId(null)
      } else if (newStatus === 'error') {
        setStatus('error')
      } else if (newStatus === 'running') {
        setStatus('running')
      } else if (newStatus === 'compiling') {
        setStatus('compiling')
      }
    })
    return cleanup
  }, [setStatus, setSessionId])

  // ---- Sidebar resize ----
  const handleSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (ev: MouseEvent): void => {
      const delta = ev.clientX - startX
      const newWidth = Math.max(180, Math.min(400, startWidth + delta))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = (): void => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  // ---- Bottom panel resize ----
  const handleBottomResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = bottomPanelHeight

    const onMouseMove = (ev: MouseEvent): void => {
      const delta = startY - ev.clientY
      const newHeight = Math.max(120, Math.min(600, startHeight + delta))
      setBottomPanelHeight(newHeight)
    }

    const onMouseUp = (): void => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [bottomPanelHeight])

  const statusLabels: Record<string, string> = {
    idle: 'Ready',
    compiling: 'Compiling…',
    running: 'Running',
    stopped: 'Stopped',
    exited: 'Finished',
    timeout: 'Timed Out',
    error: 'Error'
  }

  return (
    <div className="app-shell">
      {/* ---- Menu Bar ---- */}
      <div className="app-menubar">
        <div className="app-title">
          <div className="app-title-icon" />
          CodeForge
        </div>

        <div className="menu-item" onClick={handleSave}>Save</div>
        <div className="menu-item" onClick={handleSaveAs}>Save As</div>
        <div className="menu-item" onClick={handleOpenFile}>Open File</div>
        <div className="menu-item" onClick={handleOpenFolder}>Open Folder</div>

        <div style={{ position: 'relative' }}>
          <div className="menu-item" onClick={() => setShowNewMenu(!showNewMenu)}>
            New
          </div>
          {showNewMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-primary)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                zIndex: 200,
                minWidth: '160px',
                padding: 'var(--space-1) 0'
              }}
            >
              {(['c', 'cpp', 'python'] as LanguageId[]).map((lang) => (
                <div
                  key={lang}
                  className="menu-item"
                  style={{ padding: 'var(--space-2) var(--space-4)' }}
                  onClick={() => {
                    createNewFile(lang)
                    setShowNewMenu(false)
                  }}
                >
                  <LanguageBadge language={lang} />{' '}
                  <span style={{ marginLeft: 'var(--space-2)' }}>
                    {lang === 'c' ? 'C File' : lang === 'cpp' ? 'C++ File' : 'Python File'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-separator" />

        {/* Run / Stop buttons */}
        <button
          className="toolbar-btn primary"
          onClick={handleRun}
          disabled={!activeFile || status === 'running' || status === 'compiling'}
          title="Run (F5)"
        >
          ▶ {status === 'compiling' ? 'Compiling…' : 'Run'}
        </button>

        {(status === 'running' || status === 'compiling') && (
          <button className="toolbar-btn danger" onClick={handleStop} title="Stop execution">
            ■ Stop
          </button>
        )}

        <button
          className="toolbar-btn"
          onClick={handleVisualize}
          disabled={!activeFile || !lastRunSuccess || status === 'running' || status === 'compiling'}
          title={lastRunSuccess ? 'Visualize Execution' : 'Run your code first, then visualize'}
          style={{ opacity: lastRunSuccess ? 1 : 0.5 }}
        >
          👁 Visualize
        </button>

        <button
          className="toolbar-btn"
          onClick={() => setShowChatbot(!showChatbot)}
          title="Toggle Gemini AI"
        >
          ✨ AI
        </button>

        <div className="toolbar-spacer" />

        {/* Active language badge */}
        {activeFile && <LanguageBadge language={activeFile.language} />}
      </div>

      {/* ---- Main Body ---- */}
      <div className="app-body">
        {/* Sidebar */}
        <div style={{ width: sidebarWidth, minWidth: 180, maxWidth: 400 }}>
          <FileTree />
        </div>

        {/* Sidebar resize handle */}
        <div className="drag-handle-horizontal" onMouseDown={handleSidebarResize} />

        {/* Editor + Bottom Panel */}
        <div className="app-main">
          {/* Editor Area */}
          <div className="app-editor-area editor-workspace" style={{ display: 'flex', flexDirection: 'row' }}>
            <div className="editor-pane" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <EditorTabs />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <MonacoEditor />
              </div>
            </div>
            <VisualizerPanel />
            {showChatbot && <ChatbotPanel onClose={() => setShowChatbot(false)} />}
          </div>

          {/* Bottom panel resize handle */}
          <div className="drag-handle-vertical" onMouseDown={handleBottomResize} />

          {/* Bottom Panel */}
          <div style={{ height: bottomPanelHeight, minHeight: 120 }}>
            <BottomPanel />
          </div>
        </div>
      </div>

      {/* ---- Status Bar ---- */}
      <div className="app-statusbar no-select">
        <div className="statusbar-section">
          <div className="statusbar-item">
            <StatusDot />
            <span>{statusLabels[status] || 'Ready'}</span>
          </div>
        </div>
        <div className="toolbar-spacer" />
        <div className="statusbar-section">
          {activeFile && (
            <>
              <div className="statusbar-item">
                <span>{activeFile.language.toUpperCase()}</span>
              </div>
              <div className="statusbar-item">
                <span>UTF-8</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Close new menu on click outside */}
      {showNewMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100 }}
          onClick={() => setShowNewMenu(false)}
        />
      )}

      {/* Setup Assistant Modal */}
      {showSetup && <SetupAssistant onDismiss={() => setShowSetup(false)} />}
    </div>
  )
}
