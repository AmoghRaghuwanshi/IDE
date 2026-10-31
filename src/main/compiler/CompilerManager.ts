// ============================================================================
// Language Adapter Interface + Compiler Adapters (C, C++, Python)
// ============================================================================

import { execFile } from 'child_process'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import type {
  LanguageId,
  ToolchainStatus,
  CompileOptions,
  CompileResult
} from '../../shared/types'
import { platform, findExecutable, getToolVersion } from '../platform/PlatformAdapter'
import { parseGccErrors } from '../errors/GccErrorParser'

// ============================================================================
// Language Adapter Interface
// ============================================================================

export interface LanguageAdapter {
  language: LanguageId
  supportsCompileStep: boolean
  detectToolchain(customPath?: string | null): Promise<ToolchainStatus>
  compile(
    sourceCode: string,
    sourceName: string,
    outputDir: string,
    options?: CompileOptions
  ): Promise<CompileResult>
  getRunCommand(compiledPath: string): { command: string; args: string[] }
}

// ============================================================================
// Session directory management
// ============================================================================

function getSessionDir(): string {
  const sessionId = `codeforge-${process.pid}`
  const dir = join(tmpdir(), sessionId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function contentHash(content: string): string {
  return createHash('md5').update(content).digest('hex').slice(0, 12)
}

/**
 * Build an environment object that includes the compiler's bin directory in PATH.
 * GCC needs its sibling tools (cc1plus, as, ld) to be findable.
 */
function getCompilerEnv(compilerPath: string): Record<string, string> {
  const { dirname } = require('path')
  const binDir = dirname(compilerPath)

  const env: Record<string, string> = {}
  let existingPath = ''
  
  for (const key in process.env) {
    if (key.toLowerCase() === 'path') {
      existingPath = process.env[key] || ''
    } else {
      env[key] = process.env[key] || ''
    }
  }

  // Prepend the compiler's bin directory so its tools are found first
  env['PATH'] = `${binDir};${existingPath}`
  
  return env
}

// ============================================================================
// C Adapter
// ============================================================================

export class CAdapter implements LanguageAdapter {
  language: LanguageId = 'c'
  supportsCompileStep = true

  async detectToolchain(customPath?: string | null): Promise<ToolchainStatus> {
    const execPath = customPath || (await findExecutable('gcc'))
    if (!execPath) {
      return { language: 'c', available: false, path: null, version: null, error: 'gcc not found' }
    }
    const version = await getToolVersion(execPath)
    return { language: 'c', available: true, path: execPath, version }
  }

  async compile(
    sourceCode: string,
    sourceName: string,
    outputDir: string,
    options?: CompileOptions
  ): Promise<CompileResult> {
    const start = Date.now()
    const sessionDir = outputDir || getSessionDir()
    const srcFile = join(sessionDir, sourceName || 'main.c')
    const outFile = join(sessionDir, platform.isWindows ? 'main.exe' : 'main')

    writeFileSync(srcFile, sourceCode, 'utf-8')

    const args = [srcFile, '-o', outFile, '-g', '-Wall', '-Wextra']
    if (options?.extraFlags) args.push(...options.extraFlags)

    const toolchain = await this.detectToolchain()
    if (!toolchain.available || !toolchain.path) {
      return {
        success: false,
        outputPath: null,
        errors: [],
        rawStderr: 'gcc not found. Please install GCC.',
        rawStdout: '',
        durationMs: Date.now() - start
      }
    }

    return new Promise<CompileResult>((resolve) => {
      execFile(toolchain.path!, args, { timeout: 30000, env: getCompilerEnv(toolchain.path!) }, (error, stdout, stderr) => {
        const errors = parseGccErrors(stderr, 'c', { sourceName })
        const success = !error || error.code === 0
        resolve({
          success: success && errors.filter((e) => e.severity === 'error').length === 0,
          outputPath: success ? outFile : null,
          errors,
          rawStderr: stderr,
          rawStdout: stdout,
          durationMs: Date.now() - start
        })
      })
    })
  }

  getRunCommand(compiledPath: string): { command: string; args: string[] } {
    return { command: compiledPath, args: [] }
  }
}

// ============================================================================
// C++ Adapter
// ============================================================================

export class CppAdapter implements LanguageAdapter {
  language: LanguageId = 'cpp'
  supportsCompileStep = true

  async detectToolchain(customPath?: string | null): Promise<ToolchainStatus> {
    const execPath = customPath || (await findExecutable('g++'))
    if (!execPath) {
      return {
        language: 'cpp',
        available: false,
        path: null,
        version: null,
        error: 'g++ not found'
      }
    }
    const version = await getToolVersion(execPath)
    return { language: 'cpp', available: true, path: execPath, version }
  }

  async compile(
    sourceCode: string,
    sourceName: string,
    outputDir: string,
    options?: CompileOptions
  ): Promise<CompileResult> {
    const start = Date.now()
    const sessionDir = outputDir || getSessionDir()
    const srcFile = join(sessionDir, sourceName || 'main.cpp')
    const outFile = join(sessionDir, platform.isWindows ? 'main.exe' : 'main')

    writeFileSync(srcFile, sourceCode, 'utf-8')

    const standard = options?.cppStandard || 'c++17'
    const args = [srcFile, '-o', outFile, '-g', '-Wall', '-Wextra', `-std=${standard}`]
    if (options?.extraFlags) args.push(...options.extraFlags)

    const toolchain = await this.detectToolchain()
    if (!toolchain.available || !toolchain.path) {
      return {
        success: false,
        outputPath: null,
        errors: [],
        rawStderr: 'g++ not found. Please install G++.',
        rawStdout: '',
        durationMs: Date.now() - start
      }
    }

    return new Promise<CompileResult>((resolve) => {
      execFile(toolchain.path!, args, { timeout: 30000, env: getCompilerEnv(toolchain.path!) }, (error, stdout, stderr) => {
        const errors = parseGccErrors(stderr, 'cpp', { sourceName })
        const success = !error || error.code === 0
        resolve({
          success: success && errors.filter((e) => e.severity === 'error').length === 0,
          outputPath: success ? outFile : null,
          errors,
          rawStderr: stderr,
          rawStdout: stdout,
          durationMs: Date.now() - start
        })
      })
    })
  }

  getRunCommand(compiledPath: string): { command: string; args: string[] } {
    return { command: compiledPath, args: [] }
  }
}

// ============================================================================
// Python Adapter
// ============================================================================

export class PythonAdapter implements LanguageAdapter {
  language: LanguageId = 'python'
  supportsCompileStep = false

  async detectToolchain(customPath?: string | null): Promise<ToolchainStatus> {
    // Try python3 first, then python
    const execPath = customPath || (await findExecutable('python3')) || (await findExecutable('python'))
    if (!execPath) {
      return {
        language: 'python',
        available: false,
        path: null,
        version: null,
        error: 'python not found'
      }
    }
    const version = await getToolVersion(execPath)
    return { language: 'python', available: true, path: execPath, version }
  }

  async compile(
    sourceCode: string,
    sourceName: string,
    outputDir: string,
    _options?: CompileOptions
  ): Promise<CompileResult> {
    // Python doesn't have a compile step — write to temp and return success
    const start = Date.now()
    const sessionDir = outputDir || getSessionDir()
    const srcFile = join(sessionDir, sourceName || 'main.py')

    writeFileSync(srcFile, sourceCode, 'utf-8')

    return {
      success: true,
      outputPath: srcFile,
      errors: [],
      rawStderr: '',
      rawStdout: '',
      durationMs: Date.now() - start
    }
  }

  getRunCommand(compiledPath: string): { command: string; args: string[] } {
    // Use python or python3 depending on what's available
    return { command: 'python', args: [compiledPath] }
  }
}

// ============================================================================
// Compiler Manager — registry + orchestrator
// ============================================================================

export class CompilerManager {
  private adapters: Map<LanguageId, LanguageAdapter> = new Map()
  private lastHash: Map<string, string> = new Map()
  private lastOutput: Map<string, string> = new Map()

  constructor() {
    this.adapters.set('c', new CAdapter())
    this.adapters.set('cpp', new CppAdapter())
    this.adapters.set('python', new PythonAdapter())
  }

  getAdapter(language: LanguageId): LanguageAdapter | undefined {
    return this.adapters.get(language)
  }

  async detectAllToolchains(): Promise<Record<LanguageId, ToolchainStatus>> {
    const results: Record<LanguageId, ToolchainStatus> = {} as Record<LanguageId, ToolchainStatus>
    for (const [lang, adapter] of this.adapters) {
      results[lang] = await adapter.detectToolchain()
    }
    return results
  }

  async compileAndGetRunCommand(
    language: LanguageId,
    sourceCode: string,
    sourceName: string,
    options?: CompileOptions
  ): Promise<{
    compileResult: CompileResult
    runCommand: { command: string; args: string[] } | null
  }> {
    const adapter = this.adapters.get(language)
    if (!adapter) {
      throw new Error(`No adapter for language: ${language}`)
    }

    const sessionDir = getSessionDir()

    // Check content hash to skip recompile if unchanged
    const hash = contentHash(sourceCode)
    const cacheKey = `${language}:${sourceName}`
    const cachedOutput = this.lastOutput.get(cacheKey)
    if (
      adapter.supportsCompileStep &&
      this.lastHash.get(cacheKey) === hash &&
      cachedOutput &&
      existsSync(cachedOutput)
    ) {
      return {
        compileResult: {
          success: true,
          outputPath: cachedOutput,
          errors: [],
          rawStderr: '',
          rawStdout: '',
          durationMs: 0
        },
        runCommand: adapter.getRunCommand(cachedOutput)
      }
    }

    const compileResult = await adapter.compile(sourceCode, sourceName, sessionDir, options)

    if (compileResult.success && compileResult.outputPath) {
      this.lastHash.set(cacheKey, hash)
      this.lastOutput.set(cacheKey, compileResult.outputPath)

      // For Python, detect toolchain to get the correct python executable path
      let runCommand: { command: string; args: string[] }
      if (language === 'python') {
        const toolchain = await adapter.detectToolchain()
        if (toolchain.available && toolchain.path) {
          runCommand = { command: toolchain.path, args: [compileResult.outputPath] }
        } else {
          runCommand = adapter.getRunCommand(compileResult.outputPath)
        }
      } else {
        runCommand = adapter.getRunCommand(compileResult.outputPath)
      }

      return { compileResult, runCommand }
    }

    return { compileResult, runCommand: null }
  }
}
