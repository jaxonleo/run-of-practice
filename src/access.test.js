import { describe, it, expect } from 'vitest'
import { myTeamRole, isHeadCoach, canManageTeamInMode, teamsForMode, homeTeamsForMode } from './constants.js'

const coachMode = { type: 'coach' }
const orgMode = (orgId) => ({ type: 'org', orgId })

describe('myTeamRole', () => {
  it('returns the role from an explicit team_staff row when one exists', () => {
    const team = { coaches: [{ userId: 'u1', role: 'Assistant Coach' }], ownerUserId: 'u1' }
    // an explicit row wins even though this same person is also the owner --
    // the owner fallback below is only for the no-row-yet case.
    expect(myTeamRole(team, 'u1')).toBe('Assistant Coach')
  })

  it('falls back to Head Coach when ownerUserId matches but no team_staff row exists', () => {
    const team = { coaches: [], ownerUserId: 'u1' }
    expect(myTeamRole(team, 'u1')).toBe('Head Coach')
  })

  it('returns null for someone with no row and no ownership', () => {
    const team = { coaches: [{ userId: 'someone-else', role: 'Head Coach' }], ownerUserId: 'someone-else' }
    expect(myTeamRole(team, 'u1')).toBe(null)
  })

  it('returns null when team or coachId is missing', () => {
    expect(myTeamRole(null, 'u1')).toBe(null)
    expect(myTeamRole({ coaches: [] }, null)).toBe(null)
  })
})

describe('isHeadCoach', () => {
  it('is true only for an actual Head Coach role', () => {
    expect(isHeadCoach({ coaches: [{ userId: 'u1', role: 'Head Coach' }] }, 'u1')).toBe(true)
    expect(isHeadCoach({ coaches: [{ userId: 'u1', role: 'Assistant Coach' }] }, 'u1')).toBe(false)
  })
})

describe('canManageTeamInMode', () => {
  it('in Coach mode, matches personal head-coach role only', () => {
    const team = { coaches: [{ userId: 'u1', role: 'Head Coach' }], organizationId: 'org1' }
    expect(canManageTeamInMode(team, 'u1', coachMode)).toBe(true)
    expect(canManageTeamInMode(team, 'u2', coachMode)).toBe(false)
  })

  it('in Org mode, grants management to anyone viewing that org regardless of personal role', () => {
    // this is the whole point of Org mode -- a director overseeing an org
    // team with zero personal team_staff rows there should still manage it.
    const team = { coaches: [], organizationId: 'org1' }
    expect(canManageTeamInMode(team, 'director1', orgMode('org1'))).toBe(true)
  })

  it('in Org mode, does not grant management for a different org', () => {
    const team = { coaches: [{ userId: 'u1', role: 'Head Coach' }], organizationId: 'org1' }
    expect(canManageTeamInMode(team, 'u1', orgMode('org2'))).toBe(false)
  })
})

describe('teamsForMode', () => {
  const teams = [
    { id: 't1', organizationId: 'org1', coaches: [{ userId: 'u1', role: 'Head Coach' }] },
    { id: 't2', organizationId: 'org1', coaches: [] },
    { id: 't3', organizationId: 'org2', coaches: [{ userId: 'u1', role: 'Assistant Coach' }] },
  ]

  it('in Coach mode, returns every team the coach personally has a role on, across orgs', () => {
    const result = teamsForMode(teams, coachMode, 'u1')
    expect(result.map(t => t.id)).toEqual(['t1', 't3'])
  })

  it('in Org mode, returns every team in the selected org regardless of personal role', () => {
    const result = teamsForMode(teams, orgMode('org1'), 'u1')
    expect(result.map(t => t.id)).toEqual(['t1', 't2'])
  })
})

describe('homeTeamsForMode', () => {
  it('in Coach mode, excludes a team the coach opted out of Home via show_on_home', () => {
    const teams = [
      { id: 't1', organizationId: null, coaches: [{ userId: 'u1', role: 'Head Coach', showOnHome: false }] },
      { id: 't2', organizationId: null, coaches: [{ userId: 'u1', role: 'Head Coach' }] },
    ]
    const result = homeTeamsForMode(teams, coachMode, 'u1')
    expect(result.map(t => t.id)).toEqual(['t2'])
  })

  it('in Org mode, ignores show_on_home entirely -- oversight should never hide a team', () => {
    const teams = [
      { id: 't1', organizationId: 'org1', coaches: [{ userId: 'u1', role: 'Head Coach', showOnHome: false }] },
    ]
    const result = homeTeamsForMode(teams, orgMode('org1'), 'u1')
    expect(result.map(t => t.id)).toEqual(['t1'])
  })
})
