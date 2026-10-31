// ============================================================================
// IPC Handlers — typed channel handlers for main↔renderer communication
// ============================================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile, writeFile, readdir, stat, rm } from 'fs/promises'
import { join, dirname, basename } from 'path'
import { IPC_CHANNELS, type LanguageId, type FileTreeNode } from '../../shared/types'
import { CompilerManager } from '../compiler/CompilerManager'
import { PtyManager } from '../execution/PtyManager'
import { normalizeVisualizationTrace } from '../execution/traceNormalizer'
import { killProcessTree } from '../platform/PlatformAdapter'
import { tmpdir } from 'os'

let compilerManager: CompilerManager
let ptyManager: PtyManager
const geminiKeyHealth = new Map<string, { cooldownUntil: number; lastUsed: number; failures: number }>()
// Free-tier Gemini requests can occasionally take longer than the SDK default.
// Keep this bounded, but do not fail a healthy key after only a short 15s window.
const GEMINI_REQUEST_TIMEOUT_MS = 30_000

function orderedGeminiKeyIndexes(apiKeys: string[]): number[] {
  const now = Date.now()
  const unique = apiKeys
    .map((key, index) => ({ key: typeof key === 'string' ? key.trim() : '', index }))
    .filter(({ key }) => key.length > 0)
    .filter(({ key }, index, all) => all.findIndex((item) => item.key === key) === index)

  const ready = unique.filter(({ key }) => (geminiKeyHealth.get(key)?.cooldownUntil || 0) <= now)
  const candidates = ready.length > 0 ? ready : unique
  candidates.sort((a, b) => {
    const aState = geminiKeyHealth.get(a.key)
    const bState = geminiKeyHealth.get(b.key)
    return (aState?.lastUsed || 0) - (bState?.lastUsed || 0)
  })
  return candidates.map(({ index }) => index)
}

function markGeminiKey(apiKey: string, success: boolean, retryable = false): void {
  const key = apiKey.trim()
  if (!key) return
  const previous = geminiKeyHealth.get(key) || { cooldownUntil: 0, lastUsed: 0, failures: 0 }
  geminiKeyHealth.set(key, {
    lastUsed: Date.now(),
    failures: success ? 0 : previous.failures + 1,
    cooldownUntil: success ? 0 : Date.now() + (retryable ? 30_000 : 5_000)
  })
}

function isGeminiTimeout(message: string): boolean {
  return /deadline|timed out|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(message)
}

