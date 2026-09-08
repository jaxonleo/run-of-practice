import { describe, it, expect, beforeEach } from 'vitest'
import {
  outboxAdd, outboxList, outboxFlush, outboxRemove, outboxClearScope, outboxClearAllUsers,
  outboxResolveConflict, outboxScopeForUser, outboxScopeForGrant,
} from './benchmarkOutbox.js'

// jsdom has no IndexedDB, so these exercise the in-memory fallback path
// (which is exactly what a privacy-locked browser gets too).

const scope = outboxScopeForUser('u1', 'a1')

async function drain() {
  for (const r of await outboxList(scope)) await outboxRemove(r.id)
  await outboxClearAllUsers()
}

describe('benchmark outbox (memory fallback)', () => {
  beforeEach(drain)

  it('queues an entry and lists it as pending', async () => {
    await outboxAdd(scope, { assessmentId: 'a1', participantId: 'p1', slotIndex: 0, opId: 'op-1', payload: { valueNumeric: 4.7 } })
    const rows = await outboxList(scope)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].payload.valueNumeric).toBe(4.7)
  })

  it('flush removes acknowledged entries and keeps conflicts', async () => {
    await outboxAdd(scope, { assessmentId: 'a1', participantId: 'p1', slotIndex: 0, opId: 'ok', payload: {} })
    await outboxAdd(scope, { assessmentId: 'a1', participantId: 'p2', slotIndex: 0, opId: 'conf', payload: {} })
    await outboxAdd(scope, { assessmentId: 'a1', participantId: 'p3', slotIndex: 0, opId: 'err', payload: {} })
    const results = await outboxFlush(scope, async (r) => {
      if (r.opId === 'ok') return { ok: true }
      if (r.opId === 'conf') return { conflict: true, server: { row_version: 3 } }
      return { error: new Error('network') }
    })
    expect(results.find(r => r.id === 'ok').status).toBe('saved')
    const rows = await outboxList(scope)
    const byOp = Object.fromEntries(rows.map(r => [r.opId, r]))
    expect(byOp.ok).toBeUndefined()
    expect(byOp.conf.status).toBe('conflict')
    expect(byOp.conf.server.row_version).toBe(3)
    expect(byOp.err.status).toBe('retry')
    expect(byOp.err.attempts).toBe(1)
  })

  it('a retried entry flushes again (idempotent by opId)', async () => {
    await outboxAdd(scope, { assessmentId: 'a1', participantId: 'p1', slotIndex: 0, opId: 'r1', payload: {} })
    await outboxFlush(scope, async () => ({ error: new Error('down') }))
    expect((await outboxList(scope))[0].status).toBe('retry')
    await outboxFlush(scope, async () => ({ ok: true }))
    expect(await outboxList(scope)).toHaveLength(0)
  })

  it('resolving a conflict drops the entry', async () => {
    await outboxAdd(scope, { assessmentId: 'a1', participantId: 'p1', slotIndex: 0, opId: 'c1', payload: {} })
    await outboxFlush(scope, async () => ({ conflict: true, server: {} }))
    const [row] = await outboxList(scope)
    await outboxResolveConflict(row.id)
    expect(await outboxList(scope)).toHaveLength(0)
  })

  it('clearScope purges only that scope', async () => {
    const other = outboxScopeForGrant('a2')
    await outboxAdd(scope, { assessmentId: 'a1', participantId: 'p1', slotIndex: 0, opId: 's1', payload: {} })
    await outboxAdd(other, { assessmentId: 'a2', participantId: 'p9', slotIndex: 0, opId: 'g1', payload: {} })
    await outboxClearScope(scope)
    expect(await outboxList(scope)).toHaveLength(0)
    expect(await outboxList(other)).toHaveLength(1)
    await outboxClearScope(other)
  })
})
