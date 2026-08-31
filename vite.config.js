// build: 20260618
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// Vercel always provides these during any build (preview or production),
// no dashboard env-var setup needed -- bridged into import.meta.env here
// since Vite only auto-exposes vars already prefixed VITE_ in the actual
// build environment, and these aren't. "Production build" below means a
// real `vite build` (minified/optimized), which Vercel runs for every
// deployment, staging included -- not Vercel's Production vs Preview
// environment distinction. Source maps need uploading for both, or a
// staging-only crash is unreadable in Sentry same as a prod one would be.
const vercelEnv = process.env.VERCEL_ENV || 'development'
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || 'local'

export default defineConfig({
  plugins: [
    react(),
    // Org/project slugs aren't secrets (visible in the project's own
    // Sentry URL); the auth token is, read from the real environment, not
    // committed. Upload itself is skipped entirely when SENTRY_AUTH_TOKEN
    // isn't set, so a bare local `npm run build` never tries to hit
    // Sentry's API.
    sentryVitePlugin({
      org: 'run-of-practice',
      project: 'run-of-practice-frontend',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      // Explicit, not auto-detected from git HEAD -- must be byte-identical
      // to the `release` tag Sentry.init() sets at runtime (src/sentry.js),
      // or an uploaded source map never actually matches a real error event.
      release: { name: commitSha },
    }),
  ],
  define: {
    'import.meta.env.VITE_ENVIRONMENT': JSON.stringify(vercelEnv),
    'import.meta.env.VITE_RELEASE': JSON.stringify(commitSha),
  },
  esbuild: {
    jsx: 'automatic',
  },
  optimizeDeps: {
    esbuildOptions: {
      jsx: 'automatic',
    }
  },
  build: {
    // Source maps have to actually exist for the plugin above to have
    // anything to upload; `hidden` still generates them but omits the
    // sourceMappingURL comment from shipped files, so a real visitor's
    // browser never fetches/exposes the map, only Sentry's own upload does.
    sourcemap: 'hidden',
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
