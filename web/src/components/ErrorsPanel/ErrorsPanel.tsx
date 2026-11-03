import { useRef, useState } from 'react'
import { useEditorStore } from '../../state/editorStore'
import { useAiKeyStore } from '../../state/aiKeyStore'
import type { NormalizedError } from '../../shared/types'
import { platform } from '../../platform/remoteAdapter'

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

  const openFiles = useEditorStore((s) => s.openFiles)
  
  const handleExplainError = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!useAiKeyStore.getState().hasKey()) {
      useAiKeyStore.getState().openModal('AI Error Explanation')
      return
    }
    setIsExplaining(true)
    setAiExplanation(null)
    const requestId = ++explainRequestRef.current
    
    const file = openFiles.find(f => f.path === error.file || f.name === error.file)
    const prompt = `Please explain this compilation diagnostic simply and provide a short snippet of how to fix it:
Error: ${error.rawMessage}
File: ${error.file}, Line: ${error.line}`

    try {
      const result = await platform.aiChat({
        prompt,
        context: {
          fileName: error.file,
          language: error.language,
          sourceCode: file?.content,
          line: error.line,
          error: error.rawMessage
        }
      })
      if (requestId === explainRequestRef.current) {
        if (result.success && result.text) {
          setAiExplanation(result.text)
        } else {
          setAiExplanation(`❌ AI: ${result.error || 'Failed to generate explanation'}`)
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
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 'normal', marginLeft: '8px' }}>
            {error.file}
          </span>
        </div>

        <div className="error-message">
          {error.simplifiedMessage || error.rawMessage}
        </div>

        {error.simplifiedMessage && (
          <div style={{ marginTop: '6px' }}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowRaw(!showRaw)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-tertiary)',
                fontSize: '11px',
                cursor: 'pointer',
                padding: 0
              }}
            >
              {showRaw ? 'Hide compiler message' : 'Show compiler message'}
            </button>
            {showRaw && (
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  marginTop: '4px',
                  padding: '4px 8px',
                  background: 'var(--bg-elevated)',
                  borderRadius: '4px',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {error.rawMessage}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '8px' }}>
          <button
            onClick={handleExplainError}
            disabled={isExplaining}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-secondary)',
              color: 'var(--accent-blue)',
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '4px',
              cursor: isExplaining ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>✨</span>
            <span>{isExplaining ? 'Explaining...' : 'Explain with AI'}</span>
          </button>

          {aiExplanation && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-primary)',
                borderRadius: '6px',
                fontSize: '12px',
                lineHeight: 1.5,
                color: 'var(--text-primary)'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--accent-blue)', marginBottom: '4px' }}>
                ✨ AI Explanation
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{aiExplanation}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ErrorsPanel() {
  const errors = useEditorStore((s) => s.errors)

  if (errors.length === 0) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <div className="empty-state-icon" style={{ fontSize: '24px' }}>✓</div>
        <div className="empty-state-title" style={{ fontSize: '14px' }}>No Errors</div>
        <div className="empty-state-text" style={{ fontSize: '12px' }}>
          Your code compiled cleanly.
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {errors.map((error, idx) => (
        <ErrorItem key={idx} error={error} />
      ))}
    </div>
  )
}
