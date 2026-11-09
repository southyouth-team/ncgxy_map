import { describe, expect, it } from 'vitest'
import { DEFAULT_CHARACTER_TRAVERSAL_PROFILE, normalizeCharacterTraversalProfile } from './CharacterTraversalProfile.js'

describe('CharacterTraversalProfile', () => {
  it('provides one canonical default matching the current sandbox controller tuning', () => {
    expect(normalizeCharacterTraversalProfile()).toEqual(DEFAULT_CHARACTER_TRAVERSAL_PROFILE)
  })

  it('keeps capsule height physically valid when dimensions change', () => {
    expect(normalizeCharacterTraversalProfile({ radius: 0.9, height: 1.7 })).toMatchObject({
      radius: 0.9,
      height: 1.82,
    })
  })

  it('clamps slope thresholds and rejects non-positive movement dimensions', () => {
    expect(normalizeCharacterTraversalProfile({
      radius: -1,
      maxStepHeight: 0,
      maxSlopeClimbAngleDegrees: 120,
      minSlopeSlideAngleDegrees: -10,
    })).toMatchObject({
      radius: 0.55,
      maxStepHeight: 0.45,
      maxSlopeClimbAngleDegrees: 89,
      minSlopeSlideAngleDegrees: 0,
    })
  })
})
