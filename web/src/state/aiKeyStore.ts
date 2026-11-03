import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const STORAGE_KEY = 'codeforge_gemini_api_keys'
const MAX_KEYS = 5

export interface AiKeyStoreState {
  keys: string[]
  activeKeyIndex: number
  isModalOpen: boolean
  modalReason: string | null
  
  openModal: (reason?: string) => void
  closeModal: () => void
  addKey: (key: string) => { success: boolean; error?: string }
  removeKey: (index: number) => void
  setActiveKeyIndex: (index: number) => void
  getActiveKey: () => string | null
  rotateToNextKey: () => string | null
  hasKey: () => boolean
  clearAllKeys: () => void
}

export const useAiKeyStore = create<AiKeyStoreState>()(
  persist(
    (set, get) => ({
      keys: [],
      activeKeyIndex: 0,
      isModalOpen: false,
      modalReason: null,

      openModal: (reason?: string) => set({ isModalOpen: true, modalReason: typeof reason === 'string' ? reason : null }),
      closeModal: () => set({ isModalOpen: false, modalReason: null }),

      addKey: (rawKey: string) => {
        const key = rawKey.trim()
        if (!key) {
          return { success: false, error: 'API key cannot be empty.' }
        }
        if (!key.startsWith('AIza') && key.length < 20) {
          return { success: false, error: 'Please enter a valid Google Gemini API key (starts with AIzaSy...)' }
        }
        const state = get()
        if (state.keys.includes(key)) {
          return { success: false, error: 'This API key has already been added.' }
        }
        if (state.keys.length >= MAX_KEYS) {
          return { success: false, error: `Maximum limit of ${MAX_KEYS} API keys reached. Delete an existing key to add a new one.` }
        }

        const newKeys = [...state.keys, key]
        set({
          keys: newKeys,
          activeKeyIndex: newKeys.length - 1
        })
        return { success: true }
      },

      removeKey: (index: number) => {
        const state = get()
        const newKeys = state.keys.filter((_, i) => i !== index)
        const newActive = newKeys.length === 0 ? 0 : Math.min(state.activeKeyIndex, newKeys.length - 1)
        set({
          keys: newKeys,
          activeKeyIndex: newActive
        })
      },

      setActiveKeyIndex: (index: number) => {
        const state = get()
        if (index >= 0 && index < state.keys.length) {
          set({ activeKeyIndex: index })
        }
      },

      getActiveKey: () => {
        const state = get()
        if (state.keys.length === 0) return null
        const idx = state.activeKeyIndex >= 0 && state.activeKeyIndex < state.keys.length
          ? state.activeKeyIndex
          : 0
        return state.keys[idx]
      },

      rotateToNextKey: () => {
        const state = get()
        if (state.keys.length <= 1) return state.getActiveKey()
        const nextIdx = (state.activeKeyIndex + 1) % state.keys.length
        set({ activeKeyIndex: nextIdx })
        return state.keys[nextIdx]
      },

      hasKey: () => {
        return get().keys.length > 0
      },

      clearAllKeys: () => {
        set({ keys: [], activeKeyIndex: 0 })
      }
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        keys: state.keys,
        activeKeyIndex: state.activeKeyIndex
      })
    }
  )
)
