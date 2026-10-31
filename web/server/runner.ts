// ============================================================================
// Execution & Visualization Runner
// Supports C, C++, and Python with interactive I/O and GDB/Python tracing.
// ============================================================================

import { spawn, execSync, type ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { jobStore } from './jobStore'
import { parseGccErrors } from './errors/GccErrorParser'
import { parsePythonErrors } from './errors/PythonErrorParser'
import { normalizeVisualizationTrace } from '../src/shared/traceNormalizer'
import { MAX_OUTPUT_BYTES } from './validation'

const isWindows = process.platform === 'win32'
const DEFAULT_TIMEOUT_MS = 30_000

export interface ToolchainConfig {
  gcc: string | null
  gpp: string | null
  gdb: string | null
  python: string
  envPath?: string
}

let cachedToolchain: ToolchainConfig | null = null

export function resolveToolchain(): ToolchainConfig {
  if (cachedToolchain) return cachedToolchain

  let gcc: string | null = null
  let gpp: string | null = null
  let gdb: string | null = null
  let envPath: string | undefined = undefined

  if (isWindows) {
    const msysCandidates = [
      'D:\\msys2\\ucrt64\\bin',
      'C:\\msys64\\ucrt64\\bin',
      'C:\\msys64\\mingw64\\bin'
    ]
    for (const dir of msysCandidates) {
      const gppPath = join(dir, 'g++.exe')
      try {
        execSync(`"${gppPath}" --version`, { timeout: 3000, stdio: 'ignore' })
        gpp = gppPath
        gcc = join(dir, 'gcc.exe')
        gdb = join(dir, 'gdb.exe')
        envPath = dir + ';' + (process.env.PATH || '')
        break
      } catch {
        /* try next */
      }
    }
  }

  // Fallback to PATH lookup
  if (!gpp) {
    try {
      execSync('g++ --version', { timeout: 3000, stdio: 'ignore' })
      gpp = 'g++'
    } catch { /* not in PATH */ }
  }
  if (!gcc) {
    try {
      execSync('gcc --version', { timeout: 3000, stdio: 'ignore' })
      gcc = 'gcc'
    } catch { /* not in PATH */ }
  }
  if (!gdb) {
    try {
      execSync('gdb --version', { timeout: 3000, stdio: 'ignore' })
      gdb = 'gdb'
    } catch { /* not in PATH */ }
  }

  cachedToolchain = {
    gcc,
    gpp,
    gdb,
    python: process.execPath ? 'python' : 'python3',
    envPath
  }
  return cachedToolchain
}

function killProcess(child: ChildProcess): void {
  if (!child.pid) return
  try {
    if (isWindows) {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGKILL')
    }
  } catch {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
  }
}

export async function runJob(jobId: string): Promise<void> {
  const job = jobStore.get(jobId)
  if (!job) return

  const toolchain = resolveToolchain()
  const workDir = await fs.mkdtemp(join(tmpdir(), `codeforge_run_${job.id}_`))
  let totalOutputBytes = 0

  const env = { ...process.env }
  if (toolchain.envPath) {
    env.PATH = toolchain.envPath
  }

  const cleanup = async () => {
    try {
      await fs.rm(workDir, { recursive: true, force: true })
    } catch {
      /* ignore temp cleanup error */
    }
  }

  try {
    if (job.mode === 'trace') {
      // ------------------------------------------------------------------------
      // Trace Mode — deterministic replay under tracer scripts
      // ------------------------------------------------------------------------
      jobStore.setStatus(jobId, 'running')
      jobStore.appendEvent(jobId, 'status', 'Recording runtime visualization...\n')

      const runnerDir = join(process.cwd(), 'runner')
      const sourceExt = job.language === 'python' ? 'main.py' : job.language === 'c' ? 'main.c' : 'main.cpp'
      const sourcePath = join(workDir, sourceExt)
      await fs.writeFile(sourcePath, job.sourceCode, 'utf-8')

      let traceArgs: string[] = []
      if (job.language === 'python') {
        const tracerScript = join(runnerDir, 'visualize.py')
        traceArgs = [tracerScript, sourcePath]
      } else {
        const compiler = job.language === 'c' ? toolchain.gcc : toolchain.gpp
        if (!compiler) {
          jobStore.setStatus(jobId, 'error', 1, 'C/C++ compiler is not available on this runner.')
          jobStore.appendEvent(jobId, 'error', 'C/C++ compiler is not available on this runner.\n')
          await cleanup()
          return
        }
        const tracerScript = join(runnerDir, 'visualize_cpp.py')
        const inputB64 = Buffer.from(job.events.find(e => e.type === 'stdout')?.data || '').toString('base64')
        traceArgs = [tracerScript, sourcePath, 'unused', compiler, job.language, inputB64]
      }

      const child = spawn(toolchain.python, traceArgs, {
        cwd: workDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let traceStdout = ''
      let traceStderr = ''

      child.stdout.on('data', (d: Buffer) => { traceStdout += d.toString() })
      child.stderr.on('data', (d: Buffer) => { traceStderr += d.toString() })

      const timeoutTimer = setTimeout(() => {
        killProcess(child)
        jobStore.setStatus(jobId, 'timeout', 124, 'Visualization timed out.')
        jobStore.appendEvent(jobId, 'error', 'Visualization timed out. Check for infinite loops.\n')
      }, DEFAULT_TIMEOUT_MS)

      child.on('close', async (code) => {
        clearTimeout(timeoutTimer)
        const rawSteps: any[] = []
        for (const line of traceStdout.split(/\r?\n/)) {
          if (line.startsWith('{')) {
            try {
              const parsed = JSON.parse(line)
              if (parsed.event && parsed.event !== 'exit') {
                rawSteps.push(parsed)
              }
            } catch {
              /* ignore non-JSON line */
            }
          }
        }

        const normalized = normalizeVisualizationTrace(rawSteps, job.sourceCode, job.language, '')
        jobStore.setTrace(jobId, normalized)
        jobStore.setStatus(jobId, code === 0 || normalized.length > 0 ? 'exited' : 'error', code || 0)
        jobStore.appendEvent(jobId, 'status', `Visualization completed with ${normalized.length} steps.\n`, code || 0)
        await cleanup()
      })

      child.on('error', async (err) => {
        clearTimeout(timeoutTimer)
        jobStore.setStatus(jobId, 'error', 1, err.message)
        jobStore.appendEvent(jobId, 'error', `Failed to start tracer: ${err.message}\n`)
        await cleanup()
      })

      // If initial stdin was provided, write and close
      child.stdin.end()
      return
    }

    // ------------------------------------------------------------------------
    // Run Mode — Interactive compilation and execution
    // ------------------------------------------------------------------------
    if (job.language === 'python') {
      const sourcePath = join(workDir, 'main.py')
      await fs.writeFile(sourcePath, job.sourceCode, 'utf-8')

      jobStore.setStatus(jobId, 'running')
      jobStore.appendEvent(jobId, 'status', 'Running Python program...\n')

      const child = spawn(toolchain.python, ['-u', 'main.py'], {
        cwd: workDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      jobStore.setRunnerHandle(jobId, {
        kill: () => killProcess(child),
        writeStdin: (data: string) => {
          if (child.stdin.writable) {
            child.stdin.write(data)
          }
        }
      })

      const timeoutTimer = setTimeout(() => {
        killProcess(child)
        jobStore.setStatus(jobId, 'timeout', 124, 'Execution timed out.')
        jobStore.appendEvent(jobId, 'error', '\n[CodeForge] Program timed out after 30 seconds.\n')
      }, DEFAULT_TIMEOUT_MS)

      let rawStderr = ''

      child.stdout.on('data', (chunk: Buffer) => {
        totalOutputBytes += chunk.length
        if (totalOutputBytes > MAX_OUTPUT_BYTES) {
          killProcess(child)
          jobStore.appendEvent(jobId, 'error', '\n[CodeForge] Output limit exceeded (250KB).\n')
          return
        }
        jobStore.appendEvent(jobId, 'stdout', chunk.toString('utf-8'))
      })

      child.stderr.on('data', (chunk: Buffer) => {
        rawStderr += chunk.toString('utf-8')
        jobStore.appendEvent(jobId, 'stderr', chunk.toString('utf-8'))
      })

      child.on('close', async (code) => {
        clearTimeout(timeoutTimer)
        const exitCode = code ?? 0
        jobStore.setStatus(jobId, exitCode === 0 ? 'exited' : 'error', exitCode)
        jobStore.appendEvent(jobId, 'exit', `\n[Program exited with code ${exitCode}]\n`, exitCode)
        await cleanup()
      })

      child.on('error', async (err) => {
        clearTimeout(timeoutTimer)
        jobStore.setStatus(jobId, 'error', 1, err.message)
        jobStore.appendEvent(jobId, 'error', `\n[CodeForge] Process error: ${err.message}\n`)
        await cleanup()
      })

    } else {
      // C / C++ Compilation & Run
      const isCpp = job.language === 'cpp'
      const compiler = isCpp ? toolchain.gpp : toolchain.gcc
      if (!compiler) {
        jobStore.setStatus(jobId, 'error', 1, 'No C/C++ compiler found on the runner host.')
        jobStore.appendEvent(jobId, 'error', 'No C/C++ compiler found on the runner host.\n')
        await cleanup()
        return
      }

      jobStore.setStatus(jobId, 'compiling')
      jobStore.appendEvent(jobId, 'status', `Compiling ${isCpp ? 'C++' : 'C'} source...\n`)

      const sourceFile = isCpp ? 'main.cpp' : 'main.c'
      const exeFile = isWindows ? 'program.exe' : 'program'
      const sourcePath = join(workDir, sourceFile)
      const exePath = join(workDir, exeFile)
      await fs.writeFile(sourcePath, job.sourceCode, 'utf-8')

      const compileArgs = [
        sourceFile,
        '-o', exeFile,
        isCpp ? '-std=c++17' : '-std=c11',
        '-Wall',
        '-O0'
      ]

      const compileProcess = spawn(compiler, compileArgs, {
        cwd: workDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let compileStderr = ''
      compileProcess.stderr.on('data', (d: Buffer) => { compileStderr += d.toString('utf-8') })

      compileProcess.on('close', async (compCode) => {
        if (compCode !== 0) {
          const errors = parseGccErrors(compileStderr, job.language, { sourceName: sourceFile })
          jobStore.setStatus(jobId, 'error', compCode || 1, 'Compilation failed')
          jobStore.appendEvent(jobId, 'stderr', compileStderr)
          jobStore.appendEvent(jobId, 'error', `\nCompilation failed with ${errors.length} diagnostic message(s).\n`, compCode || 1)
          await cleanup()
          return
        }

        jobStore.setStatus(jobId, 'running')
        jobStore.appendEvent(jobId, 'status', 'Compilation succeeded. Starting program...\n')

        const runChild = spawn(exePath, [], {
          cwd: workDir,
          env,
          stdio: ['pipe', 'pipe', 'pipe']
        })

        jobStore.setRunnerHandle(jobId, {
          kill: () => killProcess(runChild),
          writeStdin: (data: string) => {
            if (runChild.stdin.writable) {
              runChild.stdin.write(data)
            }
          }
        })

        const runTimeout = setTimeout(() => {
          killProcess(runChild)
          jobStore.setStatus(jobId, 'timeout', 124, 'Execution timed out.')
          jobStore.appendEvent(jobId, 'error', '\n[CodeForge] Program timed out after 30 seconds.\n')
        }, DEFAULT_TIMEOUT_MS)

        runChild.stdout.on('data', (chunk: Buffer) => {
          totalOutputBytes += chunk.length
          if (totalOutputBytes > MAX_OUTPUT_BYTES) {
            killProcess(runChild)
            jobStore.appendEvent(jobId, 'error', '\n[CodeForge] Output limit exceeded (250KB).\n')
            return
          }
          jobStore.appendEvent(jobId, 'stdout', chunk.toString('utf-8'))
        })

        runChild.stderr.on('data', (chunk: Buffer) => {
          jobStore.appendEvent(jobId, 'stderr', chunk.toString('utf-8'))
        })

        runChild.on('close', async (code) => {
          clearTimeout(runTimeout)
          const exitCode = code ?? 0
          jobStore.setStatus(jobId, exitCode === 0 ? 'exited' : 'error', exitCode)
          jobStore.appendEvent(jobId, 'exit', `\n[Program exited with code ${exitCode}]\n`, exitCode)
          await cleanup()
        })

        runChild.on('error', async (err) => {
          clearTimeout(runTimeout)
          jobStore.setStatus(jobId, 'error', 1, err.message)
          jobStore.appendEvent(jobId, 'error', `\n[CodeForge] Process error: ${err.message}\n`)
          await cleanup()
        })
      })
    }
  } catch (err: any) {
    jobStore.setStatus(jobId, 'error', 1, err.message)
    jobStore.appendEvent(jobId, 'error', `Execution failure: ${err.message}\n`)
    await cleanup()
  }
}
