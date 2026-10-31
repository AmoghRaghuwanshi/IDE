import { useRef, useState } from 'react'
import { useEditorStore } from '../../state/editorStore'
import type { NormalizedError } from '../../../../shared/types'

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case 'error':
      return <span className="error-severity-icon error">✕</span>
    case 'warning':
      return <span className="error-severity-icon warning">⚠</span>
    case 'note':
      return <span className="error-severity-icon note">ℹ</span>
    default:
      return <span className="error-severity-icon">•</span>
  }
}

function ErrorItem({ error }: { error: NormalizedError }) {
  const [showRaw, setShowRaw] = useState(false)
  const [isExplaining, setIsExplaining] = useState(false)
  const [aiExplanation, setAiExplanation] = useState<string | null>(null)
  const explainRequestRef = useRef(0)

  // Get the file content to give the AI context
  const openFiles = useEditorStore((s) => s.openFiles)
  
  const handleExplainError = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const apiKeys = (() => {
      try {
        const stored = localStorage.getItem('codeforge_gemini_keys')
        const parsed: unknown = stored ? JSON.parse(stored) : []
        return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string' && key.trim().length > 0) : []
      } catch {
        return []
      }
    })()
    if (!apiKeys || apiKeys.length === 0) {
      setAiExplanation('⚠️ Please add a Gemini API key in the Chat panel settings first.')
      return
    }

    setIsExplaining(true)
    setAiExplanation(null)
    const requestId = ++explainRequestRef.current
    
    // Find the file content if available
    const file = openFiles.find(f => f.path === error.file || f.name === error.file)
    // Only send ±20 lines around the error to save API tokens
    let codeContext = ''
    if (file) {
      const lines = file.content.split('\n')
      const start = Math.max(0, error.line - 20)
      const end = Math.min(lines.length, error.line + 20)
      codeContext = `\n\nCode Context (lines ${start + 1}-${end}):\n\`\`\`\n${lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')}\n\`\`\``
    }
    
    const prompt = `I got the following error in my code. Explain what it means simply, and provide a short snippet of how to fix it.
    
Error Message:
${error.rawMessage}

File: ${error.file}
Line: ${error.line}
${codeContext}

Provide a short explanation and the corrected code.`

    try {
      const result = await window.api.aiChat({ apiKeys, prompt })
      if (requestId === explainRequestRef.current) {
        if (result.success && result.text) {
          setAiExplanation(result.text)
        } else {
          setAiExplanation(`❌ AI Error: ${result.error || 'Failed to generate explanation'}`)
        }
      }
    } catch (err: any) {
      if (requestId === explainRequestRef.current) setAiExplanation(`❌ Error: ${err.message || 'Unknown error'}`)
    } finally {
      if (requestId === explainRequestRef.current) setIsExplaining(false)
    }
  }

  const handleClick = (): void => {
    window.dispatchEvent(
      new CustomEvent('codeforge:navigate-to-line', {
        detail: { line: error.line, column: error.column || 1 }
      })
    )
  }

  return (
    <div className={`error-item severity-${error.severity}`} onClick={handleClick}>
      <SeverityIcon severity={error.severity} />
      <div className="error-content">
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Line {error.line}
          {error.column ? ` (Col ${error.column})` : ''}
          {error.functionContext ? ` in ${error.functionContext}()` : ''}
          
          <button
            onClick={handleExplainError}
            disabled={isExplaining}
            className="toolbar-btn"
            style={{ 
              marginLeft: '12px', fontSize: '11px', padding: '2px 8px', background: 'var(--bg-primary)',
              color: 'var(--accent-green)', borderColor: 'var(--border-secondary)',
              opacity: isExplaining ? 0.5 : 1
            }}
            title="Explain and fix with AI"
          >
            {isExplaining ? '✨ Thinking...' : '✨ Explain & Fix'}
          </button>
        </div>
        <div className="error-message" style={{ color: 'var(--text-secondary)' }}>
          {error.simplifiedMessage || error.rawMessage}
        </div>
        <span
          className="error-raw-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setShowRaw(!showRaw)
          }}
        >
          {showRaw ? '▾ Hide raw output' : '▸ Show raw output'}
        </span>
        {showRaw && <div className="error-raw-output">{error.rawMessage}</div>}
        
        {aiExplanation && (
          <div style={{
            background: 'rgba(63, 185, 80, 0.1)', border: '1px solid rgba(63, 185, 80, 0.3)',
            borderRadius: '6px', padding: '10px', marginTop: '8px',
            color: 'var(--text-primary)', fontSize: '12px', lineHeight: 1.4, cursor: 'text'
          }} onClick={(e) => e.stopPropagation()}>
            <strong style={{ color: 'var(--accent-green)', display: 'block', marginBottom: '4px' }}>✨ AI Explanation & Fix:</strong>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {aiExplanation}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ErrorsPanel() {
  const errors = useEditorStore((s) => s.errors)

  if (errors.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-tertiary)',
          fontSize: 'var(--font-size-sm)',
          gap: 'var(--space-2)'
        }}
      >
        <span style={{ color: 'var(--accent-green)' }}>✓</span>
        No errors or warnings
      </div>
    )
  }

  const errorCount = errors.filter((e) => e.severity === 'error').length
  const warningCount = errors.filter((e) => e.severity === 'warning').length

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div
        style={{
          padding: 'var(--space-2) var(--space-4)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-tertiary)',
          borderBottom: '1px solid var(--border-secondary)',
          display: 'flex',
          gap: 'var(--space-4)'
        }}
      >
        {errorCount > 0 && (
          <span style={{ color: 'var(--accent-red)' }}>
            {errorCount} error{errorCount !== 1 ? 's' : ''}
          </span>
        )}
        {warningCount > 0 && (
          <span style={{ color: 'var(--accent-orange)' }}>
            {warningCount} warning{warningCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="error-list">
        {errors.map((error, index) => (
          <ErrorItem key={`${error.file}-${error.line}-${index}`} error={error} />
        ))}
      </div>
    </div>
  )
}
