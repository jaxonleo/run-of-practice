import { describe, it, expect } from 'vitest'
import {
  officialResult,
  isOfficial,
  personalBest,
  classifyAgainstPersonalBest,
  teamPerformanceIndividual,
  matchedImprovement,
  collectiveImprovement,
  meetsTarget,
  targetAttainment,
  comparableAssessments,
  isEligibleAssessment,
  eligibleAssessments,
  previousEligibleAssessment,
  seasonBaselineAssessment,
  roundTo,
  feetInchesToMetres,
  metresToFeetInches,
  displayDecimals,
  changeDecimals,
} from './benchmarks.js'

// Small helpers so each fixture reads close to the handoff's own table.
const attempt = (slot, value, valid = true) => ({ slot, value, valid })
const setAttempt = (slot, successes, opportunities, valid = true) => ({ slot, successes, opportunities, valid })
const complete = (playerId, result) => ({ playerId, status: 'complete', result })

const TIME_BEST2 = { subjectMode: 'individual', metricType: 'time', direction: 'lower', resultRule: 'best', scoredAttempts: 2 }
const COUNT_SINGLE_HIGHER = { subjectMode: 'individual', metricType: 'count', direction: 'higher', resultRule: 'single', scoredAttempts: 1 }
const COUNT_TOTAL = { subjectMode: 'individual', metricType: 'count', direction: 'higher', resultRule: 'total', scoredAttempts: 3 }
const COUNT_AVG2 = { subjectMode: 'individual', metricType: 'count', direction: 'higher', resultRule: 'average', scoredAttempts: 2 }
const ACCURACY = { subjectMode: 'individual', metricType: 'success_rate', direction: 'higher', resultRule: 'pooled', scoredAttempts: 1, opportunitiesPerSet: 10 }
const SPRINT_V1 = { subjectMode: 'individual', metricType: 'time', direction: 'lower', resultRule: 'best', scoredAttempts: 1, benchmarkId: 'sprint', protocolVersionId: 'sprint-v1' }
const ENDURANCE = { subjectMode: 'individual', metricType: 'time', direction: 'higher', resultRule: 'single', scoredAttempts: 1 }
const SCORE_1_5 = { subjectMode: 'individual', metricType: 'score_numeric', direction: 'higher', resultRule: 'single', scoredAttempts: 1, scoreMin: 1, scoreMax: 5, scoreIncrement: 1 }
const RUBRIC = {
  subjectMode: 'individual', metricType: 'score_rubric', direction: 'higher', resultRule: 'single', scoredAttempts: 1,
  rubricLevels: [
    { id: 'dev', order: 1, label: 'Developing' },
    { id: 'con', order: 2, label: 'Consistent' },
    { id: 'ind', order: 3, label: 'Independent' },
  ],
}
const DISTANCE_M = { subjectMode: 'individual', metricType: 'distance', direction: 'higher', resultRule: 'best', scoredAttempts: 1 }
const PASSES_TEAM = { subjectMode: 'team', metricType: 'count', direction: 'higher', resultRule: 'single', scoredAttempts: 1 }

// ─────────────────────────────────────────────────────────────────────────────
// Section 7.8 golden fixtures. Each expected value is derived by hand in the
// comment, not read back from the implementation.
// ─────────────────────────────────────────────────────────────────────────────

