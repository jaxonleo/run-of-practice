import { describe, it, expect, vi } from 'vitest'
import { createSingleFlight } from './singleFlight.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('createSingleFlight', () => {
  it('runs the function and returns its result', async () => {
    const run = createSingleFlight()
    expect(await run('save', async () => 42)).toBe(42)
  })

  it('drops calls made while one is in flight (rapid double/triple click)', async () => {
    const run = createSingleFlight()
    const gate = deferred()
    const insert = vi.fn(() => gate.promise)

    // Three clicks back to back, before the first save has finished.
    const first = run('schedule', insert)
    const second = run('schedule', insert)
    const third = run('save', insert)

    gate.resolve('saved')
    expect(await first).toBe('saved')
    expect(await second).toBeUndefined()
    expect(await third).toBeUndefined()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('drops a different kind of action too (Run Now while Save is running)', async () => {
    const run = createSingleFlight()
    const gate = deferred()
    const save = vi.fn(() => gate.promise)
    const runNow = vi.fn(async () => 'ran')

    const first = run('save', save)
    expect(await run('run', runNow)).toBeUndefined()
    gate.resolve()
    await first
    expect(runNow).not.toHaveBeenCalled()
  })

  it('allows a new call once the previous one has finished', async () => {
    const run = createSingleFlight()
    const fn = vi.fn(async () => 'ok')
    await run('save', fn)
    await run('save', fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('releases the guard when the function throws, so the user can retry', async () => {
    const run = createSingleFlight()
    await expect(run('save', async () => { throw new Error('rls') })).rejects.toThrow('rls')
    expect(await run('save', async () => 'retry ok')).toBe('retry ok')
  })

  it('reports the running kind, then null, through onChange', async () => {
    const seen = []
    const run = createSingleFlight(k => seen.push(k))
    await run('template', async () => {})
    expect(seen).toEqual(['template', null])
  })

  it('does not report a dropped call as running', async () => {
    const seen = []
    const run = createSingleFlight(k => seen.push(k))
    const gate = deferred()
    const first = run('save', () => gate.promise)
    await run('save', async () => {})
    gate.resolve()
    await first
    expect(seen).toEqual(['save', null])
  })
})
