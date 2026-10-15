// Value-moment selection and throttling (Free / Pro / Organization
// packaging handoff, Phase D). Pure functions over the coach's
// profiles.upsell_state, so the rules are unit-tested apart from any
// screen:
//   * at most 1 new value moment per day and 2 per rolling 7 days;
//   * a moment, once shown, stays on Home until dismissed (re-showing an
//     active card is not a new impression);
//   * Dismiss snoozes that ID for 30 days; once the snooze ends it may fire
//     again (re-armed); a second dismissal retires it for good;
//   * one card at a time, in the caller's priority order.

const DAY = 24 * 60 * 60 * 1000;

function momentRecord(state, id) {
  return (state && state.moments && state.moments[id]) || null;
}

export function isRetired(record) {
  return !!record && (record.dismissals || 0) >= 2;
}

// candidates: catalog IDs whose trigger currently holds, highest priority
// first. Returns { id, isNew } or null.
export function pickValueMoment(candidates, state, now = Date.now()) {
  if (!candidates || !candidates.length) return null;

  // A card already on screen keeps showing while its trigger still holds.
  for (const id of candidates) {
    const r = momentRecord(state, id);
    if (r && r.active && !isRetired(r)) return { id, isNew: false };
  }

  const impressions = ((state && state.impressions) || []).map(t => new Date(t).getTime()).filter(t => !Number.isNaN(t));
  if (impressions.some(t => now - t < DAY)) return null;
  if (impressions.filter(t => now - t < 7 * DAY).length >= 2) return null;

  for (const id of candidates) {
    const r = momentRecord(state, id);
    if (!r) return { id, isNew: true };
    if (isRetired(r)) continue;
    const snoozedUntil = r.snoozed_until ? new Date(r.snoozed_until).getTime() : 0;
    // Shown before and never dismissed can't happen here (that would be
    // active above); dismissed once and the snooze is over means re-armed.
    if ((r.dismissals || 0) >= 1 && snoozedUntil <= now) return { id, isNew: true };
  }
  return null;
}

// V3: Next Practice Guidance expanded 3 or more times in 14 days.
export function countRecent(state, counterKey, windowMs, now = Date.now()) {
  const list = (state && state.counters && state.counters[counterKey]) || [];
  return list.map(t => new Date(t).getTime()).filter(t => !Number.isNaN(t) && now - t < windowMs).length;
}

// V4 marker: "<completedCount>|<streak>|<category name>". A new completed
// run with the pulse still on "largest gap missing from the next plan"
// extends the streak; any other state resets it. Returns the new marker,
// or null when nothing changed (so the caller skips a write).
export function nextGapStreakMarker(previous, completedCount, pulseState, categoryName) {
  const [lastCountStr, streakStr] = (previous || "").split("|");
  const lastCount = Number(lastCountStr);
  const streak = Number(streakStr) || 0;
  const missing = pulseState === "missing_from_next_plan";
  if (!missing) return streak === 0 && previous ? null : `${completedCount}|0|`;
  if (previous && lastCount === completedCount) return null;
  return `${completedCount}|${streak + 1}|${categoryName || ""}`;
}
export function gapStreak(marker) {
  const parts = (marker || "").split("|");
  return { streak: Number(parts[1]) || 0, categoryName: parts[2] || "" };
}
