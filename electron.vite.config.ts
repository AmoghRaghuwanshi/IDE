import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // Clean once with retry support before the build; Vite's synchronous
    // cleanup can fail with ENOTEMPTY on Windows after Electron closes files.
    build: { emptyOutDir: false },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
