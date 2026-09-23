import { describe, it, expect } from 'vitest'
import { livePace, currentActRemainingSecs, liveActRunSecs, attendanceTimeline } from './constants.js'

const MIN = 60000
const drill = mins => ({ type: 'activity', duration: mins })
// A 90-minute plan: a 10-minute first drill, then 80 more minutes.
const plan90 = [drill(10), drill(30), drill(30), drill(20)]
const sched = Date.UTC(2026, 8, 22, 17, 0) // 5:00pm

describe('livePace (ahead/behind against the scheduled end, not our own start)', () => {
  it('starting 2 minutes early reads 2m ahead and stays there while on plan', () => {
    const start = sched - 2 * MIN
    const atStart = livePace({ nowMs: start, scheduledStartMs: sched, runStartMs: start, windowMins: 90, acts: plan90, idx: 0, currentRemainingSecs: 600 })
    expect(atStart.deltaMins).toBe(-2)
    // 25 minutes in, on the second drill with 15 of its 30 minutes left: still 2 ahead.
    const later = livePace({ nowMs: start + 25 * MIN, scheduledStartMs: sched, runStartMs: start, windowMins: 90, acts: plan90, idx: 1, currentRemainingSecs: 15 * 60 })
    expect(later.deltaMins).toBe(-2)
  })

  it('adding 3 minutes to the first drill after starting 2 early reads 1m behind', () => {
    const start = sched - 2 * MIN
    const p = livePace({ nowMs: start, scheduledStartMs: sched, runStartMs: start, windowMins: 90, acts: plan90, idx: 0, currentRemainingSecs: 13 * 60 })
    expect(p.deltaMins).toBe(1)
  })

  it('starting 10 minutes late reads 10m behind (the field still ends on time)', () => {
    const start = sched + 10 * MIN
    const p = livePace({ nowMs: start, scheduledStartMs: sched, runStartMs: start, windowMins: 90, acts: plan90, idx: 0, currentRemainingSecs: 600 })
    expect(p.deltaMins).toBe(10)
    expect(p.endMs).toBe(sched + 90 * MIN)
  })

  it('running over a drill keeps adding to behind (overtime is not negative remaining)', () => {
    const p = livePace({ nowMs: sched + 14 * MIN, scheduledStartMs: sched, runStartMs: sched, windowMins: 90, acts: plan90, idx: 0, currentRemainingSecs: -4 * 60 })
    expect(p.deltaMins).toBe(4)
  })

  it('a run far from its scheduled slot anchors to its own start instead', () => {
    const start = sched + 24 * 60 * MIN
    const p = livePace({ nowMs: start, scheduledStartMs: sched, runStartMs: start, windowMins: 90, acts: plan90, idx: 0, currentRemainingSecs: 600 })
    expect(p.anchoredToSchedule).toBe(false)
    expect(p.deltaMins).toBe(0)
  })

  it('returns null without a window to measure against', () => {
    expect(livePace({ nowMs: sched, scheduledStartMs: sched, runStartMs: sched, windowMins: 0, acts: plan90, idx: 0, currentRemainingSecs: 600 })).toBe(null)
  })
})

describe('currentActRemainingSecs', () => {
  const block = { type: 'station_block', stations: [{}, {}, {}], stationDuration: 10, transitionDuration: 1 }
  it('counts the rest of a rotating block, not just the current rotation', () => {
    expect(currentActRemainingSecs({ act: block, rem: 300, stIdx: 0 })).toBe(300 + 2 * (600 + 60))
    expect(currentActRemainingSecs({ act: block, rem: 30, stIdx: 0, inTrans: true })).toBe(30 + 2 * 600 + 60)
    expect(currentActRemainingSecs({ act: block, rem: 60, inBlockIntro: true })).toBe(60 + 3 * 600 + 2 * 60)
    expect(currentActRemainingSecs({ act: block, rem: 100, stIdx: 2 })).toBe(100)
  })
  it('never counts overtime as negative time left', () => {
    expect(currentActRemainingSecs({ act: drill(10), rem: -90 })).toBe(0)
  })
  it('includes time added past the plan (rem above the planned duration)', () => {
    expect(currentActRemainingSecs({ act: drill(10), rem: 13 * 60 })).toBe(13 * 60)
  })
})

describe('liveActRunSecs', () => {
  it('adds the auto-advancing intro to blocks and scrimmages', () => {
    expect(liveActRunSecs({ type: 'station_block', stations: [{}, {}], stationDuration: 10, transitionDuration: 0 })).toBe(2 * 60 + 20 * 60)
    expect(liveActRunSecs({ type: 'station_block', rotate: false, stations: [{}, {}], stationDuration: 10, transitionDuration: 1 })).toBe(60 + 600)
    expect(liveActRunSecs({ type: 'scrimmage', duration: 30 })).toBe(45 + 1800)
  })
})

describe('attendanceTimeline', () => {
  const start = sched, end = sched + 90 * MIN
  const at = m => new Date(start + m * MIN).toISOString()
  it('full, late, early, absent, and left-and-came-back players', () => {
    const rows = [
      { player_id: 'full', status: 'present', created_at: new Date(start + 400).toISOString() },
      { player_id: 'late', status: 'absent', created_at: at(0) },
      { player_id: 'early', status: 'present', created_at: at(0) },
      { player_id: 'gone', status: 'absent', created_at: at(0) },
      { player_id: 'gap', status: 'present', created_at: at(0) },
      // mid-practice Update Attendance snapshot at 20 min
      { player_id: 'full', status: 'present', created_at: at(20) },
      { player_id: 'late', status: 'present', created_at: at(20) },
      { player_id: 'early', status: 'present', created_at: at(20) },
      { player_id: 'gone', status: 'absent', created_at: at(20) },
      { player_id: 'gap', status: 'absent', created_at: at(20) },
      // another at 60 min
      { player_id: 'early', status: 'left_early', created_at: at(60) },
      { player_id: 'gap', status: 'present', created_at: at(50) },
    ]
    const t = attendanceTimeline(rows, start, end)
    expect(t.full.status).toBe('full')
    expect(Math.round(t.full.presentMs / MIN)).toBe(90)
    expect(t.late.status).toBe('partial')
    expect(t.late.arrivedAt).toBe(start + 20 * MIN)
    expect(Math.round(t.late.presentMs / MIN)).toBe(70)
    expect(t.early.leftAt).toBe(start + 60 * MIN)
    expect(Math.round(t.early.presentMs / MIN)).toBe(60)
    expect(t.gone.status).toBe('absent')
    expect(t.gone.presentMs).toBe(0)
    expect(t.gap.intervals.length).toBe(2)
    expect(Math.round(t.gap.presentMs / MIN)).toBe(60)
    expect(t.gap.status).toBe('partial')
  })
  it('clamps rows written before the run started or after it ended', () => {
    const rows = [
      { player_id: 'a', status: 'present', created_at: at(-5) },
      { player_id: 'a', status: 'absent', created_at: at(120) },
    ]
    const t = attendanceTimeline(rows, start, end)
    expect(t.a.status).toBe('full')
    expect(t.a.presentMs).toBe(90 * MIN)
  })
})
