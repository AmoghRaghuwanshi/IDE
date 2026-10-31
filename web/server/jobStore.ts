import type { LanguageId, JobExecutionEvent } from '../src/shared/types'
import type { NormalizedVisualizerStep } from '../src/shared/visualizer'
import { randomUUID } from 'crypto'

export interface JobRecord {
  id: string
  ownerId: string
  language: LanguageId
  mode: 'run' | 'trace'
  sourceName: string
  sourceCode: string
  status: 'queued' | 'compiling' | 'running' | 'exited' | 'timeout' | 'stopped' | 'error'
  exitCode: number | null
  createdAt: number
  updatedAt: number
  events: JobExecutionEvent[]
  trace: NormalizedVisualizerStep[] | null
  error?: string
  runnerHandle?: {
    kill: () => void
    writeStdin: (data: string) => void
  }
}

class JobStore {
  private jobs = new Map<string, JobRecord>()

  create(ownerId: string, params: {
    language: LanguageId
    mode: 'run' | 'trace'
    sourceName: string
    sourceCode: string
  }): JobRecord {
    const id = `job_${Date.now()}_${randomUUID().slice(0, 8)}`
    const now = Date.now()
    const record: JobRecord = {
      id,
      ownerId,
      language: params.language,
      mode: params.mode,
      sourceName: params.sourceName,
      sourceCode: params.sourceCode,
      status: 'queued',
      exitCode: null,
      createdAt: now,
      updatedAt: now,
      events: [],
      trace: null
    }
    this.jobs.set(id, record)
    this.cleanupExpired()
    return record
  }

  get(id: string, ownerId?: string): JobRecord | null {
    const job = this.jobs.get(id)
    if (!job) return null
    if (ownerId && job.ownerId !== ownerId) {
      const err = new Error('Unauthorized access to job')
      ;(err as any).statusCode = 403
      throw err
    }
    return job
  }

  appendEvent(id: string, type: JobExecutionEvent['type'], data: string, exitCode?: number): void {
    const job = this.jobs.get(id)
    if (!job) return
    const cursor = job.events.length + 1
    job.events.push({ cursor, type, data, exitCode })
    job.updatedAt = Date.now()
  }

  setStatus(id: string, status: JobRecord['status'], exitCode?: number, error?: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.status = status
    if (exitCode !== undefined) job.exitCode = exitCode
    if (error !== undefined) job.error = error
    job.updatedAt = Date.now()
  }

  setTrace(id: string, trace: NormalizedVisualizerStep[]): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.trace = trace
    job.updatedAt = Date.now()
  }

  setRunnerHandle(id: string, handle: JobRecord['runnerHandle']): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.runnerHandle = handle
  }

  cancel(id: string, ownerId: string): boolean {
    const job = this.get(id, ownerId)
    if (!job) return false
    if (job.runnerHandle) {
      try {
        job.runnerHandle.kill()
      } catch {
        /* ignore */
      }
    }
    this.setStatus(id, 'stopped')
    this.appendEvent(id, 'status', 'Execution stopped by user.\n')
    return true
  }

  cleanupExpired(maxAgeMs = 1800000): void { // 30 minutes
    const cutoff = Date.now() - maxAgeMs
    for (const [id, job] of this.jobs.entries()) {
      if (job.updatedAt < cutoff) {
        if (job.runnerHandle && (job.status === 'running' || job.status === 'compiling')) {
          try { job.runnerHandle.kill() } catch { /* ignore */ }
        }
        this.jobs.delete(id)
      }
    }
  }
}

export const jobStore = new JobStore()
