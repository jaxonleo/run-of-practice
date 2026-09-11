import { describe, it, expect } from 'vitest'
import { advanceButtonLabel } from './CommandScreen.jsx'

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
