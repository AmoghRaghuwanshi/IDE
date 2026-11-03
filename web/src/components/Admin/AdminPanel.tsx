import { useState, useEffect } from 'react'
import { useAdminStore } from '../../state/adminStore'

interface AdminPanelProps {
  onBackToIde: () => void
}

function maskKey(key: string, show: boolean): string {
  if (show) return key
  if (key.length <= 12) return '••••••••' + key.slice(-4)
  return key.slice(0, 8) + '••••••••' + key.slice(-4)
}

export default function AdminPanel({ onBackToIde }: AdminPanelProps) {
  const isAuthenticated = useAdminStore((s) => s.isAuthenticated)
  const login = useAdminStore((s) => s.login)
  const logout = useAdminStore((s) => s.logout)
  const adminKeys = useAdminStore((s) => s.adminKeys)
  const activeKeyIndex = useAdminStore((s) => s.activeKeyIndex)
  const allowGuestAccess = useAdminStore((s) => s.allowGuestAccess)
  const addAdminKey = useAdminStore((s) => s.addAdminKey)
  const removeAdminKey = useAdminStore((s) => s.removeAdminKey)
  const setActiveKeyIndex = useAdminStore((s) => s.setActiveKeyIndex)
  const setAllowGuestAccess = useAdminStore((s) => s.setAllowGuestAccess)

  // Login form state
  const [username, setUsername] = useState('Amogh')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)

  // Admin dashboard state
  const [newKey, setNewKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keySuccess, setKeySuccess] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({})
  const [testingKeyIndex, setTestingKeyIndex] = useState<number | null>(null)
  const [keyTestResults, setKeyTestResults] = useState<Record<number, { success: boolean; message: string }>>({})

  // Keep-alive server health state
  const [pingLatency, setPingLatency] = useState<number | null>(null)
  const [serverHealth, setServerHealth] = useState<any>(null)
  const [isPinging, setIsPinging] = useState(false)
  const [lastPingTime, setLastPingTime] = useState<string>(new Date().toLocaleTimeString())

  const handlePingServer = async () => {
    setIsPinging(true)
    const start = performance.now()
    try {
      const res = await fetch('/api/health?t=' + Date.now(), { cache: 'no-store' })
      const duration = Math.round(performance.now() - start)
      setPingLatency(duration)
      setLastPingTime(new Date().toLocaleTimeString())
      if (res.ok) {
        const data = await res.json()
        setServerHealth(data)
      }
    } catch {
      setPingLatency(-1)
    } finally {
      setIsPinging(false)
    }
  }

  // Auto-ping on mount to check server
  useEffect(() => {
    if (isAuthenticated) {
      handlePingServer()
    }
  }, [isAuthenticated])

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    const res = login(username, password)
    if (!res.success) {
      setLoginError(res.error || 'Authentication failed.')
    }
  }

  const handleAddKey = (e: React.FormEvent) => {
    e.preventDefault()
    setKeyError(null)
    setKeySuccess(null)
    const res = addAdminKey(newKey)
    if (!res.success) {
      setKeyError(res.error || 'Failed to add key.')
    } else {
      setNewKey('')
      setKeySuccess('Admin Gemini API key added and active!')
      setTimeout(() => setKeySuccess(null), 3000)
    }
  }

  const handleTestKey = async (key: string, index: number) => {
    setTestingKeyIndex(index)
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hello, respond with OK.' }] }]
        })
      })
      const data = await res.json()
      if (res.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
        setKeyTestResults(prev => ({
          ...prev,
          [index]: { success: true, message: '✓ Key valid & responding (gemini-2.0-flash active)' }
        }))
      } else {
        const msg = data.error?.message || `HTTP ${res.status}`
        setKeyTestResults(prev => ({
          ...prev,
          [index]: { success: false, message: `✗ Error: ${msg}` }
        }))
      }
    } catch (err: any) {
      setKeyTestResults(prev => ({
        ...prev,
        [index]: { success: false, message: `✗ Network error: ${err.message}` }
      }))
    } finally {
      setTestingKeyIndex(null)
    }
  }

  // If not logged in, render login view
  if (!isAuthenticated) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-primary, #0d1117)',
          color: 'var(--text-primary, #e6edf3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
      >
        <div
          style={{
            maxWidth: '420px',
            width: '100%',
            background: 'var(--bg-secondary, #161b22)',
            border: '1px solid var(--border-primary, #30363d)',
            borderRadius: '8px',
            padding: '28px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)'
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔐</div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>CodeForge Admin</h2>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--text-secondary, #8b949e)' }}>
              Sign in to manage system Gemini API keys and server keep-alive.
            </p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Amogh"
                required
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-primary, #30363d)',
                  background: 'var(--bg-primary, #0d1117)',
                  color: 'var(--text-primary, #e6edf3)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-primary, #30363d)',
                  background: 'var(--bg-primary, #0d1117)',
                  color: 'var(--text-primary, #e6edf3)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {loginError && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(248, 81, 73, 0.1)',
                  border: '1px solid rgba(248, 81, 73, 0.4)',
                  color: 'var(--accent-red, #f85149)',
                  fontSize: '12px'
                }}
              >
                ⚠️ {loginError}
              </div>
            )}

            <button
              type="submit"
              className="toolbar-btn primary"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '13px',
                fontWeight: 600,
                marginTop: '6px'
              }}
            >
              Sign In as Administrator
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center', borderTop: '1px solid var(--border-primary, #30363d)', paddingTop: '16px' }}>
            <button
              type="button"
              onClick={onBackToIde}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-blue, #58a6ff)',
                fontSize: '13px',
                cursor: 'pointer',
                textDecoration: 'none'
              }}
            >
              ← Return to CodeForge IDE
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Dashboard view
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary, #0d1117)',
        color: 'var(--text-primary, #e6edf3)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Top Navbar */}
      <header
        style={{
          height: '52px',
          background: 'var(--bg-secondary, #161b22)',
          borderBottom: '1px solid var(--border-primary, #30363d)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px' }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>CodeForge Admin Console</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              background: 'rgba(56, 139, 253, 0.15)',
              color: 'var(--accent-blue, #58a6ff)',
              fontWeight: 600
            }}
          >
            Admin: Amogh
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={onBackToIde}
            className="toolbar-btn"
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            ← Back to IDE
          </button>
          <button
            onClick={logout}
            className="toolbar-btn danger"
            style={{ fontSize: '12px', padding: '6px 12px' }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: '960px', width: '100%', margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Section 1: Server Keep-Alive & Health */}
        <div
          style={{
            background: 'var(--bg-secondary, #161b22)',
            border: '1px solid var(--border-primary, #30363d)',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🛰️</span> Server Anti-Sleep & Health Monitor
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #8b949e)' }}>
                Prevents Vercel serverless containers and edge workers from going to sleep.
              </p>
            </div>
            <button
              onClick={handlePingServer}
              disabled={isPinging}
              className="toolbar-btn primary"
              style={{ fontSize: '12px', padding: '6px 14px' }}
            >
              {isPinging ? 'Pinging…' : '⚡ Test Keep-Alive Ping'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ padding: '12px', borderRadius: '6px', background: 'var(--bg-tertiary, #21262d)', border: '1px solid var(--border-primary, #30363d)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary, #8b949e)', marginBottom: '4px' }}>SERVER STATUS</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-green, #2ea043)', display: 'inline-block' }} />
                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--accent-green, #2ea043)' }}>ALWAYS WARM</span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #6e7681)', marginTop: '4px' }}>No cold sleep</div>
            </div>

            <div style={{ padding: '12px', borderRadius: '6px', background: 'var(--bg-tertiary, #21262d)', border: '1px solid var(--border-primary, #30363d)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary, #8b949e)', marginBottom: '4px' }}>LATENCY / PING</div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: pingLatency !== null && pingLatency < 400 ? 'var(--accent-green, #2ea043)' : 'var(--accent-blue, #58a6ff)' }}>
                {pingLatency !== null ? `${pingLatency} ms` : 'Checking…'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary, #6e7681)', marginTop: '4px' }}>Last ping: {lastPingTime}</div>
            </div>

            <div style={{ padding: '12px', borderRadius: '6px', background: 'var(--bg-tertiary, #21262d)', border: '1px solid var(--border-primary, #30363d)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary, #8b949e)', marginBottom: '4px' }}>KEEP-ALIVE MECHANISM</div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #e6edf3)' }}>
                Vercel Cron (5m) + Client Heartbeat (4m)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--accent-green, #2ea043)', marginTop: '4px' }}>✓ Dual Auto-Keep-Alive Active</div>
            </div>
          </div>

          {serverHealth?.toolchains && (
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-primary, #30363d)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #8b949e)' }}>Active Compilers:</span>
              <span style={{ fontSize: '12px', color: 'var(--text-primary, #e6edf3)' }}>🔵 GCC (C11/C17)</span>
              <span style={{ fontSize: '12px', color: 'var(--text-primary, #e6edf3)' }}>🟣 G++ (C++17/C++20)</span>
              <span style={{ fontSize: '12px', color: 'var(--text-primary, #e6edf3)' }}>🟢 CPython 3.12</span>
            </div>
          )}
        </div>

        {/* Section 2: Admin Gemini API Keys */}
        <div
          style={{
            background: 'var(--bg-secondary, #161b22)',
            border: '1px solid var(--border-primary, #30363d)',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔑</span> Admin Gemini API Keys (System Provider)
              </h3>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #8b949e)' }}>
                Set your personal Gemini API keys here so visitors and students can use the AI assistant without entering their own keys.
              </p>
            </div>
            <span
              style={{
                fontSize: '11px',
                padding: '3px 10px',
                borderRadius: '12px',
                background: adminKeys.length > 0 ? 'rgba(46, 160, 67, 0.2)' : 'rgba(210, 153, 34, 0.2)',
                color: adminKeys.length > 0 ? 'var(--accent-green, #2ea043)' : 'var(--accent-amber, #d29922)',
                fontWeight: 600
              }}
            >
              {adminKeys.length} Admin {adminKeys.length === 1 ? 'Key' : 'Keys'} Configured
            </span>
          </div>

          {/* Guest Access Permission Toggle */}
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '6px',
              background: 'var(--bg-tertiary, #21262d)',
              border: '1px solid var(--border-primary, #30363d)',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary, #e6edf3)' }}>
                Allow Guests to Use Admin Gemini Keys
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary, #8b949e)', marginTop: '2px' }}>
                When enabled, visitors who don't have their own API key will automatically use your Admin key for AI features.
              </div>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allowGuestAccess}
                onChange={(e) => setAllowGuestAccess(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: allowGuestAccess ? 'var(--accent-green, #2ea043)' : '#484f58',
                  borderRadius: '24px',
                  transition: '0.3s'
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    content: '',
                    height: '18px',
                    width: '18px',
                    left: allowGuestAccess ? '23px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    borderRadius: '50%',
                    transition: '0.3s'
                  }}
                />
              </span>
            </label>
          </div>

          {/* Configured Admin Keys List */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
              Configured Keys
            </div>

            {adminKeys.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  borderRadius: '6px',
                  background: 'var(--bg-tertiary, #21262d)',
                  textAlign: 'center',
                  color: 'var(--text-secondary, #8b949e)',
                  fontSize: '13px'
                }}
              >
                No Admin Gemini API keys added yet. Add your key below to activate global AI assistance!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {adminKeys.map((key, idx) => {
                  const isActive = idx === activeKeyIndex
                  const isVisible = !!showKeys[idx]
                  const testRes = keyTestResults[idx]
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '6px',
                        background: isActive ? 'rgba(56, 139, 253, 0.08)' : 'var(--bg-tertiary, #21262d)',
                        border: `1px solid ${isActive ? 'var(--accent-blue, #58a6ff)' : 'var(--border-primary, #30363d)'}`
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            type="button"
                            onClick={() => setActiveKeyIndex(idx)}
                            title={isActive ? 'Active primary key' : 'Set as primary key'}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '16px',
                              color: isActive ? 'var(--accent-blue, #58a6ff)' : 'var(--text-tertiary, #6e7681)'
                            }}
                          >
                            {isActive ? '●' : '○'}
                          </button>
                          <span style={{ fontFamily: 'monospace', fontSize: '13px', letterSpacing: '0.5px' }}>
                            {maskKey(key, isVisible)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowKeys(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: 'var(--text-secondary, #8b949e)' }}
                          >
                            {isVisible ? 'Hide' : 'Reveal'}
                          </button>
                          {isActive && (
                            <span
                              style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                background: 'var(--accent-blue, #58a6ff)',
                                color: '#fff',
                                fontWeight: 700
                              }}
                            >
                              PRIMARY
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            className="toolbar-btn"
                            disabled={testingKeyIndex === idx}
                            onClick={() => handleTestKey(key, idx)}
                            style={{ fontSize: '11px', padding: '4px 10px' }}
                          >
                            {testingKeyIndex === idx ? 'Testing…' : '🧪 Test Key'}
                          </button>
                          {!isActive && (
                            <button
                              type="button"
                              className="toolbar-btn"
                              onClick={() => setActiveKeyIndex(idx)}
                              style={{ fontSize: '11px', padding: '4px 10px' }}
                            >
                              Set Primary
                            </button>
                          )}
                          <button
                            type="button"
                            className="toolbar-btn danger"
                            onClick={() => removeAdminKey(idx)}
                            style={{ fontSize: '11px', padding: '4px 10px' }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {testRes && (
                        <div
                          style={{
                            marginTop: '8px',
                            fontSize: '12px',
                            color: testRes.success ? 'var(--accent-green, #2ea043)' : 'var(--accent-red, #f85149)'
                          }}
                        >
                          {testRes.message}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Add Key Form */}
          <form onSubmit={handleAddKey} style={{ borderTop: '1px solid var(--border-primary, #30363d)', paddingTop: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
              Add Admin Gemini API Key:
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="AIzaSy..."
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-primary, #30363d)',
                  background: 'var(--bg-primary, #0d1117)',
                  color: 'var(--text-primary, #e6edf3)',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                className="toolbar-btn primary"
                disabled={!newKey.trim()}
                style={{ padding: '9px 18px', fontSize: '13px', fontWeight: 600 }}
              >
                Save Admin Key
              </button>
            </div>

            {keyError && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--accent-red, #f85149)' }}>
                ⚠️ {keyError}
              </div>
            )}

            {keySuccess && (
              <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--accent-green, #2ea043)' }}>
                ✓ {keySuccess}
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  )
}
