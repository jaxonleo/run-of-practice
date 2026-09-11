import { describe, it, expect } from 'vitest'
import {
  generateScrimmageBoard,
  repairScrimmageBoard,
  scrimmageEligibleForSlot,
  summarizeScrimmageFairness,
  scrimmagePlayerRotation,
  buildDefaultScrimmageConfig,
  SCRIMMAGE_FIELD_SLOTS,
} from './constants.js'

// ── Roster fixtures ────────────────────────────────────────────────────────
// A realistic mixed roster: a few pitchers, a few catchers, everyone with
// some infield/outfield eligibility.
// A realistic mixed roster: a few pitchers, a few catchers, and every
// other player carries two or three field positions (a real 10U roster
// almost never has a kid with a single position on file).
function mkRoster(n, opts = {}) {
  const pitchers = opts.pitchers ?? Math.max(2, Math.round(n / 4))
  const catchers = opts.catchers ?? Math.max(2, Math.round(n / 4))
  const infield = ['1B', '2B', '3B', 'SS']
  return Array.from({ length: n }, (_, i) => {
    const pos = []
    if (i < pitchers) pos.push('P')
    if (i >= pitchers && i < pitchers + catchers) pos.push('C')
    pos.push(infield[i % 4])
    pos.push(infield[(i + 2) % 4]) // a second, different infield spot
    pos.push('OF') // a real 10U roster: nearly every kid has outfield on file
    return { id: 'p' + i, name: 'Player ' + i, positions: [...new Set(pos)] }
  })
}

const FIELD = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
const HIT_RE = /^H\d+$/

// ── Board invariant checks ─────────────────────────────────────────────────
function assertNoDoubleAssign(board) {
  board.forEach((rd, ri) => {
    const seen = new Set()
    Object.keys(rd.slots).forEach(s => {
      const a = rd.slots[s]
      if (a && a.player_id) {
        expect(seen.has(a.player_id), `round ${ri}: ${a.player_id} in two slots`).toBe(false)
        seen.add(a.player_id)
      }
    })
  })
}
function assertEligibleFielders(board, players, activeSlots) {
  const byId = Object.fromEntries(players.map(p => [p.id, p]))
  board.forEach((rd, ri) => {
    activeSlots.forEach(s => {
      const a = rd.slots[s]
      if (a && a.player_id) {
        expect(scrimmageEligibleForSlot(byId[a.player_id], s), `round ${ri} slot ${s}: ${a.player_id} not eligible`).toBe(true)
      }
    })
  })
}
function hitCounts(board, players) {
  const c = Object.fromEntries(players.map(p => [p.id, 0]))
  board.forEach(rd => Object.keys(rd.slots).forEach(s => {
    if (HIT_RE.test(s)) { const a = rd.slots[s]; if (a && a.player_id != null) c[a.player_id]++ }
  }))
  return c
}
function hitSpread(board, players) {
  const v = Object.values(hitCounts(board, players))
  return v.length ? Math.max(...v) - Math.min(...v) : 0
}
function fieldAssignmentKey(board) {
  // stable string per (round, slot) -> player, fielding slots only
  const out = []
  board.forEach((rd, ri) => Object.keys(rd.slots).sort().forEach(s => {
    if (HIT_RE.test(s)) return
    const a = rd.slots[s]
    out.push(ri + '|' + s + '|' + (a && a.player_id ? a.player_id : 'open'))
  }))
  return out
}