function cleanModelCode(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  const fenced = text.match(/^```(?:[\w+#.-]+)?\s*\r?\n([\s\S]*?)\r?\n```$/)
  return (fenced ? fenced[1] : text).trim()
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  compilerManager = new CompilerManager()
  ptyManager = new PtyManager()

  // ========================================================================
  // Compiler / Execution
  // ========================================================================

  // Detect all toolchains
  ipcMain.handle(IPC_CHANNELS.DETECT_TOOLCHAIN, async () => {
    return await compilerManager.detectAllToolchains()
  })

  // Compile and run a file
  ipcMain.handle(
    IPC_CHANNELS.COMPILE_AND_RUN,
    async (
      _event,
      args: {
        language: LanguageId
        sourceCode: string
        sourceName: string
        cppStandard?: string
        input?: string
      }
    ) => {
      const { language, sourceCode, sourceName, cppStandard, input } = args

      // Notify renderer that compilation has started
      mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, {
        status: 'compiling'
      })

      try {
        const { compileResult, runCommand } = await compilerManager.compileAndGetRunCommand(
          language,
          sourceCode,
          sourceName,
          { cppStandard }
        )

        if (!compileResult.success || !runCommand) {
          // Compilation failed
          mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, {
            status: 'error'
          })
          return {
            success: false,
            errors: compileResult.errors,
            rawStderr: compileResult.rawStderr,
            durationMs: compileResult.durationMs
          }
        }

        // Compilation succeeded — start execution via PTY
        mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, {
          status: 'running'
        })

        const sessionDir = join(tmpdir(), `codeforge-${process.pid}`)

        // For C/C++, inject the compiler's bin dir into PATH so the
        // executable can find MSYS2 runtime DLLs
        const extraEnv: Record<string, string> = {}
        if (language !== 'python') {
          const adapter = compilerManager.getAdapter(language)
          if (adapter) {
            const tc = await adapter.detectToolchain()
            if (tc.path) {
              const binDir = dirname(tc.path)
              extraEnv.PATH = binDir
            }
          }
        }

        const sessionId = ptyManager.startSession(
          runCommand.command,
          runCommand.args,
          sessionDir,
          undefined,
          extraEnv
        )

        if (input) {
          // Pre-feed the custom standard input to the PTY
          ptyManager.writeToSession(sessionId, input + (input.endsWith('\n') ? '' : '\n'))
        }

        return {
          success: true,
          sessionId,
          errors: compileResult.errors,
          rawStderr: compileResult.rawStderr,
          durationMs: compileResult.durationMs
        }
      } catch (error: unknown) {
        mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, {
          status: 'error'
        })
        return {
          success: false,
          errors: [],
          rawStderr: error instanceof Error ? error.message : String(error),
          durationMs: 0
        }
      }
    }
  )

  // Compile only (no run)
  ipcMain.handle(
    IPC_CHANNELS.COMPILE_ONLY,
    async (
      _event,
      args: {
        language: LanguageId
        sourceCode: string
        sourceName: string
        cppStandard?: string
      }
    ) => {
      const { language, sourceCode, sourceName, cppStandard } = args
      const adapter = compilerManager.getAdapter(language)
      if (!adapter) {
        return { success: false, errors: [], rawStderr: 'No adapter for language' }
      }

      const sessionDir = join(tmpdir(), `codeforge-${process.pid}`)
      const result = await adapter.compile(sourceCode, sourceName, sessionDir, { cppStandard })
      return {
        success: result.success,
        errors: result.errors,
        rawStderr: result.rawStderr,
        durationMs: result.durationMs
      }
    }
  )

  // ========================================================================
  // Code Visualizer (One-Shot — collects complete trace, returns at once)
  // ========================================================================

  ipcMain.handle(
    IPC_CHANNELS.VISUALIZER_START,
    async (
      _event,
      args: { language: LanguageId; sourceCode: string; sourceName: string; input?: string }
    ) => {
      const { language, sourceCode, sourceName, input } = args
      console.log('[Visualizer] Starting visualization for', language, sourceName)

      const sessionDir = join(tmpdir(), `codeforge-viz-${process.pid}-${Date.now()}`)
      await import('fs/promises').then(fs => fs.mkdir(sessionDir, { recursive: true }).catch(() => {}))

      const { existsSync } = await import('fs')

      // Detect Python for running the tracer scripts
      const pythonAdapter = compilerManager.getAdapter('python')
      const pythonTc = pythonAdapter ? await pythonAdapter.detectToolchain() : null
      const pythonExe = (pythonTc && pythonTc.path) ? pythonTc.path : 'python'

      let runArgs: string[] = []
      let targetSource = ''

      if (language === 'python') {
        targetSource = join(sessionDir, basename(sourceName || 'main.py'))
        const candidates = [
          join(process.resourcesPath, 'execution', 'visualize.py'),
          join(__dirname, '../main/execution/visualize.py'),
          join(__dirname, 'execution/visualize.py'),
          join(__dirname, '../../src/main/execution/visualize.py'),
        ]
        const visualizeScript = candidates.find(p => existsSync(p))
        if (!visualizeScript) return { success: false, error: 'Python visualizer script is missing from the installation.' }
        console.log('[Visualizer] Using script:', visualizeScript, 'exists:', existsSync(visualizeScript))
        await writeFile(targetSource, sourceCode, 'utf-8')
        runArgs = [visualizeScript, targetSource]
        
      } else if (language === 'c' || language === 'cpp') {
        const ext = language === 'c' ? '.c' : '.cpp'
        targetSource = join(sessionDir, basename(sourceName || `main${ext}`))
        await writeFile(targetSource, sourceCode, 'utf-8')

        const langAdapter = compilerManager.getAdapter(language)
        if (!langAdapter) return { success: false, error: 'No compiler configured for ' + language }
        const langTc = await langAdapter.detectToolchain()
        if (!langTc.available || !langTc.path) return { success: false, error: 'No compiler found for ' + language }

        const cppCandidates = [
          join(process.resourcesPath, 'execution', 'visualize_cpp.py'),
          join(__dirname, '../main/execution/visualize_cpp.py'),
          join(__dirname, 'execution/visualize_cpp.py'),
          join(__dirname, '../../src/main/execution/visualize_cpp.py'),
        ]
        const cppVisScript = cppCandidates.find(p => existsSync(p))
        if (!cppVisScript) return { success: false, error: 'C/C++ visualizer script is missing from the installation.' }
        runArgs = [
          cppVisScript,
          targetSource,
          'dummy.json',
          langTc.path,
          language,
          Buffer.from(input || '', 'utf8').toString('base64')
        ]
      } else {
        return { success: false, error: `Language ${language} not supported for visualization.` }
      }

      // Run the tracer synchronously — collect ALL output, then return at once
      const { spawn } = await import('child_process')
      
      return new Promise<{ success: boolean; trace?: any[]; error?: string }>((resolve) => {
        console.log('[Visualizer] Spawning:', pythonExe, runArgs.join(' '))
        let child: ReturnType<typeof spawn>
        try {
          child = spawn(pythonExe, runArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
        } catch (error) {
          resolve({ success: false, error: `Failed to start tracer: ${error instanceof Error ? error.message : String(error)}` })
          return
        }

        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (result: { success: boolean; trace?: any[]; error?: string }) => {
          if (settled) return
          settled = true
          void rm(sessionDir, { recursive: true, force: true }).catch(() => {})
          resolve(result)
        }

        if (!child.stdout || !child.stderr || !child.stdin) {
          finish({ success: false, error: 'Tracer process did not expose the required standard streams.' })
          return
        }
        const childStdout = child.stdout
        const childStderr = child.stderr
        const childStdin = child.stdin

        childStdout.on('data', (data: Buffer) => {
          stdout += data.toString()
        })

        childStderr.on('data', (data: Buffer) => {
          stderr += data.toString()
        })

        // Timeout after 30 seconds
        const timeout = setTimeout(() => {
          if (child.pid) killProcessTree(child.pid)
          finish({ success: false, error: 'Visualization took too long. Check for a loop that never ends or missing input.' })
        }, 120000)

        child.on('close', (code) => {
          clearTimeout(timeout)
          console.log('[Visualizer] Process exited with code:', code, 'stdout length:', stdout.length)
          
          if (stderr) {
            console.warn('[Visualizer] stderr:', stderr.substring(0, 500))
          }

          // Parse all the JSONLines into trace steps
          const trace: any[] = []
          const lines = stdout.split('\n')
          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsed = JSON.parse(line)
                // Only include actual execution steps, not exit/waiting events
                if (parsed.event === 'line' || parsed.event === 'return' ||
                    parsed.event === 'call' || parsed.event === 'input' || parsed.event === 'exception') {
                  trace.push(parsed)
                }
              } catch {
                // Skip non-JSON lines (e.g. GDB warnings)
              }
            }
          }

          console.log('[Visualizer] Parsed', trace.length, 'trace steps')

          const normalizedTrace = normalizeVisualizationTrace(trace, sourceCode, language, input || '')

          if (normalizedTrace.length === 0) {
            finish({
              success: false, 
              error: stderr 
                ? `Tracer error: ${stderr.trim().substring(0, 500)}`
                : code !== 0
                  ? `Tracer exited with code ${code}.`
                  : 'No trace output produced. The program may have no executable statements.'
            })
          } else {
            finish({ success: true, trace: normalizedTrace })
          }
        })

        child.on('error', (err) => {
          clearTimeout(timeout)
          console.error('[Visualizer] Spawn error:', err)
          finish({ success: false, error: `Failed to start tracer: ${err.message}` })
        })

        // Feed standard input
        if (input) {
          childStdin.write(input + (input.endsWith('\n') ? '' : '\n'))
        }
        childStdin.end()
      })
    }
  )

  // ========================================================================
  // PTY / Execution Control
  // ========================================================================

  // Stop running execution
  ipcMain.handle(IPC_CHANNELS.EXECUTION_STOP, async (_event, sessionId: string) => {
    ptyManager.stopSession(sessionId)
    mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, { status: 'stopped' })
    return { success: true }
  })

  // Send input to running process
  ipcMain.on(IPC_CHANNELS.EXECUTION_INPUT, (_event, { sessionId, data }) => {
    ptyManager.writeToSession(sessionId, data)
  })

  // Resize PTY
  ipcMain.on(IPC_CHANNELS.EXECUTION_RESIZE, (_event, { sessionId, cols, rows }) => {
    ptyManager.resizeSession(sessionId, cols, rows)
  })

  // Forward PTY events to renderer
  ptyManager.on('data', ({ sessionId, data }) => {
    mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_DATA, { sessionId, data })
  })

  ptyManager.on('exit', ({ sessionId, exitCode }) => {
    mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_EXIT, { sessionId, exitCode })
    mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, {
      status: 'exited',
      exitCode
    })
  })

  ptyManager.on('timeout', ({ sessionId }) => {
    mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, {
      status: 'timeout',
      sessionId
    })
  })

  ptyManager.on('waiting-for-input', ({ sessionId }) => {
    mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_STATUS, {
      status: 'waiting-for-input',
      sessionId
    })
  })

  // ========================================================================
  // File System
  // ========================================================================

  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath: string) => {
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.FILE_WRITE,
    async (_event, args: { filePath: string; content: string }) => {
      try {
        await writeFile(args.filePath, args.content, 'utf-8')
        return { success: true }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.FILE_LIST_DIR, async (_event, dirPath: string) => {
    try {
      const entries = await readdir(dirPath)
      const nodes: FileTreeNode[] = []

      for (const entry of entries) {
        // Skip hidden files/dirs and common noise
        if (
          entry.startsWith('.') ||
          entry === 'node_modules' ||
          entry === '__pycache__' ||
          entry === 'out'
        ) {
          continue
        }

        const fullPath = join(dirPath, entry)
        try {
          const stats = await stat(fullPath)
          nodes.push({
            name: entry,
            path: fullPath,
            isDirectory: stats.isDirectory()
          })
        } catch {
          // Skip inaccessible files
        }
      }

      // Sort: directories first, then alphabetically
      nodes.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })

      return { success: true, nodes }
    } catch (error: unknown) {
      return {
        success: false,
        nodes: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })

  // Open folder dialog
  ipcMain.handle(IPC_CHANNELS.FILE_SELECT_DIR, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false }
    }
    return { success: true, path: result.filePaths[0] }
  })

  // Open file dialog
  ipcMain.handle(IPC_CHANNELS.FILE_SELECT_FILE, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Source Files', extensions: ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'py'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false }
    }
    return { success: true, path: result.filePaths[0] }
  })

  // Create a new file on disk
  ipcMain.handle(
    IPC_CHANNELS.FILE_CREATE,
    async (_event, args: { dirPath: string; fileName: string; content: string }) => {
      try {
        const fullPath = join(args.dirPath, args.fileName)
        await writeFile(fullPath, args.content, 'utf-8')
        return { success: true, path: fullPath }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  // Save As dialog
  ipcMain.handle(
    IPC_CHANNELS.FILE_SAVE_AS,
    async (_event, args: { content: string; defaultName?: string }) => {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: args.defaultName,
        filters: [
          { name: 'C Files', extensions: ['c', 'h'] },
          { name: 'C++ Files', extensions: ['cpp', 'cc', 'hpp'] },
          { name: 'Python Files', extensions: ['py'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePath) {
        return { success: false }
      }
      try {
        await writeFile(result.filePath, args.content, 'utf-8')
        return { success: true, path: result.filePath }
      } catch (error: unknown) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  // ========================================================================
  // AI Chat (Gemini — runs in main process to avoid renderer CSP issues)
  // ========================================================================

  ipcMain.handle(
    IPC_CHANNELS.AI_CHAT,
    async (
      _event,
      args: {
        apiKeys: string[]
        prompt: string
      }
    ) => {
      const { apiKeys, prompt } = args

      if (!apiKeys || apiKeys.length === 0) {
        return { success: false, error: 'No API keys configured. Open AI settings and add a Gemini key.' }
      }

      let lastError: string = ''
      const MAX_RETRIES = 3

      const fallbackModels = [
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash',
        'gemini-1.5-flash-8b',
        'gemini-1.5-pro',
        'gemini-pro'
      ]

      for (const i of orderedGeminiKeyIndexes(apiKeys)) {
        let attempt = 0
        let currentModelIndex = 0

        while (attempt < MAX_RETRIES && currentModelIndex < fallbackModels.length) {
          const targetModel = fallbackModels[currentModelIndex]
          try {
            const { GoogleGenAI } = await import('@google/genai')
            const ai = new GoogleGenAI({ apiKey: apiKeys[i], httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS } })

            const response = await ai.models.generateContent({
              model: targetModel,
              contents: [
                { role: 'user', parts: [{ text: prompt }] }
              ]
            })

            markGeminiKey(apiKeys[i], true)
            return {
              success: true,
              text: response.text || '',
              keyIndex: i
            }
          } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error)
            console.warn(`AI Key ${i + 1}, model ${targetModel}, attempt ${attempt + 1} failed:`, errMsg)

            // Parse user-friendly error from raw JSON error messages
            let friendlyError = errMsg
            try {
              const jsonMatch = errMsg.match(/\{[\s\S]*"message"\s*:\s*"([^"]+)"/)
              if (jsonMatch) {
                friendlyError = jsonMatch[1]
              }
            } catch { /* ignore */ }
            lastError = friendlyError

            // Check if this is a rate limit or server error
            const isTimeout = isGeminiTimeout(errMsg)
            const isRetryable = isTimeout || errMsg.includes('503') || errMsg.includes('UNAVAILABLE')
              || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')
              || errMsg.includes('overloaded') || errMsg.includes('high demand')
            const isQuotaError = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')
            
            // If the model itself is not found/deprecated, immediately try the next model
            const isModelNotFound = errMsg.includes('404') || errMsg.includes('NOT_FOUND') || 
                                    errMsg.includes('no longer available') || errMsg.includes('is not found') || 
                                    errMsg.includes('not supported')
            markGeminiKey(apiKeys[i], false, isRetryable)

            // Free-tier quota is key-specific. Move to the next key rather
            // than spending more attempts on a key that cannot serve this request.
            if (isQuotaError) break

            // A deadline is usually request/server latency, not a bad key.
            // Move on immediately so multiple free keys can be used efficiently.
            if (isTimeout) break

            if (isModelNotFound) {
              currentModelIndex++
              attempt = 0
              continue // Try next model immediately
            }

            if (isRetryable) {
              if (attempt < MAX_RETRIES - 1) {
                // Wait with exponential backoff and retry same model
                const delay = Math.pow(2, attempt) * 1000
                await new Promise(resolve => setTimeout(resolve, delay))
                attempt++
                continue
              } else {
                // Exhausted retries for this model, try the next fallback model
                currentModelIndex++
                attempt = 0 // Reset attempt counter for new model
                continue
              }
            } else {
              // Non-retryable error (e.g. invalid key). Just try next key.
              lastError = friendlyError
              break
            }
          }
        }

        // If we exhausted all fallback models, let's try dynamic discovery
        if (currentModelIndex >= fallbackModels.length) {
          try {
            console.log(`[AI] All fallback models failed. Attempting dynamic discovery for key ${i}...`)
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKeys[i]}`)
            if (res.ok) {
              const data = await res.json()
              if (data.models && Array.isArray(data.models)) {
                // Find a model that supports generateContent
                const validModels = data.models.filter((m: any) => 
                  m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
                )
                
                if (validModels.length > 0) {
                  // Sort to prefer 3.6 flash, then 3.5, etc.
                  validModels.sort((a: any, b: any) => {
                    const aName = a.name.toLowerCase()
                    const bName = b.name.toLowerCase()
                    if (aName.includes('3.6-flash') && !bName.includes('3.6-flash')) return -1
                    if (bName.includes('3.6-flash') && !aName.includes('3.6-flash')) return 1
                    if (aName.includes('3.5-flash') && !bName.includes('3.5-flash')) return -1
                    if (bName.includes('3.5-flash') && !aName.includes('3.5-flash')) return 1
                    return 0
                  })
                  
                  const discoveredModel = validModels[0].name.replace('models/', '')
                  console.log(`[AI] Discovered valid model: ${discoveredModel}`)
                  
                  const { GoogleGenAI } = await import('@google/genai')
                  const ai = new GoogleGenAI({ apiKey: apiKeys[i], httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS } })
                  const response = await ai.models.generateContent({
                    model: discoveredModel,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                  })
                  
                  return {
                    success: true,
                    text: response.text || '',
                    keyIndex: i
                  }
                }
              }
            }
          } catch (discoveryError) {
            console.warn('[AI] Dynamic discovery failed:', discoveryError)
          }
        }
      }

      return {
        success: false,
        error: isGeminiTimeout(lastError)
          ? 'Gemini took too long to respond. Free-tier keys were rotated; please try again or use a shorter request.'
          : (lastError || 'Failed to communicate with AI provider.')
      }
    }
  )

  // ========================================================================
  // AI Code Merge
  // ========================================================================
  
  ipcMain.handle(
    'ai:merge-code',
    async (_event, args: { apiKeys: string[]; currentContent: string; snippet: string; language: string }) => {
      const { apiKeys, currentContent, snippet, language } = args

      if (!apiKeys || apiKeys.length === 0) {
        return { success: false, error: 'No API keys provided.' }
      }

      const prompt = `You are an expert ${language} developer.
Your task is to merge the provided CODE SNIPPET into the CURRENT FILE CONTENT.
You must output the ENTIRE updated file content. Do not truncate the file. Do not use placeholders like "// rest of code goes here".
Do NOT return any explanation. Do NOT include markdown fences (like \`\`\`${language}). Return ONLY the raw updated code.

CURRENT FILE CONTENT:
${currentContent}

CODE SNIPPET TO MERGE:
${snippet}`

      const MAX_RETRIES = 2
      const fallbackModels = [
        'gemini-3.6-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash'
      ]

      let lastError = ''

      for (const i of orderedGeminiKeyIndexes(apiKeys)) {
        let attempt = 0
        let currentModelIndex = 0

        while (attempt < MAX_RETRIES && currentModelIndex < fallbackModels.length) {
          const targetModel = fallbackModels[currentModelIndex]
          try {
            const { GoogleGenAI } = await import('@google/genai')
            const ai = new GoogleGenAI({ apiKey: apiKeys[i], httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS } })

            const response = await ai.models.generateContent({
              model: targetModel,
              contents: [{ role: 'user', parts: [{ text: prompt }] }]
            })

            const mergedContent = cleanModelCode(response.text)
            if (!mergedContent) throw new Error('AI returned an empty file.')

            markGeminiKey(apiKeys[i], true)
            return {
              success: true,
              mergedContent: mergedContent.trim()
            }
          } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error)
            let friendlyError = errMsg
            try {
              const jsonMatch = errMsg.match(/\\{[\\s\\S]*"message"\\s*:\\s*"([^"]+)"/)
              if (jsonMatch) friendlyError = jsonMatch[1]
            } catch { /* ignore */ }
            lastError = friendlyError

            const isTimeout = isGeminiTimeout(errMsg)
            const isRetryable = isTimeout || errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('429')
            const isModelNotFound = errMsg.includes('404') || errMsg.includes('NOT_FOUND') || errMsg.includes('is not found') || errMsg.includes('not supported') || errMsg.includes('no longer available')
            const isQuotaError = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')
            markGeminiKey(apiKeys[i], false, isRetryable)

            if (isQuotaError) break

            if (isTimeout) break

            if (isModelNotFound) {
              currentModelIndex++
              attempt = 0
              continue
            }

            if (isRetryable) {
              if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, 400 * Math.pow(2, attempt)))
                attempt++
                continue
              } else {
                currentModelIndex++
                attempt = 0
                continue
              }
            } else {
              lastError = friendlyError
              break
            }
          }
        }
        
        // Dynamic discovery fallback
        if (currentModelIndex >= fallbackModels.length) {
          try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKeys[i]}`)
            if (res.ok) {
              const data = await res.json()
              if (data.models && Array.isArray(data.models)) {
                const validModels = data.models.filter((m: any) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                if (validModels.length > 0) {
                  validModels.sort((a: any, b: any) => {
                    const aName = a.name.toLowerCase()
                    const bName = b.name.toLowerCase()
                    if (aName.includes('3.6-flash') && !bName.includes('3.6-flash')) return -1
                    if (bName.includes('3.6-flash') && !aName.includes('3.6-flash')) return 1
                    if (aName.includes('3.5-flash') && !bName.includes('3.5-flash')) return -1
                    if (bName.includes('3.5-flash') && !aName.includes('3.5-flash')) return 1
                    return 0
                  })
                  
                  const discoveredModel = validModels[0].name.replace('models/', '')
                  const { GoogleGenAI } = await import('@google/genai')
                  const ai = new GoogleGenAI({ apiKey: apiKeys[i], httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS } })
                  const response = await ai.models.generateContent({
                    model: discoveredModel,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                  })
                  
                   const mergedContent = cleanModelCode(response.text)
                   if (!mergedContent) continue
                  
                   return { success: true, mergedContent }
                }
              }
            }
          } catch (e) { /* ignore */ }
        }
      }

      return {
        success: false,
        error: isGeminiTimeout(lastError)
          ? 'Gemini took too long to merge the code. Free-tier keys were rotated; please try again with a smaller change.'
          : (lastError || 'Failed to merge code.')
      }
    }
  )

  // ========================================================================
  // Settings (simple for MVP)
  // ========================================================================

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    // For MVP, return defaults — Phase 7 will add persistent storage
    return {
      cppStandard: 'c++17',
      executionTimeoutMs: 60000,
      theme: 'dark',
      fontSize: 14
    }
  })
}

/**
 * Cleanup on app exit
 */
export function cleanupIpc(): void {
  if (ptyManager) {
    ptyManager.killAll()
  }
}
