import { describe, it, expect } from 'vitest'
import { assessmentLabel } from './BenchmarkReport.jsx'

describe('assessmentLabel (same-day assessment disambiguation)', () => {
  it('audit repro: two same-day assessments (station vs standalone) render distinct labels', () => {
    const station = { measured_local_date: '2026-09-11', measured_at: '2026-09-11T14:05:00Z', practice_name: null, source_kind: 'station', label: null }
    const standalone = { measured_local_date: '2026-09-11', measured_at: '2026-09-11T19:30:00Z', practice_name: null, source_kind: 'standalone', label: null }
    const a = assessmentLabel(station)
    const b = assessmentLabel(standalone)
    expect(a).not.toBe(b)
    expect(a).toContain('Station')
    expect(b).toContain('Standalone')
  })

  it('prefers the practice name over a generic source word when the practice has one', () => {
    const a = assessmentLabel({ measured_local_date: '2026-09-11', measured_at: '2026-09-11T14:05:00Z', practice_name: 'Tuesday Skills Night', source_kind: 'station', label: null })
    expect(a).toContain('Tuesday Skills Night')
    expect(a).not.toContain('Station')
  })

  it('still appends a Measure Again label on top of the source', () => {
    const a = assessmentLabel({ measured_local_date: '2026-09-11', measured_at: '2026-09-11T14:05:00Z', practice_name: null, source_kind: 'standalone', label: 'Measure Again' })
    expect(a).toContain('Standalone')
    expect(a).toContain('Measure Again')
  })

  it('falls back gracefully with no time, no source, and no label', () => {
    expect(assessmentLabel({ measured_local_date: '2026-09-11' })).toBe('2026-09-11')
  })
})
