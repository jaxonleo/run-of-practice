import { describe, it, expect } from 'vitest'
import { planningState, reconcileGroups, localDateStr, classifyDurationVariance, sumMins, actSecs, rebalanceKeep, rebalanceEven } from './constants.js'

describe('planningState', () => {
  it('returns null when the practice has no target duration', () => {
    expect(planningState({ scheduledDurationMinutes: null, activities: [] })).toBe(null)
  })

  it('returns "under" when planned activity time is below 90% of target', () => {
    const practice = { scheduledDurationMinutes: 60, activities: [{ duration: 10 }] }
    expect(planningState(practice)).toBe('under')
  })

  it('returns "onTrack" at or above 90% of target but not over', () => {
    const practice = { scheduledDurationMinutes: 60, activities: [{ duration: 54 }] }
    expect(planningState(practice)).toBe('onTrack')
  })

  it('returns "exceeds" when planned activity time is over the target', () => {
    const practice = { scheduledDurationMinutes: 60, activities: [{ duration: 70 }] }
    expect(planningState(practice)).toBe('exceeds')
  })
})

describe('reconcileGroups', () => {
  it('keeps every existing pairing intact when nobody left or joined', () => {
    const groups = [['a', 'b'], ['c', 'd']]
    const present = new Set(['a', 'b', 'c', 'd'])
    expect(reconcileGroups(groups, present)).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('drops a player who is no longer present without touching their groupmates', () => {
    const groups = [['a', 'b'], ['c', 'd']]
    const present = new Set(['a', 'c', 'd'])
    expect(reconcileGroups(groups, present)).toEqual([['a'], ['c', 'd']])
  })

  it('places a newly-present player into whichever group is currently smallest', () => {
    const groups = [['a', 'b'], ['c']]
    const present = new Set(['a', 'b', 'c', 'e'])
    expect(reconcileGroups(groups, present)).toEqual([['a', 'b'], ['c', 'e']])
  })

  it('never reshuffles existing pairings even when several players change at once', () => {
    const groups = [['a', 'b'], ['c', 'd'], ['e']]
    const present = new Set(['a', 'c', 'd', 'f'])
    expect(reconcileGroups(groups, present)).toEqual([['a'], ['c', 'd'], ['f']])
  })
})

describe('localDateStr', () => {
  it('formats a Date using local calendar fields, not a UTC conversion', () => {
    // 11pm local time should still read as the same local day -- the bug
    // this function exists to prevent is new Date().toISOString().slice(0,10),
    // which rolls to the next UTC day hours before local midnight for any
    // western-hemisphere timezone.
    const d = new Date(2026, 0, 15, 23, 30)
    expect(localDateStr(d)).toBe('2026-01-15')
  })

  it('pads single-digit months and days', () => {
    const d = new Date(2026, 2, 5)
    expect(localDateStr(d)).toBe('2026-03-05')
  })
})

describe('classifyDurationVariance', () => {
  it('returns null when either duration is missing', () => {
    expect(classifyDurationVariance(null, 100)).toBe(null)
    expect(classifyDurationVariance(100, null)).toBe(null)
  })

  it('classifies within the tolerance window as on_plan', () => {
    expect(classifyDurationVariance(600, 600)).toBe('on_plan')
    expect(classifyDurationVariance(600, 645)).toBe('on_plan')
    expect(classifyDurationVariance(600, 555)).toBe('on_plan')
  })

  it('classifies running long past tolerance as extended', () => {
    expect(classifyDurationVariance(600, 700)).toBe('extended')
  })

  it('classifies running short past tolerance as shortened', () => {
    expect(classifyDurationVariance(600, 500)).toBe('shortened')
  })

  it('respects a custom tolerance', () => {
    expect(classifyDurationVariance(600, 640, 30)).toBe('extended')
    expect(classifyDurationVariance(600, 640, 60)).toBe('on_plan')
  })
})

describe('actSecs / sumMins', () => {
  it('reads a plain activity\'s duration in minutes, converted to seconds', () => {
    expect(actSecs({ duration: 10 })).toBe(600)
  })

  it('computes a station block from stationDuration/transitionDuration, not a flat duration field', () => {
    // 3 stations, 8 min each, 2 min transitions between them (n-1 gaps) --
    // this is the same formula the live timer and the planning-depth pill
    // both depend on, so a divergence here would desync what's displayed
    // from what's actually timed.
    const block = { type: 'station_block', stations: [{}, {}, {}], stationDuration: 8, transitionDuration: 2 }
    expect(actSecs(block)).toBe((3 * 8 + 2 * 2) * 60)
  })

  it('a station block with no stations contributes zero, not NaN', () => {
    expect(actSecs({ type: 'station_block', stations: [], stationDuration: 8, transitionDuration: 2 })).toBe(0)
  })

  it('sumMins totals and rounds a mixed list of plain activities and station blocks', () => {
    const acts = [
      { duration: 10 },
      { type: 'station_block', stations: [{}, {}], stationDuration: 5, transitionDuration: 1 },
    ]
    // 10min + (2*5 + 1*1)min = 21min
    expect(sumMins(acts)).toBe(21)
  })
})

describe('rebalanceKeep', () => {
  it('drops an absent player from every station\'s assignments without touching who stays', () => {
    const stations = [
      { id: 's1', assignments: ['p1', 'p2'] },
      { id: 's2', assignments: ['p3'] },
    ]
    const present = new Set(['p1', 'p3'])
    expect(rebalanceKeep(stations, present)).toEqual([
      { id: 's1', assignments: ['p1'] },
      { id: 's2', assignments: ['p3'] },
    ])
  })

  it('does not mutate the original station objects', () => {
    const stations = [{ id: 's1', assignments: ['p1', 'p2'] }]
    const result = rebalanceKeep(stations, new Set(['p1']))
    expect(stations[0].assignments).toEqual(['p1', 'p2'])
    expect(result[0]).not.toBe(stations[0])
  })
})

describe('rebalanceEven', () => {
  const stations = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
  const allPlayers = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }]

  it('assigns every present player to exactly one station, never an absent one', () => {
    const present = new Set(['p1', 'p2', 'p3', 'p4', 'p5'])
    const result = rebalanceEven(stations, present, allPlayers)
    const allAssigned = result.flatMap(s => s.assignments)
    expect(allAssigned.sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('never assigns a player who is not present', () => {
    const present = new Set(['p1', 'p3'])
    const result = rebalanceEven(stations, present, allPlayers)
    const allAssigned = result.flatMap(s => s.assignments)
    expect(allAssigned.sort()).toEqual(['p1', 'p3'])
  })

  it('distributes as evenly as possible across every station', () => {
    const present = new Set(['p1', 'p2', 'p3', 'p4', 'p5'])
    const result = rebalanceEven(stations, present, allPlayers)
    const sizes = result.map(s => s.assignments.length)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(5)
  })
})
