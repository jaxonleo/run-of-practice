import { useState, useEffect, useCallback } from "react";
import {
  listBenchmarkRecordingGrants, createBenchmarkRecordingGrant, revokeBenchmarkRecordingGrant,
} from "../supabase.js";

// Helper link creation, copying, revocation, and history -- pulled out of the
// primary recording surface into its own sheet (ROP Design System v1, SS11:
// "Helper link creation, copying, revocation, and active-link administration
// live behind a Helpers action or sheet, not inside the primary data-entry
// surface"). Grants are assessment-scoped in the schema (benchmark_recording_
// grants.assessment_id), so this sheet is too, matching BenchmarkLivePanel's
// own scope rather than inventing a team-wide model the data doesn't have.

export default function BenchmarkHelpersSheet({ assessmentId, subjectMode, participants, onClose }) {
  const [grants, setGrants] = useState(null); // null = loading
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [scope, setScope] = useState(subjectMode === "team" ? "team" : "players");
  const [newToken, setNewToken] = useState(null); // { token, scope } -- shown once, never again

  const refresh = useCallback(async () => {
    const { data, error } = await listBenchmarkRecordingGrants(assessmentId);
    if (error || (data && data.error)) { setErr("Could not load helper links."); setGrants([]); return; }
    setGrants(Array.isArray(data) ? data : []);
  }, [assessmentId]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setCreating(true); setErr("");
    const playerIds = scope === "players" ? participants.filter(p => !p.is_team_subject && p.player_id).map(p => p.player_id) : [];
    const { data, error } = await createBenchmarkRecordingGrant(assessmentId, { subjectScope: scope, playerIds });
    setCreating(false);
    if (error || !data || !data.token) { setErr("Could not create a helper link."); return; }
    setNewToken({ token: data.token, scope });
    await refresh();
  };
  const revoke = async (id) => { await revokeBenchmarkRecordingGrant(id); await refresh(); };
  const recordLink = newToken ? (typeof window !== "undefined" ? window.location.origin : "") + "/brec/" + newToken.token : "";
  const copy = () => { try { navigator.clipboard.writeText(recordLink); } catch { /* best-effort */ } };

  return (
    <div className="movly" style={{ zIndex: 340 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div className="mtitle">Helpers</div>
          <button type="button" className="btn ghost bxs" onClick={onClose}>Done</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>Anyone with a recording link can view and enter results for their assigned scope, but cannot start the practice or see history/analytics.</div>

        {subjectMode !== "team" && <div className="fld">
          <label className="lbl">New link covers</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className={"seg" + (scope === "players" ? " on" : "")} onClick={() => setScope("players")}>All listed players</button>
            <button type="button" className={"seg" + (scope === "team" ? " on" : "")} onClick={() => setScope("team")}>Team result</button>
          </div>
        </div>}
        <button type="button" className="btn primary bmd bfull" disabled={creating} onClick={create}>{creating ? "Creating..." : "+ Create Helper Link"}</button>

        {newToken && <div style={{ marginTop: 10, background: "var(--surface-soft)", borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>New link ({newToken.scope === "team" ? "team result" : "all listed players"})</div>
          <div style={{ fontSize: 12, wordBreak: "break-all", margin: "4px 0", fontFamily: "'DM Mono',monospace" }}>{recordLink}</div>
          <button type="button" className="btn ghost bxs" onClick={copy}>Copy Link</button>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>Shown once -- copy it now. Expires in 12 hours, or sooner if finalized/archived.</div>
        </div>}

        {err && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{err}</div>}

        <div style={{ marginTop: 14 }}>
          <div className="lbl" style={{ marginBottom: 6 }}>All Links</div>
          {grants === null && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Loading...</div>}
          {grants && grants.length === 0 && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No helper links yet for this assessment.</div>}
          {grants && grants.map(g => (
            <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12 }}>
                <div>{g.subject_scope === "team" ? "Team result" : (g.permitted_player_ids || []).length + " players"}{g.attribution_label ? " · " + g.attribution_label : ""}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 11 }}>{grantStatusLabel(g)}</div>
              </div>
              {g.is_active && <button type="button" className="btn ghost bxs" onClick={() => revoke(g.id)}>Revoke</button>}
              {!g.is_active && <span className={"status " + (g.revoked_at ? "danger" : "neutral")}>{g.revoked_at ? "Revoked" : "Expired"}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function grantStatusLabel(g) {
  const created = new Date(g.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (g.revoked_at) return "Created " + created + " · revoked";
  if (!g.is_active) return "Created " + created + " · expired";
  return "Created " + created + " · active";
}
