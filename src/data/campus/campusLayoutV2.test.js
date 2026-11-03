import { describe, expect, it } from 'vitest'
import {
  CAMPUS_LAYOUT_V2,
  imagePixelToWorld,
  validateCalibration,
  validateCampusFeature,
  validateCampusGeometry,
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

  it('validates point, line and closed polygon geometry against image bounds', () => {
    expect(validateCampusGeometry({ type: 'Point', coordinates: [20, 30] }, 640, 480)).toBe(true)
    expect(validateCampusGeometry({ type: 'LineString', coordinates: [[0, 0], [640, 480]] }, 640, 480)).toBe(true)
    expect(validateCampusGeometry({ type: 'Polygon', coordinates: [[[0, 0], [40, 0], [40, 40], [0, 0]]] }, 640, 480)).toBe(true)
    expect(validateCampusGeometry({ type: 'Polygon', coordinates: [[[0, 0], [40, 0], [40, 40], [0, 40]]] }, 640, 480)).toBe(false)
    expect(validateCampusGeometry({ type: 'Point', coordinates: [641, 20] }, 640, 480)).toBe(false)
    expect(validateCampusGeometry({ type: 'Circle', coordinates: [20, 30] }, 640, 480)).toBe(false)
  })

  it('rejects feature geometry that is outside the reference image', () => {
    expect(validateCampusFeature({
      id: 'lake',
      type: 'water-body',
      status: 'draft',
      confidence: 'medium',
      sourceRefs: ['freshman-guide-2026-campus-plan'],
      geometry: { type: 'Point', coordinates: [700, 30] },
    }, 640, 480)).toBe(false)
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

  it('validates complete V2 documents and rejects mismatched geometry collections', async () => {
    const { validateCampusLayoutV2 } = await import('./campusLayoutV2.js')
    const documentData = {
      ...JSON.parse(JSON.stringify(CAMPUS_LAYOUT_V2)),
      coordinateSystem: { ...CAMPUS_LAYOUT_V2.coordinateSystem, referenceImage: { ...CAMPUS_LAYOUT_V2.coordinateSystem.referenceImage, width: 640, height: 480 } },
    }
    expect(validateCampusLayoutV2(documentData)).toEqual({ valid: true, errors: [] })
    documentData.features.buildings.push({
      id: 'building-1', type: 'building', status: 'draft', confidence: 'medium',
      sourceRefs: ['guide'], geometry: { type: 'Point', coordinates: [20, 30] },
    })
    const result = validateCampusLayoutV2(documentData)
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('几何类型错误'))).toBe(true)
  })

  it('rejects duplicate feature IDs and invalid image dimensions in V2 documents', async () => {
    const { validateCampusLayoutV2 } = await import('./campusLayoutV2.js')
    const documentData = {
      ...JSON.parse(JSON.stringify(CAMPUS_LAYOUT_V2)),
      coordinateSystem: { ...CAMPUS_LAYOUT_V2.coordinateSystem, referenceImage: { ...CAMPUS_LAYOUT_V2.coordinateSystem.referenceImage, width: 640, height: 480 } },
    }
    const feature = {
      id: 'north-gate', type: 'entrance', status: 'draft', confidence: 'medium',
      sourceRefs: ['guide'], geometry: { type: 'Point', coordinates: [20, 30] },
    }
    documentData.features.entrances = [feature, { ...feature }]
    expect(validateCampusLayoutV2(documentData).errors).toContain('要素 ID 重复：north-gate')
    documentData.coordinateSystem.referenceImage.width = null
    expect(validateCampusLayoutV2(documentData).valid).toBe(false)
  })

})