describe('golden fixture: official result reduction', () => {
  it('Lower best of 2: 4.82, 4.71 -> official 4.71', () => {
    const r = officialResult(TIME_BEST2, [attempt(0, 4.82), attempt(1, 4.71)])
    expect(r.status).toBe('official')
    expect(r.value).toBe(4.71)
  })

  it('Incomplete best of 2: 4.71 and blank -> partial, no official result / no PB', () => {
    const r = officialResult(TIME_BEST2, [attempt(0, 4.71)])
    expect(r.status).toBe('partial')
    expect(r.filledSlots).toBe(1)
    expect(r.requiredSlots).toBe(2)
    expect(personalBest(TIME_BEST2, [r])).toBe(null)
  })

  it('Total: 3 valid sets of counts 4,5,6 -> official 15', () => {
    const r = officialResult(COUNT_TOTAL, [attempt(0, 4), attempt(1, 5), attempt(2, 6)])
    expect(r.status).toBe('official')
    expect(r.value).toBe(15)
  })

  it('Averaged count: 2 attempts 4 and 5 -> official 4.5 (raw attempts stay integers)', () => {
    const r = officialResult(COUNT_AVG2, [attempt(0, 4), attempt(1, 5)])
    expect(r.status).toBe('official')
    expect(r.value).toBe(4.5)
  })

  it('Numeric score 2 -> 3 on a 1-5 scale: +1 point, no relative percentage', () => {
    const prev = officialResult(SCORE_1_5, [attempt(0, 2)])
    const curr = officialResult(SCORE_1_5, [attempt(0, 3)])
    const m = matchedImprovement(SCORE_1_5, { a: prev }, { a: curr })
    expect(m.signedImprovement).toBe(1)
    expect(m.relativeImprovementPercent).toBe(null)
  })

  it('Rubric: Developing -> Consistent is one player up, no percentage skill gain', () => {
    const prev = officialResult(RUBRIC, [{ slot: 0, levelId: 'dev', valid: true }])
    const curr = officialResult(RUBRIC, [{ slot: 0, levelId: 'con', valid: true }])
    expect(prev.levelOrder).toBe(1)
    expect(curr.levelOrder).toBe(2)
    const m = matchedImprovement(RUBRIC, { a: prev }, { a: curr })
    expect(m.kind).toBe('rubric')
    expect(m.improved).toBe(1)
    expect(m.unchanged).toBe(0)
    expect(m.lower).toBe(0)
    expect(m.transitions['Developing → Consistent']).toBe(1)
    expect(m.relativeImprovementPercent).toBeUndefined()
  })

  it('Unit conversion: 10 ft == 3.048 m, no change within the same canonical protocol', () => {
    const canonicalFromFeet = feetInchesToMetres(10, 0)
    expect(roundTo(canonicalFromFeet, 3)).toBe(3.048)
    const a = officialResult(DISTANCE_M, [attempt(0, canonicalFromFeet)])
    const b = officialResult(DISTANCE_M, [attempt(0, 3.048)])
    const m = matchedImprovement(DISTANCE_M, { p: a }, { p: b })
    expect(roundTo(m.signedImprovement, 3)).toBe(0)
    expect(m.improved).toBe(0)
    expect(m.worse).toBe(0)
    expect(m.unchanged).toBe(1)
    // round trip back to display units
    expect(metresToFeetInches(3.048).feet).toBe(10)
    expect(roundTo(metresToFeetInches(3.048).inches, 6)).toBe(0)
  })
})

describe('golden fixture: team performance for an individual benchmark (7.3)', () => {
  it('Missing versus zero: A=0, B blank, C skipped -> measured N=1, average 0', () => {
    const rows = [
      complete('A', officialResult(COUNT_SINGLE_HIGHER, [attempt(0, 0)])),
      { playerId: 'B', status: 'not_measured', result: officialResult(COUNT_SINGLE_HIGHER, []) },
      { playerId: 'C', status: 'skipped', result: null },
    ]
    const t = teamPerformanceIndividual(COUNT_SINGLE_HIGHER, rows, 3)
    expect(t.measuredCount).toBe(1)
    expect(t.mean).toBe(0)
    expect(t.noResults).toBeUndefined()
  })

  it('No completed results shows an explicit no-results state, never average 0', () => {
    const rows = [
      { playerId: 'A', status: 'skipped', result: null },
      { playerId: 'B', status: 'unable', result: null },
    ]
    const t = teamPerformanceIndividual(COUNT_SINGLE_HIGHER, rows, 5)
    expect(t.noResults).toBe(true)
    expect(t.mean).toBeUndefined()
    expect(t.expectedCount).toBe(5)
  })

  it('Matched sprint: current all-player average is 4.6667 across A,B,D', () => {
    // current: A=4.5, B=5.5, D=4.0  ->  mean = 14.0 / 3 = 4.66666...
    const rows = [
      complete('A', officialResult(SPRINT_V1, [attempt(0, 4.5)])),
      complete('B', officialResult(SPRINT_V1, [attempt(0, 5.5)])),
      complete('D', officialResult(SPRINT_V1, [attempt(0, 4.0)])),
    ]
    const t = teamPerformanceIndividual(SPRINT_V1, rows, 4)
    expect(roundTo(t.mean, 4)).toBe(4.6667)
  })
})

