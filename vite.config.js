// build: 20260618
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
  },
  optimizeDeps: {
    esbuildOptions: {
      jsx: 'automatic',
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes far less often than app code -- splitting it
        // into its own chunk means a returning visitor's browser can keep
        // it cached across deploys instead of re-downloading react/
        // react-dom/react-router-dom/supabase-js every time app code ships.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
  },
})
