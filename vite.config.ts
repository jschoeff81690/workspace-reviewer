import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiPort = process.env.GIT_REVIEWER_API_PORT ?? '4300'

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  server: {
    port: 4301,
    strictPort: true,
    proxy: {
      // Includes /api/events: the dev proxy streams SSE without buffering.
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
})
