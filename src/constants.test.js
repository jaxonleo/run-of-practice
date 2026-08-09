import { describe, it, expect } from 'vitest'
import { planningState, reconcileGroups, localDateStr, classifyDurationVariance } from './constants.js'

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
