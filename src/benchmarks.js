// ── Benchmarks: pure scoring, eligibility and comparison engine ───────────────
//
// This is the ONE shared, deterministic implementation of every official
// Benchmark calculation (ROP-Benchmarks handoff sections 3.3 and 7). Server
// RPCs are the authoritative caller; the client imports the exact same helpers
// for a provisional, clearly-labeled live summary during recording. Nothing in
// here touches the network, React, or Supabase. Every rule is exercised by the
// golden fixtures in benchmarks.test.js with independently-derived expected
// values (handoff section 7.8), so a formula can never silently drift.
//
// Canonical units are stored at full precision; rounding is display-only. A
// display-unit change (feet to metres, mph to km/h) never resets history or
// blocks a comparison, because the canonical value and the protocol version id
// are unchanged.

export const METRIC_TYPES = ['time', 'count', 'distance', 'speed', 'success_rate', 'score_numeric', 'score_rubric'];
export const DIRECTIONS = ['higher', 'lower', 'track']; // 'track' == "Track only"
export const RESULT_RULES = ['single', 'best', 'average', 'total', 'pooled'];

// Which result rules each metric type is allowed to use, and the sensible
// default direction, per the handoff's Measurement types table (section 3.3).
// The direction is still stored explicitly on every saved definition; this is
// only the pre-checked default in the creation form.
export const METRIC_META = {
  time:         { rules: ['single', 'best', 'average', 'total'], direction: 'lower',  decimals: 2 },
  count:        { rules: ['single', 'best', 'average', 'total'], direction: 'higher', decimals: 0 },
  distance:     { rules: ['single', 'best', 'average', 'total'], direction: 'higher', decimals: 1 },
  speed:        { rules: ['single', 'best', 'average'],          direction: 'higher', decimals: 1 },
  success_rate: { rules: ['single', 'pooled'],                   direction: 'higher', decimals: 1 },
  score_numeric:{ rules: ['single', 'best', 'average'],          direction: 'higher', decimals: 1 },
  score_rubric: { rules: ['single'],                             direction: 'higher', decimals: 0 },
};

export function isNumericMetric(metricType) {
  return metricType === 'time' || metricType === 'count' || metricType === 'distance' || metricType === 'speed' || metricType === 'score_numeric';
}
// "Numeric ratio metrics" in the handoff's matched-improvement section (7.4):
// the ones a relative percentage change is meaningful for. Numeric score is
// explicitly excluded (score comparisons use points, never relative percent).
export function isRatioMetric(metricType) {
  return metricType === 'time' || metricType === 'count' || metricType === 'distance' || metricType === 'speed';
}

// ── Precision ────────────────────────────────────────────────────────────────

// Decimal places used to DISPLAY an official result.
export function displayDecimals(protocol) {
  if (protocol && Number.isFinite(protocol.displayDecimals)) return protocol.displayDecimals;
  if (protocol && protocol.metricType === 'score_numeric') return incrementDecimals(protocol.scoreIncrement);
  return (METRIC_META[protocol && protocol.metricType] || { decimals: 2 }).decimals;
}

// Decimal places used to classify a CHANGE as improved / unchanged / worse
// (handoff 7.4: "a UI value of 0.00 cannot simultaneously count as improved").
// An averaged count protocol legitimately shows fractional results even though
// its raw attempts are integers, so its change precision is finer than a plain
// count's.
export function changeDecimals(protocol) {
  const t = protocol && protocol.metricType;
  if (t === 'success_rate') return 1;                 // one decimal percentage point
  if (t === 'count') return protocol.resultRule === 'average' ? 2 : 0;
  if (t === 'score_numeric') return incrementDecimals(protocol.scoreIncrement);
  return (METRIC_META[t] || { decimals: 2 }).decimals;
}

function incrementDecimals(increment) {
  if (!Number.isFinite(increment) || increment <= 0) return 1;
  const s = String(increment);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : Math.min(3, s.length - dot - 1);
}

