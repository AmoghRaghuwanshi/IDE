import { useEffect, useCallback, useState } from 'react'
import MonacoEditor from './components/Editor/MonacoEditor'
import EditorTabs from './components/Editor/EditorTabs'
import FileTree from './components/Sidebar/FileTree'
import BottomPanel from './components/BottomPanel/BottomPanel'
import SetupAssistant from './components/SetupAssistant/SetupAssistant'
import AiKeyModal from './components/AiKeyModal/AiKeyModal'
import AdminPanel from './components/Admin/AdminPanel'
import { useEditorStore } from './state/editorStore'
import { useExecutionStore } from './state/executionStore'
import { useAiKeyStore } from './state/aiKeyStore'
import VisualizerPanel from './components/Visualizer/VisualizerPanel'
import ChatbotPanel from './components/Chatbot/ChatbotPanel'
import type { LanguageId } from './shared/types'
import { normalizeTerminalInput } from './shared/terminalInput'
import { platform } from './platform/remoteAdapter'

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
  const loadStarterFiles = useEditorStore((s) => s.loadStarterFiles)

  const isAiKeyModalOpen = useAiKeyStore((s) => s.isModalOpen)
  const openAiKeyModal = useAiKeyStore((s) => s.openModal)
  const closeAiKeyModal = useAiKeyStore((s) => s.closeModal)
  const aiKeys = useAiKeyStore((s) => s.keys)

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
  const [showSetup, setShowSetup] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(280)
  const [lastRunSuccess, setLastRunSuccess] = useState(false)

  const [isAdminRoute, setIsAdminRoute] = useState(() => {
    return window.location.pathname === '/admin' || window.location.hash === '#/admin'
  })

  // Listen to browser back/forward and hash changes
  useEffect(() => {
    const checkRoute = () => {
      setIsAdminRoute(window.location.pathname === '/admin' || window.location.hash === '#/admin')
    }
    window.addEventListener('popstate', checkRoute)
    window.addEventListener('hashchange', checkRoute)
    return () => {
      window.removeEventListener('popstate', checkRoute)
      window.removeEventListener('hashchange', checkRoute)
    }
  }, [])

  const navigateTo = (path: string) => {
    if (path === '/admin') {
      window.history.pushState({}, '', '/admin')
      setIsAdminRoute(true)
    } else {
      window.history.pushState({}, '', '/')
      setIsAdminRoute(false)
    }
  }

  // Anti-sleep keep-alive heartbeat: ping /api/health periodically so server never goes cold
  useEffect(() => {
    const keepAlive = async () => {
      try {
        await fetch('/api/health?t=' + Date.now(), { cache: 'no-store' })
      } catch {
        /* ignore network hiccups */
      }
    }
    keepAlive()
    const timer = setInterval(keepAlive, 4 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const activeFile = openFiles.find((f) => f.id === activeFileId)

  // Ensure starter files (main.py, main.cpp, main.c) on launch or when all closed
  useEffect(() => {
    if (openFiles.length === 0) {
      loadStarterFiles()
    }
  }, [openFiles.length, loadStarterFiles])

  // Export file to local disk
  const handleExport = useCallback(async () => {
    if (!activeFile) return
    const result = await platform.exportFile(activeFile.name, activeFile.content)
    if (result.success) {
      markSaved(activeFile.id, activeFile.content)
    }
  }, [activeFile, markSaved])

  // Save draft
  const handleSave = useCallback(async () => {
    if (!activeFile) return
    await platform.saveDraft({
      id: activeFile.id,
      name: activeFile.name,
      language: activeFile.language,
      content: activeFile.content,
      savedAt: Date.now()
    })
    markSaved(activeFile.id, activeFile.content)
  }, [activeFile, markSaved])

  // Compile and run code
  const handleRun = useCallback(async () => {
    if (!activeFile) return
    if (status === 'running' || status === 'compiling') return

    clearErrors()
    clearAiSuggestions()
    clearRecordedInput()
    reset()
    useExecutionStore.getState().setRunSnapshot({
      fileId: activeFile.id,
      name: activeFile.name,
      language: activeFile.language,
      content: activeFile.content
    })
    setActiveBottomTab('output')
    setLastRunSuccess(false)
    setStatus('compiling')

    const result = await platform.createJob({
      language: activeFile.language,
      sourceCode: activeFile.content,
      sourceName: activeFile.name,
      mode: 'run'
    })

    if (result.success && result.jobId) {
      setSessionId(result.jobId)
      setStatus('running')
      setLastRunSuccess(true)
    } else {
      setStatus('error')
      setLastRunSuccess(false)
      if (result.errors && result.errors.length > 0) {
        setErrors(result.errors)
        setActiveBottomTab('errors')
      } else if (result.error) {
        setErrors([{
          language: activeFile.language,
          severity: 'error',
          file: activeFile.name,
          line: 1,
          column: 1,
          functionContext: null,
          rawMessage: result.error,
          simplifiedMessage: result.error
        }])
        setActiveBottomTab('errors')
      }
    }
  }, [activeFile, status, clearErrors, clearAiSuggestions, clearRecordedInput, reset, setActiveBottomTab, setStatus, setSessionId, setErrors])

  // Start execution visualizer
  const handleVisualize = useCallback(async () => {
    if (!activeFile) return
    const execution = useExecutionStore.getState()
    const snapshot = execution.runSnapshot
    if (execution.isVisualizing || status === 'running' || status === 'compiling') return

    if (!snapshot || snapshot.fileId !== activeFile.id || snapshot.content !== activeFile.content) {
      setErrors([{
        language: activeFile.language,
        severity: 'error',
        file: activeFile.name,
        line: 0,
        column: null,
        functionContext: null,
        rawMessage: 'Run this version of the file first, then open Visualize to replay its input.',
        simplifiedMessage: 'Run this version of the file first, then open Visualize to replay its input.'
      }])
      setActiveBottomTab('errors')
      return
    }

    execution.setVisualizerSource(snapshot)
    execution.setIsVisualizing(true)
    clearAiSuggestions()
    setVisualizerTrace(null)
    setVisualizerVisible(true)

    try {
      const traceJob = await platform.createJob({
        language: activeFile.language,
        sourceCode: activeFile.content,
        sourceName: activeFile.name,
        mode: 'trace',
        stdin: normalizeTerminalInput(recordedInput)
      })

      if (!traceJob.success || !traceJob.jobId) {
        throw new Error(traceJob.error || 'Failed to start trace recording.')
      }

      // Poll until trace is ready
      let pollAttempts = 0
      while (pollAttempts < 50) {
        await new Promise((r) => setTimeout(r, 400))
        pollAttempts++
        const traceRes = await platform.fetchJobTrace(traceJob.jobId)
        if (traceRes.success && traceRes.trace && traceRes.trace.length > 0) {
          setVisualizerTrace(traceRes.trace)
          return
        }
        if (!traceRes.success && traceRes.error && !traceRes.error.includes('in progress')) {
          throw new Error(traceRes.error)
        }
      }
      throw new Error('Trace recording timed out.')
    } catch (e: any) {
      setVisualizerTrace([{
        id: 1,
        event: 'exception',
        action: 'exception',
        line: 0,
        source: '',
        function: 'main',
        frameId: 'main',
        frames: [],
        locals: {},
        variablesBefore: {},
        changes: [],
        description: e.message || 'Visualization failed.',
        beginnerText: e.message || 'Visualization failed.',
        why: 'Execution could not be recorded.',
        nextAction: 'Fix errors and try running again.',
        inputs: [],
        stdout: '',
        error: e.message || String(e),
        isImportant: true
      }])
      setErrors([{
        language: activeFile.language,
        severity: 'error',
        file: activeFile.name,
        line: 0,
        column: null,
        functionContext: null,
        rawMessage: e.message || String(e),
        simplifiedMessage: e.message || 'Visualizer error.'
      }])
      setActiveBottomTab('errors')
    } finally {
      useExecutionStore.getState().setIsVisualizing(false)
    }
  }, [activeFile, status, recordedInput, clearAiSuggestions, setVisualizerTrace, setVisualizerVisible, setErrors, setActiveBottomTab])

  // Stop running execution
  const handleStop = useCallback(async () => {
    if (sessionId) {
      await platform.stopJob(sessionId)
      setStatus('stopped')
      setSessionId(null)
    }
  }, [sessionId, setStatus, setSessionId])

  // Open file from local computer
  const handleOpenFile = useCallback(async () => {
    const res = await platform.openLocalFile()
    if (res.success && res.name && res.content !== undefined) {
      openFile(res.name, res.name, res.content)
    }
  }, [openFile])

  // Open folder from local computer
  const handleOpenFolder = useCallback(async () => {
    const res = await platform.openLocalFolder()
    if (res.success && res.files) {
      for (const f of res.files) {
        openFile(f.name, f.name, f.content)
      }
    }
  }, [openFile])

  // Keyboard shortcuts
  useEffect(() => {
    const onSave = (): void => { handleSave() }
    const onRun = (): void => { handleRun() }

    window.addEventListener('codeforge:save', onSave)
    window.addEventListener('codeforge:run', onRun)

    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        handleExport()
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
  }, [handleSave, handleExport, handleRun, handleOpenFile])

  // Sidebar resize
  const handleSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (ev: MouseEvent): void => {
      const delta = ev.clientX - startX
      setSidebarWidth(Math.max(180, Math.min(450, startWidth + delta)))
    }
    const onMouseUp = (): void => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  // Bottom panel resize
  const handleBottomResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = bottomPanelHeight

    const onMouseMove = (ev: MouseEvent): void => {
      const delta = startY - ev.clientY
      setBottomPanelHeight(Math.max(120, Math.min(600, startHeight + delta)))
    }
    const onMouseUp = (): void => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'row-resize'
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

  if (isAdminRoute) {
    return <AdminPanel onBackToIde={() => navigateTo('/')} />
  }

  return (
    <div className="app-shell">
      {/* Top Menu & Toolbar */}
      <div className="app-menubar">
        <div className="app-title">
          <div className="app-title-icon" />
          CodeForge Web
        </div>

        <div className="menu-item" onClick={handleSave}>Save Draft</div>
        <div className="menu-item" onClick={handleExport}>Export File</div>
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
              {(['python', 'cpp', 'c'] as LanguageId[]).map((lang) => (
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
              <div
                className="menu-item"
                style={{ padding: 'var(--space-2) var(--space-4)', borderTop: '1px solid var(--border-primary)', color: 'var(--accent-blue)' }}
                onClick={() => {
                  loadStarterFiles()
                  setShowNewMenu(false)
                }}
              >
                🔄 Reset to Starter Files (Py, C++, C)
              </div>
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
          title="Toggle Gemini Assistant"
        >
          ✨ AI
        </button>

        <button
          className="toolbar-btn"
          onClick={openAiKeyModal}
          title="Manage Gemini API Keys (BYOK - Save up to 5 keys in browser)"
          style={{
            borderColor: aiKeys.length > 0 ? 'rgba(46, 160, 67, 0.4)' : 'rgba(210, 153, 34, 0.5)',
            color: aiKeys.length > 0 ? 'var(--accent-green)' : 'var(--accent-amber)',
            fontWeight: 500
          }}
        >
          🔑 AI Keys ({aiKeys.length}/5)
        </button>

        <button
          className="toolbar-btn"
          onClick={() => setShowSetup(true)}
          title="Toolchains and Status"
        >
          ⚡ Runner
        </button>

        <button
          className="toolbar-btn"
          onClick={() => navigateTo('/admin')}
          title="Admin Panel (/admin) - Configure system Gemini keys & server anti-sleep"
          style={{ color: 'var(--text-secondary)' }}
        >
          🔐 Admin
        </button>

        <div className="toolbar-spacer" />
        {activeFile && <LanguageBadge language={activeFile.language} />}
      </div>

      {/* Main Workspace Body */}
      <div className="app-body">
        <div style={{ width: sidebarWidth, minWidth: 180, maxWidth: 450 }}>
          <FileTree />
        </div>

        <div className="drag-handle-horizontal" onMouseDown={handleSidebarResize} />

        <div className="app-main">
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

          <div className="drag-handle-vertical" onMouseDown={handleBottomResize} />

          <div style={{ height: bottomPanelHeight, minHeight: 120 }}>
            <BottomPanel />
          </div>
        </div>
      </div>

      {/* Status Bar */}
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

      {showNewMenu && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100 }}
          onClick={() => setShowNewMenu(false)}
        />
      )}

      {showSetup && <SetupAssistant onDismiss={() => setShowSetup(false)} />}
      {isAiKeyModalOpen && <AiKeyModal onDismiss={closeAiKeyModal} />}
    </div>
  )
}
