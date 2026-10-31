import { useState, useEffect } from 'react'
import type { LanguageId, ToolchainStatus } from '../../../../shared/types'

interface SetupAssistantProps {
  onDismiss: () => void
}

function ToolchainRow({ status }: { status: ToolchainStatus }) {
  const labels: Record<LanguageId, string> = { c: 'GCC (C Compiler)', cpp: 'G++ (C++ Compiler)', python: 'Python Interpreter' }
  const icons: Record<LanguageId, string> = { c: '🔵', cpp: '🟣', python: '🟢' }

  return (
    <div className={`setup-toolchain-item ${status.available ? 'available' : 'missing'}`}>
      <span style={{ fontSize: '20px' }}>{icons[status.language]}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 'var(--font-weight-medium)' as string, color: 'var(--text-primary)' }}>
          {labels[status.language]}
        </div>
        {status.available ? (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
            {status.version || status.path}
          </div>
        ) : (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent-red)', marginTop: '2px' }}>
            Not found — {status.error || 'not installed'}
          </div>
        )}
      </div>
      <div>
        {status.available ? (
          <span style={{ color: 'var(--accent-green)', fontSize: '18px' }}>✓</span>
        ) : (
          <span style={{ color: 'var(--accent-red)', fontSize: '18px' }}>✗</span>
        )}
      </div>
    </div>
  )
}

export default function SetupAssistant({ onDismiss }: SetupAssistantProps) {
  const [toolchains, setToolchains] = useState<Record<LanguageId, ToolchainStatus> | null>(null)
  const [isDetecting, setIsDetecting] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function detect(): Promise<void> {
      setIsDetecting(true)
      try {
        const result = await window.api.detectToolchain()
        if (!cancelled) {
          setToolchains(result)
        }
      } catch (err) {
        console.error('Toolchain detection failed:', err)
      } finally {
        if (!cancelled) setIsDetecting(false)
      }
    }
    detect()
    return () => { cancelled = true }
  }, [])

  const allAvailable = toolchains
    ? Object.values(toolchains).every((t) => t.available)
    : false

  const anyAvailable = toolchains
    ? Object.values(toolchains).some((t) => t.available)
    : false

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⚡ Setup Assistant</div>
        </div>

        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-5)', lineHeight: 'var(--line-height-relaxed)' }}>
            CodeForge needs compilers and interpreters to compile and run your code.
            Here's what was detected on your system:
          </p>

          {isDetecting ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)', gap: 'var(--space-3)' }}>
              <div className="spinner" />
              <span style={{ color: 'var(--text-secondary)' }}>Detecting toolchains…</span>
            </div>
          ) : toolchains ? (
            <div>
              {(['c', 'cpp', 'python'] as LanguageId[]).map((lang) => (
                <ToolchainRow key={lang} status={toolchains[lang]} />
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--accent-red)', textAlign: 'center', padding: 'var(--space-4)' }}>
              Failed to detect toolchains. Please check your system setup.
            </div>
          )}

          {!isDetecting && !allAvailable && anyAvailable && (
            <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--accent-orange-dim)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--accent-orange)' }}>⚠ Some tools are missing.</strong>
              {' '}You can still use CodeForge for the languages that are available. Install the missing tools to enable all languages.
            </div>
          )}

          {!isDetecting && allAvailable && (
            <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--accent-green-dim)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--accent-green)' }}>✓ All toolchains detected!</strong>
              {' '}You're ready to compile and run C, C++, and Python programs.
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="toolbar-btn" onClick={onDismiss}>
            {anyAvailable ? 'Get Started' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
