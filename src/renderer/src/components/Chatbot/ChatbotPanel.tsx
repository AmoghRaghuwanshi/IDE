import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorStore } from '../../state/editorStore'
import { useExecutionStore } from '../../state/executionStore'

type Message = { role: 'user' | 'model'; content: string }

export default function ChatbotPanel({ onClose }: { onClose: () => void }) {
  const [apiKeys, setApiKeys] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('codeforge_gemini_keys')
      const parsed: unknown = stored ? JSON.parse(stored) : []
      return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string' && key.trim().length > 0) : []
    } catch {
      return []
    }
  })
  
  const [showSettings, setShowSettings] = useState(apiKeys.length === 0)
  const [newKeyInput, setNewKeyInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [mergeMessage, setMergeMessage] = useState('')
  const mergeRequest = useRef(0)

  const activeFileId = useEditorStore((s) => s.activeFileId)
  const openFiles = useEditorStore((s) => s.openFiles)
  const errors = useEditorStore((s) => s.errors)
  const setAiSuggestions = useEditorStore((s) => s.setAiSuggestions)
  const clearAiSuggestions = useEditorStore((s) => s.clearAiSuggestions)
  const activeFile = openFiles.find((f) => f.id === activeFileId)
  const compilationOutput = useExecutionStore((s) => s.compilationOutput)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])


  const saveKeys = useCallback((keys: string[]) => {
    setApiKeys(keys)
    localStorage.setItem('codeforge_gemini_keys', JSON.stringify(keys))
  }, [])

  const handleAddKey = useCallback(() => {
    if (newKeyInput.trim() && apiKeys.length < 5 && !apiKeys.includes(newKeyInput.trim())) {
      const updatedKeys = [...apiKeys, newKeyInput.trim()]
      saveKeys(updatedKeys)
      setNewKeyInput('')
      if (updatedKeys.length === 1) {
        setShowSettings(false)
      }
    }
  }, [newKeyInput, apiKeys, saveKeys])

  const handleRemoveKey = useCallback((index: number) => {
    const newKeys = [...apiKeys]
    newKeys.splice(index, 1)
    saveKeys(newKeys)
    if (newKeys.length === 0) setShowSettings(true)
  }, [apiKeys, saveKeys])

  const handleClearChat = useCallback(() => {
    setMessages([])
    clearAiSuggestions()
  }, [clearAiSuggestions])

  const handleSendMessage = async () => {
    if (!input.trim() || apiKeys.length === 0) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    // Build rich context — limit code to 200 lines to save tokens
    const codeSnippet = activeFile?.content
      ? activeFile.content.split('\n').slice(0, 200).join('\n')
      : ''
    let context = `Context:\n- File: ${activeFile?.name || 'Unknown'}\n- Language: ${activeFile?.language || 'Unknown'}\n- Code:\n\`\`\`\n${codeSnippet}\n\`\`\`\n`
    if (errors.length > 0) {
      context += `- Current Compiler Errors:\n${errors.map(e => `  Line ${e.line}: [${e.severity}] ${e.simplifiedMessage || e.rawMessage}`).join('\n')}\n`
    }
    if (compilationOutput) {
      context += `- Recent Output:\n\`\`\`\n${compilationOutput.slice(-500)}\n\`\`\`\n`
    }

    const systemInstruction = `You are an AI programming assistant embedded in a code editor called CodeForge.
You have full context about the user's current file, compilation errors, and runtime output.

RULES:
1. Match the user's coding style. Be concise.
2. If the user asks about errors, identify the exact line numbers.
3. Never repeat the entire source file. Return only the answer and, when needed, the smallest code snippet required for the requested change.
4. Explain what changed before showing a small snippet. The editor's Apply button handles changes safely through a diff.

If you can identify specific problematic lines, include a JSON block at the END of your response like this:
\`\`\`json
{"aiSuggestions": [{"line": 4, "message": "Missing semicolon"}]}
\`\`\`
Only include this JSON block if you have specific line-level suggestions. Otherwise, just reply with plain text.`

    const fullPrompt = systemInstruction + '\n\n' + context + '\n\nUser Request: ' + userMessage

    try {
      const result = await window.api.aiChat({
        apiKeys,
        prompt: fullPrompt
      })

      if (result.success && result.text) {
        let responseText = result.text.trim()
        let displayMessage = responseText

        // Try to extract aiSuggestions JSON block from the end
        try {
          const fencedMatch = responseText.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/)
          if (fencedMatch) {
            const jsonPart = fencedMatch[1].trim()
            const parsed = JSON.parse(jsonPart)
            if (parsed.aiSuggestions && Array.isArray(parsed.aiSuggestions)) {
              setAiSuggestions(parsed.aiSuggestions.filter(
                (s: any) => typeof s.line === 'number' && typeof s.message === 'string' && s.line > 0
              ))
            }
            // Remove the JSON block from the display message
            displayMessage = responseText.slice(0, fencedMatch.index).trim()

            // If the AI also put a "message" field inside the JSON, prefer that
            if (parsed.message && typeof parsed.message === 'string') {
              displayMessage = parsed.message
            }
          } else {
            // Try to parse the entire response as JSON (legacy format)
            // Use balanced brace extraction to find the outermost { }
            const firstBrace = responseText.indexOf('{')
            const lastBrace = responseText.lastIndexOf('}')
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              const candidate = responseText.substring(firstBrace, lastBrace + 1)
              try {
                const parsed = JSON.parse(candidate)
                if (parsed.message) {
                  displayMessage = parsed.message
                  if (parsed.aiSuggestions && Array.isArray(parsed.aiSuggestions)) {
                    setAiSuggestions(parsed.aiSuggestions.filter(
                      (s: any) => typeof s.line === 'number' && typeof s.message === 'string' && s.line > 0
                    ))
                  }
                }
              } catch {
                // Not valid JSON — just show the text as-is
              }
            }
          }
        } catch {
          // JSON parsing failed — display message stays as raw text, which is fine
        }

        if (!displayMessage) displayMessage = responseText
        setMessages((prev) => [...prev, { role: 'model', content: displayMessage }])
      } else {
        setMessages((prev) => [...prev, { role: 'model', content: `⚠️ ${result.error || 'AI request failed. Please try again.'}` }])
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: 'model', content: `⚠️ ${error.message || 'Unknown error. Check your API key and try again.'}` }])
    }

    setIsLoading(false)
  }

  // ---- Settings View ----
  if (showSettings) {
    return (
      <div className="chatbot-panel" style={{ width: '320px', borderLeft: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-elevated)' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>✨ AI Settings</h3>
          <div style={{ display: 'flex', gap: '4px' }}>
            {apiKeys.length > 0 && (
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', fontSize: '12px' }}>← Back</button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
          </div>
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Add up to 5 Gemini API Keys. If one hits its rate limit, the next key is used automatically.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {apiKeys.map((key, i) => (
              <div key={i} style={{
                display: 'flex', gap: '8px', alignItems: 'center',
                background: 'var(--bg-elevated)', padding: '6px 10px', borderRadius: '6px',
                border: '1px solid var(--border-secondary)'
              }}>
                <span style={{ color: 'var(--accent-blue)', fontSize: '11px', fontWeight: 600, width: '22px' }}>#{i+1}</span>
                <span style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                  {key.substring(0, 8)}····{key.substring(key.length - 4)}
                </span>
                <button onClick={() => handleRemoveKey(i)} style={{
                  background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer',
                  padding: '2px 6px', borderRadius: '4px', fontSize: '12px'
                }}>✕</button>
              </div>
            ))}
          </div>

          {apiKeys.length < 5 && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <input
                type="password"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                placeholder="Paste API key here…"
                style={{
                  flex: 1, padding: '8px 10px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-secondary)', color: 'var(--text-primary)',
                  borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', outline: 'none'
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
              />
              <button onClick={handleAddKey} className="toolbar-btn primary" disabled={!newKeyInput.trim()}>Add</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- Chat View ----
  return (
    <div className="chatbot-panel" style={{ width: '360px', borderLeft: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-elevated)' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>✨ Gemini AI</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {messages.length > 0 && (
            <button onClick={handleClearChat} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px', padding: '2px 6px' }} title="Clear chat">🗑</button>
          )}
          <button onClick={() => setShowSettings(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px', padding: '2px 6px' }} title="Manage API keys">
            ⚙ {apiKeys.length}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>
      </div>
      
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '40px', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '28px' }}>✨</span>
            <span style={{ fontSize: '12px', textAlign: 'center', lineHeight: 1.5 }}>
              Ask Gemini about your code, errors,<br/>or anything programming-related!
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '8px' }}>
              {['What does this code do?', 'Fix the error on this line', 'How can I optimize this?'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion) }}
                  style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-secondary)',
                    color: 'var(--text-secondary)', padding: '8px 12px', borderRadius: '8px',
                    cursor: 'pointer', fontSize: '12px', textAlign: 'left',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent-blue)'
                    e.currentTarget.style.color = 'var(--text-primary)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-secondary)'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                >
                  💬 {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ 
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            background: msg.role === 'user' ? 'linear-gradient(135deg, var(--accent-blue), #3d8bfd)' : 'var(--bg-elevated)',
            padding: '10px 14px',
            borderRadius: msg.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
            maxWidth: '90%',
            fontSize: '13px',
            lineHeight: 1.5,
            color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
            boxShadow: 'var(--shadow-sm)'
          }}>
            {msg.role === 'user' ? (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {msg.content.split(/(```[\s\S]*?```)/).map((part, index) => {
                  if (part.startsWith('```') && part.endsWith('```')) {
                    const lines = part.split(/\r?\n/)
                    const lang = lines[0].slice(3).trim()
                    const code = lines.slice(1, -1).join('\n')
                    return (
                      <div key={index} style={{
                        background: 'rgba(0,0,0,0.3)',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        marginTop: '4px',
                        marginBottom: '4px',
                        border: '1px solid var(--border-secondary)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(0,0,0,0.5)', fontSize: '11px', color: 'var(--text-muted)' }}>
                          <span>{lang || 'code'}</span>
                          <button
                            onClick={() => {
                              const activeFile = useEditorStore.getState().openFiles.find(f => f.id === useEditorStore.getState().activeFileId)
                              if (!activeFile) return
                              
                              // Trigger inline AI diff merge via IPC
                              const fileId = activeFile.id
                              const originalContent = activeFile.content
                              const request = ++mergeRequest.current
                              setMergeMessage('Preparing a change review. Your file will be updated only after you accept.')
                              useEditorStore.getState().setAiDiff({
                                fileId,
                                originalContent,
                                modifiedContent: '',
                                isApplying: true
                              })
                              window.api.aiMergeCode({
                                apiKeys,
                                currentContent: originalContent,
                                snippet: code,
                                language: activeFile.language
                              }).then(res => {
                                if (request !== mergeRequest.current) return
                                const currentDiff = useEditorStore.getState().aiDiff
                                if (currentDiff?.fileId !== fileId || currentDiff.originalContent !== originalContent) return
                                if (res.success && res.mergedContent?.trim()) {
                                  setMergeMessage(res.mergedContent === originalContent ? 'No changes were needed. The code already matches.' : 'Review the red previous lines and green proposed lines in the editor, then Accept or Reject.')
                                  useEditorStore.getState().setAiDiff({
                                    fileId,
                                    originalContent,
                                    modifiedContent: res.mergedContent,
                                    isApplying: false
                                  })
                                } else {
                                  setMergeMessage(res.error || 'Could not prepare the change review. Please try again.')
                                  console.error('Merge failed:', res.error)
                                  // Revert diff view on failure
                                  useEditorStore.getState().setAiDiff(null)
                                }
                              }).catch(error => {
                                if (request !== mergeRequest.current) return
                                const currentDiff = useEditorStore.getState().aiDiff
                                if (currentDiff?.fileId === fileId && currentDiff.originalContent === originalContent) {
                                  console.error('Merge request failed:', error)
                                  setMergeMessage(error instanceof Error ? error.message : 'Could not prepare the change review.')
                                  useEditorStore.getState().setAiDiff(null)
                                }
                              })
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            Review changes in editor
                          </button>
                        </div>
                        <pre style={{ margin: 0, padding: '10px', overflowX: 'auto', fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                          <code>{code}</code>
                        </pre>
                      </div>
                    )
                  }
                  return <div key={index} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{part}</div>
                })}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div style={{
            alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: '12px',
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0'
          }}>
            <span className="spinner" style={{ width: '14px', height: '14px' }} />
            Thinking…
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {mergeMessage && <div role="status" style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-primary)', borderTop: '1px solid var(--border-primary)' }}>{mergeMessage}</div>}
      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-primary)', display: 'flex', gap: '8px', background: 'var(--bg-elevated)' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
          placeholder="Ask about your code…"
          style={{
            flex: 1, padding: '8px 12px', background: 'var(--bg-primary)',
            border: '1px solid var(--border-secondary)', color: 'var(--text-primary)',
            borderRadius: '8px', fontSize: '13px', outline: 'none'
          }}
          disabled={isLoading}
        />
        <button
          onClick={handleSendMessage}
          disabled={isLoading || !input.trim()}
          className="toolbar-btn primary"
          style={{ borderRadius: '8px' }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
