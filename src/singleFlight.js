// Single-flight guard for save-style actions. While one call is in flight,
// every other call made through the same guard is dropped (resolves to
// undefined) rather than queued -- a second click on a "Save"/"Schedule"
// button that is still working must not start a second save.
//
// Real bug this exists for (AZBC 10U, 2026-09-21): the Builder's save
// handlers passed `existingId` (null for a brand-new practice) to
// savePracticeTree, and only stored the new row's id after the whole save --
// insert, every activity/station write, then a full planning refresh --
// finished. With no visual change during that wait, a coach clicked again
// two more times; each click still saw existingId === null and inserted its
// own practice. Three identical practices, 2-3 seconds apart.
//
// The in-flight flag is a plain closure variable, not React state, so it is
// set synchronously: a second click in the same tick as the first (before
// React has re-rendered a disabled button) is still caught.
//
// onChange(kind | null) reports what is currently running so the UI can
// show it; it is called with the kind on start and null on finish (success
// or throw).
export function createSingleFlight(onChange) {
  let running = null
  return async function run(kind, fn) {
    if (running) return undefined
    running = kind
    if (onChange) onChange(kind)
    try {
      return await fn()
    } finally {
      running = null
      if (onChange) onChange(null)
    }
  }
}
