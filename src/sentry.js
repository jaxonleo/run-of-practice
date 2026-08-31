// Frontend error reporting (stability-and-environments pass, §6.1). DSN is
// public by design (Sentry's own model -- it's meant to ship in the client
// bundle; write access to a project is gated by the DSN's own project scope,
// not secrecy). environment/release come from VERCEL_ENV/VERCEL_GIT_COMMIT_SHA,
// injected at build time via vite.config.js's `define` (Vercel always
// provides these during a build; no dashboard env-var setup needed for them
// specifically). No DSN (e.g. local dev with nothing set in .env) means this
// quietly no-ops rather than erroring -- Sentry.init requires a dsn to do
// anything, and every capture call becomes a no-op without one.
import * as Sentry from '@sentry/react'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_ENVIRONMENT || 'development',
    release: import.meta.env.VITE_RELEASE || undefined,
  })
}
