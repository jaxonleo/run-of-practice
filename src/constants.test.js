import { describe, it, expect } from 'vitest'
import { planningState, reconcileGroups, localDateStr, classifyDurationVariance, sumMins, actSecs, rebalanceKeep, rebalanceEven, groupByAttribute, chainOnto } from './constants.js'

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

describe('groupByAttribute', () => {
  const player = (id, value) => ({ id, bats: value })
  const byBats = (players, n, maxSize) => groupByAttribute(players, n, p => p.bats || '', v => v, maxSize)

  it('audit repro: six players with a 3/3 attribute split into 3 pairs must never produce a trio or an empty pair', () => {
    // rop-05-partners-three-per-pair.jpg: Generate Random Groups -> Group By
    // Bats produced Pair 1 {Blake, Drew, Finley}, Pair 2 {Alex, Casey, Ellis},
    // Pair 3 {} -- a bucket of 3 dumped whole into one group, capacity ignored.
    const players = [player('alex', 'R'), player('blake', 'R'), player('casey', 'R'), player('drew', 'L'), player('ellis', 'L'), player('finley', 'L')]
    const groups = byBats(players, 3, 2)
    expect(groups.map(g => g.ids.length)).toEqual([2, 2, 2])
    expect(new Set(groups.flatMap(g => g.ids))).toEqual(new Set(players.map(p => p.id)))
  })

  it('keeps a shared-value group labeled when the bucket fits within the cap', () => {
    const players = [player('a', 'R'), player('b', 'R'), player('c', 'L'), player('d', 'L')]
    const groups = byBats(players, 2, 2)
    expect(groups.every(g => g.ids.length === 2)).toBe(true)
    expect(groups.map(g => g.label).sort()).toEqual(['L', 'R'])
  })

  it('splits an oversized bucket across groups one at a time instead of overflowing the cap', () => {
    const players = [player('a', 'R'), player('b', 'R'), player('c', 'R'), player('d', 'R'), player('e', 'L')]
    // 5 players -> 3 pairs (last one a solo), matching the app's ceil(n/2) sizing.
    const groups = byBats(players, 3, 2)
    groups.forEach(g => expect(g.ids.length).toBeLessThanOrEqual(2))
    expect(groups.reduce((s, g) => s + g.ids.length, 0)).toBe(5)
  })

  it('never exceeds maxSize even with a single value shared by everyone', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => player(id, 'R'))
    const groups = byBats(players, 3, 2)
    expect(groups.map(g => g.ids.length)).toEqual([2, 2, 2])
  })

  it('without maxSize, still bin-packs whole buckets together (station behavior unchanged)', () => {
    const players = [player('a', 'R'), player('b', 'R'), player('c', 'R'), player('d', 'L')]
    const groups = groupByAttribute(players, 2, p => p.bats || '', v => v)
    // The 3-player R bucket lands together in one group, unconstrained.
    const rGroup = groups.find(g => g.label === 'R')
    expect(rGroup.ids.length).toBe(3)
  })
})

describe('chainOnto', () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  it('runs queued calls strictly in call order even when an earlier call is slower than a later one', async () => {
    const ref = { current: Promise.resolve() }
    const order = []
    const p1 = chainOnto(ref, async () => { order.push('start1'); await wait(30); order.push('end1') })
    const p2 = chainOnto(ref, async () => { order.push('start2'); await wait(5); order.push('end2') })
    await Promise.all([p1, p2])
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2'])
  })

  it('lets a later call proceed even after an earlier one rejects, without losing its own rejection', async () => {
    const ref = { current: Promise.resolve() }
    const order = []
    const p1 = chainOnto(ref, async () => { order.push('call1'); throw new Error('boom') })
    const p2 = chainOnto(ref, async () => { order.push('call2'); return 'ok' })
    await expect(p1).rejects.toThrow('boom')
    await expect(p2).resolves.toBe('ok')
    expect(order).toEqual(['call1', 'call2'])
  })

  // Models CommandScreen's live-practice transitionTo exactly: each queued
  // call closes whatever activity-log interval is open, then opens the next
  // one. Regression for the audit's "History timing contradicts itself and
  // can overcount" -- rapid repeat taps (Next, Overview jump list) used to
  // interleave the close-old/open-new sequence across calls sharing one
  // mutable ref, leaving two intervals open at once (an overlap) or a log
  // whose close got skipped entirely (an interval with no end, so its
  // component reads "no actual time logged" while the summary still counts
  // it). Chaining every call through one queue makes that impossible: at
  // most one interval is ever open, and every opened interval is closed
  // before the next opens, regardless of when each call's own network step
  // happens to settle.
  it('a real activity-log open/close sequence never has two intervals open at once, even under rapid out-of-order-resolving calls', async () => {
    const ref = { current: Promise.resolve() }
    let openLogId = null
    const intervals = [] // { id, activity, closed }
    let nextId = 1
    const closeCurrentLog = async (delay) => {
      if (openLogId == null) return
      await wait(delay)
      intervals.find((i) => i.id === openLogId).closed = true
      openLogId = null
    }
    const openLogFor = async (activity, delay) => {
      await wait(delay)
      const id = nextId++
      intervals.push({ id, activity, closed: false })
      openLogId = id
    }
    const transitionTo = (activity, closeDelay, openDelay) =>
      chainOnto(ref, async () => { await closeCurrentLog(closeDelay); await openLogFor(activity, openDelay) })

    // Fire three "Next" taps back to back, each with different network
    // timing (the third resolves fastest, mimicking a rapid tap landing
    // before the first two's writes settle).
    await Promise.all([
      transitionTo('Checklist', 5, 20),
      transitionTo('Stretch', 15, 5),
      transitionTo('Closer', 1, 1),
    ])

    // Every interval but the last must have been closed -- none left
    // dangling open (the "no actual time logged" gap) and never two
    // simultaneously open (the "overlapping intervals" overcount).
    const stillOpen = intervals.filter((i) => !i.closed)
    expect(stillOpen.length).toBe(1)
    expect(stillOpen[0].activity).toBe('Closer')
    expect(intervals.map((i) => i.activity)).toEqual(['Checklist', 'Stretch', 'Closer'])
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
