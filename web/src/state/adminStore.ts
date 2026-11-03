import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const STORAGE_KEY = 'codeforge_admin_settings'
const ADMIN_USERNAME = 'Amogh'
const ADMIN_PASSWORD = 'Amogh1234'

export interface AdminStoreState {
  isAuthenticated: boolean
  adminKeys: string[]
  activeKeyIndex: number
  allowGuestAccess: boolean

  login: (username: string, pass: string) => { success: boolean; error?: string }
  logout: () => void
  addAdminKey: (key: string) => { success: boolean; error?: string }
  removeAdminKey: (index: number) => void
  setActiveKeyIndex: (index: number) => void
  setAllowGuestAccess: (allow: boolean) => void
  getAdminKey: () => string | null
  rotateAdminKey: () => string | null
  hasAdminKey: () => boolean
}

export const useAdminStore = create<AdminStoreState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      adminKeys: [],
      activeKeyIndex: 0,
      allowGuestAccess: true,

      login: (username: string, pass: string) => {
        if (username.trim() === ADMIN_USERNAME && pass.trim() === ADMIN_PASSWORD) {
          set({ isAuthenticated: true })
          return { success: true }
        }
        return { success: false, error: 'Invalid username or password.' }
      },

      logout: () => {
        set({ isAuthenticated: false })
      },

      addAdminKey: (rawKey: string) => {
        const key = rawKey.trim()
        if (!key) {
          return { success: false, error: 'API key cannot be empty.' }
        }
        if (!key.startsWith('AIza') && key.length < 20) {
          return { success: false, error: 'Please enter a valid Google Gemini API key (starts with AIzaSy...)' }
        }
        const state = get()
        if (state.adminKeys.includes(key)) {
          return { success: false, error: 'This API key has already been added.' }
        }

        const newKeys = [...state.adminKeys, key]
        set({
          adminKeys: newKeys,
          activeKeyIndex: newKeys.length - 1
        })
        return { success: true }
      },

      removeAdminKey: (index: number) => {
        const state = get()
        const newKeys = state.adminKeys.filter((_, i) => i !== index)
        const newActive = newKeys.length === 0 ? 0 : Math.min(state.activeKeyIndex, newKeys.length - 1)
        set({
          adminKeys: newKeys,
          activeKeyIndex: newActive
        })
      },

      setActiveKeyIndex: (index: number) => {
        const state = get()
        if (index >= 0 && index < state.adminKeys.length) {
          set({ activeKeyIndex: index })
        }
      },

      setAllowGuestAccess: (allow: boolean) => {
        set({ allowGuestAccess: allow })
      },

      getAdminKey: () => {
        const state = get()
        if (state.adminKeys.length === 0) return null
        const idx = state.activeKeyIndex >= 0 && state.activeKeyIndex < state.adminKeys.length
          ? state.activeKeyIndex
          : 0
        return state.adminKeys[idx]
      },

      rotateAdminKey: () => {
        const state = get()
        if (state.adminKeys.length <= 1) return state.getAdminKey()
        const nextIdx = (state.activeKeyIndex + 1) % state.adminKeys.length
        set({ activeKeyIndex: nextIdx })
        return state.adminKeys[nextIdx]
      },

      hasAdminKey: () => {
        return get().adminKeys.length > 0
      }
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        adminKeys: state.adminKeys,
        activeKeyIndex: state.activeKeyIndex,
        allowGuestAccess: state.allowGuestAccess
      })
    }
  )
)
