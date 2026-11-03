import { useState } from 'react'
import { useAiKeyStore } from '../../state/aiKeyStore'

interface AiKeyModalProps {
  onDismiss: () => void
}

function maskKey(key: string): string {
  if (key.length <= 12) return '••••••••' + key.slice(-4)
  return key.slice(0, 8) + '••••••••' + key.slice(-4)
}

export default function AiKeyModal({ onDismiss }: AiKeyModalProps) {
  const keys = useAiKeyStore((s) => s.keys)
  const activeKeyIndex = useAiKeyStore((s) => s.activeKeyIndex)
  const addKey = useAiKeyStore((s) => s.addKey)
  const removeKey = useAiKeyStore((s) => s.removeKey)
  const setActiveKeyIndex = useAiKeyStore((s) => s.setActiveKeyIndex)

  const [inputKey, setInputKey] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleAdd = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    const result = addKey(inputKey)
    if (!result.success) {
      setErrorMessage(result.error || 'Failed to add API key.')
    } else {
      setInputKey('')
      setSuccessMessage('API key added successfully and saved for future sessions!')
      setTimeout(() => setSuccessMessage(null), 3500)
    }
  }

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div
        className="modal-content"
        style={{ maxWidth: '580px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🔑</span>
            <span>Gemini AI Key Management</span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '10px',
                background: keys.length > 0 ? 'rgba(46, 160, 67, 0.2)' : 'rgba(210, 153, 34, 0.2)',
                color: keys.length > 0 ? 'var(--accent-green)' : 'var(--accent-amber)',
                fontWeight: 600,
                marginLeft: 'auto'
              }}
            >
              {keys.length} / 5 Keys
            </span>
          </div>
        </div>

        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5, marginBottom: '14px' }}>
            To use AI Chat, inline code fixes, and error explanations, provide your own Google Gemini API key.
            Keys are <strong>saved locally in your browser</strong> so you never need to export environment variables.
          </p>

          <div
            style={{
              padding: '10px 14px',
              borderRadius: '6px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-primary)',
              fontSize: '12px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span style={{ color: 'var(--text-secondary)' }}>Need a free API key?</span>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              style={{
                color: 'var(--accent-blue)',
                textDecoration: 'none',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              Get Free Key from Google AI Studio ↗
            </a>
          </div>

          {/* Key list */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Configured Keys ({keys.length}/5)
            </div>

            {keys.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  borderRadius: '6px',
                  background: 'var(--bg-tertiary)',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '12px'
                }}
              >
                No Gemini keys added yet. Add a key below to enable AI assistance.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {keys.map((k, index) => {
                  const isActive = index === activeKeyIndex
                  return (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: isActive ? 'rgba(56, 139, 253, 0.1)' : 'var(--bg-tertiary)',
                        border: `1px solid ${isActive ? 'var(--accent-blue)' : 'var(--border-primary)'}`
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => setActiveKeyIndex(index)}
                          title={isActive ? 'Active key' : 'Click to make this key active'}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '2px',
                            color: isActive ? 'var(--accent-blue)' : 'var(--text-tertiary)'
                          }}
                        >
                          {isActive ? '●' : '○'}
                        </button>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-primary)' }}>
                          {maskKey(k)}
                        </span>
                        {isActive && (
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: 'var(--accent-blue)',
                              color: '#fff',
                              fontWeight: 600
                            }}
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {!isActive && (
                          <button
                            type="button"
                            className="toolbar-btn"
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                            onClick={() => setActiveKeyIndex(index)}
                          >
                            Set Active
                          </button>
                        )}
                        <button
                          type="button"
                          className="toolbar-btn danger"
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                          onClick={() => removeKey(index)}
                          title="Delete this key"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Add new key form */}
          {keys.length < 5 ? (
            <form onSubmit={handleAdd} style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Add New API Key:
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="AIzaSy..."
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-primary)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  className="toolbar-btn primary"
                  disabled={!inputKey.trim()}
                  style={{ padding: '8px 16px', fontSize: '12px' }}
                >
                  Add Key
                </button>
              </div>
            </form>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--accent-amber)', marginTop: '8px' }}>
              Maximum limit of 5 API keys reached. Delete an existing key if you wish to add a different one.
            </div>
          )}

          {errorMessage && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--accent-red)' }}>
              ⚠️ {errorMessage}
            </div>
          )}

          {successMessage && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--accent-green)' }}>
              ✓ {successMessage}
            </div>
          )}

          <div
            style={{
              marginTop: '16px',
              padding: '10px 12px',
              borderRadius: '6px',
              background: 'rgba(56, 139, 253, 0.05)',
              border: '1px solid rgba(56, 139, 253, 0.2)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              lineHeight: 1.4
            }}
          >
            💡 <strong>Automatic Quota Rotation:</strong> When you add multiple keys, CodeForge will automatically switch to your next key if your active key encounters a rate limit (HTTP 429).
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--border-primary)' }}>
          <button className="toolbar-btn primary" onClick={onDismiss}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
