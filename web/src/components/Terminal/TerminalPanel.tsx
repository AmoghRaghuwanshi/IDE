import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useExecutionStore } from '../../state/executionStore'
import { platform } from '../../platform/remoteAdapter'

export default function TerminalPanel() {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionId = useExecutionStore((s) => s.sessionId)

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return

    const term = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#264f7840',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d2c0',
        white: '#e6edf3',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc'
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)

    setTimeout(() => fitAddon.fit(), 50)

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Handle user input in web terminal
    term.onData((data) => {
      const state = useExecutionStore.getState()
      if (state.sessionId && state.status === 'running') {
        state.appendRecordedInput(data)
        // Echo input in terminal for user feedback
        term.write(data === '\r' ? '\r\n' : data)
        platform.sendJobInput(state.sessionId, data === '\r' ? '\n' : data)
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
      } catch {
        /* ignore */
      }
    })
    resizeObserver.observe(terminalRef.current)

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  // Poll execution events for active job
  useEffect(() => {
    if (!sessionId) return
    let active = true
    let cursor = 0

    const poll = async () => {
      while (active) {
        try {
          const res = await platform.pollJobEvents(sessionId, cursor)
          if (!active) break

          if (res.events && res.events.length > 0) {
            cursor = res.nextCursor
            for (const ev of res.events) {
              const text = ev.data.replace(/\r?\n/g, '\r\n')
              xtermRef.current?.write(text)
              useExecutionStore.getState().appendRecordedOutput(ev.data)
            }
          }

          if (!res.isRunning) {
            const currentStatus = useExecutionStore.getState().status
            if (currentStatus === 'running' || currentStatus === 'compiling') {
              useExecutionStore.getState().setStatus(res.status as any || 'exited')
              if (res.exitCode !== undefined) {
                useExecutionStore.getState().setExitCode(res.exitCode)
              }
            }
            break
          }
        } catch {
          /* network retry backoff */
        }
        await new Promise((r) => setTimeout(r, 200))
      }
    }

    poll()

    return () => {
      active = false
    }
  }, [sessionId])

  return (
    <div
      ref={terminalRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#0d1117'
      }}
    />
  )
}