describe('golden fixture: matched-player improvement (7.4)', () => {
  it('Matched sprint: N=2, 5.5 -> 5.0, 0.5 sec faster, 9.0909% improvement, 2 improved', () => {
    // previous: A=5.0 B=6.0 C=7.0 ; current: A=4.5 B=5.5 D=4.0
    // matched set C = {A, B}
    // previous_mean = mean(5.0, 6.0) = 5.5 ; current_mean = mean(4.5, 5.5) = 5.0
    // direction Lower -> signed = 5.5 - 5.0 = 0.5
    // relative = 100 * 0.5 / 5.5 = 9.090909...
    const prev = {
      A: officialResult(SPRINT_V1, [attempt(0, 5.0)]),
      B: officialResult(SPRINT_V1, [attempt(0, 6.0)]),
      C: officialResult(SPRINT_V1, [attempt(0, 7.0)]),
    }
    const curr = {
      A: officialResult(SPRINT_V1, [attempt(0, 4.5)]),
      B: officialResult(SPRINT_V1, [attempt(0, 5.5)]),
      D: officialResult(SPRINT_V1, [attempt(0, 4.0)]),
    }
    const m = matchedImprovement(SPRINT_V1, prev, curr)
    expect(m.matchedCount).toBe(2)
    expect(roundTo(m.previousMean, 4)).toBe(5.5)
    expect(roundTo(m.currentMean, 4)).toBe(5.0)
    expect(roundTo(m.signedImprovement, 4)).toBe(0.5)
    expect(roundTo(m.relativeImprovementPercent, 4)).toBe(9.0909)
    expect(m.verb).toBe('faster')
    expect(m.improved).toBe(2)
    expect(m.worse).toBe(0)
    expect(m.note).toBe('few_comparable_players') // exactly 2 matched
  })

  it('Zero baseline: Higher count 0 -> 5 gives +5 and no relative percentage', () => {
    const prev = { A: officialResult(COUNT_SINGLE_HIGHER, [attempt(0, 0)]) }
    const curr = { A: officialResult(COUNT_SINGLE_HIGHER, [attempt(0, 5)]) }
    const m = matchedImprovement(COUNT_SINGLE_HIGHER, prev, curr)
    expect(m.signedImprovement).toBe(5)
    expect(m.relativeImprovementPercent).toBe(null)
  })

  it('Accuracy: A 4/10 -> 6/10, B 6/10 -> 7/10 gives mean 50% -> 65%, +15 pts, 2 improved', () => {
    const prev = {
      A: officialResult(ACCURACY, [setAttempt(0, 4, 10)]),
      B: officialResult(ACCURACY, [setAttempt(0, 6, 10)]),
    }
    const curr = {
      A: officialResult(ACCURACY, [setAttempt(0, 6, 10)]),
      B: officialResult(ACCURACY, [setAttempt(0, 7, 10)]),
    }
    // matched mean proportions: prev mean(0.4,0.6)=0.5 ; curr mean(0.6,0.7)=0.65
    const m = matchedImprovement(ACCURACY, prev, curr)
    expect(roundTo(m.previousMean, 4)).toBe(0.5)
    expect(roundTo(m.currentMean, 4)).toBe(0.65)
    expect(roundTo(m.pointChange, 4)).toBe(15)
    expect(roundTo(m.signedImprovement, 4)).toBe(15)
    expect(m.improved).toBe(2)
  })

  it('Endurance: Higher time 30 -> 36 sec gives 6 sec longer, +20%', () => {
    const prev = { A: officialResult(ENDURANCE, [attempt(0, 30)]) }
    const curr = { A: officialResult(ENDURANCE, [attempt(0, 36)]) }
    const m = matchedImprovement(ENDURANCE, prev, curr)
    expect(m.signedImprovement).toBe(6)
    expect(roundTo(m.relativeImprovementPercent, 4)).toBe(20)
    expect(m.verb).toBe('longer')
  })

  it('No overlap: previous only A, current only B -> no comparable players', () => {
    const prev = { A: officialResult(SPRINT_V1, [attempt(0, 5)]) }
    const curr = { B: officialResult(SPRINT_V1, [attempt(0, 5)]) }
    const m = matchedImprovement(SPRINT_V1, prev, curr)
    expect(m.matchedCount).toBe(0)
    expect(m.status).toBe('no_overlap')
  })
})

