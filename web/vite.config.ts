import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { handleApiRequest } from './server/apiRouter'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'codeforge-api-middleware',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const handled = await handleApiRequest(req, res)
          if (!handled) next()
        })
      }
    }
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor', '@monaco-editor/react'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit']
        }
      }
    }
  }
})
