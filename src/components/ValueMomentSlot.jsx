import { useEffect, useRef, useState } from "react";
import { ValueMomentCard } from "./EntitlementNotice.jsx";
import { useEntitlements, useTeamEntitlements, isFull, limitOf, upsellCtasVisible, logUpsellEvent } from "../entitlements.js";
import { fetchUpsellState, updateUpsellState, fetchTeamCompletedSessionCount, fetchTeamHistoryHiddenCount } from "../supabase.js";
import { pickValueMoment, countRecent, nextGapStreakMarker, gapStreak } from "../upsellMoments.js";
import { UPSELL_CATALOG } from "../upsellCatalog.js";

// Home value moments (Free / Pro / Organization packaging, Phase D): one
// dismissible card at a time, below Development Pulse, for the owner of a
// personal team whose plan lacks the feature the moment is about.
// Never rendered while a live session's join bar is showing, never for an
// assistant or an org team, and never while billing is off unless an
// admin turned on the per-browser preview toggle. Throttling rules live in
// upsellMoments.js; state lives server-side in profiles.upsell_state.

const DAY = 24 * 60 * 60 * 1000;
// Priority order when several triggers hold at once.
const PRIORITY = ["V2", "V4", "V6", "V3", "V5", "V1", "O1"];

export default function ValueMomentSlot({ focusTeam, data, coachId, pulse, liveNow }) {
  const eligibleTeam = !!focusTeam && !focusTeam.organizationId && focusTeam.ownerUserId === coachId;
  const gatesOpen = upsellCtasVisible() && !liveNow && eligibleTeam;
  const teamId = eligibleTeam ? focusTeam.id : null;
  const { entitlements: teamEnts } = useTeamEntitlements(gatesOpen ? teamId : null);
  const { entitlements: myEnts } = useEntitlements(!!coachId);
  const [state, setState] = useState(null);
  const [completed, setCompleted] = useState(null);
  const [hidden, setHidden] = useState(null);
  const recordedRef = useRef(new Set());

  useEffect(() => {
    if (!gatesOpen || !coachId) return;
    let alive = true;
    fetchUpsellState(coachId).then(st => { if (alive) setState(st || {}); });
    fetchTeamCompletedSessionCount(teamId).then(n => { if (alive) setCompleted(n); });
    fetchTeamHistoryHiddenCount(teamId).then(n => { if (alive) setHidden(n); });
    return () => { alive = false; };
  }, [gatesOpen, coachId, teamId]);

  // V4 bookkeeping: extend or reset the "largest gap missing from the next
  // plan" streak once per newly completed run.
  useEffect(() => {
    if (!state || completed == null || !pulse || pulse.teamId !== teamId) return;
    const prev = (state.markers || {}).v4 || null;
    const next = nextGapStreakMarker(prev, completed, pulse.state, pulse.categoryName);
    if (next && next !== prev) updateUpsellState("set_marker", "v4", next).then(st => { if (st) setState(st); });
  }, [state && (state.markers || {}).v4, completed, pulse && pulse.state, pulse && pulse.categoryName, teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = gatesOpen && !!state && completed != null && hidden != null && !!teamEnts;
  const locked = key => !isFull(key, teamEnts);
  const markers = (state && state.markers) || {};
  const streak = gapStreak(markers.v4);
  const ownedPersonal = (data.teams || []).filter(t => t.ownerUserId === coachId && !t.organizationId).length;
  const holds = ready ? {
    V1: completed >= 2 && locked("goals.builder_projection"),
    // history.practice_history is a count cap ("full" with a limit on
    // Free), so it is "locked" when it has a limit, not by its state.
    V2: hidden >= 1 && limitOf("history.practice_history", teamEnts) != null,
    V3: countRecent(state, "npg_expand", 14 * DAY) >= 3 && locked("goals.next_practice_guidance"),
    V4: streak.streak >= 2 && locked("goals.builder_projection"),
    V5: completed >= 5 && locked("goals.execution_scorecard"),
    V6: !!markers.v6_team && locked("goals.trends"),
    O1: ownedPersonal >= 3 && limitOf("teams.personal_count", myEnts) != null,
  } : {};
  const pick = ready ? pickValueMoment(PRIORITY.filter(id => holds[id]), state) : null;

  // A new impression is recorded once (server-side state plus analytics);
  // re-showing an already-active card is not a new impression.
  useEffect(() => {
    if (!pick || !pick.isNew || recordedRef.current.has(pick.id)) return;
    recordedRef.current.add(pick.id);
    updateUpsellState("moment_shown", pick.id).then(st => { if (st) setState(st); });
    logUpsellEvent("moment_shown", pick.id, { teamId, featureKey: UPSELL_CATALOG[pick.id].featureKey });
  }, [pick && pick.id, pick && pick.isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pick) return null;

  const tokens = {
    category: streak.categoryName,
    "other team": markers.v6_team,
    "own team": focusTeam.name,
    n: completed,
  };
  const dismiss = () => {
    logUpsellEvent("dismiss", pick.id, { teamId, featureKey: UPSELL_CATALOG[pick.id].featureKey });
    updateUpsellState("moment_dismiss", pick.id).then(st => { if (st) setState(st); });
    setState(s => ({ ...s, moments: { ...(s.moments || {}), [pick.id]: { ...((s.moments || {})[pick.id] || {}), active: false, dismissals: (((s.moments || {})[pick.id] || {}).dismissals || 0) + 1, snoozed_until: new Date(Date.now() + 30 * DAY).toISOString() } } }));
  };
  return (<div style={{ margin: "0 16px 12px" }}>
    <ValueMomentCard catalogId={pick.id} tokens={tokens} teamId={teamId} onDismiss={dismiss} />
  </div>);
}
