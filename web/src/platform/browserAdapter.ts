// ============================================================================
// Browser Storage and Local File Adapter using IndexedDB & Web APIs
// ============================================================================

import type { LanguageId } from '../shared/types'
import type { FileDraft } from './types'

const DB_NAME = 'CodeForgeWebDB'
const DB_VERSION = 1
const STORE_DRAFTS = 'file_drafts'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment.'))
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const BrowserStorage = {
  async saveDraft(draft: FileDraft): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_DRAFTS, 'readwrite')
        tx.objectStore(STORE_DRAFTS).put(draft)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      // Fallback to localStorage if IndexedDB is blocked (e.g. private mode)
      try {
        localStorage.setItem(`cf_draft_${draft.id}`, JSON.stringify(draft))
      } catch {
        /* storage quota exceeded or disabled */
      }
    }
  },

  async removeDraft(fileId: string): Promise<void> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_DRAFTS, 'readwrite')
        tx.objectStore(STORE_DRAFTS).delete(fileId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      try {
        localStorage.removeItem(`cf_draft_${fileId}`)
      } catch {
        /* ignore */
      }
    }
  },

  async loadAllDrafts(): Promise<FileDraft[]> {
    try {
      const db = await openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_DRAFTS, 'readonly')
        const req = tx.objectStore(STORE_DRAFTS).getAll()
        req.onsuccess = () => resolve(req.result || [])
        req.onerror = () => reject(req.error)
      })
    } catch {
      // Fallback to localStorage
      const drafts: FileDraft[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('cf_draft_')) {
            const val = localStorage.getItem(key)
            if (val) drafts.push(JSON.parse(val))
          }
        }
      } catch {
        /* ignore */
      }
      return drafts
    }
  }
}

export function detectLanguageFromExt(name: string): LanguageId {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'c') return 'c'
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'h' || ext === 'hpp') return 'cpp'
  return 'python'
}

export async function exportFileToDisk(name: string, content: string): Promise<{ success: boolean; name?: string; error?: string }> {
  try {
    // If showSaveFilePicker is available and permission granted
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: name,
          types: [{
            description: 'Source Code',
            accept: {
              'text/plain': ['.c', '.cpp', '.h', '.py', '.txt']
            }
          }]
        })
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
        return { success: true, name: handle.name }
      } catch (pickerErr: any) {
        if (pickerErr.name === 'AbortError') return { success: false }
        // Fall back to download trigger
      }
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { success: true, name }
  } catch (err: any) {
    return { success: false, error: err.message || String(err) }
  }
}

export function promptLocalFile(): Promise<{ success: boolean; name?: string; content?: string; language?: LanguageId; error?: string }> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.c,.cpp,.cc,.cxx,.h,.hpp,.py,.txt'
    input.style.display = 'none'

    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve({ success: false })
        return
      }
      try {
        const text = await file.text()
        const language = detectLanguageFromExt(file.name)
        resolve({
          success: true,
          name: file.name,
          content: text,
          language
        })
      } catch (err: any) {
        resolve({ success: false, error: err.message || 'Failed to read file' })
      } finally {
        document.body.removeChild(input)
      }
    }

    input.oncancel = () => {
      resolve({ success: false })
      document.body.removeChild(input)
    }

    document.body.appendChild(input)
    input.click()
  })
}
