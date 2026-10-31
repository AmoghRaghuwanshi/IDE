import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useExecutionStore } from '../../state/executionStore'

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

    // Fit after a brief delay to ensure container is sized
    setTimeout(() => fitAddon.fit(), 50)

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Handle user input — send to PTY
    term.onData((data) => {
      const state = useExecutionStore.getState()
      if (state.sessionId) {
        // Record input for visualizer to replay
        state.appendRecordedInput(data)
        window.api.sendInput(state.sessionId, data)
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        const currentSessionId = useExecutionStore.getState().sessionId
        if (currentSessionId) {
          window.api.resizePty(currentSessionId, term.cols, term.rows)
        }
      } catch {
        // Ignore resize errors
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

  // Listen for PTY data and exit events
  useEffect(() => {
    const cleanupData = window.api.onExecutionData(({ data }) => {
      // Keep a raw transcript for the visualizer/session context as well as xterm.
      useExecutionStore.getState().appendRecordedOutput(data)
      xtermRef.current?.write(data)
    })

    const cleanupExit = window.api.onExecutionExit(({ exitCode }) => {
      xtermRef.current?.writeln('')
      xtermRef.current?.writeln(
        `\x1b[${exitCode === 0 ? '32' : '31'}m` +
          `\r\n━━━ Process exited with code ${exitCode} ━━━` +
          '\x1b[0m'
      )
    })

    return () => {
      cleanupData()
      cleanupExit()
    }
  }, [])

  // Fit terminal when sessionId changes (new execution started)
  useEffect(() => {
    if (sessionId && fitAddonRef.current) {
      // Clear terminal for new run
      xtermRef.current?.clear()
      setTimeout(() => fitAddonRef.current?.fit(), 100)
    }
  }, [sessionId])

  return <div className="terminal-container" ref={terminalRef} />
}
