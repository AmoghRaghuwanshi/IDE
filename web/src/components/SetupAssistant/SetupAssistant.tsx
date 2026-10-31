import { useState, useEffect } from 'react'
import type { LanguageId, ToolchainStatus } from '../../shared/types'
import { platform } from '../../platform/remoteAdapter'

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
        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {labels[status.language]}
        </div>
        {status.available ? (
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: 'monospace' }}>
            {status.version || status.path}
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--accent-red)', marginTop: '2px' }}>
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
        const result = await platform.detectToolchain()
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

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">⚡ Environment & Toolchains</div>
        </div>

        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
            CodeForge Web connects to our execution runner to compile and run your C, C++, and Python code.
            Status for each language runner:
          </p>

          {isDetecting ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', gap: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Checking runner status…</span>
            </div>
          ) : toolchains ? (
            <div>
              {(['c', 'cpp', 'python'] as LanguageId[]).map((lang) => (
                <ToolchainRow key={lang} status={toolchains[lang]} />
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--accent-red)', textAlign: 'center', padding: '16px' }}>
              Failed to connect to runner. Please check network connectivity.
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--border-primary)' }}>
          <button className="toolbar-btn primary" onClick={onDismiss}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}