describe('generateScrimmageBoard - core invariants', () => {
  for (const n of [11, 9, 7, 16]) {
    it(`${n}-player roster: no double assignments, eligible fielders, deterministic`, () => {
      const players = mkRoster(n)
      const input = { players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'roster-' + n }
      const a = generateScrimmageBoard(input)
      const b = generateScrimmageBoard(input)
      expect(a.board).toEqual(b.board) // deterministic on seed
      expect(a.board).toHaveLength(10)
      assertNoDoubleAssign(a.board)
      assertEligibleFielders(a.board, players, FIELD)
    })
  }

  it('a full roster (more players than slots) leaves no field slot Open', () => {
    // With exactly players === slots, auto still forces one hitter, so one
    // field slot is legitimately Open -- that case is covered separately.
    for (const n of [11, 13, 16]) {
      const players = mkRoster(n)
      const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'noopen-' + n })
      board.forEach((rd, ri) => FIELD.forEach(s => {
        // P/C may be Open if the roster genuinely has no eligible pitcher/catcher;
        // this fixture always has some, and the rest must never be Open.
        expect(rd.slots[s], `n=${n} round ${ri} slot ${s} Open`).not.toBe(null)
      }))
    }
  })

  it('a different seed produces a different board', () => {
    const players = mkRoster(13)
    const a = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'aaa' })
    const b = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'bbb' })
    expect(a.board).not.toEqual(b.board)
  })

  it('13-player roster bats evenly (spread <= 1)', () => {
    const players = mkRoster(13)
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'even13' })
    expect(hitSpread(board, players)).toBeLessThanOrEqual(1)
  })

  it('16-player roster bats evenly (spread <= 1)', () => {
    const players = mkRoster(16)
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'even16' })
    expect(hitSpread(board, players)).toBeLessThanOrEqual(1)
  })

  it('every present player is used every round when hitters are auto', () => {
    const players = mkRoster(13)
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'used' })
    board.forEach((rd, ri) => {
      const ids = new Set()
      Object.values(rd.slots).forEach(a => { if (a && a.player_id) ids.add(a.player_id) })
      expect(ids.size, `round ${ri}`).toBe(13)
    })
  })
})

describe('generateScrimmageBoard - batting stays even across many seeds', () => {
  for (const n of [10, 11, 12, 13, 14, 15]) {
    it(`${n} players, 10 seeds: hit spread <= 1 every time`, () => {
      const players = mkRoster(n)
      for (let s = 0; s < 10; s++) {
        const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: `even-${n}-${s}` })
        expect(hitSpread(board, players), `n=${n} seed=${s}`).toBeLessThanOrEqual(1)
        assertNoDoubleAssign(board)
        assertEligibleFielders(board, players, FIELD)
      }
    })
  }
})

describe('generateScrimmageBoard - roster smaller than slots', () => {
  it('7 players, 9 slots: trailing slots Open, never a double assignment, a warning', () => {
    const players = mkRoster(7)
    const { board, warnings } = generateScrimmageBoard({ players, rounds: 8, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 's7' })
    assertNoDoubleAssign(board)
    board.forEach(rd => {
      const filled = FIELD.filter(s => rd.slots[s] && rd.slots[s].player_id)
      expect(filled.length).toBeLessThanOrEqual(7)
    })
    // RF/CF/LF are the first to go Open
    const anyOpen = board.some(rd => rd.slots.RF === null || rd.slots.CF === null || rd.slots.LF === null)
    expect(anyOpen).toBe(true)
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('generateScrimmageBoard - coach pitch (P slot off)', () => {
  it('produces no P slot and no pitcher warning noise', () => {
    const players = mkRoster(12)
    const slots = FIELD.filter(s => s !== 'P')
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'coachpitch' })
    board.forEach(rd => expect('P' in rd.slots).toBe(false))
    assertEligibleFielders(board, players, slots)
  })
})

describe('generateScrimmageBoard - locks', () => {
  it('a player locked to LF only ever appears at LF', () => {
    const players = mkRoster(12)
    players[4].locks = { position: 'LF' }
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'lockLF' })
    board.forEach((rd, ri) => {
      Object.keys(rd.slots).forEach(s => {
        const a = rd.slots[s]
        if (a && a.player_id === 'p4') expect(s, `round ${ri}`).toBe('LF')
      })
      // and LF is theirs every round
      expect(rd.slots.LF && rd.slots.LF.player_id).toBe('p4')
    })
  })

  it('a never-hits player is never put in a hitter slot', () => {
    const players = mkRoster(12)
    players[3].locks = { noHit: true }
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'nohit' })
    board.forEach((rd, ri) => {
      Object.keys(rd.slots).forEach(s => {
        if (HIT_RE.test(s)) expect(rd.slots[s] && rd.slots[s].player_id, `round ${ri} ${s}`).not.toBe('p3')
      })
    })
  })

  it('a never-pitches player never pitches and a never-catches player never catches', () => {
    const players = mkRoster(14)
    players[0].locks = { noPitch: true } // p0 is otherwise a pitcher
    players[Math.round(14 / 4)].locks = { noCatch: true } // first catcher
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'neverxx' })
    board.forEach(rd => {
      expect(rd.slots.P && rd.slots.P.player_id).not.toBe('p0')
      expect(rd.slots.C && rd.slots.C.player_id).not.toBe('p' + Math.round(14 / 4))
    })
  })

  it('a sat-out player never appears on the board', () => {
    const players = mkRoster(13)
    players[6].locks = { sitOut: true }
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'sitout' })
    board.forEach(rd => Object.values(rd.slots).forEach(a => expect(a && a.player_id).not.toBe('p6')))
  })
})