describe('golden fixture: targets (7.7)', () => {
  it('Current target: A=7 B=8 C=9, higher target 8 -> 2 of 3 measured meet target', () => {
    const p = { subjectMode: 'individual', metricType: 'count', direction: 'higher', resultRule: 'single', scoredAttempts: 1 }
    const rows = [
      complete('A', officialResult(p, [attempt(0, 7)])),
      complete('B', officialResult(p, [attempt(0, 8)])),
      complete('C', officialResult(p, [attempt(0, 9)])),
    ]
    const a = targetAttainment(p, { value: 8 }, rows, 3)
    expect(a.meetingCount).toBe(2)
    expect(a.measuredCount).toBe(3)
    expect(a.attainmentPercent).toBe(67)
  })

  it('Lower direction target uses <=', () => {
    expect(meetsTarget(TIME_BEST2, { value: 5 }, { status: 'official', metricType: 'time', value: 4.9 })).toBe(true)
    expect(meetsTarget(TIME_BEST2, { value: 5 }, { status: 'official', metricType: 'time', value: 5.1 })).toBe(false)
  })

  it('Rubric target is at-or-above the configured level order', () => {
    expect(meetsTarget(RUBRIC, { levelOrder: 2 }, { status: 'official', metricType: 'score_rubric', levelOrder: 2 })).toBe(true)
    expect(meetsTarget(RUBRIC, { levelOrder: 2 }, { status: 'official', metricType: 'score_rubric', levelOrder: 1 })).toBe(false)
  })
})

describe('golden fixture: collective improvement (7.5)', () => {
  it('20 -> 25 consecutive passes with different participant IDs: +5, composition warning, no matched-player claim', () => {
    const prev = officialResult(PASSES_TEAM, [attempt(0, 20)])
    const curr = officialResult(PASSES_TEAM, [attempt(0, 25)])
    const c = collectiveImprovement(PASSES_TEAM, prev, curr, ['p1', 'p2', 'p3'], ['p2', 'p3', 'p4'])
    expect(c.label).toBe('team_challenge')
    expect(c.signedImprovement).toBe(5)
    expect(c.sameComposition).toBe(false)
    expect(c.compositionWarning).toBe(true)
    expect(c.previousCount).toBe(3)
    expect(c.currentCount).toBe(3)
  })

  it('identical participant IDs report matching composition', () => {
    const prev = officialResult(PASSES_TEAM, [attempt(0, 20)])
    const curr = officialResult(PASSES_TEAM, [attempt(0, 25)])
    const c = collectiveImprovement(PASSES_TEAM, prev, curr, ['p1', 'p2'], ['p2', 'p1'])
    expect(c.sameComposition).toBe(true)
    expect(c.compositionWarning).toBe(false)
  })

  it('participants not recorded: comparison still shows the delta but warns composition is unknown', () => {
    const prev = officialResult(PASSES_TEAM, [attempt(0, 20)])
    const curr = officialResult(PASSES_TEAM, [attempt(0, 25)])
    const c = collectiveImprovement(PASSES_TEAM, prev, curr, null, null)
    expect(c.signedImprovement).toBe(5)
    expect(c.participantsKnown).toBe(false)
    expect(c.compositionWarning).toBe(true)
  })
})

