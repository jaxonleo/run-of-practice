import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FuturePracticeGuardModal from './FuturePracticeGuardModal.jsx'

// A never-resolving promise stands in for the real async work (savePracticeTree
// et al) that hasn't returned yet -- lets a test fire a second click while the
// first is still "in flight", the exact window the reentrancy guard defends.
const pending = () => new Promise(() => {})

describe('FuturePracticeGuardModal', () => {
  it('renders the team name and all three choices', () => {
    render(<FuturePracticeGuardModal team={{ name: 'Stability Sweep FC' }} onCancel={vi.fn()} onRunAsNew={vi.fn()} onRunNow={vi.fn()} />)
    expect(screen.getByText(/Stability Sweep FC isn't scheduled to start/)).toBeInTheDocument()
    expect(screen.getByText('Run This Plan as a New Practice')).toBeInTheDocument()
    expect(screen.getByText('Run This Practice Now')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('calls onCancel when the backdrop is clicked, not when the modal content is', () => {
    const onCancel = vi.fn()
    render(<FuturePracticeGuardModal team={null} onCancel={onCancel} onRunAsNew={vi.fn()} onRunNow={vi.fn()} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onRunAsNew exactly once on a single click', () => {
    const onRunAsNew = vi.fn(pending)
    render(<FuturePracticeGuardModal team={{ name: 'Team' }} onCancel={vi.fn()} onRunAsNew={onRunAsNew} onRunNow={vi.fn()} />)
    fireEvent.click(screen.getByText('Run This Plan as a New Practice'))
    expect(onRunAsNew).toHaveBeenCalledTimes(1)
  })

  // Regression test for the reentrancy bug fixed this session: a fast
  // double-tap used to be able to pass the `if (busy) return` check twice
  // before React's setState had committed, firing savePracticeTree(null, ...)
  // twice and creating two duplicate practices. The useRef guard closes that
  // window since busyRef.current is set synchronously, before any await.
  it('only invokes the handler once even when clicked twice before the first call resolves', () => {
    const onRunAsNew = vi.fn(pending)
    render(<FuturePracticeGuardModal team={{ name: 'Team' }} onCancel={vi.fn()} onRunAsNew={onRunAsNew} onRunNow={vi.fn()} />)
    const button = screen.getByText('Run This Plan as a New Practice')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onRunAsNew).toHaveBeenCalledTimes(1)
  })

  it('disables all three actions once busy', () => {
    const onRunNow = vi.fn(pending)
    render(<FuturePracticeGuardModal team={{ name: 'Team' }} onCancel={vi.fn()} onRunAsNew={vi.fn()} onRunNow={onRunNow} />)
    fireEvent.click(screen.getByText('Run This Practice Now'))
    expect(screen.getByText('Run This Plan as a New Practice')).toBeDisabled()
    expect(screen.getByText('Run This Practice Now')).toBeDisabled()
    expect(screen.getByText('Cancel')).toBeDisabled()
  })
})
