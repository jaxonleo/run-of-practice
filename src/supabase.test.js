import { describe, it, expect, vi, beforeEach } from 'vitest'

// supabase.js creates its client at module scope (`export const supabase =
// createClient(...)`), so the only way to control what its query builder
// returns is to mock the SDK itself before importing the module under test.
const { fromMock, groupsInsertMock, membersInsertMock } = vi.hoisted(() => {
  const groupsInsertMock = vi.fn()
  const membersInsertMock = vi.fn()
  const fromMock = vi.fn((table) => {
    if (table === 'session_groups') return { insert: groupsInsertMock }
    if (table === 'session_group_members') return { insert: membersInsertMock }
    throw new Error('unexpected table in test: ' + table)
  })
  return { fromMock, groupsInsertMock, membersInsertMock }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: fromMock }),
}))

const { saveSessionGroups } = await import('./supabase.js')

beforeEach(() => {
  fromMock.mockClear()
  groupsInsertMock.mockReset()
  membersInsertMock.mockReset()
  membersInsertMock.mockReturnValue(Promise.resolve({ error: null }))
})

// Regression test for a real, documented bug: .insert(rows).select() doesn't
// guarantee the returned rows come back in the same order they were sent.
// The original code zipped `groupRows` against the original `groups` array
// by array index, which paired a group's row with a *different* group's
// player list whenever the response order didn't match the request order.
// The fix zips by the row's own `group_number` column instead.
describe('saveSessionGroups', () => {
  it('attributes each group\'s players by group_number, not response array position', async () => {
    // Deliberately returned in reverse order vs. the request -- this is
    // exactly the shape of response Postgres/PostgREST is free to return.
    groupsInsertMock.mockReturnValue({
      select: () => Promise.resolve({
        data: [
          { id: 'row-for-group-2', group_number: 2 },
          { id: 'row-for-group-1', group_number: 1 },
        ],
        error: null,
      }),
    })

    await saveSessionGroups('session1', 'act1', 'coach1', [['alex', 'blair'], ['casey']], null, null)

    // Order isn't the point here (it naturally follows groupRows' own
    // iteration order, reversed in this test on purpose) -- what matters,
    // and what the original bug got wrong, is which group_id each
    // player_id ends up paired with.
    const insertedMembers = membersInsertMock.mock.calls[0][0]
    expect(insertedMembers).toEqual(expect.arrayContaining([
      { group_id: 'row-for-group-1', player_id: 'alex' },
      { group_id: 'row-for-group-1', player_id: 'blair' },
      { group_id: 'row-for-group-2', player_id: 'casey' },
    ]))
    expect(insertedMembers).toHaveLength(3)
  })

  it('sends group_number as 1-indexed position in the original groups array', async () => {
    groupsInsertMock.mockImplementation((rows) => ({
      select: () => Promise.resolve({ data: rows.map((r, i) => ({ id: 'row' + i, group_number: r.group_number })), error: null }),
    }))

    await saveSessionGroups('session1', 'act1', 'coach1', [['alex'], ['blair'], ['casey']], null, null)

    const insertedRows = groupsInsertMock.mock.calls[0][0]
    expect(insertedRows.map(r => r.group_number)).toEqual([1, 2, 3])
  })

  it('does nothing when there are no groups to save', async () => {
    await saveSessionGroups('session1', 'act1', 'coach1', [], null, null)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('does not attempt the member insert when the group insert fails', async () => {
    groupsInsertMock.mockReturnValue({
      select: () => Promise.resolve({ data: null, error: { message: 'RLS rejected it' } }),
    })

    await saveSessionGroups('session1', 'act1', 'coach1', [['alex']], null, null)

    expect(membersInsertMock).not.toHaveBeenCalled()
  })
})
