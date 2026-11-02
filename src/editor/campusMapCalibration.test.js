import { describe, expect, it } from 'vitest'
import {
  applyCampusCalibration,
  createReferenceImageMetadata,
  fitCampusSimilarityTransform,
  invertCampusCalibration,
} from './campusMapCalibration.js'

describe('campus map similarity calibration', () => {
  it('fits scale, rotation and translation from two control points', () => {
    const transform = fitCampusSimilarityTransform([
      { source: [0, 0], target: [100, 200] },
      { source: [100, 0], target: [100, 250] },
    ])
    expect(transform.scale).toBeCloseTo(0.5)
    expect(transform.rotationDegrees).toBeCloseTo(90)
    expect(applyCampusCalibration([0, 0], transform)).toEqual([100, 200])
    expect(applyCampusCalibration([100, 0], transform)[1]).toBeCloseTo(250)
  })

  it('uses least squares for redundant control points and reports residual', () => {
    const transform = fitCampusSimilarityTransform([
      { source: [0, 0], target: [10, 20] },
      { source: [100, 0], target: [110, 20] },
      { source: [0, 100], target: [10, 120] },
      { source: [100, 100], target: [110.5, 120] },
    ])
    expect(transform.controlPointCount).toBe(4)
    expect(transform.rmsError).toBeGreaterThan(0)
    expect(transform.rmsError).toBeLessThan(1)
  })

  it('supports inverse mapping', () => {
    const transform = fitCampusSimilarityTransform([
      { source: [10, 20], target: [100, 200] },
      { source: [110, 20], target: [100, 300] },
    ])
    const source = [48, 76]
    const target = applyCampusCalibration(source, transform)
    const restored = invertCampusCalibration(target, transform)
    expect(restored[0]).toBeCloseTo(source[0])
    expect(restored[1]).toBeCloseTo(source[1])
  })

  it('rejects insufficient, coincident and invalid control points', () => {
    expect(() => fitCampusSimilarityTransform([])).toThrow()
    expect(() => fitCampusSimilarityTransform([
      { source: [1, 1], target: [2, 2] },
      { source: [1, 1], target: [3, 3] },
    ])).toThrow()
    expect(() => fitCampusSimilarityTransform([
      { source: [0, 0], target: [0, 0] },
      { source: [1, 0], target: [0, 0] },
    ])).toThrow()
  })

  it('creates bounded image metadata without embedding image bytes', () => {
    const metadata = createReferenceImageMetadata({ uri: '/assets/campus.png', width: 1600, height: 900, opacity: 2 })
    expect(metadata.opacity).toBe(1)
    expect(metadata.coordinateSpace).toBe('image-pixel')
    expect(metadata).not.toHaveProperty('data')
    expect(() => createReferenceImageMetadata({ uri: '', width: 100, height: 100 })).toThrow()
  })
})
