import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorStore } from '../../state/editorStore'
import { useExecutionStore } from '../../state/executionStore'
import { useAiKeyStore } from '../../state/aiKeyStore'
import { platform } from '../../platform/remoteAdapter'

type Message = { role: 'user' | 'model'; content: string }

export default function ChatbotPanel({ onClose }: { onClose: () => void }) {
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
  const recordedOutput = useExecutionStore((s) => s.recordedOutput)
  const openAiKeyModal = useAiKeyStore((s) => s.openModal)
  const hasKeys = useAiKeyStore((s) => s.hasKey())
  const keysCount = useAiKeyStore((s) => s.keys.length)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleClearChat = useCallback(() => {
    setMessages([])
    clearAiSuggestions()
  }, [clearAiSuggestions])

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return

    if (!hasKeys) {
      openAiKeyModal('the Gemini AI Assistant')
      setMessages((prev) => [...prev, { role: 'model', content: '⚠️ Please add at least one Google Gemini API key to use the AI assistant.' }])
      return
    }

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsLoading(true)

    try {
      const result = await platform.aiChat({
        prompt: userMessage,
        context: {
          fileName: activeFile?.name,
          language: activeFile?.language,
          sourceCode: activeFile?.content,
          error: errors.length > 0 ? errors.map(e => `Line ${e.line}: [${e.severity}] ${e.simplifiedMessage || e.rawMessage}`).join('\n') : undefined,
          output: recordedOutput
        }
      })

      if (result.success && result.text) {
        let responseText = result.text.trim()
        let displayMessage = responseText

        // Parse optional aiSuggestions JSON block from the end
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
            displayMessage = responseText.slice(0, fencedMatch.index).trim()
            if (parsed.message && typeof parsed.message === 'string') {
              displayMessage = parsed.message
            }
          }
        } catch {
          /* keep raw text */
        }

        setMessages((prev) => [...prev, { role: 'model', content: displayMessage }])
      } else {
        setMessages((prev) => [...prev, { role: 'model', content: `⚠️ ${result.error || 'AI request failed.'}` }])
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: 'model', content: `⚠️ ${error.message || 'AI service unavailable.'}` }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="chatbot-panel" style={{ width: '340px', borderLeft: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>✨</span>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Gemini Assistant</h3>
          <button
            onClick={() => openAiKeyModal()}
            title="Manage Gemini API Keys"
            style={{
              background: 'none',
              border: '1px solid var(--border-primary)',
              borderRadius: '4px',
              fontSize: '11px',
              padding: '2px 6px',
              cursor: 'pointer',
              color: hasKeys ? 'var(--accent-green)' : 'var(--accent-amber)'
            }}
          >
            🔑 {keysCount}/5
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {messages.length > 0 && (
            <button onClick={handleClearChat} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: '12px' }} title="Clear Chat">Clear</button>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
        </div>
      </div>

      {!hasKeys && (
        <div
          style={{
            padding: '10px 12px',
            background: 'rgba(210, 153, 34, 0.1)',
            borderBottom: '1px solid rgba(210, 153, 34, 0.3)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span style={{ color: 'var(--accent-amber)' }}>⚠️ Add a Gemini key to chat</span>
          <button
            onClick={() => openAiKeyModal()}
            className="toolbar-btn primary"
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            Add Key
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>💡</div>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>How can I help with your code?</p>
            <p style={{ fontSize: '12px', lineHeight: 1.5 }}>
              Ask questions about compiler errors, algorithms, or how to implement a function.
            </p>
          </div>
        ) : null}

        {mergeMessage && (
          <div style={{ padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)', borderRadius: '6px', fontSize: '12px', color: 'var(--accent-blue)' }}>
            {mergeMessage}
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={idx} style={{
            display: 'flex', flexDirection: 'column',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '90%',
            background: m.role === 'user' ? 'var(--accent-blue)' : 'var(--bg-elevated)',
            color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '13px',
            lineHeight: 1.45,
            border: m.role === 'user' ? 'none' : '1px solid var(--border-primary)'
          }}>
            {m.content.split(/(```[\s\S]*?```)/g).map((part, pIdx) => {
              if (part.startsWith('```') && part.endsWith('```')) {
                const lines = part.split(/\r?\n/)
                const lang = lines[0].slice(3).trim()
                const code = lines.slice(1, -1).join('\n')
                return (
                  <div key={pIdx} style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '6px', marginTop: '6px', marginBottom: '6px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(0,0,0,0.3)', fontSize: '11px', color: '#8b949e' }}>
                      <span>{lang || 'code'}</span>
                      <button
                        onClick={() => {
                          if (!activeFile) return
                          if (!hasKeys) {
                            openAiKeyModal('Code Review & Merge')
                            return
                          }
                          const fileId = activeFile.id
                          const originalContent = activeFile.content
                          const reqId = ++mergeRequest.current

                          setMergeMessage('Preparing a change review. Changes will only apply after you accept.')
                          useEditorStore.getState().setAiDiff({
                            fileId,
                            originalContent,
                            modifiedContent: '',
                            isApplying: true
                          })

                          platform.aiMergeCode({
                            fileId,
                            currentContent: originalContent,
                            snippet: code,
                            language: activeFile.language
                          }).then(res => {
                            if (reqId !== mergeRequest.current) return
                            const currentDiff = useEditorStore.getState().aiDiff
                            if (currentDiff?.fileId !== fileId || currentDiff.originalContent !== originalContent) return

                            if (res.success && res.mergedContent?.trim()) {
                              setMergeMessage(res.mergedContent === originalContent ? 'No changes needed. Code already matches.' : 'Review red deletions and green additions in editor, then click Accept or Reject.')
                              useEditorStore.getState().setAiDiff({
                                fileId,
                                originalContent,
                                modifiedContent: res.mergedContent,
                                isApplying: false
                              })
                            } else {
                              setMergeMessage(res.error || 'Could not prepare code review.')
                              useEditorStore.getState().setAiDiff(null)
                            }
                          }).catch(err => {
                            if (reqId !== mergeRequest.current) return
                            setMergeMessage(err.message || 'Could not prepare review.')
                            useEditorStore.getState().setAiDiff(null)
                          })
                        }}
                        style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}
                      >
                        Review changes in editor
                      </button>
                    </div>
                    <pre style={{ margin: 0, padding: '8px', fontSize: '12px', fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      <code>{code}</code>
                    </pre>
                  </div>
                )
              }
              return <div key={pIdx} style={{ whiteSpace: 'pre-wrap' }}>{part}</div>
            })}
          </div>
        ))}

        {isLoading && (
          <div style={{ alignSelf: 'flex-start', color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>✨</span> Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <div style={{ padding: '12px', borderTop: '1px solid var(--border-primary)', display: 'flex', gap: '8px', background: 'var(--bg-elevated)' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
          placeholder="Ask a question about your code..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-secondary)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            fontSize: '13px'
          }}
        />
        <button
          onClick={handleSendMessage}
          disabled={isLoading || !input.trim()}
          style={{
            padding: '8px 14px',
            background: 'var(--accent-blue)',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: isLoading || !input.trim() ? 0.6 : 1
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
