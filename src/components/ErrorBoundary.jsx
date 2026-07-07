import React from "react";

// Inline styles only, deliberately -- this must render correctly even if
// the crash happened before App's own useEffect had a chance to inject the
// global stylesheet (see the CSS injection in App.jsx).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, background: "#f7f8f6", padding: 24, textAlign: "center", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#111714" }}>Something went wrong</div>
        <div style={{ fontSize: 14, color: "#5a6b62", maxWidth: 320 }}>Run of Practice hit an unexpected error. Your data is safe on the server -- reloading usually fixes this.</div>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: "12px 24px", fontSize: 15, fontWeight: 700, color: "#fff", background: "#2d6a4f", border: "none", borderRadius: 8, cursor: "pointer" }}
        >
          Reload
        </button>
      </div>
    );
  }
}
