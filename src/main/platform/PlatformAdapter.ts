// ============================================================================
// Platform Adapter — isolates all OS-specific logic in one place
// ============================================================================

import { exec, execSync } from 'child_process'
import { join } from 'path'

const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

/** Common install locations for compilers on Windows */
const WINDOWS_COMPILER_PATHS = [
  'D:\\msys2\\ucrt64\\bin',
  'D:\\msys2\\mingw64\\bin',
  'D:\\msys2\\usr\\bin',
  'C:\\msys64\\mingw64\\bin',
  'C:\\msys64\\ucrt64\\bin',
  'C:\\msys64\\usr\\bin',
  'C:\\msys2\\ucrt64\\bin',
  'C:\\msys2\\mingw64\\bin',
  'C:\\msys2\\usr\\bin',
  'C:\\MinGW\\bin',
  'C:\\TDM-GCC-64\\bin',
  'C:\\Program Files\\mingw-w64\\bin',
  'C:\\Program Files (x86)\\mingw-w64\\bin'
]

/** Try to find an executable by name */
export async function findExecutable(name: string): Promise<string | null> {
  const cmd = isWindows ? `where ${name}` : `which ${name}`
  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim()
    // `where` on Windows can return multiple lines; take the first
    const firstLine = result.split(/\r?\n/)[0]
    return firstLine || null
  } catch {
    // Not found in PATH — try common locations on Windows
    if (isWindows) {
      for (const dir of WINDOWS_COMPILER_PATHS) {
        const candidate = join(dir, `${name}.exe`)
        try {
          execSync(`"${candidate}" --version`, { encoding: 'utf-8', timeout: 5000 })
          return candidate
        } catch {
          continue
        }
      }
    }
    return null
  }
}

/** Get version string from a compiler/interpreter */
export async function getToolVersion(execPath: string): Promise<string | null> {
  try {
    const result = execSync(`"${execPath}" --version`, {
      encoding: 'utf-8',
      timeout: 5000
    }).trim()
    // Return the first line which typically contains the version
    return result.split(/\r?\n/)[0]
  } catch {
    return null
  }
}

/** Kill an entire process tree */
export function killProcessTree(pid: number): void {
  try {
    if (isWindows) {
      // Use taskkill with /T (tree) and /F (force) on Windows
      exec(`taskkill /PID ${pid} /T /F`, { timeout: 5000 })
    } else {
      // On POSIX, kill the process group (negative PID)
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // Fallback if process group kill fails
        process.kill(pid, 'SIGTERM')
      }
      // Escalate to SIGKILL after 2 seconds
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            // Process already gone
          }
        }
      }, 2000)
    }
  } catch {
    // Process might already be dead
  }
}

/** Send an interrupt signal (Ctrl+C equivalent) */
export function sendInterrupt(pid: number): void {
  try {
    if (isWindows) {
      // On Windows, GenerateConsoleCtrlEvent isn't directly available,
      // so we rely on killing the process tree
      exec(`taskkill /PID ${pid} /T /F`, { timeout: 5000 })
    } else {
      process.kill(pid, 'SIGINT')
    }
  } catch {
    // Process might already be dead
  }
}

/** Get OS-specific install instructions */
export function getInstallInstructions(
  tool: 'gcc' | 'g++' | 'python' | 'gdb'
): { title: string; instructions: string; command?: string } {
  if (isWindows) {
    switch (tool) {
      case 'gcc':
      case 'g++':
        return {
          title: 'Install MinGW-w64 via MSYS2',
          instructions:
            '1. Download MSYS2 from https://www.msys2.org\n2. Run the installer\n3. Open MSYS2 terminal and run the command below\n4. Add C:\\msys64\\ucrt64\\bin to your system PATH',
          command: 'pacman -S mingw-w64-ucrt-x86_64-gcc'
        }
      case 'python':
        return {
          title: 'Install Python',
          instructions:
            'Download Python from https://www.python.org/downloads/\nMake sure to check "Add Python to PATH" during installation.',
          command: undefined
        }
      case 'gdb':
        return {
          title: 'Install GDB via MSYS2',
          instructions:
            'Open MSYS2 terminal and run the command below.',
          command: 'pacman -S mingw-w64-ucrt-x86_64-gdb'
        }
    }
  } else if (isMac) {
    switch (tool) {
      case 'gcc':
      case 'g++':
        return {
          title: 'Install Xcode Command Line Tools',
          instructions: 'Run the command below in Terminal.',
          command: 'xcode-select --install'
        }
      case 'python':
        return {
          title: 'Install Python',
          instructions: 'Python 3 is usually pre-installed on macOS.\nIf not, install via Homebrew:',
          command: 'brew install python3'
        }
      case 'gdb':
        return {
          title: 'Install GDB (or use LLDB)',
          instructions:
            'macOS ships with LLDB. For GDB, install via Homebrew.\nNote: GDB requires code signing on macOS.',
          command: 'brew install gdb'
        }
    }
  } else {
    // Linux
    switch (tool) {
      case 'gcc':
      case 'g++':
        return {
          title: 'Install build-essential',
          instructions: 'Run the command below in your terminal:',
          command: 'sudo apt install build-essential'
        }
      case 'python':
        return {
          title: 'Install Python 3',
          instructions: 'Run the command below in your terminal:',
          command: 'sudo apt install python3'
        }
      case 'gdb':
        return {
          title: 'Install GDB',
          instructions: 'Run the command below in your terminal:',
          command: 'sudo apt install gdb'
        }
    }
  }
}

export const platform = {
  isWindows,
  isMac,
  isLinux,
  findExecutable,
  getToolVersion,
  killProcessTree,
  sendInterrupt,
  getInstallInstructions
}
