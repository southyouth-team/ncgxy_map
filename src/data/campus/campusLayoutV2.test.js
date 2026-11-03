import { describe, expect, it } from 'vitest'
import {
  CAMPUS_LAYOUT_V2,
  imagePixelToWorld,
  validateCalibration,
  validateCampusFeature,
} from './campusLayoutV2.js'

describe('campusLayoutV2', () => {
  it('starts with no fabricated spatial features', () => {
    expect(CAMPUS_LAYOUT_V2.coordinateSystem.calibrationStatus).toBe('uncalibrated')
    expect(CAMPUS_LAYOUT_V2.calibration).toBeNull()
    expect(Object.values(CAMPUS_LAYOUT_V2.features).every(items => items.length === 0)).toBe(true)
  })

  it('maps image center to world origin', () => {
    const calibration = { imageWidth: 640, imageHeight: 480, worldWidth: 160 }
    expect(imagePixelToWorld(320, 240, calibration)).toEqual({ x: 0, z: 0 })
  })

  it('preserves image aspect ratio in world coordinates', () => {
    const calibration = { imageWidth: 640, imageHeight: 480, worldWidth: 160 }
    const point = imagePixelToWorld(640, 480, calibration)
    expect(point.x).toBe(80)
    expect(point.z).toBe(60)
  })

  it('rejects missing or invalid calibration', () => {
    expect(() => validateCalibration(null)).toThrow()
    expect(() => imagePixelToWorld(10, 10, { imageWidth: 0, imageHeight: 480, worldWidth: 160 })).toThrow()
    expect(() => imagePixelToWorld(641, 10, { imageWidth: 640, imageHeight: 480, worldWidth: 160 })).toThrow()
  })

  it('requires provenance and review metadata for every feature', () => {
    expect(validateCampusFeature({
      id: 'north-gate',
      type: 'entrance',
      status: 'draft',
      confidence: 'medium',
      sourceRefs: ['freshman-guide-2026-campus-plan'],
    })).toBe(true)
    expect(validateCampusFeature({ id: 'unknown', type: 'building' })).toBe(false)
  })
})
