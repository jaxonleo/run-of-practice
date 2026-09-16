import { describe, it, expect } from 'vitest'
import { advanceButtonLabel, isFinalAdvance } from './CommandScreen.jsx'

describe('advanceButtonLabel (scrimmage Next-button audit fix)', () => {
  const base = { isBlock: false, blockRotate: false, isScrim: true, inBlockIntro: false, scrimRoundIdx: 0, scrimRoundCount: 3, roundLabel: 'Round', idx: 1, liveActs: [{}, {}, { type: 'checklist', name: 'Checklist' }, { type: 'checklist', name: 'Closer' }] }

  it('says "Start Round 1" during the scrimmage intro', () => {
    expect(advanceButtonLabel({ ...base, inBlockIntro: true })).toBe('Start Round 1')
  })

  it('says "Next Round" mid-scrimmage', () => {
    expect(advanceButtonLabel({ ...base, scrimRoundIdx: 0, scrimRoundCount: 3 })).toBe('Next Round')
  })

  it('audit repro: names the real destination on the final round instead of a bare "Next >"', () => {
    // rop-13-scrimmage-two-next-buttons.jpg: the large Next advanced the
    // round, then silently moved to Checklist after the final round with no
    // warning in the label.
    const label = advanceButtonLabel({ ...base, scrimRoundIdx: 2, scrimRoundCount: 3 })
    expect(label).toBe('Next Activity: Checklist')
  })

  it('says "Finish Practice" when the scrimmage is the last activity', () => {
    const label = advanceButtonLabel({ ...base, scrimRoundIdx: 2, scrimRoundCount: 3, idx: 3 })
    expect(label).toBe('Finish Practice')
  })

  it('falls back to a custom round label (e.g. Half-Inning) instead of the word "Round"', () => {
    expect(advanceButtonLabel({ ...base, inBlockIntro: true, roundLabel: 'Half-Inning' })).toBe('Start Half-Inning 1')
    expect(advanceButtonLabel({ ...base, roundLabel: 'Half-Inning' })).toBe('Next Half-Inning')
  })

  it('non-scrimmage activities keep their pre-existing labels unchanged', () => {
    expect(advanceButtonLabel({ isBlock: false, blockRotate: false, isScrim: false })).toBe('Next >')
    expect(advanceButtonLabel({ isBlock: true, blockRotate: false, isScrim: false })).toBe('End Block')
    expect(advanceButtonLabel({ isBlock: true, blockRotate: true, isScrim: false })).toBe('Next >')
  })
})

describe('isFinalAdvance (End Practice visual indicator, design system v1)', () => {
  const plain = { isBlock: false, blockRotate: false, isScrim: false, inBlockIntro: false, scrimRoundIdx: 0, scrimRoundCount: 0, stIdx: 0, stationsLength: 0 }

  it('is not final when there is a later activity in the plan', () => {
    expect(isFinalAdvance({ ...plain, idx: 0, liveActs: [{}, {}] })).toBe(false)
  })

  it('is final on the last plain activity', () => {
    expect(isFinalAdvance({ ...plain, idx: 1, liveActs: [{}, {}] })).toBe(true)
  })

  it('is never final while still inside a station block\'s intro or rotations, even on the last liveAct', () => {
    expect(isFinalAdvance({ ...plain, isBlock: true, blockRotate: true, inBlockIntro: true, idx: 0, liveActs: [{}], stIdx: 0, stationsLength: 3 })).toBe(false)
    expect(isFinalAdvance({ ...plain, isBlock: true, blockRotate: true, idx: 0, liveActs: [{}], stIdx: 0, stationsLength: 3 })).toBe(false)
  })

  it('is final once a station block reaches its last rotation and is the last liveAct', () => {
    expect(isFinalAdvance({ ...plain, isBlock: true, blockRotate: true, idx: 0, liveActs: [{}], stIdx: 2, stationsLength: 3 })).toBe(true)
  })

  it('mirrors the scrimmage case: never final during intro or mid-rounds, final on the last round of the last liveAct', () => {
    expect(isFinalAdvance({ ...plain, isScrim: true, inBlockIntro: true, idx: 0, liveActs: [{}], scrimRoundCount: 3 })).toBe(false)
    expect(isFinalAdvance({ ...plain, isScrim: true, idx: 0, liveActs: [{}], scrimRoundIdx: 0, scrimRoundCount: 3 })).toBe(false)
    expect(isFinalAdvance({ ...plain, isScrim: true, idx: 0, liveActs: [{}], scrimRoundIdx: 2, scrimRoundCount: 3 })).toBe(true)
  })
})
