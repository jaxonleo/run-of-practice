import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AreaSelect, ActConfig, BenchmarkConfig } from './ActivityConfigs.jsx'

// Smoke coverage for the builder "Area" (sub-location) affordance. This
// control has regressed twice now: the picker was gated behind
// `loc.sublocations.length > 0` in three copy-pasted spots, so a coach whose
// location had no areas yet saw nothing and no way in. The fix routes every
// config component through the shared <AreaSelect>, which must (a) always
// show *some* way to set or add an area when there's a practice location and
// an openModal, and (b) degrade quietly (old behaviour) when there isn't.
// These tests pin both halves so a future refactor that drops the openModal
// prop, or re-adds the length gate, fails here instead of in production.

const locWithAreas = {
  id: 'loc-1',
  name: 'City Sports Complex',
  sublocations: [
    { id: 'area-a', name: 'Field A' },
    { id: 'area-b', name: 'Field B' },
    { id: 'area-c', name: 'Batting Cage' },
  ],
}
const locNoAreas = { id: 'loc-2', name: 'Community Park', sublocations: [] }

describe('AreaSelect', () => {
  it('renders nothing when there is no practice location', () => {
    const { container } = render(<AreaSelect loc={null} value="" onChange={vi.fn()} openModal={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the location has no areas and there is no way to add one (live / template editor)', () => {
    const { container } = render(<AreaSelect loc={locNoAreas} value="" onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers an inline "+ Add an area" button when the location has no areas yet', () => {
    render(<AreaSelect loc={locNoAreas} value="" onChange={vi.fn()} openModal={vi.fn()} />)
    expect(screen.getByRole('button', { name: /\+ Add an area to Community Park/ })).toBeInTheDocument()
  })

  it('the add button opens the addSublocation modal for this location', () => {
    const openModal = vi.fn()
    render(<AreaSelect loc={locNoAreas} value="" onChange={vi.fn()} openModal={openModal} />)
    fireEvent.click(screen.getByRole('button', { name: /\+ Add an area to Community Park/ }))
    expect(openModal).toHaveBeenCalledWith('addSublocation', { location: locNoAreas })
  })

  it('renders a select listing every area when the location has areas, even without openModal', () => {
    render(<AreaSelect loc={locWithAreas} value="" onChange={vi.fn()} />)
    const select = screen.getByRole('combobox')
    expect(within(select).getByRole('option', { name: 'Field A' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Field B' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Batting Cage' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Any' })).toBeInTheDocument()
  })

  it('adds a "+ Add an area..." option to the select only when openModal is available', () => {
    const { rerender } = render(<AreaSelect loc={locWithAreas} value="" onChange={vi.fn()} />)
    expect(screen.queryByRole('option', { name: /\+ Add an area/ })).not.toBeInTheDocument()
    rerender(<AreaSelect loc={locWithAreas} value="" onChange={vi.fn()} openModal={vi.fn()} />)
    expect(screen.getByRole('option', { name: /\+ Add an area/ })).toBeInTheDocument()
  })

  it('choosing a real area calls onChange with that area id', () => {
    const onChange = vi.fn()
    render(<AreaSelect loc={locWithAreas} value="" onChange={onChange} openModal={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'area-b' } })
    expect(onChange).toHaveBeenCalledWith('area-b')
  })

  it('choosing "+ Add an area..." in the select opens the modal and does not call onChange', () => {
    const onChange = vi.fn()
    const openModal = vi.fn()
    render(<AreaSelect loc={locWithAreas} value="" onChange={onChange} openModal={openModal} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__add_area__' } })
    expect(openModal).toHaveBeenCalledWith('addSublocation', { location: locWithAreas })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preselects the option matching the current value', () => {
    render(<AreaSelect loc={locWithAreas} value="area-c" onChange={vi.fn()} openModal={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('area-c')
  })
})

// The three config components (ActConfig / StationConfig / BenchmarkConfig)
// all render the identical <AreaSelect ... openModal={openModal}/> line. If
// the caller stops threading openModal down, AreaSelect silently falls back
// to the old length-gated behaviour. These mount two of the three with a
// realistic practice + location and assert the affordance actually reaches
// the screen, which is the integration half the unit tests above can't see.

const team = { id: 't1', name: 'Test Team', coaches: [{ id: 'c1', name: 'Coach One' }], players: [] }

describe('BenchmarkConfig Area affordance', () => {
  const base = { id: 'a1', type: 'benchmark', name: 'Test', duration: 10 }

  it('shows the Area select when the location has areas', () => {
    render(<BenchmarkConfig act={base} team={team} loc={locWithAreas} benchmarks={[]} onChange={vi.fn()} onDone={vi.fn()} openModal={vi.fn()} />)
    expect(screen.getByText('Area')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Field A' })).toBeInTheDocument()
  })

  it('shows the inline add-area button when the location has no areas yet but openModal is threaded', () => {
    render(<BenchmarkConfig act={base} team={team} loc={locNoAreas} benchmarks={[]} onChange={vi.fn()} onDone={vi.fn()} openModal={vi.fn()} />)
    expect(screen.getByRole('button', { name: /\+ Add an area to Community Park/ })).toBeInTheDocument()
  })
})

describe('ActConfig Area affordance', () => {
  const base = { id: 'a2', type: 'activity', name: 'Warmup', duration: 10, equipment: [] }

  it('shows the inline add-area button when the location has no areas yet but openModal is threaded', () => {
    render(<ActConfig act={base} team={team} loc={locNoAreas} sport="Baseball" onChange={vi.fn()} onDone={vi.fn()} assets={[]} coachId="c1" openModal={vi.fn()} />)
    expect(screen.getByRole('button', { name: /\+ Add an area to Community Park/ })).toBeInTheDocument()
  })

  it('shows nothing area-related when openModal is missing and the location has no areas', () => {
    render(<ActConfig act={base} team={team} loc={locNoAreas} sport="Baseball" onChange={vi.fn()} onDone={vi.fn()} assets={[]} coachId="c1" />)
    expect(screen.queryByText('Area')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add an area/ })).not.toBeInTheDocument()
  })
})