describe('generateScrimmageBoard - pitcher distribution', () => {
  it('with enough pitchers, nobody pitches more than pitcherRoundsMax', () => {
    const players = mkRoster(20, { pitchers: 10 })
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 5, catcherHold: 2, pitcherRoundsMax: 1, seed: 'pitch-plenty' })
    const counts = {}
    board.forEach(rd => { const a = rd.slots.P; if (a && a.player_id) counts[a.player_id] = (counts[a.player_id] || 0) + 1 })
    Object.values(counts).forEach(n => expect(n).toBeLessThanOrEqual(1))
  })

  it('with fewer pitchers than rounds, it spreads evenly and warns', () => {
    const players = mkRoster(12, { pitchers: 3 })
    const { board, warnings } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'pitch-few' })
    const counts = {}
    board.forEach(rd => { const a = rd.slots.P; if (a && a.player_id) counts[a.player_id] = (counts[a.player_id] || 0) + 1 })
    const vals = Object.values(counts)
    expect(vals.length).toBeGreaterThan(0)
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(2) // roughly even (10 / 3)
    expect(warnings.some(w => /pitcher/i.test(w))).toBe(true)
  })

  it('zero eligible pitchers: P Open every round, exactly one warning about it', () => {
    const players = mkRoster(12, { pitchers: 0 })
    const { board, warnings } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'pitch-zero' })
    board.forEach(rd => expect(rd.slots.P).toBe(null))
    expect(warnings.filter(w => /no players are set as pitchers/i.test(w))).toHaveLength(1)
  })
})

