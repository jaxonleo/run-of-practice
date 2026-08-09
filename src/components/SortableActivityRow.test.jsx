import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { SortableActivityRow } from './ActivityConfigs.jsx'

// useSortable needs a real DndContext/SortableContext ancestor to resolve --
// this wrapper is the minimum viable one for a single, non-dragging item.
function renderRow(props) {
  return render(
    <DndContext>
      <SortableContext items={['row1']}>
        <SortableActivityRow id="row1" {...props}>
          {() => <div data-testid="row-content">content</div>}
        </SortableActivityRow>
      </SortableContext>
    </DndContext>
  )
}

// Regression coverage for the stacking-context trap: every row gets
// position:relative + an explicit zIndex, which always creates a new
// stacking context -- so a popover deep inside one row can only ever
// paint above what's in *that same* context, never a sibling row painted
// after it in DOM order. `raised` is the one thing that lifts a specific
// row's zIndex above its neighbors when something inside it needs to
// escape (an open dropdown/mini-menu). Asserting the exact numbers here
// pins the fix in place -- if a future change silently drops `raised`
// back down to the same level as its siblings, this test catches it
// without anyone having to rediscover the bug by hand.
describe('SortableActivityRow z-index', () => {
  it('defaults to zIndex 1 when not raised or sticky', () => {
    renderRow({})
    const row = screen.getByTestId('row-content').parentElement
    expect(row.style.zIndex).toBe('1')
  })

  it('rises to zIndex 10 when raised, above a plain sibling row', () => {
    renderRow({ raised: true })
    const row = screen.getByTestId('row-content').parentElement
    expect(row.style.zIndex).toBe('10')
  })

  it('uses zIndex 5 for a sticky (but not raised) row', () => {
    renderRow({ sticky: true })
    const row = screen.getByTestId('row-content').parentElement
    expect(row.style.zIndex).toBe('5')
  })

  it('a raised row always outranks a sticky-but-not-raised row', () => {
    // this is the actual property that matters for the bug: whatever
    // combination of flags a caller passes, "raised" needs to win so an
    // open popover can escape a sticky sibling too, not just a plain one.
    renderRow({ raised: true, sticky: true })
    const row = screen.getByTestId('row-content').parentElement
    expect(Number(row.style.zIndex)).toBeGreaterThan(5)
  })
})
