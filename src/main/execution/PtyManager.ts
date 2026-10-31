// ============================================================================
// PTY Manager — manages node-pty sessions for program execution
// ============================================================================

import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { killProcessTree } from '../platform/PlatformAdapter'

export interface PtySession {
  id: string
  process: pty.IPty
  pid: number
  startTime: number
  timeoutTimer: ReturnType<typeof setTimeout> | null
  activityTimer: ReturnType<typeof setTimeout> | null
}

export class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map()
  private defaultTimeout: number = 60000 // 60s wall-clock ceiling

  constructor(timeoutMs?: number) {
    super()
    if (timeoutMs) this.defaultTimeout = timeoutMs
  }

  /**
   * Start a new PTY session.
   * @returns session ID
   */
  startSession(
    command: string,
    args: string[],
    cwd: string,
    sessionId?: string,
    extraEnv?: Record<string, string>
  ): string {
    const id = sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const env: Record<string, string> = {}
    let existingPath = ''
    
    for (const key in process.env) {
      if (key.toLowerCase() === 'path') {
        existingPath = process.env[key] || ''
      } else {
        env[key] = process.env[key] || ''
      }
    }

    env['TERM'] = 'xterm-256color'
    env['PYTHONUNBUFFERED'] = '1'

    if (extraEnv) {
      for (const key in extraEnv) {
        if (key.toLowerCase() === 'path') {
          env['PATH'] = extraEnv[key] + ';' + existingPath
        } else {
          env[key] = extraEnv[key]
        }
      }
    } else {
      env['PATH'] = existingPath
    }

    // Spawn the process through PTY
    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env
    })

    const session: PtySession = {
      id,
      process: ptyProcess,
      pid: ptyProcess.pid,
      startTime: Date.now(),
      timeoutTimer: null,
      activityTimer: null
    }

    // Set up wall-clock timeout
    session.timeoutTimer = setTimeout(() => {
      this.emit('timeout', { sessionId: id })
      this.killSession(id)
    }, this.defaultTimeout)

    // Forward PTY data to renderer
    ptyProcess.onData((data: string) => {
      // Reset activity timer on output
      if (session.activityTimer) {
        clearTimeout(session.activityTimer)
      }
      session.activityTimer = setTimeout(() => {
        this.emit('waiting-for-input', { sessionId: id })
      }, 3000)

      this.emit('data', { sessionId: id, data })
    })

    // Handle process exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      this.clearTimers(id)
      this.emit('exit', { sessionId: id, exitCode: exitCode ?? (signal ?? -1) })
      this.sessions.delete(id)
    })

    this.sessions.set(id, session)
    return id
  }

  /**
   * Write data (user input) to a PTY session
   */
  writeToSession(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.process.write(data)
    }
  }

  /**
   * Resize a PTY session
   */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      try {
        session.process.resize(cols, rows)
      } catch {
        // Ignore resize errors for already-exited processes
      }
    }
  }

  /**
   * Gracefully stop a session (SIGINT first, then force kill)
   */
  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.clearTimers(sessionId)

    // Kill the entire process tree
    killProcessTree(session.pid)

    // Also try to kill via PTY
    setTimeout(() => {
      try {
        session.process.kill()
      } catch {
        // Process may already be dead
      }
    }, 500)
  }

  /**
   * Force-kill a session immediately
   */
  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    this.clearTimers(sessionId)
    killProcessTree(session.pid)

    try {
      session.process.kill()
    } catch {
      // Process may already be dead
    }
  }

  /**
   * Check if a session is still active
   */
  isActive(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Get active session count
   */
  getActiveCount(): number {
    return this.sessions.size
  }

  /**
   * Kill all sessions (for cleanup on app exit)
   */
  killAll(): void {
    for (const [id] of this.sessions) {
      this.killSession(id)
    }
    this.sessions.clear()
  }

  private clearTimers(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer)
      session.timeoutTimer = null
    }
    if (session.activityTimer) {
      clearTimeout(session.activityTimer)
      session.activityTimer = null
    }
  }

  /**
   * Set the timeout for new sessions
   */
  setTimeout(ms: number): void {
    this.defaultTimeout = ms
  }
}