describe('generateScrimmageBoard - field slot Open despite eligible players (audit: "clearer constraint handling")', () => {
  // rop-06-scrimmage-rotation-gaps.jpg: a roster where every player has a
  // single fixed position produced a repeated-assignment, Open-2B board with
  // no explanation why -- the only prior warning fired when literally NOBODY
  // was ever eligible for a slot, not when eligible players existed but were
  // already committed elsewhere that round (the actually-observed case).
  it('one player eligible for two single-coverage slots leaves one Open every round, with a named warning', () => {
    const players = [
      { id: 'a', name: 'Alex', positions: ['2B', 'SS'] }, // only one eligible for either -- can fill just one per round
      { id: 'b', name: 'Blake', positions: ['1B'] },
      { id: 'c', name: 'Casey', positions: ['3B'] },
      { id: 'd', name: 'Drew', positions: ['LF'] },
      { id: 'e', name: 'Ellis', positions: ['CF'] },
      { id: 'f', name: 'Finley', positions: ['RF'] },
    ]
    const slots = ['2B', 'SS', '1B', '3B', 'LF', 'CF', 'RF'] // P/C off -- isolates this from the pitcher/catcher warnings above
    const { board, warnings } = generateScrimmageBoard({ players, rounds: 2, slots, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'audit-open-2b' })
    const openCount = board.reduce((n, rd) => n + (rd.slots['2B'] ? 0 : 1) + (rd.slots.SS ? 0 : 1), 0)
    expect(openCount).toBeGreaterThan(0) // Alex can never cover both slots in the same round
    const w = warnings.find(w => /field slot.*stayed open/i.test(w) || /field slots.*stayed open/i.test(w))
    expect(w).toBeTruthy()
    expect(w).toMatch(/eligible/i)
    expect(w).toMatch(/add|relax|roster|round rules/i) // carries actionable guidance, not just a bare fact
  })

  it('does not fire when every field slot is fully covered every round', () => {
    const players = mkRoster(9, { pitchers: 0, catchers: 0 })
    const { warnings } = generateScrimmageBoard({ players, rounds: 4, slots: ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'], hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'plenty-eligible' })
    expect(warnings.some(w => /stayed open/i.test(w))).toBe(false)
  })
})

describe('generateScrimmageBoard - catcher holds', () => {
  function catcherRuns(board) {
    const rounds = {}
    board.forEach((rd, ri) => { const a = rd.slots.C; if (a && a.player_id) (rounds[a.player_id] || (rounds[a.player_id] = [])).push(ri) })
    return rounds
  }
  // Split a catcher's rounds into maximal contiguous runs. Every run must be
  // exactly `hold` long, except a run that reaches the final round may be
  // shorter (section 4.2 rule 5). With hold = 1 a catcher may legitimately
  // have several separate 1-round runs.
  function maximalRuns(sortedRounds) {
    const runs = []
    let start = sortedRounds[0], prev = sortedRounds[0]
    for (let i = 1; i < sortedRounds.length; i++) {
      if (sortedRounds[i] === prev + 1) { prev = sortedRounds[i]; continue }
      runs.push([start, prev]); start = sortedRounds[i]; prev = sortedRounds[i]
    }
    runs.push([start, prev])
    return runs
  }
  for (const hold of [1, 2, 3]) {
    it(`catcherHold = ${hold}: every catcher run is ${hold} rounds (a run ending at the last half-inning may be shorter)`, () => {
      const players = mkRoster(14, { catchers: 6 })
      const { board } = generateScrimmageBoard({ players, rounds: 9, slots: FIELD, hittersPerRound: 'auto', catcherHold: hold, pitcherRoundsMax: 1, seed: 'hold-' + hold })
      const runs = catcherRuns(board)
      Object.entries(runs).forEach(([pid, list]) => {
        list.sort((a, b) => a - b)
        maximalRuns(list).forEach(([s, e]) => {
          const len = e - s + 1
          if (e === board.length - 1) expect(len, `${pid} final run`).toBeLessThanOrEqual(hold)
          else expect(len, `${pid} run ${s}-${e}`).toBe(hold)
        })
      })
    })
  }
})

describe('repairScrimmageBoard - after one absence', () => {
  it('keeps >= 80% of fielding assignments unchanged and restores hit spread <= 1', () => {
    const players = mkRoster(13)
    const input = { players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'repair-1' }
    const { board } = generateScrimmageBoard(input)
    const before = fieldAssignmentKey(board)

    // p5 is now absent
    const remaining = players.filter(p => p.id !== 'p5')
    const { board: repaired } = repairScrimmageBoard({ ...input, players: remaining }, board)

    // p5 gone entirely
    repaired.forEach(rd => Object.values(rd.slots).forEach(a => expect(a && a.player_id).not.toBe('p5')))
    // hit spread restored
    expect(hitSpread(repaired, remaining)).toBeLessThanOrEqual(1)
    // minimal churn: compare fielding slots that did NOT involve p5 originally
    const after = fieldAssignmentKey(repaired)
    const beforeNoP5 = before.filter(k => !k.endsWith('|p5'))
    let unchanged = 0
    beforeNoP5.forEach(k => { if (after.includes(k)) unchanged++ })
    expect(unchanged / beforeNoP5.length).toBeGreaterThanOrEqual(0.8)
    // still no double assignments
    assertNoDoubleAssign(repaired)
  })

  it('inserts a newly-present player rather than ignoring them', () => {
    const players = mkRoster(12)
    const input = { players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'repair-add' }
    const { board } = generateScrimmageBoard(input)
    const withNew = [...players, { id: 'pNEW', name: 'New Kid', positions: ['SS', 'OF'] }]
    const { board: repaired } = repairScrimmageBoard({ ...input, players: withNew }, board)
    const appears = repaired.some(rd => Object.values(rd.slots).some(a => a && a.player_id === 'pNEW'))
    expect(appears).toBe(true)
  })

  it('across every player leaving one at a time: churn and spread both hold', () => {
    const players = mkRoster(12)
    const input = { players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'repair-sweep' }
    const { board } = generateScrimmageBoard(input)
    const before = fieldAssignmentKey(board)
    players.forEach(gone => {
      const remaining = players.filter(p => p.id !== gone.id)
      const { board: repaired } = repairScrimmageBoard({ ...input, players: remaining }, board)
      repaired.forEach(rd => Object.values(rd.slots).forEach(a => expect(a && a.player_id).not.toBe(gone.id)))
      assertNoDoubleAssign(repaired)
      // Repair is minimal-change first: a residual batting spread of up to
      // 2 is tolerated (and the generator warns) rather than reshuffling
      // whole rounds of fielders to shave the last at-bat. The dedicated
      // single-absence test above holds the tighter <= 1 bar.
      expect(hitSpread(repaired, remaining), `spread after ${gone.id}`).toBeLessThanOrEqual(2)
      const after = fieldAssignmentKey(repaired)
      const beforeNoGone = before.filter(k => !k.endsWith('|' + gone.id))
      const unchanged = beforeNoGone.filter(k => after.includes(k)).length
      const isKey = (gone.positions || []).some(p => p === 'P' || p === 'C')
      expect(unchanged / beforeNoGone.length, `churn after ${gone.id}`).toBeGreaterThanOrEqual(isKey ? 0.7 : 0.8)
    })
  })

  it('never places staff/helper assignees and leaves existing ones untouched', () => {
    const players = mkRoster(12)
    const input = { players, rounds: 6, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'repair-staff' }
    const { board } = generateScrimmageBoard(input)
    board[0].slots['1B'] = { team_staff_id: 'coach-1' }
    board[2].slots['RF'] = { helper_name: 'Dad' }
    const remaining = players.filter(p => p.id !== 'p8')
    const { board: repaired } = repairScrimmageBoard({ ...input, players: remaining }, board)
    expect(repaired[0].slots['1B']).toEqual({ team_staff_id: 'coach-1' })
    expect(repaired[2].slots['RF']).toEqual({ helper_name: 'Dad' })
  })
})

describe('helpers', () => {
  it('buildDefaultScrimmageConfig: 60 min / 6 min = 10 half-innings, carries format', () => {
    const c = buildDefaultScrimmageConfig(60, 6)
    expect(c.rounds).toBe(10)
    expect(c.format).toBe('everyone_rotates')
    expect(c.catcherHold).toBe(2)
    expect(c.slots).toEqual(SCRIMMAGE_FIELD_SLOTS)
  })

  it('summarizeScrimmageFairness reports even batting and pitcher usage', () => {
    const players = mkRoster(13)
    const { board } = generateScrimmageBoard({ players, rounds: 10, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'fair' })
    const s = summarizeScrimmageFairness(board, players)
    expect(s.hits.even).toBe(true)
    expect(s.pitch.used).toBeGreaterThan(0)
    expect(s.catch.count).toBeGreaterThan(0)
  })

  it('scrimmagePlayerRotation joins consecutive same-slot rounds into a hold', () => {
    const players = mkRoster(14, { catchers: 4 })
    const { board } = generateScrimmageBoard({ players, rounds: 8, slots: FIELD, hittersPerRound: 'auto', catcherHold: 2, pitcherRoundsMax: 1, seed: 'rot' })
    // find a catcher and confirm their hold shows up as a bracket
    const catcher = board[0].slots.C.player_id
    const rot = scrimmagePlayerRotation(board, catcher)
    expect(rot.timeline).toHaveLength(8)
    expect(rot.holds.some(([a, b]) => b > a)).toBe(true)
  })

  it('scrimmageEligibleForSlot: no positions => anywhere but P and C', () => {
    const p = { id: 'x', positions: [] }
    expect(scrimmageEligibleForSlot(p, 'P')).toBe(false)
    expect(scrimmageEligibleForSlot(p, 'C')).toBe(false)
    expect(scrimmageEligibleForSlot(p, 'SS')).toBe(true)
    expect(scrimmageEligibleForSlot(p, 'LF')).toBe(true)
  })

  it('scrimmageEligibleForSlot: OF covers LF/CF/RF, IF covers infield', () => {
    expect(scrimmageEligibleForSlot({ positions: ['OF'] }, 'CF')).toBe(true)
    expect(scrimmageEligibleForSlot({ positions: ['OF'] }, '2B')).toBe(false)
    expect(scrimmageEligibleForSlot({ positions: ['IF'] }, '2B')).toBe(true)
    expect(scrimmageEligibleForSlot({ positions: ['IF'] }, 'RF')).toBe(false)
  })
})
