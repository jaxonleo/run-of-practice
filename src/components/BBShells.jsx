import React from "react";

// Shared layout-only shells for the Big Browser (BB) pass (forty-ninth
// session). These own arrangement only -- no state, no data fetching, no
// business logic, and no callback props like onSave. A screen renders its
// own existing components into these; the shell just places them
// differently at BB than the same screen already renders them at mobile.
// See the .bb-two-pane/.bb-pane/.bb-centered-page/.bb-fill-height rules in
// App.jsx's CSS block for the actual sizing.

// Two independently-scrolling side-by-side panes -- used by Builder (Run of
// Practice left, Library right) and any other screen that wants a real
// plan/browse or master/detail split at BB. Each pane gets its own
// overflow-y:auto scroll container. The screen using this shell is
// responsible for also applying "bb-fill-height" to its own outer
// container at BB, so the panes have a fixed height to scroll within
// instead of .screen growing with their combined content.
export function TwoPane({ left, right, leftBasis, rightBasis }) {
  return (
    <div className="bb-two-pane">
      <div className="bb-pane bb-pane-left" style={leftBasis ? { flexBasis: leftBasis } : undefined}>{left}</div>
      <div className="bb-pane bb-pane-right" style={rightBasis ? { flexBasis: rightBasis } : undefined}>{right}</div>
    </div>
  );
}

// Caps a single-column screen's content width at BB (forms, settings,
// simple lists) instead of letting it stretch across a wide monitor.
export function CenteredPage({ children, maxWidth }) {
  return (
    <div className="bb-centered-page" style={maxWidth ? { maxWidth } : undefined}>
      {children}
    </div>
  );
}
