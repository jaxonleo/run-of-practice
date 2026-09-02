// Frontend error reporting (stability-and-environments pass, §6.1; expanded
// 2026-09-01 with user context, on-error session replay, low-rate tracing).
// DSN is public by design (Sentry's own model -- it's meant to ship in the
// client bundle; write access to a project is gated by the DSN's own project
// scope, not secrecy). environment/release come from
// VERCEL_ENV/VERCEL_GIT_COMMIT_SHA, injected at build time via
// vite.config.js's `define` (Vercel always provides these during a build; no
// dashboard env-var setup needed for them specifically). No DSN (e.g. local
// dev with nothing set in .env) means this quietly no-ops rather than
// erroring -- Sentry.init requires a dsn to do anything, and every capture
// call becomes a no-op without one.
import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_ENVIRONMENT || 'development',
    release: import.meta.env.VITE_RELEASE || undefined,
    integrations: [
      // Web Vitals plus slow-load / navigation / resource spans. Transactions
      // are named by URL pathname (not the react-router route pattern) --
      // wiring the reactRouterV6 integration for pattern names is a later
      // refinement, not needed for a first useful signal.
      Sentry.browserTracingIntegration(),
      // A DOM recording of the ~30s before a crash -- for the "it desynced
      // and I don't know what I tapped" class of report (see the live-session
      // sync gotchas). Never records a healthy session
      // (replaysSessionSampleRate: 0); records every session that hits an
      // error (replaysOnErrorSampleRate: 1.0). All text is masked and all
      // media blocked, so a replay never carries a roster name, note text,
      // or an email address.
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    // Small user base, generous free-tier span quota -- 20% is enough to see
    // a slow page load or a slow Supabase RPC trend without tracing every
    // navigation.
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Drop errors thrown entirely from a browser extension -- common noise,
      // not our code, and it still counts against the error quota.
      const frames = event.exception?.values?.[0]?.stacktrace?.frames || []
      if (
        frames.length > 0 &&
        frames.every(f => /(chrome|moz|safari-web|safari)-extension:\/\//.test(f.filename || ''))
      ) {
        return null
      }
      return event
    },
  })
}

// Called from App.jsx's auth effect so every subsequent error, replay, and
// trace is tied to a real coach -- "someone hit this" becomes "coach X hit
// this at 7:42, reach out." Pass null on sign-out to clear it. No-ops when
// Sentry was never initialized (no DSN).
export function setSentryUser(user) {
  if (!dsn) return
  Sentry.setUser(user ? { id: user.id, email: user.email } : null)
}
