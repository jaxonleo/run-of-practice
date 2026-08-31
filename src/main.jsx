import './sentry.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err))
  })
}

// A deploy mid-session means a coach's tab is still holding the previous
// bundle's hashed chunk filenames -- the moment React.lazy tries to load one
// that a new deploy has already replaced, it 404s. Reload once to pick up
// the fresh index.html (and its correct chunk references) instead of
// leaving the app broken mid-drill. Guarded by a sessionStorage flag so a
// genuinely broken deploy can't loop forever; it naturally re-arms itself
// next tab/session since sessionStorage doesn't persist across those.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (sessionStorage.getItem('chunkReloadAttempted')) return
  sessionStorage.setItem('chunkReloadAttempted', '1')
  window.location.reload()
})