// Round half away from zero to `decimals` places, then normalise -0 to 0. Used
// only for display and for change classification, never for further math.
export function roundTo(value, decimals) {
  if (!Number.isFinite(value)) return value;
  const f = Math.pow(10, decimals);
  const r = Math.sign(value) * Math.round(Math.abs(value) * f) / f;
  return r === 0 ? 0 : r;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── Direction helpers ────────────────────────────────────────────────────────

// True when `a` is a strictly better numeric result than `b` for this
// direction. 'track' has no notion of better, so it always returns false.
export function isBetter(a, b, direction) {
  if (direction === 'higher') return a > b;
  if (direction === 'lower') return a < b;
  return false;
}

// A hint for phrasing a raw-unit change (handoff 7.4): a time that goes down is
// "faster" only when the protocol's direction is Lower; an endurance time
// (direction Higher) that goes up is "longer".
export function changeVerb(metricType, direction, signedImprovement) {
  if (signedImprovement === 0) return 'unchanged';
  const better = signedImprovement > 0;
  if (metricType === 'time') {
    if (direction === 'lower') return better ? 'faster' : 'slower';
    if (direction === 'higher') return better ? 'longer' : 'shorter';
  }
  return better ? 'higher' : 'lower';
}

// ── Attempt reduction to an official (or partial) result ─────────────────────
//
// protocol: {
//   subjectMode: 'individual' | 'team',
//   metricType, direction, resultRule,
//   scoredAttempts,          // N, positive integer
//   opportunitiesPerSet,     // success_rate only, fixed positive integer
//   rubricLevels,            // score_rubric: [{ id, order, label }], order ascending
//   scoreMin, scoreMax, scoreIncrement,  // score_numeric
// }
//
// attempts: [{ slot, valid, value, successes, opportunities, levelId }]
//   - slot is 0..N-1. Only valid attempts in a real slot are scored.
//   - Replacing an invalid attempt refills the SAME slot; the invalid
//     observation stays in revision history, never as an extra scored slot.
//
// Returns one of:
//   { status: 'official', ...payload }
//   { status: 'partial',  filledSlots, requiredSlots }   // not enough valid data
//   { status: 'none' }                                   // zero valid data
//   { status: 'invalid', reason }                        // impossible input
export function officialResult(protocol, attempts) {
  const N = Math.max(1, protocol.scoredAttempts | 0);
  const rule = protocol.resultRule;
  const dir = protocol.direction;

  // One valid attempt per slot; a later valid attempt in a slot supersedes an
  // earlier one (revision), matching "replacement fills the same scored slot".
  const bySlot = new Map();
  for (const a of attempts || []) {
    if (!a || a.valid !== true) continue;
    const slot = a.slot | 0;
    if (slot < 0 || slot >= N) continue;
    bySlot.set(slot, a);
  }
  const valid = [...bySlot.keys()].sort((x, y) => x - y).map((k) => bySlot.get(k));

  if (protocol.metricType === 'success_rate') {
    const opp = protocol.opportunitiesPerSet | 0;
    if (opp <= 0) return { status: 'invalid', reason: 'opportunities_per_set_required' };
    for (const a of valid) {
      if (!Number.isInteger(a.successes) || !Number.isInteger(a.opportunities)) return { status: 'invalid', reason: 'non_integer_success_rate' };
      if (a.opportunities !== opp) return { status: 'invalid', reason: 'opportunity_count_mismatch' };
      if (a.successes < 0 || a.successes > a.opportunities) return { status: 'invalid', reason: 'successes_out_of_range' };
    }
    if (valid.length === 0) return { status: 'none' };
    if (valid.length < N) return { status: 'partial', filledSlots: valid.length, requiredSlots: N };
    const successes = valid.reduce((s, a) => s + a.successes, 0);
    const opportunities = valid.reduce((s, a) => s + a.opportunities, 0);
    // Pooled numerator/denominator preserved as integers (handoff 7.2).
    return { status: 'official', metricType: 'success_rate', successes, opportunities, proportion: successes / opportunities };
  }

  if (protocol.metricType === 'score_rubric') {
    const levels = protocol.rubricLevels || [];
    const a = valid[0];
    if (!a) return { status: 'none' };
    const lvl = levels.find((l) => l.id === a.levelId);
    if (!lvl) return { status: 'invalid', reason: 'unknown_rubric_level' };
    // A rubric result is a single required observation; extra slots are not a
    // model this release supports.
    return { status: 'official', metricType: 'score_rubric', levelId: lvl.id, levelOrder: lvl.order, levelLabel: lvl.label };
  }

  // Numeric: time / count / distance / speed / score_numeric.
  for (const a of valid) {
    if (!Number.isFinite(a.value)) return { status: 'invalid', reason: 'non_finite_value' };
    if (a.value < 0 && !(protocol.metricType === 'score_numeric' && Number.isFinite(protocol.scoreMin) && protocol.scoreMin < 0)) {
      return { status: 'invalid', reason: 'negative_value' };
    }
    if (protocol.metricType === 'count' && !Number.isInteger(a.value)) return { status: 'invalid', reason: 'non_integer_count' };
  }
  if (valid.length === 0) return { status: 'none' };
  if (valid.length < N) return { status: 'partial', filledSlots: valid.length, requiredSlots: N };

  const vals = valid.map((a) => a.value);
  let value;
  if (rule === 'single') value = vals[0];
  else if (rule === 'best') value = dir === 'lower' ? Math.min(...vals) : Math.max(...vals);
  else if (rule === 'average') value = mean(vals); // may be fractional for counts; raw attempts stay integers
  else if (rule === 'total') value = vals.reduce((s, x) => s + x, 0);
  else return { status: 'invalid', reason: 'unsupported_result_rule' };

  return { status: 'official', metricType: protocol.metricType, value };
}

export const isOfficial = (r) => !!r && r.status === 'official';

// Scalar used for ordering / better-than comparisons of an official result.
function officialScalar(r) {
  if (!isOfficial(r)) return null;
  if (r.metricType === 'success_rate') return r.proportion;
  if (r.metricType === 'score_rubric') return r.levelOrder;
  return r.value;
}

// ── Personal best ───────────────────────────────────────────────────────────
//
// PB is the best OFFICIAL ASSESSMENT result under the protocol's result rule,
// never the best single attempt from an averaged protocol (handoff 7.2). Input
// is the list of prior official results for one subject under one protocol
// version. 'track' protocols have no PB.
export function personalBest(protocol, officialResults) {
  if (protocol.direction === 'track') return null;
  const officials = (officialResults || []).filter(isOfficial);
  if (!officials.length) return null;
  return officials.reduce((best, r) => {
    if (!best) return r;
    return isBetter(officialScalar(r), officialScalar(best), protocol.direction) ? r : best;
  }, null);
}

// Classify a fresh official result against the subject's prior PB. Ties are
// resolved at the configured display precision and are labelled a "matched"
// personal best rather than a new one (handoff 7.4).
export function classifyAgainstPersonalBest(protocol, priorOfficialResults, latest) {
  if (protocol.direction === 'track' || !isOfficial(latest)) return { status: 'none' };
  const prior = personalBest(protocol, priorOfficialResults);
  if (!prior) return { status: 'first' };
  const dp = displayDecimals(protocol);
  const a = roundTo(officialScalar(latest), dp);
  const b = roundTo(officialScalar(prior), dp);
  if (a === b) return { status: 'matched', priorBest: prior };
  return { status: isBetter(a, b, protocol.direction) ? 'new' : 'below', priorBest: prior };
}

// ── Team performance for an INDIVIDUAL benchmark (handoff 7.3) ────────────────
//
// results: [{ playerId, status, result }]
//   status: 'complete' | 'partial' | 'skipped' | 'unable' | 'not_measured'
//   result: an officialResult payload (only meaningful when status 'complete')
// expectedCount: size of the frozen expected-participant roster snapshot.
//
// Only complete, official, eligible player results feed the summary. Absence is
// context, never a zero. No valid results yields an explicit "no completed
// results" state, never an average of 0.
export function teamPerformanceIndividual(protocol, results, expectedCount) {
  const rows = results || [];
  const counts = { complete: 0, partial: 0, skipped: 0, unable: 0, not_measured: 0 };
  for (const r of rows) if (counts[r.status] != null) counts[r.status]++;

  const officials = rows.filter((r) => r.status === 'complete' && isOfficial(r.result)).map((r) => r.result);
  const base = {
    measuredCount: officials.length,
    expectedCount: Number.isFinite(expectedCount) ? expectedCount : rows.length,
    partialCount: counts.partial,
    skippedCount: counts.skipped,
    unableCount: counts.unable,
    notMeasuredCount: counts.not_measured,
  };
  if (!officials.length) return { ...base, noResults: true };

  if (protocol.metricType === 'success_rate') {
    const props = officials.map((r) => r.proportion);
    const pooledSuccesses = officials.reduce((s, r) => s + r.successes, 0);
    const pooledOpportunities = officials.reduce((s, r) => s + r.opportunities, 0);
    return {
      ...base,
      meanProportion: mean(props),         // average of each player's official proportion
      medianProportion: median(props),
      minProportion: Math.min(...props),
      maxProportion: Math.max(...props),
      pooledSuccesses,                     // shown separately, explicitly labelled
      pooledOpportunities,
      pooledProportion: pooledOpportunities ? pooledSuccesses / pooledOpportunities : null,
    };
  }

  if (protocol.metricType === 'score_rubric') {
    const orders = officials.map((r) => r.levelOrder);
    const byLevel = {};
    for (const r of officials) byLevel[r.levelId] = (byLevel[r.levelId] || 0) + 1;
    const s = [...orders].sort((a, b) => a - b);
    const m = s.length >> 1;
    let medianLevelOrders;
    if (s.length % 2) medianLevelOrders = [s[m]];
    else medianLevelOrders = s[m - 1] === s[m] ? [s[m]] : [s[m - 1], s[m]]; // two middle labels as a range, never a fabricated fractional label
    return { ...base, byLevel, medianLevelOrders };
  }

  const vals = officials.map((r) => r.value);
  return {
    ...base,
    mean: mean(vals),
    median: median(vals),
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

// ── Matched-player improvement (handoff 7.4) ────────────────────────────────
//
// prev / curr: objects keyed by playerId whose values are officialResult
// payloads. Same name or jersey does NOT establish identity; the caller keys
// strictly by player id. Only ids with a complete eligible official result in
// BOTH assessments are compared (set C).
export function matchedImprovement(protocol, prev, curr, dates) {
  const dir = protocol.direction;
  const cd = changeDecimals(protocol);
  const matchedIds = Object.keys(prev || {}).filter((id) => isOfficial(prev[id]) && isOfficial((curr || {})[id]));
  const out = {
    matchedCount: matchedIds.length,
    matchedIds,
    previousDate: dates && dates.previous || null,
    currentDate: dates && dates.current || null,
  };
  if (!matchedIds.length) return { ...out, status: 'no_overlap' };

  if (protocol.metricType === 'score_rubric') {
    let improved = 0, unchanged = 0, lower = 0;
    const transitions = {};
    for (const id of matchedIds) {
      const a = prev[id].levelOrder, b = curr[id].levelOrder;
      if (b > a) improved++; else if (b < a) lower++; else unchanged++;
      const key = prev[id].levelLabel + ' → ' + curr[id].levelLabel;
      transitions[key] = (transitions[key] || 0) + 1;
    }
    return { ...out, status: 'ok', kind: 'rubric', improved, unchanged, lower, transitions, note: overlapNote(matchedIds.length) };
  }

  let prevVals, currVals, unit;
  if (protocol.metricType === 'success_rate') {
    prevVals = matchedIds.map((id) => prev[id].proportion);
    currVals = matchedIds.map((id) => curr[id].proportion);
    unit = 'proportion';
  } else {
    prevVals = matchedIds.map((id) => prev[id].value);
    currVals = matchedIds.map((id) => curr[id].value);
    unit = 'value';
  }
  const previousMean = mean(prevVals);
  const currentMean = mean(currVals);

  // Signed improvement is always "how much better did the matched cohort get",
  // in raw units, positive == better.
  let signedImprovement = dir === 'lower' ? previousMean - currentMean : currentMean - previousMean;

  let pointChange = null;         // percentage-point change, success rate only
  let relativeImprovementPercent = null;
  if (protocol.metricType === 'success_rate') {
    pointChange = 100 * (currentMean - previousMean) * (dir === 'lower' ? -1 : 1);
    signedImprovement = pointChange; // the raw-unit change for a rate IS points
  } else if (isRatioMetric(protocol.metricType) && dir !== 'track' && previousMean > 0) {
    relativeImprovementPercent = 100 * signedImprovement / previousMean;
  }

  // Per-player classification, rounded to the configured change precision so a
  // displayed 0 cannot also count as improved. Unrounded data is kept for the
  // cohort means above.
  let improved = 0, unchanged = 0, worse = 0;
  for (let i = 0; i < matchedIds.length; i++) {
    const raw = unit === 'proportion'
      ? 100 * (currVals[i] - prevVals[i]) * (dir === 'lower' ? -1 : 1)
      : (dir === 'lower' ? prevVals[i] - currVals[i] : currVals[i] - prevVals[i]);
    const d = roundTo(raw, cd);
    if (d > 0) improved++; else if (d < 0) worse++; else unchanged++;
  }

  return {
    ...out,
    status: 'ok',
    kind: protocol.metricType === 'success_rate' ? 'success_rate' : (protocol.metricType === 'score_numeric' ? 'score' : 'ratio'),
    previousMean,
    currentMean,
    signedImprovement,
    pointChange,
    relativeImprovementPercent,
    verb: changeVerb(protocol.metricType, dir, signedImprovement),
    improved,
    unchanged,
    worse,
    note: overlapNote(matchedIds.length),
  };
}

function overlapNote(n) {
  if (n === 0) return 'no_comparable_players';
  if (n <= 2) return 'few_comparable_players';   // show the result, no "team-wide improvement" claim
  return null;
}

// ── Collective improvement (handoff 7.5) ────────────────────────────────────
//
// One official team result per assessment. Uses the same directional / unit
// formulas where meaningful, but is always labelled a team challenge result,
// never a matched-player average. Composition differences are surfaced, never
// silently normalised by player count.
export function collectiveImprovement(protocol, prev, curr, prevParticipantIds, currParticipantIds, dates) {
  const dir = protocol.direction;
  const out = {
    label: 'team_challenge',
    previousDate: dates && dates.previous || null,
    currentDate: dates && dates.current || null,
    previousCount: countOrNull(prevParticipantIds),
    currentCount: countOrNull(currParticipantIds),
  };
  if (!isOfficial(prev) || !isOfficial(curr)) return { ...out, status: 'incomplete' };

  const idsKnown = Array.isArray(prevParticipantIds) && Array.isArray(currParticipantIds);
  const sameComposition = idsKnown && setsEqual(prevParticipantIds, currParticipantIds);

  let signedImprovement, relativeImprovementPercent = null, pointChange = null;
  if (protocol.metricType === 'success_rate') {
    pointChange = 100 * (curr.proportion - prev.proportion) * (dir === 'lower' ? -1 : 1);
    signedImprovement = pointChange;
  } else if (protocol.metricType === 'score_rubric') {
    signedImprovement = curr.levelOrder - prev.levelOrder;
  } else {
    signedImprovement = dir === 'lower' ? prev.value - curr.value : curr.value - prev.value;
    if (isRatioMetric(protocol.metricType) && dir !== 'track' && prev.value > 0) {
      relativeImprovementPercent = 100 * signedImprovement / prev.value;
    }
  }

  return {
    ...out,
    status: 'ok',
    previousValue: officialScalar(prev),
    currentValue: officialScalar(curr),
    signedImprovement,
    relativeImprovementPercent,
    pointChange,
    verb: changeVerb(protocol.metricType, dir, signedImprovement),
    participantsKnown: idsKnown,
    sameComposition,
    compositionWarning: !idsKnown || !sameComposition,
  };
}

const countOrNull = (ids) => (Array.isArray(ids) ? ids.length : null);
function setsEqual(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// ── Targets (handoff 7.7) ──────────────────────────────────────────────────
//
// target: { value }            numeric metrics (points for score_numeric)
//         { proportion }       success_rate (a proportion, shown as percent)
//         { levelOrder }       score_rubric (at-or-above the configured level)
export function meetsTarget(protocol, target, result) {
  if (!target || !isOfficial(result)) return false;
  if (protocol.metricType === 'success_rate') {
    return protocol.direction === 'lower' ? result.proportion <= target.proportion : result.proportion >= target.proportion;
  }
  if (protocol.metricType === 'score_rubric') {
    return protocol.direction === 'lower' ? result.levelOrder <= target.levelOrder : result.levelOrder >= target.levelOrder;
  }
  return protocol.direction === 'lower' ? result.value <= target.value : result.value >= target.value;
}

// Team attainment for an individual benchmark: a whole-number percentage of
// MEASURED players meeting the threshold. Expected coverage is reported
// separately so "8/10 measured" is never mistaken for "8 of the whole roster".
export function targetAttainment(protocol, target, results, expectedCount) {
  const rows = results || [];
  const officials = rows.filter((r) => r.status === 'complete' && isOfficial(r.result));
  const meeting = officials.filter((r) => meetsTarget(protocol, target, r.result)).length;
  const measured = officials.length;
  return {
    meetingCount: meeting,
    measuredCount: measured,
    expectedCount: Number.isFinite(expectedCount) ? expectedCount : rows.length,
    attainmentPercent: measured ? Math.round((100 * meeting) / measured) : null,
  };
}

// ── Comparability & eligibility (handoff 7.1) ───────────────────────────────

// Two assessments are comparable only when they share the same benchmark
// identity and a compatible protocol version, and neither is flagged
// "different test conditions: exclude from comparisons". In this release,
// version equality is the compatibility rule (a canonical display-unit change
// within the same version is still the same version, so it stays comparable).
export function comparableAssessments(a, b) {
  if (!a || !b) return false;
  if (a.benchmarkId !== b.benchmarkId) return false;
  if (a.protocolVersionId !== b.protocolVersionId) return false;
  if (a.excludedFromComparisons || b.excludedFromComparisons) return false;
  return true;
}

// An assessment feeds official history / PBs / comparisons / targets only when
// it is finalized and not archived. "Under correction" (a reopened finalized
// assessment) is temporarily out until refinalized.
export function isEligibleAssessment(a) {
  return !!a && a.state === 'finalized' && !a.archived;
}

export function eligibleAssessments(list) {
  return (list || []).filter(isEligibleAssessment);
}

// ── Late-arrival reconciliation ─────────────────────────────────────────────
//
// An individual assessment's participant roster is seeded once, from
// whoever was present at the moment recording started (handoff 5.2); a
// player who checks in afterward never widens that snapshot on their own.
// `add_benchmark_participant` exists server-side for exactly this, but a
// coach can only reach for it if the UI tells them who is present now but
// missing from the roster. Pure set difference, kept here (not in a
// component) so both the live panel and any future surface can reuse it
// without re-deriving the exclusion rule.
export function missingBenchmarkParticipants(presentPlayerIds, participants) {
  const known = new Set((participants || []).filter((p) => !p.is_team_subject && p.player_id).map((p) => p.player_id));
  return (presentPlayerIds || []).filter((id) => id && !known.has(id));
}

// ── Baseline / previous selection (handoff 7.6) ─────────────────────────────

// The immediately preceding eligible assessment of the same version, strictly
// before `reference` by measured local date/time. Missing players are excluded
// downstream, never backfilled from an older occasion.
export function previousEligibleAssessment(assessments, reference) {
  const refT = toTime(reference.measuredAt);
  return eligibleAssessments(assessments)
    .filter((a) => a.protocolVersionId === reference.protocolVersionId && a.id !== reference.id && toTime(a.measuredAt) < refT)
    .sort((x, y) => toTime(y.measuredAt) - toTime(x.measuredAt))[0] || null;
}

// The season baseline: earliest eligible assessment whose measured local date
// falls within the team's current configured season; if season dates are
// missing, the earliest eligible assessment for that team/version. An explicit
// manager selection (baselineAssessmentId) always wins, unless it is no longer
// eligible, in which case the caller must show "baseline unavailable" rather
// than silently substituting.
export function seasonBaselineAssessment(assessments, { protocolVersionId, seasonStart, seasonEnd, baselineAssessmentId }) {
  const pool = eligibleAssessments(assessments).filter((a) => a.protocolVersionId === protocolVersionId);
  if (baselineAssessmentId) {
    const chosen = pool.find((a) => a.id === baselineAssessmentId);
    return chosen ? { assessment: chosen, explicit: true } : { assessment: null, explicit: true, unavailable: true };
  }
  const inSeason = (seasonStart && seasonEnd)
    ? pool.filter((a) => a.measuredLocalDate >= seasonStart && a.measuredLocalDate <= seasonEnd)
    : pool;
  const ordered = (inSeason.length ? inSeason : pool).slice().sort((x, y) => toTime(x.measuredAt) - toTime(y.measuredAt));
  return { assessment: ordered[0] || null, explicit: false };
}

function toTime(v) {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

// ── Display-unit conversions ───────────────────────────────────────────────
//
// Entry and display only. The canonical stored value never changes, so two
// assessments entered in different display units under the same protocol
// version remain directly comparable.
export const FEET_PER_METRE = 3.28083989501312335958;
export function feetInchesToMetres(feet, inches = 0) {
  return (Number(feet || 0) * 12 + Number(inches || 0)) * 0.0254;
}
export function metresToFeetInches(metres) {
  const totalInches = Number(metres || 0) / 0.0254;
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: totalInches - feet * 12 };
}
export function mphToMetresPerSecond(mph) { return Number(mph || 0) * 0.44704; }
export function kmhToMetresPerSecond(kmh) { return Number(kmh || 0) / 3.6; }
export function minutesSecondsToSeconds(min, sec = 0) { return Number(min || 0) * 60 + Number(sec || 0); }

// Raw text a coach typed (in the protocol's display unit) -> the canonical
// number we store. The single implementation shared by the live recorder and
// the target editor, so entry is converted the same way everywhere.
export function parseDisplayValue(protocol, raw) {
  if (raw == null || raw === '') return null;
  const u = (protocol && protocol.displayUnit) || '';
  const t = protocol && protocol.metricType;
  if (t === 'time') {
    if (/:/.test(String(raw))) { const [m, s] = String(raw).split(':'); return minutesSecondsToSeconds(Number(m) || 0, Number(s) || 0); }
    return Number(raw);
  }
  if (t === 'distance') {
    if (u === 'feet/inches') { const [ft, inch] = String(raw).replace(/['"]/g, ' ').trim().split(/\s+/); return feetInchesToMetres(Number(ft) || 0, Number(inch) || 0); }
    if (u === 'centimeters') return Number(raw) / 100;
    return Number(raw);
  }
  if (t === 'speed') return u === 'km/h' ? kmhToMetresPerSecond(Number(raw)) : mphToMetresPerSecond(Number(raw));
  return Number(raw);
}

// Canonical stored number -> the number shown in the protocol's display unit
// (still a Number, for compound formats it is the primary quantity). Inverse of
// parseDisplayValue; display only, never fed back into any calculation.
export function displayMagnitude(protocol, v) {
  if (!Number.isFinite(v)) return v;
  const u = (protocol && protocol.displayUnit) || '';
  const t = protocol && protocol.metricType;
  if (t === 'distance' && u === 'centimeters') return v * 100;
  if (t === 'speed') return u === 'km/h' ? v * 3.6 : v / 0.44704;
  return v;
}

// Whether formatMeasurement's string already carries its own unit (mm:ss, ft/in)
// so callers should not append the display-unit label a second time.
export function unitIsInline(protocol) {
  const u = (protocol && protocol.displayUnit) || '';
  return u === 'minutes:seconds' || u === 'feet/inches';
}

// Canonical stored number -> a display string in the protocol's display unit,
// including the unit label. The single implementation shared by the live
// recorder and every reporting surface. Never used for further math.
export function formatMeasurement(protocol, v) {
  if (!Number.isFinite(v)) return '';
  const u = (protocol && protocol.displayUnit) || '';
  const dp = displayDecimals(protocol);
  const t = protocol && protocol.metricType;
  if (t === 'time' && u === 'minutes:seconds') {
    const neg = v < 0; const a = Math.abs(v);
    const m = Math.floor(a / 60); const s = roundTo(a - m * 60, dp);
    return (neg ? '-' : '') + m + ':' + String(s).padStart(2, '0');
  }
  if (t === 'distance' && u === 'feet/inches') {
    const neg = v < 0; const { feet, inches } = metresToFeetInches(Math.abs(v));
    return (neg ? '-' : '') + feet + "' " + roundTo(inches, 1) + '"';
  }
  const n = roundTo(displayMagnitude(protocol, v), dp);
  return n + (u ? ' ' + u : '');
}
