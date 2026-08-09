import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AbsencePicker from './AbsencePicker.jsx'
import { fetchPlannedAbsences, createPlannedAbsence, deletePlannedAbsence } from '../supabase.js'

vi.mock('../supabase.js', () => ({
  fetchPlannedAbsences: vi.fn(),
  createPlannedAbsence: vi.fn(),
  deletePlannedAbsence: vi.fn(),
  setPlannedAbsences: vi.fn(),
}))

const team = {
  id: 't1',
  players: [
    { id: 'p1', firstName: 'Alex', lastName: 'One' },
    { id: 'p2', firstName: 'Blair', lastName: 'Two' },
  ],
}
const practice = { id: 'prac1', teamId: 't1' }
const data = { teams: [team], practices: [] }

function renderPicker(onClose = vi.fn()) {
  render(<AbsencePicker data={data} coachId="coach1" mode="pickPlayersForPractice" practice={practice} team={team} onClose={onClose} />)
  return onClose
}

describe('AbsencePicker (pickPlayersForPractice mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchPlannedAbsences.mockResolvedValue([])
  })

  it('renders the roster and disables Save until the existing absences have loaded', async () => {
    renderPicker()
    expect(screen.getByText('Alex One')).toBeInTheDocument()
    expect(screen.getByText('Blair Two')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeDisabled()
    await waitFor(() => expect(screen.getByText('Save')).not.toBeDisabled())
  })

  it('saves checked players as absent and unchecked players as present, then closes', async () => {
    createPlannedAbsence.mockResolvedValue({ error: null })
    deletePlannedAbsence.mockResolvedValue({ error: null })
    const onClose = renderPicker()
    await waitFor(() => expect(screen.getByText('Save')).not.toBeDisabled())

    fireEvent.click(screen.getByText('Alex One').closest('label').querySelector('input'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(createPlannedAbsence).toHaveBeenCalledWith('prac1', 'p1', 'coach1', null)
    expect(deletePlannedAbsence).toHaveBeenCalledWith('prac1', 'p2')
  })

  // Regression test for this session's fix: setPlannedAbsences/createPlannedAbsence/
  // deletePlannedAbsence errors used to be discarded entirely -- a rejected write
  // looked identical to success and the modal closed anyway. Now a failed write
  // must surface a real error and keep the modal open.
  it('shows an error and does not close when a write fails', async () => {
    createPlannedAbsence.mockResolvedValue({ error: { message: 'RLS rejected it' } })
    deletePlannedAbsence.mockResolvedValue({ error: null })
    const onClose = renderPicker()
    await waitFor(() => expect(screen.getByText('Save')).not.toBeDisabled())

    fireEvent.click(screen.getByText('Alex One').closest('label').querySelector('input'))
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getByText("Couldn't save -- please try again.")).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  // Regression test for this session's useRef reentrancy fix: two synchronous
  // clicks (before the first write's promise has resolved, and before React
  // has re-rendered `disabled`) used to both pass the `if (saving) return`
  // check. Only the first should ever start writing.
  it('only processes one save pass when clicked twice before the first resolves', async () => {
    createPlannedAbsence.mockReturnValue(new Promise(() => {}))
    deletePlannedAbsence.mockReturnValue(new Promise(() => {}))
    renderPicker()
    await waitFor(() => expect(screen.getByText('Save')).not.toBeDisabled())

    const saveButton = screen.getByText('Save')
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    // The roster loop processes players sequentially and awaits each call, so
    // a second concurrent pass would show up as a second call to whichever
    // player's write fires first (Alex, unchecked -> deletePlannedAbsence).
    expect(deletePlannedAbsence).toHaveBeenCalledTimes(1)
  })
})