describe('golden fixture: version mismatch (7.1)', () => {
  it('same benchmark, sprint distance changed -> separate histories, comparison blocked', () => {
    const a = { benchmarkId: 'sprint', protocolVersionId: 'sprint-v1', state: 'finalized', archived: false }
    const b = { benchmarkId: 'sprint', protocolVersionId: 'sprint-v2', state: 'finalized', archived: false }
    expect(comparableAssessments(a, b)).toBe(false)
  })

  it('a canonical display-unit change within the same version stays comparable', () => {
    const a = { benchmarkId: 'jump', protocolVersionId: 'jump-v1', state: 'finalized', archived: false }
    const b = { benchmarkId: 'jump', protocolVersionId: 'jump-v1', state: 'finalized', archived: false }
    expect(comparableAssessments(a, b)).toBe(true)
  })

  it('an assessment flagged "exclude from comparisons" is never combined', () => {
    const a = { benchmarkId: 'x', protocolVersionId: 'x-v1', state: 'finalized', archived: false }
    const b = { benchmarkId: 'x', protocolVersionId: 'x-v1', state: 'finalized', archived: false, excludedFromComparisons: true }
    expect(comparableAssessments(a, b)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Additional cases the handoff names explicitly at the end of section 7.8:
// zero improvement, negative change, precision ties, all-invalid attempts,
// successes > opportunities, fractional opportunities, historical date
// ordering, archive / correction recalculation.
// ─────────────────────────────────────────────────────────────────────────────

describe('additional required cases', () => {
  it('zero improvement: identical means classify every player unchanged and tie the PB', () => {
    const prev = { A: officialResult(SPRINT_V1, [attempt(0, 5)]), B: officialResult(SPRINT_V1, [attempt(0, 6)]) }
    const curr = { A: officialResult(SPRINT_V1, [attempt(0, 5)]), B: officialResult(SPRINT_V1, [attempt(0, 6)]) }
    const m = matchedImprovement(SPRINT_V1, prev, curr)
    expect(m.signedImprovement).toBe(0)
    expect(m.improved).toBe(0)
    expect(m.worse).toBe(0)
    expect(m.unchanged).toBe(2)
    const pb = classifyAgainstPersonalBest(SPRINT_V1, [curr.A], officialResult(SPRINT_V1, [attempt(0, 5)]))
    expect(pb.status).toBe('matched')
  })

  it('negative change: a slower matched cohort reports worse, not a phantom improvement', () => {
    const prev = { A: officialResult(SPRINT_V1, [attempt(0, 5)]) }
    const curr = { A: officialResult(SPRINT_V1, [attempt(0, 6)]) }
    const m = matchedImprovement(SPRINT_V1, prev, curr)
    expect(m.signedImprovement).toBeLessThan(0)
    expect(m.worse).toBe(1)
    expect(m.improved).toBe(0)
    expect(m.verb).toBe('slower')
  })

  it('precision tie: a change below the displayed precision rounds to 0 and is not "improved"', () => {
    // time shows 2 dp; a 0.004 sec cohort gain rounds to 0.00
    const prev = { A: officialResult(SPRINT_V1, [attempt(0, 5.000)]) }
    const curr = { A: officialResult(SPRINT_V1, [attempt(0, 4.996)]) }
    const m = matchedImprovement(SPRINT_V1, prev, curr)
    expect(m.improved).toBe(0)
    expect(m.unchanged).toBe(1)
  })

  it('all-invalid attempts: no official result and no PB', () => {
    const r = officialResult(TIME_BEST2, [attempt(0, 4.8, false), attempt(1, 4.7, false)])
    expect(r.status).toBe('none')
    expect(isOfficial(r)).toBe(false)
    expect(personalBest(TIME_BEST2, [r])).toBe(null)
  })

  it('successes greater than opportunities is rejected, not scored', () => {
    const r = officialResult(ACCURACY, [setAttempt(0, 12, 10)])
    expect(r.status).toBe('invalid')
    expect(r.reason).toBe('successes_out_of_range')
  })

  it('a fractional opportunity count is rejected', () => {
    const r = officialResult(ACCURACY, [{ slot: 0, successes: 3, opportunities: 9.5, valid: true }])
    expect(r.status).toBe('invalid')
    expect(r.reason).toBe('non_integer_success_rate')
  })

  it('an opportunity count that does not match the protocol set size is rejected', () => {
    const r = officialResult(ACCURACY, [setAttempt(0, 3, 8)])
    expect(r.status).toBe('invalid')
    expect(r.reason).toBe('opportunity_count_mismatch')
  })

  it('a negative measurement is rejected except where a numeric score explicitly allows it', () => {
    expect(officialResult(COUNT_SINGLE_HIGHER, [attempt(0, -1)]).status).toBe('invalid')
    const signedScore = { ...SCORE_1_5, scoreMin: -3, scoreMax: 3 }
    expect(officialResult(signedScore, [attempt(0, -2)]).status).toBe('official')
  })

  it('NaN and Infinity are rejected', () => {
    expect(officialResult(COUNT_SINGLE_HIGHER, [attempt(0, NaN)]).status).toBe('invalid')
    expect(officialResult(COUNT_SINGLE_HIGHER, [attempt(0, Infinity)]).status).toBe('invalid')
  })

  it('historical date ordering: previous assessment ignores archived / unfinalized / later occasions', () => {
    const list = [
      { id: 'a1', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-03-01T10:00:00Z' },
      { id: 'a2', protocolVersionId: 'v1', state: 'finalized', archived: true, measuredAt: '2026-04-01T10:00:00Z' },
      { id: 'a3', protocolVersionId: 'v1', state: 'recording', archived: false, measuredAt: '2026-04-15T10:00:00Z' },
      { id: 'a4', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-04-20T10:00:00Z' },
      { id: 'a5', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-05-01T10:00:00Z' },
    ]
    const ref = list[4] // a5
    const prev = previousEligibleAssessment(list, ref)
    expect(prev.id).toBe('a4')
  })

  it('season baseline: earliest eligible in season, and an archived explicit choice reports unavailable', () => {
    const list = [
      { id: 'b1', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-01-10T00:00:00Z', measuredLocalDate: '2026-01-10' },
      { id: 'b2', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-02-10T00:00:00Z', measuredLocalDate: '2026-02-10' },
      { id: 'b3', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-03-10T00:00:00Z', measuredLocalDate: '2026-03-10' },
    ]
    const auto = seasonBaselineAssessment(list, { protocolVersionId: 'v1', seasonStart: '2026-02-01', seasonEnd: '2026-06-30' })
    expect(auto.assessment.id).toBe('b2')
    expect(auto.explicit).toBe(false)

    const gone = seasonBaselineAssessment(list, { protocolVersionId: 'v1', baselineAssessmentId: 'archived-x' })
    expect(gone.unavailable).toBe(true)
    expect(gone.assessment).toBe(null)
  })

  it('archive / correction recalculation: excluding an assessment changes the eligible pool and the previous pick', () => {
    const list = [
      { id: 'c1', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-03-01T10:00:00Z' },
      { id: 'c2', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-04-01T10:00:00Z' },
      { id: 'c3', protocolVersionId: 'v1', state: 'finalized', archived: false, measuredAt: '2026-05-01T10:00:00Z' },
    ]
    expect(previousEligibleAssessment(list, list[2]).id).toBe('c2')
    // manager reopens c2 for correction -> it is "under correction", temporarily ineligible
    list[1].state = 'recording'
    expect(previousEligibleAssessment(list, list[2]).id).toBe('c1')
    // refinalized -> back in
    list[1].state = 'finalized'
    expect(previousEligibleAssessment(list, list[2]).id).toBe('c2')
    expect(eligibleAssessments(list).length).toBe(3)
  })
})

describe('personal best and PB classification', () => {
  it('PB for a Lower protocol is the minimum official result, never a single sub-attempt of an averaged rule', () => {
    const p = { subjectMode: 'individual', metricType: 'time', direction: 'lower', resultRule: 'average', scoredAttempts: 2 }
    const r1 = officialResult(p, [attempt(0, 5.0), attempt(1, 6.0)]) // official 5.5
    const r2 = officialResult(p, [attempt(0, 4.9), attempt(1, 5.3)]) // official 5.1
    const pb = personalBest(p, [r1, r2])
    expect(pb.value).toBe(5.1) // not 4.9, the best single attempt
  })

  it('first ever official result is classified "first" with no invented delta', () => {
    const first = officialResult(COUNT_SINGLE_HIGHER, [attempt(0, 8)])
    expect(classifyAgainstPersonalBest(COUNT_SINGLE_HIGHER, [], first).status).toBe('first')
  })

  it('a genuinely better result is a new personal best', () => {
    const prior = [officialResult(COUNT_SINGLE_HIGHER, [attempt(0, 8)])]
    const latest = officialResult(COUNT_SINGLE_HIGHER, [attempt(0, 10)])
    expect(classifyAgainstPersonalBest(COUNT_SINGLE_HIGHER, prior, latest).status).toBe('new')
  })

  it('Track only protocols have no PB and no target/improvement judgement', () => {
    const track = { subjectMode: 'individual', metricType: 'count', direction: 'track', resultRule: 'single', scoredAttempts: 1 }
    expect(personalBest(track, [officialResult(track, [attempt(0, 5)])])).toBe(null)
    const m = matchedImprovement(track, { A: officialResult(track, [attempt(0, 5)]) }, { A: officialResult(track, [attempt(0, 9)]) })
    expect(m.relativeImprovementPercent).toBe(null)
  })
})

describe('team performance: rubric and success rate detail', () => {
  it('rubric team summary reports counts by level and a median level', () => {
    const rows = [
      complete('A', officialResult(RUBRIC, [{ slot: 0, levelId: 'dev', valid: true }])),
      complete('B', officialResult(RUBRIC, [{ slot: 0, levelId: 'con', valid: true }])),
      complete('C', officialResult(RUBRIC, [{ slot: 0, levelId: 'con', valid: true }])),
    ]
    const t = teamPerformanceIndividual(RUBRIC, rows, 3)
    expect(t.byLevel).toEqual({ dev: 1, con: 2 })
    expect(t.medianLevelOrders).toEqual([2])
  })

  it('rubric team summary shows two middle labels as a range for an even split', () => {
    const rows = [
      complete('A', officialResult(RUBRIC, [{ slot: 0, levelId: 'dev', valid: true }])),
      complete('B', officialResult(RUBRIC, [{ slot: 0, levelId: 'ind', valid: true }])),
    ]
    const t = teamPerformanceIndividual(RUBRIC, rows, 2)
    expect(t.medianLevelOrders).toEqual([1, 3])
  })

  it('success-rate team summary keeps pooled integers alongside the mean proportion', () => {
    const rows = [
      complete('A', officialResult(ACCURACY, [setAttempt(0, 4, 10)])),
      complete('B', officialResult(ACCURACY, [setAttempt(0, 6, 10)])),
    ]
    const t = teamPerformanceIndividual(ACCURACY, rows, 2)
    expect(roundTo(t.meanProportion, 4)).toBe(0.5)
    expect(t.pooledSuccesses).toBe(10)
    expect(t.pooledOpportunities).toBe(20)
    expect(roundTo(t.pooledProportion, 4)).toBe(0.5)
  })
})

describe('precision helpers', () => {
  it('displayDecimals follows the metric type and the score increment', () => {
    expect(displayDecimals({ metricType: 'time' })).toBe(2)
    expect(displayDecimals({ metricType: 'count' })).toBe(0)
    expect(displayDecimals({ metricType: 'distance' })).toBe(1)
    expect(displayDecimals({ metricType: 'score_numeric', scoreIncrement: 0.5 })).toBe(1)
    expect(displayDecimals({ metricType: 'score_numeric', scoreIncrement: 0.25 })).toBe(2)
  })

  it('changeDecimals is finer for an averaged count than a plain count', () => {
    expect(changeDecimals({ metricType: 'count', resultRule: 'total' })).toBe(0)
    expect(changeDecimals({ metricType: 'count', resultRule: 'average' })).toBe(2)
    expect(changeDecimals({ metricType: 'success_rate' })).toBe(1)
  })

  it('roundTo rounds half away from zero and normalises -0', () => {
    expect(roundTo(4.715, 2)).toBe(4.72)
    expect(roundTo(-0.0001, 2)).toBe(0)
  })
})
